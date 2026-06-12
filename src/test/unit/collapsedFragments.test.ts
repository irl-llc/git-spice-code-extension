/**
 * Unit tests for the post-collapse tree-fragment recomputation (issue #66
 * review). Verifies that surviving-parent forks land on real lanes and the
 * placeholder pseudo-row gets a fragment at the hidden subtree's lane.
 */

import * as assert from 'assert';

import {
	buildCollapsedFragments,
	placeholderKey,
	type CollapsedBranchInfo,
} from '../../stackView/tree/collapsedFragments';
import type { CollapseRow } from '../../stackView/tree/collapse';

/** Builds an `infoOf` lookup over a flat name → info record. */
function lookup(records: Record<string, CollapsedBranchInfo>): (name: string) => CollapsedBranchInfo {
	return (name) => records[name] ?? { lane: 0, parentName: undefined, isCurrent: false, needsRestack: false };
}

describe('buildCollapsedFragments', () => {
	it('keys placeholder fragments by placeholderKey and anchors them to the hidden lane', () => {
		// main ─┬─ a (kept) └─ b (collapsed; b1 on lane 1 hidden behind placeholder).
		const rows: CollapseRow[] = [
			{ kind: 'branch', name: 'a' },
			{ kind: 'placeholder', roots: ['b'], subtreeCount: 1, branchCount: 1, nodeLane: 1 },
			{ kind: 'branch', name: 'b' },
			{ kind: 'branch', name: 'main' },
		];
		const fragments = buildCollapsedFragments(
			rows,
			lookup({
				a: { lane: 0, parentName: 'main', isCurrent: false, needsRestack: false },
				b: { lane: 1, parentName: 'main', isCurrent: false, needsRestack: false },
				main: { lane: 0, parentName: undefined, isCurrent: false, needsRestack: false },
			}),
		);
		const placeholder = fragments.get(placeholderKey(1));
		assert.ok(placeholder, 'placeholder fragment present');
		assert.strictEqual(placeholder.nodeLane, 1, 'placeholder anchored to hidden lane 1');
	});

	it('recomputes the surviving parent fork onto a lane a visible row occupies', () => {
		const rows: CollapseRow[] = [
			{ kind: 'branch', name: 'a' },
			{ kind: 'placeholder', roots: ['b'], subtreeCount: 1, branchCount: 1, nodeLane: 1 },
			{ kind: 'branch', name: 'b' },
			{ kind: 'branch', name: 'main' },
		];
		const fragments = buildCollapsedFragments(
			rows,
			lookup({
				a: { lane: 0, parentName: 'main', isCurrent: false, needsRestack: false },
				b: { lane: 1, parentName: 'main', isCurrent: false, needsRestack: false },
				main: { lane: 0, parentName: undefined, isCurrent: false, needsRestack: false },
			}),
		);
		const visibleLanes = new Set<number>();
		for (const [, frag] of fragments) visibleLanes.add(frag.nodeLane);
		// main's fork (to b on lane 1) must reference a present lane.
		const mainFork = fragments.get('main');
		assert.ok(mainFork);
		for (const fork of mainFork.childForkLanes) {
			assert.ok(visibleLanes.has(fork.lane), `fork lane ${fork.lane} references a visible row`);
		}
	});
});
