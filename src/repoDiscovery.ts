/**
 * Repository discovery via VS Code's built-in Git extension API.
 * Discovers git repositories in the workspace and filters to those
 * where git-spice is initialized.
 */

import * as path from 'node:path';

import * as vscode from 'vscode';

import { execGitSpice } from './utils/gitSpice';

/** A discovered git repository in the workspace. */
export interface DiscoveredRepo {
	/** Absolute path to the repository root. */
	rootUri: vscode.Uri;
	/** Human-readable name (folder basename). */
	name: string;
}

/** Watches for repository changes and provides the current set of discovered repos. */
export interface RepoDiscovery extends vscode.Disposable {
	readonly repositories: ReadonlyArray<DiscoveredRepo>;
	readonly onDidChange: vscode.Event<void>;
}

/** Minimal Git extension repository interface. */
interface GitExtensionRepo {
	rootUri: vscode.Uri;
}

/** Minimal Git extension API interface. */
interface GitExtensionApi {
	repositories: GitExtensionRepo[];
	onDidOpenRepository: vscode.Event<GitExtensionRepo>;
	onDidCloseRepository: vscode.Event<GitExtensionRepo>;
}

/**
 * Creates a RepoDiscovery instance backed by VS Code's Git extension.
 * Activates the git extension if needed. Returns undefined if unavailable.
 */
export async function createRepoDiscovery(): Promise<RepoDiscovery | undefined> {
	const api = await getGitExtensionApi();
	if (!api) return undefined;
	return new GitExtensionDiscovery(api);
}

/** Activates the vscode.git extension and extracts its API (v1). */
async function getGitExtensionApi(): Promise<GitExtensionApi | undefined> {
	const extension = vscode.extensions.getExtension('vscode.git');
	if (!extension) return undefined;

	try {
		if (!extension.isActive) await extension.activate();
		const exports = extension.exports;
		if (!exports) return undefined;
		return exports.getAPI(1) as GitExtensionApi | undefined;
	} catch (err) {
		console.error('Failed to activate git extension:', err);
		return undefined;
	}
}

/** Maps a Git extension repository to a DiscoveredRepo. */
function toDiscoveredRepo(repo: GitExtensionRepo): DiscoveredRepo {
	return {
		rootUri: repo.rootUri,
		name: path.basename(repo.rootUri.fsPath),
	};
}

/** Checks whether a repo has git-spice initialized by running gs ll. */
async function isGitSpiceRepo(repo: DiscoveredRepo): Promise<boolean> {
	const result = await execGitSpice({ uri: repo.rootUri });
	return !('error' in result);
}

/** Filters repos to only those with git-spice initialized. */
async function filterGitSpiceRepos(repos: DiscoveredRepo[]): Promise<DiscoveredRepo[]> {
	const checks = await Promise.all(repos.map(async (repo) => ({ repo, valid: await isGitSpiceRepo(repo) })));
	return checks.filter((c) => c.valid).map((c) => c.repo);
}

/** RepoDiscovery implementation backed by VS Code's Git extension. */
class GitExtensionDiscovery implements RepoDiscovery {
	private readonly emitter = new vscode.EventEmitter<void>();
	private readonly disposables: vscode.Disposable[] = [];
	private currentRepos: DiscoveredRepo[] = [];
	private refreshRunning = false;
	private refreshPending = false;

	readonly onDidChange = this.emitter.event;

	get repositories(): ReadonlyArray<DiscoveredRepo> {
		return this.currentRepos;
	}

	constructor(private readonly api: GitExtensionApi) {
		this.disposables.push(this.emitter);
		this.disposables.push(api.onDidOpenRepository(() => void this.refresh()));
		this.disposables.push(api.onDidCloseRepository(() => void this.refresh()));
		void this.refresh();
	}

	/**
	 * Re-scans all Git extension repos and filters for git-spice.
	 * Serialized: concurrent calls coalesce into one trailing execution.
	 */
	private async refresh(): Promise<void> {
		if (this.refreshRunning) {
			this.refreshPending = true;
			return;
		}
		this.refreshRunning = true;
		try {
			do {
				this.refreshPending = false;
				const candidates = this.api.repositories.map(toDiscoveredRepo);
				this.currentRepos = await filterGitSpiceRepos(candidates);
				this.emitter.fire();
			} while (this.refreshPending);
		} finally {
			this.refreshRunning = false;
		}
	}

	dispose(): void {
		for (const d of this.disposables) d.dispose();
		this.disposables.length = 0;
	}
}
