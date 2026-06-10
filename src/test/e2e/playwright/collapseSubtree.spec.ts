/**
 * Visual coverage for subtree collapse/expand (issue #66): collapsing a branch
 * hides its upstack behind a placeholder row, and the placeholder's [+] expands
 * it again. Narrow SCM-sidebar capture.
 *
 * Snapshots are Linux-rendered (via the playwright Docker compose service);
 * regen with `npm run test:e2e:playwright:docker:update`. Running natively on
 * macOS diffs against the Linux baselines and fails — that's expected.
 */

import { expect, test, type Frame } from '@playwright/test';

import { createTempRepo, type WorkspaceRepo } from './fixtures/repo';
import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { collapseSidebarSiblings, openGitSpiceView, setSidebarWidth } from './fixtures/webview';

const TRUNK = 'main';

/** Seeds a 3-branch linear stack (feat-a → feat-b → feat-c, current = feat-c). */
function seedStack(repo: WorkspaceRepo): void {
	repo.createBranch({ name: 'feat-a', base: TRUNK, commits: [{ message: 'a', files: { 'a.txt': '1\n' } }] });
	repo.createBranch({ name: 'feat-b', base: 'feat-a', commits: [{ message: 'b', files: { 'b.txt': '1\n' } }] });
	repo.createBranch({ name: 'feat-c', base: 'feat-b', commits: [{ message: 'c', files: { 'c.txt': '1\n' } }] });
}

async function openNarrowView(vscode: VSCodeInstance): Promise<Frame> {
	const webview = await openGitSpiceView(vscode.workbench);
	await collapseSidebarSiblings(vscode.workbench, 'Git Spice');
	await setSidebarWidth(vscode.workbench, 500);
	await webview.locator('#repoContainer .stack-item').first().waitFor({ state: 'visible', timeout: 60_000 });
	return webview;
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
		seedStack(repo);
		vscode = await launchVSCode(repo.path);
		const webview = await openNarrowView(vscode);

		// Collapse feat-a's upstack (hides feat-b, feat-c behind a placeholder).
		await webview.getByRole('button', { name: /Collapse subtree above feat-a/i }).click();
		await webview.locator('.collapsed-placeholder').waitFor({ state: 'visible', timeout: 10_000 });
		await vscode.workbench.waitForTimeout(500);

		await expect(webview.locator('#repoContainer')).toHaveScreenshot('collapsed-subtree.png');
	});
});
