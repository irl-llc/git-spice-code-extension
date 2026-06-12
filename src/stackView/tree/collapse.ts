/**
 * Pure collapse/expand logic for the stack tree (issue #66).
 *
 * Collapse state is the layout authority's responsibility: it lives
 * extension-side (in-memory per session) and is applied here during the
 * post-order DFS, NOT re-derived in the webview. A "collapse root" is a branch
 * whose entire upstack (its descendants) is hidden and replaced by a single
 * placeholder row; the root branch itself stays visible.
 *
 * This module is deliberately free of `vscode` and rendering imports so it can
 * be unit-tested as a pure function (see collapse.test.ts).
 */

/** Minimal branch shape the collapse logic needs (name + parent linkage). */
export type CollapseBranchInput = {
	name: string;
	/** Parent (base) branch name, or undefined for a root/trunk. */
	parentName?: string;
	/**
	 * Display lane of the branch. Optional because the collapsibility/owning-root
	 * logic does not need it; {@link applyCollapse} uses it to anchor a
	 * placeholder's dashed lane to the column the hidden subtree occupied so the
	 * surviving parent's fork connector lands on a real lane (issue #66 review).
	 */
	lane?: number;
};

/** A row produced by {@link applyCollapse}: a visible branch or a placeholder. */
export type CollapseRow =
	| { kind: 'branch'; name: string }
	| {
			kind: 'placeholder';
			roots: string[];
			subtreeCount: number;
			branchCount: number;
			/**
			 * Lane the placeholder's dashed pass-through occupies: the lane of the
			 * topmost hidden branch in DFS order. Anchors the placeholder under the
			 * fork that the hidden subtree branched off, so non-lane-0 (sibling)
			 * collapses render the dashed lane in the correct column.
			 */
			nodeLane: number;
	  };

/**
 * Returns the set of branch names that are collapsible: any branch with at
 * least one child that is neither trunk nor the integration branch. A branch
 * with no children and no siblings-and-no-ancestors is not collapsible — that
 * falls out naturally since such a branch has no descendants to hide.
 */
export function computeCollapsibleBranches(
	branches: CollapseBranchInput[],
	neverCollapsible: Set<string>,
): Set<string> {
	const childCount = countChildren(branches);
	const collapsible = new Set<string>();
	for (const branch of branches) {
		if (neverCollapsible.has(branch.name)) continue;
		if ((childCount.get(branch.name) ?? 0) > 0) collapsible.add(branch.name);
	}
	return collapsible;
}

/** Counts direct children per branch name from the parent links. */
function countChildren(branches: CollapseBranchInput[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const branch of branches) {
		if (!branch.parentName) continue;
		counts.set(branch.parentName, (counts.get(branch.parentName) ?? 0) + 1);
	}
	return counts;
}

/** Builds a parent-name → descendant-name-set map (transitive closure). */
function buildDescendants(branches: CollapseBranchInput[]): Map<string, Set<string>> {
	const children = new Map<string, string[]>();
	for (const branch of branches) {
		if (!branch.parentName) continue;
		(children.get(branch.parentName) ?? children.set(branch.parentName, []).get(branch.parentName)!).push(branch.name);
	}
	const memo = new Map<string, Set<string>>();
	for (const branch of branches) collectDescendants(branch.name, children, memo);
	return memo;
}

/** Recursively collects (and memoizes) the descendant set for one branch. */
function collectDescendants(
	name: string,
	children: Map<string, string[]>,
	memo: Map<string, Set<string>>,
): Set<string> {
	const cached = memo.get(name);
	if (cached) return cached;
	const result = new Set<string>();
	memo.set(name, result); // set before recursion to guard against cycles
	for (const child of children.get(name) ?? []) {
		result.add(child);
		for (const d of collectDescendants(child, children, memo)) result.add(d);
	}
	return result;
}

/**
 * Applies the collapsed set to a post-order DFS row list. Branches that are
 * descendants of any collapse root are omitted; a single placeholder row is
 * emitted in their place. Adjacent placeholders (collapse states that became
 * neighbors once their subtrees were hidden) are coalesced into one. The
 * collapse-root branches themselves remain visible.
 *
 * @param ordered post-order DFS branch list (descendants before ancestor)
 * @param collapsed the set of collapse-root branch names
 */
export function applyCollapse(ordered: CollapseBranchInput[], collapsed: ReadonlySet<string>): CollapseRow[] {
	const descendants = buildDescendants(ordered);
	const owner = computeOwningRoot(ordered, collapsed, descendants);
	const rows: CollapseRow[] = [];
	for (const branch of ordered) {
		const owningRoot = owner.get(branch.name);
		if (owningRoot !== undefined) {
			appendHiddenBranch(rows, owningRoot, branch.lane ?? 0);
			continue;
		}
		rows.push({ kind: 'branch', name: branch.name });
	}
	return rows;
}

/**
 * Maps each hidden branch to the ACTIVE collapse root that owns it. A collapse
 * root is active only when no ancestor of it is also collapsed; a nested
 * collapsed root is itself hidden behind its ancestor's placeholder, so the
 * ancestor owns the whole run. Active roots never nest, so each hidden branch is
 * enclosed by exactly one — which makes clicking a placeholder's [+] expand
 * exactly one level (issue #66).
 */
function computeOwningRoot(
	ordered: CollapseBranchInput[],
	collapsed: ReadonlySet<string>,
	descendants: Map<string, Set<string>>,
): Map<string, string> {
	const activeRoots = activeCollapseRoots(ordered, collapsed);
	const owner = new Map<string, string>();
	for (const branch of ordered) {
		const root = activeRoots.find((r) => descendants.get(r)?.has(branch.name));
		if (root) owner.set(branch.name, root);
	}
	return owner;
}

/** Collapsed roots with no collapsed ancestor (the visible, top-most ones). */
function activeCollapseRoots(ordered: CollapseBranchInput[], collapsed: ReadonlySet<string>): string[] {
	const parentOf = new Map(ordered.map((b) => [b.name, b.parentName]));
	const hasCollapsedAncestor = (name: string): boolean => {
		for (let cur = parentOf.get(name); cur; cur = parentOf.get(cur)) {
			if (collapsed.has(cur)) return true;
		}
		return false;
	};
	return ordered.map((b) => b.name).filter((name) => collapsed.has(name) && !hasCollapsedAncestor(name));
}

/**
 * Appends a hidden branch to the current placeholder, coalescing with the
 * immediately-preceding placeholder row so adjacent collapse states render as
 * one (issue #66). A hidden branch that is itself a collapse root contributes a
 * new subtree to the placeholder's root list.
 */
function appendHiddenBranch(rows: CollapseRow[], owningRoot: string, lane: number): void {
	const last = rows[rows.length - 1];
	const placeholder = last?.kind === 'placeholder' ? last : startPlaceholder(rows, lane);
	placeholder.branchCount += 1;
	if (!placeholder.roots.includes(owningRoot)) {
		placeholder.roots.push(owningRoot);
		placeholder.subtreeCount += 1;
	}
}

/**
 * Pushes and returns a fresh empty placeholder row anchored to `lane` — the
 * lane of the first (topmost in DFS) hidden branch it stands in for.
 */
function startPlaceholder(rows: CollapseRow[], lane: number): Extract<CollapseRow, { kind: 'placeholder' }> {
	const placeholder: Extract<CollapseRow, { kind: 'placeholder' }> = {
		kind: 'placeholder',
		roots: [],
		subtreeCount: 0,
		branchCount: 0,
		nodeLane: lane,
	};
	rows.push(placeholder);
	return placeholder;
}

/**
 * Computes the collapse-root set for "collapse other stacks": collapse every
 * subtree that is not the clicked branch, its ancestors, or its descendants.
 * Returns the minimal set of collapse roots (top-most collapsible branches on
 * the off-path) so the result coalesces cleanly.
 *
 * A branch is "kept" (not collapsed) when it is the clicked branch, an ancestor
 * of it, or a descendant of it. Every other collapsible branch whose parent is
 * kept becomes a collapse root.
 */
export function computeCollapseOthers(
	branches: CollapseBranchInput[],
	clicked: string,
	collapsible: ReadonlySet<string>,
): Set<string> {
	const kept = computeKeptNames(branches, clicked);
	const roots = new Set<string>();
	for (const branch of branches) {
		if (kept.has(branch.name)) continue;
		const parentKept = !branch.parentName || kept.has(branch.parentName);
		if (parentKept && collapsible.has(branch.name)) roots.add(branch.name);
	}
	return roots;
}

/** The clicked branch plus its ancestors and descendants — the kept path. */
function computeKeptNames(branches: CollapseBranchInput[], clicked: string): Set<string> {
	const byName = new Map(branches.map((b) => [b.name, b]));
	const kept = new Set<string>([clicked]);
	addAncestors(byName, clicked, kept);
	const descendants = buildDescendants(branches).get(clicked) ?? new Set<string>();
	for (const d of descendants) kept.add(d);
	return kept;
}

/** Walks the parent chain from a branch up to the root, adding each ancestor. */
function addAncestors(byName: Map<string, CollapseBranchInput>, start: string, into: Set<string>): void {
	let current = byName.get(start)?.parentName;
	while (current && !into.has(current)) {
		into.add(current);
		current = byName.get(current)?.parentName;
	}
}
