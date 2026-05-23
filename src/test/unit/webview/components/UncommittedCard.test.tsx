/**
 * Component tests for UncommittedCard.tsx.
 *
 * Covers the staged/unstaged section rendering, per-file action
 * buttons (stage/unstage/discard/open), commit form behavior
 * (disabled until message, Enter triggers create-branch), and the
 * section toggle contract.
 */

// MUST be first — installs JSDOM globals before testing-library imports.
import { installJsdomGlobals } from '../reactTestHelper';

import * as assert from 'assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { UncommittedCard, type UncommittedCardProps } from '../../../../stackView/webview/components/UncommittedCard';
import type { UncommittedState } from '../../../../stackView/types';

interface Harness {
	props: UncommittedCardProps;
	stageCalls: string[];
	unstageCalls: string[];
	discardCalls: string[];
	openFileCalls: string[];
	openDiffCalls: Array<[string, boolean, string]>;
	createBranchCalls: string[];
	commitCalls: string[];
	commitMessages: string[];
	toggleStagedCalls: number;
	toggleUnstagedCalls: number;
}

function makeProps(overrides: Partial<UncommittedCardProps> = {}): Harness {
	const stageCalls: string[] = [];
	const unstageCalls: string[] = [];
	const discardCalls: string[] = [];
	const openFileCalls: string[] = [];
	const openDiffCalls: Array<[string, boolean, string]> = [];
	const createBranchCalls: string[] = [];
	const commitCalls: string[] = [];
	const commitMessages: string[] = [];
	let toggleStagedCalls = 0;
	let toggleUnstagedCalls = 0;

	const uncommitted: UncommittedState = {
		staged: [{ path: 'src/foo.ts', status: 'M' }],
		unstaged: [{ path: 'src/bar.ts', status: 'A' }],
	};

	const props: UncommittedCardProps = {
		uncommitted,
		expandedStaged: true,
		expandedUnstaged: true,
		commitMessage: '',
		onToggleStaged: () => {
			toggleStagedCalls += 1;
		},
		onToggleUnstaged: () => {
			toggleUnstagedCalls += 1;
		},
		onCommitMessageChange: (v) => commitMessages.push(v),
		onStage: (p) => stageCalls.push(p),
		onUnstage: (p) => unstageCalls.push(p),
		onDiscard: (p) => discardCalls.push(p),
		onOpenFile: (p) => openFileCalls.push(p),
		onOpenDiff: (p, s, st) => openDiffCalls.push([p, s, st]),
		onCreateBranch: (m) => createBranchCalls.push(m),
		onCommit: (m) => commitCalls.push(m),
		...overrides,
	};

	return {
		props,
		stageCalls,
		unstageCalls,
		discardCalls,
		openFileCalls,
		openDiffCalls,
		createBranchCalls,
		commitCalls,
		commitMessages,
		get toggleStagedCalls() {
			return toggleStagedCalls;
		},
		get toggleUnstagedCalls() {
			return toggleUnstagedCalls;
		},
	};
}

describe('UncommittedCard', () => {
	beforeEach(installJsdomGlobals);
	afterEach(cleanup);

	describe('section rendering', () => {
		it('shows the "Uncommitted Changes" header', () => {
			const h = makeProps();
			render(<UncommittedCard {...h.props} />);
			assert.ok(screen.getByText('Uncommitted Changes'));
		});

		it('renders both Staged and Changes sections with their file counts', () => {
			const h = makeProps();
			render(<UncommittedCard {...h.props} />);
			assert.ok(screen.getByText('Staged Changes (1)'));
			assert.ok(screen.getByText('Changes (1)'));
		});

		it('hides empty sections', () => {
			const h = makeProps({
				uncommitted: { staged: [], unstaged: [{ path: 'src/x.ts', status: 'M' }] },
			});
			render(<UncommittedCard {...h.props} />);
			assert.strictEqual(screen.queryByText(/Staged Changes/), null);
			assert.ok(screen.getByText('Changes (1)'));
		});

		it('section chevron has aria-expanded matching state and fires onToggle on click', () => {
			const h = makeProps({ expandedStaged: false });
			render(<UncommittedCard {...h.props} />);
			const toggle = screen.getByRole('button', { name: /expand staged changes \(1\)/i });
			assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
			fireEvent.click(toggle);
			assert.strictEqual(h.toggleStagedCalls, 1);
			assert.strictEqual(h.toggleUnstagedCalls, 0);
		});
	});

	describe('file row actions', () => {
		it('staged row has an Unstage button that fires onUnstage', () => {
			const h = makeProps();
			render(<UncommittedCard {...h.props} />);
			fireEvent.click(screen.getByRole('button', { name: /unstage src\/foo\.ts/i }));
			assert.deepStrictEqual(h.unstageCalls, ['src/foo.ts']);
		});

		it('unstaged row has Stage and Discard buttons that fire the right callbacks', () => {
			const h = makeProps();
			render(<UncommittedCard {...h.props} />);
			fireEvent.click(screen.getByRole('button', { name: /^stage src\/bar\.ts$/i }));
			fireEvent.click(screen.getByRole('button', { name: /discard changes to src\/bar\.ts/i }));
			assert.deepStrictEqual(h.stageCalls, ['src/bar.ts']);
			assert.deepStrictEqual(h.discardCalls, ['src/bar.ts']);
		});

		it('rows have an Open File button for non-deleted files', () => {
			const h = makeProps();
			render(<UncommittedCard {...h.props} />);
			fireEvent.click(screen.getByRole('button', { name: /open file src\/foo\.ts/i }));
			assert.deepStrictEqual(h.openFileCalls, ['src/foo.ts']);
		});

		it('does NOT render an Open File button for deleted files', () => {
			const h = makeProps({
				uncommitted: { staged: [{ path: 'src/gone.ts', status: 'D' }], unstaged: [] },
			});
			render(<UncommittedCard {...h.props} />);
			assert.strictEqual(screen.queryByRole('button', { name: /open file src\/gone\.ts/i }), null);
		});

		it('clicking the row (not a button) fires onOpenDiff with path/staged/status', () => {
			const h = makeProps();
			const { container } = render(<UncommittedCard {...h.props} />);
			const rows = container.querySelectorAll('.file-change');
			fireEvent.click(rows[0]); // staged row
			fireEvent.click(rows[1]); // unstaged row
			assert.deepStrictEqual(h.openDiffCalls, [
				['src/foo.ts', true, 'M'],
				['src/bar.ts', false, 'A'],
			]);
		});
	});

	describe('commit form', () => {
		it('buttons are disabled when the message is empty', () => {
			const h = makeProps();
			render(<UncommittedCard {...h.props} />);
			const createBtn = screen.getByRole('button', { name: /create new branch/i }) as HTMLButtonElement;
			const commitBtn = screen.getByRole('button', {
				name: /add this commit to the current branch/i,
			}) as HTMLButtonElement;
			assert.strictEqual(createBtn.disabled, true);
			assert.strictEqual(commitBtn.disabled, true);
		});

		it('typing in the input fires onCommitMessageChange for each keystroke', () => {
			const h = makeProps();
			render(<UncommittedCard {...h.props} />);
			fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'feat: x' } });
			assert.deepStrictEqual(h.commitMessages, ['feat: x']);
		});

		it('buttons become enabled when message is non-blank', () => {
			const h = makeProps({ commitMessage: 'feat: y' });
			render(<UncommittedCard {...h.props} />);
			const createBtn = screen.getByRole('button', { name: /create new branch/i }) as HTMLButtonElement;
			const commitBtn = screen.getByRole('button', {
				name: /add this commit to the current branch/i,
			}) as HTMLButtonElement;
			assert.strictEqual(createBtn.disabled, false);
			assert.strictEqual(commitBtn.disabled, false);
		});

		it('clicking "Create new branch" fires onCreateBranch with trimmed message', () => {
			const h = makeProps({ commitMessage: '  feat: z  ' });
			render(<UncommittedCard {...h.props} />);
			fireEvent.click(screen.getByRole('button', { name: /create new branch/i }));
			assert.deepStrictEqual(h.createBranchCalls, ['feat: z']);
		});

		it('clicking "Add to current branch" fires onCommit with trimmed message', () => {
			const h = makeProps({ commitMessage: 'fix: bug' });
			render(<UncommittedCard {...h.props} />);
			fireEvent.click(screen.getByRole('button', { name: /add this commit to the current branch/i }));
			assert.deepStrictEqual(h.commitCalls, ['fix: bug']);
		});

		it('pressing Enter in the input fires onCreateBranch', () => {
			const h = makeProps({ commitMessage: 'feat: q' });
			render(<UncommittedCard {...h.props} />);
			const input = screen.getByLabelText('Commit message');
			fireEvent.keyDown(input, { key: 'Enter' });
			assert.deepStrictEqual(h.createBranchCalls, ['feat: q']);
		});

		it('whitespace-only messages do not enable the buttons', () => {
			const h = makeProps({ commitMessage: '   ' });
			render(<UncommittedCard {...h.props} />);
			const createBtn = screen.getByRole('button', { name: /create new branch/i }) as HTMLButtonElement;
			assert.strictEqual(createBtn.disabled, true);
		});
	});
});
