/**
 * Behavior test for the "Show/Hide Remote Forge Status (Beta)" toggle in the
 * Git Spice view's `...` (More Actions) menu.
 *
 * Regression guard for the bug where the menu item never reflected the
 * setting: it used a `toggled` property, which VS Code's package.json
 * `menus` schema does not support (only `command`/`alt`/`when`/`group`), so
 * the checkmark was silently dropped. A native checkmark isn't achievable
 * for extension-contributed menus (it needs the internal registerAction2
 * API), and `$(icon)` codicons are stripped from overflow-menu titles — so
 * the fix swaps two `when`-gated commands whose verb label reflects state
 * ("Show…" when off, "Hide…" when on), gated on the extension-managed
 * `gitSpice.showRemoteForgeStatus` context key.
 *
 * Not a snapshot test — it asserts which command label the menu offers, so
 * no Linux baseline is needed.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { createTempRepo, type WorkspaceRepo } from './fixtures/repo';
import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { openGitSpiceView } from './fixtures/webview';

const TRUNK = 'main';
const SHOW_LABEL = 'Show Remote Forge Status (Beta)';
const HIDE_LABEL = 'Hide Remote Forge Status (Beta)';

/** Opens the Git Spice view's `...` (More Actions) menu; returns the open menu. */
async function openMoreActionsMenu(workbench: Page): Promise<Locator> {
	const moreBtn = workbench
		.locator('.pane-header', { hasText: 'Git Spice' })
		.first()
		.locator('[aria-label*="More Actions"]');
	const menu = workbench.locator('.monaco-menu:visible').first();
	// The dropdown intermittently fails to open on the first click in headless
	// CI, so retry the click until the menu is actually visible.
	await expect(async () => {
		if (!(await menu.isVisible())) await moreBtn.click();
		await expect(menu).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 20_000 });
	return menu;
}

/** A menu item whose label exactly equals `label`. */
function menuItem(workbench: Page, label: string): Locator {
	return workbench.locator('.monaco-menu .action-item .action-label', { hasText: label });
}

/** The open `...` dropdown menu (screenshot target) — the visible one only. */
function dropdownMenu(workbench: Page): Locator {
	return workbench.locator('.monaco-menu:visible').first();
}

test.describe('remote forge status toggle', () => {
	let repo: WorkspaceRepo;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		repo = createTempRepo();
		repo.initTrunk(TRUNK);
		repo.createBranch({
			name: 'feat-a',
			base: TRUNK,
			commits: [{ message: 'add foo', files: { 'foo.txt': 'one\n' } }],
		});
		vscode = await launchVSCode(repo.path);
	});

	test.afterAll(async () => {
		await vscode?.close();
		repo?.cleanup();
	});

	test('swaps the menu command label to reflect the toggle state', async () => {
		const workbench = vscode.workbench;
		await openGitSpiceView(workbench);

		// OFF (default): the menu offers "Show …" and not "Hide …".
		await captureMenuState(workbench, SHOW_LABEL, HIDE_LABEL, 'comment-progress-off-show.png');

		// Activating "Show …" enables the setting; re-open first in case the
		// dropdown auto-dismissed after the screenshot, then wait for it to close.
		await openMoreActionsMenu(workbench);
		await menuItem(workbench, SHOW_LABEL).click();
		await expect(dropdownMenu(workbench)).toBeHidden();

		// ON: the menu now offers "Hide …" — proving the context-key swap.
		await captureMenuState(workbench, HIDE_LABEL, SHOW_LABEL, 'comment-progress-on-hide.png');
		await workbench.keyboard.press('Escape');
	});
});

/**
 * Opens the `...` menu, asserts which command it offers (`present` shown,
 * `absent` hidden), and snapshots it. The dropdown can auto-dismiss in headless
 * CI between opening and the screenshot, so the whole open → assert → snapshot
 * is retried as a unit (re-opening if it closed).
 */
async function captureMenuState(workbench: Page, present: string, absent: string, snapshot: string): Promise<void> {
	await expect(async () => {
		const menu = await openMoreActionsMenu(workbench);
		await expect(menu.locator('.action-label', { hasText: present })).toBeVisible({ timeout: 2000 });
		await expect(menu.locator('.action-label', { hasText: absent })).toHaveCount(0);
		await expect(menu).toHaveScreenshot(snapshot, { timeout: 5000 });
	}).toPass({ timeout: 45_000 });
}
