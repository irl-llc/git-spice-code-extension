/**
 * Input/intermediate types for the display-state builder. Split out of state.ts
 * to keep that file within the size budget; consumers import these from state.ts
 * (which re-exports them) or directly from here.
 */

import type { GitSpiceBranch } from '../gitSpiceSchema';
import type { IntegrationState } from '../utils/integrationState';
import type { TreePosition, UncommittedState } from './types';

/** Branch with computed tree position. */
export type BranchWithTree = {
	branch: GitSpiceBranch;
	tree: TreePosition;
};

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
	/**
	 * Name of the branch whose card shows the conflict-resolution-in-progress state
	 * (a rebase/merge is parked mid-operation on it). Undefined when none is.
	 */
	conflictBranch?: string;
};
