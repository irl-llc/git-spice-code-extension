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

/** Shows error for missing workspace and returns false. */
function requireWorkspaceFolder(deps: DiffHandlerDeps): string | undefined {
	const cwd = deps.workspaceFolder?.uri.fsPath;
	if (!cwd) void vscode.window.showErrorMessage('No workspace folder available.');
	return cwd;
}

/** Shows a diff error message with consistent formatting. */
function showDiffError(operation: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	void vscode.window.showErrorMessage(`Failed to ${operation}: ${message}`);
}

/** Opens the commit diff view after validating files exist. */
async function openCommitChangesView(cwd: string, sha: string, files: CommitFileChange[]): Promise<void> {
	if (files.length === 0) {
		void vscode.window.showInformationMessage('No files changed in this commit.');
		return;
	}
	const path = await import('node:path');
	const resourceList = buildResourceList(files, cwd, sha, path);
	await vscode.commands.executeCommand('vscode.changes', `Changes in ${sha.substring(0, 7)}`, resourceList);
}

/** Opens a changes view for the specified commit, comparing it with its parent. */
export async function handleOpenCommitDiff(sha: string, deps: DiffHandlerDeps): Promise<void> {
	const trimmedSha = requireNonEmpty(sha, 'commit SHA');
	if (!trimmedSha) return;

	const cwd = requireWorkspaceFolder(deps);
	if (!cwd) return;

	try {
		const files = await fetchCommitFiles(cwd, trimmedSha);
		await openCommitChangesView(cwd, trimmedSha, files);
	} catch (error) {
		showDiffError('open commit diff', error);
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

/** Opens the diff view for a single file in a commit. */
async function openFileDiffView(cwd: string, sha: string, filePath: string): Promise<void> {
	const path = await import('node:path');
	const absolutePath = path.join(cwd, filePath);
	const fileUri = vscode.Uri.file(absolutePath);

	const files = await fetchCommitFiles(cwd, sha);
	const status = files.find((f) => f.path === filePath)?.status ?? 'M';
	const { left, right } = buildCommitDiffUris(fileUri, sha, status);

	await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(filePath)} (${sha.substring(0, 7)})`);
}

/** Opens a diff view for a single file in a commit. */
export async function handleOpenFileDiff(sha: string, filePath: string, deps: DiffHandlerDeps): Promise<void> {
	const cwd = requireWorkspaceFolder(deps);
	if (!cwd) return;

	try {
		await openFileDiffView(cwd, sha, filePath);
	} catch (error) {
		showDiffError('open file diff', error);
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

/** Opens the diff view for a working copy file. */
async function openWorkingCopyDiffView(cwd: string, filePath: string, staged: boolean): Promise<void> {
	const path = await import('node:path');
	const absolutePath = path.join(cwd, filePath);
	const fileUri = vscode.Uri.file(absolutePath);
	const fileName = path.basename(filePath);

	const { left, right } = buildWorkingCopyDiffUris(fileUri, staged);
	const title = staged ? `${fileName} (Staged)` : `${fileName} (Working Copy)`;
	await vscode.commands.executeCommand('vscode.diff', left, right, title);
}

/** Opens a diff for a working copy file (staged or unstaged). */
export async function handleOpenWorkingCopyDiff(filePath: string, staged: boolean, deps: DiffHandlerDeps): Promise<void> {
	const cwd = requireWorkspaceFolder(deps);
	if (!cwd) return;

	try {
		await openWorkingCopyDiffView(cwd, filePath, staged);
	} catch (error) {
		showDiffError('open diff', error);
	}
}
