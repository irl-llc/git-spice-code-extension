/**
 * Repo state builder — fetches and builds per-repository state.
 * Used by StackViewProvider to populate its repoStates map.
 */

import * as vscode from 'vscode';

import type { GitSpiceBranch } from '../gitSpiceSchema';
import type { DiscoveredRepo } from '../repoDiscovery';
import type { UncommittedState } from './types';
import { execGitSpice } from '../utils/gitSpice';
import { fetchCurrentBranchName, fetchWorkingCopyChanges } from './workingCopy';

/** Per-repository cached state. */
export interface RepoState {
	rootPath: string;
	name: string;
	rootUri: vscode.Uri;
	branches: GitSpiceBranch[];
	uncommitted: UncommittedState | undefined;
	error: string | undefined;
	/** Name of the current branch if it is not tracked by git-spice. */
	untrackedBranch: string | undefined;
}

/** Result from execGitSpice — either branches or an error. */
type BranchResult = { value: GitSpiceBranch[] } | { error: string };

/** Fetches branch + working-copy data for a single discovered repo. */
export async function fetchRepoState(repo: DiscoveredRepo): Promise<RepoState> {
	const folder = toWorkspaceFolder(repo);
	const cwd = repo.rootUri.fsPath;
	const [branchResult, uncommitted, currentBranch] = await Promise.all([
		execGitSpice(folder),
		fetchWorkingCopyChanges(cwd),
		fetchCurrentBranchName(cwd),
	]);
	return buildRepoState(repo.rootUri, repo.name, branchResult, uncommitted, currentBranch);
}

/** Fetches branch + working-copy data for a single workspace folder. */
export async function fetchFolderState(folder: vscode.WorkspaceFolder): Promise<RepoState> {
	const cwd = folder.uri.fsPath;
	const [branchResult, uncommitted, currentBranch] = await Promise.all([
		execGitSpice(folder),
		fetchWorkingCopyChanges(cwd),
		fetchCurrentBranchName(cwd),
	]);
	return buildRepoState(folder.uri, folder.name, branchResult, uncommitted, currentBranch);
}

/** Converts DiscoveredRepo to a WorkspaceFolder shape for git-spice CLI. */
function toWorkspaceFolder(repo: DiscoveredRepo): vscode.WorkspaceFolder {
	return { uri: repo.rootUri, name: repo.name, index: 0 };
}

/** Checks whether any branch in the result is marked as the current branch. */
function hasCurrentBranch(branches: GitSpiceBranch[]): boolean {
	return branches.some((b) => b.current === true);
}

/** Builds a RepoState from URI, name, and fetch results. */
function buildRepoState(
	rootUri: vscode.Uri,
	name: string,
	result: BranchResult,
	uncommitted: UncommittedState,
	currentBranch?: string,
): RepoState {
	if ('error' in result) {
		return { rootPath: rootUri.fsPath, name, rootUri, branches: [], uncommitted, error: result.error, untrackedBranch: currentBranch };
	}
	const untracked = currentBranch && !hasCurrentBranch(result.value) ? currentBranch : undefined;
	return { rootPath: rootUri.fsPath, name, rootUri, branches: result.value, uncommitted, error: undefined, untrackedBranch: untracked };
}
