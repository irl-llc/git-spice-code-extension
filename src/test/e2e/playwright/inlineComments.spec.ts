/**
 * Integration + screenshot coverage for inline forge comments rendered as
 * native VS Code comment threads (issue #40, slice 2), driven end-to-end by the
 * shamhub fake forge per the CLAUDE.md feature-coverage policy.
 *
 * Flow: seed a one-branch submitted stack (multi-commit so the webview shows
 * the "Summarized Changes" button and the file has real lines), post a
 * line-scope and a PR-scope inline comment through `gs branch comment add`
 * (which writes to shamhub), launch VS Code against the same repo + env, enable
 * remote forge status, open the branch's file diff from the webview, and assert
 * the ForgeCommentController created native comment threads carrying the seeded
 * bodies. A screenshot of the rendered thread is captured.
 *
 * NOTE: comment threads render in VS Code's NATIVE diff editor (workbench DOM),
 * not in our webview — so this spec locates `.comment-body`/`.review-widget` in
 * the workbench page, unlike the webview-frame specs.
 *
 * Linux-rendered snapshots — regenerate via the Docker compose harness.
 */

import { expect, test, type Frame, type Page } from '@playwright/test';

import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { seedShamhubStack, type ShamhubStack } from './fixtures/shamhub';
import { openGitSpiceEditor } from './fixtures/webview';

const FEATURE_BRANCH = 'feat1';
const LINE_COMMENT_BODY = 'Please rename this variable';
const PR_COMMENT_BODY = 'Overall looks good, one nit';

/** Enables remote forge status via the command palette (default is off). */
async function enableRemoteForgeStatus(workbench: Page): Promise<void> {
	await workbench.keyboard.press('F1');
	await workbench.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 10_000 });
	await workbench.keyboard.type('Show Remote Forge Status');
	await workbench.locator('.quick-input-list-entry', { hasText: 'Show Remote Forge Status' }).first().waitFor();
	await workbench.keyboard.press('Enter');
}

/** Clicks "Summarized Changes" and opens the branch's file diff editor. */
async function openBranchFileDiff(vscode: VSCodeInstance, webview: Frame): Promise<void> {
	const openDiff = webview.getByRole('button', {
		name: new RegExp(`open changes view for ${FEATURE_BRANCH}`, 'i'),
	});
	await expect(openDiff).toBeVisible({ timeout: 15_000 });
	await openDiff.click();
	const changesTab = vscode.workbench.locator(`.tab[aria-label*="Changes in ${FEATURE_BRANCH}"]`);
	await expect(changesTab).toBeVisible({ timeout: 15_000 });
}

test.describe('inline forge comments (shamhub)', () => {
	let scenario: ShamhubStack;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		scenario = await seedShamhubStack({ branches: [FEATURE_BRANCH], multiCommit: true });
		try {
			scenario.addInlineComment(FEATURE_BRANCH, `${FEATURE_BRANCH}.txt:2`, LINE_COMMENT_BODY);
			scenario.addInlineComment(FEATURE_BRANCH, undefined, PR_COMMENT_BODY);
		} catch (error) {
			await scenario.shamhub.close();
			scenario.cleanup();
			throw error;
		}
		vscode = await launchVSCode(scenario.repoPath, scenario.env);
	});

	test.afterAll(async () => {
		await vscode?.close();
		await scenario?.shamhub.close();
		scenario?.cleanup();
	});

	test('renders seeded forge comments as native comment threads', async () => {
		const workbench = vscode.workbench;
		const webview = await openGitSpiceEditor(workbench);
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 60_000 });

		// Enable forge status so the extension fetches inline comments, then open
		// the marked branch diff that the CommentController attaches threads to.
		await enableRemoteForgeStatus(workbench);
		await openBranchFileDiff(vscode, webview);

		// The controller renders threads after the forge fetch completes; the
		// seeded bodies must appear in the native comment DOM.
		const commentBody = workbench.locator('.comment-body');
		await expect(commentBody.filter({ hasText: LINE_COMMENT_BODY })).toBeVisible({ timeout: 30_000 });
		await expect(commentBody.filter({ hasText: PR_COMMENT_BODY })).toBeVisible({ timeout: 30_000 });

		// Screenshot the rendered comment widget (native diff-editor overlay).
		await expect(workbench.locator('.review-widget').first()).toHaveScreenshot('inline-comment-thread.png');
	});
});
