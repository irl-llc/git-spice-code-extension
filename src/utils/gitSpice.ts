import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { parseGitSpiceBranches, type GitSpiceBranch } from '../gitSpiceSchema';

const execFileAsync = promisify(execFile);
const GIT_SPICE_BINARY = 'gs';
const DEFAULT_TIMEOUT_MS = 30_000;
const BRANCH_CREATE_TIMEOUT_MS = 10_000;

type NormalizedString = { value: string } | { error: string };
type GitSpiceArgs = ReadonlyArray<string>;

export type BranchLoadResult = { value: GitSpiceBranch[] } | { error: string };
export type BranchCommandResult = { value: void } | { error: string };
export type RepoSyncResult = { value: { deletedBranches: string[]; syncedBranches: number } } | { error: string };

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function getWorkspaceFolderPath(folder: vscode.WorkspaceFolder): string | null {
	const fsPath = folder.uri.fsPath;
	return typeof fsPath === 'string' && fsPath.length > 0 ? fsPath : null;
}

function normalizeNonEmpty(value: string, field: string): NormalizedString {
	if (typeof value !== 'string') {
		return { error: `${field} must be a string` };
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return { error: `${field} cannot be empty` };
	}
	return { value: trimmed };
}

async function runGitSpiceCommand(
	folder: vscode.WorkspaceFolder,
	args: GitSpiceArgs,
	context: string,
	timeout: number = DEFAULT_TIMEOUT_MS,
): Promise<BranchCommandResult> {
	const cwd = getWorkspaceFolderPath(folder);
	if (!cwd) {
		return { error: `${context}: Workspace folder path is unavailable.` };
	}
	try {
		await execFileAsync(GIT_SPICE_BINARY, args, { cwd, timeout });
		return { value: undefined };
	} catch (error) {
		return { error: `${context}: ${toErrorMessage(error)}` };
	}
}

export async function execGitSpice(folder: vscode.WorkspaceFolder): Promise<BranchLoadResult> {
	try {
		const cwd = getWorkspaceFolderPath(folder);
		if (!cwd) {
			return { error: 'Failed to load git-spice branches: Workspace folder path is unavailable.' };
		}

		const showComments = vscode.workspace.getConfiguration('git-spice').get<boolean>('showCommentProgress', false);
		const args = showComments ? ['ll', '-a', '-c', '--json'] : ['ll', '-a', '--json'];

		const { stdout } = await execFileAsync(GIT_SPICE_BINARY, args, { cwd });
		return { value: parseGitSpiceBranches(stdout) };
	} catch (error) {
		return { error: `Failed to load git-spice branches: ${toErrorMessage(error)}` };
	}
}

export async function execBranchUntrack(
	folder: vscode.WorkspaceFolder,
	branchName: string,
): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch untrack: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['branch', 'untrack', normalized.value], 'Branch untrack');
}

/**
 * Deletes a branch using `gs branch delete`.
 * This untracks the branch and deletes the local git branch.
 */
export async function execBranchDelete(
	folder: vscode.WorkspaceFolder,
	branchName: string,
): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch delete: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['branch', 'delete', '--force', normalized.value], 'Branch delete');
}

export async function execBranchCheckout(
	folder: vscode.WorkspaceFolder,
	branchName: string,
): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch checkout: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['branch', 'checkout', normalized.value], 'Branch checkout');
}

export async function execBranchFold(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch fold: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['branch', 'fold', '--branch', normalized.value], 'Branch fold');
}

export async function execBranchSquash(
	folder: vscode.WorkspaceFolder,
	branchName: string,
): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch squash: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['branch', 'squash', '--branch', normalized.value, '--no-edit'], 'Branch squash');
}

export async function execBranchEdit(folder: vscode.WorkspaceFolder, branchName: string): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch edit: ${normalized.error}` };
	}
	const result = await runGitSpiceCommand(folder, ['branch', 'edit'], 'Branch edit');
	if ('error' in result) {
		return result;
	}
	return { value: undefined };
}

export async function execBranchRename(
	folder: vscode.WorkspaceFolder,
	branchName: string,
	newName: string,
): Promise<BranchCommandResult> {
	const normalizedBranch = normalizeNonEmpty(branchName, 'Current branch name');
	if ('error' in normalizedBranch) {
		return { error: `Branch rename: ${normalizedBranch.error}` };
	}
	const normalizedNewName = normalizeNonEmpty(newName, 'New branch name');
	if ('error' in normalizedNewName) {
		return { error: `Branch rename: ${normalizedNewName.error}` };
	}
	return runGitSpiceCommand(
		folder,
		['branch', 'rename', normalizedBranch.value, normalizedNewName.value],
		'Branch rename',
	);
}

export async function execBranchRestack(
	folder: vscode.WorkspaceFolder,
	branchName: string,
): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch restack: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['branch', 'restack', '--branch', normalized.value], 'Branch restack');
}

export async function execBranchSubmit(
	folder: vscode.WorkspaceFolder,
	branchName: string,
): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: `Branch submit: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['branch', 'submit', '--branch', normalized.value], 'Branch submit');
}

export async function execBranchCreate(folder: vscode.WorkspaceFolder, message: string): Promise<BranchCommandResult> {
	const normalizedMessage = normalizeNonEmpty(message, 'Commit message');
	if ('error' in normalizedMessage) {
		return { error: `Branch create: ${normalizedMessage.error}` };
	}
	return runGitSpiceCommand(
		folder,
		['branch', 'create', '-m', normalizedMessage.value, '-a', '--no-prompt', '--no-verify'],
		'Branch create',
		BRANCH_CREATE_TIMEOUT_MS,
	);
}

export async function execCommitFixup(folder: vscode.WorkspaceFolder, sha: string): Promise<BranchCommandResult> {
	const normalized = normalizeNonEmpty(sha, 'Commit SHA');
	if ('error' in normalized) {
		return { error: `Commit fixup: ${normalized.error}` };
	}
	return runGitSpiceCommand(folder, ['commit', 'fixup', normalized.value], 'Commit fixup');
}

export async function execBranchSplit(
	folder: vscode.WorkspaceFolder,
	branchName: string,
	sha: string,
	newBranchName: string,
): Promise<BranchCommandResult> {
	const normalizedBranch = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalizedBranch) {
		return { error: `Branch split: ${normalizedBranch.error}` };
	}
	const normalizedSha = normalizeNonEmpty(sha, 'Commit SHA');
	if ('error' in normalizedSha) {
		return { error: `Branch split: ${normalizedSha.error}` };
	}
	const normalizedNewBranch = normalizeNonEmpty(newBranchName, 'New branch name');
	if ('error' in normalizedNewBranch) {
		return { error: `Branch split: ${normalizedNewBranch.error}` };
	}
	// Format: --at COMMIT:NAME as required by git-spice
	// Use COMMIT^ to split before the selected commit, so the commit is included in the new branch
	const atValue = `${normalizedSha.value}^:${normalizedNewBranch.value}`;
	return runGitSpiceCommand(
		folder,
		['branch', 'split', '--branch', normalizedBranch.value, '--at', atValue],
		'Branch split',
	);
}

/**
 * Moves a branch to a new parent using `gs branch onto`.
 * This changes the base branch without rebasing commits.
 * Only moves the specified branch; children remain where they are.
 */
export async function execBranchMove(
	folder: vscode.WorkspaceFolder,
	branchName: string,
	newParent: string,
): Promise<BranchCommandResult> {
	const normalizedBranch = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalizedBranch) {
		return { error: `Branch move: ${normalizedBranch.error}` };
	}
	const normalizedParent = normalizeNonEmpty(newParent, 'New parent name');
	if ('error' in normalizedParent) {
		return { error: `Branch move: ${normalizedParent.error}` };
	}
	return runGitSpiceCommand(
		folder,
		['branch', 'onto', normalizedParent.value, '--branch', normalizedBranch.value],
		'Branch move',
	);
}

/**
 * Moves a branch and all its descendants to a new parent using `gs upstack onto`.
 * This rebases the entire upstack (branch + children) onto the new parent.
 */
export async function execUpstackMove(
	folder: vscode.WorkspaceFolder,
	branchName: string,
	newParent: string,
): Promise<BranchCommandResult> {
	const normalizedBranch = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalizedBranch) {
		return { error: `Upstack move: ${normalizedBranch.error}` };
	}
	const normalizedParent = normalizeNonEmpty(newParent, 'New parent name');
	if ('error' in normalizedParent) {
		return { error: `Upstack move: ${normalizedParent.error}` };
	}
	return runGitSpiceCommand(
		folder,
		['upstack', 'onto', normalizedParent.value, '--branch', normalizedBranch.value],
		'Upstack move',
	);
}

/**
 * Navigation commands - simple wrappers around git-spice navigation
 */

export async function execUp(folder: vscode.WorkspaceFolder): Promise<BranchCommandResult> {
	return runGitSpiceCommand(folder, ['up'], 'Navigate up');
}

export async function execDown(folder: vscode.WorkspaceFolder): Promise<BranchCommandResult> {
	return runGitSpiceCommand(folder, ['down'], 'Navigate down');
}

export async function execTrunk(folder: vscode.WorkspaceFolder): Promise<BranchCommandResult> {
	return runGitSpiceCommand(folder, ['trunk'], 'Navigate to trunk');
}

export async function execStackRestack(folder: vscode.WorkspaceFolder): Promise<BranchCommandResult> {
	return runGitSpiceCommand(folder, ['stack', 'restack'], 'Stack restack');
}

export async function execStackSubmit(folder: vscode.WorkspaceFolder): Promise<BranchCommandResult> {
	return runGitSpiceCommand(folder, ['stack', 'submit', '--fill', '--no-draft'], 'Stack submit');
}

/**
 * Executes `gs repo sync` with interactive prompts for branch deletion.
 * When git-spice prompts to delete branches (due to closed PRs), shows VSCode prompts
 * to the user and handles their responses.
 *
 * @param folder - The workspace folder where the command should be executed
 * @param promptCallback - Async callback to prompt the user for confirmation
 * @returns A promise that resolves with sync results or an error
 */
export async function execRepoSync(
	folder: vscode.WorkspaceFolder,
	promptCallback: (branchName: string) => Promise<boolean>,
): Promise<RepoSyncResult> {
	const cwd = getWorkspaceFolderPath(folder);
	if (!cwd) {
		return { error: 'Invalid workspace folder provided' };
	}

	return new Promise<RepoSyncResult>((resolve) => {
		const deletedBranches: string[] = [];
		let outputBuffer = '';
		let errorBuffer = '';

		// Spawn the process with stdio access
		const process = spawn(GIT_SPICE_BINARY, ['repo', 'sync'], {
			cwd,
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		let isResolved = false;
		const resolveOnce = (result: RepoSyncResult): void => {
			if (!isResolved) {
				isResolved = true;
				resolve(result);
			}
		};

		// Set timeout
		const timeout = setTimeout(() => {
			process.kill();
			resolveOnce({ error: 'Repository sync timed out after 30 seconds' });
		}, DEFAULT_TIMEOUT_MS);

		// Handle stdout data
		process.stdout.on('data', (data: Buffer) => {
			const text = data.toString();
			outputBuffer += text;

			// Look for branch deletion prompts in the output
			// git-spice typically outputs: "Delete branch 'branch-name'? [y/N]"
			const promptMatch = text.match(/Delete branch '([^']+)'\? \[y\/N\]/i);
			if (promptMatch) {
				const branchName = promptMatch[1];

				// Asynchronously prompt the user and send response
				void (async () => {
					try {
						const shouldDelete = await promptCallback(branchName);
						const response = shouldDelete ? 'y\n' : 'n\n';
						process.stdin.write(response);

						if (shouldDelete) {
							deletedBranches.push(branchName);
						}
					} catch (error) {
						// If user cancels or there's an error, default to 'n'
						process.stdin.write('n\n');
					}
				})();
			}
		});

		// Handle stderr data
		process.stderr.on('data', (data: Buffer) => {
			errorBuffer += data.toString();
		});

		// Handle process exit
		process.on('close', (code) => {
			clearTimeout(timeout);

			if (code === 0) {
				// Success - parse output to count synced branches
				const syncedBranchesMatch = outputBuffer.match(/(\d+) branch(?:es)? synced/i);
				const syncedBranches = syncedBranchesMatch ? Number.parseInt(syncedBranchesMatch[1], 10) : 0;

				resolveOnce({
					value: {
						deletedBranches,
						syncedBranches,
					},
				});
			} else {
				const errorMessage = errorBuffer.trim() || outputBuffer.trim() || `Process exited with code ${code}`;
				resolveOnce({ error: `Repository sync failed: ${errorMessage}` });
			}
		});

		// Handle process errors
		process.on('error', (error) => {
			clearTimeout(timeout);
			resolveOnce({ error: `Failed to execute gs repo sync: ${toErrorMessage(error)}` });
		});
	});
}
