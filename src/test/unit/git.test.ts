/**
 * Unit tests for git.ts pure helpers.
 * `filterIgnoredPaths` itself spawns git (covered by E2E); here we test the
 * pure parsing of `git check-ignore -z` output.
 */

import * as assert from 'assert';

import { parseNonIgnoredPaths } from '../../utils/git';

describe('git', () => {
	describe('parseNonIgnoredPaths', () => {
		it('returns paths not present in the ignored (check-ignore) output', () => {
			const input = ['/repo/src/a.ts', '/repo/dist/b.js', '/repo/out/c.js'];
			// check-ignore echoes the ignored subset, NUL-separated.
			const ignored = '/repo/dist/b.js\0/repo/out/c.js\0';
			assert.deepStrictEqual(parseNonIgnoredPaths(input, ignored), ['/repo/src/a.ts']);
		});

		it('returns all paths when nothing is ignored (empty output)', () => {
			const input = ['/repo/src/a.ts', '/repo/src/b.ts'];
			assert.deepStrictEqual(parseNonIgnoredPaths(input, ''), input);
		});

		it('returns no paths when everything is ignored', () => {
			const input = ['/repo/dist/a.js', '/repo/dist/b.js'];
			const ignored = '/repo/dist/a.js\0/repo/dist/b.js\0';
			assert.deepStrictEqual(parseNonIgnoredPaths(input, ignored), []);
		});

		it('tolerates output without a trailing NUL', () => {
			const input = ['/repo/a', '/repo/b'];
			assert.deepStrictEqual(parseNonIgnoredPaths(input, '/repo/a'), ['/repo/b']);
		});

		it('handles an empty input list', () => {
			assert.deepStrictEqual(parseNonIgnoredPaths([], ''), []);
		});
	});
});
