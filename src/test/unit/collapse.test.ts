/**
 * Unit tests for the pure subtree collapse/expand logic (issue #66): the
 * collapsibility rules, DFS row application with coalescing, "collapse other
 * stacks", and the in-memory mutation helpers. No vscode dependency.
 */

import * as assert from 'assert';

import {
	applyCollapse,
	computeCollapseOthers,
	computeCollapsibleBranches,
	type CollapseBranchInput,
	type CollapseRow,
} from '../../stackView/tree/collapse';
import {
	applyCollapseOp,
	CollapseStore,
	collapseOtherStacks,
	expandRoots,
	toggleCollapseRoot,
} from '../../stackView/collapseState';
import type { GitSpiceBranch } from '../../gitSpiceSchema';

/**
 * Post-order DFS (descendants before ancestor) for the tree:
 *   main ─┬─ feat-a ── feat-b
 *         └─ feat-c
 */
const ORDERED: CollapseBranchInput[] = [
	{ name: 'feat-b', parentName: 'feat-a' },
	{ name: 'feat-a', parentName: 'main' },
	{ name: 'feat-c', parentName: 'main' },
	{ name: 'main' },
];

/** A linear chain main ── a ── b ── c, post-order. */
const CHAIN: CollapseBranchInput[] = [
	{ name: 'c', parentName: 'b' },
	{ name: 'b', parentName: 'a' },
	{ name: 'a', parentName: 'main' },
	{ name: 'main' },
];

function placeholderRows(rows: CollapseRow[]): Extract<CollapseRow, { kind: 'placeholder' }>[] {
	return rows.filter((r): r is Extract<CollapseRow, { kind: 'placeholder' }> => r.kind === 'placeholder');
}

function branchNames(rows: CollapseRow[]): string[] {
	return rows.filter((r) => r.kind === 'branch').map((r) => (r as { name: string }).name);
}

describe('computeCollapsibleBranches', () => {
	it('marks branches with children collapsible, excluding never-collapsible names', () => {
		const collapsible = computeCollapsibleBranches(ORDERED, new Set(['main']));
		// feat-a has a child (feat-b); main has children but is never-collapsible;
		// feat-b and feat-c are leaves.
		assert.deepStrictEqual([...collapsible].sort(), ['feat-a']);
	});

	it('never marks the integration branch collapsible even with children', () => {
		const withInteg: CollapseBranchInput[] = [...ORDERED, { name: 'feat-d', parentName: 'integ' }, { name: 'integ' }];
		const collapsible = computeCollapsibleBranches(withInteg, new Set(['main', 'integ']));
		assert.ok(!collapsible.has('integ'));
	});
});

describe('applyCollapse', () => {
	it('returns every branch as a row when nothing is collapsed', () => {
		const rows = applyCollapse(ORDERED, new Set());
		assert.strictEqual(placeholderRows(rows).length, 0);
		assert.deepStrictEqual(branchNames(rows), ['feat-b', 'feat-a', 'feat-c', 'main']);
	});

	it('hides a collapse root’s descendants into a placeholder, keeping the root visible', () => {
		const rows = applyCollapse(ORDERED, new Set(['feat-a']));
		const phs = placeholderRows(rows);
		assert.strictEqual(phs.length, 1);
		assert.deepStrictEqual(phs[0].roots, ['feat-a']);
		assert.strictEqual(phs[0].subtreeCount, 1);
		assert.strictEqual(phs[0].branchCount, 1); // feat-b
		// feat-a (the root) stays; feat-b is hidden; feat-c and main untouched.
		assert.deepStrictEqual(branchNames(rows), ['feat-a', 'feat-c', 'main']);
	});

	it('coalesces a chain of hidden branches into one placeholder', () => {
		const rows = applyCollapse(CHAIN, new Set(['a']));
		const phs = placeholderRows(rows);
		assert.strictEqual(phs.length, 1);
		assert.strictEqual(phs[0].branchCount, 2); // b and c
		assert.strictEqual(phs[0].subtreeCount, 1);
		assert.deepStrictEqual(branchNames(rows), ['a', 'main']);
	});
});

describe('computeCollapseOthers', () => {
	it('keeps the clicked branch, its ancestors and descendants; collapses off-path stacks', () => {
		const collapsible = computeCollapsibleBranches(ORDERED, new Set(['main']));
		// Click feat-b: keep feat-b + feat-a (ancestor) + main (ancestor). feat-c is
		// off-path but a leaf (not collapsible), so nothing collapses here.
		assert.deepStrictEqual([...computeCollapseOthers(ORDERED, 'feat-b', collapsible)], []);
	});

	it('collapses a sibling stack that is collapsible', () => {
		// main ─┬─ a ── a1   └─ b ── b1 ; click a1 → collapse b (off-path, has child).
		const tree: CollapseBranchInput[] = [
			{ name: 'a1', parentName: 'a' },
			{ name: 'a', parentName: 'main' },
			{ name: 'b1', parentName: 'b' },
			{ name: 'b', parentName: 'main' },
			{ name: 'main' },
		];
		const collapsible = computeCollapsibleBranches(tree, new Set(['main']));
		assert.deepStrictEqual([...computeCollapseOthers(tree, 'a1', collapsible)], ['b']);
	});
});

describe('collapseState mutations', () => {
	it('toggleCollapseRoot adds a collapsible branch and removes it on re-toggle', () => {
		const added = toggleCollapseRoot(new Set(), ORDERED, 'feat-a');
		assert.deepStrictEqual([...added], ['feat-a']);
		const removed = toggleCollapseRoot(added, ORDERED, 'feat-a');
		assert.deepStrictEqual([...removed], []);
	});

	it('toggleCollapseRoot ignores a non-collapsible (leaf) branch', () => {
		assert.deepStrictEqual([...toggleCollapseRoot(new Set(), ORDERED, 'feat-b')], []);
	});

	it('expandRoots removes the given roots', () => {
		assert.deepStrictEqual([...expandRoots(new Set(['feat-a', 'x']), ['feat-a'])], ['x']);
	});

	it('collapseOtherStacks collapses the off-path collapsible sibling', () => {
		const tree: CollapseBranchInput[] = [
			{ name: 'a1', parentName: 'a' },
			{ name: 'a', parentName: 'main' },
			{ name: 'b1', parentName: 'b' },
			{ name: 'b', parentName: 'main' },
			{ name: 'main' },
		];
		assert.deepStrictEqual([...collapseOtherStacks(tree, 'a1')], ['b']);
	});
});

describe('applyCollapseOp + CollapseStore', () => {
	const branches = [
		{ name: 'feat-b', down: { name: 'feat-a' } },
		{ name: 'feat-a', down: { name: 'main' } },
		{ name: 'feat-c', down: { name: 'main' } },
		{ name: 'main' },
	] as GitSpiceBranch[];

	it('dispatches toggle / expand / collapseOthers', () => {
		const toggled = applyCollapseOp(new Set(), branches, undefined, { kind: 'toggle', branchName: 'feat-a' });
		assert.deepStrictEqual([...toggled], ['feat-a']);
		assert.deepStrictEqual(
			[...applyCollapseOp(toggled, branches, undefined, { kind: 'expand', roots: ['feat-a'] })],
			[],
		);
	});

	it('CollapseStore.mutate stores per-repo sets and prune drops inactive repos', () => {
		const store = new CollapseStore();
		store.mutate('/repo', branches, undefined, { kind: 'toggle', branchName: 'feat-a' });
		assert.deepStrictEqual([...(store.get('/repo') ?? [])], ['feat-a']);
		store.prune(new Set(['/other']));
		assert.strictEqual(store.get('/repo'), undefined);
	});
});
