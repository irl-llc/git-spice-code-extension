/**
 * Unit tests for diffUri.ts
 * Tests URI construction for git diffs.
 */

import * as assert from 'assert';

import {
	EMPTY_TREE_SHA,
	GIT_SPICE_DIFF_MARKER,
	buildGitUri,
	buildCommitDiffUris,
	buildWorkingCopyDiffUris,
	parseGitSpiceDiffUri,
} from '../../utils/diffUri';

/** Creates a mock Uri for testing. */
function createMockUri(fsPath: string): ReturnType<typeof buildGitUri> {
	return {
		fsPath,
		scheme: 'file',
		query: '',
		with: (changes: { scheme?: string; query?: string }) => ({
			fsPath,
			scheme: changes.scheme ?? 'file',
			query: changes.query ?? '',
			with: () => {
				throw new Error('Nested with() not supported in mock');
			},
		}),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any;
}

describe('diffUri', () => {
	describe('EMPTY_TREE_SHA', () => {
		it('should be the well-known git empty tree SHA', () => {
			assert.strictEqual(EMPTY_TREE_SHA, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
		});
	});

	describe('buildGitUri', () => {
		it('should create git-scheme URI with path and ref in query', () => {
			const fileUri = createMockUri('/workspace/src/file.ts');
			const result = buildGitUri(fileUri, 'abc123');

			assert.strictEqual(result.scheme, 'git');
			const query = JSON.parse(result.query);
			assert.strictEqual(query.path, '/workspace/src/file.ts');
			assert.strictEqual(query.ref, 'abc123');
		});

		it('should handle HEAD ref', () => {
			const fileUri = createMockUri('/workspace/file.ts');
			const result = buildGitUri(fileUri, 'HEAD');

			const query = JSON.parse(result.query);
			assert.strictEqual(query.ref, 'HEAD');
		});

		it('should handle parent ref notation', () => {
			const fileUri = createMockUri('/workspace/file.ts');
			const result = buildGitUri(fileUri, 'abc123^');

			const query = JSON.parse(result.query);
			assert.strictEqual(query.ref, 'abc123^');
		});

		it('should handle index ref (~)', () => {
			const fileUri = createMockUri('/workspace/file.ts');
			const result = buildGitUri(fileUri, '~');

			const query = JSON.parse(result.query);
			assert.strictEqual(query.ref, '~');
		});
	});

	describe('buildCommitDiffUris', () => {
		const testSha = 'abc123def456';
		const testPath = '/workspace/src/test.ts';

		it('should build URIs for modified file (M)', () => {
			const fileUri = createMockUri(testPath);
			const result = buildCommitDiffUris(fileUri, testSha, 'M');

			const leftQuery = JSON.parse(result.left.query);
			const rightQuery = JSON.parse(result.right.query);

			assert.strictEqual(leftQuery.ref, `${testSha}^`);
			assert.strictEqual(rightQuery.ref, testSha);
		});

		it('should build URIs for added file (A)', () => {
			const fileUri = createMockUri(testPath);
			const result = buildCommitDiffUris(fileUri, testSha, 'A');

			const leftQuery = JSON.parse(result.left.query);
			const rightQuery = JSON.parse(result.right.query);

			assert.strictEqual(leftQuery.ref, EMPTY_TREE_SHA);
			assert.strictEqual(rightQuery.ref, testSha);
		});

		it('should build URIs for deleted file (D)', () => {
			const fileUri = createMockUri(testPath);
			const result = buildCommitDiffUris(fileUri, testSha, 'D');

			const leftQuery = JSON.parse(result.left.query);
			const rightQuery = JSON.parse(result.right.query);

			assert.strictEqual(leftQuery.ref, `${testSha}^`);
			assert.strictEqual(rightQuery.ref, EMPTY_TREE_SHA);
		});

		it('should treat renamed (R) as modified', () => {
			const fileUri = createMockUri(testPath);
			const result = buildCommitDiffUris(fileUri, testSha, 'R');

			const leftQuery = JSON.parse(result.left.query);
			const rightQuery = JSON.parse(result.right.query);

			assert.strictEqual(leftQuery.ref, `${testSha}^`);
			assert.strictEqual(rightQuery.ref, testSha);
		});

		it('should treat copied (C) as modified', () => {
			const fileUri = createMockUri(testPath);
			const result = buildCommitDiffUris(fileUri, testSha, 'C');

			const leftQuery = JSON.parse(result.left.query);
			const rightQuery = JSON.parse(result.right.query);

			assert.strictEqual(leftQuery.ref, `${testSha}^`);
			assert.strictEqual(rightQuery.ref, testSha);
		});

		it('should treat untracked (U) as modified', () => {
			const fileUri = createMockUri(testPath);
			const result = buildCommitDiffUris(fileUri, testSha, 'U');

			const leftQuery = JSON.parse(result.left.query);
			const rightQuery = JSON.parse(result.right.query);

			assert.strictEqual(leftQuery.ref, `${testSha}^`);
			assert.strictEqual(rightQuery.ref, testSha);
		});

		it('should preserve file path in both URIs', () => {
			const fileUri = createMockUri(testPath);
			const result = buildCommitDiffUris(fileUri, testSha, 'M');

			const leftQuery = JSON.parse(result.left.query);
			const rightQuery = JSON.parse(result.right.query);

			assert.strictEqual(leftQuery.path, testPath);
			assert.strictEqual(rightQuery.path, testPath);
		});
	});

	describe('buildWorkingCopyDiffUris', () => {
		const testPath = '/workspace/src/working.ts';

		it('should build URIs for staged changes', () => {
			const fileUri = createMockUri(testPath);
			const result = buildWorkingCopyDiffUris(fileUri, true);

			const leftQuery = JSON.parse(result.left.query);
			const rightQuery = JSON.parse(result.right.query);

			assert.strictEqual(leftQuery.ref, 'HEAD');
			assert.strictEqual(rightQuery.ref, '~');
		});

		it('should build URIs for unstaged changes', () => {
			const fileUri = createMockUri(testPath);
			const result = buildWorkingCopyDiffUris(fileUri, false);

			const leftQuery = JSON.parse(result.left.query);

			assert.strictEqual(leftQuery.ref, '~');
			assert.strictEqual(result.right.scheme, 'file');
		});

		it('should use file URI directly for unstaged right side', () => {
			const fileUri = createMockUri(testPath);
			const result = buildWorkingCopyDiffUris(fileUri, false);

			assert.strictEqual(result.right.fsPath, testPath);
			assert.strictEqual(result.right.scheme, 'file');
		});

		it('should compare empty tree to working copy for untracked unstaged files', () => {
			const fileUri = createMockUri(testPath);
			const result = buildWorkingCopyDiffUris(fileUri, false, 'U');

			const leftQuery = JSON.parse(result.left.query);
			assert.strictEqual(leftQuery.ref, EMPTY_TREE_SHA);
			assert.strictEqual(result.right.scheme, 'file');
			assert.strictEqual(result.right.fsPath, testPath);
		});

		it('should compare empty tree to index for staged added files', () => {
			const fileUri = createMockUri(testPath);
			const result = buildWorkingCopyDiffUris(fileUri, true, 'A');

			const leftQuery = JSON.parse(result.left.query);
			const rightQuery = JSON.parse(result.right.query);

			assert.strictEqual(leftQuery.ref, EMPTY_TREE_SHA);
			assert.strictEqual(rightQuery.ref, '~');
		});

		it('should compare HEAD to empty tree for staged deleted files', () => {
			const fileUri = createMockUri(testPath);
			const result = buildWorkingCopyDiffUris(fileUri, true, 'D');

			const leftQuery = JSON.parse(result.left.query);
			const rightQuery = JSON.parse(result.right.query);

			assert.strictEqual(leftQuery.ref, 'HEAD');
			assert.strictEqual(rightQuery.ref, EMPTY_TREE_SHA);
		});

		it('should fall through to default staged behavior for modified status', () => {
			const fileUri = createMockUri(testPath);
			const result = buildWorkingCopyDiffUris(fileUri, true, 'M');

			const leftQuery = JSON.parse(result.left.query);
			const rightQuery = JSON.parse(result.right.query);

			assert.strictEqual(leftQuery.ref, 'HEAD');
			assert.strictEqual(rightQuery.ref, '~');
		});
	});

	describe('git-spice diff marker', () => {
		// parseGitSpiceDiffUri only reads scheme + query, so a plain object suffices.
		const asUri = (scheme: string, query: string): ReturnType<typeof buildGitUri> =>
			({ scheme, query }) as unknown as ReturnType<typeof buildGitUri>;

		it('should embed the branch marker in the query when provided', () => {
			const fileUri = createMockUri('/repo/file.ts');
			const result = buildGitUri(fileUri, 'feat-x', { branchName: 'feat-x' });
			const query = JSON.parse(result.query);

			assert.strictEqual(query.ref, 'feat-x');
			assert.strictEqual(query[GIT_SPICE_DIFF_MARKER], 'feat-x');
		});

		it('should omit the marker when no marker is given', () => {
			const fileUri = createMockUri('/repo/file.ts');
			const result = buildGitUri(fileUri, 'HEAD');
			const query = JSON.parse(result.query);

			assert.strictEqual(query[GIT_SPICE_DIFF_MARKER], undefined);
		});

		it('should round-trip the branch name through parseGitSpiceDiffUri', () => {
			const fileUri = createMockUri('/repo/file.ts');
			const result = buildGitUri(fileUri, 'feat-y', { branchName: 'feat-y' });
			const marker = parseGitSpiceDiffUri(asUri('git', result.query));

			assert.deepStrictEqual(marker, { branchName: 'feat-y' });
		});

		it('should return undefined for a git URI without the marker', () => {
			const fileUri = createMockUri('/repo/file.ts');
			const result = buildGitUri(fileUri, 'HEAD');

			assert.strictEqual(parseGitSpiceDiffUri(asUri('git', result.query)), undefined);
		});

		it('should return undefined for a non-git scheme even with a marker', () => {
			const query = JSON.stringify({ path: '/repo/file.ts', ref: 'x', [GIT_SPICE_DIFF_MARKER]: 'feat-z' });

			assert.strictEqual(parseGitSpiceDiffUri(asUri('pr', query)), undefined);
		});

		it('should return undefined for an unparseable query', () => {
			assert.strictEqual(parseGitSpiceDiffUri(asUri('git', 'not json')), undefined);
		});

		it('should return undefined when the marker is an empty string', () => {
			const query = JSON.stringify({ ref: 'x', [GIT_SPICE_DIFF_MARKER]: '' });

			assert.strictEqual(parseGitSpiceDiffUri(asUri('git', query)), undefined);
		});
	});
});
