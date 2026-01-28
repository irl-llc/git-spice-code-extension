import type { GitSpiceBranch, GitSpiceChangeStatus } from '../gitSpiceSchema';

export type BranchRecord = GitSpiceBranch;

export type BranchCommitViewModel = {
	sha: string;
	shortSha: string;
	subject: string;
};

/** Git file change status indicator. */
export type FileChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T';

/** Represents a single file change within a commit. */
export type CommitFileChange = {
	status: FileChangeStatus;
	path: string;
	/** Original path for renames/copies. */
	oldPath?: string;
};

export type BranchChangeViewModel = {
	id: string;
	url?: string;
	status?: GitSpiceChangeStatus;
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

export type BranchViewModel = {
	name: string;
	current: boolean;
	restack: boolean;
	change?: BranchChangeViewModel;
	commits?: BranchCommitViewModel[];
	tree: TreePosition;
};

export type DisplayState = {
	branches: BranchViewModel[];
	error?: string;
};
