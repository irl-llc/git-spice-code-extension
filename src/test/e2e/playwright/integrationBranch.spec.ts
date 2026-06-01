/**
 * Full-editor-pane visual snapshot tests for the integration-branch feature
 * (the beta ed-irl/git-spice command group; see issue #39).
 *
 * Drives the REAL pinned `gs` binary's `integration` command group (no
 * mocking): seeds a configured integration branch, rebuilds it, and drifts a
 * tip to exercise the needs-rebuild state. Captures:
 *  - built (up-to-date) integration card atop the stack,
 *  - needs-rebuild integration card (drifted tip → warning styling),
 *  - the out-of-integration "X" marker on a branch excluded from the tips,
 *  - the post-"tip add" state: a branch added to the tip list via the same
 *    `gs integration tip add` command the context-menu action runs, so its "X"
 *    marker clears (the inverse of the out-of-integration capture).
 *
 * Snapshots are Linux-rendered (Docker compose); regenerate via
 * `npm run test:e2e:playwright:docker:update`.
 */

import { expect, test } from '@playwright/test';

import { createTempRepo, type WorkspaceRepo } from './fixtures/repo';
import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { openGitSpiceEditor } from './fixtures/webview';

const TRUNK = 'main';

/** Seeds a two-branch linear stack (feat-a → feat-b) used by the linear scenarios. */
function seedStack(repo: WorkspaceRepo): void {
	repo.createBranch({ name: 'feat-a', base: TRUNK, commits: [{ message: 'add a', files: { 'a.txt': 'a\n' } }] });
	repo.createBranch({ name: 'feat-b', base: 'feat-a', commits: [{ message: 'add b', files: { 'b.txt': 'b\n' } }] });
}

/** Seeds two sibling stacks off trunk (feat-a and feat-c). */
function seedSiblings(repo: WorkspaceRepo): void {
	repo.createBranch({ name: 'feat-a', base: TRUNK, commits: [{ message: 'add a', files: { 'a.txt': 'a\n' } }] });
	repo.createBranch({ name: 'feat-c', base: TRUNK, commits: [{ message: 'add c', files: { 'c.txt': 'c\n' } }] });
}

/** Seeds one tip branch (feat-a) plus a separate, non-integration sibling stack (feat-b → feat-c). */
function seedMixed(repo: WorkspaceRepo): void {
	repo.createBranch({ name: 'feat-a', base: TRUNK, commits: [{ message: 'add a', files: { 'a.txt': 'a\n' } }] });
	repo.createBranch({ name: 'feat-b', base: TRUNK, commits: [{ message: 'add b', files: { 'b.txt': 'b\n' } }] });
	repo.createBranch({ name: 'feat-c', base: 'feat-b', commits: [{ message: 'add c', files: { 'c.txt': 'c\n' } }] });
}

interface Scenario {
	name: string;
	snapshot: string;
	seed: (repo: WorkspaceRepo) => void;
}

const SCENARIOS: Scenario[] = [
	{
		name: 'integration branch built and up to date',
		snapshot: 'integration-built.png',
		seed: (repo) => {
			seedStack(repo);
			repo.gs('integration', 'create', 'integ', '--tip', 'feat-a', '--tip', 'feat-b');
			repo.gs('integration', 'rebuild');
			repo.gs('branch', 'checkout', 'feat-b');
		},
	},
	{
		name: 'integration branch needs rebuild (drifted tip)',
		snapshot: 'integration-needs-rebuild.png',
		seed: (repo) => {
			seedStack(repo);
			repo.gs('integration', 'create', 'integ', '--tip', 'feat-a', '--tip', 'feat-b');
			repo.gs('integration', 'rebuild');
			// Advance feat-a so its stored hash drifts from current → needs rebuild.
			// Commit with plain git (not gs) so the tip head moves without
			// re-running gs's tip bookkeeping; integration `show` then reports drift.
			repo.git('checkout', 'feat-a');
			repo.writeFile('a.txt', 'a\ndrift\n');
			repo.git('add', '.');
			repo.git('commit', '-q', '-m', 'drift a');
			repo.gs('branch', 'checkout', 'feat-b');
		},
	},
	{
		name: 'out-of-integration branch marked with X',
		snapshot: 'integration-out-of-integration.png',
		seed: (repo) => {
			seedStack(repo);
			// Only feat-a is a tip; feat-b is excluded → gets the X marker.
			repo.gs('integration', 'create', 'integ', '--tip', 'feat-a');
			repo.gs('integration', 'rebuild');
			repo.gs('branch', 'checkout', 'feat-b');
		},
	},
	{
		// Two sibling stacks, both integration tips → integ fans DOWN into both
		// lanes, mirroring the way trunk fans UP into them (the clearest view of
		// the reverse-trunk fan-in).
		name: 'sibling tips fan into integration',
		snapshot: 'integration-sibling-tips.png',
		seed: (repo) => {
			seedSiblings(repo);
			repo.gs('integration', 'create', 'integ', '--tip', 'feat-a', '--tip', 'feat-c');
			repo.gs('integration', 'rebuild');
			repo.gs('branch', 'checkout', 'feat-a');
		},
	},
	{
		// One tip (feat-a) plus a separate sibling stack (feat-b → feat-c) that is
		// NOT part of the integration: its column survives from the bottom-up
		// fan-out with no link to integ, and feat-c gets the out-of-integration ✕.
		name: 'integration alongside a non-integration sibling stack',
		snapshot: 'integration-non-integration-sibling.png',
		seed: (repo) => {
			seedMixed(repo);
			repo.gs('integration', 'create', 'integ', '--tip', 'feat-a');
			repo.gs('integration', 'rebuild');
			repo.gs('branch', 'checkout', 'feat-a');
		},
	},
	{
		name: 'tip add clears the out-of-integration X marker',
		snapshot: 'integration-tip-added.png',
		seed: (repo) => {
			seedStack(repo);
			// Start with feat-b excluded, then add it to the tip list via the
			// exact command the context-menu "Add to integration build" action
			// runs. feat-b's "X" marker should clear once it is a tip.
			repo.gs('integration', 'create', 'integ', '--tip', 'feat-a');
			repo.gs('integration', 'rebuild');
			repo.gs('integration', 'tip', 'add', 'feat-b');
			repo.gs('integration', 'rebuild');
			repo.gs('branch', 'checkout', 'feat-b');
		},
	},
];

for (const scenario of SCENARIOS) {
	test.describe(`integration: ${scenario.name}`, () => {
		let repo: WorkspaceRepo;
		let vscode: VSCodeInstance;

		test.beforeAll(async () => {
			repo = createTempRepo();
			repo.initTrunk(TRUNK);
			scenario.seed(repo);
			vscode = await launchVSCode(repo.path);
		});

		test.afterAll(async () => {
			await vscode?.close();
			repo?.cleanup();
		});

		test(`matches snapshot ${scenario.snapshot}`, async () => {
			const webview = await openGitSpiceEditor(vscode.workbench);
			await webview.locator('.integration-item').first().waitFor({ state: 'visible', timeout: 30_000 });
			await vscode.workbench.waitForTimeout(500);
			const repoContainer = webview.locator('#repoContainer');
			await expect(repoContainer).toHaveScreenshot(scenario.snapshot);
		});
	});
}
