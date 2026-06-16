import type { GitSpiceBranch } from '../gitSpiceSchema';
import type { IntegrationState } from '../utils/integrationState';
import type {
	BranchChangeViewModel,
	BranchViewModel,
	IntegrationFork,
	IntegrationViewModel,
	LaneSegment,
	RepositoryViewModel,
	TreeFragmentData,
	TreePosition,
	UncommittedState,
} from './types';
import { buildTreeFragments as buildTreeFragmentsFromModel, type BranchTreeInput } from './tree/treeModel';
import { buildStackRows, computeCollapsible } from './stackRows';
import { toIntegrationViewModel } from './integrationViewModel';
import type { BranchWithTree, RepoDisplayInput } from './stateTypes';

export type { BranchWithTree, RepoDisplayInput } from './stateTypes';

/** Special name for the uncommitted pseudo-branch. */
export const UNCOMMITTED_BRANCH_NAME = '__uncommitted__';

/**
 * Builds a single repository's display state from its branch data. Branches are
 * organized in a tree by parent-child relationships. The integration branch is
 * excluded from the branch layout here — it is rendered separately as the
 * integration node (otherwise it becomes a phantom root that shifts lanes).
 */
export function buildRepoDisplayState(input: RepoDisplayInput): RepositoryViewModel {
	const integrationName = input.integration?.name;
	const branchList = integrationName ? input.branches.filter((b) => b.name !== integrationName) : input.branches;
	const ordered = orderStackWithTree(branchList, new Map(branchList.map((b) => [b.name, b])));
	const uncommitted = filterEmptyUncommitted(input.uncommitted);
	const treeFragments = buildTreeFragments(ordered, uncommitted);
	const integration = toIntegrationViewModel(input.integration, ordered, treeFragments);
	const collapsible = computeCollapsible(ordered, integrationName);
	const branches = mapToBranchViewModels(ordered, treeFragments, integration, collapsible);
	return assembleRepoViewModel(input, { ordered, branches, uncommitted, treeFragments, integration });
}

/** Precomputed pieces the repo view model is assembled from. */
type RepoViewModelParts = {
	ordered: BranchWithTree[];
	branches: BranchViewModel[];
	uncommitted?: UncommittedState;
	treeFragments: Map<string, TreeFragmentData>;
	integration?: IntegrationViewModel;
};

/** Assembles the {@link RepositoryViewModel} from the precomputed layout pieces. */
function assembleRepoViewModel(input: RepoDisplayInput, parts: RepoViewModelParts): RepositoryViewModel {
	return {
		id: input.repoId,
		name: input.repoName,
		branches: parts.branches,
		rows: buildStackRows(parts.ordered, parts.branches, input.collapsed),
		uncommitted: parts.uncommitted,
		uncommittedTreeFragment: parts.uncommitted ? parts.treeFragments.get(UNCOMMITTED_BRANCH_NAME) : undefined,
		error: input.error,
		untrackedBranch: input.untrackedBranch,
		integration: parts.integration,
	};
}

/** Returns uncommitted state only if it contains changes, otherwise undefined. */
function filterEmptyUncommitted(uncommitted?: UncommittedState): UncommittedState | undefined {
	if (!uncommitted) return undefined;
	if (uncommitted.staged.length === 0 && uncommitted.unstaged.length === 0) return undefined;
	return uncommitted;
}

/** Maps ordered branches to view models using precomputed tree fragments. */
function mapToBranchViewModels(
	ordered: BranchWithTree[],
	fragments: Map<string, TreeFragmentData>,
	integration: IntegrationViewModel | undefined,
	collapsible: ReadonlySet<string>,
): BranchViewModel[] {
	const mark: IntegrationMarkContext = {
		tipSet: integration ? new Set(integration.tipNames) : undefined,
		leafNames: computeLeafNames(ordered),
	};
	return ordered.map((item) =>
		createBranchViewModel({
			branch: item.branch,
			tree: item.tree,
			treeFragment: fragments.get(item.branch.name)!,
			mark,
			collapsible: collapsible.has(item.branch.name),
		}),
	);
}

/** Inputs for deciding the out-of-integration "X" marker. */
type IntegrationMarkContext = {
	/** Integration tip names, or undefined when no integration is configured. */
	tipSet?: Set<string>;
	/** Names of branches that are leaves (no other branch is stacked on them). */
	leafNames: Set<string>;
};

/** Branch names that no other branch is stacked on — the real stack heads. */
function computeLeafNames(ordered: BranchWithTree[]): Set<string> {
	const parents = new Set<string>();
	for (const it of ordered) if (it.branch.down) parents.add(it.branch.down.name);
	return new Set(ordered.map((it) => it.branch.name).filter((name) => !parents.has(name)));
}

/**
 * Determines whether a branch should show the out-of-integration "X" marker.
 * The marker flags a stack HEAD that is excluded from the integration build, so
 * it shows only when an integration branch is configured AND the branch is a
 * leaf (a real stack tip) that is not one of the integration tips. Trunk (no
 * base) and mid-stack branches (which are bases of other branches, so not tips
 * at all) never get the marker (issue #39 review).
 */
function computeOutOfIntegration(branch: GitSpiceBranch, mark: IntegrationMarkContext): boolean | undefined {
	if (!mark.tipSet) return undefined;
	if (!branch.down) return false; // trunk has no base → exempt from the marker
	if (!mark.leafNames.has(branch.name)) return false; // mid-stack branch is not a tip
	return !mark.tipSet.has(branch.name);
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
	/** Precomputed parent-name → sorted children, built once per render. */
	childrenMap: Map<string, GitSpiceBranch[]>;
};

/** Computes the lane for a node using lane compaction rules. */
function computeLane(siblingIndex: number, parentLane: number, nextLane: { value: number }): number {
	return siblingIndex === 0 ? parentLane : nextLane.value++;
}

/** Creates the tree position for a branch node. */
function createTreePosition(
	branch: GitSpiceBranch,
	ctx: TraversalContext,
	lane: number,
	isLastChild: boolean,
): TreePosition {
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

	const children = getChildren(branch, state.childrenMap);
	const isLastChild = ctx.siblingIndex === ctx.siblingCount - 1;
	const lane = computeLane(ctx.siblingIndex, ctx.parentLane, ctx.nextLane);

	visitChildren(children, { parent: ctx, lane, isLastChild }, state);
	state.result.push({ branch, tree: createTreePosition(branch, ctx, lane, isLastChild) });
}

/** Position of a parent node relative to which its children are traversed. */
type ChildVisitFrame = {
	parent: TraversalContext;
	lane: number;
	isLastChild: boolean;
};

/** Builds the traversal context for the i-th child of a parent frame. */
function buildChildContext(frame: ChildVisitFrame, siblingIndex: number, siblingCount: number): TraversalContext {
	return {
		depth: frame.parent.depth + 1,
		ancestorIsLast: [...frame.parent.ancestorIsLast, frame.isLastChild],
		siblingIndex,
		siblingCount,
		nextLane: frame.parent.nextLane,
		parentLane: frame.lane,
	};
}

/** Recursively visits all children in post-order. */
function visitChildren(children: GitSpiceBranch[], frame: ChildVisitFrame, state: TraversalState): void {
	for (let i = 0; i < children.length; i++) {
		postOrderTraverse(children[i], buildChildContext(frame, i, children.length), state);
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
 * Groups branches by their base (`down`) branch name, sorting each
 * sibling list once. Built a single time per render so the post-order
 * traversal can look up children in O(1) instead of re-filtering and
 * re-sorting the whole branch set at every node (issue #28 review).
 */
function buildChildrenMap(branches: GitSpiceBranch[]): Map<string, GitSpiceBranch[]> {
	const childrenMap = new Map<string, GitSpiceBranch[]>();
	for (const branch of branches) {
		if (!branch.down) continue;
		const list = childrenMap.get(branch.down.name) ?? [];
		list.push(branch);
		childrenMap.set(branch.down.name, list);
	}
	for (const list of childrenMap.values()) {
		list.sort((a, b) => a.name.localeCompare(b.name));
	}
	return childrenMap;
}

/**
 * Orders branches using post-order traversal to match `gs ll -a` output.
 * Children appear before (above) their parents, with first sibling's subtree before second's.
 */
function orderStackWithTree(branches: GitSpiceBranch[], branchMap: Map<string, GitSpiceBranch>): BranchWithTree[] {
	const state: TraversalState = { result: [], visited: new Set(), childrenMap: buildChildrenMap(branches) };
	const laneCounter = { value: 0 };
	const roots = findRootBranches(branches, branchMap);

	for (let i = 0; i < roots.length; i++) {
		const ctx = buildRootContext(i, roots.length, laneCounter);
		postOrderTraverse(roots[i], ctx, state);
	}

	return state.result;
}

/** Builds the traversal context for the i-th root branch. */
function buildRootContext(
	siblingIndex: number,
	siblingCount: number,
	laneCounter: { value: number },
): TraversalContext {
	return {
		depth: 0,
		ancestorIsLast: [],
		siblingIndex,
		siblingCount,
		nextLane: laneCounter,
		parentLane: laneCounter.value++,
	};
}

/**
 * Gets the sorted children of a branch via O(1) lookup in the precomputed
 * `childrenMap`.
 *
 * Children are derived from the authoritative `down` (base) links rather
 * than the parent's `ups` list: every non-trunk branch always records its
 * base, whereas a branch's `ups` array can be incomplete, which would drop
 * sibling stacks from the rendered tree (issue #28).
 */
function getChildren(branch: GitSpiceBranch, childrenMap: Map<string, GitSpiceBranch[]>): GitSpiceBranch[] {
	return childrenMap.get(branch.name) ?? [];
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

/** Inputs to {@link createBranchViewModel}, bundled to stay under the param limit. */
type BranchViewModelInput = {
	branch: GitSpiceBranch;
	tree: TreePosition;
	treeFragment: TreeFragmentData;
	mark: IntegrationMarkContext;
	collapsible: boolean;
};

/** Creates a branch view model from branch data and tree information. */
function createBranchViewModel(input: BranchViewModelInput): BranchViewModel {
	const { branch, tree, treeFragment, mark, collapsible } = input;
	return {
		name: branch.name,
		current: branch.current === true,
		restack: needsRestack(branch),
		tree,
		treeFragment,
		change: branch.change ? toChangeViewModel(branch.change) : undefined,
		commits: mapCommitsToViewModel(branch.commits),
		outOfIntegration: computeOutOfIntegration(branch, mark),
		collapsible: collapsible || undefined,
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
