import type { BranchReorderInfo } from '../utils/gitSpice';
import type { BranchChangeViewModel, BranchRecord, BranchViewModel, DisplayState, TreePosition } from './types';

/** Branch with computed tree position */
type BranchWithTree = {
	branch: BranchRecord;
	tree: TreePosition;
};

/**
 * Builds the display state showing ALL tracked branches (like `gs ll -a`).
 * Branches are organized in a tree structure based on parent-child relationships.
 */
export function buildDisplayState(
	branches: BranchRecord[],
	error?: string,
	pendingReorder?: BranchReorderInfo,
): DisplayState {
	const branchMap = new Map(branches.map((branch) => [branch.name, branch]));

	// Show all branches, not just the current stack's focus set
	let ordered = orderStackWithTree(branches, branchMap);

	// Apply pending reorder if it exists
	if (pendingReorder) {
		ordered = applyPendingReorderWithTree(ordered, pendingReorder);
	}

	return {
		branches: ordered.map((item) => createBranchViewModel(item.branch, item.tree)),
		error,
		pendingReorder,
	};
}

/** Context passed during tree traversal */
type TraversalContext = {
	depth: number;
	ancestorIsLast: boolean[];
	siblingIndex: number;
	siblingCount: number;
	nextLane: { value: number };
	parentLane: number;
};

/**
 * Orders branches using post-order traversal to match `gs ll -a` output.
 * Children appear before (above) their parents, with first sibling's subtree before second's.
 * Lane compaction: first child inherits parent's lane, additional children fork to new lanes.
 */
function orderStackWithTree(
	branches: BranchRecord[],
	branchMap: Map<string, BranchRecord>,
): BranchWithTree[] {
	const result: BranchWithTree[] = [];
	const visited = new Set<string>();
	const laneCounter = { value: 0 };

	const roots = branches
		.filter((branch) => !branch.down || !branchMap.has(branch.down.name))
		.sort((a, b) => a.name.localeCompare(b.name));

	const startingBranches = roots.length > 0 ? roots : branches;

	for (let i = 0; i < startingBranches.length; i++) {
		const rootLane = laneCounter.value++;
		postOrderTraverse(startingBranches[i], {
			depth: 0,
			ancestorIsLast: [],
			siblingIndex: i,
			siblingCount: startingBranches.length,
			nextLane: laneCounter,
			parentLane: rootLane,
		});
	}

	return result;

	function postOrderTraverse(branch: BranchRecord, ctx: TraversalContext): void {
		if (visited.has(branch.name)) {
			return;
		}
		visited.add(branch.name);

		const children = getChildren(branch, branchMap, branches);
		const isLastChild = ctx.siblingIndex === ctx.siblingCount - 1;

		// Lane compaction: first child (index 0) inherits parent lane, others fork
		const lane = ctx.siblingIndex === 0 ? ctx.parentLane : ctx.nextLane.value++;

		// Post-order: visit children FIRST, then add this node
		for (let i = 0; i < children.length; i++) {
			postOrderTraverse(children[i], {
				depth: ctx.depth + 1,
				ancestorIsLast: [...ctx.ancestorIsLast, isLastChild],
				siblingIndex: i,
				siblingCount: children.length,
				nextLane: ctx.nextLane,
				parentLane: lane,
			});
		}

		// Add node AFTER children (post-order)
		result.push({
			branch,
			tree: {
				depth: ctx.depth,
				isLastChild,
				ancestorIsLast: [...ctx.ancestorIsLast],
				parentName: branch.down?.name,
				siblingIndex: ctx.siblingIndex,
				siblingCount: ctx.siblingCount,
				lane,
			},
		});
	}
}

/** Gets sorted children of a branch that are in the current branch set */
function getChildren(
	branch: BranchRecord,
	branchMap: Map<string, BranchRecord>,
	branches: BranchRecord[],
): BranchRecord[] {
	return (branch.ups ?? [])
		.map((link) => branchMap.get(link.name))
		.filter((child): child is BranchRecord => child !== undefined && branches.includes(child))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Applies a pending reorder operation to the branches array.
 * This temporarily reorders branches to reflect the visual drag-and-drop
 * before the user confirms or cancels the operation.
 *
 * Note: Tree positions are preserved from the original computation.
 * The reorder is visual only until confirmed.
 */
function applyPendingReorderWithTree(
	branches: BranchWithTree[],
	pendingReorder: BranchReorderInfo,
): BranchWithTree[] {
	const reordered = [...branches];

	const branchIndex = reordered.findIndex((item) => item.branch.name === pendingReorder.branchName);

	if (branchIndex === -1) {
		return branches;
	}

	const [movedItem] = reordered.splice(branchIndex, 1);

	// Convert SortableJS index to array index (branches displayed in reverse)
	const actualNewIndex = reordered.length - pendingReorder.newIndex;
	const clampedIndex = Math.max(0, Math.min(actualNewIndex, reordered.length));

	reordered.splice(clampedIndex, 0, movedItem);

	return reordered;
}

function createBranchViewModel(branch: BranchRecord, tree: TreePosition): BranchViewModel {
	const restack =
		branch.down?.needsRestack === true || (branch.ups ?? []).some((link) => link.needsRestack === true);

	const model: BranchViewModel = {
		name: branch.name,
		current: branch.current === true,
		restack,
		tree,
	};

	if (branch.change) {
		model.change = toChangeViewModel(branch.change);
	}

	if (branch.commits && branch.commits.length > 0) {
		model.commits = branch.commits.map((commit) => ({
			sha: commit.sha,
			shortSha: commit.sha.slice(0, 8),
			subject: commit.subject,
		}));
	}

	return model;
}

function toChangeViewModel(change: NonNullable<BranchRecord['change']>): BranchChangeViewModel {
	return {
		id: change.id,
		url: change.url,
		status: change.status,
	};
}
