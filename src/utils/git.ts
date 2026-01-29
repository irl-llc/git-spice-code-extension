import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
	return execFileAsync('git', args, { cwd });
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
