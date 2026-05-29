/**
 * Visual snapshot tests for the tree fragment SVG (left-side stack
 * visualization). Each describe block seeds a distinct stack shape so
 * we exercise the imperative SVG generator's branches: linear lanes,
 * sibling forks, current-branch styling, and the uncommitted node.
 *
 * Snapshots are Linux-rendered (via the playwright Docker compose
 * service); regen with `npm run test:e2e:playwright:docker:update`.
 * Running this spec natively on macOS will diff against the Linux
 * baselines and fail — that's expected.
 */

import { expect, test } from '@playwright/test';

import { createTempRepo, type WorkspaceRepo } from './fixtures/repo';
import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { collapseSidebarSiblings, openGitSpiceView, setSidebarWidth } from './fixtures/webview';

const TRUNK = 'main';

interface Scenario {
	name: string;
	snapshot: string;
	seed: (repo: WorkspaceRepo) => void;
}

const SCENARIOS: Scenario[] = [
	{
		name: 'linear 2-branch stack (current = feat-a)',
		snapshot: 'linear-2-branch.png',
		seed: (repo) => {
			repo.createBranch({
				name: 'feat-a',
				base: TRUNK,
				commits: [{ message: 'add foo', files: { 'foo.txt': 'one\n' } }],
			});
		},
	},
	{
		name: 'linear 3-branch stack (current = feat-c)',
		snapshot: 'linear-3-branch.png',
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
			repo.createBranch({
				name: 'feat-c',
				base: 'feat-b',
				commits: [{ message: 'add c', files: { 'c.txt': 'c\n' } }],
			});
		},
	},
	{
		name: 'sibling fork (feat-a and feat-b both off main, current = feat-b)',
		snapshot: 'sibling-fork.png',
		seed: (repo) => {
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
		},
	},
	{
		name: 'with uncommitted changes node',
		snapshot: 'with-uncommitted.png',
		seed: (repo) => {
			repo.createBranch({
				name: 'feat-a',
				base: TRUNK,
				commits: [{ message: 'add foo', files: { 'foo.txt': 'one\n' } }],
			});
			// Leave an unstaged file in the working directory so the
			// uncommitted-changes pseudo-branch appears with its dashed node.
			repo.writeFile('uncommitted.txt', 'work in progress\n');
		},
	},
];

for (const scenario of SCENARIOS) {
	test.describe(`tree fragment: ${scenario.name}`, () => {
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
			const webview = await openGitSpiceView(vscode.workbench);
			// Give the Git Spice section the full sidebar height so
			// multi-branch stacks fit, and widen the sidebar enough that
			// cards aren't horizontally clipped. Without this every
			// scenario with 3+ rows (linear-3, sibling-fork,
			// with-uncommitted) crops feat-a / main off the bottom and
			// the snapshot no longer demonstrates what its name claims.
			await collapseSidebarSiblings(vscode.workbench, 'Git Spice');
			await setSidebarWidth(vscode.workbench, 500);
			const branchList = webview.locator('.repo-branch-list');
			await expect(branchList.locator('.stack-item').first()).toBeVisible({ timeout: 30_000 });
			// Webview-side React may still be processing the initial state
			// message; give it a tick to settle before snapshotting.
			await vscode.workbench.waitForTimeout(500);
			await expect(branchList).toHaveScreenshot(scenario.snapshot);
		});
	});
}
