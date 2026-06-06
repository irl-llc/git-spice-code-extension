/**
 * Renders forge inline comments (issue #40, slice 2) as native VS Code comment
 * threads inside git-spice-opened diff editors.
 *
 * Scoping: a single {@link vscode.CommentController} is created and threads are
 * attached ONLY to diff URIs that carry the git-spice branch marker (see
 * {@link parseGitSpiceDiffUri}). Diffs opened by the built-in Git extension or
 * the GitHub Pull Requests extension use different schemes/markers and are left
 * untouched, so comments never double-render.
 *
 * Data flow: {@link StackViewProvider} fetches inline comments (gated on
 * `showRemoteForgeStatus`) and pushes the resulting DisplayState here via
 * {@link ForgeCommentController.update}. When a marked diff is opened — now or
 * later — the controller looks up that branch's comments and lays out threads
 * using the pure {@link mapCommentsToThreads} helper.
 */

import * as nodePath from 'node:path';

import * as vscode from 'vscode';

import { buildGitUri, parseGitSpiceDiffUri } from '../utils/diffUri';
import { distinctFilePaths, mapCommentsToThreads } from './commentThreadMapping';
import type { BranchViewModel, DisplayState } from './types';
import type { InlineComment } from '../gitSpiceSchema';

/** Looks up a branch's inline comments across all repos in the display state. */
function findBranchComments(state: DisplayState, branchName: string): ReadonlyArray<InlineComment> {
	for (const repo of state.repositories) {
		const branch = repo.branches.find((b) => b.name === branchName);
		if (branch?.change?.inlineComments) return branch.change.inlineComments;
	}
	return [];
}

/** Builds the read-only comment body shown in a thread. */
function toThreadComment(comment: InlineComment): vscode.Comment {
	return {
		body: new vscode.MarkdownString(comment.body),
		mode: vscode.CommentMode.Preview,
		author: { name: comment.author ?? 'forge' },
	};
}

/**
 * Owns the CommentController and the threads it has created, keyed by the diff
 * URI they render on so re-opening or refreshing replaces them cleanly.
 */
export class ForgeCommentController implements vscode.Disposable {
	private readonly controller: vscode.CommentController;
	private readonly threadsByUri = new Map<string, vscode.CommentThread[]>();
	private readonly disposables: vscode.Disposable[] = [];
	private state: DisplayState = { repositories: [] };

	constructor() {
		this.controller = vscode.comments.createCommentController('gitSpice.forgeComments', 'Git Spice forge comments');
		this.disposables.push(
			this.controller,
			vscode.window.onDidChangeVisibleTextEditors(() => this.render()),
		);
	}

	/** Replaces the cached state and re-renders threads for all known diffs. */
	update(state: DisplayState): void {
		this.state = state;
		this.render();
	}

	/**
	 * Renders comment threads for every git-spice diff we can target: the marked
	 * diffs reconstructed from state (so threads exist even before — or inside a
	 * multi-file changes view where — the inner editor is "visible"), plus any
	 * currently visible marked diff (covers PR-scope-only branches).
	 */
	private render(): void {
		const active = new Set<string>();
		for (const uri of this.collectTargetUris().values()) {
			const key = this.renderEditor(uri);
			if (key) active.add(key);
		}
		this.pruneThreads(active);
	}

	/** Gathers the marked diff URIs to render, deduped by URI string. */
	private collectTargetUris(): Map<string, vscode.Uri> {
		const uris = new Map<string, vscode.Uri>();
		for (const repo of this.state.repositories) {
			for (const branch of repo.branches) addBranchDiffUris(uris, repo.id, branch);
		}
		for (const editor of vscode.window.visibleTextEditors) {
			const uri = editor.document.uri;
			if (parseGitSpiceDiffUri(uri)) uris.set(uri.toString(), uri);
		}
		return uris;
	}

	/** Renders threads for one document URI; returns its key when it is a marked diff. */
	private renderEditor(uri: vscode.Uri): string | undefined {
		const marker = parseGitSpiceDiffUri(uri);
		if (!marker) return undefined;
		const key = uri.toString();
		this.disposeThreads(key);
		this.threadsByUri.set(key, this.createThreads(uri, marker.branchName));
		return key;
	}

	/** Creates one CommentThread per mapped spec for the given diff URI. */
	private createThreads(uri: vscode.Uri, branchName: string): vscode.CommentThread[] {
		const filePath = readDiffPath(uri);
		const comments = findBranchComments(this.state, branchName);
		const specs = filePath ? mapCommentsToThreads(filePath, comments) : [];
		return specs.map((spec) => this.makeThread(uri, spec.line, spec.comments));
	}

	/** Builds a single collapsed, read-only comment thread at a line. */
	private makeThread(uri: vscode.Uri, line: number, comments: ReadonlyArray<InlineComment>): vscode.CommentThread {
		const range = new vscode.Range(line, 0, line, 0);
		const thread = this.controller.createCommentThread(uri, range, comments.map(toThreadComment));
		thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
		thread.canReply = false;
		return thread;
	}

	/** Disposes threads for URIs no longer visible. */
	private pruneThreads(active: Set<string>): void {
		for (const key of [...this.threadsByUri.keys()]) {
			if (!active.has(key)) this.disposeThreads(key);
		}
	}

	/** Disposes and forgets the threads currently rendered for a URI key. */
	private disposeThreads(key: string): void {
		const threads = this.threadsByUri.get(key);
		if (!threads) return;
		for (const thread of threads) thread.dispose();
		this.threadsByUri.delete(key);
	}

	dispose(): void {
		for (const key of [...this.threadsByUri.keys()]) this.disposeThreads(key);
		for (const d of this.disposables) d.dispose();
		this.disposables.length = 0;
	}
}

/**
 * Adds the reconstructed right-side diff URIs for a branch's file-anchored
 * comments. The URI matches the one `buildBranchFileDiffUris` opens (ref =
 * branch name + marker), so eagerly-created threads land on the very document
 * the changes view shows. PR-scope-only branches contribute no path here and
 * are picked up by the visible-editor pass instead.
 */
function addBranchDiffUris(uris: Map<string, vscode.Uri>, repoRoot: string, branch: BranchViewModel): void {
	const comments = branch.change?.inlineComments;
	if (!comments?.length) return;
	for (const relPath of distinctFilePaths(comments)) {
		const fileUri = vscode.Uri.file(nodePath.join(repoRoot, relPath));
		const uri = buildGitUri(fileUri, branch.name, { branchName: branch.name });
		uris.set(uri.toString(), uri);
	}
}

/** Reads the file path encoded in a git-spice diff URI query. */
function readDiffPath(uri: vscode.Uri): string | undefined {
	try {
		const parsed: unknown = JSON.parse(uri.query);
		if (typeof parsed !== 'object' || parsed === null) return undefined;
		const path = (parsed as Record<string, unknown>).path;
		return typeof path === 'string' && path.length > 0 ? path : undefined;
	} catch {
		return undefined;
	}
}
