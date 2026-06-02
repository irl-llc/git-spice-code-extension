/**
 * Screenshot coverage for change-request (CR) status badges, driven end-to-end
 * by the shamhub fake forge (per the CLAUDE.md feature-coverage policy:
 * remote-dependent features are exercised against shamhub, not mocked).
 *
 * After `gs stack submit`, each branch has an OPEN change request. With remote
 * forge status enabled, each branch card shows an "Open" badge fetched via
 * `gs ll -S`. The merged/closed badge variants are covered by the BranchCard
 * unit tests; their shamhub-driven screenshots arrive once the shamhub helper
 * gains merge/close commands (issue #36 slice 3).
 *
 * Linux-rendered snapshots — regenerate via the Docker compose harness.
 */

import { expect, test, type Page } from '@playwright/test';

import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { seedShamhubStack, type ShamhubStack } from './fixtures/shamhub';
import { openGitSpiceEditor } from './fixtures/webview';

/** Enables remote forge status via the command palette (default is off). */
async function enableRemoteForgeStatus(workbench: Page): Promise<void> {
	await workbench.keyboard.press('F1');
	await workbench.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 10_000 });
	await workbench.keyboard.type('Show Remote Forge Status');
	await workbench.locator('.quick-input-list-entry', { hasText: 'Show Remote Forge Status' }).first().waitFor();
	await workbench.keyboard.press('Enter');
}

test.describe('CR status badges (shamhub)', () => {
	let scenario: ShamhubStack;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		scenario = await seedShamhubStack({ branches: ['feat1', 'feat2'] });
		vscode = await launchVSCode(scenario.repoPath, scenario.env);
	});

	test.afterAll(async () => {
		await vscode?.close();
		await scenario?.shamhub.close();
		scenario?.cleanup();
	});

	test('renders open CR status badges fetched from the forge', async () => {
		const workbench = vscode.workbench;
		const webview = await openGitSpiceEditor(workbench);
		const repoContainer = webview.locator('#repoContainer');
		// 60s headroom (matching openGitSpiceEditor): the first render waits on
		// the extension's initial `gs ll` against the shamhub-backed repo, which
		// can be slow to settle under CI load.
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 60_000 });

		// OFF (default): no CR-status badges rendered.
		await expect(webview.locator('.tag-cr')).toHaveCount(0);
		await expect(repoContainer).toHaveScreenshot('cr-status-hidden.png');

		// ON: enable remote forge status; "Open" badges fetched from shamhub appear
		// on both submitted branches (feat1, feat2); trunk has no change request.
		await enableRemoteForgeStatus(workbench);
		await expect(webview.locator('.tag-cr-open')).toHaveCount(2);
		await expect(webview.locator('.tag-cr', { hasText: 'Open' }).first()).toBeVisible();
		await expect(repoContainer).toHaveScreenshot('cr-status-open.png');
	});
});
