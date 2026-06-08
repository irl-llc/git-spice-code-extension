import { execFile, spawn } from 'node:child_process';
import { normalize as pathNormalize, isAbsolute as pathIsAbsolute, resolve as pathResolve } from 'node:path';
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
 * Resolves the real working-tree root for `candidatePath`.
 *
 * The VS Code Git extension can hand us a `rootUri` that, for a *linked
 * worktree of a bare repository*, resolves into the bare repo's git-dir
 * rather than the worktree's checked-out working directory. Running `gs`/`git`
 * with that path as cwd makes git treat the invocation as happening in a bare
 * repo and fail with `exit 128` (e.g. `git remote` →
 * `cannot use bare repository`), even though the CLI works fine inside the
 * worktree.
 *
 * `git -C <candidate> rev-parse --show-toplevel` reports the working-tree root
 * exactly as the CLI sees it from that directory, transparently following a
 * `.git` *file* into a worktree gitdir. We run gs/git there so the extension
 * behaves identically to the command line.
 *
 * Falls back to the original path when git cannot resolve a working tree
 * (not a repo, or a bare git-dir with no work tree) so non-worktree repos and
 * error reporting are unaffected.
 *
 * @param candidatePath - Path reported by repo discovery (the workspace folder)
 * @returns The absolute working-tree root, or `candidatePath` on any failure
 */
export async function resolveWorkingTreeRoot(candidatePath: string): Promise<string> {
	try {
		const { stdout } = await execGit(candidatePath, ['rev-parse', '--show-toplevel']);
		const toplevel = stdout.trim();
		// git emits forward slashes; normalize so the cwd matches Node path APIs on Windows.
		return toplevel.length > 0 ? pathNormalize(toplevel) : candidatePath;
	} catch {
		return candidatePath;
	}
}

/** Absolute git directories for a working tree. */
export interface GitDirs {
	/** Per-worktree git-dir (holds HEAD, index). For a non-worktree repo this equals {@link commonDir}. */
	gitDir: string;
	/** Shared common dir (holds refs/heads, refs/spice/data). */
	commonDir: string;
}

/**
 * Resolves the per-worktree and common git directories for `cwd`.
 *
 * For a linked worktree these differ: HEAD/index live in the per-worktree
 * git-dir (`…/worktrees/<name>`) while refs (including `refs/spice/data`) live
 * in the shared common dir (the bare repo). Watching `<root>/.git` directly is
 * wrong for a worktree because `.git` there is a *file*, not a directory — so
 * branch/HEAD changes go unnoticed. Resolving the real dirs lets the watcher
 * observe both.
 *
 * Returns null when `cwd` is not inside a git repository.
 */
export async function resolveGitDirs(cwd: string): Promise<GitDirs | null> {
	try {
		const { stdout } = await execGit(cwd, ['rev-parse', '--absolute-git-dir', '--git-common-dir']);
		const [gitDirRaw, commonDirRaw] = stdout.trim().split('\n');
		if (!gitDirRaw) return null;
		// git emits forward slashes; normalize so equal dirs compare equal on Windows.
		const gitDir = pathNormalize(gitDirRaw);
		return { gitDir, commonDir: resolveCommonDir(cwd, gitDir, commonDirRaw) };
	} catch {
		return null;
	}
}

/**
 * Resolves the `--git-common-dir` output to an absolute, normalized path. git
 * may emit it relative to `cwd` (e.g. `.git` for a normal repo); resolve such
 * paths against `cwd` rather than falling back to `gitDir`, which is wrong for a
 * linked worktree (its common dir lives in the shared/bare repo, not the
 * per-worktree git-dir).
 */
function resolveCommonDir(cwd: string, gitDir: string, raw: string | undefined): string {
	if (!raw) return gitDir;
	return pathIsAbsolute(raw) ? pathNormalize(raw) : pathResolve(cwd, raw);
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
