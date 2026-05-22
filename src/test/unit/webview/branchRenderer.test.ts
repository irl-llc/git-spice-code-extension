/**
 * Unit tests for branchRenderer change detection.
 * Verifies branchNeedsUpdate correctly detects TreeFragmentData changes.
 */

import * as assert from 'assert';

import { setupDom, teardownDom } from './domTestHelper';
import { branchNeedsUpdate, serializeComments } from '../../../stackView/webview/branchRenderer';
import { setBranchData, type BranchElementData } from '../../../stackView/domHelpers';
import type { BranchViewModel, LaneSegment, TreeFragmentData, TreePosition } from '../../../stackView/types';

/** Creates a default LaneSegment with optional overrides. */
function makeLane(overrides?: Partial<LaneSegment>): LaneSegment {
	return {
		continuesFromAbove: false,
		continuesBelow: false,
		hasNode: true,
		needsRestack: false,
		...overrides,
	};
}

/** Creates a default TreeFragmentData with optional overrides. */
function makeTreeFragment(overrides?: Partial<TreeFragmentData>): TreeFragmentData {
	return {
		lanes: [makeLane()],
		maxLane: 0,
		nodeLane: 0,
		childForkLanes: [],
		nodeStyle: 'normal',
		nodeNeedsRestack: false,
		...overrides,
	};
}

/** Creates a default TreePosition with optional overrides. */
function makeTreePosition(overrides?: Partial<TreePosition>): TreePosition {
	return {
		depth: 0,
		isLastChild: true,
		ancestorIsLast: [],
		siblingIndex: 0,
		siblingCount: 1,
		lane: 0,
		...overrides,
	};
}

/** Creates a default BranchViewModel with optional overrides. */
function makeBranch(overrides?: Partial<BranchViewModel>): BranchViewModel {
	return {
		name: 'test-branch',
		current: false,
		restack: false,
		commits: [{ sha: 'abc123', shortSha: 'abc', subject: 'test commit' }],
		tree: makeTreePosition(),
		treeFragment: makeTreeFragment(),
		...overrides,
	};
}

/** Builds BranchElementData matching storeBranchData logic. */
function makeStoredData(branch: BranchViewModel): BranchElementData {
	return {
		current: branch.current,
		restack: branch.restack,
		commitsCount: branch.commits?.length ?? 0,
		hasChange: Boolean(branch.change),
		changeId: branch.change?.id,
		changeStatus: branch.change?.status,
		changeCommentsKey: serializeComments(branch.change?.comments),
		treeDepth: branch.tree.depth,
		treeIsLastChild: branch.tree.isLastChild,
		treeAncestorIsLast: JSON.stringify(branch.tree.ancestorIsLast),
		treeLane: branch.tree.lane,
		treeFragmentSignature: JSON.stringify(branch.treeFragment),
	};
}

/** Creates a card element with stored baseline data. */
function setupCard(branch: BranchViewModel): HTMLElement {
	const card = document.createElement('article');
	card.dataset.content = 'true';
	setBranchData(card, makeStoredData(branch));
	return card;
}

describe('branchNeedsUpdate', () => {
	before(() => setupDom());
	after(() => teardownDom());

	it('should return false when nothing changed', () => {
		const branch = makeBranch();
		const card = setupCard(branch);
		assert.strictEqual(branchNeedsUpdate(card, branch), false);
	});

	it('should return true when no stored data exists', () => {
		const card = document.createElement('article');
		assert.strictEqual(branchNeedsUpdate(card, makeBranch()), true);
	});

	it('should return true when childForkLanes change (uncommitted fork)', () => {
		const original = makeBranch();
		const card = setupCard(original);

		const updated = makeBranch({
			treeFragment: makeTreeFragment({
				childForkLanes: [{ lane: 1, needsRestack: false, isUncommitted: true }],
			}),
		});

		assert.strictEqual(branchNeedsUpdate(card, updated), true);
	});

	it('should return true when lane needsRestack changes (stale restack lines)', () => {
		const restackLane = makeLane({ needsRestack: true });
		const original = makeBranch({
			treeFragment: makeTreeFragment({ lanes: [restackLane] }),
		});
		const card = setupCard(original);

		const clearedLane = makeLane({ needsRestack: false });
		const updated = makeBranch({
			treeFragment: makeTreeFragment({ lanes: [clearedLane] }),
		});

		assert.strictEqual(branchNeedsUpdate(card, updated), true);
	});

	it('should return true when nodeStyle changes', () => {
		const original = makeBranch();
		const card = setupCard(original);

		const updated = makeBranch({
			treeFragment: makeTreeFragment({ nodeStyle: 'current' }),
		});

		assert.strictEqual(branchNeedsUpdate(card, updated), true);
	});

	it('should return true when maxLane changes', () => {
		const original = makeBranch();
		const card = setupCard(original);

		const updated = makeBranch({
			treeFragment: makeTreeFragment({ maxLane: 1 }),
		});

		assert.strictEqual(branchNeedsUpdate(card, updated), true);
	});

	it('should return true when branch current changes (regression guard)', () => {
		const original = makeBranch({ current: false });
		const card = setupCard(original);

		const updated = makeBranch({ current: true });

		assert.strictEqual(branchNeedsUpdate(card, updated), true);
	});
});
