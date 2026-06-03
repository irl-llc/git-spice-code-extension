import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import * as vscode from 'vscode';

import { BRANCH_CREATE_TIMEOUT_MS, GIT_SPICE_PROBE_TIMEOUT_MS, GIT_SPICE_TIMEOUT_MS } from '../constants';
import { parseGitSpiceBranches, parseInlineComments, type GitSpiceBranch, type InlineComment } from '../gitSpiceSchema';
import { formatError, toErrorMessage } from './error';
import { resolveWorkingTreeRoot } from './git';
import { resolveGitSpiceBinary } from './gitSpiceBinary';
import { parseIntegrationSupport } from './integrationSupport';

const execFileAsync = promisify(execFile);

/**
 * Resolves the git-spice executable at call time so changes to the
 * `git-spice.path` setting take effect without reloading the window.
 */
export function getGitSpiceBinary(): string {
	const configured = vscode.workspace.getConfiguration('git-spice').get<string>('path');
	return resolveGitSpiceBinary(configured, process.env.GIT_SPICE_BIN);
}

/**
 * Environment that suppresses optional index locks (e.g. stat-cache refresh).
 * Non-optional locks (writes) are unaffected.
 * Inherited by child git processes spawned by git-spice.
 */
export const NO_OPTIONAL_LOCKS_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };

type NormalizedString = { value: string } | { error: string };
type GitSpiceArgs = ReadonlyArray<string>;

export type BranchLoadResult = { value: GitSpiceBranch[] } | { error: string };
export type BranchCommandResult = { value: void } | { error: string };
export type InlineCommentLoadResult = { value: InlineComment[] } | { error: string };

/** Minimal folder shape required by execGitSpice. WorkspaceFolder satisfies this. */
export type FolderUri = { uri: vscode.Uri };

export function getWorkspaceFolderPath(folder: FolderUri): string | null {
	const fsPath = folder.uri.fsPath;
	return typeof fsPath === 'string' && fsPath.length > 0 ? fsPath : null;
}

/**
 * Resolves the cwd to run gs/git in for `folder`: the real working-tree root.
 *
 * For a linked worktree of a bare repository the discovered folder path can
 * resolve into the bare git-dir; running gs there fails with `exit 128`. We
 * ask git for the working-tree root so gs runs exactly where the CLI would.
 * Returns null when the folder has no usable path.
 */
export async function resolveGitSpiceCwd(folder: FolderUri): Promise<string | null> {
	const fsPath = getWorkspaceFolderPath(folder);
	if (!fsPath) return null;
	return resolveWorkingTreeRoot(fsPath);
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
	const cwd = await resolveGitSpiceCwd(folder);
	if (!cwd) {
		return { error: formatError(context, 'Workspace folder path is unavailable') };
	}
	try {
		await execFileAsync(getGitSpiceBinary(), args, { cwd, timeout, env: NO_OPTIONAL_LOCKS_ENV });
		return { value: undefined };
	} catch (error) {
		return { error: formatError(context, toErrorMessage(error)) };
	}
}

/**
 * Loads the branch listing via `gs ll`. Pass `withForgeStatus` to add `-c -S`,
 * which queries the forge for PR comment counts AND change-request status
 * (open/merged/closed) — a network call. Callers omit it on high-frequency
 * local refreshes and rely on the cached values instead.
 */
export async function execGitSpice(folder: FolderUri, withForgeStatus = false): Promise<BranchLoadResult> {
	const context = 'Load branches';
	try {
		const cwd = await resolveGitSpiceCwd(folder);
		if (!cwd) {
			return { error: formatError(context, 'Workspace folder path is unavailable') };
		}

		const args = withForgeStatus ? ['ll', '-a', '-c', '-S', '--json'] : ['ll', '-a', '--json'];

		const { stdout } = await execFileAsync(getGitSpiceBinary(), args, {
			cwd,
			timeout: GIT_SPICE_TIMEOUT_MS,
			env: NO_OPTIONAL_LOCKS_ENV,
		});
		return { value: parseGitSpiceBranches(stdout) };
	} catch (error) {
		return { error: formatError(context, toErrorMessage(error)) };
	}
}

/**
 * Loads per-comment inline comments for a single branch via
 * `gs branch comment list --branch <name> --json` (NDJSON). This queries the
 * forge over the network, so callers gate it the same way they gate `-c -S`
 * (only when `showRemoteForgeStatus` is on, and never on high-frequency local
 * refreshes). Returns an error string on any failure so a single branch's
 * comment fetch never takes down the whole refresh.
 */
export async function execBranchCommentList(folder: FolderUri, branchName: string): Promise<InlineCommentLoadResult> {
	const context = 'List comments';
	const cwd = getWorkspaceFolderPath(folder);
	if (!cwd) {
		return { error: formatError(context, 'Workspace folder path is unavailable') };
	}
	const args = ['branch', 'comment', 'list', '--branch', branchName, '--json'];
	try {
		const { stdout } = await execFileAsync(getGitSpiceBinary(), args, {
			cwd,
			timeout: GIT_SPICE_TIMEOUT_MS,
			env: NO_OPTIONAL_LOCKS_ENV,
		});
		return { value: parseInlineComments(stdout) };
	} catch (error) {
		return { error: formatError(context, toErrorMessage(error)) };
	}
}

/**
 * Detects whether the resolved git-spice binary supports the beta
 * integration-branch feature by probing `gs --help`. Returns false (feature
 * absent) on any failure — a missing binary, a stock build, or a probe error —
 * so the extension degrades cleanly rather than surfacing integration UI it
 * cannot drive.
 */
export async function execGitSpiceSupportsIntegration(folder: FolderUri): Promise<boolean> {
	const cwd = await resolveGitSpiceCwd(folder);
	if (!cwd) {
		return false;
	}
	try {
		const { stdout } = await execFileAsync(getGitSpiceBinary(), ['--help'], {
			cwd,
			timeout: GIT_SPICE_PROBE_TIMEOUT_MS,
			env: NO_OPTIONAL_LOCKS_ENV,
		});
		return parseIntegrationSupport(stdout);
	} catch {
		return false;
	}
}
export async function execBranchTrack(
	folder: vscode.WorkspaceFolder,
	branchName: string,
	baseBranch: string,
): Promise<BranchCommandResult> {
	const context = 'Branch track';
	const validated = validateInputs(
		[
			[branchName, 'Branch name'],
			[baseBranch, 'Base branch'],
		],
		context,
	);
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
	return runGitSpiceCommand(folder, ['branch', 'submit', '--fill', '--branch', normalized.value], 'Branch submit');
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
export async function execBranchSplit(
	folder: vscode.WorkspaceFolder,
	branchName: string,
	sha: string,
	newBranchName: string,
): Promise<BranchCommandResult> {
	const validated = validateInputs(
		[
			[branchName, 'Branch name'],
			[sha, 'Commit SHA'],
			[newBranchName, 'New branch name'],
		],
		'Branch split',
	);
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
