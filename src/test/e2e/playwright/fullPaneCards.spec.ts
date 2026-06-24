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

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { expect, test, type Frame } from '@playwright/test';

import { createTempRepo, type WorkspaceRepo } from './fixtures/repo';
import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { openGitSpiceEditor } from './fixtures/webview';

const TRUNK = 'main';

/**
 * Fixed absolute path for the parked-worktree scenario. Constant (not the
 * per-run temp dir) so both the badge basename AND its hash-derived color slot
 * are byte-stable across snapshot runs. Removed in afterAll.
 */
const PARKED_WORKTREE_PATH = join(tmpdir(), 'gs-e2e-worktree-review');

interface Scenario {
	name: string;
	snapshot: string;
	seed: (repo: WorkspaceRepo) => void;
	/**
	 * Per-scenario hook run after the editor frame opens. Use to click
	 * toggles, expand sections, etc. before the snapshot is captured.
	 */
	postOpen?: (frame: Frame) => Promise<void>;
	/** Extra teardown beyond the temp repo (e.g. an external worktree dir). */
	cleanupExtra?: () => void;
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
	{
		name: 'conflict-resolution-in-progress card (red border, issue #81)',
		snapshot: 'conflict-in-progress.png',
		seed: seedConflictInProgress,
	},
	{
		name: 'branch parked in another worktree shows a worktree badge (issue #111)',
		snapshot: 'worktree-badge.png',
		seed: seedParkedWorktree,
		cleanupExtra: () => rmSync(PARKED_WORKTREE_PATH, { recursive: true, force: true }),
	},
];

/**
 * Parks feat-a in a separate git worktree so `gs ll -a --json` reports a
 * `worktree` path on it, driving the worktree badge on feat-a's card. feat-b
 * (current) stays checked out in the main worktree.
 */
function seedParkedWorktree(repo: WorkspaceRepo): void {
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
	// Remove any stale dir from a previous run, then park feat-a elsewhere.
	rmSync(PARKED_WORKTREE_PATH, { recursive: true, force: true });
	repo.git('worktree', 'add', PARKED_WORKTREE_PATH, 'feat-a');
	repo.gs('branch', 'checkout', 'feat-b');
}

/**
 * Parks a real rebase on a conflict so the current branch's card shows the
 * red conflict border. feat-a edits `shared.txt`; trunk then edits the same
 * line, so restacking feat-a onto trunk stops mid-rebase (REBASE_HEAD lives in
 * the git-dir) — exactly the state {@link detectConflictBranch} flags.
 */
function seedConflictInProgress(repo: WorkspaceRepo): void {
	repo.createBranch({
		name: 'feat-a',
		base: TRUNK,
		commits: [{ message: 'edit shared', files: { 'shared.txt': 'from feature\n' } }],
	});
	repo.git('checkout', TRUNK);
	repo.writeFile('shared.txt', 'from trunk\n');
	repo.git('add', '.');
	repo.git('commit', '-q', '-m', 'conflicting trunk edit');
	repo.git('checkout', 'feat-a');
	// The rebase conflicts and parks mid-operation; the non-zero exit is expected.
	try {
		repo.git('rebase', TRUNK);
	} catch {
		// Intended: git stops on the conflict, leaving the rebase in progress.
	}
}

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
			scenario.cleanupExtra?.();
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
