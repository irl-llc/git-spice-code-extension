import * as vscode from 'vscode';

import { POST_COMMIT_REFRESH_DELAY_MS } from './constants';
import { StackViewProvider } from './stackView/StackViewProvider';
import {
	execBranchCreate,
	execUp,
	execDown,
	execTrunk,
	execStackRestack,
	execStackSubmit,
	type BranchCommandResult,
} from './utils/gitSpice';

/**
 * Context passed to branch commands from webview context menus.
 * Populated via the `data-vscode-context` attribute on branch elements.
 */
interface BranchContext {
	/** Name of the branch to operate on. */
	branchName?: string;
}

/**
 * Context passed to commit commands from webview context menus.
 * Populated via the `data-vscode-context` attribute on commit elements.
 */
interface CommitContext {
	/** Full SHA of the commit. */
	sha?: string;
	/** Name of the branch containing this commit. */
	branchName?: string;
}

/**
 * Registers a simple command that calls a git-spice exec function.
 * Handles folder validation, error display, and provider refresh.
 */
function registerSimpleCommand(
	context: vscode.ExtensionContext,
	commandId: string,
	execFn: (folder: vscode.WorkspaceFolder) => Promise<BranchCommandResult>,
	successMessage: string,
	errorPrefix: string,
	provider: StackViewProvider,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(commandId, async () => {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) {
				void vscode.window.showErrorMessage('No workspace folder found');
				return;
			}

			const result = await execFn(folder);
			if ('error' in result) {
				void vscode.window.showErrorMessage(`${errorPrefix}: ${result.error}`);
			} else {
				void vscode.window.showInformationMessage(successMessage);
			}
			void provider.refresh();
		}),
	);
}

export function activate(context: vscode.ExtensionContext): void {

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	const provider = new StackViewProvider(workspaceFolder, context.extensionUri);

	// Register navigation commands using helper
	registerSimpleCommand(context, 'git-spice.up', execUp, 'Navigated up the stack', 'Failed to navigate up', provider);
	registerSimpleCommand(
		context,
		'git-spice.down',
		execDown,
		'Navigated down the stack',
		'Failed to navigate down',
		provider,
	);
	registerSimpleCommand(
		context,
		'git-spice.trunk',
		execTrunk,
		'Navigated to trunk',
		'Failed to navigate to trunk',
		provider,
	);

	// Register branch context menu commands (data-driven)
	const branchCommands = [
		{ id: 'branchCheckout', action: 'checkout' },
		{ id: 'branchEdit', action: 'edit' },
		{ id: 'branchRestack', action: 'restack' },
		{ id: 'branchSubmit', action: 'submit' },
		{ id: 'branchFold', action: 'fold' },
		{ id: 'branchSquash', action: 'squash' },
		{ id: 'branchUntrack', action: 'untrack' },
	];

	for (const { id, action } of branchCommands) {
		context.subscriptions.push(
			vscode.commands.registerCommand(`git-spice.${id}`, (ctx: BranchContext) => {
				if (ctx?.branchName) void provider.handleBranchCommand(action, ctx.branchName);
			}),
		);
	}

	context.subscriptions.push(
		provider,
		vscode.window.registerWebviewViewProvider('gitSpice.branches', provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.commands.registerCommand('git-spice.refresh', () => provider.refresh()),
		vscode.commands.registerCommand('git-spice.syncRepo', () => provider.sync()),
		vscode.commands.registerCommand('git-spice.branchCreateFromCommitMessage', async () => {
			const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
			if (!gitExtension) {
				void vscode.window.showErrorMessage('Git extension not found');
				return;
			}

			const git = gitExtension.getAPI(1);
			if (!git || git.repositories.length === 0) {
				void vscode.window.showErrorMessage('No Git repository found');
				return;
			}

			const repository = git.repositories[0];
			const commitMessage = repository.inputBox.value;

			if (!commitMessage || commitMessage.trim() === '') {
				void vscode.window.showErrorMessage('Please enter a commit message first');
				return;
			}

			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) {
				void vscode.window.showErrorMessage('No workspace folder found');
				return;
			}

			// Execute git-spice branch create with auto-staging
			const result = await execBranchCreate(folder, commitMessage);
			if ('error' in result) {
				void vscode.window.showErrorMessage(result.error);
			} else {
				void vscode.window.showInformationMessage(`Created branch with message: ${commitMessage}`);
				// Clear the commit message input box after successful branch creation
				repository.inputBox.value = '';

				// Multiple refresh strategies for faster UI updates
				void provider.refresh();
				void repository.status();

				// Force refresh the Source Control view
				void vscode.commands.executeCommand('workbench.scm.focus');
				void vscode.commands.executeCommand('workbench.view.scm');

				// Additional refresh after a short delay to ensure UI is updated
				setTimeout(() => {
					void repository.status();
					void provider.refresh();
				}, POST_COMMIT_REFRESH_DELAY_MS);
			}
		}),
		vscode.commands.registerCommand('git-spice.stackRestack', async () => {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) {
				void vscode.window.showErrorMessage('No workspace folder found');
				return;
			}

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Restacking current stack...',
					cancellable: false,
				},
				async () => {
					const result = await execStackRestack(folder);
					if ('error' in result) {
						void vscode.window.showErrorMessage(`Failed to restack stack: ${result.error}`);
					} else {
						void vscode.window.showInformationMessage('Stack restacked successfully');
					}
					await provider.refresh();
				},
			);
		}),
		vscode.commands.registerCommand('git-spice.stackSubmit', async () => {
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (!folder) {
				void vscode.window.showErrorMessage('No workspace folder found');
				return;
			}

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Submitting current stack...',
					cancellable: false,
				},
				async () => {
					const result = await execStackSubmit(folder);
					if ('error' in result) {
						void vscode.window.showErrorMessage(`Failed to submit stack: ${result.error}`);
					} else {
						void vscode.window.showInformationMessage('Stack submitted successfully');
					}
					await provider.refresh();
				},
			);
		}),

		// Special branch commands with custom prompts
		vscode.commands.registerCommand('git-spice.branchRename', (ctx: BranchContext) => {
			if (ctx?.branchName) void provider.handleBranchRenamePrompt(ctx.branchName);
		}),
		vscode.commands.registerCommand('git-spice.branchMove', (ctx: BranchContext) => {
			if (ctx?.branchName) void provider.handleBranchMovePrompt(ctx.branchName);
		}),
		vscode.commands.registerCommand('git-spice.branchMoveWithChildren', (ctx: BranchContext) => {
			if (ctx?.branchName) void provider.handleUpstackMovePrompt(ctx.branchName);
		}),
		vscode.commands.registerCommand('git-spice.branchDelete', (ctx: BranchContext) => {
			if (ctx?.branchName) void provider.handleBranchDelete(ctx.branchName);
		}),

		// Commit context menu commands
		vscode.commands.registerCommand('git-spice.commitCopySha', (ctx: CommitContext) => {
			if (ctx?.sha) void provider.handleCommitCopySha(ctx.sha);
		}),
		vscode.commands.registerCommand('git-spice.commitSplit', (ctx: CommitContext) => {
			if (ctx?.sha && ctx?.branchName) void provider.handleCommitSplit(ctx.sha, ctx.branchName);
		}),

		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			provider.setWorkspaceFolder(vscode.workspace.workspaceFolders?.[0]);
			void provider.refresh();
		}),

		// Toggle comment progress command
		vscode.commands.registerCommand('git-spice.toggleCommentProgress', async () => {
			const config = vscode.workspace.getConfiguration('git-spice');
			const current = config.get<boolean>('showCommentProgress', false);
			await config.update('showCommentProgress', !current, vscode.ConfigurationTarget.Global);
		}),

		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('git-spice.showCommentProgress')) {
				void provider.refresh();
			}
		}),
	);
}

export function deactivate(): void {
	// No-op: disposables are registered via the extension context.
}
