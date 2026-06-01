/**
 * Visual snapshot test for the refresh-in-flight indicator (issue #37).
 *
 * The extension host posts a `refreshing` message to the webview when a
 * refresh begins and a `state` message when it completes. The webview
 * renders a thin top banner ("Refreshing…") for the duration so the user
 * gets visible feedback that the refresh button actually did something.
 *
 * We capture two states:
 *   - active:  the banner visible mid-refresh. The real refresh resolves
 *              near-instantly in tests, so we drive the banner on by
 *              dispatching the SAME `refreshing` message event the host
 *              posts (the real webview contract — a `window` message event,
 *              not a mock of business logic).
 *   - cleared: the banner gone after a real refresh completes. We write a
 *              file in the repo, which the extension's file watcher picks up
 *              and turns into a genuine refresh: the host posts `refreshing`
 *              then a real `state`, the banner clears, and the actual stack
 *              stays rendered.
 *
 * Snapshots are Linux-rendered (Docker compose); regenerate via
 * `npm run test:e2e:playwright:docker:update`.
 */

import { expect, test, type Frame } from '@playwright/test';

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
		await vscode.workbench.waitForTimeout(500);

		// Active state: dispatch `refreshing` and snapshot the visible banner.
		await postHostMessage(webview, { type: 'refreshing' });
		const indicator = webview.locator('[data-role="refresh-indicator"]');
		await indicator.waitFor({ state: 'visible', timeout: 5_000 });
		const repoContainer = webview.locator('#repoContainer');
		await expect(repoContainer).toHaveScreenshot('refresh-indicator-active.png');

		// Cleared state: a real, file-watch-driven refresh re-fetches and posts
		// fresh state, which removes the banner while keeping the stack rendered.
		repo.writeFile('trigger.txt', 'touch\n');
		await indicator.waitFor({ state: 'detached', timeout: 15_000 });
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 10_000 });
		await vscode.workbench.waitForTimeout(500);
		await expect(repoContainer).toHaveScreenshot('refresh-indicator-cleared.png');
	});
});
