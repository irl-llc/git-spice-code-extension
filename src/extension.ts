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

/** Updates the context key for comment progress toggle checkmark. */
function updateCommentProgressContext(): void {
	const config = vscode.workspace.getConfiguration('git-spice');
	const showComments = config.get<boolean>('showCommentProgress', false);
	void vscode.commands.executeCommand('setContext', 'git-spice.showCommentProgress', showComments);
}

/** Returns the first workspace folder or shows an error. */
function getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) void vscode.window.showErrorMessage('No workspace folder found');
	return folder;
}

/** Shows result message from a branch command. */
function showCommandResult(result: BranchCommandResult, successMessage: string, errorPrefix: string): void {
	if ('error' in result) {
		void vscode.window.showErrorMessage(`${errorPrefix}: ${result.error}`);
	} else {
		void vscode.window.showInformationMessage(successMessage);
	}
}

/** Configuration for a navigation command. */
interface NavigationCommandConfig {
	commandId: string;
	execFn: (folder: vscode.WorkspaceFolder) => Promise<BranchCommandResult>;
	successMessage: string;
	errorPrefix: string;
}

/** Registers a simple navigation command with result handling. */
function registerNavigationCommand(context: vscode.ExtensionContext, config: NavigationCommandConfig, provider: StackViewProvider): void {
	const { commandId, execFn, successMessage, errorPrefix } = config;
	context.subscriptions.push(
		vscode.commands.registerCommand(commandId, async () => {
			const folder = getWorkspaceFolder();
			if (!folder) return;
			const result = await execFn(folder);
			showCommandResult(result, successMessage, errorPrefix);
			void provider.refresh();
		}),
	);
}

/** Registers navigation commands (up, down, trunk). */
function registerNavigationCommands(context: vscode.ExtensionContext, provider: StackViewProvider): void {
	const commands: NavigationCommandConfig[] = [
		{ commandId: 'git-spice.up', execFn: execUp, successMessage: 'Navigated up the stack', errorPrefix: 'Failed to navigate up' },
		{ commandId: 'git-spice.down', execFn: execDown, successMessage: 'Navigated down the stack', errorPrefix: 'Failed to navigate down' },
		{ commandId: 'git-spice.trunk', execFn: execTrunk, successMessage: 'Navigated to trunk', errorPrefix: 'Failed to navigate to trunk' },
	];
	commands.forEach((config) => registerNavigationCommand(context, config, provider));
}

/** Branch command definition for context menu registration. */
interface BranchCommandDef {
	id: string;
	action: string;
}

/** Registers data-driven branch context menu commands. */
function registerBranchContextMenuCommands(context: vscode.ExtensionContext, provider: StackViewProvider): void {
	const commands: BranchCommandDef[] = [
		{ id: 'branchCheckout', action: 'checkout' },
		{ id: 'branchEdit', action: 'edit' },
		{ id: 'branchRestack', action: 'restack' },
		{ id: 'branchSubmit', action: 'submit' },
		{ id: 'branchFold', action: 'fold' },
		{ id: 'branchSquash', action: 'squash' },
		{ id: 'branchUntrack', action: 'untrack' },
	];

	for (const { id, action } of commands) {
		context.subscriptions.push(
			vscode.commands.registerCommand(`git-spice.${id}`, (ctx: BranchContext) => {
				if (ctx?.branchName) void provider.handleBranchCommand(action, ctx.branchName);
			}),
		);
	}
}

/** Registers branch commands that require custom prompts. */
function registerBranchPromptCommands(context: vscode.ExtensionContext, provider: StackViewProvider): void {
	context.subscriptions.push(
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
	);
}

/** Registers commit context menu commands. */
function registerCommitContextMenuCommands(context: vscode.ExtensionContext, provider: StackViewProvider): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('git-spice.commitCopySha', (ctx: CommitContext) => {
			if (ctx?.sha) void provider.handleCommitCopySha(ctx.sha);
		}),
		vscode.commands.registerCommand('git-spice.commitSplit', (ctx: CommitContext) => {
			if (ctx?.sha && ctx?.branchName) void provider.handleCommitSplit(ctx.sha, ctx.branchName);
		}),
	);
}

/** Configuration for a stack command. */
interface StackCommandConfig {
	execFn: (folder: vscode.WorkspaceFolder) => Promise<BranchCommandResult>;
	title: string;
	successMessage: string;
	errorPrefix: string;
}

/** Executes a stack command with progress notification. */
async function executeStackCommand(config: StackCommandConfig, provider: StackViewProvider): Promise<void> {
	const folder = getWorkspaceFolder();
	if (!folder) return;

	const { execFn, title, successMessage, errorPrefix } = config;
	await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, async () => {
		const result = await execFn(folder);
		showCommandResult(result, successMessage, errorPrefix);
		await provider.refresh();
	});
}

/** Registers stack commands (restack, submit). */
function registerStackCommands(context: vscode.ExtensionContext, provider: StackViewProvider): void {
	const restackConfig: StackCommandConfig = { execFn: execStackRestack, title: 'Restacking current stack...', successMessage: 'Stack restacked successfully', errorPrefix: 'Failed to restack stack' };
	const submitConfig: StackCommandConfig = { execFn: execStackSubmit, title: 'Submitting current stack...', successMessage: 'Stack submitted successfully', errorPrefix: 'Failed to submit stack' };

	context.subscriptions.push(
		vscode.commands.registerCommand('git-spice.stackRestack', () => executeStackCommand(restackConfig, provider)),
		vscode.commands.registerCommand('git-spice.stackSubmit', () => executeStackCommand(submitConfig, provider)),
	);
}

/** Gets the first Git repository from the Git extension API. */
function getGitRepository(): GitRepo | undefined {
	const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
	if (!gitExtension) {
		void vscode.window.showErrorMessage('Git extension not found');
		return undefined;
	}

	const git = gitExtension.getAPI(1);
	if (!git || git.repositories.length === 0) {
		void vscode.window.showErrorMessage('No Git repository found');
		return undefined;
	}

	return git.repositories[0];
}

/** Git repository interface for branch creation. */
interface GitRepo {
	inputBox: { value: string };
	status: () => Promise<void>;
}

/** Refreshes all relevant views after branch creation. */
function refreshAfterBranchCreate(repository: GitRepo, provider: StackViewProvider): void {
	void provider.refresh();
	void repository.status();
	void vscode.commands.executeCommand('workbench.scm.focus');
	void vscode.commands.executeCommand('workbench.view.scm');

	setTimeout(() => {
		void repository.status();
		void provider.refresh();
	}, POST_COMMIT_REFRESH_DELAY_MS);
}

/** Executes branch creation from the commit message input box. */
async function executeBranchCreateFromCommitMessage(provider: StackViewProvider): Promise<void> {
	const repository = getGitRepository();
	if (!repository) return;

	const commitMessage = repository.inputBox.value;
	if (!commitMessage || commitMessage.trim() === '') {
		void vscode.window.showErrorMessage('Please enter a commit message first');
		return;
	}

	const folder = getWorkspaceFolder();
	if (!folder) return;

	const result = await execBranchCreate(folder, commitMessage);
	if ('error' in result) {
		void vscode.window.showErrorMessage(result.error);
		return;
	}

	void vscode.window.showInformationMessage(`Created branch with message: ${commitMessage}`);
	repository.inputBox.value = '';
	refreshAfterBranchCreate(repository, provider);
}

/** Registers the branch create from commit message command. */
function registerBranchCreateCommand(context: vscode.ExtensionContext, provider: StackViewProvider): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('git-spice.branchCreateFromCommitMessage', () => executeBranchCreateFromCommitMessage(provider)),
	);
}

/** Registers workspace and configuration change listeners. */
function registerWorkspaceListeners(context: vscode.ExtensionContext, provider: StackViewProvider): void {
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			provider.setWorkspaceFolder(vscode.workspace.workspaceFolders?.[0]);
			void provider.refresh();
		}),
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

/** Registers the core provider and basic commands (refresh, sync). */
function registerCoreProvider(context: vscode.ExtensionContext, provider: StackViewProvider): void {
	context.subscriptions.push(
		provider,
		vscode.window.registerWebviewViewProvider('gitSpice.branches', provider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
		vscode.commands.registerCommand('git-spice.refresh', () => provider.refresh(true)),
		vscode.commands.registerCommand('git-spice.syncRepo', () => provider.sync()),
	);
}

export function activate(context: vscode.ExtensionContext): void {
	updateCommentProgressContext();

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	const provider = new StackViewProvider(workspaceFolder, context.extensionUri);

	registerCoreProvider(context, provider);
	registerNavigationCommands(context, provider);
	registerBranchContextMenuCommands(context, provider);
	registerBranchPromptCommands(context, provider);
	registerCommitContextMenuCommands(context, provider);
	registerStackCommands(context, provider);
	registerBranchCreateCommand(context, provider);
	registerWorkspaceListeners(context, provider);
}

export function deactivate(): void {
	// No-op: disposables are registered via the extension context.
}
