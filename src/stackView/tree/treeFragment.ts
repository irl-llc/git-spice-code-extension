/**
 * Creates per-row SVG tree fragments.
 * Each branch row renders its own SVG showing lanes, connectors, and node.
 */

import {
	CONNECTOR_WIDTH,
	CURVE_RADIUS,
	LANE_WIDTH,
	NODE_GAP,
	NODE_RADIUS,
	NODE_RADIUS_CURRENT,
	NODE_STROKE,
	NODE_Y,
} from './treeConstants';
import type { ChildForkStyle, LaneSegment, TreeFragmentData } from '../types';

/** Colors used for tree rendering. */
export type TreeColors = {
	line: string;
	node: string;
	nodeCurrent: string;
	restack: string;
	bg: string;
};

/**
 * Creates an SVG element for a single row's tree fragment.
 * The SVG spans all lanes and uses percentage-based Y coordinates.
 */
export function createTreeFragmentSvg(data: TreeFragmentData, colors: TreeColors): SVGSVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.classList.add('tree-fragment-svg');

	const width = calculateFragmentWidth(data.maxLane);
	svg.setAttribute('width', String(width));
	svg.style.width = `${width}px`;

	renderLaneSegments(svg, data, colors);
	renderChildForkConnectors(svg, data, colors);
	renderNode(svg, data, colors);

	return svg;
}

/** Calculates SVG width based on number of lanes. */
function calculateFragmentWidth(maxLane: number): number {
	return LANE_WIDTH * (maxLane + 1) + NODE_RADIUS_CURRENT + NODE_STROKE;
}

/** Returns the X coordinate for a given lane index. */
function getLaneX(lane: number): number {
	return LANE_WIDTH * (lane + 0.5);
}

/** Renders all vertical lane segments. */
function renderLaneSegments(svg: SVGSVGElement, data: TreeFragmentData, colors: TreeColors): void {
	const isUncommitted = data.nodeStyle === 'uncommitted';
	const childForkLaneSet = new Set(data.childForkLanes.map((cf) => cf.lane));

	for (let lane = 0; lane <= data.maxLane; lane++) {
		const segment = data.lanes[lane];
		if (!segment) continue;

		const hasActivity = segment.continuesFromAbove || segment.continuesBelow || segment.hasNode;
		if (!hasActivity) continue;

		// Only dash lines from the uncommitted node itself, not pass-through lanes
		const isDashed = isUncommitted && segment.hasNode;

		// Skip top segment on child fork lanes - the fork connector draws the vertical there
		const skipTopSegment = childForkLaneSet.has(lane);

		renderLaneSegment(svg, lane, segment, colors, isDashed, skipTopSegment);
	}
}

/** Renders a single lane's vertical segment for this row. */
function renderLaneSegment(
	svg: SVGSVGElement,
	lane: number,
	segment: LaneSegment,
	colors: TreeColors,
	isDashed: boolean,
	skipTopSegment: boolean,
): void {
	const x = getLaneX(lane);
	const strokeColor = segment.needsRestack ? colors.restack : colors.line;
	const hasNodeHere = segment.hasNode;
	// Dash for uncommitted nodes OR for any restack segment
	const dashArray = isDashed || segment.needsRestack ? '3 2' : undefined;

	// Skip top segment if child fork connectors handle it (avoids duplicate lines)
	if (segment.continuesFromAbove && !skipTopSegment) {
		appendTopSegment(svg, x, hasNodeHere, strokeColor, dashArray);
	}

	if (segment.continuesBelow) {
		appendBottomSegment(svg, x, hasNodeHere, strokeColor, dashArray);
	}
}

/** Appends the top half of a vertical lane segment. */
function appendTopSegment(
	svg: SVGSVGElement,
	x: number,
	hasNodeHere: boolean,
	stroke: string,
	dashArray?: string,
): void {
	const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
	line.setAttribute('x1', String(x));
	line.setAttribute('y1', '0');
	line.setAttribute('x2', String(x));
	line.setAttribute('y2', hasNodeHere ? String(NODE_Y - NODE_GAP) : String(NODE_Y));
	line.setAttribute('stroke', stroke);
	line.setAttribute('stroke-width', String(CONNECTOR_WIDTH));
	if (dashArray) {
		line.setAttribute('stroke-dasharray', dashArray);
	}
	svg.appendChild(line);
}

/** Appends the bottom half of a vertical lane segment. */
function appendBottomSegment(
	svg: SVGSVGElement,
	x: number,
	hasNodeHere: boolean,
	stroke: string,
	dashArray?: string,
): void {
	const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
	line.setAttribute('x1', String(x));
	line.setAttribute('y1', hasNodeHere ? String(NODE_Y + NODE_GAP) : String(NODE_Y));
	line.setAttribute('x2', String(x));
	line.setAttribute('y2', '100%');
	line.setAttribute('stroke', stroke);
	line.setAttribute('stroke-width', String(CONNECTOR_WIDTH));
	if (dashArray) {
		line.setAttribute('stroke-dasharray', dashArray);
	}
	svg.appendChild(line);
}

/**
 * Renders connectors from parent node UP to child lanes that fork to different lanes.
 * Each connector uses per-child styling (restack color, uncommitted dashing).
 */
function renderChildForkConnectors(svg: SVGSVGElement, data: TreeFragmentData, colors: TreeColors): void {
	if (data.childForkLanes.length === 0) return;

	for (const childFork of data.childForkLanes) {
		renderSingleChildFork(svg, data.nodeLane, childFork, colors);
	}
}

/**
 * Renders a single connector from parent node to a child's lane.
 * Uses per-child styling: restack color for needsRestack, dashed for uncommitted.
 */
function renderSingleChildFork(
	svg: SVGSVGElement,
	parentLane: number,
	childFork: ChildForkStyle,
	colors: TreeColors,
): void {
	const parentX = getLaneX(parentLane);
	const childX = getLaneX(childFork.lane);
	const goingRight = childX > parentX;
	const radius = CURVE_RADIUS;

	// Determine stroke color and dash pattern based on child state
	const strokeColor = childFork.needsRestack ? colors.restack : colors.line;
	const dashArray = childFork.isUncommitted || childFork.needsRestack ? '3 2' : undefined;

	// 1. Horizontal line at NODE_Y from parent lane toward child lane
	const arcStartX = goingRight ? childX - radius : childX + radius;
	appendHorizontalLine(svg, parentX, arcStartX, NODE_Y, strokeColor, dashArray);

	// 2. Arc at child's corner: curves from horizontal to vertical
	const arcEndY = NODE_Y - radius;
	const arcPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	const arcD = goingRight
		? `M ${arcStartX} ${NODE_Y} A ${radius} ${radius} 0 0 0 ${childX} ${arcEndY}`
		: `M ${arcStartX} ${NODE_Y} A ${radius} ${radius} 0 0 1 ${childX} ${arcEndY}`;
	arcPath.setAttribute('d', arcD);
	arcPath.setAttribute('stroke', strokeColor);
	arcPath.setAttribute('stroke-width', String(CONNECTOR_WIDTH));
	arcPath.setAttribute('fill', 'none');
	if (dashArray) arcPath.setAttribute('stroke-dasharray', dashArray);
	svg.appendChild(arcPath);

	// 3. Vertical line on child lane from arc up to y=0
	appendVerticalLine(svg, childX, arcEndY, 0, strokeColor, dashArray);
}

/** Appends a horizontal line segment with optional dash styling. */
function appendHorizontalLine(
	svg: SVGSVGElement,
	x1: number,
	x2: number,
	y: number,
	stroke: string,
	dashArray?: string,
): void {
	const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
	line.setAttribute('x1', String(x1));
	line.setAttribute('y1', String(y));
	line.setAttribute('x2', String(x2));
	line.setAttribute('y2', String(y));
	line.setAttribute('stroke', stroke);
	line.setAttribute('stroke-width', String(CONNECTOR_WIDTH));
	if (dashArray) line.setAttribute('stroke-dasharray', dashArray);
	svg.appendChild(line);
}

/** Appends a vertical line segment with optional dash styling. */
function appendVerticalLine(
	svg: SVGSVGElement,
	x: number,
	y1: number,
	y2: number,
	stroke: string,
	dashArray?: string,
): void {
	const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
	line.setAttribute('x1', String(x));
	line.setAttribute('y1', String(y1));
	line.setAttribute('x2', String(x));
	line.setAttribute('y2', String(y2));
	line.setAttribute('stroke', stroke);
	line.setAttribute('stroke-width', String(CONNECTOR_WIDTH));
	if (dashArray) line.setAttribute('stroke-dasharray', dashArray);
	svg.appendChild(line);
}

/** Renders the node circle for this row. */
function renderNode(svg: SVGSVGElement, data: TreeFragmentData, colors: TreeColors): void {
	const x = getLaneX(data.nodeLane);
	const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');

	circle.setAttribute('cx', String(x));
	circle.setAttribute('cy', String(NODE_Y));

	applyNodeStyle(circle, data, colors);
	svg.appendChild(circle);
}

/** Applies styling to the node circle based on node type. */
function applyNodeStyle(circle: SVGCircleElement, data: TreeFragmentData, colors: TreeColors): void {
	if (data.nodeStyle === 'current') {
		applyCurrentNodeStyle(circle, colors);
		return;
	}

	if (data.nodeStyle === 'uncommitted') {
		applyUncommittedNodeStyle(circle, colors);
		return;
	}

	applyNormalNodeStyle(circle, data, colors);
}

/** Applies styling for the current branch node. */
function applyCurrentNodeStyle(circle: SVGCircleElement, colors: TreeColors): void {
	circle.setAttribute('r', String(NODE_RADIUS_CURRENT));
	circle.setAttribute('fill', colors.bg);
	circle.setAttribute('stroke', colors.nodeCurrent);
	circle.setAttribute('stroke-width', String(NODE_STROKE));
}

/** Applies styling for uncommitted changes node. */
function applyUncommittedNodeStyle(circle: SVGCircleElement, colors: TreeColors): void {
	circle.setAttribute('r', String(NODE_RADIUS_CURRENT));
	circle.setAttribute('fill', colors.bg);
	circle.setAttribute('stroke', colors.nodeCurrent);
	circle.setAttribute('stroke-width', String(NODE_STROKE));
	circle.setAttribute('stroke-dasharray', '3 2');
}

/** Applies styling for normal branch nodes. */
function applyNormalNodeStyle(circle: SVGCircleElement, data: TreeFragmentData, colors: TreeColors): void {
	circle.setAttribute('r', String(NODE_RADIUS));
	const fillColor = data.nodeNeedsRestack ? colors.restack : colors.node;
	circle.setAttribute('fill', fillColor);
}
