import * as assert from 'assert';
import { buildTreeFragments, type BranchTreeInput } from '../../stackView/tree/treeModel';

describe('treeModel', () => {
	/** Helper to create a branch input. */
	function makeBranch(
		name: string,
		parentName: string | undefined,
		lane: number,
		options?: { isCurrent?: boolean; needsRestack?: boolean; isUncommitted?: boolean },
	): BranchTreeInput {
		return {
			name,
			parentName,
			lane,
			isCurrent: options?.isCurrent ?? false,
			isUncommitted: options?.isUncommitted ?? false,
			needsRestack: options?.needsRestack ?? false,
		};
	}

	describe('buildTreeFragments', () => {
		it('returns empty map for empty input', () => {
			const result = buildTreeFragments([]);
			assert.strictEqual(result.size, 0);
		});

		it('single branch with no parent has node but no connections', () => {
			const branches = [makeBranch('main', undefined, 0)];
			const fragments = buildTreeFragments(branches);

			const main = fragments.get('main');
			assert.ok(main);
			assert.strictEqual(main.nodeLane, 0);
			assert.strictEqual(main.parentLane, undefined);
			assert.strictEqual(main.maxLane, 0);

			// Lane 0: has node, no connections
			assert.deepStrictEqual(main.lanes[0], {
				continuesFromAbove: false,
				continuesBelow: false,
				hasNode: true,
				needsRestack: false,
			});
		});

		it('child on same lane as parent has vertical connection', () => {
			// Order: child (row 0), main (row 1)
			// Both on lane 0, child connects to main
			const branches = [makeBranch('child', 'main', 0), makeBranch('main', undefined, 0)];
			const fragments = buildTreeFragments(branches);

			// Child row: node on lane 0, continues below to main
			const child = fragments.get('child')!;
			assert.strictEqual(child.nodeLane, 0);
			assert.strictEqual(child.parentLane, undefined); // Same as nodeLane, so undefined
			assert.deepStrictEqual(child.lanes[0], {
				continuesFromAbove: false,
				continuesBelow: true,
				hasNode: true,
				needsRestack: false,
			});

			// Main row: node on lane 0, continues from above
			const main = fragments.get('main')!;
			assert.deepStrictEqual(main.lanes[0], {
				continuesFromAbove: true,
				continuesBelow: false,
				hasNode: true,
				needsRestack: false,
			});
		});

		it('child on different lane has horizontal connector (childForkLanes set on parent)', () => {
			// Order: feature (row 0, lane 1), main (row 1, lane 0)
			// feature connects to main via horizontal connector drawn by main
			const branches = [makeBranch('feature', 'main', 1), makeBranch('main', undefined, 0)];
			const fragments = buildTreeFragments(branches);

			// Feature row: node on lane 1, parentLane undefined (parent draws connector)
			const feature = fragments.get('feature')!;
			assert.strictEqual(feature.nodeLane, 1);
			assert.strictEqual(feature.parentLane, undefined);
			assert.strictEqual(feature.childForkLanes.length, 0);

			// Feature's lane 1: has node, continuesBelow to meet parent's horizontal connector
			assert.deepStrictEqual(feature.lanes[1], {
				continuesFromAbove: false,
				continuesBelow: true,
				hasNode: true,
				needsRestack: false,
			});

			// Main row: has childForkLanes pointing to feature's lane
			const main = fragments.get('main')!;
			assert.strictEqual(main.childForkLanes.length, 1);
			assert.strictEqual(main.childForkLanes[0].lane, 1);
			assert.strictEqual(main.childForkLanes[0].needsRestack, false);
			assert.strictEqual(main.childForkLanes[0].isUncommitted, false);
			assert.deepStrictEqual(main.lanes[0], {
				continuesFromAbove: true,
				continuesBelow: false,
				hasNode: true,
				needsRestack: false,
			});
		});

		it('pass-through lane when connection crosses intermediate row', () => {
			// Order: feature (row 0, lane 1), child (row 1, lane 0), main (row 2, lane 0)
			// feature connects to main, with vertical on lane 1 passing through child's row
			// The horizontal connector is drawn at main's row, not at intermediate rows
			const branches = [
				makeBranch('feature', 'main', 1),
				makeBranch('child', 'main', 0),
				makeBranch('main', undefined, 0),
			];
			const fragments = buildTreeFragments(branches);

			// Child's row, lane 0: pass-through (child connects to main below)
			const child = fragments.get('child')!;
			assert.deepStrictEqual(child.lanes[0], {
				continuesFromAbove: true,
				continuesBelow: true,
				hasNode: true,
				needsRestack: false,
			});

			// Child's row, lane 1: pass-through (feature's vertical runs through to main below)
			assert.deepStrictEqual(child.lanes[1], {
				continuesFromAbove: true,
				continuesBelow: true,
				hasNode: false,
				needsRestack: false,
			});
		});

		it('multiple children fork to different lanes', () => {
			// Order: child2 (row 0, lane 1), child1 (row 1, lane 0), main (row 2, lane 0)
			// child1 inherits main's lane, child2 forks to lane 1
			const branches = [
				makeBranch('child2', 'main', 1),
				makeBranch('child1', 'main', 0),
				makeBranch('main', undefined, 0),
			];
			const fragments = buildTreeFragments(branches);

			// child2: on lane 1, parentLane undefined (parent draws connector)
			const child2 = fragments.get('child2')!;
			assert.strictEqual(child2.parentLane, undefined);
			assert.strictEqual(child2.nodeLane, 1);

			// child1: on lane 0, same lane as parent
			const child1 = fragments.get('child1')!;
			assert.strictEqual(child1.parentLane, undefined);

			// main: has childForkLanes for child2, receives connections from both
			const main = fragments.get('main')!;
			assert.strictEqual(main.childForkLanes.length, 1);
			assert.strictEqual(main.childForkLanes[0].lane, 1);
			assert.strictEqual(main.lanes[0].continuesFromAbove, true);
		});

		it('deep stack with linear connections on same lane', () => {
			// Order: d (row 0), c (row 1), b (row 2), a (row 3)
			// All on lane 0: d -> c -> b -> a
			const branches = [
				makeBranch('d', 'c', 0),
				makeBranch('c', 'b', 0),
				makeBranch('b', 'a', 0),
				makeBranch('a', undefined, 0),
			];
			const fragments = buildTreeFragments(branches);

			// d: continues below
			assert.strictEqual(fragments.get('d')!.lanes[0].continuesBelow, true);
			assert.strictEqual(fragments.get('d')!.lanes[0].continuesFromAbove, false);

			// c: continues both ways (from d above, to b below)
			assert.strictEqual(fragments.get('c')!.lanes[0].continuesFromAbove, true);
			assert.strictEqual(fragments.get('c')!.lanes[0].continuesBelow, true);

			// b: continues both ways
			assert.strictEqual(fragments.get('b')!.lanes[0].continuesFromAbove, true);
			assert.strictEqual(fragments.get('b')!.lanes[0].continuesBelow, true);

			// a: continues from above only
			assert.strictEqual(fragments.get('a')!.lanes[0].continuesFromAbove, true);
			assert.strictEqual(fragments.get('a')!.lanes[0].continuesBelow, false);
		});

		it('restack flag propagates through lane segments', () => {
			// child needs restack, connection should show restack color
			const branches = [makeBranch('child', 'main', 0, { needsRestack: true }), makeBranch('main', undefined, 0)];
			const fragments = buildTreeFragments(branches);

			// Child's lane segment needs restack
			assert.strictEqual(fragments.get('child')!.lanes[0].needsRestack, true);
			assert.strictEqual(fragments.get('child')!.nodeNeedsRestack, true);

			// Main's incoming segment also needs restack (connection from child)
			assert.strictEqual(fragments.get('main')!.lanes[0].needsRestack, true);
		});

		it('current branch gets current nodeStyle', () => {
			const branches = [makeBranch('feature', 'main', 0, { isCurrent: true }), makeBranch('main', undefined, 0)];
			const fragments = buildTreeFragments(branches);

			assert.strictEqual(fragments.get('feature')!.nodeStyle, 'current');
			assert.strictEqual(fragments.get('main')!.nodeStyle, 'normal');
		});

		it('uncommitted pseudo-branch has pass-through on sibling lanes', () => {
			// Simulates the scenario from the screenshot:
			// - test-feature (row 0, lane 0, parent: current)
			// - __uncommitted__ (row 1, lane 1, parent: current, isUncommitted)
			// - current (row 2, lane 0, isCurrent)
			// - main (row 3, lane 0)
			//
			// The uncommitted row should have lane 0 as pass-through (test-feature -> current)
			const branches: BranchTreeInput[] = [
				makeBranch('test-feature', 'current', 0),
				makeBranch('__uncommitted__', 'current', 1, { isUncommitted: true }),
				makeBranch('current', 'main', 0, { isCurrent: true }),
				makeBranch('main', undefined, 0),
			];
			const fragments = buildTreeFragments(branches);

			// Uncommitted row should have pass-through on lane 0
			const uncommitted = fragments.get('__uncommitted__')!;
			assert.strictEqual(uncommitted.nodeStyle, 'uncommitted');
			assert.strictEqual(uncommitted.nodeLane, 1);

			// Lane 0 should be pass-through (test-feature connects to current below)
			assert.deepStrictEqual(uncommitted.lanes[0], {
				continuesFromAbove: true,
				continuesBelow: true,
				hasNode: false,
				needsRestack: false,
			});

			// Lane 1 should have the uncommitted node
			assert.deepStrictEqual(uncommitted.lanes[1], {
				continuesFromAbove: false,
				continuesBelow: true,
				hasNode: true,
				needsRestack: false,
			});

			// Current branch should have childForkLanes for uncommitted with styling info
			const current = fragments.get('current')!;
			assert.strictEqual(current.childForkLanes.length, 1);
			assert.strictEqual(current.childForkLanes[0].lane, 1);
			assert.strictEqual(current.childForkLanes[0].needsRestack, false);
			assert.strictEqual(current.childForkLanes[0].isUncommitted, true);
		});

		it('complex tree with multiple lanes', () => {
			// Tree structure:
			//   main (lane 0)
			//     ├── feature-a (lane 0, first child inherits)
			//     │     └── feature-a-1 (lane 0)
			//     └── feature-b (lane 1, second child forks)
			//
			// Post-order: feature-a-1, feature-a, feature-b, main
			const branches = [
				makeBranch('feature-a-1', 'feature-a', 0),
				makeBranch('feature-a', 'main', 0),
				makeBranch('feature-b', 'main', 1),
				makeBranch('main', undefined, 0),
			];
			const fragments = buildTreeFragments(branches);

			// feature-b: parentLane undefined (parent draws connector)
			const featureB = fragments.get('feature-b')!;
			assert.strictEqual(featureB.nodeLane, 1);
			assert.strictEqual(featureB.parentLane, undefined);

			// feature-b's lane 1 continues below to meet parent's horizontal connector
			assert.strictEqual(featureB.lanes[1].continuesBelow, true);

			// main: has childForkLanes for feature-b, receives from both
			const main = fragments.get('main')!;
			assert.strictEqual(main.childForkLanes.length, 1);
			assert.strictEqual(main.childForkLanes[0].lane, 1);
			assert.strictEqual(main.lanes[0].continuesFromAbove, true);
		});

		it('child fork lane includes needsRestack flag', () => {
			const branches = [makeBranch('child', 'main', 1, { needsRestack: true }), makeBranch('main', undefined, 0)];
			const fragments = buildTreeFragments(branches);

			const main = fragments.get('main')!;
			assert.strictEqual(main.childForkLanes.length, 1);
			assert.strictEqual(main.childForkLanes[0].lane, 1);
			assert.strictEqual(main.childForkLanes[0].needsRestack, true);
			assert.strictEqual(main.childForkLanes[0].isUncommitted, false);
		});

		it('other branches do not inherit uncommitted fork lane', () => {
			// feature-3 has child-of-3, feature-1 has uncommitted
			// Each should only have their own children in childForkLanes
			const branches: BranchTreeInput[] = [
				makeBranch('child-of-3', 'feature-3', 2),
				makeBranch('__uncommitted__', 'feature-1', 3, { isUncommitted: true }),
				makeBranch('feature-3', 'main', 1),
				makeBranch('feature-1', 'main', 0, { isCurrent: true }),
				makeBranch('main', undefined, 0),
			];
			const fragments = buildTreeFragments(branches);

			// feature-3 should only have fork to child-of-3's lane
			const feature3 = fragments.get('feature-3')!;
			assert.strictEqual(feature3.childForkLanes.length, 1);
			assert.strictEqual(feature3.childForkLanes[0].lane, 2);
			assert.strictEqual(feature3.childForkLanes[0].isUncommitted, false);

			// feature-1 should have fork to uncommitted's lane
			const feature1 = fragments.get('feature-1')!;
			assert.strictEqual(feature1.childForkLanes.length, 1);
			assert.strictEqual(feature1.childForkLanes[0].lane, 3);
			assert.strictEqual(feature1.childForkLanes[0].isUncommitted, true);
		});

		it('multiple children with mixed styling states', () => {
			// Parent has two children: one needs restack, one is uncommitted
			const branches: BranchTreeInput[] = [
				makeBranch('restack-child', 'main', 1, { needsRestack: true }),
				makeBranch('__uncommitted__', 'main', 2, { isUncommitted: true }),
				makeBranch('main', undefined, 0),
			];
			const fragments = buildTreeFragments(branches);

			const main = fragments.get('main')!;
			assert.strictEqual(main.childForkLanes.length, 2);

			// Sorted by lane
			assert.strictEqual(main.childForkLanes[0].lane, 1);
			assert.strictEqual(main.childForkLanes[0].needsRestack, true);
			assert.strictEqual(main.childForkLanes[0].isUncommitted, false);

			assert.strictEqual(main.childForkLanes[1].lane, 2);
			assert.strictEqual(main.childForkLanes[1].needsRestack, false);
			assert.strictEqual(main.childForkLanes[1].isUncommitted, true);
		});
	});
});
