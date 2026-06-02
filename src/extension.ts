import * as vscode from 'vscode';

import { POST_COMMIT_REFRESH_DELAY_MS } from './constants';
import { createRepoDiscovery } from './repoDiscovery';
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
function registerNavigationCommand(
	context: vscode.ExtensionContext,
	config: NavigationCommandConfig,
	provider: StackViewProvider,
): void {
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

/** Navigation command configs (up, down, trunk). */
const NAVIGATION_COMMANDS: NavigationCommandConfig[] = [
	{
		commandId: 'git-spice.up',
		execFn: execUp,
		successMessage: 'Navigated up the stack',
		errorPrefix: 'Failed to navigate up',
	},
	{
		commandId: 'git-spice.down',
		execFn: execDown,
		successMessage: 'Navigated down the stack',
		errorPrefix: 'Failed to navigate down',
	},
	{
		commandId: 'git-spice.trunk',
		execFn: execTrunk,
		successMessage: 'Navigated to trunk',
		errorPrefix: 'Failed to navigate to trunk',
	},
];

/** Registers navigation commands (up, down, trunk). */
function registerNavigationCommands(context: vscode.ExtensionContext, provider: StackViewProvider): void {
	NAVIGATION_COMMANDS.forEach((config) => registerNavigationCommand(context, config, provider));
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
		vscode.commands.registerCommand('git-spice.copyBranchName', (ctx: BranchContext) => {
			if (ctx?.branchName) void provider.handleCopyBranchName(undefined, ctx.branchName);
		}),
		vscode.commands.registerCommand('git-spice.branchRename', (ctx: BranchContext) => {
			if (ctx?.branchName) void provider.handleBranchRenamePrompt(undefined, ctx.branchName);
		}),
		vscode.commands.registerCommand('git-spice.branchMove', (ctx: BranchContext) => {
			if (ctx?.branchName) void provider.handleBranchMovePrompt(undefined, ctx.branchName);
		}),
		vscode.commands.registerCommand('git-spice.branchMoveWithChildren', (ctx: BranchContext) => {
			if (ctx?.branchName) void provider.handleUpstackMovePrompt(undefined, ctx.branchName);
		}),
		vscode.commands.registerCommand('git-spice.branchDelete', (ctx: BranchContext) => {
			if (ctx?.branchName) void provider.handleBranchDelete(undefined, ctx.branchName);
		}),
	);
}

/** Registers commit context menu commands. */
function registerCommitContextMenuCommands(context: vscode.ExtensionContext, provider: StackViewProvider): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('git-spice.commitCopySha', (ctx: CommitContext) => {
			if (ctx?.sha) void provider.handleCommitCopySha(undefined, ctx.sha);
		}),
		vscode.commands.registerCommand('git-spice.commitSplit', (ctx: CommitContext) => {
			if (ctx?.sha && ctx?.branchName) void provider.handleCommitSplit(undefined, ctx.sha, ctx.branchName);
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
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title, cancellable: false },
		async () => {
			const result = await execFn(folder);
			showCommandResult(result, successMessage, errorPrefix);
			await provider.refresh();
		},
	);
}

/** Registers stack commands (restack, submit). */
function registerStackCommands(context: vscode.ExtensionContext, provider: StackViewProvider): void {
	const restackConfig: StackCommandConfig = {
		execFn: execStackRestack,
		title: 'Restacking current stack...',
		successMessage: 'Stack restacked successfully',
		errorPrefix: 'Failed to restack stack',
	};
	const submitConfig: StackCommandConfig = {
		execFn: execStackSubmit,
		title: 'Submitting current stack...',
		successMessage: 'Stack submitted successfully',
		errorPrefix: 'Failed to submit stack',
	};

	context.subscriptions.push(
		vscode.commands.registerCommand('git-spice.stackRestack', () => executeStackCommand(restackConfig, provider)),
		vscode.commands.registerCommand('git-spice.stackSubmit', () => executeStackCommand(submitConfig, provider)),
	);
}

/** Gets the Git extension API and first repository. */
async function getGitRepository(): Promise<GitRepo | undefined> {
	try {
		const ext = vscode.extensions.getExtension('vscode.git');
		if (!ext) {
			void vscode.window.showErrorMessage('Git extension not found');
			return undefined;
		}
		if (!ext.isActive) await ext.activate();
		const git = ext.exports?.getAPI(1);
		if (!git || git.repositories.length === 0) {
			void vscode.window.showErrorMessage('No Git repository found');
			return undefined;
		}
		return git.repositories[0] as GitRepo;
	} catch (err) {
		console.error('Failed to access Git extension:', err);
		void vscode.window.showErrorMessage('Git extension is not available');
		return undefined;
	}
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
	const repository = await getGitRepository();
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
		vscode.commands.registerCommand('git-spice.branchCreateFromCommitMessage', () =>
			executeBranchCreateFromCommitMessage(provider),
		),
	);
}

/**
 * Mirrors the `git-spice.showRemoteForgeStatus` setting into the
 * `gitSpice.showRemoteForgeStatus` context key, which the view/title menu's
 * `when` clauses use to swap between the "Show…" (enable) and "Hide…"
 * (disable) commands. VS Code's package.json `menus` schema has no
 * `toggled`/checkmark support, and `$(icon)` codicons are stripped from
 * overflow-menu titles — so the on/off state is conveyed by swapping the
 * command's verb label, gated by this context key.
 */
function syncRemoteForgeStatusContext(): void {
	const enabled = vscode.workspace.getConfiguration('git-spice').get<boolean>('showRemoteForgeStatus', false);
	void vscode.commands.executeCommand('setContext', 'gitSpice.showRemoteForgeStatus', enabled);
}

/** Persists the remote-forge-status setting (Global scope). */
async function setRemoteForgeStatus(enabled: boolean): Promise<void> {
	try {
		await vscode.workspace
			.getConfiguration('git-spice')
			.update('showRemoteForgeStatus', enabled, vscode.ConfigurationTarget.Global);
	} catch (err) {
		void vscode.window.showErrorMessage(
			`Failed to update remote forge status setting: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

/** Registers workspace and configuration change listeners. */
function registerWorkspaceListeners(context: vscode.ExtensionContext, provider: StackViewProvider): void {
	syncRemoteForgeStatusContext();
	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			provider.setWorkspaceFolder(vscode.workspace.workspaceFolders?.[0]);
			void provider.refresh();
		}),
		// Two commands rather than one toggle: package.json `menus` has no
		// `toggled`/checkmark support, so we swap which command (Show… vs
		// Hide…) appears via `when` on the gitSpice.showRemoteForgeStatus
		// context key.
		vscode.commands.registerCommand('git-spice.enableRemoteForgeStatus', () => setRemoteForgeStatus(true)),
		vscode.commands.registerCommand('git-spice.disableRemoteForgeStatus', () => setRemoteForgeStatus(false)),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('git-spice.showRemoteForgeStatus')) {
				syncRemoteForgeStatusContext();
				// force: re-fetch forge status now that the toggle changed.
				void provider.refresh(true);
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
		vscode.commands.registerCommand('git-spice.openInEditor', () => provider.openInEditor()),
	);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const discovery = await createRepoDiscovery();
	if (discovery) context.subscriptions.push(discovery);
	const fallbackFolder = vscode.workspace.workspaceFolders?.[0];
	const provider = new StackViewProvider(discovery, context.extensionUri, fallbackFolder);

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
