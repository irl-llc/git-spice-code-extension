/**
 * Builds the rendered stack rows (issue #66): applies the in-memory collapsed
 * set to the DFS branch order, mapping each surviving branch to its view model
 * and each collapsed run to a placeholder row. Extracted from state.ts to keep
 * that file within the size budget; the collapse decision logic itself lives in
 * the pure {@link ./tree/collapse} module.
 */

import type { BranchViewModel, CollapsedPlaceholderViewModel, StackRowViewModel } from './types';
import { applyCollapse, computeCollapsibleBranches, type CollapseBranchInput, type CollapseRow } from './tree/collapse';
import { buildPlaceholderFragment } from './tree/placeholderFragment';
import type { BranchWithTree } from './stateTypes';

/** Collapse-logic view of the ordered branches (name + parent linkage only). */
function toCollapseInput(ordered: BranchWithTree[]): CollapseBranchInput[] {
	return ordered.map((it) => ({ name: it.branch.name, parentName: it.tree.parentName }));
}

/**
 * Computes the set of collapsible branch names. Trunk (a root with no parent)
 * and the integration branch are never collapsible; everything else with at
 * least one child is (issue #66).
 */
export function computeCollapsible(ordered: BranchWithTree[], integrationName?: string): Set<string> {
	const never = new Set<string>();
	if (integrationName) never.add(integrationName);
	for (const it of ordered) if (!it.tree.parentName) never.add(it.branch.name);
	return computeCollapsibleBranches(toCollapseInput(ordered), never);
}

/**
 * Builds the rendered stack rows: applies the collapsed set to the DFS order,
 * mapping each surviving branch to its view model and each collapsed run to a
 * placeholder row with a dashed empty lane (issue #66).
 */
export function buildStackRows(
	ordered: BranchWithTree[],
	branches: BranchViewModel[],
	collapsed?: ReadonlySet<string>,
): StackRowViewModel[] {
	if (!collapsed || collapsed.size === 0) {
		return branches.map((branch) => ({ kind: 'branch' as const, branch }));
	}
	const byName = new Map(branches.map((b) => [b.name, b]));
	const collapseRows = applyCollapse(toCollapseInput(ordered), collapsed);
	return collapseRows.map((row) => toStackRow(row, byName));
}

/** Maps one collapse-logic row to its view-model row. */
function toStackRow(row: CollapseRow, byName: Map<string, BranchViewModel>): StackRowViewModel {
	if (row.kind === 'branch') {
		return { kind: 'branch', branch: byName.get(row.name)! };
	}
	const placeholder: CollapsedPlaceholderViewModel = {
		roots: row.roots,
		subtreeCount: row.subtreeCount,
		branchCount: row.branchCount,
		treeFragment: buildPlaceholderFragment(),
	};
	return { kind: 'placeholder', placeholder };
}
