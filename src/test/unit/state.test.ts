import * as assert from 'assert';
import { buildRepoDisplayState, type RepoDisplayInput } from '../../stackView/state';
import type { GitSpiceBranch } from '../../gitSpiceSchema';

/**
 * Creates a minimal branch record for testing.
 */
function createBranch(name: string, options: Partial<GitSpiceBranch> = {}): GitSpiceBranch {
	return { name, ...options };
}

/** Creates a RepoDisplayInput for testing with sensible defaults. */
function repoInput(branches: GitSpiceBranch[], error?: string, uncommitted?: RepoDisplayInput['uncommitted']): RepoDisplayInput {
	return { repoId: 'test-repo', repoName: 'test', branches, error, uncommitted };
}

describe('state', () => {
	describe('buildRepoDisplayState', () => {
		it('should return empty branches array for empty input', () => {
			const result = buildRepoDisplayState(repoInput([], undefined, undefined));

			assert.deepStrictEqual(result.branches, []);
			assert.strictEqual(result.error, undefined);
			assert.strictEqual(result.uncommitted, undefined);
		});

		it('should include error when provided', () => {
			const result = buildRepoDisplayState(repoInput([], 'Test error', undefined));

			assert.strictEqual(result.error, 'Test error');
		});

		it('should include uncommitted when non-empty', () => {
			const uncommitted = {
				staged: [{ path: 'file.ts', status: 'M' as const }],
				unstaged: [],
			};
			const result = buildRepoDisplayState(repoInput([], undefined, uncommitted));

			assert.deepStrictEqual(result.uncommitted, uncommitted);
		});

		it('should omit uncommitted when both staged and unstaged are empty', () => {
			const uncommitted = { staged: [], unstaged: [] };
			const result = buildRepoDisplayState(repoInput([], undefined, uncommitted));

			assert.strictEqual(result.uncommitted, undefined);
		});

		it('should assign tree depth 0 to root branches', () => {
			const branches: GitSpiceBranch[] = [createBranch('main')];
			const result = buildRepoDisplayState(repoInput(branches, undefined, undefined));

			assert.strictEqual(result.branches[0].tree.depth, 0);
		});

		it('should assign increasing depth for child branches', () => {
			// Note: tree traversal uses `ups` links to find children, so we need proper linking
			const branches: GitSpiceBranch[] = [
				createBranch('main', { ups: [{ name: 'feature-1' }] }),
				createBranch('feature-1', { down: { name: 'main' }, ups: [{ name: 'feature-2' }] }),
				createBranch('feature-2', { down: { name: 'feature-1' } }),
			];
			const result = buildRepoDisplayState(repoInput(branches, undefined, undefined));

			// Branches should be ordered post-order: children before parents
			// So: feature-2, feature-1, main
			const feature2 = result.branches.find((b) => b.name === 'feature-2');
			const feature1 = result.branches.find((b) => b.name === 'feature-1');
			const main = result.branches.find((b) => b.name === 'main');

			assert.strictEqual(main?.tree.depth, 0);
			assert.strictEqual(feature1?.tree.depth, 1);
			assert.strictEqual(feature2?.tree.depth, 2);
		});

		it('should use post-order traversal (children before parents)', () => {
			// Tree traversal uses `ups` to find children
			const branches: GitSpiceBranch[] = [
				createBranch('main', { ups: [{ name: 'feature-1' }] }),
				createBranch('feature-1', { down: { name: 'main' } }),
			];
			const result = buildRepoDisplayState(repoInput(branches, undefined, undefined));

			// Post-order: feature-1 should appear before main
			assert.strictEqual(result.branches[0].name, 'feature-1');
			assert.strictEqual(result.branches[1].name, 'main');
		});

		it('should track parentName in tree position', () => {
			const branches: GitSpiceBranch[] = [
				createBranch('main', { ups: [{ name: 'feature-1' }] }),
				createBranch('feature-1', { down: { name: 'main' } }),
			];
			const result = buildRepoDisplayState(repoInput(branches, undefined, undefined));

			const feature1 = result.branches.find((b) => b.name === 'feature-1');
			const main = result.branches.find((b) => b.name === 'main');

			assert.strictEqual(main?.tree.parentName, undefined);
			assert.strictEqual(feature1?.tree.parentName, 'main');
		});

		it('should assign sibling info correctly', () => {
			const branches: GitSpiceBranch[] = [
				createBranch('main', { ups: [{ name: 'feature-1' }, { name: 'feature-2' }] }),
				createBranch('feature-1', { down: { name: 'main' } }),
				createBranch('feature-2', { down: { name: 'main' } }),
			];
			const result = buildRepoDisplayState(repoInput(branches, undefined, undefined));

			const feature1 = result.branches.find((b) => b.name === 'feature-1');
			const feature2 = result.branches.find((b) => b.name === 'feature-2');

			// Both should have siblingCount of 2
			assert.strictEqual(feature1?.tree.siblingCount, 2);
			assert.strictEqual(feature2?.tree.siblingCount, 2);

			// One should be index 0, other should be index 1
			const siblingIndices = [feature1?.tree.siblingIndex, feature2?.tree.siblingIndex].sort();
			assert.deepStrictEqual(siblingIndices, [0, 1]);
		});

		it('should mark isLastChild correctly', () => {
			const branches: GitSpiceBranch[] = [
				createBranch('main', { ups: [{ name: 'feature-1' }, { name: 'feature-2' }] }),
				createBranch('feature-1', { down: { name: 'main' } }),
				createBranch('feature-2', { down: { name: 'main' } }),
			];
			const result = buildRepoDisplayState(repoInput(branches, undefined, undefined));

			// The last sibling should have isLastChild = true
			const lastSibling = result.branches.find((b) => b.tree.siblingIndex === 1 && b.tree.depth === 1);
			const firstSibling = result.branches.find((b) => b.tree.siblingIndex === 0 && b.tree.depth === 1);

			assert.strictEqual(lastSibling?.tree.isLastChild, true);
			assert.strictEqual(firstSibling?.tree.isLastChild, false);
		});

		it('should assign lanes for multi-lane visualization', () => {
			const branches: GitSpiceBranch[] = [
				createBranch('main', { ups: [{ name: 'feature-1' }, { name: 'feature-2' }] }),
				createBranch('feature-1', { down: { name: 'main' } }),
				createBranch('feature-2', { down: { name: 'main' } }),
			];
			const result = buildRepoDisplayState(repoInput(branches, undefined, undefined));

			// All branches should have lane assignments
			for (const branch of result.branches) {
				assert.strictEqual(typeof branch.tree.lane, 'number');
				assert.ok(branch.tree.lane >= 0);
			}
		});

		it('should preserve current flag', () => {
			const branches: GitSpiceBranch[] = [createBranch('feature', { current: true })];
			const result = buildRepoDisplayState(repoInput(branches, undefined, undefined));

			assert.strictEqual(result.branches[0].current, true);
		});

		it('should compute restack flag from down.needsRestack', () => {
			const branches: GitSpiceBranch[] = [
				createBranch('main', { ups: [{ name: 'feature' }] }),
				createBranch('feature', { down: { name: 'main', needsRestack: true } }),
			];
			const result = buildRepoDisplayState(repoInput(branches, undefined, undefined));

			const feature = result.branches.find((b) => b.name === 'feature');
			assert.strictEqual(feature?.restack, true);
		});

		it('should compute restack flag from ups.needsRestack', () => {
			const branches: GitSpiceBranch[] = [
				createBranch('main', { ups: [{ name: 'feature', needsRestack: true }] }),
				createBranch('feature', { down: { name: 'main' } }),
			];
			const result = buildRepoDisplayState(repoInput(branches, undefined, undefined));

			const main = result.branches.find((b) => b.name === 'main');
			assert.strictEqual(main?.restack, true);
		});

		it('should include change info when present', () => {
			const branches: GitSpiceBranch[] = [
				createBranch('feature', {
					change: { id: '#123', url: 'https://example.com', status: 'open' },
				}),
			];
			const result = buildRepoDisplayState(repoInput(branches, undefined, undefined));

			assert.strictEqual(result.branches[0].change?.id, '#123');
			assert.strictEqual(result.branches[0].change?.url, 'https://example.com');
			assert.strictEqual(result.branches[0].change?.status, 'open');
		});

		it('should include commits when present', () => {
			const branches: GitSpiceBranch[] = [
				createBranch('feature', {
					commits: [{ sha: 'abc123def456', subject: 'Test commit' }],
				}),
			];
			const result = buildRepoDisplayState(repoInput(branches, undefined, undefined));

			assert.strictEqual(result.branches[0].commits?.length, 1);
			assert.strictEqual(result.branches[0].commits?.[0].sha, 'abc123def456');
			assert.strictEqual(result.branches[0].commits?.[0].shortSha, 'abc123de');
			assert.strictEqual(result.branches[0].commits?.[0].subject, 'Test commit');
		});

		it('should track ancestorIsLast for nested branches', () => {
			const branches: GitSpiceBranch[] = [
				createBranch('main', { ups: [{ name: 'a' }, { name: 'b' }] }),
				createBranch('a', { down: { name: 'main' }, ups: [{ name: 'a1' }] }),
				createBranch('b', { down: { name: 'main' } }),
				createBranch('a1', { down: { name: 'a' } }),
			];
			const result = buildRepoDisplayState(repoInput(branches, undefined, undefined));

			const a1 = result.branches.find((b) => b.name === 'a1');
			// a1's ancestor (a) is not the last child of main, so ancestorIsLast should contain false
			assert.ok(a1?.tree.ancestorIsLast.includes(false));
		});
	});
});
