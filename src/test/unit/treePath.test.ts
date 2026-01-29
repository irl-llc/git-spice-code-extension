import * as assert from 'assert';
import { createRoundedPath, buildSvgPaths } from '../../stackView/tree/treePath';
import type { BranchViewModel } from '../../stackView/types';

describe('treePath', () => {
	describe('createRoundedPath', () => {
		it('should create a straight vertical line for same-lane connections', () => {
			// When parent and child are in the same lane (same X)
			const path = createRoundedPath(50, 100, 50, 50);
			// Should be a simple vertical line with gaps
			assert.ok(path.includes('M 50'), 'Path should include M 50');
			assert.ok(path.includes('L 50'), 'Path should include L 50');
			assert.ok(!path.includes('A'), 'Path should not include arc for same-lane');
		});

		it('should create a curved path for cross-lane connections going right', () => {
			// Child is to the right of parent
			const path = createRoundedPath(20, 100, 60, 50);
			assert.ok(path.includes('M '), 'Path should include Move command');
			assert.ok(path.includes('L '), 'Path should include Line command');
			assert.ok(path.includes('A '), 'Path should include Arc command');
		});

		it('should create a curved path for cross-lane connections going left', () => {
			// Child is to the left of parent
			const path = createRoundedPath(60, 100, 20, 50);
			assert.ok(path.includes('M '), 'Path should include Move command');
			assert.ok(path.includes('L '), 'Path should include Line command');
			assert.ok(path.includes('A '), 'Path should include Arc command');
		});

		it('should include gap at parent node', () => {
			// Parent at Y=100, gap of 7 should make start at Y=93
			const path = createRoundedPath(50, 100, 50, 50);
			assert.ok(path.includes('93'), 'Path should include Y=93 (100 - 7 gap)');
		});

		it('should include gap at child node', () => {
			// Child at Y=50, gap of 7 should make end at Y=57
			const path = createRoundedPath(50, 100, 50, 50);
			assert.ok(path.includes('57'), 'Path should include Y=57 (50 + 7 gap)');
		});

		it('should use correct arc sweep direction for right-going paths', () => {
			const path = createRoundedPath(20, 100, 60, 50);
			// Sweep flag 0 for counter-clockwise (going right)
			assert.ok(/A \d+ \d+ 0 0 0/.test(path), 'Path should have sweep flag 0');
		});

		it('should use correct arc sweep direction for left-going paths', () => {
			const path = createRoundedPath(60, 100, 20, 50);
			// Sweep flag 1 for clockwise (going left)
			assert.ok(/A \d+ \d+ 0 0 1/.test(path), 'Path should have sweep flag 1');
		});
	});

	describe('buildSvgPaths', () => {
		const createBranch = (
			name: string,
			parentName: string | undefined,
			lane: number,
			restack = false,
			current = false,
		): BranchViewModel => ({
			name,
			current,
			restack,
			tree: {
				depth: parentName ? 1 : 0,
				isLastChild: true,
				ancestorIsLast: [],
				parentName,
				siblingIndex: 0,
				siblingCount: 1,
				lane,
			},
		});

		it('should return empty array when no branches have parents', () => {
			const branches = [createBranch('main', undefined, 0)];
			const branchMap = new Map(branches.map((b) => [b.name, b]));
			const nodePositions = new Map([['main', { x: 20, y: 50 }]]);

			const paths = buildSvgPaths(branches, branchMap, nodePositions);
			assert.strictEqual(paths.length, 0);
		});

		it('should create path for child-parent connection', () => {
			const branches = [createBranch('main', undefined, 0), createBranch('feature', 'main', 0)];
			const branchMap = new Map(branches.map((b) => [b.name, b]));
			const nodePositions = new Map([
				['main', { x: 20, y: 100 }],
				['feature', { x: 20, y: 50 }],
			]);

			const paths = buildSvgPaths(branches, branchMap, nodePositions);
			assert.strictEqual(paths.length, 1);
			assert.strictEqual(paths[0].restack, false);
		});

		it('should mark paths as restack when branch needs restack', () => {
			const branches = [
				createBranch('main', undefined, 0),
				createBranch('feature', 'main', 0, true), // restack = true
			];
			const branchMap = new Map(branches.map((b) => [b.name, b]));
			const nodePositions = new Map([
				['main', { x: 20, y: 100 }],
				['feature', { x: 20, y: 50 }],
			]);

			const paths = buildSvgPaths(branches, branchMap, nodePositions);
			assert.strictEqual(paths[0].restack, true);
		});

		it('should create uncommitted connector when uncommitted node exists', () => {
			const branches = [createBranch('main', undefined, 0, false, true)]; // current = true
			const branchMap = new Map(branches.map((b) => [b.name, b]));
			const nodePositions = new Map([
				['main', { x: 20, y: 100 }],
				['__uncommitted__', { x: 20, y: 50 }],
			]);

			const paths = buildSvgPaths(branches, branchMap, nodePositions);
			assert.strictEqual(paths.length, 1);
			assert.strictEqual(paths[0].uncommitted, true);
		});

		it('should skip branches without parent positions', () => {
			const branches = [createBranch('main', undefined, 0), createBranch('feature', 'main', 0)];
			const branchMap = new Map(branches.map((b) => [b.name, b]));
			// Only feature has a position, main doesn't
			const nodePositions = new Map([['feature', { x: 20, y: 50 }]]);

			const paths = buildSvgPaths(branches, branchMap, nodePositions);
			assert.strictEqual(paths.length, 0);
		});

		it('should create multiple paths for multiple children', () => {
			const branches = [
				createBranch('main', undefined, 0),
				createBranch('feature1', 'main', 1),
				createBranch('feature2', 'main', 2),
			];
			const branchMap = new Map(branches.map((b) => [b.name, b]));
			const nodePositions = new Map([
				['main', { x: 20, y: 100 }],
				['feature1', { x: 31, y: 50 }],
				['feature2', { x: 42, y: 30 }],
			]);

			const paths = buildSvgPaths(branches, branchMap, nodePositions);
			assert.strictEqual(paths.length, 2);
		});
	});
});
