/**
 * Exec wrappers for the beta integration-branch feature (ed-irl/git-spice).
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
import { getGitSpiceBinary, getWorkspaceFolderPath, NO_OPTIONAL_LOCKS_ENV, type FolderUri } from './gitSpice';
import { parseIntegrationState, type IntegrationState } from './integrationState';

const execFileAsync = promisify(execFile);

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
