/**
 * Unit tests for commentThreadMapping.ts — placement of forge inline comments
 * onto a single diff editor (no vscode dependency).
 */

import * as assert from 'assert';

import { distinctFilePaths, mapCommentsToThreads } from '../../stackView/commentThreadMapping';
import type { InlineComment } from '../../commentSchema';

/** Builds a minimal forge comment with overrides. */
function comment(partial: Partial<InlineComment>): InlineComment {
	return { kind: 'forge', id: 'c1', scope: 'line', body: 'b', ...partial } as InlineComment;
}

describe('mapCommentsToThreads', () => {
	const ABS = '/abs/repo/src/file.ts';

	it('anchors a line comment to its zero-based line on the matching file', () => {
		const specs = mapCommentsToThreads(ABS, [comment({ scope: 'line', path: 'src/file.ts', line: 42 })]);

		assert.strictEqual(specs.length, 1);
		assert.strictEqual(specs[0].line, 41);
		assert.strictEqual(specs[0].comments[0].body, 'b');
	});

	it('anchors a file-scope comment to the top of the matching file', () => {
		const specs = mapCommentsToThreads(ABS, [comment({ scope: 'file', path: 'src/file.ts' })]);

		assert.strictEqual(specs.length, 1);
		assert.strictEqual(specs[0].line, 0);
	});

	it('anchors a pr-scope comment to the top regardless of path', () => {
		const specs = mapCommentsToThreads(ABS, [comment({ scope: 'pr', id: 'pr1', body: 'whole PR' })]);

		assert.strictEqual(specs.length, 1);
		assert.strictEqual(specs[0].line, 0);
		assert.strictEqual(specs[0].comments[0].body, 'whole PR');
	});

	it('skips line/file comments that target a different file', () => {
		const specs = mapCommentsToThreads(ABS, [comment({ scope: 'line', path: 'src/other.ts', line: 5 })]);

		assert.strictEqual(specs.length, 0);
	});

	it('does not match a different file that shares a suffix substring', () => {
		// 'file.ts' must be a path segment, not a substring of 'myfile.ts'.
		const specs = mapCommentsToThreads('/abs/repo/src/myfile.ts', [
			comment({ scope: 'line', path: 'file.ts', line: 3 }),
		]);

		assert.strictEqual(specs.length, 0);
	});

	it('produces a distinct stable key per comment', () => {
		const specs = mapCommentsToThreads(ABS, [
			comment({ scope: 'pr', id: 'pr1' }),
			comment({ scope: 'line', id: 'l1', path: 'src/file.ts', line: 10 }),
		]);

		assert.strictEqual(specs.length, 2);
		assert.notStrictEqual(specs[0].key, specs[1].key);
		assert.strictEqual(specs[1].key, 'line:9:l1');
	});

	it('matches on a Windows-style backslash path separator', () => {
		const specs = mapCommentsToThreads('C:\\repo\\src\\file.ts', [
			comment({ scope: 'line', path: 'src\\file.ts', line: 2 }),
		]);

		assert.strictEqual(specs.length, 1);
		assert.strictEqual(specs[0].line, 1);
	});

	it('matches a forward-slashed forge path against a backslashed Windows absolute path', () => {
		// Forge comment paths are always forward-slashed; the diff URI's absolute
		// path uses the OS separator. On Windows the two differ and must still match.
		const specs = mapCommentsToThreads('C:\\repo\\src\\file.ts', [
			comment({ scope: 'line', path: 'src/file.ts', line: 2 }),
		]);

		assert.strictEqual(specs.length, 1);
		assert.strictEqual(specs[0].line, 1);
	});

	it('treats a line comment with no/zero line as top-anchored', () => {
		const specs = mapCommentsToThreads(ABS, [comment({ scope: 'line', path: 'src/file.ts' })]);

		assert.strictEqual(specs.length, 1);
		assert.strictEqual(specs[0].line, 0);
	});
});

describe('distinctFilePaths', () => {
	it('returns distinct paths of line- and file-scoped comments', () => {
		const paths = distinctFilePaths([
			comment({ scope: 'line', path: 'a.ts', line: 1 }),
			comment({ scope: 'line', path: 'a.ts', line: 9 }),
			comment({ scope: 'file', path: 'b.ts' }),
		]);

		assert.deepStrictEqual([...paths].sort(), ['a.ts', 'b.ts']);
	});

	it('excludes pr-scoped comments and entries without a path', () => {
		const paths = distinctFilePaths([
			comment({ scope: 'pr', id: 'p1', body: 'whole pr' }),
			comment({ scope: 'line', path: '', line: 2 }),
			comment({ scope: 'line', path: 'kept.ts', line: 3 }),
		]);

		assert.deepStrictEqual(paths, ['kept.ts']);
	});
});
