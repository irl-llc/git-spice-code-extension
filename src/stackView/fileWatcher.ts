import * as vscode from 'vscode';

import { FILE_WATCHER_DEBOUNCE_MS } from '../constants';

/**
 * Manages file system watchers for the stack view.
 * Tracks changes to git internals, workspace files, and document saves.
 */
export class FileWatcherManager implements vscode.Disposable {
	private gitWatcher: vscode.FileSystemWatcher | undefined;
	private workspaceWatcher: vscode.FileSystemWatcher | undefined;
	private saveListener: vscode.Disposable | undefined;
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly onRefreshNeeded: () => void) {}

	/**
	 * Sets up all file watchers for the given workspace folder.
	 * Disposes existing watchers before creating new ones.
	 */
	watch(folder: vscode.WorkspaceFolder): void {
		this.dispose();
		this.setupGitWatcher(folder);
		this.setupWorkspaceWatcher(folder);
		this.setupSaveListener();
	}

	/** Watches .git internals for branch/index/spice-data changes. */
	private setupGitWatcher(folder: vscode.WorkspaceFolder): void {
		const gitDir = vscode.Uri.joinPath(folder.uri, '.git');
		const pattern = new vscode.RelativePattern(gitDir, '{refs/spice/data,HEAD,refs/heads/**,index}');
		this.gitWatcher = vscode.workspace.createFileSystemWatcher(pattern);

		const handler = (): void => this.debouncedRefresh();
		this.gitWatcher.onDidChange(handler);
		this.gitWatcher.onDidCreate(handler);
		this.gitWatcher.onDidDelete(handler);
	}

	/** Watches workspace files for working-copy changes (edits, creates, deletes). */
	private setupWorkspaceWatcher(folder: vscode.WorkspaceFolder): void {
		const pattern = new vscode.RelativePattern(folder.uri, '**/*');
		this.workspaceWatcher = vscode.workspace.createFileSystemWatcher(pattern);

		const handler = (): void => this.debouncedRefresh();
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

	/** Debounced refresh — coalesces rapid file-system events into a single refresh. */
	private debouncedRefresh(): void {
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => {
			this.onRefreshNeeded();
		}, FILE_WATCHER_DEBOUNCE_MS);
	}

	/** Disposes all watchers and timers. */
	dispose(): void {
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
}
