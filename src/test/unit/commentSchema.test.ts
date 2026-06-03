import * as assert from 'assert';
import { parseInlineComments, type InlineComment } from '../../commentSchema';

/** A complete forge comment line as `gs branch comment list --json` emits it. */
const FORGE_LINE = JSON.stringify({
	kind: 'forge',
	id: 'c-42',
	scope: 'line',
	path: 'src/app.ts',
	line: 17,
	range: { start: 15, end: 17 },
	side: 'RIGHT',
	commitSHA: 'deadbeef',
	body: 'Please rename this.',
	threadID: 't-7',
	author: 'octocat',
	resolved: false,
	stale: true,
	status: 'open',
	createdAt: '2026-06-01T12:00:00Z',
});

describe('commentSchema', () => {
	describe('parseInlineComments', () => {
		it('parses empty and whitespace-only input as empty array', () => {
			assert.deepStrictEqual(parseInlineComments(''), []);
			assert.deepStrictEqual(parseInlineComments('  \n\n \r\n'), []);
		});

		it('parses a full forge comment with every optional field', () => {
			const [comment] = parseInlineComments(FORGE_LINE);
			const expected: InlineComment = {
				kind: 'forge',
				id: 'c-42',
				scope: 'line',
				path: 'src/app.ts',
				line: 17,
				range: { start: 15, end: 17 },
				side: 'right',
				commitSha: 'deadbeef',
				body: 'Please rename this.',
				threadId: 't-7',
				author: 'octocat',
				resolved: false,
				stale: true,
				status: 'open',
				createdAt: '2026-06-01T12:00:00Z',
			};
			assert.deepStrictEqual(comment, expected);
		});

		it('normalizes both upper and lowercase diff sides', () => {
			const lines = [
				JSON.stringify({ kind: 'forge', id: '1', scope: 'line', body: 'b', side: 'LEFT' }),
				JSON.stringify({ kind: 'forge', id: '2', scope: 'line', body: 'b', side: 'right' }),
			].join('\n');
			const result = parseInlineComments(lines);
			assert.strictEqual(result[0].side, 'left');
			assert.strictEqual(result[1].side, 'right');
		});

		it('parses a minimal comment, omitting absent optionals', () => {
			const line = JSON.stringify({ kind: 'staged', id: 'sc-1', scope: 'pr', body: 'top-level note' });
			const [comment] = parseInlineComments(line);
			assert.deepStrictEqual(comment, {
				kind: 'staged',
				id: 'sc-1',
				scope: 'pr',
				body: 'top-level note',
			});
			assert.strictEqual('path' in comment, false);
			assert.strictEqual('resolved' in comment, false);
		});

		it('keeps an empty-string body (a valid, present field)', () => {
			const line = JSON.stringify({ kind: 'forge', id: '1', scope: 'pr', body: '' });
			const [comment] = parseInlineComments(line);
			assert.strictEqual(comment.body, '');
		});

		it('parses multiple NDJSON lines and tolerates CRLF endings', () => {
			const result = parseInlineComments(`${FORGE_LINE}\r\n${FORGE_LINE}`);
			assert.strictEqual(result.length, 2);
		});

		it('drops entries missing required kind, id, scope, or body', () => {
			const lines = [
				JSON.stringify({ id: '1', scope: 'pr', body: 'b' }), // no kind
				JSON.stringify({ kind: 'forge', scope: 'pr', body: 'b' }), // no id
				JSON.stringify({ kind: 'forge', id: '1', body: 'b' }), // no scope
				JSON.stringify({ kind: 'forge', id: '1', scope: 'pr' }), // no body
				JSON.stringify({ kind: 'forge', id: 'ok', scope: 'pr', body: 'b' }),
			].join('\n');
			const result = parseInlineComments(lines);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].id, 'ok');
		});

		it('drops entries with invalid enum values', () => {
			const lines = [
				JSON.stringify({ kind: 'bogus', id: '1', scope: 'pr', body: 'b' }), // bad kind
				JSON.stringify({ kind: 'forge', id: '2', scope: 'gutter', body: 'b' }), // bad scope
			].join('\n');
			assert.deepStrictEqual(parseInlineComments(lines), []);
		});

		it('skips invalid JSON lines without failing', () => {
			const good = JSON.stringify({ kind: 'forge', id: '1', scope: 'pr', body: 'b' });
			const result = parseInlineComments(`not json\n${good}\n{ broken`);
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].id, '1');
		});

		it('ignores a malformed range and out-of-type optionals', () => {
			const line = JSON.stringify({
				kind: 'forge',
				id: '1',
				scope: 'line',
				body: 'b',
				range: { start: 'x' }, // malformed → dropped
				line: 'nope', // wrong type → dropped
				resolved: 'true', // wrong type → dropped
				status: 'wat', // invalid enum → dropped
			});
			const [comment] = parseInlineComments(line);
			assert.strictEqual('range' in comment, false);
			assert.strictEqual('line' in comment, false);
			assert.strictEqual('resolved' in comment, false);
			assert.strictEqual('status' in comment, false);
		});
	});
});
