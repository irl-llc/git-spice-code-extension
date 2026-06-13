/**
 * Integration + screenshot coverage for the CI build-status (checks) indicator,
 * driven end-to-end by the shamhub fake forge (per the CLAUDE.md
 * feature-coverage policy: remote-dependent features are exercised against
 * shamhub, not mocked).
 *
 * The seed flow mirrors the comment-counts spec: gs repo init -> add shamhub
 * remote -> push -> gs auth login -> create stack -> gs stack submit (creates
 * CRs) -> seed per-change checks states via shamhub's `setcheck` command.
 *
 * VS Code is launched against the same repo + env, and we screenshot the stack
 * with remote forge status OFF (no indicator) and ON. The rollup hides on
 * success/none (silent on green / no-CI) and shows only the non-default
 * failure (red) and pending (spinner) states — so the scenario seeds:
 *   feat1 (#1): failed  -> red failure indicator
 *   feat2 (#2): pending -> spinner indicator
 *   feat3 (#3): passed  -> NO indicator (success is hidden by design)
 *
 * Linux-rendered snapshots — regenerate via the Docker compose harness
 * (`npm run test:e2e:playwright:docker:update`).
 */

import { expect, test, type Page } from '@playwright/test';

import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { seedShamhubStack, type ShamhubStack } from './fixtures/shamhub';
import { openGitSpiceEditor } from './fixtures/webview';

/** Seeds a feat1/feat2/feat3 stack, then sets per-change checks via shamhub. */
async function seedBuildStatusScenario(): Promise<ShamhubStack> {
	const stack = await seedShamhubStack({ branches: ['feat1', 'feat2', 'feat3'] });
	try {
		await stack.shamhub.seedCheck(1, 'failed');
		await stack.shamhub.seedCheck(2, 'pending');
		await stack.shamhub.seedCheck(3, 'passed');
		return stack;
	} catch (error) {
		// Seeding threw: tear down so beforeAll doesn't leak the child/temp dirs.
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
	await workbench.locator('.quick-input-list-entry', { hasText: 'Show Remote Forge Status' }).first().waitFor();
	await workbench.keyboard.press('Enter');
}

test.describe('build status (shamhub)', () => {
	let scenario: ShamhubStack;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		scenario = await seedBuildStatusScenario();
		vscode = await launchVSCode(scenario.repoPath, scenario.env);
	});

	test.afterAll(async () => {
		await vscode?.close();
		await scenario?.shamhub.close();
		scenario?.cleanup();
	});

	test('renders the build-status rollup fetched from the forge', async () => {
		const workbench = vscode.workbench;
		const webview = await openGitSpiceEditor(workbench);
		const repoContainer = webview.locator('#repoContainer');
		// 60s headroom: the first render waits on the extension's initial `gs ll`
		// against the shamhub-backed repo (slow to settle under CI load).
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 60_000 });

		// OFF (default): no build-status indicators rendered.
		await expect(webview.locator('.build-status')).toHaveCount(0);
		await expect(repoContainer).toHaveScreenshot('build-status-hidden.png');

		// ON: enable remote forge status; the failure + pending rollups appear,
		// the passing one stays hidden (success is silent by design).
		await enableRemoteForgeStatus(workbench);
		await expect(webview.locator('.build-status')).toHaveCount(2);
		await expect(webview.locator('.build-status-failure')).toHaveCount(1);
		await expect(webview.locator('.build-status-pending')).toHaveCount(1);
		await expect(repoContainer).toHaveScreenshot('build-status-shown.png');
	});
});
