/**
 * Builds the rendered stack rows (issue #66): applies the in-memory collapsed
 * set to the DFS branch order, mapping each surviving branch to its view model
 * and each collapsed run to a placeholder row. Extracted from state.ts to keep
 * that file within the size budget; the collapse decision logic itself lives in
 * the pure {@link ./tree/collapse} module.
 */

import type { BranchViewModel, CollapsedPlaceholderViewModel, StackRowViewModel, TreeFragmentData } from './types';
import { applyCollapse, computeCollapsibleBranches, type CollapseBranchInput, type CollapseRow } from './tree/collapse';
import { buildCollapsedFragments, placeholderKey, type CollapsedBranchInfo } from './tree/collapsedFragments';
import type { BranchWithTree } from './stateTypes';

/** Collapse-logic view of the ordered branches (name + parent linkage + lane). */
function toCollapseInput(ordered: BranchWithTree[]): CollapseBranchInput[] {
	return ordered.map((it) => ({ name: it.branch.name, parentName: it.tree.parentName, lane: it.tree.lane }));
}

/** Builds a name → layout-info lookup over the surviving branches. */
function buildBranchInfoLookup(ordered: BranchWithTree[]): (name: string) => CollapsedBranchInfo {
	const byName = new Map<string, CollapsedBranchInfo>(
		ordered.map((it) => [
			it.branch.name,
			{
				lane: it.tree.lane,
				parentName: it.tree.parentName,
				isCurrent: it.branch.current === true,
				needsRestack: it.branch.down?.needsRestack === true,
			},
		]),
	);
	return (name) => byName.get(name) ?? { lane: 0, parentName: undefined, isCurrent: false, needsRestack: false };
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
	// Recompute tree-fragment geometry over the surviving rows so forks and the
	// placeholder lane reflect the collapsed layout, not the full pre-collapse
	// tree (issue #66 review).
	const fragments = buildCollapsedFragments(collapseRows, buildBranchInfoLookup(ordered));
	return collapseRows.map((row, index) => toStackRow(row, index, byName, fragments));
}

/** Maps one collapse-logic row to its view-model row, using the recomputed fragments. */
function toStackRow(
	row: CollapseRow,
	rowIndex: number,
	byName: Map<string, BranchViewModel>,
	fragments: Map<string, TreeFragmentData>,
): StackRowViewModel {
	if (row.kind === 'branch') {
		const branch = byName.get(row.name)!;
		const treeFragment = fragments.get(row.name);
		return { kind: 'branch', branch: treeFragment ? { ...branch, treeFragment } : branch };
	}
	return { kind: 'placeholder', placeholder: toPlaceholder(row, rowIndex, fragments) };
}

/** Builds the placeholder view model for a collapsed-run row from the recomputed fragments. */
function toPlaceholder(
	row: Extract<CollapseRow, { kind: 'placeholder' }>,
	rowIndex: number,
	fragments: Map<string, TreeFragmentData>,
): CollapsedPlaceholderViewModel {
	const recomputed = fragments.get(placeholderKey(rowIndex));
	return {
		roots: row.roots,
		subtreeCount: row.subtreeCount,
		branchCount: row.branchCount,
		treeFragment: recomputed ? asPlaceholderFragment(recomputed) : buildPlaceholderFragmentFallback(row.nodeLane),
	};
}

/**
 * Restyles a recomputed branch fragment as a placeholder row. The placeholder
 * carries no node circle (the placeholder card renders the [+]); it shows a
 * dashed stub in its own lane — the hidden subtree's column — that the surviving
 * parent's fork connector (recomputed on the parent's row) arcs up to meet. The
 * pseudo-row keeps the recomputed `nodeLane`/`maxLane` so it sits in the right
 * column, but its lane segments are normalized to that single dashed stub and its
 * own fork connectors are dropped (placeholders have no children).
 */
function asPlaceholderFragment(fragment: TreeFragmentData): TreeFragmentData {
	return { ...buildPlaceholderFragmentForLane(fragment.nodeLane, fragment.maxLane) };
}

/** Builds the dashed placeholder fragment for a given node lane and max lane. */
function buildPlaceholderFragmentForLane(nodeLane: number, maxLane: number): TreeFragmentData {
	const width = Math.max(nodeLane, maxLane);
	return {
		lanes: Array.from({ length: width + 1 }, (_, i) => ({
			continuesFromAbove: false,
			continuesBelow: i === nodeLane,
			hasNode: false,
			needsRestack: false,
		})),
		maxLane: width,
		nodeLane,
		childForkLanes: [],
		nodeStyle: 'placeholder',
		nodeNeedsRestack: false,
	};
}

/** Defensive fallback fragment if recomputation produced no entry for a placeholder. */
function buildPlaceholderFragmentFallback(lane: number): TreeFragmentData {
	return buildPlaceholderFragmentForLane(lane, lane);
}
