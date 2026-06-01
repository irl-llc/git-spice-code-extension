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

	it('marks branches not in the tip list as out of integration', () => {
		const state = integrationState({ tips: [{ name: 'feat-a', status: 'current', storedHash: 'a' }] });
		const branches = [createBranch('feat-a'), createBranch('feat-b')];
		const result = buildRepoDisplayState(repoInput(branches, state));
		const a = result.branches.find((b) => b.name === 'feat-a');
		const b = result.branches.find((b) => b.name === 'feat-b');
		assert.strictEqual(a?.outOfIntegration, false);
		assert.strictEqual(b?.outOfIntegration, true);
	});

	it('renders the integration node atop lane 0 with an integration style', () => {
		const state = integrationState();
		const result = buildRepoDisplayState(repoInput([createBranch('main')], state));
		const fragment = result.integration?.treeFragment;
		assert.strictEqual(fragment?.nodeStyle, 'integration');
		assert.strictEqual(fragment?.nodeLane, 0);
	});

	it('forks the integration node to every top-of-stack lane', () => {
		const state = integrationState();
		// Two independent roots → two top-of-stack lanes; integration forks up to them.
		const branches = [createBranch('main'), createBranch('other')];
		const result = buildRepoDisplayState(repoInput(branches, state));
		const fragment = result.integration!.treeFragment;
		const topLanes = result.branches.map((b) => b.tree.lane).sort((a, b) => a - b);
		// Every top lane continues below the integration node...
		for (const lane of topLanes) {
			assert.strictEqual(fragment.lanes[lane].continuesBelow, true, `lane ${lane} should continue below`);
		}
		// ...and every top lane except the node's own (0) is a fork connector.
		assert.deepStrictEqual(
			fragment.childForkLanes.map((c) => c.lane).sort((a, b) => a - b),
			topLanes.filter((lane) => lane !== 0),
		);
	});

	it('flags the integration node as needing rebuild when state is stale', () => {
		const state = integrationState({ needsRebuild: true });
		const result = buildRepoDisplayState(repoInput([createBranch('main')], state));
		assert.strictEqual(result.integration?.treeFragment.nodeNeedsRestack, true);
	});
});
