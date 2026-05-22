/**
 * Component tests for UntrackedCard.tsx.
 *
 * Codifies the contract: shows the branch name, an Untracked badge, a
 * current-branch icon, and a "Track Branch" button that invokes onTrack.
 * Supersedes the imperative renderer's DOM-structure tests with semantic
 * accessible-role assertions.
 */

// MUST be first — installs JSDOM globals before testing-library imports.
import { installJsdomGlobals } from '../reactTestHelper';

import * as assert from 'assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { UntrackedCard } from '../../../../stackView/webview/components/UntrackedCard';

const BRANCH_NAME = 'feat/my-feature';

describe('UntrackedCard', () => {
	beforeEach(installJsdomGlobals);
	afterEach(cleanup);

	it('displays the branch name', () => {
		render(<UntrackedCard branchName={BRANCH_NAME} onTrack={() => undefined} />);
		assert.ok(screen.getByText(BRANCH_NAME), 'branch name visible');
	});

	it('displays the Untracked badge', () => {
		render(<UntrackedCard branchName={BRANCH_NAME} onTrack={() => undefined} />);
		assert.ok(screen.getByText('Untracked'), 'badge visible');
	});

	it('exposes the current-branch state via aria-label on the icon', () => {
		render(<UntrackedCard branchName={BRANCH_NAME} onTrack={() => undefined} />);
		// The check icon is decorative for sighted users but labelled for screen readers.
		assert.ok(screen.getByLabelText('Current branch'), 'current branch icon labelled');
	});

	it('clicking "Track Branch" fires onTrack exactly once', () => {
		let calls = 0;
		render(<UntrackedCard branchName={BRANCH_NAME} onTrack={() => calls++} />);
		fireEvent.click(screen.getByRole('button', { name: new RegExp(`track ${BRANCH_NAME} with git-spice`, 'i') }));
		assert.strictEqual(calls, 1);
	});

	it('shows the helper hint text', () => {
		render(<UntrackedCard branchName={BRANCH_NAME} onTrack={() => undefined} />);
		assert.ok(screen.getByText(/not tracked by git-spice/i), 'hint visible');
	});
});
