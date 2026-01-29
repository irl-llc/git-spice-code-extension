import * as assert from 'assert';
import * as vscode from 'vscode';
import { buildGitUri, buildCommitDiffUris, buildWorkingCopyDiffUris, EMPTY_TREE_SHA } from '../../utils/diffUri';

describe('diffUri', () => {
	const testUri = vscode.Uri.file('/test/path/file.ts');

	describe('EMPTY_TREE_SHA', () => {
		it('should be the well-known git empty tree SHA', () => {
			assert.strictEqual(EMPTY_TREE_SHA, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
		});
	});

	describe('buildGitUri', () => {
		it('should create a git-scheme URI with path and ref in query', () => {
			const result = buildGitUri(testUri, 'HEAD');

			assert.strictEqual(result.scheme, 'git');
			assert.strictEqual(result.path, testUri.path);

			const query = JSON.parse(result.query);
			assert.strictEqual(query.path, testUri.fsPath);
			assert.strictEqual(query.ref, 'HEAD');
		});

		it('should handle SHA refs', () => {
			const result = buildGitUri(testUri, 'abc123');

			const query = JSON.parse(result.query);
			assert.strictEqual(query.ref, 'abc123');
		});

		it('should handle parent refs with ^', () => {
			const result = buildGitUri(testUri, 'abc123^');

			const query = JSON.parse(result.query);
			assert.strictEqual(query.ref, 'abc123^');
		});

		it('should handle index ref ~', () => {
			const result = buildGitUri(testUri, '~');

			const query = JSON.parse(result.query);
			assert.strictEqual(query.ref, '~');
		});
	});

	describe('buildCommitDiffUris', () => {
		const sha = 'abc123def456';

		it('should handle added files (status A)', () => {
			const { left, right } = buildCommitDiffUris(testUri, sha, 'A');

			const leftQuery = JSON.parse(left.query);
			const rightQuery = JSON.parse(right.query);

			assert.strictEqual(leftQuery.ref, EMPTY_TREE_SHA);
			assert.strictEqual(rightQuery.ref, sha);
		});

		it('should handle deleted files (status D)', () => {
			const { left, right } = buildCommitDiffUris(testUri, sha, 'D');

			const leftQuery = JSON.parse(left.query);
			const rightQuery = JSON.parse(right.query);

			assert.strictEqual(leftQuery.ref, `${sha}^`);
			assert.strictEqual(rightQuery.ref, EMPTY_TREE_SHA);
		});

		it('should handle modified files (status M)', () => {
			const { left, right } = buildCommitDiffUris(testUri, sha, 'M');

			const leftQuery = JSON.parse(left.query);
			const rightQuery = JSON.parse(right.query);

			assert.strictEqual(leftQuery.ref, `${sha}^`);
			assert.strictEqual(rightQuery.ref, sha);
		});

		it('should treat unknown status as modified', () => {
			const { left, right } = buildCommitDiffUris(testUri, sha, 'R' as 'M');

			const leftQuery = JSON.parse(left.query);
			const rightQuery = JSON.parse(right.query);

			assert.strictEqual(leftQuery.ref, `${sha}^`);
			assert.strictEqual(rightQuery.ref, sha);
		});

		it('should preserve file path in both URIs', () => {
			const { left, right } = buildCommitDiffUris(testUri, sha, 'M');

			const leftQuery = JSON.parse(left.query);
			const rightQuery = JSON.parse(right.query);

			assert.strictEqual(leftQuery.path, testUri.fsPath);
			assert.strictEqual(rightQuery.path, testUri.fsPath);
		});
	});

	describe('buildWorkingCopyDiffUris', () => {
		it('should handle staged changes (HEAD vs index)', () => {
			const { left, right } = buildWorkingCopyDiffUris(testUri, true);

			const leftQuery = JSON.parse(left.query);
			const rightQuery = JSON.parse(right.query);

			assert.strictEqual(leftQuery.ref, 'HEAD');
			assert.strictEqual(rightQuery.ref, '~');
		});

		it('should handle unstaged changes (index vs working copy)', () => {
			const { left, right } = buildWorkingCopyDiffUris(testUri, false);

			const leftQuery = JSON.parse(left.query);

			assert.strictEqual(leftQuery.ref, '~');
			assert.strictEqual(right.scheme, 'file');
			assert.strictEqual(right.fsPath, testUri.fsPath);
		});

		it('should preserve file path in left URI', () => {
			const { left } = buildWorkingCopyDiffUris(testUri, true);

			const leftQuery = JSON.parse(left.query);
			assert.strictEqual(leftQuery.path, testUri.fsPath);
		});
	});
});
