/**
 * Behavioral test for the refresh-in-flight indicator (issue #37).
 *
 * The extension host posts a `refreshing` message to the webview when a
 * refresh begins and a `state` message when it completes. The webview
 * renders a thin top banner ("Refreshing…") for the duration so the user
 * gets visible feedback that the refresh button actually did something.
 *
 * This is intentionally NOT a screenshot test. The banner is a transient,
 * ANIMATED element (a spinning `codicon-loading` glyph), so a snapshot of it
 * is both timing-fragile and font-dependent — it does not reliably depict the
 * indicator and only causes confusion. Instead we assert the real DOM
 * contract directly:
 *   - active:  dispatching the host's `refreshing` message makes the banner
 *              appear (the real webview contract — a `window` message event,
 *              not a mock of business logic).
 *   - cleared: a real, file-watch-driven refresh re-fetches and posts fresh
 *              state, which removes the banner while the stack stays rendered.
 */

import { test, type Frame } from '@playwright/test';

import { createTempRepo, type WorkspaceRepo } from './fixtures/repo';
import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { openGitSpiceEditor } from './fixtures/webview';

const TRUNK = 'main';

/** Dispatches a host->webview message event into the frame, as the host does. */
async function postHostMessage(frame: Frame, message: unknown): Promise<void> {
	await frame.evaluate((m) => {
		window.dispatchEvent(new MessageEvent('message', { data: m }));
	}, message);
}

test.describe('refresh indicator', () => {
	let repo: WorkspaceRepo;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		repo = createTempRepo();
		repo.initTrunk(TRUNK);
		repo.createBranch({
			name: 'feat-a',
			base: TRUNK,
			commits: [{ message: 'add a', files: { 'a.txt': 'a\n' } }],
		});
		vscode = await launchVSCode(repo.path);
	});

	test.afterAll(async () => {
		await vscode?.close();
		repo?.cleanup();
	});

	test('shows the banner while refreshing and clears when a real refresh completes', async () => {
		const webview = await openGitSpiceEditor(vscode.workbench);
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 30_000 });

		// Active: dispatching `refreshing` makes the banner appear.
		await postHostMessage(webview, { type: 'refreshing' });
		const indicator = webview.locator('[data-role="refresh-indicator"]');
		await indicator.waitFor({ state: 'visible', timeout: 5_000 });

		// Cleared: a real, file-watch-driven refresh re-fetches and posts fresh
		// state, which removes the banner while keeping the stack rendered.
		repo.writeFile('trigger.txt', 'touch\n');
		await indicator.waitFor({ state: 'detached', timeout: 15_000 });
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 10_000 });
	});
});
