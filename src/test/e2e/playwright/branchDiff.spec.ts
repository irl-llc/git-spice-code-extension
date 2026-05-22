/**
 * First BDD test: clicking "Summarized Changes" for a multi-commit branch
 * opens the multi-file changes editor for that branch.
 *
 * This is the layer-2 assertion the plan called out — rendered-output
 * verification, not a spy on vscode.commands.executeCommand. If
 * `vscode.changes` ever silently fails (e.g., experimental command
 * unavailable), this test catches it because no editor tab appears.
 */

import { expect, test } from '@playwright/test';

import { createTempRepo, type WorkspaceRepo } from './fixtures/repo';
import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { openGitSpiceView } from './fixtures/webview';

const TRUNK = 'main';
const FEATURE_BRANCH = 'feat-a';

test.describe('Branch summary → multi-file changes view', () => {
	let repo: WorkspaceRepo;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		repo = createTempRepo();
		repo.initTrunk(TRUNK);
		repo.createBranch({
			name: FEATURE_BRANCH,
			base: TRUNK,
			commits: [
				{ message: 'add foo', files: { 'foo.txt': 'one\n' } },
				{ message: 'add bar', files: { 'bar.txt': 'two\n' } },
			],
		});
		vscode = await launchVSCode(repo.path);
	});

	test.afterAll(async () => {
		await vscode?.close();
		repo?.cleanup();
	});

	test('clicking Summarized Changes opens a Changes editor tab for the branch', async () => {
		const webview = await openGitSpiceView(vscode.workbench);

		// Wait for the webview to mount branch cards (extension host runs
		// `gs ll -a --json` and posts the state message; can take a beat).
		await expect(webview.locator('.branch-card').first()).toBeVisible({ timeout: 30_000 });

		// The "Summarized Changes" button only renders for branches with
		// >1 commit. feat-a has two commits.
		const openDiff = webview.getByRole('button', {
			name: new RegExp(`open changes view for ${FEATURE_BRANCH}`, 'i'),
		});
		await expect(openDiff).toBeVisible({ timeout: 15_000 });

		await openDiff.click();

		// vscode.changes opens a tab titled `Changes in <branchName>`.
		const changesTab = vscode.workbench.locator(`.tab[aria-label*="Changes in ${FEATURE_BRANCH}"]`);
		await expect(changesTab).toBeVisible({ timeout: 15_000 });
	});
});
