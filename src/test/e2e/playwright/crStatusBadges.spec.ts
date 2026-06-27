/**
 * Screenshot coverage for change-request (CR) status badges, driven end-to-end
 * by the shamhub fake forge (per the CLAUDE.md feature-coverage policy:
 * remote-dependent features are exercised against shamhub, not mocked).
 *
 * After `gs stack submit`, each branch has an OPEN change request. With remote
 * forge status enabled, each branch card shows an "Open" badge fetched via
 * `gs ll -S`. The merged/closed variants render as transient inline call-outs
 * (not steady pills); their shamhub-driven screenshots are captured by the
 * "merged + closed" describe block below, which merges one CR and closes
 * another before launch.
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

/**
 * Tears down a launched scenario, guarding each step so a failure in one does
 * not skip the others — Playwright abandons the rest of an afterAll once a
 * statement throws, which would otherwise leak the temp dirs `cleanup()` removes.
 */
async function teardownScenario(vscode: VSCodeInstance | undefined, scenario: ShamhubStack | undefined): Promise<void> {
	try {
		await vscode?.close();
	} finally {
		try {
			await scenario?.shamhub.close();
		} finally {
			scenario?.cleanup();
		}
	}
}

/** Seeds a feat1/feat2 stack, then merges #1 and closes #2 via shamhub. */
async function seedMergedClosedScenario(): Promise<ShamhubStack> {
	const stack = await seedShamhubStack({ branches: ['feat1', 'feat2'] });
	try {
		await stack.shamhub.mergeChange(1); // feat1 (#1) -> merged
		await stack.shamhub.closeChange(2); // feat2 (#2) -> closed
		return stack;
	} catch (error) {
		// Seeding threw after startup: tear down so beforeAll doesn't leak it.
		await teardownScenario(undefined, stack);
		throw error;
	}
}

test.describe('CR status badges (shamhub)', () => {
	let scenario: ShamhubStack;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		scenario = await seedShamhubStack({ branches: ['feat1', 'feat2'] });
		vscode = await launchVSCode(scenario.repoPath, scenario.env);
	});

	test.afterAll(async () => {
		await teardownScenario(vscode, scenario);
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

test.describe('CR status badges: merged + closed (shamhub)', () => {
	let scenario: ShamhubStack;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		scenario = await seedMergedClosedScenario();
		vscode = await launchVSCode(scenario.repoPath, scenario.env);
	});

	test.afterAll(async () => {
		await teardownScenario(vscode, scenario);
	});

	test('renders merged and closed CR status badges fetched from the forge', async () => {
		const workbench = vscode.workbench;
		const webview = await openGitSpiceEditor(workbench);
		const repoContainer = webview.locator('#repoContainer');
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 60_000 });

		// feat1's CR was merged (#1) and feat2's was closed (#2) before launch.
		// Merged/closed are transient states (merged disappears on the next sync,
		// closed is an error re-created on the next submit), so they render as
		// inline call-outs (.cr-transient), NOT as the steady .tag-cr pill.
		await enableRemoteForgeStatus(workbench);
		await expect(webview.locator('.cr-transient-merged')).toHaveCount(1);
		await expect(webview.locator('.cr-transient-closed')).toHaveCount(1);
		// Neither merged nor closed should render the steady pill treatment.
		await expect(webview.locator('.tag-cr')).toHaveCount(0);
		await expect(webview.locator('.cr-transient', { hasText: 'Merged' })).toBeVisible();
		await expect(webview.locator('.cr-transient', { hasText: 'Closed' })).toBeVisible();
		await expect(repoContainer).toHaveScreenshot('cr-status-merged-closed.png');
	});
});
