import { execFile, spawn } from 'node:child_process';
import { normalize as pathNormalize } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Environment that suppresses optional index locks (e.g. stat-cache refresh).
 * Non-optional locks (writes) are unaffected.
 * Prevents lock conflicts when multiple git commands run concurrently.
 */
const NO_OPTIONAL_LOCKS_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };

/**
 * Result of a git command execution.
 */
export interface GitExecResult {
	stdout: string;
	stderr: string;
}

/**
 * Runs a git command in the given working directory.
 *
 * @param cwd - Working directory for git execution
 * @param args - Arguments to pass to git (e.g., ['status', '--porcelain'])
 * @returns The stdout and stderr from git
 */
export async function execGit(cwd: string, args: string[]): Promise<GitExecResult> {
	return execFileAsync('git', args, { cwd, env: NO_OPTIONAL_LOCKS_ENV });
}

/**
 * Runs a git command and returns stdout split into lines (trimmed, empty lines removed).
 *
 * @param cwd - Working directory for git execution
 * @param args - Arguments to pass to git
 * @returns Array of non-empty lines from stdout
 */
export async function execGitLines(cwd: string, args: string[]): Promise<string[]> {
	const { stdout } = await execGit(cwd, args);
	return stdout
		.trim()
		.split('\n')
		.filter((line) => line.length > 0);
}

/**
 * Given the input paths and the NUL-separated stdout of `git check-ignore -z`
 * (which echoes back the ignored subset), returns the input paths that are NOT
 * ignored. Pure — split out from {@link filterIgnoredPaths} for unit testing.
 */
export function parseNonIgnoredPaths(inputPaths: string[], checkIgnoreStdout: string): string[] {
	// Normalize separators so matching is robust if git echoes a different
	// slash style than the input (notably on Windows).
	const ignored = new Set(
		checkIgnoreStdout
			.split('\0')
			.filter((p) => p.length > 0)
			.map((p) => pathNormalize(p)),
	);
	return inputPaths.filter((p) => !ignored.has(pathNormalize(p)));
}

/**
 * Returns the subset of `paths` that are NOT gitignored, per `git check-ignore`.
 * Uses git's exact ignore rules (nested .gitignore, negation, .git/info/exclude,
 * core.excludesFile) so there is no matcher to maintain.
 *
 * `check-ignore` exits 0 when ≥1 path is ignored and 1 when none are — both are
 * normal. On any other failure we fail safe by returning all paths (treat as
 * non-ignored), so a refresh still happens rather than silently dropping events.
 */
export async function filterIgnoredPaths(repoRoot: string, paths: string[]): Promise<string[]> {
	if (paths.length === 0) return [];
	try {
		const stdout = await runCheckIgnore(repoRoot, paths);
		return parseNonIgnoredPaths(paths, stdout);
	} catch {
		return paths;
	}
}

/** Runs `git check-ignore --stdin -z`, feeding `paths` NUL-separated on stdin. */
function runCheckIgnore(repoRoot: string, paths: string[]): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const child = spawn('git', ['check-ignore', '--stdin', '-z'], {
			cwd: repoRoot,
			env: NO_OPTIONAL_LOCKS_ENV,
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
		child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
		child.on('error', reject);
		// Avoid crashing the extension host with EPIPE if git exits before we
		// finish writing the path list to stdin.
		child.stdin.on('error', () => {});
		// Exit 0 = some ignored, 1 = none ignored (both fine); anything else is an error.
		child.on('close', (code) =>
			code === 0 || code === 1 ? resolve(stdout) : reject(new Error(stderr || `git check-ignore exited ${code}`)),
		);
		child.stdin.end(paths.join('\0'));
	});
}
