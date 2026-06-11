/**
 * Pure helpers for the PR comment-count cache.
 *
 * Comment counts come from `gs ll -c`, which queries the forge over the
 * network. To keep high-frequency local refreshes off the network, the
 * provider caches counts by Change Request id and backfills them into branch
 * data that was fetched without `-c`. These helpers hold no `vscode`
 * dependency so they can be unit-tested directly.
 */

import type { GitSpiceBranch, GitSpiceComments, InlineComment } from '../gitSpiceSchema';

/** Comment counts keyed by Change Request id. */
export type CommentCache = Map<string, GitSpiceComments>;

/** Inline (per-comment) lists keyed by Change Request id. */
export type InlineCommentCache = Map<string, ReadonlyArray<InlineComment>>;

/** Extracts `[changeId, comments]` pairs from branches that carry counts. */
export function collectComments(branches: ReadonlyArray<GitSpiceBranch>): Array<[string, GitSpiceComments]> {
	const pairs: Array<[string, GitSpiceComments]> = [];
	for (const branch of branches) {
		if (branch.change?.id && branch.change.comments) {
			pairs.push([branch.change.id, branch.change.comments]);
		}
	}
	return pairs;
}

/**
 * Backfills each branch's `change.comments` from the cache when the branch was
 * fetched without comment data. Fresh counts (already present) are kept as-is.
 * Returns new branch objects; does not mutate the input.
 */
export function mergeCachedComments(branches: ReadonlyArray<GitSpiceBranch>, cache: CommentCache): GitSpiceBranch[] {
	return branches.map((branch) => {
		if (!branch.change?.id || branch.change.comments) return branch;
		const cached = cache.get(branch.change.id);
		if (!cached) return branch;
		return { ...branch, change: { ...branch.change, comments: cached } };
	});
}

/**
 * Attaches each branch's inline comment list from the cache, keyed by Change
 * Request id. Branches without a change, or whose change id is not cached, are
 * returned unchanged. Returns new branch objects; does not mutate the input.
 */
export function mergeInlineComments(
	branches: ReadonlyArray<GitSpiceBranch>,
	cache: InlineCommentCache,
): GitSpiceBranch[] {
	return branches.map((branch) => {
		if (!branch.change?.id) return branch;
		const inlineComments = cache.get(branch.change.id);
		if (!inlineComments) return branch;
		return { ...branch, change: { ...branch.change, inlineComments } };
	});
}
