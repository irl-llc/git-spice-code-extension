/**
 * Per-row SVG tree fragments rendered as JSX.
 *
 * Replaces the previous imperative `createTreeFragmentSvg` +
 * `<TreeFragmentSvg>` useEffect wrapper. Each branch row in
 * StackView mounts `<TreeFragmentSvg fragment={…} colors={…}/>`
 * directly; React reconciles when props change. Output shape is
 * preserved to keep the Playwright visual snapshots in
 * `src/test/e2e/playwright/treeFragment.spec.ts-snapshots/`
 * byte-identical with the imperative version.
 */

import { type JSX } from 'react';

import type { ChildForkStyle, LaneSegment, TreeFragmentData } from '../types';
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

/** Colors used for tree rendering. */
export type TreeColors = {
	line: string;
	node: string;
	nodeCurrent: string;
	restack: string;
	bg: string;
};

export interface TreeFragmentSvgProps {
	fragment: TreeFragmentData;
	colors: TreeColors;
	/** When true, draws an "X" over this row's node (branch excluded from the integration build). */
	outOfIntegration?: boolean;
}

export function TreeFragmentSvg({ fragment, colors, outOfIntegration }: TreeFragmentSvgProps): JSX.Element {
	const width = calculateFragmentWidth(fragment.maxLane);
	return (
		<svg className="tree-fragment-svg" width={width} style={{ width: `${width}px` }}>
			{renderLaneSegments(fragment, colors)}
			{renderChildForkConnectors(fragment, colors)}
			{renderNode(fragment, colors)}
			{outOfIntegration ? renderOutOfIntegrationMark(fragment, colors) : null}
		</svg>
	);
}

/**
 * Draws an "X" centered on the node to mark a branch excluded from the
 * integration build. Renders a bg-colored halo under a line-colored cross so
 * it stays legible on both filled (normal) and hollow (current) node circles.
 */
function renderOutOfIntegrationMark(data: TreeFragmentData, colors: TreeColors): JSX.Element {
	const x = getLaneX(data.nodeLane);
	const d = NODE_RADIUS_CURRENT - 0.5;
	const cross = (stroke: string, w: number, keyPrefix: string): JSX.Element[] => [
		<line
			key={`${keyPrefix}-a`}
			x1={x - d}
			y1={NODE_Y - d}
			x2={x + d}
			y2={NODE_Y + d}
			stroke={stroke}
			strokeWidth={w}
		/>,
		<line
			key={`${keyPrefix}-b`}
			x1={x - d}
			y1={NODE_Y + d}
			x2={x + d}
			y2={NODE_Y - d}
			stroke={stroke}
			strokeWidth={w}
		/>,
	];
	return (
		<g className="out-of-integration-mark" strokeLinecap="round">
			{...cross(colors.bg, 2.5, 'halo')}
			{...cross(colors.line, 1.25, 'mark')}
		</g>
	);
}

function calculateFragmentWidth(maxLane: number): number {
	return LANE_WIDTH * (maxLane + 1) + NODE_RADIUS_CURRENT + NODE_STROKE;
}

function getLaneX(lane: number): number {
	return LANE_WIDTH * (lane + 0.5);
}

function renderLaneSegments(data: TreeFragmentData, colors: TreeColors): JSX.Element[] {
	const isUncommitted = data.nodeStyle === 'uncommitted';
	const childForkLaneSet = new Set(data.childForkLanes.map((cf) => cf.lane));
	const out: JSX.Element[] = [];

	for (let lane = 0; lane <= data.maxLane; lane++) {
		const segment = data.lanes[lane];
		if (!segment) continue;
		if (!segment.continuesFromAbove && !segment.continuesBelow && !segment.hasNode) continue;

		// Dash lines only at the uncommitted node itself, not pass-through lanes.
		const isDashed = isUncommitted && segment.hasNode;
		// Skip top segment on child fork lanes — the fork connector draws the vertical there.
		const skipTopSegment = childForkLaneSet.has(lane);

		out.push(...renderLaneSegment(lane, segment, colors, isDashed, skipTopSegment));
	}
	return out;
}

function renderLaneSegment(
	lane: number,
	segment: LaneSegment,
	colors: TreeColors,
	isDashed: boolean,
	skipTopSegment: boolean,
): JSX.Element[] {
	const x = getLaneX(lane);
	const stroke = segment.needsRestack ? colors.restack : colors.line;
	const dashArray = isDashed || segment.needsRestack ? '3 2' : undefined;
	const hasNode = segment.hasNode;
	const elements: JSX.Element[] = [];

	if (segment.continuesFromAbove && !skipTopSegment) {
		elements.push(
			<line
				key={`top-${lane}`}
				x1={x}
				y1={0}
				x2={x}
				y2={hasNode ? NODE_Y - NODE_GAP : NODE_Y}
				stroke={stroke}
				strokeWidth={CONNECTOR_WIDTH}
				strokeDasharray={dashArray}
			/>,
		);
	}
	if (segment.continuesBelow) {
		elements.push(
			<line
				key={`bot-${lane}`}
				x1={x}
				y1={hasNode ? NODE_Y + NODE_GAP : NODE_Y}
				x2={x}
				y2="100%"
				stroke={stroke}
				strokeWidth={CONNECTOR_WIDTH}
				strokeDasharray={dashArray}
			/>,
		);
	}
	return elements;
}

function renderChildForkConnectors(data: TreeFragmentData, colors: TreeColors): JSX.Element[] {
	if (data.childForkLanes.length === 0) return [];
	return data.childForkLanes.flatMap((childFork, i) => renderSingleChildFork(data.nodeLane, childFork, colors, i));
}

function renderSingleChildFork(
	parentLane: number,
	childFork: ChildForkStyle,
	colors: TreeColors,
	index: number,
): JSX.Element[] {
	const parentX = getLaneX(parentLane);
	const childX = getLaneX(childFork.lane);
	const goingRight = childX > parentX;
	const radius = CURVE_RADIUS;

	const stroke = childFork.needsRestack ? colors.restack : colors.line;
	const dashArray = childFork.isUncommitted || childFork.needsRestack ? '3 2' : undefined;

	// 1. Horizontal line at NODE_Y from parent toward the arc's start.
	const arcStartX = goingRight ? childX - radius : childX + radius;
	// 2. Arc curving from horizontal to vertical at the child's lane.
	const arcEndY = NODE_Y - radius;
	const arcD = goingRight
		? `M ${arcStartX} ${NODE_Y} A ${radius} ${radius} 0 0 0 ${childX} ${arcEndY}`
		: `M ${arcStartX} ${NODE_Y} A ${radius} ${radius} 0 0 1 ${childX} ${arcEndY}`;

	return [
		<line
			key={`fork-h-${index}`}
			x1={parentX}
			y1={NODE_Y}
			x2={arcStartX}
			y2={NODE_Y}
			stroke={stroke}
			strokeWidth={CONNECTOR_WIDTH}
			strokeDasharray={dashArray}
		/>,
		<path
			key={`fork-a-${index}`}
			d={arcD}
			stroke={stroke}
			strokeWidth={CONNECTOR_WIDTH}
			fill="none"
			strokeDasharray={dashArray}
		/>,
		// 3. Vertical line on child lane from arc up to top.
		<line
			key={`fork-v-${index}`}
			x1={childX}
			y1={arcEndY}
			x2={childX}
			y2={0}
			stroke={stroke}
			strokeWidth={CONNECTOR_WIDTH}
			strokeDasharray={dashArray}
		/>,
	];
}

function renderNode(data: TreeFragmentData, colors: TreeColors): JSX.Element {
	const x = getLaneX(data.nodeLane);
	if (data.nodeStyle === 'current') {
		return (
			<circle
				cx={x}
				cy={NODE_Y}
				r={NODE_RADIUS_CURRENT}
				fill={colors.bg}
				stroke={colors.nodeCurrent}
				strokeWidth={NODE_STROKE}
			/>
		);
	}
	if (data.nodeStyle === 'uncommitted') {
		return (
			<circle
				cx={x}
				cy={NODE_Y}
				r={NODE_RADIUS_CURRENT}
				fill={colors.bg}
				stroke={colors.nodeCurrent}
				strokeWidth={NODE_STROKE}
				strokeDasharray="3 2"
			/>
		);
	}
	if (data.nodeStyle === 'integration') {
		// Hollow ring; warning (marigold) when the integration build needs a rebuild.
		return (
			<circle
				cx={x}
				cy={NODE_Y}
				r={NODE_RADIUS_CURRENT}
				fill={colors.bg}
				stroke={data.nodeNeedsRestack ? colors.restack : colors.node}
				strokeWidth={NODE_STROKE}
			/>
		);
	}
	const fillColor = data.nodeNeedsRestack ? colors.restack : colors.node;
	return <circle cx={x} cy={NODE_Y} r={NODE_RADIUS} fill={fillColor} />;
}
