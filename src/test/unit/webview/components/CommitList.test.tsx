/**
 * Component tests for CommitList.tsx.
 *
 * Covers paginated rendering, chevron-toggle vs row-click contract,
 * file-list expansion states (loading/empty/populated), and the
 * "Show more" pagination control.
 */

// MUST be first — installs JSDOM globals before testing-library imports.
import { installJsdomGlobals } from '../reactTestHelper';

import * as assert from 'assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { CommitList, type CommitListProps } from '../../../../stackView/webview/components/CommitList';
import type { BranchCommitViewModel, CommitFileChange } from '../../../../stackView/types';

const BRANCH = 'feat-a';

function makeCommits(n: number): BranchCommitViewModel[] {
	return Array.from({ length: n }, (_, i) => ({
		sha: `sha${i}`,
		shortSha: `sha${i}`.slice(0, 7),
		subject: `commit ${i}`,
	}));
}

interface Harness {
	props: CommitListProps;
	toggleCalls: string[];
	openDiffCalls: string[];
	openFileDiffCalls: Array<[string, string]>;
	openCurrentFileCalls: string[];
}

function makeProps(overrides: Partial<CommitListProps> = {}): Harness {
	const toggleCalls: string[] = [];
	const openDiffCalls: string[] = [];
	const openFileDiffCalls: Array<[string, string]> = [];
	const openCurrentFileCalls: string[] = [];
	const props: CommitListProps = {
		branchName: BRANCH,
		commits: makeCommits(3),
		expandedShas: new Set(),
		fileCache: new Map(),
		onToggle: (sha) => toggleCalls.push(sha),
		onOpenCommitDiff: (sha) => openDiffCalls.push(sha),
		onOpenFileDiff: (sha, path) => openFileDiffCalls.push([sha, path]),
		onOpenCurrentFile: (path) => openCurrentFileCalls.push(path),
		...overrides,
	};
	return { props, toggleCalls, openDiffCalls, openFileDiffCalls, openCurrentFileCalls };
}

describe('CommitList', () => {
	beforeEach(installJsdomGlobals);
	afterEach(cleanup);

	describe('rendering', () => {
		it('renders one row per commit, showing subjects', () => {
			const { props } = makeProps();
			render(<CommitList {...props} />);
			assert.ok(screen.getByText('commit 0'));
			assert.ok(screen.getByText('commit 1'));
			assert.ok(screen.getByText('commit 2'));
		});

		it('caps initial display at COMMIT_RENDER_CHUNK_SIZE (10) and shows a Show More button beyond that', () => {
			const { props } = makeProps({ commits: makeCommits(15) });
			render(<CommitList {...props} />);
			// First 10 visible.
			assert.ok(screen.getByText('commit 0'));
			assert.ok(screen.getByText('commit 9'));
			assert.strictEqual(screen.queryByText('commit 10'), null);
			// "Show more" button reveals the remaining 5.
			const more = screen.getByRole('button', { name: /show 5 more commits/i });
			assert.ok(more);
		});

		it('clicking Show More expands the visible window', () => {
			const { props } = makeProps({ commits: makeCommits(15) });
			render(<CommitList {...props} />);
			fireEvent.click(screen.getByRole('button', { name: /show 5 more commits/i }));
			assert.ok(screen.getByText('commit 14'));
		});
	});

	describe('commit row interaction', () => {
		it('clicking a commit row away from any button fires onOpenCommitDiff with the sha', () => {
			const { props, openDiffCalls } = makeProps();
			const { container } = render(<CommitList {...props} />);
			const rows = container.querySelectorAll('.commit-item');
			fireEvent.click(rows[1]); // click on commit 1's row body
			assert.deepStrictEqual(openDiffCalls, ['sha1']);
		});

		it('clicking the chevron fires onToggle, not onOpenCommitDiff', () => {
			const { props, toggleCalls, openDiffCalls } = makeProps();
			render(<CommitList {...props} />);
			fireEvent.click(screen.getByRole('button', { name: /expand file list for commit sha1/i }));
			assert.deepStrictEqual(toggleCalls, ['sha1']);
			assert.deepStrictEqual(openDiffCalls, []);
		});

		it('chevron aria-expanded mirrors expandedShas', () => {
			const { props } = makeProps({ expandedShas: new Set(['sha0']) });
			render(<CommitList {...props} />);
			const collapsed = screen.getByRole('button', { name: /expand file list for commit sha1/i });
			assert.strictEqual(collapsed.getAttribute('aria-expanded'), 'false');
			const expanded = screen.getByRole('button', { name: /collapse file list for commit sha0/i });
			assert.strictEqual(expanded.getAttribute('aria-expanded'), 'true');
		});
	});

	describe('file list rendering', () => {
		it('shows "Loading..." when a commit is expanded but files are undefined', () => {
			const { props } = makeProps({ expandedShas: new Set(['sha0']) });
			render(<CommitList {...props} />);
			assert.ok(screen.getByText('Loading...'));
		});

		it('shows "No files changed" when expanded and files is empty', () => {
			const { props } = makeProps({
				expandedShas: new Set(['sha0']),
				fileCache: new Map([['sha0', []]]),
			});
			render(<CommitList {...props} />);
			assert.ok(screen.getByText('No files changed'));
		});

		it('renders one row per file when expanded with files', () => {
			const files: CommitFileChange[] = [
				{ path: 'src/foo.ts', status: 'M' },
				{ path: 'src/bar.ts', status: 'A' },
			];
			const { props } = makeProps({
				expandedShas: new Set(['sha0']),
				fileCache: new Map([['sha0', files]]),
			});
			render(<CommitList {...props} />);
			assert.ok(screen.getByText('foo.ts'));
			assert.ok(screen.getByText('bar.ts'));
		});

		it('clicking a file row fires onOpenFileDiff with the commit sha and path', () => {
			const files: CommitFileChange[] = [{ path: 'src/foo.ts', status: 'M' }];
			const { props, openFileDiffCalls } = makeProps({
				expandedShas: new Set(['sha0']),
				fileCache: new Map([['sha0', files]]),
			});
			render(<CommitList {...props} />);
			fireEvent.click(screen.getByRole('button', { name: /open diff for src\/foo\.ts/i }));
			assert.deepStrictEqual(openFileDiffCalls, [['sha0', 'src/foo.ts']]);
		});

		it('clicking the open-current-file action fires onOpenCurrentFile, not onOpenFileDiff', () => {
			const files: CommitFileChange[] = [{ path: 'src/foo.ts', status: 'M' }];
			const { props, openCurrentFileCalls, openFileDiffCalls } = makeProps({
				expandedShas: new Set(['sha0']),
				fileCache: new Map([['sha0', files]]),
			});
			render(<CommitList {...props} />);
			fireEvent.click(screen.getByRole('button', { name: /open current file src\/foo\.ts/i }));
			assert.deepStrictEqual(openCurrentFileCalls, ['src/foo.ts']);
			assert.deepStrictEqual(openFileDiffCalls, []);
		});

		it('does not render the open-current-file action for deleted files', () => {
			const files: CommitFileChange[] = [{ path: 'src/gone.ts', status: 'D' }];
			const { props } = makeProps({
				expandedShas: new Set(['sha0']),
				fileCache: new Map([['sha0', files]]),
			});
			render(<CommitList {...props} />);
			assert.strictEqual(screen.queryByRole('button', { name: /open current file src\/gone\.ts/i }), null);
		});
	});
});
