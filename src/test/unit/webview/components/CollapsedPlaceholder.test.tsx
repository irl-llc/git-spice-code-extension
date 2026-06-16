/**
 * Component tests for CollapsedPlaceholder.tsx (issue #66).
 *
 * Codifies the contract: shows a count summary ("N subtrees / M branches" with
 * correct pluralization), an [+] expand button labelled for screen readers, and
 * invokes onExpand with the placeholder's collapse roots when [+] is clicked.
 */

// MUST be first — installs JSDOM globals before testing-library imports.
import { installJsdomGlobals } from '../reactTestHelper';

import * as assert from 'assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { CollapsedPlaceholder } from '../../../../stackView/webview/components/CollapsedPlaceholder';
import type { CollapsedPlaceholderViewModel } from '../../../../stackView/types';

const TREE_FRAGMENT = {
	lanes: [],
	maxLane: 0,
	nodeLane: 0,
	childForkLanes: [],
	nodeStyle: 'placeholder' as const,
	nodeNeedsRestack: false,
};

function makeVm(overrides: Partial<CollapsedPlaceholderViewModel>): CollapsedPlaceholderViewModel {
	return {
		roots: ['feat-a'],
		subtreeCount: 1,
		branchCount: 2,
		treeFragment: TREE_FRAGMENT,
		...overrides,
	};
}

describe('CollapsedPlaceholder', () => {
	beforeEach(installJsdomGlobals);
	afterEach(cleanup);

	it('summarizes a single subtree with multiple branches', () => {
		render(
			<CollapsedPlaceholder placeholder={makeVm({ subtreeCount: 1, branchCount: 2 })} onExpand={() => undefined} />,
		);
		// "branch" is sibilant: pluralizes to "branches", not "branchs".
		assert.ok(screen.getByText('1 subtree / 2 branches'), 'label reads "1 subtree / 2 branches"');
	});

	it('pluralizes multiple subtrees and a single branch', () => {
		render(
			<CollapsedPlaceholder placeholder={makeVm({ subtreeCount: 2, branchCount: 1 })} onExpand={() => undefined} />,
		);
		assert.ok(screen.getByText('2 subtrees / 1 branch'), 'label reads "2 subtrees / 1 branch"');
	});

	it('labels the expand button with the summary for screen readers', () => {
		render(
			<CollapsedPlaceholder placeholder={makeVm({ subtreeCount: 1, branchCount: 2 })} onExpand={() => undefined} />,
		);
		assert.ok(screen.getByLabelText('Expand 1 subtree / 2 branches'), 'expand button is labelled');
	});

	it('clicking [+] invokes onExpand with the placeholder roots', () => {
		const calls: string[][] = [];
		const roots = ['feat-a', 'feat-x'];
		render(<CollapsedPlaceholder placeholder={makeVm({ roots })} onExpand={(r) => calls.push(r)} />);
		fireEvent.click(screen.getByLabelText(/^Expand /));
		assert.deepStrictEqual(calls, [roots], 'onExpand fired once with the roots');
	});
});
