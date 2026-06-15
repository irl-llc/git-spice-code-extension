/**
 * Exec wrappers for the beta integration-branch feature (abhinav/git-spice).
 *
 * Kept in a dedicated module so the integration read/probe plumbing lives
 * alongside its pure parsers ({@link ./integrationState}, {@link
 * ./integrationSupport}) and does not bloat the general-purpose {@link
 * ./gitSpice} command surface. Shared exec primitives (binary resolution,
 * lock-suppressing env, workspace-path extraction) are imported from
 * {@link ./gitSpice} rather than duplicated.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { GIT_SPICE_TIMEOUT_MS } from '../constants';
import { formatError } from './error';
import {
	getGitSpiceBinary,
	getWorkspaceFolderPath,
	NO_OPTIONAL_LOCKS_ENV,
	type BranchCommandResult,
	type FolderUri,
} from './gitSpice';
import { parseIntegrationState, type IntegrationState } from './integrationState';

const execFileAsync = promisify(execFile);

/**
 * Extracts the cleanest available message from a failed `execFile` rejection.
 *
 * `child_process` rejections are `ExecException`s whose `stderr` carries the
 * tool's own diagnostic, while `message` prepends the full command line and
 * exit status. Prefer `stderr` so users see git-spice's error verbatim rather
 * than a cluttered shell-style line; fall back to `message`/`String()`.
 */
function extractExecErrorMessage(error: unknown): string {
	const stderr = (error as { stderr?: unknown }).stderr;
	if (typeof stderr === 'string' && stderr.trim().length > 0) {
		return stderr.trim();
	}
	return error instanceof Error ? error.message : String(error);
}

/** Adds `branchName` to the integration tip list via `gs integration tip add`. */
export async function execGitSpiceIntegrationTipAdd(
	folder: FolderUri,
	branchName: string,
): Promise<BranchCommandResult> {
	return runIntegrationTipCommand(folder, 'add', branchName, 'Integration tip add');
}

/** Removes `branchName` from the integration tip list via `gs integration tip remove`. */
export async function execGitSpiceIntegrationTipRemove(
	folder: FolderUri,
	branchName: string,
): Promise<BranchCommandResult> {
	return runIntegrationTipCommand(folder, 'remove', branchName, 'Integration tip remove');
}

/** Validated inputs for an integration tip mutation, or a formatted error. */
type TipCommandInputs = { cwd: string; branch: string } | { error: string };

/** Validates the workspace path and branch name before spawning `gs`. */
function validateTipInputs(folder: FolderUri, branchName: string, context: string): TipCommandInputs {
	const cwd = getWorkspaceFolderPath(folder);
	if (!cwd) {
		return { error: formatError(context, 'Workspace folder path is unavailable') };
	}
	const branch = branchName.trim();
	if (branch.length === 0) {
		return { error: formatError(context, 'Branch name cannot be empty') };
	}
	return { cwd, branch };
}

/** Spawns `gs integration tip <verb> <branch>` and maps the outcome. */
async function spawnTipCommand(
	cwd: string,
	verb: 'add' | 'remove',
	branch: string,
	context: string,
): Promise<BranchCommandResult> {
	try {
		await execFileAsync(getGitSpiceBinary(), ['integration', 'tip', verb, branch], {
			cwd,
			timeout: GIT_SPICE_TIMEOUT_MS,
			env: NO_OPTIONAL_LOCKS_ENV,
		});
		return { value: undefined };
	} catch (error) {
		return { error: formatError(context, extractExecErrorMessage(error)) };
	}
}

/** Shared runner for the `gs integration tip <verb> <branch>` mutations. */
async function runIntegrationTipCommand(
	folder: FolderUri,
	verb: 'add' | 'remove',
	branchName: string,
	context: string,
): Promise<BranchCommandResult> {
	const inputs = validateTipInputs(folder, branchName, context);
	if ('error' in inputs) {
		return { error: inputs.error };
	}
	return spawnTipCommand(inputs.cwd, verb, inputs.branch, context);
}

/**
 * Reads the configured integration branch via `gs integration show`. Returns
 * the parsed {@link IntegrationState}, or `null` when no integration branch is
 * configured, the binary lacks the feature, or the probe fails — so callers can
 * treat "no integration" and "cannot read integration" identically and degrade
 * cleanly. Detect feature support first with `execGitSpiceSupportsIntegration`.
 */
export async function execGitSpiceIntegrationState(folder: FolderUri): Promise<IntegrationState | null> {
	const cwd = getWorkspaceFolderPath(folder);
	if (!cwd) {
		return null;
	}
	try {
		const { stdout } = await execFileAsync(getGitSpiceBinary(), ['integration', 'show'], {
			cwd,
			timeout: GIT_SPICE_TIMEOUT_MS,
			env: NO_OPTIONAL_LOCKS_ENV,
		});
		return parseIntegrationState(stdout) ?? null;
	} catch {
		return null;
	}
}
