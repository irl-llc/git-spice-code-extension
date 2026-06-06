/**
 * Manages file system watchers for the stack view.
 * Supports watching multiple repositories simultaneously.
 */

import { relative as pathRelative, isAbsolute as pathIsAbsolute } from 'node:path';

import * as vscode from 'vscode';

import { FILE_WATCHER_DEBOUNCE_MS } from '../constants';
import type { DiscoveredRepo } from '../repoDiscovery';
import { filterIgnoredPaths, resolveGitDirs } from '../utils/git';

/** Watchers for a single repository. */
interface RepoWatchers extends vscode.Disposable {
	git: vscode.FileSystemWatcher[];
	workspace: vscode.FileSystemWatcher;
}

/**
 * Manages file system watchers for one or more git repositories.
 * Tracks changes to git internals and workspace files.
 *
 * Workspace-file events are accumulated per repo and, at the debounce
 * boundary, filtered through `git check-ignore` so changes to gitignored
 * files (build output, logs, etc.) — which cannot affect the stack — do not
 * trigger a refresh. Git-internal events always refresh.
 */
export class FileWatcherManager implements vscode.Disposable {
	private readonly repoWatchers = new Map<string, RepoWatchers>();
	private saveListener: vscode.Disposable | undefined;
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	/** Pending workspace-file paths per repo root, awaiting ignore-filtering. */
	private pendingPaths = new Map<string, Set<string>>();
	/** A git-internal event occurred — refresh unconditionally on next flush. */
	private gitEventPending = false;

	constructor(private readonly onRefreshNeeded: () => void) {}

	/** Watches a single workspace folder (backward compat). */
	watch(folder: vscode.WorkspaceFolder): Promise<void> {
		return this.watchAll([{ rootUri: folder.uri, name: folder.name }]);
	}

	/** Syncs watchers to match the given set of repos. */
	async watchAll(repos: ReadonlyArray<DiscoveredRepo>): Promise<void> {
		const newIds = new Set(repos.map((r) => r.rootUri.fsPath));
		this.removeStaleWatchers(newIds);
		await this.addMissingWatchers(repos);
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
	private async addMissingWatchers(repos: ReadonlyArray<DiscoveredRepo>): Promise<void> {
		for (const repo of repos) {
			const id = repo.rootUri.fsPath;
			if (this.repoWatchers.has(id)) continue;
			// Reserve the slot synchronously so concurrent syncs don't double-create.
			this.repoWatchers.set(id, this.createWorkspaceOnlyWatchers(repo.rootUri));
			await this.attachGitWatchers(repo.rootUri);
		}
	}

	/** Creates the workspace watcher immediately; git watchers attach once dirs resolve. */
	private createWorkspaceOnlyWatchers(rootUri: vscode.Uri): RepoWatchers {
		const workspace = this.createWorkspaceWatcher(rootUri);
		const git: vscode.FileSystemWatcher[] = [];
		return {
			git,
			workspace,
			dispose: () => {
				for (const w of git) w.dispose();
				workspace.dispose();
			},
		};
	}

	/** Resolves the repo's real git dirs and attaches watchers for branch/HEAD/spice changes. */
	private async attachGitWatchers(rootUri: vscode.Uri): Promise<void> {
		const watchers = this.repoWatchers.get(rootUri.fsPath);
		if (!watchers) return; // Removed while we awaited.
		const dirs = await resolveGitDirs(rootUri.fsPath);
		if (!dirs || !this.repoWatchers.has(rootUri.fsPath)) return;
		// Per-worktree dir holds HEAD/index; common dir holds refs (incl. refs/spice/data).
		// They coincide for a normal repo — dedupe so we don't double-fire.
		const targets = dirs.gitDir === dirs.commonDir ? [dirs.gitDir] : [dirs.gitDir, dirs.commonDir];
		for (const dir of targets) watchers.git.push(this.createGitWatcher(dir));
	}

	/** Watches a git directory for branch/index/spice-data changes. */
	private createGitWatcher(gitDirPath: string): vscode.FileSystemWatcher {
		const gitDir = vscode.Uri.file(gitDirPath);
		const pattern = new vscode.RelativePattern(gitDir, '{refs/spice/data,HEAD,refs/heads/**,index}');
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);
		const handler = (): void => this.onGitEvent();
		watcher.onDidChange(handler);
		watcher.onDidCreate(handler);
		watcher.onDidDelete(handler);
		return watcher;
	}

	/** Watches workspace files for working-copy changes. */
	private createWorkspaceWatcher(rootUri: vscode.Uri): vscode.FileSystemWatcher {
		const pattern = new vscode.RelativePattern(rootUri, '**/*');
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);
		const root = rootUri.fsPath;
		const handler = (uri: vscode.Uri): void => this.onWorkspaceEvent(root, uri.fsPath);
		watcher.onDidChange(handler);
		watcher.onDidCreate(handler);
		watcher.onDidDelete(handler);
		return watcher;
	}

	/** Ensures the document save listener exists. */
	private ensureSaveListener(): void {
		if (this.saveListener) return;
		this.saveListener = vscode.workspace.onDidSaveTextDocument((doc) => this.onDocumentSave(doc.uri.fsPath));
	}

	/** Records a git-internal event and schedules a flush. */
	private onGitEvent(): void {
		this.gitEventPending = true;
		this.scheduleFlush();
	}

	/** Records a workspace-file event under its repo and schedules a flush. */
	private onWorkspaceEvent(repoRoot: string, fsPath: string): void {
		let set = this.pendingPaths.get(repoRoot);
		if (!set) {
			set = new Set<string>();
			this.pendingPaths.set(repoRoot, set);
		}
		set.add(fsPath);
		this.scheduleFlush();
	}

	/** Routes a saved document to its repo (if tracked) like a workspace event. */
	private onDocumentSave(fsPath: string): void {
		const root = this.findRepoRoot(fsPath);
		if (root) this.onWorkspaceEvent(root, fsPath);
	}

	/** Returns the tracked repo root containing `fsPath`, or undefined. */
	private findRepoRoot(fsPath: string): string | undefined {
		for (const root of this.repoWatchers.keys()) {
			const rel = pathRelative(root, fsPath);
			// An absolute `rel` means a different drive (Windows) — not inside.
			if (rel && !rel.startsWith('..') && !pathIsAbsolute(rel)) return root;
		}
		return undefined;
	}

	/** Debounce — coalesces rapid events into a single (async) flush. */
	private scheduleFlush(): void {
		if (this.refreshTimer) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => void this.flush(), FILE_WATCHER_DEBOUNCE_MS);
	}

	/**
	 * Refreshes if a git-internal event occurred, or if any accumulated
	 * workspace path survives `git check-ignore` (i.e. is not gitignored).
	 */
	private async flush(): Promise<void> {
		const gitPending = this.gitEventPending;
		this.gitEventPending = false;
		const pending = this.pendingPaths;
		this.pendingPaths = new Map();

		if (gitPending) {
			this.onRefreshNeeded();
			return;
		}
		for (const [root, paths] of pending) {
			const fresh = await filterIgnoredPaths(root, [...paths]);
			if (fresh.length > 0) {
				this.onRefreshNeeded();
				return;
			}
		}
	}

	/** Disposes all watchers and timers. */
	dispose(): void {
		for (const watchers of this.repoWatchers.values()) watchers.dispose();
		this.repoWatchers.clear();
		this.saveListener?.dispose();
		this.saveListener = undefined;
		this.pendingPaths.clear();
		this.gitEventPending = false;
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	}
}
