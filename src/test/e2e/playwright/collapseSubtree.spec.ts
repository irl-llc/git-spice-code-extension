/**
 * Visual coverage for subtree collapse/expand (issue #66): collapsing a branch
 * hides its upstack behind a placeholder row, the placeholder's [+] expands it
 * again, sibling (non-lane-0) subtrees collapse with correct fork/lane geometry,
 * and the right-click "Collapse Other Stacks" focuses one subtree.
 *
 * Snapshots are Linux-rendered (via the playwright Docker compose service);
 * regen with `npm run test:e2e:playwright:docker:update`. Running natively on
 * macOS diffs against the Linux baselines and fails — that's expected.
 */

import { expect, test, type Frame, type Page } from '@playwright/test';

import { createTempRepo, type WorkspaceRepo } from './fixtures/repo';
import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { collapseSidebarSiblings, openGitSpiceEditor, openGitSpiceView, setSidebarWidth } from './fixtures/webview';

const TRUNK = 'main';

/** Seeds a 3-branch linear stack (feat-a → feat-b → feat-c, current = feat-c). */
function seedLinearStack(repo: WorkspaceRepo): void {
	repo.initTrunk(TRUNK);
	repo.createBranch({ name: 'feat-a', base: TRUNK, commits: [{ message: 'a', files: { 'a.txt': '1\n' } }] });
	repo.createBranch({ name: 'feat-b', base: 'feat-a', commits: [{ message: 'b', files: { 'b.txt': '1\n' } }] });
	repo.createBranch({ name: 'feat-c', base: 'feat-b', commits: [{ message: 'c', files: { 'c.txt': '1\n' } }] });
}

/**
 * Seeds a forked stack so a collapsed subtree lives on a sibling lane (>= 1):
 *   main ─┬─ feat-a ── feat-a1   └─ feat-b ── feat-b1   (current = feat-a1)
 */
function seedForkedStack(repo: WorkspaceRepo): void {
	repo.initTrunk(TRUNK);
	repo.createBranch({ name: 'feat-a', base: TRUNK, commits: [{ message: 'a', files: { 'a.txt': '1\n' } }] });
	repo.createBranch({ name: 'feat-a1', base: 'feat-a', commits: [{ message: 'a1', files: { 'a1.txt': '1\n' } }] });
	repo.createBranch({ name: 'feat-b', base: TRUNK, commits: [{ message: 'b', files: { 'b.txt': '1\n' } }] });
	repo.createBranch({ name: 'feat-b1', base: 'feat-b', commits: [{ message: 'b1', files: { 'b1.txt': '1\n' } }] });
	repo.gs('branch', 'checkout', 'feat-a1');
}

async function openNarrowView(vscode: VSCodeInstance): Promise<Frame> {
	const webview = await openGitSpiceView(vscode.workbench);
	await collapseSidebarSiblings(vscode.workbench, 'Git Spice');
	await setSidebarWidth(vscode.workbench, 500);
	await webview.locator('#repoContainer .stack-item').first().waitFor({ state: 'visible', timeout: 60_000 });
	return webview;
}

/** Right-clicks a branch card and picks a menu item by label from the Monaco context menu. */
async function pickBranchMenu(workbench: Page, frame: Frame, branch: string, item: string): Promise<void> {
	await frame.locator(`article[data-branch="${branch}"] .branch-header`).first().click({ button: 'right' });
	const menu = workbench.locator('.monaco-menu:visible').first();
	await expect(menu).toBeVisible({ timeout: 5_000 });
	await menu.locator('.action-label', { hasText: item }).first().click();
}

test.describe('subtree collapse/expand (#66)', () => {
	let vscode: VSCodeInstance;
	let repo: WorkspaceRepo;

	test.afterEach(async () => {
		await vscode?.close();
		repo?.cleanup();
	});

	test('collapsing a branch hides its upstack behind a placeholder', async () => {
		repo = createTempRepo();
		seedLinearStack(repo);
		vscode = await launchVSCode(repo.path);
		const webview = await openNarrowView(vscode);

		await webview.getByRole('button', { name: /Collapse subtree above feat-a/i }).click();
		await webview.locator('.collapsed-placeholder').waitFor({ state: 'visible', timeout: 10_000 });
		await vscode.workbench.waitForTimeout(500);

		await expect(webview.locator('#repoContainer')).toHaveScreenshot('collapsed-subtree.png');
	});

	test('expanding the placeholder [+] restores the hidden branches', async () => {
		repo = createTempRepo();
		seedLinearStack(repo);
		vscode = await launchVSCode(repo.path);
		const webview = await openNarrowView(vscode);

		// Collapse, then expand via the placeholder's [+] and verify the stack is whole.
		await webview.getByRole('button', { name: /Collapse subtree above feat-a/i }).click();
		await webview.locator('.collapsed-placeholder').waitFor({ state: 'visible', timeout: 10_000 });
		await webview.getByRole('button', { name: /Expand/i }).click();
		await webview.locator('.collapsed-placeholder').waitFor({ state: 'hidden', timeout: 10_000 });
		await vscode.workbench.waitForTimeout(500);

		await expect(webview.locator('#repoContainer')).toHaveScreenshot('expanded-back-subtree.png');
	});

	test('collapsing a sibling subtree keeps the fork and dashed lane aligned', async () => {
		repo = createTempRepo();
		seedForkedStack(repo);
		vscode = await launchVSCode(repo.path);
		const webview = await openGitSpiceEditor(vscode.workbench);
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 30_000 });

		// Collapse feat-b (a sibling subtree on lane >= 1): feat-b1 hides behind a
		// placeholder whose dashed lane must sit under feat-b's fork, not lane 0.
		await webview.getByRole('button', { name: /Collapse subtree above feat-b/i }).click();
		await webview.locator('.collapsed-placeholder').waitFor({ state: 'visible', timeout: 10_000 });
		await vscode.workbench.waitForTimeout(500);

		await expect(webview.locator('#repoContainer')).toHaveScreenshot('collapsed-sibling-subtree.png');
	});

	test('"Collapse Other Stacks" hides every off-path subtree', async () => {
		repo = createTempRepo();
		seedForkedStack(repo);
		vscode = await launchVSCode(repo.path);
		const webview = await openGitSpiceEditor(vscode.workbench);
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 30_000 });

		// Right-click feat-a1 and choose "Collapse Other Stacks": the feat-b subtree
		// collapses while feat-a's stack stays expanded.
		await pickBranchMenu(vscode.workbench, webview, 'feat-a1', 'Collapse Other Stacks');
		await webview.locator('.collapsed-placeholder').waitFor({ state: 'visible', timeout: 10_000 });
		await vscode.workbench.waitForTimeout(500);

		await expect(webview.locator('#repoContainer')).toHaveScreenshot('collapse-other-stacks.png');
	});
});
