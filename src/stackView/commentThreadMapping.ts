/**
 * Pure mapping from parsed inline comments to comment-thread placements for a
 * single diff editor. Holds no `vscode` dependency so the placement logic is
 * unit-testable; the CommentController turns each {@link CommentThreadSpec}
 * into a real `vscode.CommentThread`.
 *
 * Placement rules (per the issue #40 decisions):
 *  - `scope:'line'` comments anchor to their `line` in the file they target.
 *  - `scope:'file'` comments anchor to the top of the file they target.
 *  - `scope:'pr'` comments are not file-anchored, so they surface at the top of
 *    the diff (the "summary" position) — one thread for the whole PR.
 * Comments targeting a different file than the open diff are skipped.
 *
 * Path matching: the diff editor's URI carries the absolute file path, while
 * forge comments carry a repo-relative path. A comment matches when its
 * relative path is a trailing path segment of the diff's absolute path, so
 * `file.txt` matches `/abs/repo/file.txt` but not `/abs/repo/other-file.txt`.
 */

import type { InlineComment } from '../gitSpiceSchema';

/** True when `relativePath` is a trailing path-segment suffix of `absolutePath`. */
function pathMatches(absolutePath: string, relativePath: string): boolean {
	if (absolutePath === relativePath) return true;
	return absolutePath.endsWith(`/${relativePath}`) || absolutePath.endsWith(`\\${relativePath}`);
}

/** Zero-based line a thread anchors to (VS Code uses zero-based positions). */
export type CommentThreadSpec = Readonly<{
	/** Zero-based line index for the thread anchor. */
	line: number;
	/** Comments shown in this thread, in source order. */
	comments: ReadonlyArray<InlineComment>;
	/** Stable key for diffing/reuse: scope + line + first comment id. */
	key: string;
}>;

/** Whether a comment is anchored to (and should render on) the given file. */
function targetsFile(comment: InlineComment, filePath: string): boolean {
	if (comment.scope === 'pr') return true;
	return typeof comment.path === 'string' && pathMatches(filePath, comment.path);
}

/** Zero-based anchor line for a comment within its file diff. */
function anchorLine(comment: InlineComment): number {
	if (comment.scope === 'line' && typeof comment.line === 'number' && comment.line > 0) {
		return comment.line - 1;
	}
	// file-scope and pr-scope anchor at the top of the diff.
	return 0;
}

/** Builds a stable per-thread key so re-renders can reuse existing threads. */
function threadKey(comment: InlineComment, line: number): string {
	return `${comment.scope}:${line}:${comment.id}`;
}

/**
 * Maps the comments relevant to one file diff into thread specs. Each comment
 * becomes its own thread (forge threads are already grouped upstream by
 * `threadID`, but `gs branch comment list` emits the lead comment per thread).
 * Comments for other files are filtered out. Order follows the input.
 */
export function mapCommentsToThreads(
	filePath: string,
	comments: ReadonlyArray<InlineComment>,
): ReadonlyArray<CommentThreadSpec> {
	const specs: CommentThreadSpec[] = [];
	for (const comment of comments) {
		if (!targetsFile(comment, filePath)) continue;
		const line = anchorLine(comment);
		specs.push({ line, comments: [comment], key: threadKey(comment, line) });
	}
	return specs;
}
