/**
 * Unit tests for the pure comment-cache helpers (commentCache.ts).
 */

import * as assert from 'assert';

import {
	collectComments,
	mergeCachedComments,
	mergeInlineComments,
	type CommentCache,
	type InlineCommentCache,
} from '../../stackView/commentCache';
import type { GitSpiceBranch, GitSpiceComments, InlineComment } from '../../gitSpiceSchema';

const COMMENTS: GitSpiceComments = { total: 3, resolved: 1, unresolved: 2 };

/** Minimal branch factory — only the fields the cache helpers read. */
function branch(name: string, change?: { id: string; comments?: GitSpiceComments }): GitSpiceBranch {
	return {
		name,
		...(change && {
			change: { id: change.id, url: `https://x/${change.id}`, ...(change.comments && { comments: change.comments }) },
		}),
	} as GitSpiceBranch;
}

describe('commentCache', () => {
	describe('collectComments', () => {
		it('collects [changeId, comments] only for branches that carry counts', () => {
			const branches = [
				branch('a', { id: '1', comments: COMMENTS }),
				branch('b', { id: '2' }), // change but no comments
				branch('c'), // no change
			];
			assert.deepStrictEqual(collectComments(branches), [['1', COMMENTS]]);
		});

		it('returns empty for no branches / no comment data', () => {
			assert.deepStrictEqual(collectComments([]), []);
			assert.deepStrictEqual(collectComments([branch('a'), branch('b', { id: '9' })]), []);
		});
	});

	describe('mergeCachedComments', () => {
		it('backfills comments from cache when the branch was fetched without them', () => {
			const cache: CommentCache = new Map([['1', COMMENTS]]);
			const merged = mergeCachedComments([branch('a', { id: '1' })], cache);
			assert.deepStrictEqual(merged[0].change?.comments, COMMENTS);
		});

		it('keeps fresh comments and does not overwrite them from cache', () => {
			const fresh: GitSpiceComments = { total: 9, resolved: 9, unresolved: 0 };
			const cache: CommentCache = new Map([['1', COMMENTS]]);
			const merged = mergeCachedComments([branch('a', { id: '1', comments: fresh })], cache);
			assert.deepStrictEqual(merged[0].change?.comments, fresh);
		});

		it('leaves branches unchanged when the change id is not cached', () => {
			const cache: CommentCache = new Map([['other', COMMENTS]]);
			const input = [branch('a', { id: '1' }), branch('b')];
			const merged = mergeCachedComments(input, cache);
			assert.strictEqual(merged[0].change?.comments, undefined);
			assert.strictEqual(merged[1].change, undefined);
		});

		it('does not mutate the input branches', () => {
			const cache: CommentCache = new Map([['1', COMMENTS]]);
			const input = [branch('a', { id: '1' })];
			mergeCachedComments(input, cache);
			assert.strictEqual(input[0].change?.comments, undefined);
		});
	});

	describe('mergeInlineComments', () => {
		const INLINE: ReadonlyArray<InlineComment> = [{ kind: 'forge', id: 'c1', scope: 'pr', body: 'hi' }];

		it('attaches inline comments from the cache by change id', () => {
			const cache: InlineCommentCache = new Map([['1', INLINE]]);
			const merged = mergeInlineComments([branch('a', { id: '1' })], cache);
			assert.deepStrictEqual(merged[0].change?.inlineComments, INLINE);
		});

		it('leaves branches unchanged when the change id is not cached', () => {
			const cache: InlineCommentCache = new Map([['other', INLINE]]);
			const merged = mergeInlineComments([branch('a', { id: '1' }), branch('b')], cache);
			assert.strictEqual(merged[0].change?.inlineComments, undefined);
			assert.strictEqual(merged[1].change, undefined);
		});

		it('does not mutate the input branches', () => {
			const cache: InlineCommentCache = new Map([['1', INLINE]]);
			const input = [branch('a', { id: '1' })];
			mergeInlineComments(input, cache);
			assert.strictEqual(input[0].change?.inlineComments, undefined);
		});
	});
});
