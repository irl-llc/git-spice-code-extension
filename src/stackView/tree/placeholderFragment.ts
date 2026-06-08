/**
 * Tree fragment for a collapsed-subtree placeholder row (issue #66).
 *
 * The placeholder occupies a single row with a dashed empty lane standing in
 * for the hidden subtree(s). It carries no node circle — the placeholder card
 * renders the [+] affordance and the "N subtrees / M branches" summary — so the
 * fragment is just a dashed pass-through lane in lane 0 to keep the left-side
 * stacking visualization continuous through the gap.
 */

import type { LaneSegment, TreeFragmentData } from '../types';

/** A single dashed lane segment that passes straight through the placeholder row. */
function dashedPassThroughLane(): LaneSegment {
	return { continuesFromAbove: true, continuesBelow: true, hasNode: false, needsRestack: false };
}

/**
 * Builds the tree fragment for a placeholder row. A `placeholder` node style
 * lets the SVG renderer dash the lane without drawing a node circle.
 */
export function buildPlaceholderFragment(): TreeFragmentData {
	return {
		lanes: [dashedPassThroughLane()],
		maxLane: 0,
		nodeLane: 0,
		childForkLanes: [],
		nodeStyle: 'placeholder',
		nodeNeedsRestack: false,
	};
}
