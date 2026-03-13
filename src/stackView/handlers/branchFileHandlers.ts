/**
 * Branch file handlers for fetching and displaying branch-level diffs.
 * Compares the branch tip against its merge-base with the parent branch.
 */

import * as vscode from 'vscode';

import { fetchBranchFiles, fetchBranchMergeBase } from '../branchFiles';
import { buildGitUri, EMPTY_TREE_SHA } from '../../utils/diffUri';
import type { CommitFileChange } from '../types';
import type { GitSpiceBranch } from '../../gitSpiceSchema';

/** Dependencies needed by branch file handlers. */
export interface BranchFileHandlerDeps {
	workspaceFolder: vscode.WorkspaceFolder | undefined;
	branches: GitSpiceBranch[];
	postBranchFilesToWebview: (branchName: string, files: CommitFileChange[]) => void;
}

/** Finds the parent branch name for a given branch. */
function findParentBranchName(branchName: string, branches: GitSpiceBranch[]): string | undefined {
	const branch = branches.find((b) => b.name === branchName);
	return branch?.down?.name;
}

/** Fetches files changed in a branch and sends them to the webview. */
export async function handleGetBranchFiles(branchName: string, deps: BranchFileHandlerDeps): Promise<void> {
	if (!deps.workspaceFolder) return;

	const parentName = findParentBranchName(branchName, deps.branches);
	if (!parentName) {
		deps.postBranchFilesToWebview(branchName, []);
		return;
	}

	try {
		const files = await fetchBranchFiles(deps.workspaceFolder.uri.fsPath, branchName, parentName);
		deps.postBranchFilesToWebview(branchName, files);
	} catch {
		deps.postBranchFilesToWebview(branchName, []);
	}
}

/** Resolved context for computing branch diffs. */
interface BranchDiffContext {
	cwd: string;
	parentName: string;
}

/** Validates workspace and parent branch, returning cwd and parent name. */
function validateBranchDiffContext(
	branchName: string,
	deps: BranchFileHandlerDeps,
): BranchDiffContext | undefined {
	if (!deps.workspaceFolder) {
		void vscode.window.showErrorMessage('No workspace folder available.');
		return undefined;
	}

	const parentName = findParentBranchName(branchName, deps.branches);
	if (!parentName) {
		void vscode.window.showErrorMessage('Cannot determine parent branch for diff.');
		return undefined;
	}

	return { cwd: deps.workspaceFolder.uri.fsPath, parentName };
}

/** Opens a diff view for a file comparing merge-base to branch tip. */
export async function handleOpenBranchFileDiff(
	branchName: string,
	filePath: string,
	deps: BranchFileHandlerDeps,
	status?: string,
): Promise<void> {
	const ctx = validateBranchDiffContext(branchName, deps);
	if (!ctx) return;

	try {
		await openBranchFileDiff(ctx.cwd, branchName, ctx.parentName, filePath, status);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Failed to open branch file diff: ${message}`);
	}
}

/** Builds diff URIs for a branch file, handling added/deleted statuses. */
function buildBranchFileDiffUris(
	fileUri: vscode.Uri,
	mergeBase: string,
	branchName: string,
	status?: string,
): { left: vscode.Uri; right: vscode.Uri } {
	if (status === 'A') {
		return { left: buildGitUri(fileUri, EMPTY_TREE_SHA), right: buildGitUri(fileUri, branchName) };
	}
	if (status === 'D') {
		return { left: buildGitUri(fileUri, mergeBase), right: buildGitUri(fileUri, EMPTY_TREE_SHA) };
	}
	return { left: buildGitUri(fileUri, mergeBase), right: buildGitUri(fileUri, branchName) };
}

/** Builds URIs and opens the diff editor for a branch file. */
async function openBranchFileDiff(
	cwd: string,
	branchName: string,
	parentName: string,
	filePath: string,
	status?: string,
): Promise<void> {
	const path = await import('node:path');
	const mergeBase = await fetchBranchMergeBase(cwd, branchName, parentName);
	const fileUri = vscode.Uri.file(path.join(cwd, filePath));

	const { left, right } = buildBranchFileDiffUris(fileUri, mergeBase, branchName, status);
	const title = `${path.basename(filePath)} (${branchName} changes)`;

	await vscode.commands.executeCommand('vscode.diff', left, right, title);
}
