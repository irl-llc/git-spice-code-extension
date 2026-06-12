/**
 * Stack View Provider - Main orchestrator for the git-spice webview.
 * Manages per-repo state and delegates operations to specialized handlers.
 */

import * as vscode from 'vscode';

import { AsyncCoalescer } from '../utils/asyncCoalescer';
import { execStackRestack, execStackSubmit } from '../utils/gitSpice';
import type { GitSpiceBranch } from '../gitSpiceSchema';
import type { DiscoveredRepo, RepoDiscovery } from '../repoDiscovery';
import { collectComments, mergeCachedComments, type CommentCache } from './commentCache';
import { buildRepoDisplayState, type RepoDisplayInput } from './state';
import { CollapseStore, type CollapseOp } from './collapseState';
import { fetchRepoState, fetchFolderState, type RepoState } from './repoStateBuilder';
import type { DisplayState, RepositoryViewModel, UncommittedState } from './types';
import type { WebviewMessage } from './webviewTypes';
import { renderWebviewHtml } from './webviewHtml';
import { routeMessage, type MessageHandlerContext, type ExecFunctionMap, type ExecFunction } from './messageRouter';
import { FileWatcherManager } from './fileWatcher';
import {
	buildBranchHandlerDeps,
	buildCommitHandlerDeps,
	buildDiffHandlerDeps,
	buildWorkingCopyHandlerDeps,
	buildBranchFileHandlerDeps,
	type HandlerDepsHost,
} from './handlerDeps';

import {
	handleBranchContextMenu,
	handleBranchTrack,
	handleBranchDelete,
	handleBranchRenamePrompt,
	handleBranchRename,
	handleBranchMovePrompt,
	handleBranchMove,
	handleUpstackMovePrompt,
	handleUpstackMove,
	handleCopyBranchName,
} from './handlers/branchHandlers';
import {
	handleCommitCopySha,
	handleCommitFixup,
	handleCommitSplit,
	handleGetCommitFiles,
} from './handlers/commitHandlers';
import {
	handleOpenCommitDiff,
	handleOpenFileDiff,
	handleOpenCurrentFile,
	handleOpenWorkingCopyDiff,
} from './handlers/diffHandlers';
import { handleGetBranchFiles, handleOpenBranchDiff, handleOpenBranchFileDiff } from './handlers/branchFileHandlers';
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
} from './handlers/workingCopyHandlers';

export class StackViewProvider implements vscode.WebviewViewProvider, MessageHandlerContext, HandlerDepsHost {
	private readonly hosts = new Set<vscode.Webview>();
	private readonly repoStates = new Map<string, RepoState>();
	private readonly fileWatcher: FileWatcherManager;
	private readonly refreshCoalescer = new AsyncCoalescer();
	private readonly disposables: vscode.Disposable[] = [];
	/** PR comment counts cached by Change Request id (see commentCache.ts). */
	private readonly commentCache: CommentCache = new Map();
	/** When true, the next refresh re-fetches comment counts from the forge. */
	private commentsDirty = true;
	/**
	 * Per-repo collapse-root sets (issue #66). In-memory per session — collapse
	 * state is intentionally NOT persisted across reload/restart. Keyed by repo
	 * root path; applied during the DFS in state.ts (the layout authority).
	 */
	private readonly collapse = new CollapseStore();

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
		await this.attachWebview(webviewView.webview, (cb) => webviewView.onDidDispose(cb));
	}

	/** Creates a full-editor-pane instance of the Git Spice view. */
	async openInEditor(): Promise<vscode.WebviewPanel> {
		const panel = vscode.window.createWebviewPanel(
			'gitSpice.editor',
			'Git Spice',
			{ viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: this.getLocalResourceRoots(),
			},
		);
		panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'icon.png');
		await this.attachWebview(panel.webview, (cb) => panel.onDidDispose(cb));
		return panel;
	}

	/** Common mount path for sidebar view and editor panel webviews. */
	private async attachWebview(webview: vscode.Webview, onDispose: (cb: () => void) => void): Promise<void> {
		webview.options = {
			enableScripts: true,
			localResourceRoots: this.getLocalResourceRoots(),
		};
		webview.html = await renderWebviewHtml(webview, this.extensionUri);
		webview.onDidReceiveMessage((message: WebviewMessage) => routeMessage(message, this));
		this.hosts.add(webview);
		onDispose(() => this.hosts.delete(webview));
		this.syncWatchers();
		void this.refresh();
	}

	private getLocalResourceRoots(): vscode.Uri[] {
		return [
			vscode.Uri.joinPath(this.extensionUri, 'media'),
			vscode.Uri.joinPath(this.extensionUri, 'dist'),
			vscode.Uri.joinPath(this.extensionUri, 'dist', 'codicons'),
		];
	}

	/** Broadcasts a message to every attached webview. */
	broadcast(message: unknown): void {
		for (const webview of this.hosts) {
			void webview.postMessage(message);
		}
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
			void this.fileWatcher.watchAll(repos);
		} else if (this.fallbackFolder) {
			void this.fileWatcher.watch(this.fallbackFolder);
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

	/**
	 * Refreshes the view. `force` re-renders even if state looks unchanged AND
	 * marks comment counts dirty so they are re-fetched from the forge — route
	 * explicit/remote-affecting refreshes (toolbar, sync, submit, toggle-on)
	 * through `refresh(true)`; file-watch refreshes use `refresh()` and reuse
	 * cached counts.
	 */
	async refresh(force = false): Promise<void> {
		if (force) this.commentsDirty = true;
		await this.refreshCoalescer.run(() => this.doRefresh(force));
	}

	/** Whether this refresh should re-fetch forge status (comment counts + CR status) over the network. */
	private shouldFetchForgeStatus(): boolean {
		const enabled = vscode.workspace.getConfiguration('git-spice').get<boolean>('showRemoteForgeStatus', false);
		return enabled && this.commentsDirty;
	}

	/** Fetches latest state from all repos and pushes to webview. */
	private async doRefresh(force: boolean): Promise<void> {
		this.broadcast({ type: 'refreshing' });
		const withForgeStatus = this.shouldFetchForgeStatus();
		const repos = this.getDiscoveredRepos();
		if (repos.length > 0) {
			await this.refreshRepos(repos, withForgeStatus);
		} else if (this.fallbackFolder) {
			await this.refreshFallback(withForgeStatus);
		} else {
			this.repoStates.clear();
		}
		if (withForgeStatus) {
			this.updateCommentCache();
			this.commentsDirty = false;
		}
		this.collapse.prune(new Set(this.repoStates.keys()));
		this.pushState(force);
	}

	/** Refreshes all discovered repos in parallel. */
	private async refreshRepos(repos: ReadonlyArray<DiscoveredRepo>, withForgeStatus: boolean): Promise<void> {
		const results = await Promise.all(repos.map((repo) => fetchRepoState(repo, withForgeStatus)));
		this.repoStates.clear();
		for (const state of results) this.repoStates.set(state.rootPath, state);
	}

	/** Fallback: single-folder mode (no discovery). */
	private async refreshFallback(withForgeStatus: boolean): Promise<void> {
		const state = await fetchFolderState(this.fallbackFolder!, withForgeStatus);
		this.repoStates.clear();
		this.repoStates.set(state.rootPath, state);
	}

	/**
	 * Populates the comment cache from freshly-fetched (`-c`) branch data and
	 * prunes entries for CRs that no longer exist (deleted/merged/renamed), so
	 * the cache can't grow unbounded over the extension-host lifetime. Safe
	 * because this runs only when we have fresh counts for all active branches.
	 */
	private updateCommentCache(): void {
		const activeIds = new Set<string>();
		for (const state of this.repoStates.values()) {
			for (const [id, comments] of collectComments(state.branches)) {
				this.commentCache.set(id, comments);
				activeIds.add(id);
			}
		}
		for (const id of this.commentCache.keys()) {
			if (!activeIds.has(id)) this.commentCache.delete(id);
		}
	}

	pushState(force = false): void {
		if (this.hosts.size === 0) return;
		const state = this.buildDisplayState();
		this.broadcast({ type: 'state', payload: state, force });
	}

	/** Builds the full DisplayState from all repo states. */
	private buildDisplayState(): DisplayState {
		const repositories: RepositoryViewModel[] = [];
		for (const state of this.repoStates.values()) {
			const input: RepoDisplayInput = {
				repoId: state.rootPath,
				repoName: state.name,
				branches: mergeCachedComments(state.branches, this.commentCache),
				error: state.error,
				uncommitted: state.uncommitted,
				untrackedBranch: state.untrackedBranch,
				integration: state.integration,
				collapsed: this.collapse.get(state.rootPath),
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
		await handleSync({ folder, refresh: () => this.refresh(true) });
	}

	// --- Repo Resolution ---

	/**
	 * Resolves to a specific repo by ID, or falls back to the active repo.
	 * The active repo is the one with the current branch checked out.
	 */
	resolveRepoState(repoId?: string): RepoState | undefined {
		if (repoId) return this.repoStates.get(repoId);
		return this.findActiveRepoState();
	}

	/** Returns the workspace folder for a resolved repo state. */
	resolveWorkspaceFolder(repoId?: string): vscode.WorkspaceFolder | undefined {
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

	// --- Public Handler Methods (Exposed for Message Router) ---
	// Handler-dependency objects are assembled by build*HandlerDeps (handlerDeps.ts).

	async handleBranchContextMenu(repoId: string | undefined, branchName: string): Promise<void> {
		await handleBranchContextMenu(branchName, buildBranchHandlerDeps(this, repoId));
	}

	async handleCopyBranchName(_repoId: string | undefined, branchName: string): Promise<void> {
		await handleCopyBranchName(branchName);
	}

	async handleBranchTrack(repoId: string | undefined, branchName: string): Promise<void> {
		await handleBranchTrack(branchName, buildBranchHandlerDeps(this, repoId));
	}

	public async handleBranchDelete(repoId: string | undefined, branchName: string): Promise<void> {
		await handleBranchDelete(branchName, buildBranchHandlerDeps(this, repoId));
	}

	public async handleBranchRenamePrompt(repoId: string | undefined, branchName: string): Promise<void> {
		await handleBranchRenamePrompt(branchName, buildBranchHandlerDeps(this, repoId));
	}

	async handleBranchRename(repoId: string | undefined, branchName: string, newName: string): Promise<void> {
		await handleBranchRename(branchName, newName, buildBranchHandlerDeps(this, repoId));
	}

	public async handleBranchMovePrompt(repoId: string | undefined, branchName: string): Promise<void> {
		await handleBranchMovePrompt(branchName, buildBranchHandlerDeps(this, repoId));
	}

	async handleBranchMove(repoId: string | undefined, branchName: string, newParent: string): Promise<void> {
		await handleBranchMove(branchName, newParent, buildBranchHandlerDeps(this, repoId));
	}

	public async handleUpstackMovePrompt(repoId: string | undefined, branchName: string): Promise<void> {
		await handleUpstackMovePrompt(branchName, buildBranchHandlerDeps(this, repoId));
	}

	async handleUpstackMove(repoId: string | undefined, branchName: string, newParent: string): Promise<void> {
		await handleUpstackMove(branchName, newParent, buildBranchHandlerDeps(this, repoId));
	}

	public async handleCommitCopySha(_repoId: string | undefined, sha: string): Promise<void> {
		await handleCommitCopySha(sha);
	}

	async handleCommitFixup(repoId: string | undefined, sha: string): Promise<void> {
		await handleCommitFixup(sha, buildCommitHandlerDeps(this, repoId));
	}

	public async handleCommitSplit(repoId: string | undefined, sha: string, branchName: string): Promise<void> {
		await handleCommitSplit(sha, branchName, buildCommitHandlerDeps(this, repoId));
	}

	async handleGetCommitFiles(repoId: string | undefined, sha: string): Promise<void> {
		await handleGetCommitFiles(sha, buildCommitHandlerDeps(this, repoId));
	}

	async handleGetBranchFiles(repoId: string | undefined, branchName: string): Promise<void> {
		await handleGetBranchFiles(branchName, buildBranchFileHandlerDeps(this, repoId));
	}

	async handleOpenBranchDiff(repoId: string | undefined, branchName: string): Promise<void> {
		await handleOpenBranchDiff(branchName, buildBranchFileHandlerDeps(this, repoId));
	}

	async handleOpenBranchFileDiff(
		repoId: string | undefined,
		branchName: string,
		filePath: string,
		status?: string,
	): Promise<void> {
		await handleOpenBranchFileDiff(branchName, filePath, buildBranchFileHandlerDeps(this, repoId), status);
	}

	handleOpenExternal(_repoId: string | undefined, url: string): void {
		void vscode.env.openExternal(vscode.Uri.parse(url));
	}

	handleOpenCommit(_repoId: string | undefined, sha: string): void {
		void vscode.commands.executeCommand('git.openCommit', sha);
	}

	async handleOpenCommitDiff(repoId: string | undefined, sha: string): Promise<void> {
		await handleOpenCommitDiff(sha, buildDiffHandlerDeps(this, repoId));
	}

	async handleOpenFileDiff(repoId: string | undefined, sha: string, filePath: string): Promise<void> {
		await handleOpenFileDiff(sha, filePath, buildDiffHandlerDeps(this, repoId));
	}

	async handleOpenCurrentFile(repoId: string | undefined, filePath: string): Promise<void> {
		await handleOpenCurrentFile(filePath, buildDiffHandlerDeps(this, repoId));
	}

	async handleOpenWorkingCopyDiff(
		repoId: string | undefined,
		filePath: string,
		staged: boolean,
		status?: string,
	): Promise<void> {
		await handleOpenWorkingCopyDiff(filePath, staged, buildDiffHandlerDeps(this, repoId), status);
	}

	async handleStageFile(repoId: string | undefined, filePath: string): Promise<void> {
		await handleStageFile(filePath, buildWorkingCopyHandlerDeps(this, repoId));
	}

	async handleUnstageFile(repoId: string | undefined, filePath: string): Promise<void> {
		await handleUnstageFile(filePath, buildWorkingCopyHandlerDeps(this, repoId));
	}

	async handleDiscardFile(repoId: string | undefined, filePath: string): Promise<void> {
		await handleDiscardFile(filePath, buildWorkingCopyHandlerDeps(this, repoId));
	}

	async handleCommitChanges(repoId: string | undefined, message: string): Promise<void> {
		await handleCommitChanges(message, buildWorkingCopyHandlerDeps(this, repoId));
	}

	async handleCreateBranch(repoId: string | undefined, message: string): Promise<void> {
		await handleCreateBranch(message, buildWorkingCopyHandlerDeps(this, repoId));
	}

	// --- Repo Toolbar Handlers ---

	/** Syncs a specific repo with its remote. */
	async handleRepoSync(repoId: string | undefined): Promise<void> {
		const folder = this.resolveWorkspaceFolder(repoId);
		if (!folder) return;
		await handleSync({ folder, refresh: () => this.refresh(true) });
	}

	/** Restacks all branches in the specified repo's stack. */
	async handleStackRestack(repoId: string | undefined): Promise<void> {
		const folder = this.resolveWorkspaceFolder(repoId);
		if (!folder) return;
		await runWithProgress(
			'Restacking stack...',
			() => execStackRestack(folder),
			'Stack restacked successfully',
			() => this.refresh(),
		);
	}

	// --- Subtree Collapse/Expand Handlers (issue #66) ---

	/** Resolves the repo, applies a collapse op to its set, and re-pushes state. */
	private runCollapseOp(repoId: string | undefined, op: CollapseOp): void {
		const state = this.resolveRepoState(repoId);
		if (!state) return;
		this.collapse.mutate(state.rootPath, state.branches, state.integration?.name, op);
		this.pushState(true);
	}

	/** Toggles a branch as a collapse root (hides/reveals its upstack). */
	handleCollapseSubtree(repoId: string | undefined, branchName: string): void {
		this.runCollapseOp(repoId, { kind: 'toggle', branchName });
	}

	/** Expands the given collapse roots (clicking a placeholder's [+]). */
	handleExpandSubtree(repoId: string | undefined, roots: string[]): void {
		this.runCollapseOp(repoId, { kind: 'expand', roots });
	}

	/** Collapses every stack except the clicked branch, its ancestors, and descendants. */
	handleCollapseOtherStacks(repoId: string | undefined, branchName: string): void {
		this.runCollapseOp(repoId, { kind: 'collapseOthers', branchName });
	}

	/** Submits the specified repo's stack. */
	async handleStackSubmit(repoId: string | undefined): Promise<void> {
		const folder = this.resolveWorkspaceFolder(repoId);
		if (!folder) return;
		await runWithProgress(
			'Submitting stack...',
			() => execStackSubmit(folder),
			'Stack submitted successfully',
			() => this.refresh(true),
		);
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
