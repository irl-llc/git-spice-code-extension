/**
 * In-memory collapse-set mutation helpers (issue #66).
 *
 * Collapse state is per-repo and per-session: a `Set<string>` of collapse-root
 * branch names. These pure helpers compute the next set from a toggle/expand/
 * collapse-others action so the StackViewProvider methods stay thin and the
 * logic is unit-testable without a `vscode` instance.
 */

import type { GitSpiceBranch } from '../gitSpiceSchema';
import { computeCollapsibleBranches, computeCollapseOthers, type CollapseBranchInput } from './tree/collapse';

/** Derives collapse inputs (name + parent linkage) directly from branch records. */
export function computeCollapseInputsForRepo(
	branches: GitSpiceBranch[],
	integrationName?: string,
): CollapseBranchInput[] {
	return branches.filter((b) => b.name !== integrationName).map((b) => ({ name: b.name, parentName: b.down?.name }));
}

/** Branch names that may never be collapsed: trunk (no base) and integration. */
function neverCollapsible(inputs: CollapseBranchInput[], integrationName?: string): Set<string> {
	const never = new Set<string>();
	if (integrationName) never.add(integrationName);
	for (const b of inputs) if (!b.parentName) never.add(b.name);
	return never;
}

/**
 * Returns the next collapsed set after toggling one branch as a collapse root.
 * Only collapsible branches can be added; a non-collapsible branch is ignored.
 */
export function toggleCollapseRoot(
	current: ReadonlySet<string>,
	inputs: CollapseBranchInput[],
	branchName: string,
	integrationName?: string,
): Set<string> {
	const next = new Set(current);
	if (next.has(branchName)) {
		next.delete(branchName);
		return next;
	}
	const collapsible = computeCollapsibleBranches(inputs, neverCollapsible(inputs, integrationName));
	if (collapsible.has(branchName)) next.add(branchName);
	return next;
}

/** Returns the next collapsed set after expanding (removing) the given roots. */
export function expandRoots(current: ReadonlySet<string>, roots: string[]): Set<string> {
	const next = new Set(current);
	for (const root of roots) next.delete(root);
	return next;
}

/**
 * Returns the collapsed set for "collapse other stacks": every collapsible
 * subtree that is not the clicked branch, its ancestors, or its descendants.
 */
export function collapseOtherStacks(
	inputs: CollapseBranchInput[],
	branchName: string,
	integrationName?: string,
): Set<string> {
	const collapsible = computeCollapsibleBranches(inputs, neverCollapsible(inputs, integrationName));
	return computeCollapseOthers(inputs, branchName, collapsible);
}

/** A collapse mutation requested from the webview (issue #66). */
export type CollapseOp =
	| { kind: 'toggle'; branchName: string }
	| { kind: 'expand'; roots: string[] }
	| { kind: 'collapseOthers'; branchName: string };

/** Computes the next collapsed set for a repo after applying `op`. */
export function applyCollapseOp(
	current: ReadonlySet<string>,
	branches: GitSpiceBranch[],
	integrationName: string | undefined,
	op: CollapseOp,
): Set<string> {
	if (op.kind === 'expand') return expandRoots(current, op.roots);
	const inputs = computeCollapseInputsForRepo(branches, integrationName);
	if (op.kind === 'collapseOthers') return collapseOtherStacks(inputs, op.branchName, integrationName);
	return toggleCollapseRoot(current, inputs, op.branchName, integrationName);
}

/** Owns the per-repo, per-session collapse-root sets (issue #66). */
export class CollapseStore {
	private readonly byRepo = new Map<string, Set<string>>();

	/** The collapse-root set for a repo, or undefined when nothing is collapsed. */
	get(rootPath: string): ReadonlySet<string> | undefined {
		return this.byRepo.get(rootPath);
	}

	/** Applies a collapse op to a repo's current set in place (issue #66). */
	mutate(rootPath: string, branches: GitSpiceBranch[], integrationName: string | undefined, op: CollapseOp): void {
		this.byRepo.set(rootPath, applyCollapseOp(this.byRepo.get(rootPath) ?? new Set(), branches, integrationName, op));
	}

	/** Drops sets for repos whose root path is no longer active, so they can't leak. */
	prune(activeRootPaths: ReadonlySet<string>): void {
		for (const key of [...this.byRepo.keys()]) if (!activeRootPaths.has(key)) this.byRepo.delete(key);
	}
}
