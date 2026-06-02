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

type Repo = ReturnType<typeof buildRepoDisplayState>;
type BranchVM = Repo['branches'][number];
const branchView = (r: Repo, name: string): BranchVM => r.branches.find((b) => b.name === name)!;
const branchFrag = (r: Repo, name: string): BranchVM['treeFragment'] => branchView(r, name).treeFragment;
const branchLane = (r: Repo, name: string): number => branchView(r, name).tree.lane;

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
		const byName = (n: string): BranchVM | undefined => result.branches.find((b) => b.name === n);
		assert.strictEqual(byName('feat-a')?.outOfIntegration, false, 'tip is in the integration');
		assert.strictEqual(byName('feat-b')?.outOfIntegration, true, 'non-tip non-trunk branch is out');
		assert.strictEqual(byName('main')?.outOfIntegration, false, 'trunk is the base, never X-marked');
	});

	it('clears the out-of-integration X when a leaf is added to the tip list (tip-add semantics)', () => {
		// State-level assertion for the context-menu "Add to integration build"
		// action: the only thing that changes is the integration tip list, and the
		// leaf's X marker must flip off once it is a tip. (Replaces a Playwright
		// capture whose end state was visually identical to `integration-built`.)
		const branches = [
			createBranch('main'),
			createBranch('feat-a', { down: { name: 'main' } }),
			createBranch('feat-b', { down: { name: 'feat-a' } }), // the leaf being added
		];
		const tip = (name: string): IntegrationState['tips'][number] => ({ name, status: 'current', storedHash: name });
		const before = buildRepoDisplayState(repoInput(branches, integrationState({ tips: [tip('feat-a')] })));
		const after = buildRepoDisplayState(
			repoInput(branches, integrationState({ tips: [tip('feat-a'), tip('feat-b')] })),
		);
		assert.strictEqual(branchView(before, 'feat-b').outOfIntegration, true, 'excluded leaf is X-marked');
		assert.strictEqual(branchView(after, 'feat-b').outOfIntegration, false, 'X clears once the leaf is a tip');
	});

	it('renders the integration node atop lane 0 with an integration style', () => {
		const state = integrationState();
		const result = buildRepoDisplayState(repoInput([createBranch('main')], state));
		const fragment = result.integration?.treeFragment;
		assert.strictEqual(fragment?.nodeStyle, 'integration');
		assert.strictEqual(fragment?.nodeLane, 0);
	});

	it('lone leaf tip links straight up its own lane (no forks)', () => {
		const state = integrationState({ tips: [{ name: 'feat-b', status: 'current', storedHash: 'b' }] });
		const branches = [
			createBranch('main'),
			createBranch('feat-a', { down: { name: 'main' } }),
			createBranch('feat-b', { down: { name: 'feat-a' } }), // linear; feat-b is the leaf
		];
		const result = buildRepoDisplayState(repoInput(branches, state));
		const integ = result.integration!.treeFragment;
		const featB = branchFrag(result, 'feat-b');
		assert.strictEqual(featB.lanes[branchLane(result, 'feat-b')].continuesFromAbove, true, 'tip links up its own lane');
		assert.ok(!featB.integrationForks?.length, 'leaf tip needs no bypass fork');
		assert.strictEqual(integ.lanes[0].continuesBelow, true, 'integ runs straight down lane 0 to the tip');
		assert.ok(!integ.integrationForks?.length, 'no down-fork when the only tip is on lane 0');
	});

	it('sibling tips: integ fans down to each tip lane (straight on lane 0, fork otherwise)', () => {
		const state = integrationState({
			tips: [
				{ name: 'feat-a', status: 'current', storedHash: 'a' },
				{ name: 'feat-b', status: 'current', storedHash: 'b' },
			],
		});
		const branches = [
			createBranch('main'),
			createBranch('feat-a', { down: { name: 'main' } }),
			createBranch('feat-b', { down: { name: 'main' } }), // siblings → different lanes
		];
		const result = buildRepoDisplayState(repoInput(branches, state));
		const integ = result.integration!.treeFragment;
		const laneA = branchLane(result, 'feat-a');
		const laneB = branchLane(result, 'feat-b');
		assert.notStrictEqual(laneA, laneB, 'siblings occupy different lanes');
		// Each tip links up its own lane; integ reaches lane 0 straight, others via a down-fork.
		for (const [name, lane] of [['feat-a', laneA] as const, ['feat-b', laneB] as const]) {
			assert.strictEqual(branchFrag(result, name).lanes[lane].continuesFromAbove, true);
			if (lane === 0) assert.strictEqual(integ.lanes[0].continuesBelow, true);
			else assert.ok(integ.integrationForks!.some((f) => f.direction === 'down' && f.lane === lane));
		}
	});

	it('mid-stack tip diverges into a bypass lane that passes the rows above it', () => {
		const state = integrationState({
			tips: [
				{ name: 'feat-a', status: 'current', storedHash: 'a' },
				{ name: 'feat-b', status: 'current', storedHash: 'b' },
			],
		});
		const branches = [
			createBranch('main'),
			createBranch('feat-a', { down: { name: 'main' } }),
			createBranch('feat-b', { down: { name: 'feat-a' } }), // linear: feat-b above feat-a
		];
		const result = buildRepoDisplayState(repoInput(branches, state));
		const integ = result.integration!.treeFragment;
		const featA = branchFrag(result, 'feat-a');
		const featB = branchFrag(result, 'feat-b');
		// feat-b (leaf) links straight up; feat-a (mid-stack) gets an upward bypass fork to a NEW lane.
		assert.ok(!featB.integrationForks?.length, 'leaf tip has no bypass');
		const up = featA.integrationForks?.find((f) => f.direction === 'up');
		assert.ok(up, 'mid-stack tip has an upward integration fork');
		assert.ok(up!.lane > branchLane(result, 'feat-b'), 'bypass lane is a new lane to the right of the spine');
		// integ fans down to that bypass lane, and the bypass passes through feat-b (the row above).
		assert.ok(integ.integrationForks!.some((f) => f.direction === 'down' && f.lane === up!.lane));
		assert.strictEqual(featB.lanes[up!.lane].continuesBelow, true, 'bypass passes through the row above');
	});

	it('keeps a non-integration sibling stack column with no integration link', () => {
		const state = integrationState({ tips: [{ name: 'feat-a', status: 'current', storedHash: 'a' }] });
		const branches = [
			createBranch('main'),
			createBranch('feat-a', { down: { name: 'main' } }), // the only tip
			createBranch('feat-b', { down: { name: 'main' } }), // sibling stack, NOT integration
			createBranch('feat-c', { down: { name: 'feat-b' } }),
		];
		const result = buildRepoDisplayState(repoInput(branches, state));
		const integ = result.integration!.treeFragment;
		const cLane = branchLane(result, 'feat-c');
		assert.strictEqual(branchView(result, 'feat-c').outOfIntegration, true, 'non-tip leaf is out of integration');
		assert.strictEqual(
			branchView(result, 'feat-b').outOfIntegration,
			false,
			'mid-stack branch (base of feat-c) is not a tip, so it gets no X marker',
		);
		assert.ok(
			!integ.integrationForks?.some((f) => f.lane === cLane),
			'integ never forks into the non-integration column',
		);
		assert.notStrictEqual(
			cLane,
			branchLane(result, 'feat-a'),
			'the non-integration column still exists (bottom-up fan-out)',
		);
	});

	it('flags the integration node as needing rebuild when state is stale', () => {
		const state = integrationState({ needsRebuild: true });
		const result = buildRepoDisplayState(repoInput([createBranch('main')], state));
		assert.strictEqual(result.integration?.treeFragment.nodeNeedsRestack, true);
	});

	it('colors integration links marigold (needsRestack) when the build needs a rebuild', () => {
		const state = integrationState({
			needsRebuild: true,
			tips: [
				{ name: 'feat-a', status: 'drifted', storedHash: 'a', currentHash: 'x' },
				{ name: 'feat-b', status: 'current', storedHash: 'b' },
			],
		});
		const branches = [
			createBranch('main'),
			createBranch('feat-a', { down: { name: 'main' } }),
			createBranch('feat-b', { down: { name: 'feat-a' } }),
		];
		const result = buildRepoDisplayState(repoInput(branches, state));
		const integ = result.integration!.treeFragment;
		assert.ok(
			integ.integrationForks!.every((f) => f.needsRebuild),
			'integ down-forks are marigold',
		);
		const up = branchFrag(result, 'feat-a').integrationForks!.find((f) => f.direction === 'up')!;
		assert.strictEqual(up.needsRebuild, true, 'the mid-stack up-fork is marigold');
	});

	it('flags the integration node as needing rebuild when state is stale', () => {
		const state = integrationState({ needsRebuild: true });
		const result = buildRepoDisplayState(repoInput([createBranch('main')], state));
		assert.strictEqual(result.integration?.treeFragment.nodeNeedsRestack, true);
	});
});
