/**
 * Hover-tooltip legend for the swimlane gutter (issue #79).
 *
 * The gutter's lane/node colors encode branch state (current, needs-restack,
 * out-of-integration) but carry no inline label — per the visual-language
 * clean-up (#65) the read-only badges that used to spell this out are being
 * removed. This component restores the meaning as *detail on hover*: an
 * invisible full-height strip overlaid on the gutter column reveals a small
 * legend popover when pointed at. It adds no omnipresent chrome and causes no
 * layout shift — the strip is absolutely positioned over the existing gutter
 * and the popover floats above the cards.
 *
 * Swatch colors are derived from the same `TreeColors` the SVG fragments
 * render with, so the legend can never drift from what's actually drawn.
 */

import { type JSX, type KeyboardEvent, useState } from 'react';

import type { TreeColors } from '../../tree/treeFragment';

export interface GutterLegendProps {
	colors: TreeColors;
	/** Gutter column width in px (matches `--tree-graph-width`). */
	width: number;
}

/** One legend row: a rendered swatch plus the state it signifies. */
interface LegendEntry {
	key: string;
	label: string;
	swatch: JSX.Element;
}

const SWATCH_W = 22;
const SWATCH_H = 12;
const MID_Y = SWATCH_H / 2;

function lineSwatch(color: string, dashed: boolean): JSX.Element {
	return (
		<svg className="gutter-legend-swatch" width={SWATCH_W} height={SWATCH_H} aria-hidden="true">
			<line
				x1={2}
				y1={MID_Y}
				x2={SWATCH_W - 2}
				y2={MID_Y}
				stroke={color}
				strokeWidth={1.5}
				strokeLinecap="round"
				strokeDasharray={dashed ? '3 2' : undefined}
			/>
		</svg>
	);
}

function currentNodeSwatch(color: string, bg: string): JSX.Element {
	return (
		<svg className="gutter-legend-swatch" width={SWATCH_W} height={SWATCH_H} aria-hidden="true">
			<circle cx={SWATCH_W / 2} cy={MID_Y} r={4} fill={bg} stroke={color} strokeWidth={2} />
		</svg>
	);
}

function outOfIntegrationSwatch(line: string): JSX.Element {
	const cx = SWATCH_W / 2;
	const d = 4;
	return (
		<svg className="gutter-legend-swatch" width={SWATCH_W} height={SWATCH_H} aria-hidden="true">
			<line
				x1={cx - d}
				y1={MID_Y - d}
				x2={cx + d}
				y2={MID_Y + d}
				stroke={line}
				strokeWidth={1.25}
				strokeLinecap="round"
			/>
			<line
				x1={cx - d}
				y1={MID_Y + d}
				x2={cx + d}
				y2={MID_Y - d}
				stroke={line}
				strokeWidth={1.25}
				strokeLinecap="round"
			/>
		</svg>
	);
}

function buildEntries(colors: TreeColors): LegendEntry[] {
	return [
		{ key: 'lane', label: 'Branch lane', swatch: lineSwatch(colors.line, false) },
		{ key: 'current', label: 'Current branch', swatch: currentNodeSwatch(colors.nodeCurrent, colors.bg) },
		{ key: 'restack', label: 'Needs restack / rebuild', swatch: lineSwatch(colors.restack, true) },
		{ key: 'out', label: 'Excluded from integration', swatch: outOfIntegrationSwatch(colors.line) },
	];
}

export function GutterLegend({ colors, width }: GutterLegendProps): JSX.Element {
	const entries = buildEntries(colors);
	// Hover reveals the popover via CSS. Click/Enter/Space *pins* it open so
	// keyboard and touch users — who can't hover — can read it too.
	const [pinned, setPinned] = useState(false);
	const toggle = (): void => setPinned((open) => !open);
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		toggle();
	};
	return (
		<div
			className={`gutter-legend${pinned ? ' is-open' : ''}`}
			style={{ width: `${width}px` }}
			tabIndex={0}
			role="button"
			aria-label="Swimlane gutter color legend"
			aria-expanded={pinned}
			onClick={toggle}
			onKeyDown={onKeyDown}
		>
			<div className="gutter-legend-popover" role="tooltip">
				<div className="gutter-legend-title">Gutter legend</div>
				{entries.map((entry) => (
					<div className="gutter-legend-row" key={entry.key}>
						{entry.swatch}
						<span className="gutter-legend-label">{entry.label}</span>
					</div>
				))}
			</div>
		</div>
	);
}
