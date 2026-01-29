import * as vscode from 'vscode';

import { buildDisplayState } from './state';
import type { BranchRecord, CommitFileChange, FileChangeStatus, UncommittedState, WorkingCopyChange } from './types';
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
import { readMediaFile, readDistFile } from '../utils/readFileSync';
import { execGit } from '../utils/git';
import { buildCommitDiffUris, buildWorkingCopyDiffUris } from '../utils/diffUri';
import { requireNonEmpty, requireWorkspace, requireAllNonEmpty } from '../utils/validation';

export class StackViewProvider implements vscode.WebviewViewProvider {
	private view!: vscode.WebviewView; // definite assignment assertion - set in resolveWebviewView
	private branches: BranchRecord[] = [];
	private uncommitted: UncommittedState | undefined;
	private lastError: string | undefined;
	private gitWatcher: vscode.FileSystemWatcher | undefined;
	private workspaceWatcher: vscode.FileSystemWatcher | undefined;
	private saveListener: vscode.Disposable | undefined;
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private workspaceFolder: vscode.WorkspaceFolder | undefined,
		private readonly extensionUri: vscode.Uri,
	) {
		// No initialization here - everything happens after resolveWebviewView
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
		webviewView.webview.html = await this.renderHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
			switch (message.type) {
				case 'ready':
					this.pushState();
					return;
				case 'refresh':
					void this.refresh();
					return;
				case 'openChange':
					if (typeof message.url === 'string') {
						void vscode.env.openExternal(vscode.Uri.parse(message.url));
					}
					return;
				case 'openCommit':
					if (typeof message.sha === 'string') {
						void vscode.commands.executeCommand('git.openCommit', message.sha);
					}
					return;
				case 'openCommitDiff':
					if (typeof message.sha === 'string') {
						void this.handleOpenCommitDiff(message.sha);
					}
					return;
				case 'branchContextMenu':
					if (typeof message.branchName === 'string') {
						void this.handleBranchContextMenu(message.branchName);
					}
					return;
				case 'branchUntrack':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('untrack', message.branchName, execBranchUntrack);
					}
					return;
				case 'branchDelete':
					if (typeof message.branchName === 'string') {
						void this.handleBranchDelete(message.branchName);
					}
					return;
				case 'branchCheckout':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('checkout', message.branchName, execBranchCheckout);
					}
					return;
				case 'branchFold':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('fold', message.branchName, execBranchFold);
					}
					return;
				case 'branchSquash':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('squash', message.branchName, execBranchSquash);
					}
					return;
				case 'branchEdit':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('edit', message.branchName, execBranchEdit);
					}
					return;
				case 'branchRenamePrompt':
					if (typeof message.branchName === 'string') {
						void this.handleBranchRenamePrompt(message.branchName);
					}
					return;
				case 'branchRename':
					if (typeof message.branchName === 'string' && typeof message.newName === 'string') {
						void this.handleBranchRename(message.branchName, message.newName);
					}
					return;
				case 'branchRestack':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('restack', message.branchName, execBranchRestack);
					}
					return;
				case 'branchSubmit':
					if (typeof message.branchName === 'string') {
						void this.handleBranchCommandInternal('submit', message.branchName, execBranchSubmit);
					}
					return;
				case 'commitCopySha':
					if (typeof message.sha === 'string') {
						void this.handleCommitCopySha(message.sha);
					}
					return;
				case 'commitFixup':
					if (typeof message.sha === 'string') {
						void this.handleCommitFixup(message.sha);
					}
					return;
				case 'commitSplit':
					if (typeof message.sha === 'string' && typeof message.branchName === 'string') {
						void this.handleCommitSplit(message.sha, message.branchName);
					}
					return;
				case 'branchMovePrompt':
					if (typeof message.branchName === 'string') {
						void this.handleBranchMovePrompt(message.branchName);
					}
					return;
				case 'branchMove':
					if (typeof message.branchName === 'string' && typeof message.newParent === 'string') {
						void this.handleBranchMove(message.branchName, message.newParent);
					}
					return;
				case 'upstackMovePrompt':
					if (typeof message.branchName === 'string') {
						void this.handleUpstackMovePrompt(message.branchName);
					}
					return;
				case 'upstackMove':
					if (typeof message.branchName === 'string' && typeof message.newParent === 'string') {
						void this.handleUpstackMove(message.branchName, message.newParent);
					}
					return;
				case 'getCommitFiles':
					if (typeof message.sha === 'string') {
						void this.handleGetCommitFiles(message.sha);
					}
					return;
				case 'openFileDiff':
					if (typeof message.sha === 'string' && typeof message.path === 'string') {
						void this.handleOpenFileDiff(message.sha, message.path);
					}
					return;
				case 'openCurrentFile':
					if (typeof message.path === 'string') {
						void this.handleOpenCurrentFile(message.path);
					}
					return;
				case 'stageFile':
					if (typeof message.path === 'string') {
						void this.handleStageFile(message.path);
					}
					return;
				case 'unstageFile':
					if (typeof message.path === 'string') {
						void this.handleUnstageFile(message.path);
					}
					return;
				case 'discardFile':
					if (typeof message.path === 'string') {
						void this.handleDiscardFile(message.path);
					}
					return;
				case 'openWorkingCopyDiff':
					if (typeof message.path === 'string' && typeof message.staged === 'boolean') {
						void this.handleOpenWorkingCopyDiff(message.path, message.staged);
					}
					return;
				case 'commitChanges':
					if (typeof message.message === 'string') {
						void this.handleCommitChanges(message.message);
					}
					return;
				case 'createBranch':
					if (typeof message.message === 'string') {
						void this.handleCreateBranch(message.message);
					}
					return;
				default:
					return;
			}
		});

		this.setupFileWatcher();
		void this.refresh();
	}

	setWorkspaceFolder(folder: vscode.WorkspaceFolder | undefined): void {
		this.workspaceFolder = folder;
		this.setupFileWatcher();
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
			this.fetchWorkingCopyChanges(),
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

	private pushState(): void {
		// No undefined check needed - only called when view exists
		const state = buildDisplayState(this.branches, this.lastError, this.uncommitted);
		void this.view.webview.postMessage({ type: 'state', payload: state });
	}

	/**
	 * Opens a changes view for the specified commit, comparing it with its parent.
	 * Gets the list of files changed in the commit and opens them in a single changes editor.
	 *
	 * @param sha - The commit SHA to view
	 */
	private async handleOpenCommitDiff(sha: string): Promise<void> {
		// Validate input
		if (typeof sha !== 'string' || sha.trim() === '') {
			console.error('❌ Invalid commit SHA provided to handleOpenCommitDiff:', sha);
			return;
		}

		// Validate workspace folder
		if (!this.workspaceFolder) {
			console.error('❌ No workspace folder available for commit diff');
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		try {
			// Get the list of files changed in this commit with their status
			const path = await import('node:path');

			// Use git diff-tree to get changed files with status
			const { stdout } = await execGit(this.workspaceFolder.uri.fsPath, [
				'diff-tree',
				'--no-commit-id',
				'--name-status',
				'-r',
				sha,
			]);

			const lines = stdout
				.trim()
				.split('\n')
				.filter((l) => l.length > 0);

			if (lines.length === 0) {
				void vscode.window.showInformationMessage('No files changed in this commit.');
				return;
			}

			const resourceList: [vscode.Uri, vscode.Uri, vscode.Uri][] = [];

			for (const line of lines) {
				const match = line.match(/^([A-Z])\t(.+)$/);
				if (!match) {
					continue;
				}

				const [, status, file] = match;
				const absolutePath = path.join(this.workspaceFolder!.uri.fsPath, file);
				const fileUri = vscode.Uri.file(absolutePath);

				const { left, right } = buildCommitDiffUris(fileUri, sha, status as FileChangeStatus);
				resourceList.push([fileUri, left, right]);
			}

			const title = `Changes in ${sha.substring(0, 7)}`;

			// Use vscode.changes to open all files in a single changes editor
			await vscode.commands.executeCommand('vscode.changes', title, resourceList);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('❌ Error opening commit diff:', message);
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
	 * Internal method to handle branch commands with exec function.
	 */
	private async handleBranchCommandInternal(
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
	private async handleBranchContextMenu(branchName: string): Promise<void> {
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

		if (!selected) {
			return;
		}

		switch (selected.action) {
			case 'checkout':
				void this.handleBranchCommandInternal('checkout', branchName, execBranchCheckout);
				break;
			case 'rename':
				void this.handleBranchRenamePrompt(branchName);
				break;
			case 'move':
				void this.handleBranchMovePrompt(branchName);
				break;
			case 'upstackMove':
				void this.handleUpstackMovePrompt(branchName);
				break;
			case 'edit':
				void this.handleBranchCommandInternal('edit', branchName, execBranchEdit);
				break;
			case 'restack':
				void this.handleBranchCommandInternal('restack', branchName, execBranchRestack);
				break;
			case 'submit':
				void this.handleBranchCommandInternal('submit', branchName, execBranchSubmit);
				break;
			case 'fold':
				void this.handleBranchCommandInternal('fold', branchName, execBranchFold);
				break;
			case 'squash':
				void this.handleBranchCommandInternal('squash', branchName, execBranchSquash);
				break;
			case 'untrack':
				void this.handleBranchCommandInternal('untrack', branchName, execBranchUntrack);
				break;
			case 'delete':
				void this.handleBranchDelete(branchName);
				break;
		}
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
	private async handleBranchRename(branchName: string, newName: string): Promise<void> {
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
	private async handleBranchMove(branchName: string, newParent: string): Promise<void> {
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
	private async handleUpstackMove(branchName: string, newParent: string): Promise<void> {
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
	private async handleCommitFixup(sha: string): Promise<void> {
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

	/**
	 * Fetches the list of files changed in a commit and sends it to the webview.
	 */
	private async handleGetCommitFiles(sha: string): Promise<void> {
		if (!this.workspaceFolder) {
			return;
		}

		try {
			const files = await this.fetchCommitFiles(sha);
			void this.view.webview.postMessage({ type: 'commitFiles', sha, files });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('❌ Error fetching commit files:', message);
			void this.view.webview.postMessage({ type: 'commitFiles', sha, files: [] });
		}
	}

	/**
	 * Parses git diff-tree output and returns file changes.
	 */
	private async fetchCommitFiles(sha: string): Promise<CommitFileChange[]> {
		const { stdout } = await execGit(this.workspaceFolder!.uri.fsPath, [
			'diff-tree',
			'--no-commit-id',
			'--name-status',
			'-r',
			sha,
		]);

		const lines = stdout
			.trim()
			.split('\n')
			.filter((l) => l.length > 0);
		const files: CommitFileChange[] = [];

		for (const line of lines) {
			const match = line.match(/^([A-Z])\t(.+)$/);
			if (!match) {
				continue;
			}

			const [, statusChar, filePath] = match;
			files.push({
				status: statusChar as FileChangeStatus,
				path: filePath,
			});
		}

		return files;
	}

	/**
	 * Opens a diff view for a single file in a commit.
	 */
	private async handleOpenFileDiff(sha: string, filePath: string): Promise<void> {
		if (!this.workspaceFolder) {
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		try {
			const path = await import('node:path');
			const absolutePath = path.join(this.workspaceFolder.uri.fsPath, filePath);
			const fileUri = vscode.Uri.file(absolutePath);

			// Determine file status to handle added/deleted files properly
			const files = await this.fetchCommitFiles(sha);
			const fileChange = files.find((f) => f.path === filePath);
			const status = fileChange?.status ?? 'M';

			const { left: leftUri, right: rightUri } = buildCommitDiffUris(fileUri, sha, status);

			const fileName = path.basename(filePath);
			const title = `${fileName} (${sha.substring(0, 7)})`;

			await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('❌ Error opening file diff:', message);
			void vscode.window.showErrorMessage(`Failed to open file diff: ${message}`);
		}
	}

	/**
	 * Opens the current version of a file in the editor.
	 */
	private async handleOpenCurrentFile(filePath: string): Promise<void> {
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

	/**
	 * Fetches the current working copy changes (staged and unstaged).
	 */
	private async fetchWorkingCopyChanges(): Promise<UncommittedState> {
		if (!this.workspaceFolder) {
			return { staged: [], unstaged: [] };
		}

		try {
			const { stdout } = await execGit(this.workspaceFolder.uri.fsPath, [
				'status',
				'--porcelain=v1',
				'--untracked-files=all',
			]);
			return this.parseGitStatusOutput(stdout);
		} catch (error) {
			console.error('❌ Error fetching working copy changes:', error);
			return { staged: [], unstaged: [] };
		}
	}

	/**
	 * Parses git status --porcelain output into staged and unstaged changes.
	 * Format: XY PATH where X = staged status, Y = unstaged status
	 */
	private parseGitStatusOutput(stdout: string): UncommittedState {
		const staged: WorkingCopyChange[] = [];
		const unstaged: WorkingCopyChange[] = [];

		for (const line of stdout.split('\n')) {
			if (line.length < 3) {
				continue;
			}

			const stagedStatus = line[0];
			const unstagedStatus = line[1];
			const filePath = line.slice(3);

			if (stagedStatus !== ' ' && stagedStatus !== '?') {
				staged.push({
					path: filePath,
					status: this.mapGitStatusChar(stagedStatus),
				});
			}

			if (unstagedStatus !== ' ') {
				unstaged.push({
					path: filePath,
					status: this.mapGitStatusChar(unstagedStatus),
				});
			}
		}

		return { staged, unstaged };
	}

	private mapGitStatusChar(char: string): FileChangeStatus {
		const statusMap: Record<string, FileChangeStatus> = {
			A: 'A',
			M: 'M',
			D: 'D',
			R: 'R',
			C: 'C',
			T: 'T',
			'?': 'U',
		};
		return statusMap[char] ?? 'M';
	}

	/**
	 * Stages a file using git add.
	 */
	private async handleStageFile(filePath: string): Promise<void> {
		if (!this.workspaceFolder) {
			return;
		}

		try {
			await execGit(this.workspaceFolder.uri.fsPath, ['add', '--', filePath]);
			await this.refresh();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('❌ Error staging file:', message);
			void vscode.window.showErrorMessage(`Failed to stage file: ${message}`);
		}
	}

	/**
	 * Unstages a file using git restore --staged.
	 */
	private async handleUnstageFile(filePath: string): Promise<void> {
		if (!this.workspaceFolder) {
			return;
		}

		try {
			await execGit(this.workspaceFolder.uri.fsPath, ['restore', '--staged', '--', filePath]);
			await this.refresh();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('❌ Error unstaging file:', message);
			void vscode.window.showErrorMessage(`Failed to unstage file: ${message}`);
		}
	}

	/**
	 * Discards changes to a file using git restore (with confirmation).
	 */
	private async handleDiscardFile(filePath: string): Promise<void> {
		if (!this.workspaceFolder) {
			return;
		}

		const confirmed = await vscode.window.showWarningMessage(
			`Discard changes to '${filePath}'? This cannot be undone.`,
			{ modal: true },
			'Discard',
		);

		if (confirmed !== 'Discard') {
			return;
		}

		try {
			await execGit(this.workspaceFolder.uri.fsPath, ['restore', '--', filePath]);
			await this.refresh();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('❌ Error discarding file:', message);
			void vscode.window.showErrorMessage(`Failed to discard changes: ${message}`);
		}
	}

	/**
	 * Opens a diff for a working copy file.
	 */
	private async handleOpenWorkingCopyDiff(filePath: string, staged: boolean): Promise<void> {
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

	/** Stages all changes via `git add -A`. */
	private async stageAllChanges(): Promise<boolean> {
		try {
			await execGit(this.workspaceFolder!.uri.fsPath, ['add', '-A']);
			return true;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.error('❌ Error staging all changes:', msg);
			void vscode.window.showErrorMessage(`Failed to stage changes: ${msg}`);
			return false;
		}
	}

	/**
	 * Commits staged changes with the given message.
	 */
	private async handleCommitChanges(message: string): Promise<void> {
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
				title: 'Committing changes...',
				cancellable: false,
			},
			async () => {
				try {
					await execGit(this.workspaceFolder!.uri.fsPath, ['commit', '-m', trimmedMessage]);
					void vscode.window.showInformationMessage('Changes committed successfully.');
					await this.refresh();
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					console.error('❌ Error committing changes:', msg);
					void vscode.window.showErrorMessage(`Failed to commit: ${msg}`);
				}
			},
		);
	}

	/**
	 * Creates a new branch with the given commit message.
	 */
	private async handleCreateBranch(message: string): Promise<void> {
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

	/** Debounced refresh — coalesces rapid file-system events into a single refresh. */
	private debouncedRefresh(): void {
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => {
			void this.refresh();
		}, 300);
	}

	private setupFileWatcher(): void {
		this.disposeWatchers();

		if (!this.workspaceFolder || !this.view) return;

		this.setupGitWatcher();
		this.setupWorkspaceWatcher();
		this.setupSaveListener();
	}

	/** Watches .git internals for branch/index/spice-data changes. */
	private setupGitWatcher(): void {
		const gitDir = vscode.Uri.joinPath(this.workspaceFolder!.uri, '.git');
		const pattern = new vscode.RelativePattern(gitDir, '{refs/spice/data,HEAD,refs/heads/**,index}');
		this.gitWatcher = vscode.workspace.createFileSystemWatcher(pattern);

		const handler = () => this.debouncedRefresh();
		this.gitWatcher.onDidChange(handler);
		this.gitWatcher.onDidCreate(handler);
		this.gitWatcher.onDidDelete(handler);
	}

	/** Watches workspace files for working-copy changes (edits, creates, deletes). */
	private setupWorkspaceWatcher(): void {
		const pattern = new vscode.RelativePattern(this.workspaceFolder!.uri, '**/*');
		this.workspaceWatcher = vscode.workspace.createFileSystemWatcher(pattern);

		const handler = () => this.debouncedRefresh();
		this.workspaceWatcher.onDidChange(handler);
		this.workspaceWatcher.onDidCreate(handler);
		this.workspaceWatcher.onDidDelete(handler);
	}

	/** Listens for in-editor document saves (more reliable than FS watcher for edits). */
	private setupSaveListener(): void {
		this.saveListener = vscode.workspace.onDidSaveTextDocument(() => {
			this.debouncedRefresh();
		});
	}

	private disposeWatchers(): void {
		this.gitWatcher?.dispose();
		this.gitWatcher = undefined;
		this.workspaceWatcher?.dispose();
		this.workspaceWatcher = undefined;
		this.saveListener?.dispose();
		this.saveListener = undefined;
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	}

	dispose(): void {
		this.disposeWatchers();
	}

	private async renderHtml(webview: vscode.Webview): Promise<string> {
		const nonce = getNonce();
		const csp = [
			`default-src 'none'`,
			`img-src ${webview.cspSource} https:`,
			`style-src ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`,
			`font-src ${webview.cspSource}`,
		].join('; ');

		const mediaUri = (name: string) =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name)).toString();
		const distUri = (name: string) =>
			webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', name)).toString();
		const codiconStyleUri = distUri('codicons/codicon.css');
		const template = await readMediaFile(this.extensionUri, 'stackView.html');

		return template
			.replace('{{csp}}', csp)
			.replace('{{codiconStyleUri}}', codiconStyleUri)
			.replace('{{styleUri}}', mediaUri('stackView.css'))
			.replace('{{scriptUri}}', distUri('stackView.js'))
			.replace('{{nonce}}', nonce);
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i += 1) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
