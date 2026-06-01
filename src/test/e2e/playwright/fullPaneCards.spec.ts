/**
 * Full-editor-pane visual snapshot tests covering the branch cards,
 * Summarized Changes section, Uncommitted Changes card, untracked
 * branch card, and restack-needed state.
 *
 * These tests open the Git Spice view as a full editor tab (via the
 * `git-spice.openInEditor` command) so we have a wide canvas. The
 * tree-fragment SVG focused snapshots in `treeFragment.spec.ts` cover
 * the narrow-column sub-pane view.
 *
 * Snapshots are Linux-rendered (Docker compose); regenerate via
 * `npm run test:e2e:playwright:docker:update`.
 */

import { expect, test, type Frame } from '@playwright/test';

import { createTempRepo, type WorkspaceRepo } from './fixtures/repo';
import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { openGitSpiceEditor } from './fixtures/webview';

const TRUNK = 'main';

interface Scenario {
	name: string;
	snapshot: string;
	seed: (repo: WorkspaceRepo) => void;
	/**
	 * Per-scenario hook run after the editor frame opens. Use to click
	 * toggles, expand sections, etc. before the snapshot is captured.
	 */
	postOpen?: (frame: Frame) => Promise<void>;
}

const SCENARIOS: Scenario[] = [
	{
		name: 'three-branch stack, current branch expanded (default)',
		snapshot: 'three-branch-current-expanded.png',
		seed: (repo) => {
			repo.createBranch({
				name: 'feat-a',
				base: TRUNK,
				commits: [{ message: 'add a', files: { 'a.txt': 'a\n' } }],
			});
			repo.createBranch({
				name: 'feat-b',
				base: 'feat-a',
				commits: [
					{ message: 'add b1', files: { 'b1.txt': 'b1\n' } },
					{ message: 'add b2', files: { 'b2.txt': 'b2\n' } },
				],
			});
			repo.createBranch({
				name: 'feat-c',
				base: 'feat-b',
				commits: [{ message: 'add c', files: { 'c.txt': 'c\n' } }],
			});
		},
	},
	{
		name: 'multiple sibling stacks sharing the trunk (issue #28)',
		snapshot: 'sibling-stacks.png',
		seed: (repo) => {
			// Three independent stacks all based on the trunk. All must
			// render, not only the current branch's stack.
			repo.createBranch({
				name: 'feat-a',
				base: TRUNK,
				commits: [{ message: 'add a', files: { 'a.txt': 'a\n' } }],
			});
			repo.createBranch({
				name: 'feat-b',
				base: TRUNK,
				commits: [{ message: 'add b', files: { 'b.txt': 'b\n' } }],
			});
			repo.createBranch({
				name: 'feat-c',
				base: TRUNK,
				commits: [{ message: 'add c', files: { 'c.txt': 'c\n' } }],
			});
			repo.gs('branch', 'checkout', 'feat-b');
		},
	},
	{
		name: 'branch with summarized changes expanded',
		snapshot: 'summarized-changes-expanded.png',
		seed: (repo) => {
			repo.createBranch({
				name: 'feat-a',
				base: TRUNK,
				commits: [
					{ message: 'add a.txt', files: { 'a.txt': 'a\n' } },
					{ message: 'add b.txt', files: { 'src/b.txt': 'b\n' } },
				],
			});
		},
		postOpen: async (frame) => {
			// Click the Summarized Changes toggle on the current branch
			// (feat-a is current, expanded by default).
			const toggle = frame.locator('.branch-summary-toggle').first();
			await toggle.waitFor({ state: 'visible', timeout: 10_000 });
			await toggle.click();
			// Wait for the file list to render.
			await frame.locator('.branch-summary-files .file-change').first().waitFor({ state: 'visible', timeout: 5_000 });
		},
	},
	{
		name: 'uncommitted changes card with staged + unstaged files',
		snapshot: 'uncommitted-card.png',
		seed: (repo) => {
			repo.createBranch({
				name: 'feat-a',
				base: TRUNK,
				commits: [{ message: 'add foo', files: { 'foo.txt': 'one\n' } }],
			});
			// One staged change (modify foo.txt + git add), one unstaged change (new file).
			repo.writeFile('foo.txt', 'one\ntwo\n');
			repo.git('add', 'foo.txt');
			repo.writeFile('bar.txt', 'fresh\n');
		},
	},
	{
		name: 'untracked branch card (created via git, not gs, currently checked out)',
		snapshot: 'untracked-branch.png',
		seed: (repo) => {
			// Create a real branch outside of gs and stay on it so the
			// untracked card appears (untrackedBranch === currentBranch).
			repo.git('checkout', '-b', 'feat-untracked');
			repo.writeFile('untracked.txt', 'hello\n');
			repo.git('add', '.');
			repo.git('commit', '-q', '-m', 'untracked commit');
		},
	},
	{
		name: 'restack-needed stack (parent has new commits)',
		snapshot: 'restack-needed.png',
		seed: (repo) => {
			repo.createBranch({
				name: 'feat-a',
				base: TRUNK,
				commits: [{ message: 'add a', files: { 'a.txt': 'a\n' } }],
			});
			repo.createBranch({
				name: 'feat-b',
				base: 'feat-a',
				commits: [{ message: 'add b', files: { 'b.txt': 'b\n' } }],
			});
			// Move main forward so feat-a/feat-b need restack.
			repo.git('checkout', TRUNK);
			repo.writeFile('trunk.txt', 'trunk advance\n');
			repo.git('add', '.');
			repo.git('commit', '-q', '-m', 'advance trunk');
			repo.gs('branch', 'checkout', 'feat-b');
		},
	},
];

for (const scenario of SCENARIOS) {
	test.describe(`full-pane: ${scenario.name}`, () => {
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
			await webview.locator('.stack-item, .untracked-branch-card').first().waitFor({
				state: 'visible',
				timeout: 30_000,
			});
			if (scenario.postOpen) await scenario.postOpen(webview);
			// Let React settle (initial-state message, summary loading, etc.).
			await vscode.workbench.waitForTimeout(500);
			const repoContainer = webview.locator('#repoContainer');
			await expect(repoContainer).toHaveScreenshot(scenario.snapshot);
		});
	});
}
