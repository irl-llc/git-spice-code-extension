import type { GitSpiceBranch, GitSpiceChangeStatus, GitSpiceComments } from '../gitSpiceSchema';

export type BranchRecord = GitSpiceBranch;

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
export type TreeNodeStyle = 'normal' | 'current' | 'uncommitted';

/** Styling information for a child fork connection. */
export type ChildForkStyle = {
	/** Lane number of the forked child. */
	lane: number;
	/** Whether the child needs restack. */
	needsRestack: boolean;
	/** Whether the child is the uncommitted pseudo-branch. */
	isUncommitted: boolean;
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
};

export type BranchViewModel = {
	name: string;
	current: boolean;
	restack: boolean;
	change?: BranchChangeViewModel;
	commits?: BranchCommitViewModel[];
	tree: TreePosition;
	treeFragment: TreeFragmentData;
};

export type DisplayState = {
	branches: BranchViewModel[];
	uncommitted?: UncommittedState;
	uncommittedTreeFragment?: TreeFragmentData;
	error?: string;
};
