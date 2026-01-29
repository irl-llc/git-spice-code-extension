import type { FileChangeStatus, UncommittedState, WorkingCopyChange } from './types';
import { execGit } from '../utils/git';

/** Maps a git status character to a FileChangeStatus. */
export function mapGitStatusChar(char: string): FileChangeStatus {
	const statusMap: Record<string, FileChangeStatus> = {
		A: 'A',
		M: 'M',
		D: 'D',
		R: 'R',
		C: 'C',
		T: 'T',
		'?': 'U',
	};
	return statusMap[char] ?? 'M';
}

/**
 * Parses git status --porcelain output into staged and unstaged changes.
 * Format: XY PATH where X = staged status, Y = unstaged status
 */
export function parseGitStatusOutput(stdout: string): UncommittedState {
	const staged: WorkingCopyChange[] = [];
	const unstaged: WorkingCopyChange[] = [];

	for (const line of stdout.split('\n')) {
		if (line.length < 3) continue;

		const stagedStatus = line[0];
		const unstagedStatus = line[1];
		const filePath = line.slice(3);

		if (stagedStatus !== ' ' && stagedStatus !== '?') {
			staged.push({ path: filePath, status: mapGitStatusChar(stagedStatus) });
		}

		if (unstagedStatus !== ' ') {
			unstaged.push({ path: filePath, status: mapGitStatusChar(unstagedStatus) });
		}
	}

	return { staged, unstaged };
}

/**
 * Fetches the current working copy changes from git.
 * Returns empty state if cwd is not provided.
 */
export async function fetchWorkingCopyChanges(cwd: string | undefined): Promise<UncommittedState> {
	if (!cwd) {
		return { staged: [], unstaged: [] };
	}

	try {
		const { stdout } = await execGit(cwd, ['status', '--porcelain=v1', '--untracked-files=all']);
		return parseGitStatusOutput(stdout);
	} catch (error) {
		console.error('❌ Error fetching working copy changes:', error);
		return { staged: [], unstaged: [] };
	}
}

/** Stages a file using git add. */
export async function stageFile(cwd: string, filePath: string): Promise<void> {
	await execGit(cwd, ['add', '--', filePath]);
}

/** Unstages a file using git restore --staged. */
export async function unstageFile(cwd: string, filePath: string): Promise<void> {
	await execGit(cwd, ['restore', '--staged', '--', filePath]);
}

/** Discards changes to a file using git restore. */
export async function discardFile(cwd: string, filePath: string): Promise<void> {
	await execGit(cwd, ['restore', '--', filePath]);
}

/** Stages all changes via git add -A. */
export async function stageAllFiles(cwd: string): Promise<void> {
	await execGit(cwd, ['add', '-A']);
}

/** Commits staged changes with the given message. */
export async function commitChanges(cwd: string, message: string): Promise<void> {
	await execGit(cwd, ['commit', '-m', message]);
}
