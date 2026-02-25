/**
 * Unit tests for repoSectionRenderer.
 * Verifies DOM structure, codicon classes, toolbar buttons, and message wiring.
 */

import * as assert from 'assert';

import { setupDom, teardownDom } from './domTestHelper';
import {
	renderRepoSection,
	getBranchList,
	getErrorElement,
	getEmptyElement,
} from '../../../stackView/webview/repoSectionRenderer';
import type { WebviewMessage } from '../../../stackView/webviewTypes';

describe('repoSectionRenderer', () => {
	before(() => setupDom());
	after(() => teardownDom());

	describe('renderRepoSection', () => {
		const REPO_ID = '/path/to/repo';
		const REPO_NAME = 'my-repo';

		function renderWithSpy(): { section: HTMLElement; messages: WebviewMessage[] } {
			const messages: WebviewMessage[] = [];
			const section = renderRepoSection(REPO_ID, REPO_NAME, (msg) => messages.push(msg));
			return { section, messages };
		}

		it('should create a section with correct class and data attribute', () => {
			const { section } = renderWithSpy();
			assert.ok(section.classList.contains('repo-section'));
			assert.ok(section.classList.contains('expanded'));
			assert.strictEqual(section.dataset.repoId, REPO_ID);
		});

		it('should contain a repo header with icon, name, toolbar, and toggle', () => {
			const { section } = renderWithSpy();
			const header = section.querySelector('.repo-header');
			assert.ok(header, 'header should exist');

			const icon = header!.querySelector('.codicon.codicon-repo');
			assert.ok(icon, 'repo icon should exist with codicon-repo class');

			const name = header!.querySelector('.repo-name');
			assert.ok(name, 'name span should exist');
			assert.strictEqual(name!.textContent, REPO_NAME);

			const toggle = header!.querySelector('.repo-toggle');
			assert.ok(toggle, 'toggle chevron should exist');
			assert.ok(toggle!.classList.contains('codicon-chevron-down'));
		});

		it('should render toolbar with 3 action buttons', () => {
			const { section } = renderWithSpy();
			const toolbar = section.querySelector('.repo-toolbar');
			assert.ok(toolbar, 'toolbar should exist');

			const buttons = toolbar!.querySelectorAll('.repo-action-btn');
			assert.strictEqual(buttons.length, 3);
		});

		it('should render toolbar buttons with correct codicon classes', () => {
			const { section } = renderWithSpy();
			const toolbar = section.querySelector('.repo-toolbar')!;

			const expectedIcons = ['codicon-layers', 'codicon-sync', 'codicon-cloud-upload'];
			const buttons = toolbar.querySelectorAll('.repo-action-btn');

			for (let i = 0; i < expectedIcons.length; i++) {
				const icon = buttons[i].querySelector(`.codicon.${expectedIcons[i]}`);
				assert.ok(icon, `button ${i} should have ${expectedIcons[i]} icon`);
			}
		});

		it('should send correct messages when toolbar buttons are clicked', () => {
			const { section, messages } = renderWithSpy();
			const buttons = section.querySelectorAll('.repo-action-btn');

			(buttons[0] as HTMLElement).click();
			(buttons[1] as HTMLElement).click();
			(buttons[2] as HTMLElement).click();

			assert.strictEqual(messages.length, 3);
			assert.strictEqual(messages[0].type, 'stackRestack');
			assert.strictEqual(messages[1].type, 'repoSync');
			assert.strictEqual(messages[2].type, 'stackSubmit');
		});

		it('should include repoId in toolbar button messages', () => {
			const { section, messages } = renderWithSpy();
			const buttons = section.querySelectorAll('.repo-action-btn');

			(buttons[0] as HTMLElement).click();

			const msg = messages[0] as { type: string; repoId?: string };
			assert.strictEqual(msg.repoId, REPO_ID);
		});
	});

	describe('section accessors', () => {
		it('should return branch list element via getBranchList', () => {
			const section = renderRepoSection('/repo', 'repo', () => {});
			const list = getBranchList(section);
			assert.ok(list);
			assert.ok(list.classList.contains('repo-branch-list'));
			assert.ok(list.classList.contains('stack-list'));
		});

		it('should return error element via getErrorElement', () => {
			const section = renderRepoSection('/repo', 'repo', () => {});
			const error = getErrorElement(section);
			assert.ok(error);
			assert.strictEqual(error.dataset.role, 'repo-error');
		});

		it('should return empty element via getEmptyElement', () => {
			const section = renderRepoSection('/repo', 'repo', () => {});
			const empty = getEmptyElement(section);
			assert.ok(empty);
			assert.strictEqual(empty.dataset.role, 'repo-empty');
		});
	});
});
