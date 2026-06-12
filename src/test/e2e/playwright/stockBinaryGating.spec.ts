/**
 * Full-editor-pane visual snapshot test proving the extension's BETA surfaces
 * stay gated OFF against a VANILLA stock git-spice binary (issue #72).
 *
 * Unlike integrationBranch.spec.ts (which drives the pinned ed-irl `gs` with the
 * beta `integration` command group compiled in), this seeds the repo with — and
 * points the running extension at — the stock binary pinned in
 * `.gs-stock-version` and built to `.gs/bin/gs-stock` by `npm run gs:fetch`.
 * Stock git-spice has no `integration` command group, so the extension's
 * capability probe (`execGitSpiceSupportsIntegration` → `parseIntegrationSupport`)
 * returns false and NO integration card renders even though tips would otherwise
 * be eligible. The screenshot captures that gated-off state.
 *
 * State-only coverage of the same gating lives in
 * src/test/unit/stockBinary.test.ts; this spec is the visual proof.
 *
 * Snapshots are Linux-rendered (Docker compose); regenerate via
 * `npm run test:e2e:playwright:docker:update`. When the stock binary is not
 * built the spec is skipped rather than failed.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { createTempRepo, type WorkspaceRepo } from './fixtures/repo';
import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { openGitSpiceEditor } from './fixtures/webview';

const TRUNK = 'main';
const REPO_ROOT = resolve(__dirname, '../../../..');
const STOCK_BIN = process.env.GIT_SPICE_STOCK_BIN ?? resolve(REPO_ROOT, '.gs/bin/gs-stock');

/** Seeds a two-branch linear stack (feat-a → feat-b) with the stock binary. */
function seedStack(repo: WorkspaceRepo): void {
	repo.createBranch({ name: 'feat-a', base: TRUNK, commits: [{ message: 'add a', files: { 'a.txt': 'a\n' } }] });
	repo.createBranch({ name: 'feat-b', base: 'feat-a', commits: [{ message: 'add b', files: { 'b.txt': 'b\n' } }] });
	repo.gs('branch', 'checkout', 'feat-b');
}

test.describe('stock git-spice: integration surface gated off', () => {
	let repo: WorkspaceRepo;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		test.skip(!existsSync(STOCK_BIN), `stock binary not built at ${STOCK_BIN}; run npm run gs:fetch`);
		// Seed AND run against the stock binary so the gating is proven end-to-end.
		repo = createTempRepo(STOCK_BIN);
		repo.initTrunk(TRUNK);
		seedStack(repo);
		vscode = await launchVSCode(repo.path, { GIT_SPICE_BIN: STOCK_BIN });
	});

	test.afterAll(async () => {
		await vscode?.close();
		repo?.cleanup();
	});

	test('renders no integration card and matches snapshot', async () => {
		const webview = await openGitSpiceEditor(vscode.workbench);
		// The stack itself must render so we know the view loaded (not a blank flake).
		await webview.locator('.branch-card').first().waitFor({ state: 'visible', timeout: 30_000 });
		await vscode.workbench.waitForTimeout(500);
		// The integration node must be ABSENT: stock gs advertises no integration
		// command group, so the capability probe gates the card off entirely.
		await expect(webview.locator('.integration-item')).toHaveCount(0);
		const repoContainer = webview.locator('#repoContainer');
		await expect(repoContainer).toHaveScreenshot('stock-no-integration-card.png');
	});
});
