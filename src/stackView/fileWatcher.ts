/**
 * Manages file system watchers for the stack view.
 * Supports watching multiple repositories simultaneously.
 */

import * as vscode from 'vscode';

import { FILE_WATCHER_DEBOUNCE_MS } from '../constants';
import type { DiscoveredRepo } from '../repoDiscovery';

/** Watchers for a single repository. */
interface RepoWatchers extends vscode.Disposable {
	git: vscode.FileSystemWatcher;
	workspace: vscode.FileSystemWatcher;
}

/**
 * Manages file system watchers for one or more git repositories.
 * Tracks changes to git internals and workspace files.
 */
export class FileWatcherManager implements vscode.Disposable {
	private readonly repoWatchers = new Map<string, RepoWatchers>();
	private saveListener: vscode.Disposable | undefined;
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly onRefreshNeeded: () => void) {}

	/** Watches a single workspace folder (backward compat). */
	watch(folder: vscode.WorkspaceFolder): void {
		this.watchAll([{ rootUri: folder.uri, name: folder.name }]);
	}

	/** Syncs watchers to match the given set of repos. */
	watchAll(repos: ReadonlyArray<DiscoveredRepo>): void {
		const newIds = new Set(repos.map((r) => r.rootUri.fsPath));
		this.removeStaleWatchers(newIds);
		this.addMissingWatchers(repos);
		this.ensureSaveListener();
	}

	/** Removes watchers for repos no longer in the set. */
	private removeStaleWatchers(activeIds: Set<string>): void {
		for (const [id, watchers] of this.repoWatchers) {
			if (activeIds.has(id)) continue;
			watchers.dispose();
			this.repoWatchers.delete(id);
		}
	}

	/** Adds watchers for repos not yet tracked. */
	private addMissingWatchers(repos: ReadonlyArray<DiscoveredRepo>): void {
		for (const repo of repos) {
			if (this.repoWatchers.has(repo.rootUri.fsPath)) continue;
			this.repoWatchers.set(repo.rootUri.fsPath, this.createRepoWatchers(repo.rootUri));
		}
	}

	/** Creates git + workspace watchers for a single repo. */
	private createRepoWatchers(rootUri: vscode.Uri): RepoWatchers {
		const git = this.createGitWatcher(rootUri);
		const workspace = this.createWorkspaceWatcher(rootUri);
		return {
			git,
			workspace,
			dispose: () => { git.dispose(); workspace.dispose(); },
		};
	}

	/** Watches .git internals for branch/index/spice-data changes. */
	private createGitWatcher(rootUri: vscode.Uri): vscode.FileSystemWatcher {
		const gitDir = vscode.Uri.joinPath(rootUri, '.git');
		const pattern = new vscode.RelativePattern(gitDir, '{refs/spice/data,HEAD,refs/heads/**,index}');
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);
		const handler = (): void => this.debouncedRefresh();
		watcher.onDidChange(handler);
		watcher.onDidCreate(handler);
		watcher.onDidDelete(handler);
		return watcher;
	}

	/** Watches workspace files for working-copy changes. */
	private createWorkspaceWatcher(rootUri: vscode.Uri): vscode.FileSystemWatcher {
		const pattern = new vscode.RelativePattern(rootUri, '**/*');
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);
		const handler = (): void => this.debouncedRefresh();
		watcher.onDidChange(handler);
		watcher.onDidCreate(handler);
		watcher.onDidDelete(handler);
		return watcher;
	}

	/** Ensures the document save listener exists. */
	private ensureSaveListener(): void {
		if (this.saveListener) return;
		this.saveListener = vscode.workspace.onDidSaveTextDocument(() => this.debouncedRefresh());
	}

	/** Debounced refresh — coalesces rapid file-system events. */
	private debouncedRefresh(): void {
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => this.onRefreshNeeded(), FILE_WATCHER_DEBOUNCE_MS);
	}

	/** Disposes all watchers and timers. */
	dispose(): void {
		for (const watchers of this.repoWatchers.values()) watchers.dispose();
		this.repoWatchers.clear();
		this.saveListener?.dispose();
		this.saveListener = undefined;
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	}
}
