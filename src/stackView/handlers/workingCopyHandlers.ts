/**
 * Working copy operation handlers extracted from StackViewProvider.
 * Handles stage, unstage, discard, commit, and branch creation.
 */

import * as vscode from 'vscode';

import type { UncommittedState } from '../types';
import {
	stageFile,
	unstageFile,
	discardFile,
	stageAllFiles,
	commitChanges,
} from '../workingCopy';
import { execBranchCreate } from '../../utils/gitSpice';

/** Dependencies needed by working copy handlers. */
export interface WorkingCopyHandlerDeps {
	workspaceFolder: vscode.WorkspaceFolder | undefined;
	uncommitted: UncommittedState | undefined;
	refresh: () => Promise<void>;
}

/** Stages a file using git add. */
export async function handleStageFile(filePath: string, deps: WorkingCopyHandlerDeps): Promise<void> {
	if (!deps.workspaceFolder) return;

	try {
		await stageFile(deps.workspaceFolder.uri.fsPath, filePath);
		await deps.refresh();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Failed to stage file: ${message}`);
	}
}

/** Unstages a file using git restore --staged. */
export async function handleUnstageFile(filePath: string, deps: WorkingCopyHandlerDeps): Promise<void> {
	if (!deps.workspaceFolder) return;

	try {
		await unstageFile(deps.workspaceFolder.uri.fsPath, filePath);
		await deps.refresh();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Failed to unstage file: ${message}`);
	}
}

/** Discards changes to a file with confirmation. */
export async function handleDiscardFile(filePath: string, deps: WorkingCopyHandlerDeps): Promise<void> {
	if (!deps.workspaceFolder) return;

	const confirmed = await vscode.window.showWarningMessage(
		`Discard changes to '${filePath}'? This cannot be undone.`,
		{ modal: true },
		'Discard',
	);
	if (confirmed !== 'Discard') return;

	try {
		await discardFile(deps.workspaceFolder.uri.fsPath, filePath);
		await deps.refresh();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Failed to discard changes: ${message}`);
	}
}

/** Commits staged changes with the given message. */
export async function handleCommitChanges(message: string, deps: WorkingCopyHandlerDeps): Promise<void> {
	if (!deps.workspaceFolder) {
		void vscode.window.showErrorMessage('No workspace folder available.');
		return;
	}

	const trimmedMessage = message.trim();
	if (trimmedMessage.length === 0) {
		void vscode.window.showErrorMessage('Commit message cannot be empty.');
		return;
	}

	const ready = await ensureStagedChanges(deps);
	if (!ready) return;

	await executeCommit(trimmedMessage, deps);
}

/** Creates a new branch with the given commit message. */
export async function handleCreateBranch(message: string, deps: WorkingCopyHandlerDeps): Promise<void> {
	if (!deps.workspaceFolder) {
		void vscode.window.showErrorMessage('No workspace folder available.');
		return;
	}

	const trimmedMessage = message.trim();
	if (trimmedMessage.length === 0) {
		void vscode.window.showErrorMessage('Commit message cannot be empty.');
		return;
	}

	const ready = await ensureStagedChanges(deps);
	if (!ready) return;

	await executeBranchCreate(trimmedMessage, deps);
}

/** Ensures there are staged changes before committing. */
async function ensureStagedChanges(deps: WorkingCopyHandlerDeps): Promise<boolean> {
	const hasStagedChanges = (deps.uncommitted?.staged.length ?? 0) > 0;
	if (hasStagedChanges) return true;

	const hasUnstagedChanges = (deps.uncommitted?.unstaged.length ?? 0) > 0;
	if (!hasUnstagedChanges) {
		void vscode.window.showInformationMessage('There are no changes to commit.');
		return false;
	}

	return promptAndStageAll(deps);
}

/** Prompts to stage all changes and stages them if confirmed. */
async function promptAndStageAll(deps: WorkingCopyHandlerDeps): Promise<boolean> {
	const choice = await vscode.window.showWarningMessage(
		'There are no staged changes to commit.\n\nWould you like to stage all your changes and commit them directly?',
		{ modal: true },
		'Yes',
	);
	if (choice !== 'Yes') return false;

	try {
		await stageAllFiles(deps.workspaceFolder!.uri.fsPath);
		return true;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Failed to stage changes: ${msg}`);
		return false;
	}
}

/** Executes the commit with progress UI. */
async function executeCommit(message: string, deps: WorkingCopyHandlerDeps): Promise<void> {
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Committing changes...', cancellable: false },
		async () => {
			try {
				await commitChanges(deps.workspaceFolder!.uri.fsPath, message);
				void vscode.window.showInformationMessage('Changes committed successfully.');
				await deps.refresh();
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				void vscode.window.showErrorMessage(`Failed to commit: ${msg}`);
			}
		},
	);
}

/** Executes branch creation with progress UI. */
async function executeBranchCreate(message: string, deps: WorkingCopyHandlerDeps): Promise<void> {
	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: 'Creating new branch...',
			cancellable: false,
		},
		async () => {
			const result = await execBranchCreate(deps.workspaceFolder!, message);

			if ('error' in result) {
				void vscode.window.showErrorMessage(`Failed to create branch: ${result.error}`);
			} else {
				void vscode.window.showInformationMessage('Branch created successfully.');
			}

			await deps.refresh();
		},
	);
}
