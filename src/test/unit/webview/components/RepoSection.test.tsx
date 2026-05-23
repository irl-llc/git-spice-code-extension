/**
 * Component tests for RepoSection.tsx.
 *
 * Covers the structural contract (toolbar with 3 actions, slots for
 * branch-list / error / empty, header click toggles), the expanded
 * default, and each toolbar action's outbound message.
 */

// MUST be first — installs JSDOM globals before testing-library imports.
import { installJsdomGlobals } from '../reactTestHelper';

import * as assert from 'assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { RepoSection, type RepoSectionProps } from '../../../../stackView/webview/components/RepoSection';
import type { WebviewMessage } from '../../../../stackView/webviewTypes';

const REPO_ID = '/path/to/repo';
const REPO_NAME = 'my-repo';

interface Harness {
	props: RepoSectionProps;
	messages: WebviewMessage[];
	classToggles: Array<[string, boolean]>;
}

function harness(): Harness {
	const messages: WebviewMessage[] = [];
	const classToggles: Array<[string, boolean]> = [];
	const props: RepoSectionProps = {
		repoId: REPO_ID,
		repoName: REPO_NAME,
		postMessage: (m) => messages.push(m),
		setSectionClass: (cls, on) => classToggles.push([cls, on]),
	};
	return { props, messages, classToggles };
}

describe('RepoSection', () => {
	beforeEach(installJsdomGlobals);
	afterEach(cleanup);

	it('renders the repo name', () => {
		const h = harness();
		render(<RepoSection {...h.props} />);
		assert.ok(screen.getByText(REPO_NAME));
	});

	it('renders 3 toolbar action buttons with the right outbound types', () => {
		const h = harness();
		render(<RepoSection {...h.props} />);
		fireEvent.click(screen.getByRole('button', { name: /restack stack for my-repo/i }));
		fireEvent.click(screen.getByRole('button', { name: /sync repository for my-repo/i }));
		fireEvent.click(screen.getByRole('button', { name: /submit stack for my-repo/i }));
		assert.deepStrictEqual(h.messages, [
			{ type: 'stackRestack', repoId: REPO_ID },
			{ type: 'repoSync', repoId: REPO_ID },
			{ type: 'stackSubmit', repoId: REPO_ID },
		]);
	});

	it('toolbar button clicks do NOT toggle the section', () => {
		const h = harness();
		render(<RepoSection {...h.props} />);
		// First effect fires with expanded=true.
		assert.deepStrictEqual(h.classToggles, [['expanded', true]]);
		fireEvent.click(screen.getByRole('button', { name: /restack stack for my-repo/i }));
		// Only the initial toggle should be present.
		assert.deepStrictEqual(h.classToggles, [['expanded', true]]);
	});

	it('clicking the header (not the toolbar) toggles expanded class', () => {
		const h = harness();
		const { container } = render(<RepoSection {...h.props} />);
		const header = container.querySelector('.repo-header') as HTMLElement;
		fireEvent.click(header);
		assert.deepStrictEqual(h.classToggles, [
			['expanded', true],
			['expanded', false],
		]);
		fireEvent.click(header);
		assert.deepStrictEqual(h.classToggles, [
			['expanded', true],
			['expanded', false],
			['expanded', true],
		]);
	});

	it('chevron icon flips between down/right based on expanded state', () => {
		const h = harness();
		const { container } = render(<RepoSection {...h.props} />);
		const chevron = container.querySelector('.repo-toggle')!;
		assert.ok(chevron.classList.contains('codicon-chevron-down'));
		fireEvent.click(container.querySelector('.repo-header') as HTMLElement);
		assert.ok(chevron.classList.contains('codicon-chevron-right'));
	});

	it('renders the slot elements (branch list, error, empty) with the expected roles/classes', () => {
		const h = harness();
		const { container } = render(<RepoSection {...h.props} />);
		assert.ok(container.querySelector('.repo-branch-list.stack-list'), 'branch list slot');
		assert.ok(container.querySelector('[data-role="repo-error"]'), 'error slot');
		assert.ok(container.querySelector('[data-role="repo-empty"]'), 'empty slot');
	});
});
