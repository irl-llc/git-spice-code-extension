/**
 * Component tests for BranchSummary.tsx.
 *
 * Codifies the click contract: clicking the "Summarized Changes" label
 * must invoke onOpenDiff with the right branch; clicking the chevron
 * must invoke onToggle. This is the layer-1 test that catches click
 * wiring bugs without needing a real VS Code instance.
 */

// MUST be first — installs JSDOM globals before @testing-library/dom's
// import-time captures.
import { installJsdomGlobals } from '../reactTestHelper';

import * as assert from 'assert';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

import { BranchSummary, type BranchSummaryProps } from '../../../../stackView/webview/components/BranchSummary';
import type { CommitFileChange } from '../../../../stackView/types';

/** Builds a complete prop set with sinon-like spies, overridable per-test. */
function makeProps(overrides: Partial<BranchSummaryProps> = {}): {
	props: BranchSummaryProps;
	calls: {
		toggle: number;
		openDiff: number;
		openFileDiff: Array<[string, string]>;
		openCurrentFile: string[];
	};
} {
	const calls = {
		toggle: 0,
		openDiff: 0,
		openFileDiff: [] as Array<[string, string]>,
		openCurrentFile: [] as string[],
	};
	const props: BranchSummaryProps = {
		branchName: 'feat-1',
		expanded: false,
		files: undefined,
		onToggle: () => {
			calls.toggle += 1;
		},
		onOpenDiff: () => {
			calls.openDiff += 1;
		},
		onOpenFileDiff: (path, status) => {
			calls.openFileDiff.push([path, status]);
		},
		onOpenCurrentFile: (path) => {
			calls.openCurrentFile.push(path);
		},
		...overrides,
	};
	return { props, calls };
}

describe('BranchSummary', () => {
	beforeEach(installJsdomGlobals);
	afterEach(cleanup);

	describe('header click contract', () => {
		it('renders the "Summarized Changes" label', () => {
			const { props } = makeProps();
			render(<BranchSummary {...props} />);
			assert.ok(screen.getByText('Summarized Changes'), 'label visible');
		});

		it('clicking the label button fires onOpenDiff exactly once', () => {
			const { props, calls } = makeProps();
			render(<BranchSummary {...props} />);
			fireEvent.click(screen.getByRole('button', { name: /open changes view for feat-1/i }));
			assert.strictEqual(calls.openDiff, 1, 'openDiff called once');
			assert.strictEqual(calls.toggle, 0, 'toggle not called');
		});

		it('clicking the chevron toggle fires onToggle, not onOpenDiff', () => {
			const { props, calls } = makeProps();
			render(<BranchSummary {...props} />);
			fireEvent.click(screen.getByRole('button', { name: /expand summary for feat-1/i }));
			assert.strictEqual(calls.toggle, 1, 'toggle called once');
			assert.strictEqual(calls.openDiff, 0, 'openDiff not called');
		});

		it('chevron has aria-expanded matching the `expanded` prop', () => {
			const { props: collapsedProps } = makeProps({ expanded: false });
			const { unmount } = render(<BranchSummary {...collapsedProps} />);
			const collapsedToggle = screen.getByRole('button', { name: /expand summary/i });
			assert.strictEqual(collapsedToggle.getAttribute('aria-expanded'), 'false');
			unmount();

			const { props: expandedProps } = makeProps({ expanded: true });
			render(<BranchSummary {...expandedProps} />);
			const expandedToggle = screen.getByRole('button', { name: /collapse summary/i });
			assert.strictEqual(expandedToggle.getAttribute('aria-expanded'), 'true');
		});
	});

	describe('file list rendering', () => {
		it('shows "Loading..." when expanded and files is undefined', () => {
			const { props } = makeProps({ expanded: true, files: undefined });
			render(<BranchSummary {...props} />);
			assert.ok(screen.getByText('Loading...'), 'loading state visible');
		});

		it('shows "No files changed" when expanded and files is empty', () => {
			const { props } = makeProps({ expanded: true, files: [] });
			render(<BranchSummary {...props} />);
			assert.ok(screen.getByText('No files changed'), 'empty state visible');
		});

		it('renders one row per file when expanded with files', () => {
			const files: CommitFileChange[] = [
				{ path: 'src/foo.ts', status: 'M' },
				{ path: 'src/bar.ts', status: 'A' },
			];
			const { props } = makeProps({ expanded: true, files });
			render(<BranchSummary {...props} />);
			assert.ok(screen.getByText('foo.ts'), 'foo.ts visible');
			assert.ok(screen.getByText('bar.ts'), 'bar.ts visible');
		});

		it('clicking a file row fires onOpenFileDiff with path and status', () => {
			const files: CommitFileChange[] = [{ path: 'src/foo.ts', status: 'M' }];
			const { props, calls } = makeProps({ expanded: true, files });
			render(<BranchSummary {...props} />);
			fireEvent.click(screen.getByRole('button', { name: /open diff for src\/foo\.ts/i }));
			assert.deepStrictEqual(calls.openFileDiff, [['src/foo.ts', 'M']]);
			assert.strictEqual(calls.openCurrentFile.length, 0, 'openCurrentFile not called');
		});

		it('clicking the open-current-file action fires onOpenCurrentFile and not onOpenFileDiff', () => {
			const files: CommitFileChange[] = [{ path: 'src/foo.ts', status: 'M' }];
			const { props, calls } = makeProps({ expanded: true, files });
			render(<BranchSummary {...props} />);
			fireEvent.click(screen.getByRole('button', { name: /open current file src\/foo\.ts/i }));
			assert.deepStrictEqual(calls.openCurrentFile, ['src/foo.ts']);
			assert.strictEqual(calls.openFileDiff.length, 0, 'openFileDiff not called');
		});

		it('does not render the open-current-file action for deleted files', () => {
			const files: CommitFileChange[] = [{ path: 'src/gone.ts', status: 'D' }];
			const { props } = makeProps({ expanded: true, files });
			render(<BranchSummary {...props} />);
			assert.strictEqual(
				screen.queryByRole('button', { name: /open current file src\/gone\.ts/i }),
				null,
				'no open-current-file button for deleted files',
			);
		});

		it('hides the file list when collapsed', () => {
			const files: CommitFileChange[] = [{ path: 'src/foo.ts', status: 'M' }];
			const { props } = makeProps({ expanded: false, files });
			render(<BranchSummary {...props} />);
			assert.strictEqual(screen.queryByText('foo.ts'), null, 'foo.ts not in DOM when collapsed');
		});
	});
});
