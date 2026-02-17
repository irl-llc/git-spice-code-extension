/**
 * Stack View Provider - Main orchestrator for the git-spice webview.
 * Manages per-repo state and delegates operations to specialized handlers.
 */

import * as vscode from 'vscode';

import { execStackRestack, execStackSubmit } from '../utils/gitSpice';
import type { GitSpiceBranch } from '../gitSpiceSchema';
import type { DiscoveredRepo, RepoDiscovery } from '../repoDiscovery';
import { buildRepoDisplayState, type RepoDisplayInput } from './state';
import { fetchRepoState, fetchFolderState, type RepoState } from './repoStateBuilder';
import type { DisplayState, RepositoryViewModel, UncommittedState } from './types';
import type { WebviewMessage } from './webviewTypes';
import { renderWebviewHtml } from './webviewHtml';
import { routeMessage, type MessageHandlerContext, type ExecFunctionMap, type ExecFunction } from './messageRouter';
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
	handleGetBranchFiles,
	handleOpenBranchFileDiff,
	type BranchFileHandlerDeps,
} from './handlers/branchFileHandlers';
import { handleSync } from './handlers/syncHandler';
import {
	executeBranchCommand,
	executeBranchCommandWithExec,
	getExecFunctions,
	runWithProgress,
	type BranchCommandRunnerDeps,
} from './handlers/branchCommandRunner';
import {
	handleStageFile,
	handleUnstageFile,
	handleDiscardFile,
	handleCommitChanges,
	handleCreateBranch,
	type WorkingCopyHandlerDeps,
} from './handlers/workingCopyHandlers';

export class StackViewProvider implements vscode.WebviewViewProvider, MessageHandlerContext {
	private view: vscode.WebviewView | undefined;
	private readonly repoStates = new Map<string, RepoState>();
	private readonly fileWatcher: FileWatcherManager;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly discovery: RepoDiscovery | undefined,
		private readonly extensionUri: vscode.Uri,
		private fallbackFolder?: vscode.WorkspaceFolder,
	) {
		this.fileWatcher = new FileWatcherManager(() => void this.refresh());
		if (discovery) {
			this.disposables.push(discovery.onDidChange(() => this.onReposChanged()));
		}
	}

	async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
		this.view = webviewView;
		this.configureWebviewOptions(webviewView);

		webviewView.webview.html = await renderWebviewHtml(webviewView.webview, this.extensionUri);
		webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => routeMessage(message, this));
		webviewView.onDidDispose(() => { this.view = undefined; });

		this.syncWatchers();
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

	/** Called when repo discovery fires a change event. */
	private onReposChanged(): void {
		this.syncWatchers();
		void this.refresh();
	}

	/** Starts file watchers for all discovered repos. */
	private syncWatchers(): void {
		const repos = this.getDiscoveredRepos();
		if (repos.length > 0) {
			this.fileWatcher.watchAll(repos);
		} else if (this.fallbackFolder) {
			this.fileWatcher.watch(this.fallbackFolder);
		}
	}

	/** Returns discovered repos, or synthesizes one from fallback folder. */
	private getDiscoveredRepos(): ReadonlyArray<DiscoveredRepo> {
		if (this.discovery && this.discovery.repositories.length > 0) {
			return this.discovery.repositories;
		}
		return [];
	}

	/** Backward-compat: update the fallback workspace folder. */
	setWorkspaceFolder(folder: vscode.WorkspaceFolder | undefined): void {
		this.fallbackFolder = folder;
		this.syncWatchers();
		void this.refresh();
	}

	async refresh(force = false): Promise<void> {
		const repos = this.getDiscoveredRepos();
		if (repos.length > 0) {
			await this.refreshRepos(repos);
		} else if (this.fallbackFolder) {
			await this.refreshFallback();
		} else {
			this.repoStates.clear();
		}
		this.pushState(force);
	}

	/** Refreshes all discovered repos in parallel. */
	private async refreshRepos(repos: ReadonlyArray<DiscoveredRepo>): Promise<void> {
		const results = await Promise.all(repos.map((repo) => fetchRepoState(repo)));
		this.repoStates.clear();
		for (const state of results) this.repoStates.set(state.rootPath, state);
	}

	/** Fallback: single-folder mode (no discovery). */
	private async refreshFallback(): Promise<void> {
		const state = await fetchFolderState(this.fallbackFolder!);
		this.repoStates.clear();
		this.repoStates.set(state.rootPath, state);
	}

	pushState(force = false): void {
		if (!this.view) return;
		const state = this.buildDisplayState();
		void this.view.webview.postMessage({ type: 'state', payload: state, force });
	}

	/** Builds the full DisplayState from all repo states. */
	private buildDisplayState(): DisplayState {
		const repositories: RepositoryViewModel[] = [];
		for (const state of this.repoStates.values()) {
			const input: RepoDisplayInput = {
				repoId: state.rootPath,
				repoName: state.name,
				branches: state.branches,
				error: state.error,
				uncommitted: state.uncommitted,
			};
			repositories.push(buildRepoDisplayState(input));
		}
		return { repositories };
	}

	async sync(): Promise<void> {
		const folder = this.resolveWorkspaceFolder();
		if (!folder) {
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}
		await handleSync({ folder, refresh: () => this.refresh() });
	}

	// --- Repo Resolution ---

	/**
	 * Resolves to a specific repo by ID, or falls back to the active repo.
	 * The active repo is the one with the current branch checked out.
	 */
	private resolveRepoState(repoId?: string): RepoState | undefined {
		if (repoId) return this.repoStates.get(repoId);
		return this.findActiveRepoState();
	}

	/** Returns the workspace folder for a resolved repo state. */
	private resolveWorkspaceFolder(repoId?: string): vscode.WorkspaceFolder | undefined {
		const state = this.resolveRepoState(repoId);
		if (state) return { uri: state.rootUri, name: state.name, index: 0 };
		return this.fallbackFolder;
	}

	/** Returns the repo state that has the current branch, or the alphabetically first by path. */
	private findActiveRepoState(): RepoState | undefined {
		for (const state of this.repoStates.values()) {
			if (state.branches.some((b) => b.current === true)) return state;
		}
		const sorted = [...this.repoStates.values()].sort((a, b) => a.rootPath.localeCompare(b.rootPath));
		return sorted[0];
	}

	// --- Handler Dependency Factories ---

	private getBranchHandlerDeps(repoId?: string): BranchHandlerDeps {
		const state = this.resolveRepoState(repoId);
		return {
			workspaceFolder: this.resolveWorkspaceFolder(repoId),
			branches: state?.branches ?? [],
			runBranchCommand: (title, op, msg) => runWithProgress(title, op, msg, () => this.refresh()),
			handleBranchCommandInternal: (cmd, branch, fn) => this.handleBranchCommandInternal(repoId, cmd, branch, fn),
			postMessageToWebview: (message) => this.view?.webview.postMessage(message),
		};
	}

	private getCommitHandlerDeps(repoId?: string): CommitHandlerDeps {
		return {
			workspaceFolder: this.resolveWorkspaceFolder(repoId),
			runBranchCommand: (title, op, msg) => runWithProgress(title, op, msg, () => this.refresh()),
			refresh: () => this.refresh(),
			postCommitFilesToWebview: (sha, files) =>
				this.view?.webview.postMessage({ type: 'commitFiles', repoId, sha, files }),
		};
	}

	private getDiffHandlerDeps(repoId?: string): DiffHandlerDeps {
		return { workspaceFolder: this.resolveWorkspaceFolder(repoId) };
	}

	private getWorkingCopyHandlerDeps(repoId?: string): WorkingCopyHandlerDeps {
		return {
			workspaceFolder: this.resolveWorkspaceFolder(repoId),
			uncommitted: this.resolveRepoState(repoId)?.uncommitted,
			refresh: () => this.refresh(),
		};
	}

	private getBranchFileHandlerDeps(repoId?: string): BranchFileHandlerDeps {
		const state = this.resolveRepoState(repoId);
		return {
			workspaceFolder: this.resolveWorkspaceFolder(repoId),
			branches: state?.branches ?? [],
			postBranchFilesToWebview: (branchName, files) =>
				this.view?.webview.postMessage({ type: 'branchFiles', repoId, branchName, files }),
		};
	}

	// --- Public Handler Methods (Exposed for Message Router) ---

	async handleBranchContextMenu(repoId: string | undefined, branchName: string): Promise<void> {
		await handleBranchContextMenu(branchName, this.getBranchHandlerDeps(repoId));
	}

	public async handleBranchDelete(repoId: string | undefined, branchName: string): Promise<void> {
		await handleBranchDelete(branchName, this.getBranchHandlerDeps(repoId));
	}

	public async handleBranchRenamePrompt(repoId: string | undefined, branchName: string): Promise<void> {
		await handleBranchRenamePrompt(branchName, this.getBranchHandlerDeps(repoId));
	}

	async handleBranchRename(repoId: string | undefined, branchName: string, newName: string): Promise<void> {
		await handleBranchRename(branchName, newName, this.getBranchHandlerDeps(repoId));
	}

	public async handleBranchMovePrompt(repoId: string | undefined, branchName: string): Promise<void> {
		await handleBranchMovePrompt(branchName, this.getBranchHandlerDeps(repoId));
	}

	async handleBranchMove(repoId: string | undefined, branchName: string, newParent: string): Promise<void> {
		await handleBranchMove(branchName, newParent, this.getBranchHandlerDeps(repoId));
	}

	public async handleUpstackMovePrompt(repoId: string | undefined, branchName: string): Promise<void> {
		await handleUpstackMovePrompt(branchName, this.getBranchHandlerDeps(repoId));
	}

	async handleUpstackMove(repoId: string | undefined, branchName: string, newParent: string): Promise<void> {
		await handleUpstackMove(branchName, newParent, this.getBranchHandlerDeps(repoId));
	}

	public async handleCommitCopySha(_repoId: string | undefined, sha: string): Promise<void> {
		await handleCommitCopySha(sha);
	}

	async handleCommitFixup(repoId: string | undefined, sha: string): Promise<void> {
		await handleCommitFixup(sha, this.getCommitHandlerDeps(repoId));
	}

	public async handleCommitSplit(repoId: string | undefined, sha: string, branchName: string): Promise<void> {
		await handleCommitSplit(sha, branchName, this.getCommitHandlerDeps(repoId));
	}

	async handleGetCommitFiles(repoId: string | undefined, sha: string): Promise<void> {
		await handleGetCommitFiles(sha, this.getCommitHandlerDeps(repoId));
	}

	async handleGetBranchFiles(repoId: string | undefined, branchName: string): Promise<void> {
		await handleGetBranchFiles(branchName, this.getBranchFileHandlerDeps(repoId));
	}

	async handleOpenBranchFileDiff(repoId: string | undefined, branchName: string, filePath: string): Promise<void> {
		await handleOpenBranchFileDiff(branchName, filePath, this.getBranchFileHandlerDeps(repoId));
	}

	handleOpenExternal(_repoId: string | undefined, url: string): void {
		void vscode.env.openExternal(vscode.Uri.parse(url));
	}

	handleOpenCommit(_repoId: string | undefined, sha: string): void {
		void vscode.commands.executeCommand('git.openCommit', sha);
	}

	async handleOpenCommitDiff(repoId: string | undefined, sha: string): Promise<void> {
		await handleOpenCommitDiff(sha, this.getDiffHandlerDeps(repoId));
	}

	async handleOpenFileDiff(repoId: string | undefined, sha: string, filePath: string): Promise<void> {
		await handleOpenFileDiff(sha, filePath, this.getDiffHandlerDeps(repoId));
	}

	async handleOpenCurrentFile(repoId: string | undefined, filePath: string): Promise<void> {
		await handleOpenCurrentFile(filePath, this.getDiffHandlerDeps(repoId));
	}

	async handleOpenWorkingCopyDiff(repoId: string | undefined, filePath: string, staged: boolean): Promise<void> {
		await handleOpenWorkingCopyDiff(filePath, staged, this.getDiffHandlerDeps(repoId));
	}

	async handleStageFile(repoId: string | undefined, filePath: string): Promise<void> {
		await handleStageFile(filePath, this.getWorkingCopyHandlerDeps(repoId));
	}

	async handleUnstageFile(repoId: string | undefined, filePath: string): Promise<void> {
		await handleUnstageFile(filePath, this.getWorkingCopyHandlerDeps(repoId));
	}

	async handleDiscardFile(repoId: string | undefined, filePath: string): Promise<void> {
		await handleDiscardFile(filePath, this.getWorkingCopyHandlerDeps(repoId));
	}

	async handleCommitChanges(repoId: string | undefined, message: string): Promise<void> {
		await handleCommitChanges(message, this.getWorkingCopyHandlerDeps(repoId));
	}

	async handleCreateBranch(repoId: string | undefined, message: string): Promise<void> {
		await handleCreateBranch(message, this.getWorkingCopyHandlerDeps(repoId));
	}

	// --- Repo Toolbar Handlers ---

	/** Syncs a specific repo with its remote. */
	async handleRepoSync(repoId: string | undefined): Promise<void> {
		const folder = this.resolveWorkspaceFolder(repoId);
		if (!folder) return;
		await handleSync({ folder, refresh: () => this.refresh() });
	}

	/** Restacks all branches in the specified repo's stack. */
	async handleStackRestack(repoId: string | undefined): Promise<void> {
		const folder = this.resolveWorkspaceFolder(repoId);
		if (!folder) return;
		await runWithProgress('Restacking stack...', () => execStackRestack(folder), 'Stack restacked successfully', () => this.refresh());
	}

	/** Submits the specified repo's stack. */
	async handleStackSubmit(repoId: string | undefined): Promise<void> {
		const folder = this.resolveWorkspaceFolder(repoId);
		if (!folder) return;
		await runWithProgress('Submitting stack...', () => execStackSubmit(folder), 'Stack submitted successfully', () => this.refresh());
	}

	// --- Branch Command Infrastructure ---

	private getCommandRunnerDeps(repoId?: string): BranchCommandRunnerDeps {
		return {
			getActiveWorkspaceFolder: () => this.resolveWorkspaceFolder(repoId),
			refresh: () => this.refresh(),
		};
	}

	public async handleBranchCommand(commandName: string, branchName: string): Promise<void> {
		await executeBranchCommand(commandName, branchName, this.getCommandRunnerDeps());
	}

	async handleBranchCommandInternal(
		repoId: string | undefined,
		commandName: string,
		branchName: string,
		execFunction: ExecFunction,
	): Promise<void> {
		await executeBranchCommandWithExec(commandName, branchName, execFunction, this.getCommandRunnerDeps(repoId));
	}

	getExecFunctions(): ExecFunctionMap {
		return getExecFunctions();
	}

	dispose(): void {
		this.fileWatcher.dispose();
		for (const d of this.disposables) d.dispose();
		this.disposables.length = 0;
	}
}
