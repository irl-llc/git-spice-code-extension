/**
 * Stack View Provider - Main orchestrator for the git-spice webview.
 * Manages per-repo state and delegates operations to specialized handlers.
 */

import * as vscode from 'vscode';

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
		const folder = this.getActiveWorkspaceFolder();
		if (!folder) {
			void vscode.window.showErrorMessage('No workspace folder available.');
			return;
		}
		await handleSync({ folder, refresh: () => this.refresh() });
	}

	// --- Repo Resolution ---

	/**
	 * Returns the workspace folder for the "active" repo (the one with current branch).
	 * Falls back to the first repo or fallback folder.
	 */
	private getActiveWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
		const active = this.findActiveRepoState();
		if (active) return { uri: active.rootUri, name: active.name, index: 0 };
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

	/** Returns branches from the active repo. */
	private getActiveBranches(): GitSpiceBranch[] {
		return this.findActiveRepoState()?.branches ?? [];
	}

	/** Returns uncommitted state from the active repo. */
	private getActiveUncommitted(): UncommittedState | undefined {
		return this.findActiveRepoState()?.uncommitted;
	}

	// --- Handler Dependency Factories ---

	private getBranchHandlerDeps(): BranchHandlerDeps {
		return {
			workspaceFolder: this.getActiveWorkspaceFolder(),
			branches: this.getActiveBranches(),
			runBranchCommand: (title, op, msg) => runWithProgress(title, op, msg, () => this.refresh()),
			handleBranchCommandInternal: (cmd, branch, fn) => this.handleBranchCommandInternal(cmd, branch, fn),
			postMessageToWebview: (message) => this.view?.webview.postMessage(message),
		};
	}

	private getCommitHandlerDeps(): CommitHandlerDeps {
		return {
			workspaceFolder: this.getActiveWorkspaceFolder(),
			runBranchCommand: (title, op, msg) => runWithProgress(title, op, msg, () => this.refresh()),
			refresh: () => this.refresh(),
			postCommitFilesToWebview: (sha, files) =>
				this.view?.webview.postMessage({ type: 'commitFiles', sha, files }),
		};
	}

	private getDiffHandlerDeps(): DiffHandlerDeps {
		return { workspaceFolder: this.getActiveWorkspaceFolder() };
	}

	private getWorkingCopyHandlerDeps(): WorkingCopyHandlerDeps {
		return {
			workspaceFolder: this.getActiveWorkspaceFolder(),
			uncommitted: this.getActiveUncommitted(),
			refresh: () => this.refresh(),
		};
	}

	private getBranchFileHandlerDeps(): BranchFileHandlerDeps {
		return {
			workspaceFolder: this.getActiveWorkspaceFolder(),
			branches: this.getActiveBranches(),
			postBranchFilesToWebview: (branchName, files) =>
				this.view?.webview.postMessage({ type: 'branchFiles', branchName, files }),
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

	async handleGetBranchFiles(branchName: string): Promise<void> {
		await handleGetBranchFiles(branchName, this.getBranchFileHandlerDeps());
	}

	async handleOpenBranchFileDiff(branchName: string, filePath: string): Promise<void> {
		await handleOpenBranchFileDiff(branchName, filePath, this.getBranchFileHandlerDeps());
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

	private getCommandRunnerDeps(): BranchCommandRunnerDeps {
		return {
			getActiveWorkspaceFolder: () => this.getActiveWorkspaceFolder(),
			refresh: () => this.refresh(),
		};
	}

	public async handleBranchCommand(commandName: string, branchName: string): Promise<void> {
		await executeBranchCommand(commandName, branchName, this.getCommandRunnerDeps());
	}

	async handleBranchCommandInternal(
		commandName: string,
		branchName: string,
		execFunction: ExecFunction,
	): Promise<void> {
		await executeBranchCommandWithExec(commandName, branchName, execFunction, this.getCommandRunnerDeps());
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
