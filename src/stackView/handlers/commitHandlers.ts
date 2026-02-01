/**
 * Commit operation handlers extracted from StackViewProvider.
 * Handles commit copy, fixup, split, and file fetching.
 */

import * as vscode from 'vscode';

import type { BranchCommandResult } from '../../utils/gitSpice';
import { execCommitFixup, execBranchSplit } from '../../utils/gitSpice';
import { requireNonEmpty, requireAllNonEmpty, requireWorkspace } from '../../utils/validation';
import { fetchCommitFiles } from '../commitFiles';
import type { CommitFileChange } from '../types';

/** Dependencies needed by commit handlers. */
export interface CommitHandlerDeps {
	workspaceFolder: vscode.WorkspaceFolder | undefined;
	runBranchCommand: (
		title: string,
		operation: () => Promise<BranchCommandResult>,
		successMessage: string,
	) => Promise<boolean>;
	refresh: () => Promise<void>;
	postCommitFilesToWebview: (sha: string, files: CommitFileChange[]) => void;
}

/** Copies a commit SHA to the clipboard. */
export async function handleCommitCopySha(sha: string): Promise<void> {
	const trimmedSha = requireNonEmpty(sha, 'commit SHA');
	if (!trimmedSha) return;

	try {
		await vscode.env.clipboard.writeText(trimmedSha);
		void vscode.window.showInformationMessage(`Copied commit SHA: ${trimmedSha.substring(0, 8)}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error('Error copying SHA to clipboard:', message);
		void vscode.window.showErrorMessage(`Failed to copy SHA: ${message}`);
	}
}

/** Creates a fixup commit for the specified commit. */
export async function handleCommitFixup(sha: string, deps: CommitHandlerDeps): Promise<void> {
	const trimmedSha = requireNonEmpty(sha, 'commit SHA');
	if (!trimmedSha) return;

	if (!requireWorkspace(deps.workspaceFolder)) return;

	await deps.runBranchCommand(
		`Creating fixup commit for ${trimmedSha.substring(0, 8)}`,
		() => execCommitFixup(deps.workspaceFolder!, trimmedSha),
		`Fixup commit created for ${trimmedSha.substring(0, 8)}`,
	);
}

/** Splits a branch at the specified commit. */
export async function handleCommitSplit(
	sha: string,
	branchName: string,
	deps: CommitHandlerDeps,
): Promise<void> {
	const validated = requireAllNonEmpty([
		[sha, 'commit SHA'],
		[branchName, 'branch name'],
	]);
	if (!validated) return;
	const [trimmedSha, trimmedBranch] = validated;

	if (!requireWorkspace(deps.workspaceFolder)) return;

	const newBranchName = await promptForNewBranchName(trimmedSha);
	if (!newBranchName) return;

	await executeBranchSplit(trimmedBranch, trimmedSha, newBranchName, deps);
}

/** Prompts user for new branch name for split operation. */
async function promptForNewBranchName(sha: string): Promise<string | undefined> {
	const newBranchName = await vscode.window.showInputBox({
		prompt: `Enter name for the new branch that will be created at commit ${sha.substring(0, 8)}`,
		placeHolder: 'new-branch-name',
		validateInput: (input) => {
			if (!input || !input.trim()) return 'Branch name cannot be empty.';
			if (!/^[a-zA-Z0-9/_-]+$/.test(input.trim())) return 'Branch name contains invalid characters.';
			return null;
		},
	});

	return newBranchName?.trim() || undefined;
}

/** Executes the branch split operation with progress UI. */
async function executeBranchSplit(
	branchName: string,
	sha: string,
	newBranchName: string,
	deps: CommitHandlerDeps,
): Promise<void> {
	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: `Splitting branch ${branchName} at ${sha.substring(0, 8)}`,
			cancellable: false,
		},
		async () => {
			try {
				const result = await execBranchSplit(deps.workspaceFolder!, branchName, sha, newBranchName);

				if ('error' in result) {
					void vscode.window.showErrorMessage(`Failed to split branch: ${result.error}`);
				} else {
					void vscode.window.showInformationMessage(
						`Branch ${branchName} split at ${sha.substring(0, 8)} → ${newBranchName}`,
					);
				}

				await deps.refresh();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				void vscode.window.showErrorMessage(`Unexpected error during branch split: ${message}`);
			}
		},
	);
}

/** Fetches files changed in a commit and sends to webview. */
export async function handleGetCommitFiles(sha: string, deps: CommitHandlerDeps): Promise<void> {
	if (!deps.workspaceFolder) return;

	try {
		const files = await fetchCommitFiles(deps.workspaceFolder.uri.fsPath, sha);
		deps.postCommitFilesToWebview(sha, files);
	} catch (error) {
		console.error(`Failed to fetch commit files for SHA ${sha}:`, error);
		deps.postCommitFilesToWebview(sha, []);
	}
}
