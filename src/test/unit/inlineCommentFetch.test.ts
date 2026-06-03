/**
 * Unit tests for inlineCommentFetch.ts — fan-out of per-branch inline-comment
 * fetches into [changeId, comments] cache pairs (no vscode dependency).
 */

import * as assert from 'assert';

import { fetchInlineComments, type InlineCommentFetcher } from '../../stackView/inlineCommentFetch';
import type { GitSpiceBranch, InlineComment } from '../../gitSpiceSchema';

/** A branch carrying an optional change id. */
function branch(name: string, changeId?: string): GitSpiceBranch {
	return changeId ? { name, change: { id: changeId, url: `http://x/${changeId}` } } : { name };
}

/** A line-scope forge comment. */
function lineComment(id: string, body: string): InlineComment {
	return { kind: 'forge', id, scope: 'line', body };
}

const folder = { uri: { fsPath: '/repo' } } as unknown as Parameters<InlineCommentFetcher>[0];

describe('fetchInlineComments', () => {
	it('fetches only branches with a change id and keys by change id', async () => {
		const calls: string[] = [];
		const fetch: InlineCommentFetcher = (_f, name) => {
			calls.push(name);
			return Promise.resolve({ value: [lineComment('1', `c-${name}`)] });
		};

		const pairs = await fetchInlineComments(fetch, [
			{ folder, branches: [branch('feat-a', 'CR-1'), branch('untracked'), branch('feat-b', 'CR-2')] },
		]);

		assert.deepStrictEqual(calls.sort(), ['feat-a', 'feat-b']);
		const byChange = new Map(pairs);
		assert.strictEqual(byChange.get('CR-1')?.[0].body, 'c-feat-a');
		assert.strictEqual(byChange.get('CR-2')?.[0].body, 'c-feat-b');
	});

	it('omits branches whose fetch errored, keeping the successful ones', async () => {
		const fetch: InlineCommentFetcher = (_f, name) =>
			name === 'bad'
				? Promise.resolve({ error: 'boom' })
				: Promise.resolve({ value: [lineComment('1', name)] });

		const pairs = await fetchInlineComments(fetch, [
			{ folder, branches: [branch('good', 'CR-1'), branch('bad', 'CR-2')] },
		]);

		const byChange = new Map(pairs);
		assert.strictEqual(byChange.size, 1);
		assert.ok(byChange.has('CR-1'));
		assert.ok(!byChange.has('CR-2'));
	});

	it('returns an empty list when no branch has a change id', async () => {
		const fetch: InlineCommentFetcher = () => Promise.resolve({ value: [] });

		const pairs = await fetchInlineComments(fetch, [{ folder, branches: [branch('x'), branch('y')] }]);

		assert.deepStrictEqual(pairs, []);
	});

	it('preserves an empty comment array for a branch with no comments', async () => {
		const fetch: InlineCommentFetcher = () => Promise.resolve({ value: [] });

		const pairs = await fetchInlineComments(fetch, [{ folder, branches: [branch('feat', 'CR-9')] }]);

		assert.deepStrictEqual(pairs, [['CR-9', []]]);
	});
});
