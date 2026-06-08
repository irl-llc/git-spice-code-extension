/**
 * Integration-branch view-model + swimlane layout (issue #39). Extracted from
 * state.ts to keep that file within the size budget. The integration node is
 * laid out as the mirror of the trunk: it sits atop the stack and fans
 * connectors DOWN into each integration tip's lane (the trunk fans UP into each
 * root's lane). Pure — no vscode/rendering imports.
 */

import type { IntegrationState } from '../utils/integrationState';
import type { BranchWithTree } from './stateTypes';
import type { IntegrationFork, IntegrationViewModel, LaneSegment, TreeFragmentData } from './types';

/**
 * Maps a parsed {@link IntegrationState} to the view model, or undefined when
 * no integration branch is configured/supported. Carries the "rebuild"
 * staleness, the tip-branch names (used to mark out-of-integration branches),
 * and the tree fragment for the integration node row.
 */
export function toIntegrationViewModel(
	state: IntegrationState | null | undefined,
	ordered: BranchWithTree[],
	fragments: Map<string, TreeFragmentData>,
): IntegrationViewModel | undefined {
	if (!state) return undefined;
	const tipNames = state.tips.map((tip) => tip.name);
	return {
		name: state.name,
		needsRebuild: state.needsRebuild,
		tipNames,
		treeFragment: applyIntegrationLayout(ordered, fragments, tipNames, state.needsRebuild),
	};
}

/**
 * Lays out the integration branch as the mirror of the trunk, returning the
 * integration node's own fragment and MUTATING the per-branch fragments to add
 * each tip's outgoing link up to it.
 *
 * The trunk node (at the bottom) fans connectors UP into the lane of each root
 * branch; the integration node (at the top) fans connectors DOWN into the lane
 * of each integration TIP. A tip that is the top-most branch in its lane links
 * to integration straight up its own lane; a mid-stack tip — one with a branch
 * above it — is a divergence (its normal child and the integration node are
 * both children) and gets its own **bypass lane**, fanning up out of its node
 * and running past the rows above it. Non-tip non-trunk branches keep their ✕
 * (see {@link computeOutOfIntegration}) and contribute no link.
 */
function applyIntegrationLayout(
	ordered: BranchWithTree[],
	fragments: Map<string, TreeFragmentData>,
	tipNames: string[],
	needsRebuild: boolean,
): TreeFragmentData {
	const origMaxLane = ordered.reduce((m, it) => Math.max(m, it.tree.lane), 0);
	const ctx: IntegLayoutCtx = {
		ordered,
		fragments,
		needsRebuild,
		acc: { nextBypass: origMaxLane + 1, integDownToZero: false, integDownForks: [] },
	};
	linkTipsToIntegration(ctx, new Set(tipNames));

	const newMaxLane = Math.max(origMaxLane, ctx.acc.nextBypass - 1);
	extendFragmentsToMaxLane(ordered, fragments, newMaxLane);
	return buildIntegrationNodeFragment(ctx, newMaxLane);
}

/** Pads every branch fragment's lane array out to the final max lane. */
function extendFragmentsToMaxLane(
	ordered: BranchWithTree[],
	fragments: Map<string, TreeFragmentData>,
	maxLane: number,
): void {
	for (const it of ordered) {
		const frag = fragments.get(it.branch.name)!;
		ensureLane(frag, maxLane);
		frag.maxLane = maxLane;
	}
}

/** Mutable accumulator threaded through the integration layout pass. */
type IntegLayoutAcc = {
	/** Next free lane to allocate as a bypass for a mid-stack tip. */
	nextBypass: number;
	/** A tip links to the integration node straight up lane 0. */
	integDownToZero: boolean;
	/** Down-forks from the integration node into each non-zero tip lane. */
	integDownForks: IntegrationFork[];
};

/** Shared inputs threaded through the integration layout helpers. */
type IntegLayoutCtx = {
	ordered: BranchWithTree[];
	fragments: Map<string, TreeFragmentData>;
	needsRebuild: boolean;
	acc: IntegLayoutAcc;
};

/** Records the first (top-most) row index seen for each lane. */
function topmostRowByLane(ordered: BranchWithTree[]): Map<number, number> {
	const topmost = new Map<number, number>();
	ordered.forEach((it, row) => {
		if (!topmost.has(it.tree.lane)) topmost.set(it.tree.lane, row);
	});
	return topmost;
}

/** Wires each integration tip's outgoing link up to the integration node. */
function linkTipsToIntegration(ctx: IntegLayoutCtx, tipSet: Set<string>): void {
	const topmost = topmostRowByLane(ctx.ordered);
	ctx.ordered.forEach((it, row) => {
		if (!tipSet.has(it.branch.name)) return;
		const lane = it.tree.lane;
		const frag = ctx.fragments.get(it.branch.name)!;
		const integLane = assignTipIntegrationLane(ctx, frag, topmost.get(lane) === row, lane);
		if (integLane === 0) ctx.acc.integDownToZero = true;
		else ctx.acc.integDownForks.push({ lane: integLane, direction: 'down', needsRebuild: ctx.needsRebuild });
		passIntegrationLaneAboveTip(ctx, integLane, row);
	});
}

/**
 * Picks the lane a tip uses to reach the integration node: its own lane when it
 * is top-most there (links straight up), otherwise a fresh bypass lane that fans
 * up out of the node (the mid-stack divergence). Mutates `frag` accordingly.
 */
function assignTipIntegrationLane(
	ctx: IntegLayoutCtx,
	frag: TreeFragmentData,
	isTopmostInLane: boolean,
	lane: number,
): number {
	if (isTopmostInLane) {
		frag.lanes[lane] = {
			...frag.lanes[lane],
			continuesFromAbove: true,
			needsRestack: frag.lanes[lane].needsRestack || ctx.needsRebuild,
		};
		return lane;
	}
	const bypass = ctx.acc.nextBypass++;
	(frag.integrationForks ??= []).push({ lane: bypass, direction: 'up', needsRebuild: ctx.needsRebuild });
	return bypass;
}

/** Marks the integration lane as a pass-through on every row above the tip. */
function passIntegrationLaneAboveTip(ctx: IntegLayoutCtx, integLane: number, tipRow: number): void {
	for (let r = 0; r < tipRow; r++) {
		const above = ctx.fragments.get(ctx.ordered[r].branch.name)!;
		ensureLane(above, integLane);
		above.lanes[integLane] = {
			...above.lanes[integLane],
			continuesFromAbove: true,
			continuesBelow: true,
			needsRestack: above.lanes[integLane].needsRestack || ctx.needsRebuild,
		};
	}
}

/** Builds the lane segments for the integration node's row (only lane 0 holds the node). */
function buildIntegrationLanes(maxLane: number, acc: IntegLayoutAcc, needsRebuild: boolean): LaneSegment[] {
	return Array.from({ length: maxLane + 1 }, (_, l) => {
		const onZero = l === 0;
		return {
			continuesFromAbove: false,
			continuesBelow: onZero && acc.integDownToZero,
			hasNode: onZero,
			needsRestack: onZero && acc.integDownToZero && needsRebuild,
		};
	});
}

/** Builds the integration node's own row fragment (lane-0 node fanning down to tips). */
function buildIntegrationNodeFragment(ctx: IntegLayoutCtx, maxLane: number): TreeFragmentData {
	return {
		lanes: buildIntegrationLanes(maxLane, ctx.acc, ctx.needsRebuild),
		maxLane,
		nodeLane: 0,
		childForkLanes: [],
		nodeStyle: 'integration',
		nodeNeedsRestack: ctx.needsRebuild,
		integrationForks: ctx.acc.integDownForks,
	};
}

/** Extends a fragment's lane array with empty pass-through slots up to `lane`. */
function ensureLane(frag: TreeFragmentData, lane: number): void {
	while (frag.lanes.length <= lane) {
		frag.lanes.push({ continuesFromAbove: false, continuesBelow: false, hasNode: false, needsRestack: false });
	}
}
