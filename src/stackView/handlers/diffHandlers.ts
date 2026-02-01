/**
 * Diff view handlers extracted from StackViewProvider.
 * Handles opening commit diffs, file diffs, and working copy diffs.
 */

import * as vscode from 'vscode';

import { requireNonEmpty } from '../../utils/validation';
import { buildCommitDiffUris, buildWorkingCopyDiffUris } from '../../utils/diffUri';
import { fetchCommitFiles } from '../commitFiles';
import type { CommitFileChange } from '../types';

/** Dependencies needed by diff handlers. */
export interface DiffHandlerDeps {
	workspaceFolder: vscode.WorkspaceFolder | undefined;
}

/**
 * Opens a changes view for the specified commit, comparing it with its parent.
 */
export async function handleOpenCommitDiff(sha: string, deps: DiffHandlerDeps): Promise<void> {
	const trimmedSha = requireNonEmpty(sha, 'commit SHA');
	if (!trimmedSha) return;

	const cwd = deps.workspaceFolder?.uri.fsPath;
	if (!cwd) {
		void vscode.window.showErrorMessage('No workspace folder available.');
		return;
	}

	try {
		const path = await import('node:path');
		const files = await fetchCommitFiles(cwd, trimmedSha);

		if (files.length === 0) {
			void vscode.window.showInformationMessage('No files changed in this commit.');
			return;
		}

		const resourceList = buildResourceList(files, cwd, trimmedSha, path);
		await vscode.commands.executeCommand('vscode.changes', `Changes in ${trimmedSha.substring(0, 7)}`, resourceList);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Failed to open commit diff: ${message}`);
	}
}

/** Builds the resource list for vscode.changes command. */
function buildResourceList(
	files: CommitFileChange[],
	cwd: string,
	sha: string,
	path: typeof import('node:path'),
): [vscode.Uri, vscode.Uri, vscode.Uri][] {
	return files.map((file) => {
		const fileUri = vscode.Uri.file(path.join(cwd, file.path));
		const { left, right } = buildCommitDiffUris(fileUri, sha, file.status);
		return [fileUri, left, right];
	});
}

/** Opens a diff view for a single file in a commit. */
export async function handleOpenFileDiff(sha: string, filePath: string, deps: DiffHandlerDeps): Promise<void> {
	if (!deps.workspaceFolder) {
		void vscode.window.showErrorMessage('No workspace folder available.');
		return;
	}

	try {
		const path = await import('node:path');
		const cwd = deps.workspaceFolder.uri.fsPath;
		const absolutePath = path.join(cwd, filePath);
		const fileUri = vscode.Uri.file(absolutePath);

		const files = await fetchCommitFiles(cwd, sha);
		const fileChange = files.find((f) => f.path === filePath);
		const status = fileChange?.status ?? 'M';

		const { left: leftUri, right: rightUri } = buildCommitDiffUris(fileUri, sha, status);
		const fileName = path.basename(filePath);
		await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${fileName} (${sha.substring(0, 7)})`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Failed to open file diff: ${message}`);
	}
}

/** Opens the current version of a file in the editor. */
export async function handleOpenCurrentFile(filePath: string, deps: DiffHandlerDeps): Promise<void> {
	if (!deps.workspaceFolder) {
		void vscode.window.showErrorMessage('No workspace folder available.');
		return;
	}

	try {
		const path = await import('node:path');
		const absolutePath = path.join(deps.workspaceFolder.uri.fsPath, filePath);
		const fileUri = vscode.Uri.file(absolutePath);

		await vscode.window.showTextDocument(fileUri);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Failed to open file: ${message}`);
	}
}

/** Opens a diff for a working copy file (staged or unstaged). */
export async function handleOpenWorkingCopyDiff(
	filePath: string,
	staged: boolean,
	deps: DiffHandlerDeps,
): Promise<void> {
	if (!deps.workspaceFolder) {
		void vscode.window.showErrorMessage('No workspace folder available.');
		return;
	}

	try {
		const path = await import('node:path');
		const absolutePath = path.join(deps.workspaceFolder.uri.fsPath, filePath);
		const fileUri = vscode.Uri.file(absolutePath);

		const fileName = path.basename(filePath);
		const { left, right } = buildWorkingCopyDiffUris(fileUri, staged);
		const title = staged ? `${fileName} (Staged)` : `${fileName} (Working Copy)`;
		await vscode.commands.executeCommand('vscode.diff', left, right, title);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Failed to open diff: ${message}`);
	}
}
