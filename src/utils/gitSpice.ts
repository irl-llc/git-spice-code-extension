import { execFile, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import * as vscode from 'vscode';

import { BRANCH_CREATE_TIMEOUT_MS, GIT_SPICE_TIMEOUT_MS } from '../constants';
import { parseGitSpiceBranches, type GitSpiceBranch } from '../gitSpiceSchema';
import { formatError, toErrorMessage } from './error';

const execFileAsync = promisify(execFile);
const GIT_SPICE_BINARY = 'gs';

type NormalizedString = { value: string } | { error: string };
type GitSpiceArgs = ReadonlyArray<string>;

export type BranchLoadResult = { value: GitSpiceBranch[] } | { error: string };
export type BranchCommandResult = { value: void } | { error: string };
export type RepoSyncResult = { value: { deletedBranches: string[]; syncedBranches: number } } | { error: string };

/** Minimal folder shape required by execGitSpice. WorkspaceFolder satisfies this. */
export type FolderUri = { uri: vscode.Uri };

function getWorkspaceFolderPath(folder: FolderUri): string | null {
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
	timeout: number = GIT_SPICE_TIMEOUT_MS,
): Promise<BranchCommandResult> {
	const cwd = getWorkspaceFolderPath(folder);
	if (!cwd) {
		return { error: formatError(context, 'Workspace folder path is unavailable') };
	}
	try {
		await execFileAsync(GIT_SPICE_BINARY, args, { cwd, timeout });
		return { value: undefined };
	} catch (error) {
		return { error: formatError(context, toErrorMessage(error)) };
	}
}

export async function execGitSpice(folder: FolderUri): Promise<BranchLoadResult> {
	const context = 'Load branches';
	try {
		const cwd = getWorkspaceFolderPath(folder);
		if (!cwd) {
			return { error: formatError(context, 'Workspace folder path is unavailable') };
		}

		const showComments = vscode.workspace.getConfiguration('git-spice').get<boolean>('showCommentProgress', false);
		const args = showComments ? ['ll', '-a', '-c', '--json'] : ['ll', '-a', '--json'];

		const { stdout } = await execFileAsync(GIT_SPICE_BINARY, args, { cwd });
		return { value: parseGitSpiceBranches(stdout) };
	} catch (error) {
		return { error: formatError(context, toErrorMessage(error)) };
	}
}

export async function execBranchTrack(
	folder: vscode.WorkspaceFolder,
	branchName: string,
	baseBranch: string,
): Promise<BranchCommandResult> {
	const context = 'Branch track';
	const validated = validateInputs([
		[branchName, 'Branch name'],
		[baseBranch, 'Base branch'],
	], context);
	if ('error' in validated) {
		return { error: formatError(context, validated.error) };
	}
	return runGitSpiceCommand(folder, ['branch', 'track', '--base', baseBranch.trim(), branchName.trim()], context);
}

export async function execBranchUntrack(
	folder: vscode.WorkspaceFolder,
	branchName: string,
): Promise<BranchCommandResult> {
	const context = 'Branch untrack';
	const normalized = normalizeNonEmpty(branchName, 'Branch name');
	if ('error' in normalized) {
		return { error: formatError(context, normalized.error) };
	}
	return runGitSpiceCommand(folder, ['branch', 'untrack', normalized.value], context);
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

/** Validates multiple string inputs, returning all normalized values or the first error. */
function validateInputs(inputs: [string, string][], context: string): { values: string[] } | { error: string } {
	const values: string[] = [];
	for (const [value, field] of inputs) {
		const normalized = normalizeNonEmpty(value, field);
		if ('error' in normalized) return { error: `${context}: ${normalized.error}` };
		values.push(normalized.value);
	}
	return { values };
}

/** Executes branch split with validated inputs. */
export async function execBranchSplit(folder: vscode.WorkspaceFolder, branchName: string, sha: string, newBranchName: string): Promise<BranchCommandResult> {
	const validated = validateInputs([
		[branchName, 'Branch name'],
		[sha, 'Commit SHA'],
		[newBranchName, 'New branch name'],
	], 'Branch split');
	if ('error' in validated) return validated;

	const [branch, commitSha, newBranch] = validated.values;
	const atValue = `${commitSha}^:${newBranch}`;
	return runGitSpiceCommand(folder, ['branch', 'split', '--branch', branch, '--at', atValue], 'Branch split');
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

/** Parses the number of synced branches from git-spice output. */
function parseSyncedBranchCount(output: string): number {
	const match = output.match(/(\d+) branch(?:es)? synced/i);
	return match ? Number.parseInt(match[1], 10) : 0;
}

/** Extracts branch name from a deletion prompt if present. */
function extractBranchFromPrompt(text: string): string | undefined {
	const match = text.match(/Delete branch '([^']+)'\? \[y\/N\]/i);
	return match?.[1];
}

/** State for tracking repo sync process. */
interface SyncProcessState {
	deletedBranches: string[];
	outputBuffer: string;
	errorBuffer: string;
	isResolved: boolean;
}

/** Creates handlers for the repo sync process events. */
function createSyncProcessHandlers(
	state: SyncProcessState,
	process: ReturnType<typeof spawn>,
	promptCallback: (branchName: string) => Promise<boolean>,
	resolveOnce: (result: RepoSyncResult) => void,
	timeout: NodeJS.Timeout,
): void {
	// stdio: ['pipe', 'pipe', 'pipe'] guarantees these are non-null
	process.stdout!.on('data', (data: Buffer) => {
		state.outputBuffer += data.toString();
		// Check accumulated buffer to handle prompts split across chunks.
		// Consume the matched portion so repeated data events don't re-trigger.
		const branchName = extractBranchFromPrompt(state.outputBuffer);
		if (branchName) {
			state.outputBuffer = state.outputBuffer.replace(/Delete branch '[^']+'\? \[y\/N\]/i, '');
			handleBranchDeletePrompt(branchName, process, state.deletedBranches, promptCallback);
		}
	});

	process.stderr!.on('data', (data: Buffer) => {
		state.errorBuffer += data.toString();
	});

	process.on('close', (code) => {
		clearTimeout(timeout);
		if (code === 0) {
			resolveOnce({ value: { deletedBranches: state.deletedBranches, syncedBranches: parseSyncedBranchCount(state.outputBuffer) } });
		} else {
			const errorMessage = state.errorBuffer.trim() || state.outputBuffer.trim() || `Process exited with code ${code}`;
			resolveOnce({ error: `Repository sync failed: ${errorMessage}` });
		}
	});

	process.on('error', (error) => {
		clearTimeout(timeout);
		resolveOnce({ error: `Failed to execute gs repo sync: ${toErrorMessage(error)}` });
	});
}

/** Handles a branch deletion prompt by asking the user. */
function handleBranchDeletePrompt(
	branchName: string,
	process: ReturnType<typeof spawn>,
	deletedBranches: string[],
	promptCallback: (branchName: string) => Promise<boolean>,
): void {
	void (async () => {
		try {
			const shouldDelete = await promptCallback(branchName);
			process.stdin!.write(shouldDelete ? 'y\n' : 'n\n');
			if (shouldDelete) deletedBranches.push(branchName);
		} catch {
			process.stdin!.write('n\n');
		}
	})();
}

/** Executes `gs repo sync` with interactive prompts for branch deletion. */
export async function execRepoSync(folder: vscode.WorkspaceFolder, promptCallback: (branchName: string) => Promise<boolean>): Promise<RepoSyncResult> {
	const cwd = getWorkspaceFolderPath(folder);
	if (!cwd) return { error: 'Invalid workspace folder provided' };

	return new Promise<RepoSyncResult>((resolve) => {
		const state: SyncProcessState = { deletedBranches: [], outputBuffer: '', errorBuffer: '', isResolved: false };
		const resolveOnce = (result: RepoSyncResult): void => {
			if (!state.isResolved) {
				state.isResolved = true;
				resolve(result);
			}
		};

		const process = spawn(GIT_SPICE_BINARY, ['repo', 'sync'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
		const timeout = setTimeout(() => {
			process.kill();
			resolveOnce({ error: 'Repository sync timed out after 30 seconds' });
		}, GIT_SPICE_TIMEOUT_MS);

		createSyncProcessHandlers(state, process, promptCallback, resolveOnce, timeout);
	});
}
