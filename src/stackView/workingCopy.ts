import * as fs from 'node:fs/promises';
import * as path from 'node:path';
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

/** Fetches the name of the currently checked-out git branch. */
export async function fetchCurrentBranchName(cwd: string | undefined): Promise<string | undefined> {
	if (!cwd) return undefined;
	try {
		const { stdout } = await execGit(cwd, ['branch', '--show-current']);
		const name = stdout.trim();
		return name || undefined;
	} catch (err) {
		console.error('Failed to fetch current branch name:', err);
		return undefined;
	}
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

/**
 * Discards changes to a file.
 * For tracked files: uses git restore.
 * For untracked files: deletes the file directly.
 */
export async function discardFile(cwd: string, filePath: string): Promise<void> {
	const isUntracked = await checkIfUntracked(cwd, filePath);

	if (isUntracked) {
		await deleteUntracked(cwd, filePath);
	} else {
		await execGit(cwd, ['restore', '--', filePath]);
	}
}

/**
 * Checks if a file is untracked (not in git index) by using `git ls-files --others`.
 * Unlike plain `git ls-files`, this correctly returns false for files staged for deletion.
 */
async function checkIfUntracked(cwd: string, filePath: string): Promise<boolean> {
	const { stdout } = await execGit(cwd, ['ls-files', '--others', '--', filePath]);
	return stdout.trim() !== '';
}

/** Deletes an untracked file. */
async function deleteUntracked(cwd: string, filePath: string): Promise<void> {
	const absolutePath = path.join(cwd, filePath);
	await fs.unlink(absolutePath);
}

/** Stages all changes via git add -A. */
export async function stageAllFiles(cwd: string): Promise<void> {
	await execGit(cwd, ['add', '-A']);
}

/** Commits staged changes with the given message. */
export async function commitChanges(cwd: string, message: string): Promise<void> {
	await execGit(cwd, ['commit', '-m', message]);
}
