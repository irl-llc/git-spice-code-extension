/**
 * Branch view-model construction — maps a single git-spice branch (plus its
 * computed tree position and fragment) to the {@link BranchViewModel} the
 * webview renders. Split out of `state.ts`, which now owns only the tree-layout
 * computation; this module owns the per-branch display derivations (restack,
 * change request, commits, out-of-integration marker, and the trunk sync
 * affordance, issue #82).
 */

import type { GitSpiceBranch } from '../gitSpiceSchema';
import type { TrunkSyncState } from '../utils/trunkSync';
import type { BranchChangeViewModel, BranchViewModel, TreeFragmentData, TreePosition } from './types';

/** Inputs for deciding the out-of-integration "X" marker. */
export type IntegrationMarkContext = {
	/** Integration tip names, or undefined when no integration is configured. */
	tipSet?: Set<string>;
	/** Names of branches that are leaves (no other branch is stacked on them). */
	leafNames: Set<string>;
};

/**
 * Determines whether a branch should show the out-of-integration "X" marker.
 * The marker flags a stack HEAD that is excluded from the integration build, so
 * it shows only when an integration branch is configured AND the branch is a
 * leaf (a real stack tip) that is not one of the integration tips. Trunk (no
 * base) and mid-stack branches (which are bases of other branches, so not tips
 * at all) never get the marker (issue #39 review).
 */
export function computeOutOfIntegration(branch: GitSpiceBranch, mark: IntegrationMarkContext): boolean | undefined {
	if (!mark.tipSet) return undefined;
	if (!branch.down) return false; // trunk has no base → exempt from the marker
	if (!mark.leafNames.has(branch.name)) return false; // mid-stack branch is not a tip
	return !mark.tipSet.has(branch.name);
}

/** Checks if branch needs restacking based on parent/child relationships. */
function needsRestack(branch: GitSpiceBranch): boolean {
	const downNeedsRestack = branch.down?.needsRestack === true;
	const upNeedsRestack = (branch.ups ?? []).some((link) => link.needsRestack === true);
	return downNeedsRestack || upNeedsRestack;
}

/** Maps branch commits to view model format. */
function mapCommitsToViewModel(commits: GitSpiceBranch['commits']): BranchViewModel['commits'] {
	if (!commits || commits.length === 0) return undefined;
	return commits.map((c) => ({ sha: c.sha, shortSha: c.sha.slice(0, 8), subject: c.subject }));
}

function toChangeViewModel(change: NonNullable<GitSpiceBranch['change']>): BranchChangeViewModel {
	return {
		id: change.id,
		url: change.url,
		status: change.status,
		comments: change.comments,
	};
}

/** Inputs for building a single branch view model. */
export type CreateBranchViewModelInput = {
	branch: GitSpiceBranch;
	tree: TreePosition;
	treeFragment: TreeFragmentData;
	mark: IntegrationMarkContext;
	/** Non-default trunk sync state; applied only to the trunk branch. */
	trunkSync?: TrunkSyncState;
};

/** Creates a branch view model from branch data and tree information. */
export function createBranchViewModel(input: CreateBranchViewModelInput): BranchViewModel {
	const { branch, tree, treeFragment, mark, trunkSync } = input;
	return {
		name: branch.name,
		current: branch.current === true,
		restack: needsRestack(branch),
		tree,
		treeFragment,
		change: branch.change ? toChangeViewModel(branch.change) : undefined,
		commits: mapCommitsToViewModel(branch.commits),
		outOfIntegration: computeOutOfIntegration(branch, mark),
		// The trunk is the only branch with no base; sync state applies only there.
		trunkSync: !branch.down ? trunkSync : undefined,
	};
}
