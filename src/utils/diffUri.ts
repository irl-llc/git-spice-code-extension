import * as vscode from 'vscode';
import type { FileChangeStatus } from '../stackView/types';

/**
 * Git's empty tree SHA - used as a reference for files that don't exist in a commit.
 * This is the well-known SHA for an empty tree in git.
 */
export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * A pair of URIs representing left (before) and right (after) states for a diff.
 */
export interface DiffUriPair {
	left: vscode.Uri;
	right: vscode.Uri;
}

/**
 * Marker carried in the query of git-spice-opened branch diffs. The forge
 * CommentController matches on this so it only attaches threads to diffs the
 * extension itself opened — never to git diffs from the built-in Git extension
 * or the GitHub Pull Requests extension (which use their own URI schemes).
 */
export const GIT_SPICE_DIFF_MARKER = 'gitSpiceBranch';

/**
 * Identifies which branch's Change Request a git-spice diff belongs to, so the
 * CommentController can look up that branch's inline comments. Parsed back out
 * of the right-side diff URI via {@link parseGitSpiceDiffUri}.
 */
export type GitSpiceDiffMarker = Readonly<{ branchName: string }>;

/**
 * Builds a git-scheme URI for viewing a file at a specific git reference.
 *
 * Pass `marker` to tag the URI as a git-spice branch diff; the value is stored
 * under {@link GIT_SPICE_DIFF_MARKER} in the JSON query and read back by
 * {@link parseGitSpiceDiffUri}. The scheme stays `git` so VS Code's Git
 * extension still resolves the file content.
 *
 * @param fileUri - The file URI (must be a file:// URI)
 * @param ref - The git reference (SHA, branch name, HEAD, ~, etc.)
 * @param marker - Optional git-spice branch marker for comment scoping
 */
export function buildGitUri(fileUri: vscode.Uri, ref: string, marker?: GitSpiceDiffMarker): vscode.Uri {
	const base: Record<string, unknown> = { path: fileUri.fsPath, ref };
	if (marker) base[GIT_SPICE_DIFF_MARKER] = marker.branchName;
	return fileUri.with({ scheme: 'git', query: JSON.stringify(base) });
}

/**
 * Parses the git-spice branch marker out of a diff URI's query, or returns
 * undefined when the URI is not a marked git-spice diff (wrong scheme,
 * unparseable query, or no marker). The CommentController uses this to decide
 * whether to render forge comments on a freshly-opened diff editor.
 */
export function parseGitSpiceDiffUri(uri: vscode.Uri): GitSpiceDiffMarker | undefined {
	if (uri.scheme !== 'git') return undefined;
	const branchName = readMarkerBranch(uri.query);
	return branchName ? { branchName } : undefined;
}

/** Reads the marker branch name from a git URI query string, defensively. */
function readMarkerBranch(query: string): string | undefined {
	try {
		const parsed: unknown = JSON.parse(query);
		if (typeof parsed !== 'object' || parsed === null) return undefined;
		const value = (parsed as Record<string, unknown>)[GIT_SPICE_DIFF_MARKER];
		return typeof value === 'string' && value.length > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Builds diff URIs for a commit file change, handling added/deleted/modified files.
 *
 * @param fileUri - The file URI
 * @param sha - The commit SHA
 * @param status - The file change status (A=added, D=deleted, M=modified, etc.)
 */
export function buildCommitDiffUris(fileUri: vscode.Uri, sha: string, status: FileChangeStatus): DiffUriPair {
	const parentRef = `${sha}^`;

	if (status === 'A') {
		// Added file: compare empty tree to commit version
		return {
			left: buildGitUri(fileUri, EMPTY_TREE_SHA),
			right: buildGitUri(fileUri, sha),
		};
	}

	if (status === 'D') {
		// Deleted file: compare parent version to empty tree
		return {
			left: buildGitUri(fileUri, parentRef),
			right: buildGitUri(fileUri, EMPTY_TREE_SHA),
		};
	}

	// Modified or other: compare parent to commit
	return {
		left: buildGitUri(fileUri, parentRef),
		right: buildGitUri(fileUri, sha),
	};
}

/**
 * Builds diff URIs for working copy changes.
 * Handles special cases for untracked, added, and deleted files.
 *
 * @param fileUri - The file URI
 * @param staged - Whether showing staged changes (index vs HEAD) or unstaged (working copy vs index)
 * @param status - Optional file change status for handling new/deleted files
 */
export function buildWorkingCopyDiffUris(fileUri: vscode.Uri, staged: boolean, status?: string): DiffUriPair {
	if (!staged && status === 'U') {
		return { left: buildGitUri(fileUri, EMPTY_TREE_SHA), right: fileUri };
	}
	if (staged && status === 'A') {
		return { left: buildGitUri(fileUri, EMPTY_TREE_SHA), right: buildGitUri(fileUri, '~') };
	}
	if (staged && status === 'D') {
		return { left: buildGitUri(fileUri, 'HEAD'), right: buildGitUri(fileUri, EMPTY_TREE_SHA) };
	}

	if (staged) {
		return { left: buildGitUri(fileUri, 'HEAD'), right: buildGitUri(fileUri, '~') };
	}

	return { left: buildGitUri(fileUri, '~'), right: fileUri };
}
