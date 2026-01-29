import * as assert from 'assert';
import { buildBranchContext, buildCommitContext } from '../../stackView/contextBuilder';
import type { BranchViewModel } from '../../stackView/types';

describe('contextBuilder', () => {
	describe('buildBranchContext', () => {
		const createBranch = (overrides: Partial<BranchViewModel> = {}): BranchViewModel => ({
			name: 'feature-branch',
			current: false,
			restack: false,
			tree: {
				depth: 1,
				isLastChild: true,
				ancestorIsLast: [],
				siblingIndex: 0,
				siblingCount: 1,
				lane: 0,
			},
			...overrides,
		});

		it('should build valid JSON with branch name', () => {
			const branch = createBranch({ name: 'my-feature' });
			const result = JSON.parse(buildBranchContext(branch));
			assert.strictEqual(result.branchName, 'my-feature');
		});

		it('should include webviewSection as branch', () => {
			const branch = createBranch();
			const result = JSON.parse(buildBranchContext(branch));
			assert.strictEqual(result.webviewSection, 'branch');
		});

		it('should include current status when true', () => {
			const branch = createBranch({ current: true });
			const result = JSON.parse(buildBranchContext(branch));
			assert.strictEqual(result.webviewBranchIsCurrent, true);
		});

		it('should include current status when false', () => {
			const branch = createBranch({ current: false });
			const result = JSON.parse(buildBranchContext(branch));
			assert.strictEqual(result.webviewBranchIsCurrent, false);
		});

		it('should include restack status when true', () => {
			const branch = createBranch({ restack: true });
			const result = JSON.parse(buildBranchContext(branch));
			assert.strictEqual(result.webviewBranchNeedsRestack, true);
		});

		it('should include restack status when false', () => {
			const branch = createBranch({ restack: false });
			const result = JSON.parse(buildBranchContext(branch));
			assert.strictEqual(result.webviewBranchNeedsRestack, false);
		});

		it('should prevent default context menu items', () => {
			const branch = createBranch();
			const result = JSON.parse(buildBranchContext(branch));
			assert.strictEqual(result.preventDefaultContextMenuItems, true);
		});
	});

	describe('buildCommitContext', () => {
		it('should build valid JSON with sha', () => {
			const result = JSON.parse(buildCommitContext('abc123', 'feature'));
			assert.strictEqual(result.sha, 'abc123');
		});

		it('should include branch name', () => {
			const result = JSON.parse(buildCommitContext('abc123', 'my-branch'));
			assert.strictEqual(result.branchName, 'my-branch');
		});

		it('should include webviewSection as commit', () => {
			const result = JSON.parse(buildCommitContext('abc123', 'feature'));
			assert.strictEqual(result.webviewSection, 'commit');
		});

		it('should prevent default context menu items', () => {
			const result = JSON.parse(buildCommitContext('abc123', 'feature'));
			assert.strictEqual(result.preventDefaultContextMenuItems, true);
		});

		it('should handle full SHA', () => {
			const fullSha = 'abc123def456789012345678901234567890abcd';
			const result = JSON.parse(buildCommitContext(fullSha, 'feature'));
			assert.strictEqual(result.sha, fullSha);
		});
	});
});
