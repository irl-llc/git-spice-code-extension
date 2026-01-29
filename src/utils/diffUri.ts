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
 * Builds a git-scheme URI for viewing a file at a specific git reference.
 *
 * @param fileUri - The file URI (must be a file:// URI)
 * @param ref - The git reference (SHA, branch name, HEAD, ~, etc.)
 */
export function buildGitUri(fileUri: vscode.Uri, ref: string): vscode.Uri {
	const query = JSON.stringify({ path: fileUri.fsPath, ref });
	return fileUri.with({ scheme: 'git', query });
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
 *
 * @param fileUri - The file URI
 * @param staged - Whether showing staged changes (index vs HEAD) or unstaged (working copy vs index)
 */
export function buildWorkingCopyDiffUris(fileUri: vscode.Uri, staged: boolean): DiffUriPair {
	if (staged) {
		// Staged: compare HEAD to index (~)
		return {
			left: buildGitUri(fileUri, 'HEAD'),
			right: buildGitUri(fileUri, '~'),
		};
	}

	// Unstaged: compare index (~) to working copy (file itself)
	return {
		left: buildGitUri(fileUri, '~'),
		right: fileUri,
	};
}
