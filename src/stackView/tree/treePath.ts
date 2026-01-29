import type { BranchViewModel } from '../types';
import { CURVE_RADIUS, NODE_GAP } from './treeConstants';

/** Path data with styling information. */
export type PathData = {
	d: string;
	restack: boolean;
	uncommitted?: boolean;
};

/**
 * Creates SVG path from parent to child using "smooth exit" pattern.
 * Matches VSCode's scmHistory.ts arc drawing approach.
 *
 * Paths include gaps at node boundaries so lines don't overlap the
 * circular nodes - creating the "halo" effect seen in VSCode.
 */
export function createRoundedPath(parentX: number, parentY: number, childX: number, childY: number): string {
	const r = CURVE_RADIUS;
	const gap = NODE_GAP;

	// Same lane: straight vertical line with gaps at both ends
	if (parentX === childX) {
		const startY = parentY - gap; // Above parent's top edge
		const endY = childY + gap; // Below child's bottom edge
		return `M ${parentX} ${startY} L ${childX} ${endY}`;
	}

	// Different lanes: horizontal exit → arc → vertical to child
	const goingRight = childX > parentX;

	// Start with gap from parent's edge (horizontal exit)
	const startX = goingRight ? parentX + gap : parentX - gap;

	// End with gap from child's edge (vertical approach from below)
	const endY = childY + gap;

	// Clamp curve radius to available space
	const dx = Math.abs(childX - startX);
	const dy = Math.abs(parentY - endY);
	const effectiveR = Math.min(r, dx, dy);

	// SVG arc sweep: 0=counter-clockwise (going right), 1=clockwise (going left)
	const sweep = goingRight ? 0 : 1;

	// Horizontal line ends at curve start
	const hLineEndX = goingRight ? childX - effectiveR : childX + effectiveR;

	// Arc ends at child's X, effectiveR above parent's Y
	const arcEndY = parentY - effectiveR;

	return [
		`M ${startX} ${parentY}`,
		`L ${hLineEndX} ${parentY}`,
		`A ${effectiveR} ${effectiveR} 0 0 ${sweep} ${childX} ${arcEndY}`,
		`L ${childX} ${endY}`,
	].join(' ');
}

/**
 * Builds SVG path data for parent-child connections.
 */
export function buildSvgPaths(
	branches: BranchViewModel[],
	branchMap: Map<string, BranchViewModel>,
	nodePositions: Map<string, { x: number; y: number }>,
): PathData[] {
	const paths: PathData[] = [];

	// Add uncommitted connector if present
	const uncommittedPos = nodePositions.get('__uncommitted__');
	const currentBranch = branches.find((b) => b.current);
	if (uncommittedPos && currentBranch) {
		const currentPos = nodePositions.get(currentBranch.name);
		if (currentPos) {
			const d = createRoundedPath(currentPos.x, currentPos.y, uncommittedPos.x, uncommittedPos.y);
			paths.push({ d, restack: false, uncommitted: true });
		}
	}

	for (const branch of branches) {
		if (!branch.tree.parentName) continue;

		const parent = branchMap.get(branch.tree.parentName);
		if (!parent) continue;

		const childPos = nodePositions.get(branch.name);
		const parentPos = nodePositions.get(branch.tree.parentName);
		if (!childPos || !parentPos) continue;

		const d = createRoundedPath(parentPos.x, parentPos.y, childPos.x, childPos.y);
		paths.push({ d, restack: branch.restack });
	}

	return paths;
}
