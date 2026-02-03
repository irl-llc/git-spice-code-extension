import type { CommitFileChange, FileChangeStatus } from './types';
import { execGit } from '../utils/git';

/**
 * Fetches the merge-base SHA between two branches.
 *
 * @param cwd - Working directory path
 * @param branch - Branch name
 * @param parentBranch - Parent branch name
 * @returns The merge-base SHA
 */
async function fetchMergeBase(cwd: string, branch: string, parentBranch: string): Promise<string> {
	const { stdout } = await execGit(cwd, ['merge-base', parentBranch, branch]);
	return stdout.trim();
}

/**
 * Parses git diff --name-status output into file changes.
 *
 * @param stdout - Raw stdout from git diff --name-status
 * @returns Array of file changes with status and path
 */
function parseDiffNameStatus(stdout: string): CommitFileChange[] {
	const lines = stdout
		.trim()
		.split('\n')
		.filter((l) => l.length > 0);

	return lines
		.map((line) => {
			const match = line.match(/^([A-Z])\t(.+)$/);
			if (!match) return null;

			const [, statusChar, filePath] = match;
			return { status: statusChar as FileChangeStatus, path: filePath };
		})
		.filter((f): f is CommitFileChange => f !== null);
}

/**
 * Fetches all files changed in a branch relative to its parent branch.
 * Uses git merge-base to find the common ancestor, then diffs from there to the branch tip.
 *
 * @param cwd - Working directory path
 * @param branchName - The branch to get files for
 * @param parentBranchName - The parent (base) branch
 * @returns Array of file changes with status and path
 */
export async function fetchBranchFiles(
	cwd: string,
	branchName: string,
	parentBranchName: string,
): Promise<CommitFileChange[]> {
	const mergeBase = await fetchMergeBase(cwd, branchName, parentBranchName);
	const { stdout } = await execGit(cwd, ['diff', '--name-status', mergeBase, branchName]);
	return parseDiffNameStatus(stdout);
}

/**
 * Fetches the merge-base SHA for building diff URIs.
 * Exported separately so diff handlers can reuse it without re-fetching files.
 *
 * @param cwd - Working directory path
 * @param branchName - The branch name
 * @param parentBranchName - The parent branch name
 * @returns The merge-base SHA string
 */
export async function fetchBranchMergeBase(
	cwd: string,
	branchName: string,
	parentBranchName: string,
): Promise<string> {
	return fetchMergeBase(cwd, branchName, parentBranchName);
}
