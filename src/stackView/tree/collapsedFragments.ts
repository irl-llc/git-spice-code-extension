/**
 * Recomputes tree-fragment geometry over the POST-collapse row list (issue #66
 * review). The fragments produced upstream in `state.ts` describe the full,
 * pre-collapse tree; once collapsed rows are dropped, a surviving parent's
 * `childForkLanes` would still point at a now-hidden child's lane (a dangling
 * fork), and the placeholder lane would be wrong. Rebuilding `buildTreeFragments`
 * over the surviving branches plus a placeholder pseudo-row at the hidden
 * subtree's lane fixes both: the fork lands on the placeholder's real lane and
 * the dashed lane sits in the column the subtree occupied.
 *
 * Kept free of `vscode`/React imports so it stays unit-testable.
 */

import { buildTreeFragments, type BranchTreeInput } from './treeModel';
import type { CollapseRow } from './collapse';
import type { TreeFragmentData } from '../types';

/** Per-branch layout facts the recomputation needs (looked up by branch name). */
export type CollapsedBranchInfo = {
	lane: number;
	parentName?: string;
	isCurrent: boolean;
	needsRestack: boolean;
};

/** Synthetic, stable map key for the i-th placeholder pseudo-row. */
export function placeholderKey(rowIndex: number): string {
	return `__collapsed_placeholder_${rowIndex}__`;
}

/** Builds the {@link BranchTreeInput} for one collapse row (branch or placeholder). */
function toTreeInput(
	row: CollapseRow,
	rowIndex: number,
	infoOf: (name: string) => CollapsedBranchInfo,
): BranchTreeInput {
	if (row.kind === 'branch') return branchRowInput(row.name, infoOf(row.name));
	return placeholderRowInput(row, rowIndex);
}

/** Tree input for a surviving branch row, reusing its original layout facts. */
function branchRowInput(name: string, info: CollapsedBranchInfo): BranchTreeInput {
	return {
		name,
		lane: info.lane,
		parentName: info.parentName,
		isCurrent: info.isCurrent,
		needsRestack: info.needsRestack,
	};
}

/**
 * Tree input for a placeholder pseudo-row. It hangs off its first owning root (a
 * visible branch) and occupies the hidden subtree's lane so the surviving
 * parent's fork connector lands on it.
 */
function placeholderRowInput(row: Extract<CollapseRow, { kind: 'placeholder' }>, rowIndex: number): BranchTreeInput {
	return {
		name: placeholderKey(rowIndex),
		lane: row.nodeLane,
		parentName: row.roots[0],
		isCurrent: false,
		needsRestack: false,
	};
}

/**
 * Recomputes a fragment map keyed by branch name (and {@link placeholderKey} for
 * placeholder rows) from the collapsed row list. `infoOf` supplies each surviving
 * branch's original lane / parent / state.
 */
export function buildCollapsedFragments(
	rows: CollapseRow[],
	infoOf: (name: string) => CollapsedBranchInfo,
): Map<string, TreeFragmentData> {
	const inputs = rows.map((row, index) => toTreeInput(row, index, infoOf));
	return buildTreeFragments(inputs);
}
