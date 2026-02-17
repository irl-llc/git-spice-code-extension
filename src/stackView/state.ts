import type { GitSpiceBranch } from '../gitSpiceSchema';
import type {
	BranchChangeViewModel,
	BranchViewModel,
	RepositoryViewModel,
	TreeFragmentData,
	TreePosition,
	UncommittedState,
} from './types';
import { buildTreeFragments as buildTreeFragmentsFromModel, type BranchTreeInput } from './tree/treeModel';

/** Branch with computed tree position */
type BranchWithTree = {
	branch: GitSpiceBranch;
	tree: TreePosition;
};

/** Special name for the uncommitted pseudo-branch. */
export const UNCOMMITTED_BRANCH_NAME = '__uncommitted__';

/** Input parameters for building a repository display state. */
export type RepoDisplayInput = {
	repoId: string;
	repoName: string;
	branches: GitSpiceBranch[];
	error?: string;
	uncommitted?: UncommittedState;
	/** Name of the current branch when not tracked by git-spice. */
	untrackedBranch?: string;
};

/**
 * Builds a single repository's display state from its branch data.
 * Branches are organized in a tree structure based on parent-child relationships.
 */
export function buildRepoDisplayState(input: RepoDisplayInput): RepositoryViewModel {
	const ordered = orderStackWithTree(input.branches, new Map(input.branches.map((b) => [b.name, b])));
	const uncommitted = filterEmptyUncommitted(input.uncommitted);
	const treeFragments = buildTreeFragments(ordered, uncommitted);

	return {
		id: input.repoId,
		name: input.repoName,
		branches: mapToBranchViewModels(ordered, treeFragments),
		uncommitted,
		uncommittedTreeFragment: uncommitted ? treeFragments.get(UNCOMMITTED_BRANCH_NAME) : undefined,
		error: input.error,
		untrackedBranch: input.untrackedBranch,
	};
}

/** Returns uncommitted state only if it contains changes, otherwise undefined. */
function filterEmptyUncommitted(uncommitted?: UncommittedState): UncommittedState | undefined {
	if (!uncommitted) return undefined;
	if (uncommitted.staged.length === 0 && uncommitted.unstaged.length === 0) return undefined;
	return uncommitted;
}

/** Maps ordered branches to view models using precomputed tree fragments. */
function mapToBranchViewModels(ordered: BranchWithTree[], fragments: Map<string, TreeFragmentData>): BranchViewModel[] {
	return ordered.map((item) => createBranchViewModel(item.branch, item.tree, fragments.get(item.branch.name)!));
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

/** Mutable state shared during tree traversal */
type TraversalState = {
	result: BranchWithTree[];
	visited: Set<string>;
	branchMap: Map<string, GitSpiceBranch>;
	branches: GitSpiceBranch[];
};

/** Computes the lane for a node using lane compaction rules. */
function computeLane(siblingIndex: number, parentLane: number, nextLane: { value: number }): number {
	return siblingIndex === 0 ? parentLane : nextLane.value++;
}

/** Creates the tree position for a branch node. */
function createTreePosition(branch: GitSpiceBranch, ctx: TraversalContext, lane: number, isLastChild: boolean): TreePosition {
	return {
		depth: ctx.depth,
		isLastChild,
		ancestorIsLast: [...ctx.ancestorIsLast],
		parentName: branch.down?.name,
		siblingIndex: ctx.siblingIndex,
		siblingCount: ctx.siblingCount,
		lane,
	};
}

/** Post-order traversal: visits children first, then adds node to result. */
function postOrderTraverse(branch: GitSpiceBranch, ctx: TraversalContext, state: TraversalState): void {
	if (state.visited.has(branch.name)) return;
	state.visited.add(branch.name);

	const children = getChildren(branch, state.branchMap, state.branches);
	const isLastChild = ctx.siblingIndex === ctx.siblingCount - 1;
	const lane = computeLane(ctx.siblingIndex, ctx.parentLane, ctx.nextLane);

	visitChildren(children, ctx, lane, isLastChild, state);
	state.result.push({ branch, tree: createTreePosition(branch, ctx, lane, isLastChild) });
}

/** Recursively visits all children in post-order. */
function visitChildren(children: GitSpiceBranch[], ctx: TraversalContext, lane: number, isLastChild: boolean, state: TraversalState): void {
	for (let i = 0; i < children.length; i++) {
		postOrderTraverse(children[i], {
			depth: ctx.depth + 1,
			ancestorIsLast: [...ctx.ancestorIsLast, isLastChild],
			siblingIndex: i,
			siblingCount: children.length,
			nextLane: ctx.nextLane,
			parentLane: lane,
		}, state);
	}
}

/** Finds root branches (those without a tracked parent). */
function findRootBranches(branches: GitSpiceBranch[], branchMap: Map<string, GitSpiceBranch>): GitSpiceBranch[] {
	const roots = branches
		.filter((branch) => !branch.down || !branchMap.has(branch.down.name))
		.sort((a, b) => a.name.localeCompare(b.name));
	return roots.length > 0 ? roots : branches;
}

/**
 * Orders branches using post-order traversal to match `gs ll -a` output.
 * Children appear before (above) their parents, with first sibling's subtree before second's.
 */
function orderStackWithTree(branches: GitSpiceBranch[], branchMap: Map<string, GitSpiceBranch>): BranchWithTree[] {
	const state: TraversalState = { result: [], visited: new Set(), branchMap, branches };
	const laneCounter = { value: 0 };
	const startingBranches = findRootBranches(branches, branchMap);

	for (let i = 0; i < startingBranches.length; i++) {
		const rootLane = laneCounter.value++;
		postOrderTraverse(startingBranches[i], {
			depth: 0,
			ancestorIsLast: [],
			siblingIndex: i,
			siblingCount: startingBranches.length,
			nextLane: laneCounter,
			parentLane: rootLane,
		}, state);
	}

	return state.result;
}

/** Gets sorted children of a branch that are in the current branch set */
function getChildren(
	branch: GitSpiceBranch,
	branchMap: Map<string, GitSpiceBranch>,
	branches: GitSpiceBranch[],
): GitSpiceBranch[] {
	return (branch.ups ?? [])
		.map((link) => branchMap.get(link.name))
		.filter((child): child is GitSpiceBranch => child !== undefined && branches.includes(child))
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

/** Computes lane for uncommitted pseudo-branch using compaction rules. */
function computeUncommittedLane(inputs: BranchTreeInput[], currentBranch: BranchTreeInput): number {
	const childCount = inputs.filter((b) => b.parentName === currentBranch.name).length;
	if (childCount === 0) return currentBranch.lane;
	return Math.max(...inputs.map((b) => b.lane)) + 1;
}

/** Creates the uncommitted pseudo-branch entry. */
function createUncommittedEntry(lane: number, parentName: string): BranchTreeInput {
	return {
		name: UNCOMMITTED_BRANCH_NAME,
		lane,
		parentName,
		isCurrent: false,
		isUncommitted: true,
		needsRestack: false,
	};
}

/** Inserts an uncommitted pseudo-branch as a child of the current branch. */
function insertUncommittedPseudoBranch(inputs: BranchTreeInput[]): BranchTreeInput[] {
	const currentIndex = inputs.findIndex((b) => b.isCurrent);
	if (currentIndex === -1) return inputs;

	const currentBranch = inputs[currentIndex];
	const lane = computeUncommittedLane(inputs, currentBranch);
	const entry = createUncommittedEntry(lane, currentBranch.name);

	const result = [...inputs];
	result.splice(currentIndex, 0, entry);
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

/** Checks if branch needs restacking based on parent/child relationships. */
function needsRestack(branch: GitSpiceBranch): boolean {
	const downNeedsRestack = branch.down?.needsRestack === true;
	const upNeedsRestack = (branch.ups ?? []).some((link) => link.needsRestack === true);
	return downNeedsRestack || upNeedsRestack;
}

/** Maps branch commits to view model format. */
function mapCommitsToViewModel(commits: GitSpiceBranch['commits']): BranchViewModel['commits'] {
	if (!commits || commits.length === 0) return undefined;
	return commits.map((c) => ({ sha: c.sha, shortSha: c.sha.slice(0, 8), subject: c.subject }));
}

/** Creates a branch view model from branch data and tree information. */
function createBranchViewModel(branch: GitSpiceBranch, tree: TreePosition, treeFragment: TreeFragmentData): BranchViewModel {
	return {
		name: branch.name,
		current: branch.current === true,
		restack: needsRestack(branch),
		tree,
		treeFragment,
		change: branch.change ? toChangeViewModel(branch.change) : undefined,
		commits: mapCommitsToViewModel(branch.commits),
	};
}

function toChangeViewModel(change: NonNullable<GitSpiceBranch['change']>): BranchChangeViewModel {
	return {
		id: change.id,
		url: change.url,
		status: change.status,
		comments: change.comments,
	};
}
