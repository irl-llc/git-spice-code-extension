/**
 * Component tests for GutterLegend.tsx (issue #79).
 *
 * Verifies the hover-tooltip legend renders one row per gutter color/state,
 * derives swatch colors from the passed TreeColors, sizes the hover strip to
 * the gutter width, and pins the popover open on click / Enter / Space for
 * keyboard and touch users.
 */

// MUST be first — installs JSDOM globals before testing-library imports.
import { installJsdomGlobals } from '../reactTestHelper';

import * as assert from 'assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { GutterLegend } from '../../../../stackView/webview/components/GutterLegend';
import type { TreeColors } from '../../../../stackView/tree/treeFragment';

const COLORS: TreeColors = {
	line: '#888888',
	node: '#888888',
	nodeCurrent: '#3794ff',
	restack: '#cca700',
	bg: '#1e1e1e',
};

describe('GutterLegend', () => {
	beforeEach(installJsdomGlobals);
	afterEach(cleanup);

	it('labels every gutter state', () => {
		render(<GutterLegend colors={COLORS} width={30} />);
		assert.ok(screen.getByText('Branch lane'));
		assert.ok(screen.getByText('Current branch'));
		assert.ok(screen.getByText('Needs restack / rebuild'));
		assert.ok(screen.getByText('Excluded from integration'));
	});

	it('renders one swatch per legend row', () => {
		const { container } = render(<GutterLegend colors={COLORS} width={30} />);
		assert.strictEqual(container.querySelectorAll('.gutter-legend-row').length, 4);
		assert.strictEqual(container.querySelectorAll('.gutter-legend-swatch').length, 4);
	});

	it('derives swatch colors from the passed TreeColors', () => {
		const { container } = render(<GutterLegend colors={COLORS} width={30} />);
		const strokes = Array.from(container.querySelectorAll('.gutter-legend-swatch [stroke]')).map((el) =>
			el.getAttribute('stroke'),
		);
		assert.ok(strokes.includes(COLORS.line), 'lane line uses colors.line');
		assert.ok(strokes.includes(COLORS.restack), 'restack swatch uses colors.restack');
		assert.ok(strokes.includes(COLORS.nodeCurrent), 'current-node swatch uses colors.nodeCurrent');
	});

	it('marks the needs-restack swatch dashed', () => {
		const { container } = render(<GutterLegend colors={COLORS} width={30} />);
		const restackLine = Array.from(container.querySelectorAll('.gutter-legend-swatch line')).find(
			(el) => el.getAttribute('stroke') === COLORS.restack,
		);
		assert.ok(restackLine, 'restack swatch line exists');
		assert.strictEqual(restackLine?.getAttribute('stroke-dasharray'), '3 2');
	});

	it('sizes the hover strip to the gutter width and exposes an accessible label', () => {
		const { container } = render(<GutterLegend colors={COLORS} width={42} />);
		const strip = container.querySelector('.gutter-legend') as HTMLElement | null;
		assert.ok(strip);
		assert.strictEqual(strip?.style.width, '42px');
		assert.strictEqual(strip?.getAttribute('aria-label'), 'Swimlane gutter color legend');
	});

	it('pins the popover open on click and toggles back closed', () => {
		const { container } = render(<GutterLegend colors={COLORS} width={30} />);
		const strip = container.querySelector('.gutter-legend') as HTMLElement;
		assert.strictEqual(strip.classList.contains('is-open'), false);
		assert.strictEqual(strip.getAttribute('aria-expanded'), 'false');
		fireEvent.click(strip);
		assert.strictEqual(strip.classList.contains('is-open'), true);
		assert.strictEqual(strip.getAttribute('aria-expanded'), 'true');
		fireEvent.click(strip);
		assert.strictEqual(strip.classList.contains('is-open'), false);
	});

	it('pins the popover open on Enter and Space', () => {
		const { container } = render(<GutterLegend colors={COLORS} width={30} />);
		const strip = container.querySelector('.gutter-legend') as HTMLElement;
		fireEvent.keyDown(strip, { key: 'Enter' });
		assert.strictEqual(strip.classList.contains('is-open'), true);
		fireEvent.keyDown(strip, { key: ' ' });
		assert.strictEqual(strip.classList.contains('is-open'), false);
	});
});
