import type { BranchViewModel } from '../types';
import { NODE_RADIUS, NODE_RADIUS_CURRENT, NODE_STROKE } from './treeConstants';
import type { PathData } from './treePath';

/** Color configuration for tree visualization. */
export type TreeColors = {
	line: string;
	restack: string;
	node: string;
	nodeCurrent: string;
	bg: string;
};

/**
 * Creates an SVG circle for the uncommitted changes node.
 * Dashed blue hollow circle.
 */
export function createUncommittedNodeCircle(
	x: number,
	y: number,
	colors: Pick<TreeColors, 'nodeCurrent' | 'bg'>,
): SVGCircleElement {
	const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	circle.setAttribute('cx', String(x));
	circle.setAttribute('cy', String(y));
	circle.setAttribute('r', String(NODE_RADIUS_CURRENT));
	circle.setAttribute('fill', colors.bg);
	circle.setAttribute('stroke', colors.nodeCurrent);
	circle.setAttribute('stroke-width', String(NODE_STROKE));
	circle.setAttribute('stroke-dasharray', '2 2');
	return circle;
}

/**
 * Creates an SVG circle for a branch node.
 * - Current branch: hollow circle with solid stroke
 * - Needs restack: hollow circle with dashed stroke (warning color)
 * - Normal: filled circle
 */
export function createNodeCircle(
	x: number,
	y: number,
	isCurrent: boolean,
	needsRestack: boolean,
	colors: TreeColors,
): SVGCircleElement {
	const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	circle.setAttribute('cx', String(x));
	circle.setAttribute('cy', String(y));

	if (needsRestack) {
		// Hollow circle with dashed stroke (warning style)
		circle.setAttribute('r', String(NODE_RADIUS_CURRENT));
		circle.setAttribute('fill', colors.bg);
		circle.setAttribute('stroke', colors.restack);
		circle.setAttribute('stroke-width', String(NODE_STROKE));
		circle.setAttribute('stroke-dasharray', '2 2');
	} else if (isCurrent) {
		// Hollow circle with solid stroke (current branch indicator)
		circle.setAttribute('r', String(NODE_RADIUS_CURRENT));
		circle.setAttribute('fill', colors.bg);
		circle.setAttribute('stroke', colors.nodeCurrent);
		circle.setAttribute('stroke-width', String(NODE_STROKE));
	} else {
		// Filled circle (normal branch)
		circle.setAttribute('r', String(NODE_RADIUS));
		circle.setAttribute('fill', colors.node);
	}

	return circle;
}

/** Appends path elements to an SVG. */
export function appendPaths(svg: SVGSVGElement, paths: PathData[], colors: TreeColors): void {
	for (const { d, restack, uncommitted } of paths) {
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', d);
		path.setAttribute('stroke-width', '1.5');
		path.setAttribute('fill', 'none');
		path.setAttribute('stroke-linecap', 'round');
		path.setAttribute('stroke-linejoin', 'round');

		if (uncommitted) {
			path.setAttribute('stroke', colors.nodeCurrent);
			path.setAttribute('stroke-dasharray', '4 2');
		} else if (restack) {
			path.setAttribute('stroke', colors.restack);
			path.setAttribute('stroke-dasharray', '4 2');
		} else {
			path.setAttribute('stroke', colors.line);
		}

		svg.appendChild(path);
	}
}

/** Appends node circles to an SVG. */
export function appendNodes(
	svg: SVGSVGElement,
	branches: BranchViewModel[],
	nodePositions: Map<string, { x: number; y: number }>,
	colors: TreeColors,
): void {
	const branchMap = new Map(branches.map((b) => [b.name, b]));

	for (const [branchName, { x, y }] of nodePositions) {
		// Handle uncommitted node specially
		if (branchName === '__uncommitted__') {
			const circle = createUncommittedNodeCircle(x, y, colors);
			svg.appendChild(circle);
			continue;
		}

		const branch = branchMap.get(branchName);
		const isCurrent = branch?.current ?? false;
		const needsRestack = branch?.restack ?? false;
		const circle = createNodeCircle(x, y, isCurrent, needsRestack, colors);
		svg.appendChild(circle);
	}
}
