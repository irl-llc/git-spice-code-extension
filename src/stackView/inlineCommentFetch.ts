/**
 * Per-branch inline-comment fetch, used to populate the InlineCommentCache.
 *
 * Inline comments come from `gs branch comment list --branch <name> --json`,
 * which queries the forge over the network — one call per branch that has a
 * Change Request. This module fans those calls out across every tracked branch
 * with a change id and returns `[changeId, comments]` pairs ready to merge into
 * the cache. It holds no `vscode` state beyond the exec function it is given,
 * so the orchestration is unit-testable with a fake fetcher.
 */

import type { FolderUri, InlineCommentLoadResult } from '../utils/gitSpice';
import type { GitSpiceBranch, InlineComment } from '../gitSpiceSchema';
import type { InlineCommentCache } from './commentCache';

/** Function shape that loads inline comments for a single branch. */
export type InlineCommentFetcher = (folder: FolderUri, branchName: string) => Promise<InlineCommentLoadResult>;

/** A repo's folder paired with the branches whose comments should be fetched. */
export type InlineCommentFetchTarget = {
	folder: FolderUri;
	branches: ReadonlyArray<GitSpiceBranch>;
};

/** Branches that carry a Change Request id — the only ones with forge comments. */
function branchesWithChange(branches: ReadonlyArray<GitSpiceBranch>): Array<{ name: string; changeId: string }> {
	const targets: Array<{ name: string; changeId: string }> = [];
	for (const branch of branches) {
		if (branch.change?.id) targets.push({ name: branch.name, changeId: branch.change.id });
	}
	return targets;
}

/** Fetches one branch's comments, returning a cache pair or undefined on error/empty. */
async function fetchBranchComments(
	fetch: InlineCommentFetcher,
	folder: FolderUri,
	target: { name: string; changeId: string },
): Promise<[string, InlineComment[]] | undefined> {
	const result = await fetch(folder, target.name);
	if ('error' in result) return undefined;
	return [target.changeId, result.value];
}

/**
 * Fetches inline comments for every branch with a change id across all targets,
 * in parallel, and returns `[changeId, comments]` pairs for the ones that
 * succeeded. Failed branches are simply omitted (their cached value, if any, is
 * left untouched by the caller). Never throws.
 */
export async function fetchInlineComments(
	fetch: InlineCommentFetcher,
	targets: ReadonlyArray<InlineCommentFetchTarget>,
): Promise<Array<[string, InlineComment[]]>> {
	const calls: Array<Promise<[string, InlineComment[]] | undefined>> = [];
	for (const target of targets) {
		for (const branch of branchesWithChange(target.branches)) {
			calls.push(fetchBranchComments(fetch, target.folder, branch));
		}
	}
	const results = await Promise.all(calls);
	return results.filter((pair): pair is [string, InlineComment[]] => pair !== undefined);
}

/** A repo state contributing its root folder + branches to an inline fetch. */
export type InlineCommentSource = { rootUri: FolderUri['uri']; branches: ReadonlyArray<GitSpiceBranch> };

/**
 * Fetches inline comments across all sources and rewrites `cache` in place with
 * the results, keyed by Change Request id. The cache is fully replaced so
 * comments for deleted/merged CRs cannot linger. Used by StackViewProvider on
 * forge-enabled refreshes.
 */
export async function refreshInlineCommentCache(
	fetch: InlineCommentFetcher,
	sources: Iterable<InlineCommentSource>,
	cache: InlineCommentCache,
): Promise<void> {
	const targets: InlineCommentFetchTarget[] = [];
	for (const source of sources) {
		targets.push({ folder: { uri: source.rootUri }, branches: source.branches });
	}
	const pairs = await fetchInlineComments(fetch, targets);
	cache.clear();
	for (const [changeId, comments] of pairs) cache.set(changeId, comments);
}
