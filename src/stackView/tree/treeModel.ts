/**
 * Pure functions for calculating tree fragment data model.
 * This module is intentionally separate from rendering for testability.
 */

import type { ChildForkStyle, LaneSegment, TreeFragmentData, TreeNodeStyle } from '../types';

/** Branch with computed tree position (input to model calculation). */
export type BranchTreeInput = {
	name: string;
	lane: number;
	parentName?: string;
	isCurrent: boolean;
	isUncommitted?: boolean;
	needsRestack: boolean;
};

/**
 * Builds tree fragment data for all branches.
 * Each fragment contains the lane states needed to render that row's SVG.
 */
export function buildTreeFragments(branches: BranchTreeInput[]): Map<string, TreeFragmentData> {
	if (branches.length === 0) {
		return new Map();
	}

	const maxLane = Math.max(...branches.map((b) => b.lane));
	const branchIndexByName = new Map(branches.map((b, i) => [b.name, i]));
	const result = new Map<string, TreeFragmentData>();

	for (let rowIndex = 0; rowIndex < branches.length; rowIndex++) {
		const branch = branches[rowIndex];
		const lanes = buildLanesForRow(branches, rowIndex, maxLane, branchIndexByName);
		const childForkLanes = findChildForkLanes(branches, rowIndex);
		const nodeStyle = determineNodeStyle(branch);

		result.set(branch.name, {
			lanes,
			maxLane,
			nodeLane: branch.lane,
			parentLane: undefined, // Not used - parent draws connectors via childForkLanes
			childForkLanes,
			nodeStyle,
			nodeNeedsRestack: branch.needsRestack,
		});
	}

	return result;
}

/** Builds lane segment states for a single row. */
function buildLanesForRow(
	branches: BranchTreeInput[],
	rowIndex: number,
	maxLane: number,
	branchIndexByName: Map<string, number>,
): LaneSegment[] {
	const lanes: LaneSegment[] = [];
	const currentBranch = branches[rowIndex];

	for (let lane = 0; lane <= maxLane; lane++) {
		const hasNode = currentBranch.lane === lane;
		const continuesFromAbove = doesLaneContinueFromAbove(branches, rowIndex, lane, branchIndexByName);
		const continuesBelow = doesLaneContinueBelow(branches, rowIndex, lane, branchIndexByName);
		const needsRestack = doesLaneNeedRestack(branches, rowIndex, lane, branchIndexByName);

		lanes.push({ continuesFromAbove, continuesBelow, hasNode, needsRestack });
	}

	return lanes;
}

/**
 * Checks if a lane has a connection coming from above.
 * A connection enters from above if a branch above connects to a parent at/below this row,
 * and either the parent or the branch itself is on this lane.
 */
function doesLaneContinueFromAbove(
	branches: BranchTreeInput[],
	rowIndex: number,
	lane: number,
	branchIndexByName: Map<string, number>,
): boolean {
	for (let i = 0; i < rowIndex; i++) {
		const branch = branches[i];
		if (!branch.parentName) continue;

		const parentIndex = branchIndexByName.get(branch.parentName);
		if (parentIndex === undefined || parentIndex < rowIndex) continue;

		const parentLane = branches[parentIndex].lane;
		if (parentLane === lane || branch.lane === lane) return true;
	}
	return false;
}

/**
 * Checks if a lane continues below this row.
 * A lane continues below if current node is on this lane with parent below,
 * or a branch above connects through this lane to a parent below.
 */
function doesLaneContinueBelow(
	branches: BranchTreeInput[],
	rowIndex: number,
	lane: number,
	branchIndexByName: Map<string, number>,
): boolean {
	if (currentNodeContinuesBelow(branches, rowIndex, lane, branchIndexByName)) return true;
	return passThroughContinuesBelow(branches, rowIndex, lane, branchIndexByName);
}

/** Checks if current node on this lane has a parent below. */
function currentNodeContinuesBelow(
	branches: BranchTreeInput[],
	rowIndex: number,
	lane: number,
	branchIndexByName: Map<string, number>,
): boolean {
	const currentBranch = branches[rowIndex];
	if (currentBranch.lane !== lane || !currentBranch.parentName) return false;

	const parentIndex = branchIndexByName.get(currentBranch.parentName);
	return parentIndex !== undefined && parentIndex > rowIndex;
}

/** Checks if a branch above connects through this lane to a parent below. */
function passThroughContinuesBelow(
	branches: BranchTreeInput[],
	rowIndex: number,
	lane: number,
	branchIndexByName: Map<string, number>,
): boolean {
	for (let i = 0; i < rowIndex; i++) {
		const branch = branches[i];
		if (!branch.parentName) continue;

		const parentIndex = branchIndexByName.get(branch.parentName);
		if (parentIndex === undefined || parentIndex <= rowIndex) continue;

		const parentLane = branches[parentIndex].lane;
		if (parentLane === lane || branch.lane === lane) return true;
	}
	return false;
}

/**
 * Determines if a lane segment needs restack styling.
 * A segment needs restack if any connection passing through it requires restacking.
 */
function doesLaneNeedRestack(
	branches: BranchTreeInput[],
	rowIndex: number,
	lane: number,
	branchIndexByName: Map<string, number>,
): boolean {
	const currentBranch = branches[rowIndex];
	if (currentBranch.lane === lane && currentBranch.needsRestack) return true;

	for (let i = 0; i < rowIndex; i++) {
		const branch = branches[i];
		if (!branch.parentName || !branch.needsRestack) continue;

		const parentIndex = branchIndexByName.get(branch.parentName);
		if (parentIndex === undefined || parentIndex < rowIndex) continue;

		const parentLane = branches[parentIndex].lane;
		if (parentLane === lane || branch.lane === lane) return true;
	}
	return false;
}

/**
 * Finds children that fork to different lanes than this branch, with styling info.
 * Children appear ABOVE the parent in display order (post-order traversal).
 */
function findChildForkLanes(branches: BranchTreeInput[], parentIndex: number): ChildForkStyle[] {
	const parent = branches[parentIndex];
	const forkStyles: ChildForkStyle[] = [];

	for (let i = 0; i < parentIndex; i++) {
		const child = branches[i];
		if (child.parentName !== parent.name) continue;
		if (child.lane === parent.lane) continue;

		forkStyles.push({
			lane: child.lane,
			needsRestack: child.needsRestack,
			isUncommitted: child.isUncommitted === true,
		});
	}

	return forkStyles.sort((a, b) => a.lane - b.lane);
}

/** Determines the node styling based on branch state. */
function determineNodeStyle(branch: BranchTreeInput): TreeNodeStyle {
	if (branch.isUncommitted) {
		return 'uncommitted';
	}
	if (branch.isCurrent) {
		return 'current';
	}
	return 'normal';
}
