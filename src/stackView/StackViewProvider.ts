import * as vscode from 'vscode';

import { buildDisplayState } from './state';
import type { BranchRecord } from './types';
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
	type BranchCommandResult,
} from '../utils/gitSpice';
import { readMediaFile, readDistFile } from '../utils/readFileSync';

export class StackViewProvider implements vscode.WebviewViewProvider {
	private view!: vscode.WebviewView; // definite assignment assertion - set in resolveWebviewView
	private branches: BranchRecord[] = [];
	private lastError: string | undefined;
	private fileWatcher: vscode.FileSystemWatcher | undefined;

	constructor(private workspaceFolder: vscode.WorkspaceFolder | undefined, private readonly extensionUri: vscode.Uri) {
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
			this.lastError = 'Open a workspace folder to view git-spice stacks.';
			this.pushState();
			return;
		}

		const result = await execGitSpice(this.workspaceFolder);
		if ('error' in result) {
			this.branches = [];
			this.lastError = result.error;
		} else {
			this.branches = result.value;
			this.lastError = undefined;
		}

		this.pushState();
	}

	async sync(): Promise<void> {
		if (!this.workspaceFolder) {
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: 'Syncing repository with remote...',
			cancellable: false,
		}, async (progress) => {
			try {
				// Execute repo sync with interactive prompt callback
				const result = await execRepoSync(
					this.workspaceFolder!,
					async (branchName: string) => {
						// Show VSCode confirmation dialog for each branch deletion
						const answer = await vscode.window.showWarningMessage(
							`Branch '${branchName}' has a closed pull request. Delete this branch?`,
							{ modal: true },
							'Yes',
							'No',
						);
						return answer === 'Yes';
					}
				);

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
		});
	}

	private pushState(): void {
		// No undefined check needed - only called when view exists
		const state = buildDisplayState(this.branches, this.lastError);
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
			const { execFile } = await import('node:child_process');
			const { promisify } = await import('node:util');
			const path = await import('node:path');
			const execFileAsync = promisify(execFile);

			// Use git diff-tree to get changed files with status
			// --no-commit-id: suppress commit ID output
			// --name-status: show file names with status (A=added, M=modified, D=deleted)
			// -r: recursive
			const { stdout } = await execFileAsync(
				'git',
				['diff-tree', '--no-commit-id', '--name-status', '-r', sha],
				{ cwd: this.workspaceFolder.uri.fsPath }
			);

			const lines = stdout.trim().split('\n').filter(l => l.length > 0);

			if (lines.length === 0) {
				void vscode.window.showInformationMessage('No files changed in this commit.');
				return;
			}

			// Build resource list for vscode.changes command
			// Each entry must be a tuple of [label, left, right] where all are URIs
			const parentRef = `${sha}^`;
			const commitRef = sha;
			// Git's empty tree SHA - used for new files that don't exist in parent
			const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

			const resourceList: [vscode.Uri, vscode.Uri | undefined, vscode.Uri | undefined][] = [];
			
			for (const line of lines) {
				// Parse status and file path (format: "M\tfile.txt" or "A\tfile.txt")
				const match = line.match(/^([A-Z])\t(.+)$/);
				if (!match) {
					continue;
				}

				const [, status, file] = match;
				
				// Construct absolute file path
				const absolutePath = path.join(this.workspaceFolder!.uri.fsPath, file);
				const fileUri = vscode.Uri.file(absolutePath);

				let leftUri: vscode.Uri | undefined;
				let rightUri: vscode.Uri | undefined;

				if (status === 'A') {
					// Added file: compare empty tree to commit version
					const leftQuery = JSON.stringify({ path: fileUri.fsPath, ref: emptyTree });
					const rightQuery = JSON.stringify({ path: fileUri.fsPath, ref: commitRef });
					leftUri = fileUri.with({ scheme: 'git', query: leftQuery });
					rightUri = fileUri.with({ scheme: 'git', query: rightQuery });
				} else if (status === 'D') {
					// Deleted file: compare parent to empty tree
					const leftQuery = JSON.stringify({ path: fileUri.fsPath, ref: parentRef });
					const rightQuery = JSON.stringify({ path: fileUri.fsPath, ref: emptyTree });
					leftUri = fileUri.with({ scheme: 'git', query: leftQuery });
					rightUri = fileUri.with({ scheme: 'git', query: rightQuery });
				} else {
					// Modified file: compare parent to commit
					const leftQuery = JSON.stringify({ path: fileUri.fsPath, ref: parentRef });
					const rightQuery = JSON.stringify({ path: fileUri.fsPath, ref: commitRef });
					leftUri = fileUri.with({ scheme: 'git', query: leftQuery });
					rightUri = fileUri.with({ scheme: 'git', query: rightQuery });
				}

				// Add as tuple: [label, left, right]
				// Use the file URI as the label
				resourceList.push([fileUri, leftUri, rightUri]);
			}

			const title = `Changes in ${sha.substring(0, 7)}`;

			// Use vscode.changes to open all files in a single changes editor
			await vscode.commands.executeCommand(
				'vscode.changes',
				title,
				resourceList
			);
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
		const commandMap: Record<string, (folder: vscode.WorkspaceFolder, branchName: string) => Promise<BranchCommandResult>> = {
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
	 * Internal method to handle branch commands with exec function
	 */
	private async handleBranchCommandInternal(
		commandName: string,
		branchName: string,
		execFunction: (folder: vscode.WorkspaceFolder, branchName: string) => Promise<BranchCommandResult>,
	): Promise<void> {
		// Validate input
		const trimmedName = typeof branchName === 'string' ? branchName.trim() : '';
		if (trimmedName.length === 0) {
			console.error(`❌ Invalid branch name provided to handleBranchCommand (${commandName}):`, branchName);
			void vscode.window.showErrorMessage(`Invalid branch name provided for ${commandName}.`);
			return;
		}

		// Validate workspace folder
		if (!this.workspaceFolder) {
			console.error(`❌ No workspace folder available for branch ${commandName}`);
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		console.log(`🔄 Executing branch ${commandName} for:`, trimmedName);

		// Show progress notification
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `${commandName.charAt(0).toUpperCase() + commandName.slice(1)}ing branch: ${trimmedName}`,
			cancellable: false,
		}, async (progress) => {
			try {
				// Execute the branch command
				const result = await execFunction(this.workspaceFolder!, trimmedName);

				if ('error' in result) {
					console.error(`🔄 Branch ${commandName} failed:`, result.error);
					void vscode.window.showErrorMessage(`Failed to ${commandName} branch: ${result.error}`);
				} else {
					console.log(`🔄 Branch ${commandName} successful`);
					void vscode.window.showInformationMessage(`Branch ${trimmedName} ${commandName}ed successfully.`);
				}

				// Always refresh state to reflect current git-spice state
				await this.refresh();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`🔄 Unexpected error during branch ${commandName}:`, message);
				void vscode.window.showErrorMessage(`Unexpected error during branch ${commandName}: ${message}`);
			}
		});
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
		const needsRestack = branch.down?.needsRestack === true ||
			(branch.ups ?? []).some((link) => link.needsRestack === true);
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
			action: 'submit'
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
		const trimmedName = typeof branchName === 'string' ? branchName.trim() : '';
		if (trimmedName.length === 0) {
			console.error('❌ Invalid branch name provided to handleBranchDelete:', branchName);
			void vscode.window.showErrorMessage('Invalid branch name provided for delete.');
			return;
		}

		if (!this.workspaceFolder) {
			console.error('❌ No workspace folder available for branch delete');
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		const confirmed = await vscode.window.showWarningMessage(
			`Delete branch '${trimmedName}'? This will untrack it and delete the local branch.`,
			{ modal: true },
			'Delete'
		);

		if (confirmed !== 'Delete') {
			return;
		}

		console.log('🔄 Executing branch delete for:', trimmedName);

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Deleting branch: ${trimmedName}`,
			cancellable: false,
		}, async () => {
			const result = await execBranchDelete(this.workspaceFolder!, trimmedName);

			if ('error' in result) {
				console.error('🔄 Branch delete failed:', result.error);
				void vscode.window.showErrorMessage(`Failed to delete branch: ${result.error}`);
			} else {
				console.log('🔄 Branch delete successful');
				void vscode.window.showInformationMessage(`Branch ${trimmedName} deleted successfully.`);
			}

			await this.refresh();
		});
	}

	/**
	 * Public method to handle branch rename prompt from VSCode commands
	 */
	public async handleBranchRenamePrompt(branchName: string): Promise<void> {
		// Validate input
		if (typeof branchName !== 'string' || branchName.trim() === '') {
			console.error('❌ Invalid branch name provided to handleBranchRenamePrompt:', branchName);
			return;
		}

		try {
			const newName = await vscode.window.showInputBox({
				prompt: `Enter new name for branch '${branchName}':`,
				value: branchName,
				validateInput: (input) => {
					if (!input || !input.trim()) {
						return 'Branch name cannot be empty.';
					}
					if (input.trim() === branchName) {
						return 'New name must be different from current name.';
					}
					return null;
				}
			});

			if (newName && newName.trim() && newName !== branchName) {
				// Send the rename command with the new name back to webview
				this.view.webview.postMessage({
					type: 'branchRename',
					branchName: branchName,
					newName: newName.trim()
				});
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('❌ Error showing rename prompt:', message);
			void vscode.window.showErrorMessage(`Error showing rename prompt: ${message}`);
		}
	}

	/**
	 * Handles branch rename command with new name parameter
	 */
	private async handleBranchRename(branchName: string, newName: string): Promise<void> {
		// Validate input
		if (typeof branchName !== 'string' || branchName.trim() === '') {
			console.error('❌ Invalid branch name provided to handleBranchRename:', branchName);
			void vscode.window.showErrorMessage('Invalid branch name provided for rename.');
			return;
		}

		if (typeof newName !== 'string' || newName.trim() === '') {
			console.error('❌ Invalid new name provided to handleBranchRename:', newName);
			void vscode.window.showErrorMessage('Invalid new name provided for rename.');
			return;
		}

		// Validate workspace folder
		if (!this.workspaceFolder) {
			console.error('❌ No workspace folder available for branch rename');
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		console.log('🔄 Executing branch rename for:', branchName, 'to:', newName);

		// Show progress notification
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Renaming branch: ${branchName} → ${newName}`,
			cancellable: false,
		}, async (progress) => {
			try {
				// Execute the branch rename command
				const result = await execBranchRename(this.workspaceFolder!, branchName, newName);

				if ('error' in result) {
					console.error('🔄 Branch rename failed:', result.error);
					void vscode.window.showErrorMessage(`Failed to rename branch: ${result.error}`);
				} else {
					console.log('🔄 Branch rename successful');
					void vscode.window.showInformationMessage(`Branch renamed from ${branchName} to ${newName} successfully.`);
				}

				// Always refresh state to reflect current git-spice state
				await this.refresh();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error('🔄 Unexpected error during branch rename:', message);
				void vscode.window.showErrorMessage(`Unexpected error during branch rename: ${message}`);
			}
		});
	}

	/**
	 * Prompts user to select a new parent branch for the move operation
	 */
	public async handleBranchMovePrompt(branchName: string): Promise<void> {
		if (typeof branchName !== 'string' || branchName.trim() === '') {
			console.error('❌ Invalid branch name provided to handleBranchMovePrompt:', branchName);
			return;
		}

		// Get available branches (excluding current branch and its descendants)
		const availableParents = this.branches
			.filter((b) => b.name !== branchName)
			.map((b) => b.name);

		if (availableParents.length === 0) {
			void vscode.window.showWarningMessage('No other branches available to move onto.');
			return;
		}

		const selected = await vscode.window.showQuickPick(availableParents, {
			placeHolder: `Select new parent for '${branchName}'`,
			title: 'Move Branch Onto...',
		});

		if (selected) {
			void this.handleBranchMove(branchName, selected);
		}
	}

	/**
	 * Moves a branch to a new parent (reparents it)
	 */
	private async handleBranchMove(branchName: string, newParent: string): Promise<void> {
		if (typeof branchName !== 'string' || branchName.trim() === '') {
			console.error('❌ Invalid branch name provided to handleBranchMove:', branchName);
			void vscode.window.showErrorMessage('Invalid branch name provided for move.');
			return;
		}

		if (typeof newParent !== 'string' || newParent.trim() === '') {
			console.error('❌ Invalid parent name provided to handleBranchMove:', newParent);
			void vscode.window.showErrorMessage('Invalid parent name provided for move.');
			return;
		}

		if (!this.workspaceFolder) {
			console.error('❌ No workspace folder available for branch move');
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		console.log('🔄 Executing branch move for:', branchName, 'onto:', newParent);

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Moving branch: ${branchName} → ${newParent}`,
			cancellable: false,
		}, async () => {
			const result = await execBranchMove(this.workspaceFolder!, branchName, newParent);

			if ('error' in result) {
				console.error('🔄 Branch move failed:', result.error);
				void vscode.window.showErrorMessage(`Failed to move branch: ${result.error}`);
			} else {
				console.log('🔄 Branch move successful');
				void vscode.window.showInformationMessage(`Branch ${branchName} moved onto ${newParent} successfully.`);
			}

			await this.refresh();
		});
	}

	/**
	 * Prompts user to select a new parent branch for moving with children
	 */
	public async handleUpstackMovePrompt(branchName: string): Promise<void> {
		if (typeof branchName !== 'string' || branchName.trim() === '') {
			console.error('❌ Invalid branch name provided to handleUpstackMovePrompt:', branchName);
			return;
		}

		const availableParents = this.branches
			.filter((b) => b.name !== branchName)
			.map((b) => b.name);

		if (availableParents.length === 0) {
			void vscode.window.showWarningMessage('No other branches available to move onto.');
			return;
		}

		const selected = await vscode.window.showQuickPick(availableParents, {
			placeHolder: `Select new parent for '${branchName}' and its children`,
			title: 'Move Branch with Children Onto...',
		});

		if (selected) {
			void this.handleUpstackMove(branchName, selected);
		}
	}

	/**
	 * Moves a branch and all its descendants to a new parent
	 */
	private async handleUpstackMove(branchName: string, newParent: string): Promise<void> {
		if (typeof branchName !== 'string' || branchName.trim() === '') {
			console.error('❌ Invalid branch name provided to handleUpstackMove:', branchName);
			void vscode.window.showErrorMessage('Invalid branch name provided for move.');
			return;
		}

		if (typeof newParent !== 'string' || newParent.trim() === '') {
			console.error('❌ Invalid parent name provided to handleUpstackMove:', newParent);
			void vscode.window.showErrorMessage('Invalid parent name provided for move.');
			return;
		}

		if (!this.workspaceFolder) {
			console.error('❌ No workspace folder available for upstack move');
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		console.log('🔄 Executing upstack move for:', branchName, 'onto:', newParent);

		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Moving branch with children: ${branchName} → ${newParent}`,
			cancellable: false,
		}, async () => {
			const result = await execUpstackMove(this.workspaceFolder!, branchName, newParent);

			if ('error' in result) {
				console.error('🔄 Upstack move failed:', result.error);
				void vscode.window.showErrorMessage(`Failed to move branch with children: ${result.error}`);
			} else {
				console.log('🔄 Upstack move successful');
				void vscode.window.showInformationMessage(
					`Branch ${branchName} and children moved onto ${newParent} successfully.`
				);
			}

			await this.refresh();
		});
	}

	/**
	 * Handles copying a commit SHA to the clipboard
	 */
	public async handleCommitCopySha(sha: string): Promise<void> {
		// Validate input
		if (typeof sha !== 'string' || sha.trim() === '') {
			console.error('❌ Invalid SHA provided to handleCommitCopySha:', sha);
			void vscode.window.showErrorMessage('Invalid commit SHA provided.');
			return;
		}

		try {
			await vscode.env.clipboard.writeText(sha);
			void vscode.window.showInformationMessage(`Copied commit SHA: ${sha.substring(0, 8)}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('❌ Error copying SHA to clipboard:', message);
			void vscode.window.showErrorMessage(`Failed to copy SHA: ${message}`);
		}
	}

	/**
	 * Handles creating a fixup commit for the specified commit
	 */
	private async handleCommitFixup(sha: string): Promise<void> {
		// Validate input
		if (typeof sha !== 'string' || sha.trim() === '') {
			console.error('❌ Invalid SHA provided to handleCommitFixup:', sha);
			void vscode.window.showErrorMessage('Invalid commit SHA provided.');
			return;
		}

		// Validate workspace folder
		if (!this.workspaceFolder) {
			console.error('❌ No workspace folder available for commit fixup');
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		console.log('🔄 Executing commit fixup for:', sha);

		// Show progress notification
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Creating fixup commit for ${sha.substring(0, 8)}`,
			cancellable: false,
		}, async (progress) => {
			try {
				const result = await execCommitFixup(this.workspaceFolder!, sha);

				if ('error' in result) {
					console.error('🔄 Commit fixup failed:', result.error);
					void vscode.window.showErrorMessage(`Failed to create fixup commit: ${result.error}`);
				} else {
					console.log('🔄 Commit fixup successful');
					void vscode.window.showInformationMessage(`Fixup commit created for ${sha.substring(0, 8)}`);
				}

				// Refresh state to reflect changes
				await this.refresh();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error('🔄 Unexpected error during commit fixup:', message);
				void vscode.window.showErrorMessage(`Unexpected error during commit fixup: ${message}`);
			}
		});
	}

	/**
	 * Handles splitting a branch at the specified commit
	 */
	public async handleCommitSplit(sha: string, branchName: string): Promise<void> {
		// Validate input
		if (typeof sha !== 'string' || sha.trim() === '') {
			console.error('❌ Invalid SHA provided to handleCommitSplit:', sha);
			void vscode.window.showErrorMessage('Invalid commit SHA provided.');
			return;
		}

		if (typeof branchName !== 'string' || branchName.trim() === '') {
			console.error('❌ Invalid branch name provided to handleCommitSplit:', branchName);
			void vscode.window.showErrorMessage('Invalid branch name provided.');
			return;
		}

		// Validate workspace folder
		if (!this.workspaceFolder) {
			console.error('❌ No workspace folder available for branch split');
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}

		// Prompt for new branch name
		const newBranchName = await vscode.window.showInputBox({
			prompt: `Enter name for the new branch that will be created at commit ${sha.substring(0, 8)}`,
			placeHolder: 'new-branch-name',
			validateInput: (input) => {
				if (!input || !input.trim()) {
					return 'Branch name cannot be empty.';
				}
				// Basic validation for git branch names
				if (!/^[a-zA-Z0-9/_-]+$/.test(input.trim())) {
					return 'Branch name contains invalid characters.';
				}
				return null;
			}
		});

		if (!newBranchName || !newBranchName.trim()) {
			// User cancelled
			return;
		}

		console.log('🔄 Executing branch split for:', branchName, 'at:', sha, 'new branch:', newBranchName);

		// Show progress notification
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: `Splitting branch ${branchName} at ${sha.substring(0, 8)}`,
			cancellable: false,
		}, async (progress) => {
			try {
				const result = await execBranchSplit(this.workspaceFolder!, branchName, sha, newBranchName.trim());

				if ('error' in result) {
					console.error('🔄 Branch split failed:', result.error);
					void vscode.window.showErrorMessage(`Failed to split branch: ${result.error}`);
				} else {
					console.log('🔄 Branch split successful');
					void vscode.window.showInformationMessage(`Branch ${branchName} split at ${sha.substring(0, 8)} → ${newBranchName}`);
				}

				// Refresh state to reflect changes
				await this.refresh();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error('🔄 Unexpected error during branch split:', message);
				void vscode.window.showErrorMessage(`Unexpected error during branch split: ${message}`);
			}
		});
	}

	private setupFileWatcher(): void {
		// Dispose existing watcher if any
		this.fileWatcher?.dispose();
		this.fileWatcher = undefined;

		if (!this.workspaceFolder || !this.view) {
			return;
		}

		// Watch for git-spice metadata changes and Git HEAD changes
		// git-spice stores its data in .git/refs/spice/data
		// HEAD changes indicate branch switches
		const gitDir = vscode.Uri.joinPath(this.workspaceFolder.uri, '.git');
		const pattern = new vscode.RelativePattern(gitDir, '{refs/spice/data,HEAD,refs/heads/**}');

		this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

		const refreshHandler = () => {
			void this.refresh();
		};

		this.fileWatcher.onDidChange(refreshHandler);
		this.fileWatcher.onDidCreate(refreshHandler);
		this.fileWatcher.onDidDelete(refreshHandler);
	}

	dispose(): void {
		this.fileWatcher?.dispose();
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

		const mediaUri = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name)).toString();
		const distUri = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', name)).toString();
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
