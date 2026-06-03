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
	/** Parsed integration-branch state, when configured and the binary supports it. */
	integration?: IntegrationState | null;
};

/**
 * Builds a single repository's display state from its branch data.
 * Branches are organized in a tree structure based on parent-child relationships.
 */
export function buildRepoDisplayState(input: RepoDisplayInput): RepositoryViewModel {
	// `gs ll -a` lists the integration branch itself (with no base, like a second
	// trunk). It is rendered separately as the integration node, so exclude it
	// from the branch layout — otherwise it becomes a phantom root that shifts
	// every real branch into the wrong lane.
	const integrationName = input.integration?.name;
	const branchList = integrationName ? input.branches.filter((b) => b.name !== integrationName) : input.branches;
	const ordered = orderStackWithTree(branchList, new Map(branchList.map((b) => [b.name, b])));
	const uncommitted = filterEmptyUncommitted(input.uncommitted);
	const treeFragments = buildTreeFragments(ordered, uncommitted);
	const integration = toIntegrationViewModel(input.integration, ordered, treeFragments);

	return {
		id: input.repoId,
		name: input.repoName,
		branches: mapToBranchViewModels(ordered, treeFragments, integration),
		uncommitted,
		uncommittedTreeFragment: uncommitted ? treeFragments.get(UNCOMMITTED_BRANCH_NAME) : undefined,
		error: input.error,
		untrackedBranch: input.untrackedBranch,
		integration,
	};
}

/**
 * Maps a parsed {@link IntegrationState} to the view model, or undefined when
 * no integration branch is configured/supported. Carries the "rebuild"
 * staleness, the tip-branch names (used to mark out-of-integration branches),
 * and the tree fragment for the integration node row.
 */
export function toIntegrationViewModel(
	state: IntegrationState | null | undefined,
	ordered: BranchWithTree[],
	fragments: Map<string, TreeFragmentData>,
): IntegrationViewModel | undefined {
	if (!state) return undefined;
	const tipNames = state.tips.map((tip) => tip.name);
	return {
		name: state.name,
		needsRebuild: state.needsRebuild,
		tipNames,
		treeFragment: applyIntegrationLayout(ordered, fragments, tipNames, state.needsRebuild),
	};
}

/**
 * Lays out the integration branch as the mirror of the trunk, returning the
 * integration node's own fragment and MUTATING the per-branch fragments to add
 * each tip's outgoing link up to it.
 *
 * The trunk node (at the bottom) fans connectors UP into the lane of each root
 * branch; the integration node (at the top) fans connectors DOWN into the lane
 * of each integration TIP. A tip that is the top-most branch in its lane links
 * to integration straight up its own lane; a mid-stack tip — one with a branch
 * above it — is a divergence (its normal child and the integration node are
 * both children) and gets its own **bypass lane**, fanning up out of its node
 * and running past the rows above it. Non-tip non-trunk branches keep their ✕
 * (see {@link computeOutOfIntegration}) and contribute no link.
 */
function applyIntegrationLayout(
	ordered: BranchWithTree[],
	fragments: Map<string, TreeFragmentData>,
	tipNames: string[],
	needsRebuild: boolean,
): TreeFragmentData {
	const origMaxLane = ordered.reduce((m, it) => Math.max(m, it.tree.lane), 0);
	const ctx: IntegLayoutCtx = {
		ordered,
		fragments,
		needsRebuild,
		acc: { nextBypass: origMaxLane + 1, integDownToZero: false, integDownForks: [] },
	};
	linkTipsToIntegration(ctx, new Set(tipNames));

	const newMaxLane = Math.max(origMaxLane, ctx.acc.nextBypass - 1);
	extendFragmentsToMaxLane(ordered, fragments, newMaxLane);
	return buildIntegrationNodeFragment(ctx, newMaxLane);
}

/** Pads every branch fragment's lane array out to the final max lane. */
function extendFragmentsToMaxLane(
	ordered: BranchWithTree[],
	fragments: Map<string, TreeFragmentData>,
	maxLane: number,
): void {
	for (const it of ordered) {
		const frag = fragments.get(it.branch.name)!;
		ensureLane(frag, maxLane);
		frag.maxLane = maxLane;
	}
}

/** Mutable accumulator threaded through the integration layout pass. */
type IntegLayoutAcc = {
	/** Next free lane to allocate as a bypass for a mid-stack tip. */
	nextBypass: number;
	/** A tip links to the integration node straight up lane 0. */
	integDownToZero: boolean;
	/** Down-forks from the integration node into each non-zero tip lane. */
	integDownForks: IntegrationFork[];
};

/** Shared inputs threaded through the integration layout helpers. */
type IntegLayoutCtx = {
	ordered: BranchWithTree[];
	fragments: Map<string, TreeFragmentData>;
	needsRebuild: boolean;
	acc: IntegLayoutAcc;
};

/** Records the first (top-most) row index seen for each lane. */
function topmostRowByLane(ordered: BranchWithTree[]): Map<number, number> {
	const topmost = new Map<number, number>();
	ordered.forEach((it, row) => {
		if (!topmost.has(it.tree.lane)) topmost.set(it.tree.lane, row);
	});
	return topmost;
}

/** Wires each integration tip's outgoing link up to the integration node. */
function linkTipsToIntegration(ctx: IntegLayoutCtx, tipSet: Set<string>): void {
	const topmost = topmostRowByLane(ctx.ordered);
	ctx.ordered.forEach((it, row) => {
		if (!tipSet.has(it.branch.name)) return;
		const lane = it.tree.lane;
		const frag = ctx.fragments.get(it.branch.name)!;
		const integLane = assignTipIntegrationLane(ctx, frag, topmost.get(lane) === row, lane);
		if (integLane === 0) ctx.acc.integDownToZero = true;
		else ctx.acc.integDownForks.push({ lane: integLane, direction: 'down', needsRebuild: ctx.needsRebuild });
		passIntegrationLaneAboveTip(ctx, integLane, row);
	});
}

/**
 * Picks the lane a tip uses to reach the integration node: its own lane when it
 * is top-most there (links straight up), otherwise a fresh bypass lane that fans
 * up out of the node (the mid-stack divergence). Mutates `frag` accordingly.
 */
function assignTipIntegrationLane(
	ctx: IntegLayoutCtx,
	frag: TreeFragmentData,
	isTopmostInLane: boolean,
	lane: number,
): number {
	if (isTopmostInLane) {
		frag.lanes[lane] = {
			...frag.lanes[lane],
			continuesFromAbove: true,
			needsRestack: frag.lanes[lane].needsRestack || ctx.needsRebuild,
		};
		return lane;
	}
	const bypass = ctx.acc.nextBypass++;
	(frag.integrationForks ??= []).push({ lane: bypass, direction: 'up', needsRebuild: ctx.needsRebuild });
	return bypass;
}

/** Marks the integration lane as a pass-through on every row above the tip. */
function passIntegrationLaneAboveTip(ctx: IntegLayoutCtx, integLane: number, tipRow: number): void {
	for (let r = 0; r < tipRow; r++) {
		const above = ctx.fragments.get(ctx.ordered[r].branch.name)!;
		ensureLane(above, integLane);
		above.lanes[integLane] = {
			...above.lanes[integLane],
			continuesFromAbove: true,
			continuesBelow: true,
			needsRestack: above.lanes[integLane].needsRestack || ctx.needsRebuild,
		};
	}
}

/** Builds the lane segments for the integration node's row (only lane 0 holds the node). */
function buildIntegrationLanes(maxLane: number, acc: IntegLayoutAcc, needsRebuild: boolean): LaneSegment[] {
	return Array.from({ length: maxLane + 1 }, (_, l) => {
		const onZero = l === 0;
		return {
			continuesFromAbove: false,
			continuesBelow: onZero && acc.integDownToZero,
			hasNode: onZero,
			needsRestack: onZero && acc.integDownToZero && needsRebuild,
		};
	});
}

/** Builds the integration node's own row fragment (lane-0 node fanning down to tips). */
function buildIntegrationNodeFragment(ctx: IntegLayoutCtx, maxLane: number): TreeFragmentData {
	return {
		lanes: buildIntegrationLanes(maxLane, ctx.acc, ctx.needsRebuild),
		maxLane,
		nodeLane: 0,
		childForkLanes: [],
		nodeStyle: 'integration',
		nodeNeedsRestack: ctx.needsRebuild,
		integrationForks: ctx.acc.integDownForks,
	};
}

/** Extends a fragment's lane array with empty pass-through slots up to `lane`. */
function ensureLane(frag: TreeFragmentData, lane: number): void {
	while (frag.lanes.length <= lane) {
		frag.lanes.push({ continuesFromAbove: false, continuesBelow: false, hasNode: false, needsRestack: false });
	}
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
	integration?: IntegrationViewModel,
): BranchViewModel[] {
	const mark: IntegrationMarkContext = {
		tipSet: integration ? new Set(integration.tipNames) : undefined,
		leafNames: computeLeafNames(ordered),
	};
	return ordered.map((item) => createBranchViewModel(item.branch, item.tree, fragments.get(item.branch.name)!, mark));
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

/** Creates a branch view model from branch data and tree information. */
function createBranchViewModel(
	branch: GitSpiceBranch,
	tree: TreePosition,
	treeFragment: TreeFragmentData,
	mark: IntegrationMarkContext,
): BranchViewModel {
	return {
		name: branch.name,
		current: branch.current === true,
		restack: needsRestack(branch),
		tree,
		treeFragment,
		change: branch.change ? toChangeViewModel(branch.change) : undefined,
		commits: mapCommitsToViewModel(branch.commits),
		outOfIntegration: computeOutOfIntegration(branch, mark),
	};
}

function toChangeViewModel(change: NonNullable<GitSpiceBranch['change']>): BranchChangeViewModel {
	return {
		id: change.id,
		url: change.url,
		status: change.status,
		comments: change.comments,
		inlineComments: change.inlineComments,
	};
}
