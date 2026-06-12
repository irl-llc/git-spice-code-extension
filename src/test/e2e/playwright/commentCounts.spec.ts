/**
 * Integration + screenshot coverage for PR comment counts, driven end-to-end
 * by the shamhub fake forge (per the CLAUDE.md feature-coverage policy:
 * remote-dependent features are exercised against shamhub, not mocked).
 *
 * The seed flow mirrors git-spice's own `log_comments` testscript:
 *   gs repo init -> add shamhub remote -> push -> gs auth login ->
 *   create stack -> gs stack submit (creates CRs) -> seed resolvable comments.
 *
 * Then VS Code is launched against the same repo + env, and we screenshot the
 * stack with remote forge status OFF (counts hidden) and ON (counts shown:
 * feat1 has an unresolved comment, feat2 is fully resolved, feat3 has none).
 *
 * Linux-rendered snapshots — regenerate via the Docker compose harness.
 */

import { expect, test, type Page } from '@playwright/test';

import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { seedShamhubStack, type ShamhubStack } from './fixtures/shamhub';
import { openGitSpiceEditor } from './fixtures/webview';
import { waitForStableWidth } from './fixtures/stability';

/** Seeds a feat1/feat2/feat3 stack, then posts comments via shamhub. */
async function seedCommentScenario(): Promise<ShamhubStack> {
	const stack = await seedShamhubStack({ branches: ['feat1', 'feat2', 'feat3'] });
	try {
		// feat1 (#1): one unresolved + one resolved -> 1/2; feat2 (#2): resolved -> 1/1.
		await stack.shamhub.seedComment(1, false, 'feat1 unresolved');
		await stack.shamhub.seedComment(1, true, 'feat1 resolved');
		await stack.shamhub.seedComment(2, true, 'feat2 resolved');
		return stack;
	} catch (error) {
		// Comment seeding threw: tear down the stack so beforeAll doesn't leak it.
		await stack.shamhub.close();
		stack.cleanup();
		throw error;
	}
}

/** Enables remote forge status via the command palette (default is off). */
async function enableRemoteForgeStatus(workbench: Page): Promise<void> {
	await workbench.keyboard.press('F1');
	await workbench.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 10_000 });
	await workbench.keyboard.type('Show Remote Forge Status');
	// Wait for the palette to filter to the command (deterministic, not a timeout).
	await workbench.locator('.quick-input-list-entry', { hasText: 'Show Remote Forge Status' }).first().waitFor();
	await workbench.keyboard.press('Enter');
}

test.describe('comment counts (shamhub)', () => {
	let scenario: ShamhubStack;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		scenario = await seedCommentScenario();
		vscode = await launchVSCode(scenario.repoPath, scenario.env);
	});

	test.afterAll(async () => {
		await vscode?.close();
		await scenario?.shamhub.close();
		scenario?.cleanup();
	});

	test('renders PR comment counts fetched from the forge', async () => {
		const workbench = vscode.workbench;
		const webview = await openGitSpiceEditor(workbench);
		const repoContainer = webview.locator('#repoContainer');
		// 60s headroom (matching openGitSpiceEditor): the first render waits on
		// the extension's initial `gs ll` against the shamhub-backed repo, and
		// shamhub can be slow to settle under CI load (template lookups have been
		// observed to hit context-deadline timeouts), delaying the first state push.
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 60_000 });

		// OFF (default): no comment indicators rendered. (toHaveScreenshot has
		// built-in stability waits, so no explicit timeout is needed.)
		await expect(webview.locator('.comments-indicator')).toHaveCount(0);
		// Wait for the card-row width to settle before capturing: an in-flight
		// async forge fetch can reflow #repoContainer from 632px to the 680px
		// with-badges layout after first paint, and toHaveCount(0) passes during
		// that transient window (issue #78).
		await waitForStableWidth(repoContainer);
		await expect(repoContainer).toHaveScreenshot('comment-counts-hidden.png');

		// ON: enable remote forge status; counts fetched from shamhub appear.
		await enableRemoteForgeStatus(workbench);
		// feat1 (1/2) and feat2 (1/1) both show an indicator; feat3 has none.
		await expect(webview.locator('.comments-indicator')).toHaveCount(2);
		await expect(webview.locator('.comments-indicator', { hasText: '1/2' })).toBeVisible();
		await expect(webview.locator('.comments-indicator', { hasText: '1/1' })).toBeVisible();
		await waitForStableWidth(repoContainer);
		await expect(repoContainer).toHaveScreenshot('comment-counts-shown.png');
	});
});
