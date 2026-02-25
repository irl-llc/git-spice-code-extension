/**
 * Unit tests for untrackedCardRenderer.
 * Verifies DOM structure, codicon classes, badge, and track button wiring.
 */

import * as assert from 'assert';

import { setupDom, teardownDom } from './domTestHelper';
import { renderUntrackedCard } from '../../../stackView/webview/untrackedCardRenderer';
import type { WebviewMessage } from '../../../stackView/webviewTypes';

describe('untrackedCardRenderer', () => {
	before(() => setupDom());
	after(() => teardownDom());

	const BRANCH_NAME = 'feat/my-feature';

	function renderWithSpy(): { wrapper: HTMLElement; messages: WebviewMessage[] } {
		const messages: WebviewMessage[] = [];
		const wrapper = renderUntrackedCard(BRANCH_NAME, (msg) => messages.push(msg));
		return { wrapper, messages };
	}

	describe('renderUntrackedCard', () => {
		it('should create a wrapper with correct classes and data attribute', () => {
			const { wrapper } = renderWithSpy();
			assert.ok(wrapper.classList.contains('stack-item'));
			assert.ok(wrapper.classList.contains('untracked-item'));
			assert.strictEqual(wrapper.dataset.branch, BRANCH_NAME);
		});

		it('should contain a branch card with untracked class', () => {
			const { wrapper } = renderWithSpy();
			const card = wrapper.querySelector('.branch-card');
			assert.ok(card, 'branch card should exist');
			assert.ok(card!.classList.contains('untracked'));
		});

		it('should render current-branch checkmark icon', () => {
			const { wrapper } = renderWithSpy();
			const icon = wrapper.querySelector('.codicon.codicon-check.current-branch-icon');
			assert.ok(icon, 'should have codicon-check current branch icon');
		});

		it('should display the branch name', () => {
			const { wrapper } = renderWithSpy();
			const nameEl = wrapper.querySelector('.branch-name');
			assert.ok(nameEl);
			assert.strictEqual(nameEl!.textContent, BRANCH_NAME);
		});

		it('should display UNTRACKED badge', () => {
			const { wrapper } = renderWithSpy();
			const tag = wrapper.querySelector('.tag.tag-error');
			assert.ok(tag, 'should have error tag');
			assert.strictEqual(tag!.textContent, 'Untracked');
		});

		it('should render a track button with hint text', () => {
			const { wrapper } = renderWithSpy();
			const hint = wrapper.querySelector('.untracked-hint');
			assert.ok(hint, 'hint section should exist');

			const btn = hint!.querySelector('.untracked-track-btn');
			assert.ok(btn, 'track button should exist');
			assert.strictEqual(btn!.textContent, 'Track Branch');
		});

		it('should send branchTrack message when track button clicked', () => {
			const { wrapper, messages } = renderWithSpy();
			const btn = wrapper.querySelector('.untracked-track-btn') as HTMLElement;
			btn.click();

			assert.strictEqual(messages.length, 1);
			assert.strictEqual(messages[0].type, 'branchTrack');
			const msg = messages[0] as { type: string; branchName?: string };
			assert.strictEqual(msg.branchName, BRANCH_NAME);
		});
	});
});
