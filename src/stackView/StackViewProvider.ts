/**
 * Stack View Provider - Main orchestrator for the git-spice webview.
 * Manages state and delegates operations to specialized handlers.
 */

import * as vscode from 'vscode';

import type { GitSpiceBranch } from '../gitSpiceSchema';
import { buildDisplayState } from './state';
import type { UncommittedState } from './types';
import type { WebviewMessage } from './webviewTypes';
import {
	execGitSpice,
	execBranchUntrack,
	execBranchCheckout,
	execBranchFold,
	execBranchSquash,
	execBranchEdit,
	execBranchRestack,
	execBranchSubmit,
	execRepoSync,
	type BranchCommandResult,
} from '../utils/gitSpice';
import { fetchWorkingCopyChanges } from './workingCopy';
import { renderWebviewHtml } from './webviewHtml';
import { routeMessage, type MessageHandlerContext, type ExecFunctionMap } from './messageRouter';
import { FileWatcherManager } from './fileWatcher';

import {
	handleBranchContextMenu,
	handleBranchDelete,
	handleBranchRenamePrompt,
	handleBranchRename,
	handleBranchMovePrompt,
	handleBranchMove,
	handleUpstackMovePrompt,
	handleUpstackMove,
	type BranchHandlerDeps,
} from './handlers/branchHandlers';
import {
	handleCommitCopySha,
	handleCommitFixup,
	handleCommitSplit,
	handleGetCommitFiles,
	type CommitHandlerDeps,
} from './handlers/commitHandlers';
import {
	handleOpenCommitDiff,
	handleOpenFileDiff,
	handleOpenCurrentFile,
	handleOpenWorkingCopyDiff,
	type DiffHandlerDeps,
} from './handlers/diffHandlers';
import {
	handleStageFile,
	handleUnstageFile,
	handleDiscardFile,
	handleCommitChanges,
	handleCreateBranch,
	type WorkingCopyHandlerDeps,
} from './handlers/workingCopyHandlers';

export class StackViewProvider implements vscode.WebviewViewProvider, MessageHandlerContext {
	private view!: vscode.WebviewView;
	private branches: GitSpiceBranch[] = [];
	private uncommitted: UncommittedState | undefined;
	private lastError: string | undefined;
	private readonly fileWatcher: FileWatcherManager;

	constructor(
		private workspaceFolder: vscode.WorkspaceFolder | undefined,
		private readonly extensionUri: vscode.Uri,
	) {
		this.fileWatcher = new FileWatcherManager(() => void this.refresh());
	}

	async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this.view = webviewView;
		this.configureWebviewOptions(webviewView);

		webviewView.webview.html = await renderWebviewHtml(webviewView.webview, this.extensionUri);
		webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => routeMessage(message, this));

		if (this.workspaceFolder) this.fileWatcher.watch(this.workspaceFolder);
		void this.refresh();
	}

	private configureWebviewOptions(webviewView: vscode.WebviewView): void {
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, 'media'),
				vscode.Uri.joinPath(this.extensionUri, 'dist'),
				vscode.Uri.joinPath(this.extensionUri, 'dist', 'codicons'),
			],
		};
	}

	setWorkspaceFolder(folder: vscode.WorkspaceFolder | undefined): void {
		this.workspaceFolder = folder;
		if (folder) {
			this.fileWatcher.watch(folder);
		} else {
			this.fileWatcher.dispose();
		}
		void this.refresh();
	}

	async refresh(): Promise<void> {
		if (!this.workspaceFolder) {
			this.setEmptyState('Open a workspace folder to view git-spice stacks.');
			return;
		}

		const [branchResult, uncommittedResult] = await Promise.all([
			execGitSpice(this.workspaceFolder),
			this.getWorkingCopyChanges(),
		]);

		this.processBranchResult(branchResult);
		this.uncommitted = uncommittedResult;
		this.pushState();
	}

	private setEmptyState(error: string): void {
		this.branches = [];
		this.uncommitted = undefined;
		this.lastError = error;
		this.pushState();
	}

	private processBranchResult(result: { value: GitSpiceBranch[] } | { error: string }): void {
		if ('error' in result) {
			this.branches = [];
			this.lastError = result.error;
		} else {
			this.branches = result.value;
			this.lastError = undefined;
		}
	}

	pushState(): void {
		const state = buildDisplayState(this.branches, this.lastError, this.uncommitted);
		void this.view.webview.postMessage({ type: 'state', payload: state });
	}

	async sync(): Promise<void> {
		if (!this.workspaceFolder) {
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		await this.executeSyncWithProgress();
	}

	private async executeSyncWithProgress(): Promise<void> {
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Syncing repository with remote...',
				cancellable: false,
			},
			async () => {
				try {
					const result = await execRepoSync(this.workspaceFolder!, this.createBranchDeletePrompt());
					this.handleSyncResult(result);
					await this.refresh();
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					void vscode.window.showErrorMessage(`Unexpected error during repository sync: ${message}`);
				}
			},
		);
	}

	private createBranchDeletePrompt(): (branchName: string) => Promise<boolean> {
		return async (branchName: string) => {
			const answer = await vscode.window.showWarningMessage(
				`Branch '${branchName}' has a closed pull request. Delete this branch?`,
				{ modal: true },
				'Yes',
				'No',
			);
			return answer === 'Yes';
		};
	}

	private handleSyncResult(result: { value: { deletedBranches: string[]; syncedBranches: number } } | { error: string }): void {
		if ('error' in result) {
			void vscode.window.showErrorMessage(`Failed to sync repository: ${result.error}`);
			return;
		}

		const { deletedBranches, syncedBranches } = result.value;
		const message = this.buildSyncMessage(deletedBranches, syncedBranches);
		void vscode.window.showInformationMessage(message);
	}

	private buildSyncMessage(deletedBranches: string[], syncedBranches: number): string {
		let message = 'Repository synced successfully.';

		if (syncedBranches > 0) {
			message += ` ${syncedBranches} branch${syncedBranches === 1 ? '' : 'es'} updated.`;
		}

		if (deletedBranches.length > 0) {
			message += ` Deleted ${deletedBranches.length} branch${deletedBranches.length === 1 ? '' : 'es'}: ${deletedBranches.join(', ')}.`;
		}

		return message;
	}

	// --- Handler Dependency Factories ---

	private getBranchHandlerDeps(): BranchHandlerDeps {
		return {
			workspaceFolder: this.workspaceFolder,
			branches: this.branches,
			runBranchCommand: (title, operation, successMessage) =>
				this.runBranchCommand(title, operation, successMessage),
			handleBranchCommandInternal: (commandName, branchName, execFunction) =>
				this.handleBranchCommandInternal(commandName, branchName, execFunction),
			postMessageToWebview: (message) => this.view.webview.postMessage(message),
		};
	}

	private getCommitHandlerDeps(): CommitHandlerDeps {
		return {
			workspaceFolder: this.workspaceFolder,
			runBranchCommand: (title, operation, successMessage) =>
				this.runBranchCommand(title, operation, successMessage),
			refresh: () => this.refresh(),
			postCommitFilesToWebview: (sha, files) =>
				this.view.webview.postMessage({ type: 'commitFiles', sha, files }),
		};
	}

	private getDiffHandlerDeps(): DiffHandlerDeps {
		return { workspaceFolder: this.workspaceFolder };
	}

	private getWorkingCopyHandlerDeps(): WorkingCopyHandlerDeps {
		return {
			workspaceFolder: this.workspaceFolder,
			uncommitted: this.uncommitted,
			refresh: () => this.refresh(),
		};
	}

	// --- Public Handler Methods (Exposed for Message Router) ---

	async handleBranchContextMenu(branchName: string): Promise<void> {
		await handleBranchContextMenu(branchName, this.getBranchHandlerDeps());
	}

	public async handleBranchDelete(branchName: string): Promise<void> {
		await handleBranchDelete(branchName, this.getBranchHandlerDeps());
	}

	public async handleBranchRenamePrompt(branchName: string): Promise<void> {
		await handleBranchRenamePrompt(branchName, this.getBranchHandlerDeps());
	}

	async handleBranchRename(branchName: string, newName: string): Promise<void> {
		await handleBranchRename(branchName, newName, this.getBranchHandlerDeps());
	}

	public async handleBranchMovePrompt(branchName: string): Promise<void> {
		await handleBranchMovePrompt(branchName, this.getBranchHandlerDeps());
	}

	async handleBranchMove(branchName: string, newParent: string): Promise<void> {
		await handleBranchMove(branchName, newParent, this.getBranchHandlerDeps());
	}

	public async handleUpstackMovePrompt(branchName: string): Promise<void> {
		await handleUpstackMovePrompt(branchName, this.getBranchHandlerDeps());
	}

	async handleUpstackMove(branchName: string, newParent: string): Promise<void> {
		await handleUpstackMove(branchName, newParent, this.getBranchHandlerDeps());
	}

	public async handleCommitCopySha(sha: string): Promise<void> {
		await handleCommitCopySha(sha);
	}

	async handleCommitFixup(sha: string): Promise<void> {
		await handleCommitFixup(sha, this.getCommitHandlerDeps());
	}

	public async handleCommitSplit(sha: string, branchName: string): Promise<void> {
		await handleCommitSplit(sha, branchName, this.getCommitHandlerDeps());
	}

	async handleGetCommitFiles(sha: string): Promise<void> {
		await handleGetCommitFiles(sha, this.getCommitHandlerDeps());
	}

	handleOpenExternal(url: string): void {
		void vscode.env.openExternal(vscode.Uri.parse(url));
	}

	handleOpenCommit(sha: string): void {
		void vscode.commands.executeCommand('git.openCommit', sha);
	}

	async handleOpenCommitDiff(sha: string): Promise<void> {
		await handleOpenCommitDiff(sha, this.getDiffHandlerDeps());
	}

	async handleOpenFileDiff(sha: string, filePath: string): Promise<void> {
		await handleOpenFileDiff(sha, filePath, this.getDiffHandlerDeps());
	}

	async handleOpenCurrentFile(filePath: string): Promise<void> {
		await handleOpenCurrentFile(filePath, this.getDiffHandlerDeps());
	}

	async handleOpenWorkingCopyDiff(filePath: string, staged: boolean): Promise<void> {
		await handleOpenWorkingCopyDiff(filePath, staged, this.getDiffHandlerDeps());
	}

	async handleStageFile(filePath: string): Promise<void> {
		await handleStageFile(filePath, this.getWorkingCopyHandlerDeps());
	}

	async handleUnstageFile(filePath: string): Promise<void> {
		await handleUnstageFile(filePath, this.getWorkingCopyHandlerDeps());
	}

	async handleDiscardFile(filePath: string): Promise<void> {
		await handleDiscardFile(filePath, this.getWorkingCopyHandlerDeps());
	}

	async handleCommitChanges(message: string): Promise<void> {
		await handleCommitChanges(message, this.getWorkingCopyHandlerDeps());
	}

	async handleCreateBranch(message: string): Promise<void> {
		await handleCreateBranch(message, this.getWorkingCopyHandlerDeps());
	}

	// --- Branch Command Infrastructure ---

	public async handleBranchCommand(commandName: string, branchName: string): Promise<void> {
		const commandMap: Record<
			string,
			(folder: vscode.WorkspaceFolder, branchName: string) => Promise<BranchCommandResult>
		> = {
			untrack: execBranchUntrack,
			checkout: execBranchCheckout,
			fold: execBranchFold,
			squash: execBranchSquash,
			edit: execBranchEdit,
			restack: execBranchRestack,
			submit: execBranchSubmit,
		};

		const execFunction = commandMap[commandName];
		if (!execFunction) {
			void vscode.window.showErrorMessage(`Unknown command: ${commandName}`);
			return;
		}

		await this.handleBranchCommandInternal(commandName, branchName, execFunction);
	}

	async handleBranchCommandInternal(
		commandName: string,
		branchName: string,
		execFunction: (folder: vscode.WorkspaceFolder, branchName: string) => Promise<BranchCommandResult>,
	): Promise<void> {
		const trimmedName = branchName?.trim();
		if (!trimmedName) {
			void vscode.window.showErrorMessage(`Branch name for ${commandName} cannot be empty.`);
			return;
		}

		if (!this.workspaceFolder) {
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		const title = `${commandName.charAt(0).toUpperCase() + commandName.slice(1)}ing branch: ${trimmedName}`;
		const successMessage = `Branch ${trimmedName} ${commandName}ed successfully.`;

		await this.runBranchCommand(title, () => execFunction(this.workspaceFolder!, trimmedName), successMessage);
	}

	/** Shows result of a branch command and returns success status. */
	private showBranchCommandResult(result: BranchCommandResult, successMessage: string): boolean {
		if ('error' in result) {
			void vscode.window.showErrorMessage(result.error);
			return false;
		}
		void vscode.window.showInformationMessage(successMessage);
		return true;
	}

	/** Executes a branch command with progress notification. */
	private async runBranchCommand(title: string, operation: () => Promise<BranchCommandResult>, successMessage: string): Promise<boolean> {
		let success = false;
		await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, async () => {
			try {
				const result = await operation();
				success = this.showBranchCommandResult(result, successMessage);
				await this.refresh();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				void vscode.window.showErrorMessage(`Unexpected error: ${message}`);
			}
		});
		return success;
	}

	getExecFunctions(): ExecFunctionMap {
		return {
			untrack: execBranchUntrack,
			checkout: execBranchCheckout,
			fold: execBranchFold,
			squash: execBranchSquash,
			edit: execBranchEdit,
			restack: execBranchRestack,
			submit: execBranchSubmit,
		};
	}

	private getWorkingCopyChanges(): Promise<UncommittedState> {
		return fetchWorkingCopyChanges(this.workspaceFolder?.uri.fsPath);
	}

	dispose(): void {
		this.fileWatcher.dispose();
	}
}
