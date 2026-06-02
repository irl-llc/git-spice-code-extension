/**
 * Repo state builder — fetches and builds per-repository state.
 * Used by StackViewProvider to populate its repoStates map.
 */

import * as vscode from 'vscode';

import type { GitSpiceBranch } from '../gitSpiceSchema';
import type { DiscoveredRepo } from '../repoDiscovery';
import type { UncommittedState } from './types';
import { execGitSpice, execGitSpiceSupportsIntegration } from '../utils/gitSpice';
import { execGitSpiceIntegrationState } from '../utils/integrationExec';
import type { IntegrationState } from '../utils/integrationState';
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
	/** Parsed integration-branch state, or null when unconfigured/unsupported. */
	integration: IntegrationState | null;
}

/**
 * Reads the integration-branch state for a folder, gated on binary support so
 * stock git-spice builds never invoke the beta `integration` command. Returns
 * null when unsupported, unconfigured, or on any probe failure.
 */
async function fetchIntegrationState(folder: vscode.WorkspaceFolder): Promise<IntegrationState | null> {
	try {
		if (!(await execGitSpiceSupportsIntegration(folder))) {
			return null;
		}
		return await execGitSpiceIntegrationState(folder);
	} catch {
		// Isolate the beta integration feature: a probe/exec failure must not
		// reject the Promise.all in fetchRepoState/fetchFolderState and take the
		// whole repository state load down with it.
		return null;
	}
}

/** Result from execGitSpice — either branches or an error. */
type BranchResult = { value: GitSpiceBranch[] } | { error: string };

/** Fetches branch + working-copy data for a single discovered repo. */
export async function fetchRepoState(repo: DiscoveredRepo, withComments = false): Promise<RepoState> {
	const folder = toWorkspaceFolder(repo);
	const cwd = repo.rootUri.fsPath;
	const [branchResult, uncommitted, currentBranch, integration] = await Promise.all([
		execGitSpice(folder, withComments),
		fetchWorkingCopyChanges(cwd),
		fetchCurrentBranchName(cwd),
		fetchIntegrationState(folder),
	]);
	return buildRepoState({
		rootUri: repo.rootUri,
		name: repo.name,
		branchResult,
		uncommitted,
		currentBranch,
		integration,
	});
}

/** Fetches branch + working-copy data for a single workspace folder. */
export async function fetchFolderState(folder: vscode.WorkspaceFolder, withComments = false): Promise<RepoState> {
	const cwd = folder.uri.fsPath;
	const [branchResult, uncommitted, currentBranch, integration] = await Promise.all([
		execGitSpice(folder, withComments),
		fetchWorkingCopyChanges(cwd),
		fetchCurrentBranchName(cwd),
		fetchIntegrationState(folder),
	]);
	return buildRepoState({
		rootUri: folder.uri,
		name: folder.name,
		branchResult,
		uncommitted,
		currentBranch,
		integration,
	});
}

/** Converts DiscoveredRepo to a WorkspaceFolder shape for git-spice CLI. */
function toWorkspaceFolder(repo: DiscoveredRepo): vscode.WorkspaceFolder {
	return { uri: repo.rootUri, name: repo.name, index: 0 };
}

/** Checks whether any branch in the result is marked as the current branch. */
function hasCurrentBranch(branches: GitSpiceBranch[]): boolean {
	return branches.some((b) => b.current === true);
}

/** Inputs to {@link buildRepoState}, bundled to stay under the parameter limit. */
type BuildRepoStateInput = {
	rootUri: vscode.Uri;
	name: string;
	branchResult: BranchResult;
	uncommitted: UncommittedState;
	currentBranch?: string;
	integration: IntegrationState | null;
};

/** Builds a RepoState from URI, name, and fetch results. */
function buildRepoState(input: BuildRepoStateInput): RepoState {
	const { rootUri, name, branchResult, uncommitted, currentBranch, integration } = input;
	const base = { rootPath: rootUri.fsPath, name, rootUri, uncommitted, integration };
	if ('error' in branchResult) {
		return { ...base, branches: [], error: branchResult.error, untrackedBranch: currentBranch };
	}
	const untracked = currentBranch && !hasCurrentBranch(branchResult.value) ? currentBranch : undefined;
	return { ...base, branches: branchResult.value, error: undefined, untrackedBranch: untracked };
}
