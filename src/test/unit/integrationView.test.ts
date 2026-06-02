/**
 * Unit tests for integration-branch view-model derivation in state.ts:
 * - toIntegrationViewModel mapping (name, needsRebuild, tipNames, fragment)
 * - per-branch outOfIntegration flag (only set when integration is configured)
 * - the integration tree fragment (node atop the stack, forks to top lanes)
 */

import * as assert from 'assert';

import { buildRepoDisplayState, type RepoDisplayInput } from '../../stackView/state';
import type { GitSpiceBranch } from '../../gitSpiceSchema';
import type { IntegrationState } from '../../utils/integrationState';

function createBranch(name: string, options: Partial<GitSpiceBranch> = {}): GitSpiceBranch {
	return { name, ...options };
}

function repoInput(branches: GitSpiceBranch[], integration?: IntegrationState | null): RepoDisplayInput {
	return { repoId: 'r', repoName: 'r', branches, integration };
}

function integrationState(overrides: Partial<IntegrationState> = {}): IntegrationState {
	return { name: 'integ', tips: [], needsRebuild: false, ...overrides };
}

describe('integration view model', () => {
	it('omits integration when unconfigured/unsupported', () => {
		const result = buildRepoDisplayState(repoInput([createBranch('main')], null));
		assert.strictEqual(result.integration, undefined);
	});

	it('maps name, needsRebuild, and tip names', () => {
		const state = integrationState({
			name: 'integ',
			needsRebuild: true,
			tips: [
				{ name: 'feat-a', status: 'drifted', storedHash: 'a', currentHash: 'b' },
				{ name: 'feat-b', status: 'current', storedHash: 'c' },
			],
		});
		const result = buildRepoDisplayState(repoInput([createBranch('feat-a'), createBranch('feat-b')], state));
		assert.strictEqual(result.integration?.name, 'integ');
		assert.strictEqual(result.integration?.needsRebuild, true);
		assert.deepStrictEqual(result.integration?.tipNames, ['feat-a', 'feat-b']);
	});

	it('leaves outOfIntegration undefined when no integration configured', () => {
		const result = buildRepoDisplayState(repoInput([createBranch('feat-a')]));
		assert.strictEqual(result.branches[0].outOfIntegration, undefined);
	});

	it('marks non-tip non-trunk branches out of integration, but never the trunk', () => {
		const state = integrationState({ tips: [{ name: 'feat-a', status: 'current', storedHash: 'a' }] });
		// main is trunk (no `down`); feat-a is a tip; feat-b is a non-tip stacked branch.
		const branches = [
			createBranch('main'),
			createBranch('feat-a', { down: { name: 'main' } }),
			createBranch('feat-b', { down: { name: 'feat-a' } }),
		];
		const result = buildRepoDisplayState(repoInput(branches, state));
		const byName = (n: string) => result.branches.find((b) => b.name === n);
		assert.strictEqual(byName('feat-a')?.outOfIntegration, false, 'tip is in the integration');
		assert.strictEqual(byName('feat-b')?.outOfIntegration, true, 'non-tip non-trunk branch is out');
		assert.strictEqual(byName('main')?.outOfIntegration, false, 'trunk is the base, never X-marked');
	});

	it('renders the integration node atop lane 0 with an integration style', () => {
		const state = integrationState();
		const result = buildRepoDisplayState(repoInput([createBranch('main')], state));
		const fragment = result.integration?.treeFragment;
		assert.strictEqual(fragment?.nodeStyle, 'integration');
		assert.strictEqual(fragment?.nodeLane, 0);
	});

	it('forks the integration node down to each integration tip lane (mirror of trunk)', () => {
		const state = integrationState({
			tips: [
				{ name: 'feat-a', status: 'current', storedHash: 'a' },
				{ name: 'feat-b', status: 'current', storedHash: 'b' },
			],
		});
		// Two sibling stacks off trunk → the two tips land on different lanes.
		const branches = [
			createBranch('main'),
			createBranch('feat-a', { down: { name: 'main' } }),
			createBranch('feat-b', { down: { name: 'main' } }),
		];
		const result = buildRepoDisplayState(repoInput(branches, state));
		const fragment = result.integration!.treeFragment;
		const tipLanes = result.branches
			.filter((b) => b.name === 'feat-a' || b.name === 'feat-b')
			.map((b) => b.tree.lane)
			.sort((a, b) => a - b);
		// Each tip lane continues below the integration node (its swimlane converges up)...
		for (const lane of tipLanes) {
			assert.strictEqual(fragment.lanes[lane].continuesBelow, true, `tip lane ${lane} should continue below`);
		}
		// ...and each tip lane except the node's own (0) is a fork connector down to that tip.
		assert.deepStrictEqual(
			fragment.childForkLanes.map((c) => c.lane).sort((a, b) => a - b),
			tipLanes.filter((lane) => lane !== 0),
		);
		// A non-tip branch's lane must NOT be a fork target.
		const nonTip = createBranch('feat-c', { down: { name: 'feat-a' } });
		const r2 = buildRepoDisplayState(repoInput([...branches, nonTip], state));
		const cLane = r2.branches.find((b) => b.name === 'feat-c')!.tree.lane;
		assert.ok(!r2.integration!.treeFragment.childForkLanes.some((c) => c.lane === cLane && cLane !== tipLanes[0]));
	});

	it('flags the integration node as needing rebuild when state is stale', () => {
		const state = integrationState({ needsRebuild: true });
		const result = buildRepoDisplayState(repoInput([createBranch('main')], state));
		assert.strictEqual(result.integration?.treeFragment.nodeNeedsRestack, true);
	});
});
