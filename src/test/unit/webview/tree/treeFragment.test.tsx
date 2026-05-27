/**
 * Unit tests for the TreeFragmentSvg JSX component.
 *
 * Asserts structural invariants of the rendered SVG: number of
 * `<line>` elements per lane configuration, node circle radius and
 * stroke per nodeStyle, dash attributes for restack / uncommitted
 * states. Fast feedback before the slower Playwright snapshot run.
 */

// MUST be first — installs JSDOM globals before testing-library imports.
import { installJsdomGlobals } from '../reactTestHelper';

import * as assert from 'assert';
import { cleanup, render } from '@testing-library/react';

import { TreeFragmentSvg, type TreeColors } from '../../../../stackView/tree/treeFragment';
import type { ChildForkStyle, LaneSegment, TreeFragmentData } from '../../../../stackView/types';
import { NODE_RADIUS, NODE_RADIUS_CURRENT } from '../../../../stackView/tree/treeConstants';

const COLORS: TreeColors = {
	line: '#888888',
	node: '#888888',
	nodeCurrent: '#3794ff',
	restack: '#cca700',
	bg: '#1e1e1e',
};

function makeLane(overrides?: Partial<LaneSegment>): LaneSegment {
	return {
		continuesFromAbove: false,
		continuesBelow: false,
		hasNode: false,
		needsRestack: false,
		...overrides,
	};
}

function makeFork(overrides?: Partial<ChildForkStyle>): ChildForkStyle {
	return { lane: 0, needsRestack: false, isUncommitted: false, ...overrides };
}

function makeFragment(overrides?: Partial<TreeFragmentData>): TreeFragmentData {
	return {
		lanes: [makeLane({ hasNode: true })],
		maxLane: 0,
		nodeLane: 0,
		childForkLanes: [],
		nodeStyle: 'normal',
		nodeNeedsRestack: false,
		...overrides,
	};
}

function svgFrom(container: HTMLElement): SVGSVGElement {
	const svg = container.querySelector('svg.tree-fragment-svg');
	assert.ok(svg, 'svg.tree-fragment-svg should be present');
	return svg as unknown as SVGSVGElement;
}

describe('TreeFragmentSvg', () => {
	beforeEach(installJsdomGlobals);
	afterEach(cleanup);

	describe('container', () => {
		it('renders an svg with the tree-fragment-svg class and width attribute', () => {
			const fragment = makeFragment({ maxLane: 2 });
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			const svg = svgFrom(container);
			assert.ok(svg.getAttribute('width'), 'width attribute set');
		});
	});

	describe('node circle', () => {
		it('renders a small filled circle for normal style', () => {
			const fragment = makeFragment({ nodeStyle: 'normal' });
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			const circle = svgFrom(container).querySelector('circle')!;
			assert.strictEqual(circle.getAttribute('r'), String(NODE_RADIUS));
			assert.strictEqual(circle.getAttribute('fill'), COLORS.node);
			assert.strictEqual(circle.getAttribute('stroke'), null);
		});

		it('uses restack color when nodeNeedsRestack is true (normal style)', () => {
			const fragment = makeFragment({ nodeStyle: 'normal', nodeNeedsRestack: true });
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			const circle = svgFrom(container).querySelector('circle')!;
			assert.strictEqual(circle.getAttribute('fill'), COLORS.restack);
		});

		it('renders a hollow stroked circle for current style', () => {
			const fragment = makeFragment({ nodeStyle: 'current' });
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			const circle = svgFrom(container).querySelector('circle')!;
			assert.strictEqual(circle.getAttribute('r'), String(NODE_RADIUS_CURRENT));
			assert.strictEqual(circle.getAttribute('fill'), COLORS.bg);
			assert.strictEqual(circle.getAttribute('stroke'), COLORS.nodeCurrent);
		});

		it('renders a dashed hollow circle for uncommitted style', () => {
			const fragment = makeFragment({ nodeStyle: 'uncommitted' });
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			const circle = svgFrom(container).querySelector('circle')!;
			assert.strictEqual(circle.getAttribute('r'), String(NODE_RADIUS_CURRENT));
			assert.strictEqual(circle.getAttribute('stroke-dasharray'), '3 2');
		});
	});

	describe('lane segments', () => {
		it('emits no lines when the lane has no activity (continuesFrom/Below + hasNode all false)', () => {
			const fragment = makeFragment({
				lanes: [makeLane({ hasNode: true })],
			});
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			// hasNode without continuesFromAbove or continuesBelow → no <line> elements
			assert.strictEqual(svgFrom(container).querySelectorAll('line').length, 0);
		});

		it('emits a top segment when continuesFromAbove is true', () => {
			const fragment = makeFragment({
				lanes: [makeLane({ hasNode: true, continuesFromAbove: true })],
			});
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			assert.strictEqual(svgFrom(container).querySelectorAll('line').length, 1);
		});

		it('emits both top and bottom segments when both continues flags are set', () => {
			const fragment = makeFragment({
				lanes: [makeLane({ hasNode: true, continuesFromAbove: true, continuesBelow: true })],
			});
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			assert.strictEqual(svgFrom(container).querySelectorAll('line').length, 2);
		});

		it('uses restack color and dash for needsRestack segments', () => {
			const fragment = makeFragment({
				lanes: [makeLane({ hasNode: true, continuesFromAbove: true, needsRestack: true })],
			});
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			const line = svgFrom(container).querySelector('line')!;
			assert.strictEqual(line.getAttribute('stroke'), COLORS.restack);
			assert.strictEqual(line.getAttribute('stroke-dasharray'), '3 2');
		});

		it('uses dashed lines at the uncommitted node lane (but only at hasNode segments)', () => {
			const fragment = makeFragment({
				nodeStyle: 'uncommitted',
				lanes: [makeLane({ hasNode: true, continuesFromAbove: true })],
			});
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			const line = svgFrom(container).querySelector('line')!;
			assert.strictEqual(line.getAttribute('stroke-dasharray'), '3 2');
		});
	});

	describe('child fork connectors', () => {
		it('emits no fork elements when childForkLanes is empty', () => {
			const fragment = makeFragment({ childForkLanes: [] });
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			assert.strictEqual(svgFrom(container).querySelectorAll('path').length, 0);
		});

		it('emits 3 SVG elements (h-line + arc + v-line) per child fork', () => {
			const fragment = makeFragment({
				maxLane: 1,
				childForkLanes: [makeFork({ lane: 1 })],
				lanes: [makeLane({ hasNode: true }), makeLane()],
			});
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			const svg = svgFrom(container);
			assert.strictEqual(svg.querySelectorAll('path').length, 1, 'one arc <path> per fork');
			// The two new lines (horizontal + vertical) on top of any lane segments.
			assert.ok(svg.querySelectorAll('line').length >= 2);
		});

		it('uses dashed restack-colored strokes for needsRestack forks', () => {
			const fragment = makeFragment({
				maxLane: 1,
				childForkLanes: [makeFork({ lane: 1, needsRestack: true })],
				lanes: [makeLane({ hasNode: true }), makeLane()],
			});
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			const path = svgFrom(container).querySelector('path')!;
			assert.strictEqual(path.getAttribute('stroke'), COLORS.restack);
			assert.strictEqual(path.getAttribute('stroke-dasharray'), '3 2');
		});

		it('uses dashed accent-colored strokes for isUncommitted forks', () => {
			const fragment = makeFragment({
				maxLane: 1,
				childForkLanes: [makeFork({ lane: 1, isUncommitted: true })],
				lanes: [makeLane({ hasNode: true }), makeLane()],
			});
			const { container } = render(<TreeFragmentSvg fragment={fragment} colors={COLORS} />);
			const path = svgFrom(container).querySelector('path')!;
			assert.strictEqual(path.getAttribute('stroke'), COLORS.line);
			assert.strictEqual(path.getAttribute('stroke-dasharray'), '3 2');
		});
	});
});
