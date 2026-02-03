/**
 * Repository sync handler.
 * Runs `gs repo sync` with interactive branch deletion prompts.
 */

import * as vscode from 'vscode';

import { execRepoSync, type RepoSyncResult } from '../../utils/gitSpice';

/** Dependencies needed by the sync handler. */
export interface SyncHandlerDeps {
	folder: vscode.WorkspaceFolder;
	refresh: () => Promise<void>;
}

/** Executes repo sync with progress notification. */
export async function handleSync(deps: SyncHandlerDeps): Promise<void> {
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Syncing repository with remote...', cancellable: false },
		() => executeSyncCore(deps),
	);
}

/** Core sync logic: run command, show result, refresh. */
async function executeSyncCore(deps: SyncHandlerDeps): Promise<void> {
	try {
		const result = await execRepoSync(deps.folder, promptBranchDeletion);
		showSyncResult(result);
		await deps.refresh();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Unexpected error during repository sync: ${message}`);
	}
}

/** Prompts the user to confirm branch deletion. */
async function promptBranchDeletion(branchName: string): Promise<boolean> {
	const answer = await vscode.window.showWarningMessage(
		`Branch '${branchName}' has a closed pull request. Delete this branch?`,
		{ modal: true },
		'Yes',
		'No',
	);
	return answer === 'Yes';
}

/** Shows the sync result to the user. */
function showSyncResult(result: RepoSyncResult): void {
	if ('error' in result) {
		void vscode.window.showErrorMessage(`Failed to sync repository: ${result.error}`);
		return;
	}
	const { deletedBranches, syncedBranches } = result.value;
	void vscode.window.showInformationMessage(formatSyncMessage(deletedBranches, syncedBranches));
}

/** Formats the sync success message. */
function formatSyncMessage(deleted: string[], synced: number): string {
	let msg = 'Repository synced successfully.';
	if (synced > 0) msg += ` ${synced} branch${synced === 1 ? '' : 'es'} updated.`;
	if (deleted.length > 0) msg += ` Deleted ${deleted.length} branch${deleted.length === 1 ? '' : 'es'}: ${deleted.join(', ')}.`;
	return msg;
}
