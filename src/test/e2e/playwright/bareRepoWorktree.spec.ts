/**
 * Visual regression for issue #68 — "Can't use bare repository and worktrees".
 *
 * Opens VS Code on a *linked worktree of a bare repository* (the environment
 * that previously made the extension fail to load with git "exit 128", because
 * gs/git ran with a cwd that resolved into the bare git-dir). With the fix the
 * extension resolves the real working-tree root before invoking git-spice, so
 * the stack view loads and renders the seeded branch exactly as it would in a
 * normal clone.
 *
 * Snapshots are Linux-rendered (Docker compose); regenerate via
 * `npm run test:e2e:playwright:docker:update` and visually verify the PNG
 * shows the loaded stack (NOT an error/empty state) before committing.
 */

import { expect, test } from '@playwright/test';

import { createBareRepoWorktree, type BareRepoWorktree } from './fixtures/repo';
import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { openGitSpiceEditor } from './fixtures/webview';

const TRUNK = 'main';

test.describe('full-pane: bare-repo linked worktree loads (issue #68)', () => {
	let repo: BareRepoWorktree;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		repo = createBareRepoWorktree(TRUNK);
		// Seed a tracked branch with one commit so the view has visible content.
		repo.git('checkout', '-q', TRUNK);
		repo.gs('branch', 'create', '-m', 'add feature', '--no-prompt', '--no-verify', 'feat-worktree');
		vscode = await launchVSCode(repo.worktreePath);
	});

	test.afterAll(async () => {
		await vscode?.close();
		repo?.cleanup();
	});

	test('matches snapshot bare-repo-worktree-loaded.png', async () => {
		const webview = await openGitSpiceEditor(vscode.workbench);
		// If the fix regressed, the view would show a load error / empty state and
		// this wait would time out instead of finding the branch card.
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 30_000 });
		await vscode.workbench.waitForTimeout(500);
		const repoContainer = webview.locator('#repoContainer');
		await expect(repoContainer).toHaveScreenshot('bare-repo-worktree-loaded.png');
	});
});
