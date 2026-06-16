import type { GitSpiceChangeStatus, GitSpiceComments } from '../gitSpiceSchema';

export type BranchCommitViewModel = {
	sha: string;
	shortSha: string;
	subject: string;
};

/** Git file change status indicator. */
export type FileChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U';

/** Represents a single file change within a commit. */
export type CommitFileChange = {
	status: FileChangeStatus;
	path: string;
	/** Original path for renames/copies. */
	oldPath?: string;
};

/** Represents a file change in the working copy (staged or unstaged). */
export type WorkingCopyChange = {
	path: string;
	status: FileChangeStatus;
	/** Original path for renames/copies. */
	oldPath?: string;
};

/** Uncommitted changes state with staged and unstaged files. */
export type UncommittedState = {
	staged: WorkingCopyChange[];
	unstaged: WorkingCopyChange[];
};

export type BranchChangeViewModel = {
	id: string;
	url?: string;
	status?: GitSpiceChangeStatus;
	comments?: GitSpiceComments;
};

/**
 * Menu item for branch context menu QuickPick.
 * Used in the native VSCode QuickPick dialog for branch actions.
 */
export type BranchContextMenuItem = {
	/** Display label with optional codicon prefix (e.g., '$(git-branch) Checkout'). */
	label: string;
	/** Action identifier dispatched to the handler. */
	action: string;
	/** Optional description shown to the right of the label. */
	description?: string;
};

/**
 * Position of a branch within the tree hierarchy.
 * Used to render connector lines between parent/child branches.
 */
export type TreePosition = {
	/** Nesting level (0 = root/trunk) */
	depth: number;
	/** Whether this is the last sibling at its level */
	isLastChild: boolean;
	/** For each ancestor level, whether that ancestor is the last child (used for pass-through lines) */
	ancestorIsLast: boolean[];
	/** Name of parent branch (undefined for root) */
	parentName?: string;
	/** Position among siblings (0-indexed) */
	siblingIndex: number;
	/** Total number of siblings at this level */
	siblingCount: number;
	/** Horizontal lane index for multi-lane tree visualization */
	lane: number;
};

/** State of a single lane segment at a specific row. */
export type LaneSegment = {
	/** Lane continues from the row above. */
	continuesFromAbove: boolean;
	/** Lane continues to the row below. */
	continuesBelow: boolean;
	/** This row's node is on this lane. */
	hasNode: boolean;
	/** Lane segment needs restack styling. */
	needsRestack: boolean;
};

/** Node styling variant for tree visualization. */
export type TreeNodeStyle = 'normal' | 'current' | 'uncommitted' | 'integration' | 'placeholder';

/** Styling information for a child fork connection. */
export type ChildForkStyle = {
	/** Lane number of the forked child. */
	lane: number;
	/** Whether the child needs restack. */
	needsRestack: boolean;
	/** Whether the child is the uncommitted pseudo-branch. */
	isUncommitted: boolean;
};

/**
 * A connector between a node and the integration branch's swimlane — the mirror
 * of the trunk fan-out. `direction: 'down'` is the integration node (top) fanning
 * down into a tip's lane; `direction: 'up'` is a mid-stack tip fanning up into a
 * bypass lane to reach the integration node above it. `needsRebuild` colors the
 * connector marigold (same color as restack).
 */
export type IntegrationFork = {
	/** The lane the connector turns into (the tip's lane, or its bypass lane). */
	lane: number;
	/** 'down' for the integration node→tip; 'up' for a mid-stack tip→bypass lane. */
	direction: 'up' | 'down';
	/** Marigold styling when the integration build needs a rebuild. */
	needsRebuild: boolean;
};

/** Complete tree fragment data for rendering a single row's tree section. */
export type TreeFragmentData = {
	/** State of each lane (index = lane number). */
	lanes: LaneSegment[];
	/** Total number of lanes (for SVG width calculation). */
	maxLane: number;
	/** Lane where this row's node sits. */
	nodeLane: number;
	/** Lane of parent node (for horizontal connector going up), undefined if root. */
	parentLane?: number;
	/** Children that fork to different lanes, with styling info for each. */
	childForkLanes: ChildForkStyle[];
	/** Node styling variant. */
	nodeStyle: TreeNodeStyle;
	/** Node needs restack indicator. */
	nodeNeedsRestack: boolean;
	/**
	 * Integration-branch connectors for this row (the mirror of `childForkLanes`):
	 * downward forks on the integration node, an upward fork on a mid-stack tip.
	 * Empty/omitted when no integration link touches this row.
	 */
	integrationForks?: IntegrationFork[];
};

export type BranchViewModel = {
	name: string;
	current: boolean;
	restack: boolean;
	change?: BranchChangeViewModel;
	commits?: BranchCommitViewModel[];
	tree: TreePosition;
	treeFragment: TreeFragmentData;
	/**
	 * True when an integration branch is configured AND this branch is NOT one
	 * of its tips — i.e. this branch is excluded from the integration build, so
	 * the UI marks it with an "X" indicator. Undefined when no integration
	 * branch is configured (the indicator is suppressed entirely).
	 */
	outOfIntegration?: boolean;
	/**
	 * True when this branch CAN be collapsed (it has descendants and is neither
	 * trunk nor the integration branch). The webview shows a collapse affordance
	 * only on collapsible branches. See {@link CollapsiblePlaceholderViewModel}
	 * for the rendered placeholder once a branch is collapsed.
	 */
	collapsible?: boolean;
};

/**
 * A placeholder row standing in for one or more collapsed subtrees. Collapse
 * state is computed extension-side (the layout authority) during the DFS in
 * `state.ts`; when subtrees are collapsed their rows are omitted and this
 * single placeholder row is emitted in their place. Adjacent collapse states
 * are coalesced into one placeholder (issue #66).
 */
export type CollapsedPlaceholderViewModel = {
	/**
	 * The collapse-root branch names this placeholder stands in for. Clicking the
	 * [+] expands them — each root is removed from the collapsed set. A coalesced
	 * placeholder lists every adjacent collapse root.
	 */
	roots: string[];
	/** Number of distinct collapsed subtrees (collapse roots) this placeholder hides. */
	subtreeCount: number;
	/** Total number of hidden branches across all collapsed subtrees. */
	branchCount: number;
	/** Tree fragment for the placeholder row (a dashed empty lane). */
	treeFragment: TreeFragmentData;
};

/**
 * A single row in the rendered stack: either a real branch or a collapsed
 * placeholder standing in for hidden subtree(s). Discriminated by `kind`.
 */
export type StackRowViewModel =
	| { kind: 'branch'; branch: BranchViewModel }
	| { kind: 'placeholder'; placeholder: CollapsedPlaceholderViewModel };

/**
 * View model for the configured integration branch, rendered as the topmost
 * node of the stack. Derived from the parsed `IntegrationState`; uses
 * "Rebuild" verbiage (the integration build is rebuilt, not restacked).
 */
export type IntegrationViewModel = {
	/** Local integration branch name. */
	name: string;
	/** True when the integration build is stale and needs to be rebuilt. */
	needsRebuild: boolean;
	/** Names of the branches composing the integration tip list, in order. */
	tipNames: string[];
	/** Tree fragment for the integration node row (swimlanes converge up to it). */
	treeFragment: TreeFragmentData;
};

/** Per-repository display state containing all branch and working-copy data. */
export type RepositoryViewModel = {
	/** Unique identifier — the repository root path (rootUri.fsPath). */
	id: string;
	/** Human-readable name (folder basename). */
	name: string;
	/**
	 * View models for ALL tracked branches in DFS order, regardless of collapse
	 * state (collapsed descendants are still present here). Used for repo-wide
	 * derivations such as the graph width. To render the stack respecting the
	 * collapsed set, iterate {@link rows} instead.
	 */
	branches: BranchViewModel[];
	/**
	 * The rendered stack in display order: the still-visible branches interleaved
	 * with collapse placeholders (collapsed descendants are omitted and replaced
	 * by a single placeholder row). Lets the webview render the stack top-to-bottom
	 * without re-deriving collapse geometry (issue #66).
	 */
	rows: StackRowViewModel[];
	uncommitted?: UncommittedState;
	uncommittedTreeFragment?: TreeFragmentData;
	error?: string;
	/** Name of the current branch when it is not tracked by git-spice. */
	untrackedBranch?: string;
	/** Configured integration branch, rendered atop the stack. Absent when unconfigured/unsupported. */
	integration?: IntegrationViewModel;
};

/** Top-level display state sent to the webview. */
export type DisplayState = {
	repositories: RepositoryViewModel[];
};
