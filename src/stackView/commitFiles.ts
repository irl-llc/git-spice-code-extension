import type { CommitFileChange, FileChangeStatus } from './types';
import { execGit } from '../utils/git';

/**
 * Parses git diff-tree output and returns file changes for a commit.
 *
 * @param cwd - Working directory path
 * @param sha - Commit SHA to get files for
 * @returns Array of file changes with status and path
 */
export async function fetchCommitFiles(cwd: string, sha: string): Promise<CommitFileChange[]> {
	const { stdout } = await execGit(cwd, ['diff-tree', '--no-commit-id', '--name-status', '-r', sha]);

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
