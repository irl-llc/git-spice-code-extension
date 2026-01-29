import * as assert from 'assert';
import { mapGitStatusChar, parseGitStatusOutput } from '../../stackView/workingCopy';

describe('workingCopy', () => {
	describe('mapGitStatusChar', () => {
		it('should map A to A (added)', () => {
			assert.strictEqual(mapGitStatusChar('A'), 'A');
		});

		it('should map M to M (modified)', () => {
			assert.strictEqual(mapGitStatusChar('M'), 'M');
		});

		it('should map D to D (deleted)', () => {
			assert.strictEqual(mapGitStatusChar('D'), 'D');
		});

		it('should map R to R (renamed)', () => {
			assert.strictEqual(mapGitStatusChar('R'), 'R');
		});

		it('should map C to C (copied)', () => {
			assert.strictEqual(mapGitStatusChar('C'), 'C');
		});

		it('should map T to T (type changed)', () => {
			assert.strictEqual(mapGitStatusChar('T'), 'T');
		});

		it('should map ? to U (untracked)', () => {
			assert.strictEqual(mapGitStatusChar('?'), 'U');
		});

		it('should default to M for unknown characters', () => {
			assert.strictEqual(mapGitStatusChar('X'), 'M');
			assert.strictEqual(mapGitStatusChar(''), 'M');
		});
	});

	describe('parseGitStatusOutput', () => {
		it('should return empty arrays for empty input', () => {
			const result = parseGitStatusOutput('');
			assert.deepStrictEqual(result.staged, []);
			assert.deepStrictEqual(result.unstaged, []);
		});

		it('should parse a staged modified file', () => {
			const result = parseGitStatusOutput('M  src/file.ts');
			assert.deepStrictEqual(result.staged, [{ path: 'src/file.ts', status: 'M' }]);
			assert.deepStrictEqual(result.unstaged, []);
		});

		it('should parse an unstaged modified file', () => {
			const result = parseGitStatusOutput(' M src/file.ts');
			assert.deepStrictEqual(result.staged, []);
			assert.deepStrictEqual(result.unstaged, [{ path: 'src/file.ts', status: 'M' }]);
		});

		it('should parse a file with both staged and unstaged changes', () => {
			const result = parseGitStatusOutput('MM src/file.ts');
			assert.deepStrictEqual(result.staged, [{ path: 'src/file.ts', status: 'M' }]);
			assert.deepStrictEqual(result.unstaged, [{ path: 'src/file.ts', status: 'M' }]);
		});

		it('should parse a staged added file', () => {
			const result = parseGitStatusOutput('A  src/new-file.ts');
			assert.deepStrictEqual(result.staged, [{ path: 'src/new-file.ts', status: 'A' }]);
			assert.deepStrictEqual(result.unstaged, []);
		});

		it('should parse an untracked file', () => {
			const result = parseGitStatusOutput('?? src/untracked.ts');
			assert.deepStrictEqual(result.staged, []);
			assert.deepStrictEqual(result.unstaged, [{ path: 'src/untracked.ts', status: 'U' }]);
		});

		it('should parse a staged deleted file', () => {
			const result = parseGitStatusOutput('D  src/deleted.ts');
			assert.deepStrictEqual(result.staged, [{ path: 'src/deleted.ts', status: 'D' }]);
			assert.deepStrictEqual(result.unstaged, []);
		});

		it('should parse multiple files', () => {
			const output = `M  src/modified.ts
A  src/added.ts
 M src/unstaged.ts
?? src/untracked.ts`;
			const result = parseGitStatusOutput(output);
			assert.strictEqual(result.staged.length, 2);
			assert.strictEqual(result.unstaged.length, 2);
		});

		it('should skip lines that are too short', () => {
			const result = parseGitStatusOutput('M\nAB');
			assert.deepStrictEqual(result.staged, []);
			assert.deepStrictEqual(result.unstaged, []);
		});

		it('should handle Windows-style line endings', () => {
			const result = parseGitStatusOutput('M  src/file1.ts\r\n M src/file2.ts\r\n');
			assert.strictEqual(result.staged.length, 1);
			assert.strictEqual(result.unstaged.length, 1);
		});
	});
});
