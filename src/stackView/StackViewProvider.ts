import * as vscode from 'vscode';

import { buildDisplayState } from './state';
import type { BranchRecord, FileChangeStatus, UncommittedState } from './types';
import type { WebviewMessage } from './webviewTypes';
import {
	execGitSpice,
	execBranchUntrack,
	execBranchDelete,
	execBranchCheckout,
	execBranchFold,
	execBranchSquash,
	execBranchEdit,
	execBranchRename,
	execBranchRestack,
	execBranchSubmit,
	execBranchMove,
	execUpstackMove,
	execCommitFixup,
	execBranchSplit,
	execRepoSync,
	execBranchCreate,
	type BranchCommandResult,
} from '../utils/gitSpice';
import { execGit } from '../utils/git';
import { buildCommitDiffUris, buildWorkingCopyDiffUris } from '../utils/diffUri';
import { requireNonEmpty, requireWorkspace, requireAllNonEmpty } from '../utils/validation';
import {
	fetchWorkingCopyChanges,
	stageFile,
	unstageFile,
	discardFile,
	stageAllFiles,
	commitChanges,
} from './workingCopy';
import { fetchCommitFiles } from './commitFiles';
import { renderWebviewHtml } from './webviewHtml';
import { routeMessage, type MessageHandlerContext, type ExecFunctionMap } from './messageRouter';
import { FileWatcherManager } from './fileWatcher';

export class StackViewProvider implements vscode.WebviewViewProvider, MessageHandlerContext {
	private view!: vscode.WebviewView; // definite assignment assertion - set in resolveWebviewView
	private branches: BranchRecord[] = [];
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
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, 'media'),
				vscode.Uri.joinPath(this.extensionUri, 'dist'),
				vscode.Uri.joinPath(this.extensionUri, 'dist', 'codicons'),
			],
		};
		webviewView.webview.html = await renderWebviewHtml(webviewView.webview, this.extensionUri);
		webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => routeMessage(message, this));

		if (this.workspaceFolder) this.fileWatcher.watch(this.workspaceFolder);
		void this.refresh();
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
			this.branches = [];
			this.uncommitted = undefined;
			this.lastError = 'Open a workspace folder to view git-spice stacks.';
			this.pushState();
			return;
		}

		const [branchResult, uncommittedResult] = await Promise.all([
			execGitSpice(this.workspaceFolder),
			this.getWorkingCopyChanges(),
		]);

		if ('error' in branchResult) {
			this.branches = [];
			this.lastError = branchResult.error;
		} else {
			this.branches = branchResult.value;
			this.lastError = undefined;
		}

		this.uncommitted = uncommittedResult;
		this.pushState();
	}

	/**
	 * Runs an operation with progress UI, error handling, and refresh.
	 * Simplifies the common pattern of showing progress, handling errors, and refreshing state.
	 *
	 * @param title - Progress notification title
	 * @param operation - Async operation that returns BranchCommandResult
	 * @param successMessage - Message to show on success
	 * @returns true if the operation succeeded, false otherwise
	 */
	private async runBranchCommand(
		title: string,
		operation: () => Promise<BranchCommandResult>,
		successMessage: string,
	): Promise<boolean> {
		let success = false;

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title,
				cancellable: false,
			},
			async (_progress) => {
				try {
					const result = await operation();

					if ('error' in result) {
						void vscode.window.showErrorMessage(result.error);
					} else {
						void vscode.window.showInformationMessage(successMessage);
						success = true;
					}

					await this.refresh();
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					void vscode.window.showErrorMessage(`Unexpected error: ${message}`);
				}
			},
		);

		return success;
	}

	async sync(): Promise<void> {
		if (!this.workspaceFolder) {
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Syncing repository with remote...',
				cancellable: false,
			},
			async (_progress) => {
				try {
					// Execute repo sync with interactive prompt callback
					const result = await execRepoSync(this.workspaceFolder!, async (branchName: string) => {
						// Show VSCode confirmation dialog for each branch deletion
						const answer = await vscode.window.showWarningMessage(
							`Branch '${branchName}' has a closed pull request. Delete this branch?`,
							{ modal: true },
							'Yes',
							'No',
						);
						return answer === 'Yes';
					});

					if ('error' in result) {
						console.error('🔄 Repository sync failed:', result.error);
						void vscode.window.showErrorMessage(`Failed to sync repository: ${result.error}`);
					} else {
						const { deletedBranches, syncedBranches } = result.value;
						let message = `Repository synced successfully.`;

						if (syncedBranches > 0) {
							message += ` ${syncedBranches} branch${syncedBranches === 1 ? '' : 'es'} updated.`;
						}

						if (deletedBranches.length > 0) {
							message += ` Deleted ${deletedBranches.length} branch${deletedBranches.length === 1 ? '' : 'es'}: ${deletedBranches.join(', ')}.`;
						}

						void vscode.window.showInformationMessage(message);
					}

					// Always refresh to reflect current state
					await this.refresh();
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.error('🔄 Unexpected error during repository sync:', message);
					void vscode.window.showErrorMessage(`Unexpected error during repository sync: ${message}`);
				}
			},
		);
	}

	pushState(): void {
		// No undefined check needed - only called when view exists
		const state = buildDisplayState(this.branches, this.lastError, this.uncommitted);
		void this.view.webview.postMessage({ type: 'state', payload: state });
	}

	/**
	 * Opens a changes view for the specified commit, comparing it with its parent.
	 *
	 * @param sha - The commit SHA to view
	 */
	async handleOpenCommitDiff(sha: string): Promise<void> {
		const trimmedSha = requireNonEmpty(sha, 'commit SHA');
		if (!trimmedSha) return;

		const cwd = requireWorkspace(this.workspaceFolder);
		if (!cwd) return;

		try {
			const path = await import('node:path');
			const files = await fetchCommitFiles(cwd, trimmedSha);

			if (files.length === 0) {
				void vscode.window.showInformationMessage('No files changed in this commit.');
				return;
			}

			const resourceList = files.map((file) => {
				const fileUri = vscode.Uri.file(path.join(cwd, file.path));
				const { left, right } = buildCommitDiffUris(fileUri, trimmedSha, file.status);
				return [fileUri, left, right] as [vscode.Uri, vscode.Uri, vscode.Uri];
			});

			await vscode.commands.executeCommand('vscode.changes', `Changes in ${trimmedSha.substring(0, 7)}`, resourceList);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Failed to open commit diff: ${message}`);
		}
	}

	/**
	 * Public method to handle branch commands from VSCode commands
	 */
	public async handleBranchCommand(commandName: string, branchName: string): Promise<void> {
		// Map command names to their exec functions
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
			console.error(`❌ Unknown command: ${commandName}`);
			void vscode.window.showErrorMessage(`Unknown command: ${commandName}`);
			return;
		}

		await this.handleBranchCommandInternal(commandName, branchName, execFunction);
	}

	/**
	 * Handles branch commands with exec function (exposed for message router).
	 */
	async handleBranchCommandInternal(
		commandName: string,
		branchName: string,
		execFunction: (folder: vscode.WorkspaceFolder, branchName: string) => Promise<BranchCommandResult>,
	): Promise<void> {
		const trimmedName = requireNonEmpty(branchName, `branch name for ${commandName}`);
		if (!trimmedName) return;

		if (!requireWorkspace(this.workspaceFolder)) return;

		const title = `${commandName.charAt(0).toUpperCase() + commandName.slice(1)}ing branch: ${trimmedName}`;
		const successMessage = `Branch ${trimmedName} ${commandName}ed successfully.`;

		await this.runBranchCommand(title, () => execFunction(this.workspaceFolder!, trimmedName), successMessage);
	}

	/**
	 * Shows a native VSCode QuickPick menu for branch actions
	 */
	async handleBranchContextMenu(branchName: string): Promise<void> {
		const branch = this.branches.find((b) => b.name === branchName);
		if (!branch) {
			return;
		}

		const isCurrent = branch.current === true;
		const needsRestack =
			branch.down?.needsRestack === true || (branch.ups ?? []).some((link) => link.needsRestack === true);
		const hasPR = Boolean(branch.change);

		type MenuItem = { label: string; action: string; description?: string };
		const items: MenuItem[] = [
			{ label: '$(git-branch) Checkout', action: 'checkout' },
			{ label: '$(tag) Rename...', action: 'rename' },
			{ label: '$(move) Move onto...', action: 'move' },
			{ label: '$(type-hierarchy) Move with children onto...', action: 'upstackMove' },
		];

		if (isCurrent) {
			items.push({ label: '$(edit) Edit', action: 'edit' });
		}

		if (needsRestack) {
			items.push({ label: '$(refresh) Restack', action: 'restack', description: 'Needs restack' });
		}

		items.push({
			label: hasPR ? '$(cloud-upload) Submit' : '$(git-pull-request) Submit (create PR)',
			action: 'submit',
		});

		items.push({ label: '$(fold) Fold', action: 'fold' });
		items.push({ label: '$(fold-down) Squash', action: 'squash' });
		items.push({ label: '$(eye-closed) Untrack', action: 'untrack' });
		items.push({ label: '$(trash) Delete', action: 'delete' });

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: `Actions for branch '${branchName}'`,
		});
		if (!selected) return;

		this.dispatchContextMenuAction(selected.action, branchName);
	}

	/** Dispatches a context menu action to the appropriate handler. */
	private dispatchContextMenuAction(action: string, branchName: string): void {
		const execActions: Record<string, typeof execBranchCheckout> = {
			checkout: execBranchCheckout,
			edit: execBranchEdit,
			restack: execBranchRestack,
			submit: execBranchSubmit,
			fold: execBranchFold,
			squash: execBranchSquash,
			untrack: execBranchUntrack,
		};

		const execFn = execActions[action];
		if (execFn) {
			void this.handleBranchCommandInternal(action, branchName, execFn);
			return;
		}

		const promptActions: Record<string, () => void> = {
			rename: () => void this.handleBranchRenamePrompt(branchName),
			move: () => void this.handleBranchMovePrompt(branchName),
			upstackMove: () => void this.handleUpstackMovePrompt(branchName),
			delete: () => void this.handleBranchDelete(branchName),
		};

		promptActions[action]?.();
	}

	/**
	 * Handles branch deletion with confirmation dialog
	 */
	public async handleBranchDelete(branchName: string): Promise<void> {
		const trimmedName = requireNonEmpty(branchName, 'branch name for delete');
		if (!trimmedName) return;

		if (!requireWorkspace(this.workspaceFolder)) return;

		const confirmed = await vscode.window.showWarningMessage(
			`Delete branch '${trimmedName}'? This will untrack it and delete the local branch.`,
			{ modal: true },
			'Delete',
		);
		if (confirmed !== 'Delete') return;

		await this.runBranchCommand(
			`Deleting branch: ${trimmedName}`,
			() => execBranchDelete(this.workspaceFolder!, trimmedName),
			`Branch ${trimmedName} deleted successfully.`,
		);
	}

	/**
	 * Public method to handle branch rename prompt from VSCode commands
	 */
	public async handleBranchRenamePrompt(branchName: string): Promise<void> {
		const trimmedName = requireNonEmpty(branchName, 'branch name for rename');
		if (!trimmedName) return;

		try {
			const newName = await vscode.window.showInputBox({
				prompt: `Enter new name for branch '${trimmedName}':`,
				value: trimmedName,
				validateInput: (input) => {
					if (!input || !input.trim()) return 'Branch name cannot be empty.';
					if (input.trim() === trimmedName) return 'New name must be different from current name.';
					return null;
				},
			});

			if (newName && newName.trim() && newName !== trimmedName) {
				this.view.webview.postMessage({
					type: 'branchRename',
					branchName: trimmedName,
					newName: newName.trim(),
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Error showing rename prompt: ${message}`);
		}
	}

	/**
	 * Handles branch rename command with new name parameter
	 */
	async handleBranchRename(branchName: string, newName: string): Promise<void> {
		const validated = requireAllNonEmpty([
			[branchName, 'branch name for rename'],
			[newName, 'new name for rename'],
		]);
		if (!validated) return;
		const [trimmedBranch, trimmedNew] = validated;

		if (!requireWorkspace(this.workspaceFolder)) return;

		await this.runBranchCommand(
			`Renaming branch: ${trimmedBranch} → ${trimmedNew}`,
			() => execBranchRename(this.workspaceFolder!, trimmedBranch, trimmedNew),
			`Branch renamed from ${trimmedBranch} to ${trimmedNew} successfully.`,
		);
	}

	/**
	 * Prompts user to select a new parent branch for the move operation
	 */
	public async handleBranchMovePrompt(branchName: string): Promise<void> {
		const trimmedName = requireNonEmpty(branchName, 'branch name for move');
		if (!trimmedName) return;

		const availableParents = this.branches.filter((b) => b.name !== trimmedName).map((b) => b.name);

		if (availableParents.length === 0) {
			void vscode.window.showWarningMessage('No other branches available to move onto.');
			return;
		}

		const selected = await vscode.window.showQuickPick(availableParents, {
			placeHolder: `Select new parent for '${trimmedName}'`,
			title: 'Move Branch Onto...',
		});

		if (selected) {
			void this.handleBranchMove(trimmedName, selected);
		}
	}

	/**
	 * Moves a branch to a new parent (reparents it).
	 */
	async handleBranchMove(branchName: string, newParent: string): Promise<void> {
		const validated = requireAllNonEmpty([
			[branchName, 'branch name for move'],
			[newParent, 'parent name for move'],
		]);
		if (!validated) return;
		const [trimmedBranch, trimmedParent] = validated;

		if (!requireWorkspace(this.workspaceFolder)) return;

		await this.runBranchCommand(
			`Moving branch: ${trimmedBranch} → ${trimmedParent}`,
			() => execBranchMove(this.workspaceFolder!, trimmedBranch, trimmedParent),
			`Branch ${trimmedBranch} moved onto ${trimmedParent} successfully.`,
		);
	}

	/**
	 * Prompts user to select a new parent branch for moving with children
	 */
	public async handleUpstackMovePrompt(branchName: string): Promise<void> {
		const trimmedName = requireNonEmpty(branchName, 'branch name for upstack move');
		if (!trimmedName) return;

		const availableParents = this.branches.filter((b) => b.name !== trimmedName).map((b) => b.name);

		if (availableParents.length === 0) {
			void vscode.window.showWarningMessage('No other branches available to move onto.');
			return;
		}

		const selected = await vscode.window.showQuickPick(availableParents, {
			placeHolder: `Select new parent for '${trimmedName}' and its children`,
			title: 'Move Branch with Children Onto...',
		});

		if (selected) {
			void this.handleUpstackMove(trimmedName, selected);
		}
	}

	/**
	 * Moves a branch and all its descendants to a new parent.
	 */
	async handleUpstackMove(branchName: string, newParent: string): Promise<void> {
		const validated = requireAllNonEmpty([
			[branchName, 'branch name for upstack move'],
			[newParent, 'parent name for upstack move'],
		]);
		if (!validated) return;
		const [trimmedBranch, trimmedParent] = validated;

		if (!requireWorkspace(this.workspaceFolder)) return;

		await this.runBranchCommand(
			`Moving branch with children: ${trimmedBranch} → ${trimmedParent}`,
			() => execUpstackMove(this.workspaceFolder!, trimmedBranch, trimmedParent),
			`Branch ${trimmedBranch} and children moved onto ${trimmedParent} successfully.`,
		);
	}

	/**
	 * Handles copying a commit SHA to the clipboard
	 */
	public async handleCommitCopySha(sha: string): Promise<void> {
		const trimmedSha = requireNonEmpty(sha, 'commit SHA');
		if (!trimmedSha) return;

		try {
			await vscode.env.clipboard.writeText(trimmedSha);
			void vscode.window.showInformationMessage(`Copied commit SHA: ${trimmedSha.substring(0, 8)}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('❌ Error copying SHA to clipboard:', message);
			void vscode.window.showErrorMessage(`Failed to copy SHA: ${message}`);
		}
	}

	/**
	 * Handles creating a fixup commit for the specified commit.
	 */
	async handleCommitFixup(sha: string): Promise<void> {
		const trimmedSha = requireNonEmpty(sha, 'commit SHA');
		if (!trimmedSha) return;

		if (!requireWorkspace(this.workspaceFolder)) return;

		await this.runBranchCommand(
			`Creating fixup commit for ${trimmedSha.substring(0, 8)}`,
			() => execCommitFixup(this.workspaceFolder!, trimmedSha),
			`Fixup commit created for ${trimmedSha.substring(0, 8)}`,
		);
	}

	/**
	 * Handles splitting a branch at the specified commit.
	 */
	public async handleCommitSplit(sha: string, branchName: string): Promise<void> {
		const validated = requireAllNonEmpty([
			[sha, 'commit SHA'],
			[branchName, 'branch name'],
		]);
		if (!validated) return;
		const [trimmedSha, trimmedBranch] = validated;

		if (!requireWorkspace(this.workspaceFolder)) return;

		const newBranchName = await vscode.window.showInputBox({
			prompt: `Enter name for the new branch that will be created at commit ${trimmedSha.substring(0, 8)}`,
			placeHolder: 'new-branch-name',
			validateInput: (input) => {
				if (!input || !input.trim()) return 'Branch name cannot be empty.';
				if (!/^[a-zA-Z0-9/_-]+$/.test(input.trim())) return 'Branch name contains invalid characters.';
				return null;
			},
		});

		if (!newBranchName || !newBranchName.trim()) return;

		console.log('🔄 Executing branch split for:', trimmedBranch, 'at:', trimmedSha, 'new branch:', newBranchName);

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: `Splitting branch ${trimmedBranch} at ${trimmedSha.substring(0, 8)}`,
				cancellable: false,
			},
			async (_progress) => {
				try {
					const result = await execBranchSplit(this.workspaceFolder!, trimmedBranch, trimmedSha, newBranchName.trim());

					if ('error' in result) {
						console.error('🔄 Branch split failed:', result.error);
						void vscode.window.showErrorMessage(`Failed to split branch: ${result.error}`);
					} else {
						console.log('🔄 Branch split successful');
						void vscode.window.showInformationMessage(
							`Branch ${trimmedBranch} split at ${trimmedSha.substring(0, 8)} → ${newBranchName}`,
						);
					}

					await this.refresh();
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.error('🔄 Unexpected error during branch split:', message);
					void vscode.window.showErrorMessage(`Unexpected error during branch split: ${message}`);
				}
			},
		);
	}

	/** Fetches the list of files changed in a commit and sends it to the webview. */
	async handleGetCommitFiles(sha: string): Promise<void> {
		if (!this.workspaceFolder) return;

		try {
			const files = await fetchCommitFiles(this.workspaceFolder.uri.fsPath, sha);
			void this.view.webview.postMessage({ type: 'commitFiles', sha, files });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void this.view.webview.postMessage({ type: 'commitFiles', sha, files: [] });
		}
	}

	/** Opens a diff view for a single file in a commit. */
	async handleOpenFileDiff(sha: string, filePath: string): Promise<void> {
		if (!this.workspaceFolder) {
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		try {
			const path = await import('node:path');
			const absolutePath = path.join(this.workspaceFolder.uri.fsPath, filePath);
			const fileUri = vscode.Uri.file(absolutePath);

			const files = await fetchCommitFiles(this.workspaceFolder.uri.fsPath, sha);
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

	/**
	 * Opens the current version of a file in the editor.
	 */
	async handleOpenCurrentFile(filePath: string): Promise<void> {
		if (!this.workspaceFolder) {
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		try {
			const path = await import('node:path');
			const absolutePath = path.join(this.workspaceFolder.uri.fsPath, filePath);
			const fileUri = vscode.Uri.file(absolutePath);

			await vscode.window.showTextDocument(fileUri);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('❌ Error opening current file:', message);
			void vscode.window.showErrorMessage(`Failed to open file: ${message}`);
		}
	}

	/** Fetches uncommitted changes from git status. */
	private getWorkingCopyChanges(): Promise<UncommittedState> {
		return fetchWorkingCopyChanges(this.workspaceFolder?.uri.fsPath);
	}

	/** Stages a file using git add. */
	async handleStageFile(filePath: string): Promise<void> {
		if (!this.workspaceFolder) return;
		try {
			await stageFile(this.workspaceFolder.uri.fsPath, filePath);
			await this.refresh();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Failed to stage file: ${message}`);
		}
	}

	/** Unstages a file using git restore --staged. */
	async handleUnstageFile(filePath: string): Promise<void> {
		if (!this.workspaceFolder) return;
		try {
			await unstageFile(this.workspaceFolder.uri.fsPath, filePath);
			await this.refresh();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Failed to unstage file: ${message}`);
		}
	}

	/** Discards changes to a file using git restore (with confirmation). */
	async handleDiscardFile(filePath: string): Promise<void> {
		if (!this.workspaceFolder) return;

		const confirmed = await vscode.window.showWarningMessage(
			`Discard changes to '${filePath}'? This cannot be undone.`,
			{ modal: true },
			'Discard',
		);
		if (confirmed !== 'Discard') return;

		try {
			await discardFile(this.workspaceFolder.uri.fsPath, filePath);
			await this.refresh();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Failed to discard changes: ${message}`);
		}
	}

	/**
	 * Opens a diff for a working copy file.
	 */
	async handleOpenWorkingCopyDiff(filePath: string, staged: boolean): Promise<void> {
		if (!this.workspaceFolder) {
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		try {
			const path = await import('node:path');
			const absolutePath = path.join(this.workspaceFolder.uri.fsPath, filePath);
			const fileUri = vscode.Uri.file(absolutePath);

			const fileName = path.basename(filePath);
			const { left, right } = buildWorkingCopyDiffUris(fileUri, staged);
			const title = staged ? `${fileName} (Staged)` : `${fileName} (Working Copy)`;
			await vscode.commands.executeCommand('vscode.diff', left, right, title);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('❌ Error opening working copy diff:', message);
			void vscode.window.showErrorMessage(`Failed to open diff: ${message}`);
		}
	}

	/**
	 * Ensures there are staged changes before committing.
	 * If nothing is staged but unstaged changes exist, prompts to stage all.
	 * @returns true if staged changes are ready, false if the user cancelled.
	 */
	private async ensureStagedChanges(): Promise<boolean> {
		const hasStagedChanges = (this.uncommitted?.staged.length ?? 0) > 0;
		if (hasStagedChanges) return true;

		const hasUnstagedChanges = (this.uncommitted?.unstaged.length ?? 0) > 0;
		if (!hasUnstagedChanges) {
			void vscode.window.showInformationMessage('There are no changes to commit.');
			return false;
		}

		return this.promptStageAll();
	}

	/** Prompts to stage all unstaged changes. Returns true if staged. */
	private async promptStageAll(): Promise<boolean> {
		const choice = await vscode.window.showWarningMessage(
			'There are no staged changes to commit.\n\nWould you like to stage all your changes and commit them directly?',
			{ modal: true },
			'Yes',
		);
		if (choice !== 'Yes') return false;

		return this.stageAllChanges();
	}

	/** Stages all changes via git add -A. */
	private async stageAllChanges(): Promise<boolean> {
		try {
			await stageAllFiles(this.workspaceFolder!.uri.fsPath);
			return true;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			void vscode.window.showErrorMessage(`Failed to stage changes: ${msg}`);
			return false;
		}
	}

	/** Commits staged changes with the given message. */
	async handleCommitChanges(message: string): Promise<void> {
		if (!this.workspaceFolder) {
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		const trimmedMessage = message.trim();
		if (trimmedMessage.length === 0) {
			void vscode.window.showErrorMessage('Commit message cannot be empty.');
			return;
		}

		const ready = await this.ensureStagedChanges();
		if (!ready) return;

		await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: 'Committing changes...', cancellable: false },
			async () => {
				try {
					await commitChanges(this.workspaceFolder!.uri.fsPath, trimmedMessage);
					void vscode.window.showInformationMessage('Changes committed successfully.');
					await this.refresh();
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					void vscode.window.showErrorMessage(`Failed to commit: ${msg}`);
				}
			},
		);
	}

	/**
	 * Creates a new branch with the given commit message.
	 */
	async handleCreateBranch(message: string): Promise<void> {
		if (!this.workspaceFolder) {
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		const trimmedMessage = message.trim();
		if (trimmedMessage.length === 0) {
			void vscode.window.showErrorMessage('Commit message cannot be empty.');
			return;
		}

		const ready = await this.ensureStagedChanges();
		if (!ready) return;

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Creating new branch...',
				cancellable: false,
			},
			async () => {
				const result = await execBranchCreate(this.workspaceFolder!, trimmedMessage);

				if ('error' in result) {
					console.error('❌ Error creating branch:', result.error);
					void vscode.window.showErrorMessage(`Failed to create branch: ${result.error}`);
				} else {
					void vscode.window.showInformationMessage('Branch created successfully.');
				}

				await this.refresh();
			},
		);
	}

	/** Returns the map of exec functions for the message router. */
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

	dispose(): void {
		this.fileWatcher.dispose();
	}
}
