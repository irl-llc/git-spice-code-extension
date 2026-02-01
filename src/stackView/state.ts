import type {
	BranchChangeViewModel,
	BranchRecord,
	BranchViewModel,
	DisplayState,
	TreeFragmentData,
	TreePosition,
	UncommittedState,
} from './types';
import { buildTreeFragments as buildTreeFragmentsFromModel, type BranchTreeInput } from './tree/treeModel';

/** Branch with computed tree position */
type BranchWithTree = {
	branch: BranchRecord;
	tree: TreePosition;
};

/**
 * Builds the display state showing ALL tracked branches (like `gs ll -a`).
 * Branches are organized in a tree structure based on parent-child relationships.
 */
/** Special name for the uncommitted pseudo-branch. */
export const UNCOMMITTED_BRANCH_NAME = '__uncommitted__';

export function buildDisplayState(
	branches: BranchRecord[],
	error?: string,
	uncommitted?: UncommittedState,
): DisplayState {
	const branchMap = new Map(branches.map((branch) => [branch.name, branch]));
	const ordered = orderStackWithTree(branches, branchMap);

	const hasUncommittedChanges = uncommitted && (uncommitted.staged.length > 0 || uncommitted.unstaged.length > 0);
	const treeFragments = buildTreeFragments(ordered, hasUncommittedChanges ? uncommitted : undefined);

	return {
		branches: ordered.map((item) => {
			const fragment = treeFragments.get(item.branch.name)!;
			return createBranchViewModel(item.branch, item.tree, fragment);
		}),
		uncommitted: hasUncommittedChanges ? uncommitted : undefined,
		uncommittedTreeFragment: hasUncommittedChanges ? treeFragments.get(UNCOMMITTED_BRANCH_NAME) : undefined,
		error,
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
function orderStackWithTree(branches: BranchRecord[], branchMap: Map<string, BranchRecord>): BranchWithTree[] {
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
 * Builds tree fragment data for each branch row.
 * Delegates to the pure treeModel module for testable data computation.
 * If uncommitted changes exist, inserts a pseudo-branch entry for visualization.
 */
function buildTreeFragments(
	orderedBranches: BranchWithTree[],
	uncommitted?: UncommittedState,
): Map<string, TreeFragmentData> {
	let inputs = orderedBranches.map(toBranchTreeInput);

	if (uncommitted) {
		inputs = insertUncommittedPseudoBranch(inputs);
	}

	return buildTreeFragmentsFromModel(inputs);
}

/**
 * Inserts an uncommitted pseudo-branch as a child of the current branch.
 * Follows lane compaction rules: same lane if no siblings, new lane if siblings exist.
 */
function insertUncommittedPseudoBranch(inputs: BranchTreeInput[]): BranchTreeInput[] {
	const currentBranchIndex = inputs.findIndex((b) => b.isCurrent);
	if (currentBranchIndex === -1) {
		return inputs;
	}

	const currentBranch = inputs[currentBranchIndex];
	const currentChildCount = inputs.filter((b) => b.parentName === currentBranch.name).length;

	// Lane compaction: if current has no other children, uncommitted uses same lane
	// Otherwise, uncommitted forks to a new lane (max lane + 1)
	const maxLane = Math.max(...inputs.map((b) => b.lane));
	const uncommittedLane = currentChildCount === 0 ? currentBranch.lane : maxLane + 1;

	const uncommittedEntry: BranchTreeInput = {
		name: UNCOMMITTED_BRANCH_NAME,
		lane: uncommittedLane,
		parentName: currentBranch.name,
		isCurrent: false,
		isUncommitted: true,
		needsRestack: false,
	};

	// Insert uncommitted before current branch (post-order: children before parents)
	const result = [...inputs];
	result.splice(currentBranchIndex, 0, uncommittedEntry);
	return result;
}

/** Converts BranchWithTree to BranchTreeInput for the tree model. */
function toBranchTreeInput(item: BranchWithTree): BranchTreeInput {
	return {
		name: item.branch.name,
		lane: item.tree.lane,
		parentName: item.tree.parentName,
		isCurrent: item.branch.current === true,
		needsRestack: item.branch.down?.needsRestack === true,
	};
}

function createBranchViewModel(
	branch: BranchRecord,
	tree: TreePosition,
	treeFragment: TreeFragmentData,
): BranchViewModel {
	const restack = branch.down?.needsRestack === true || (branch.ups ?? []).some((link) => link.needsRestack === true);

	const model: BranchViewModel = {
		name: branch.name,
		current: branch.current === true,
		restack,
		tree,
		treeFragment,
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
		comments: change.comments,
	};
}
