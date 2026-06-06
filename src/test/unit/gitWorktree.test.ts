/**
 * Integration test for git working-tree / git-dir resolution against a REAL
 * bare repository + linked worktree (issue #68).
 *
 * Reproduces the extension-side bug: the VS Code Git extension can hand us a
 * `rootUri` that, for a linked worktree of a bare repo, resolves into the bare
 * git-dir rather than the worktree's working directory. Running gs/git there
 * fails with `exit 128` (`cannot use bare repository` / `must be run in a work
 * tree`) even though the CLI works inside the worktree.
 *
 * `resolveWorkingTreeRoot` must return the worktree's working directory so
 * gs/git run exactly where the CLI would. `resolveGitDirs` must report the
 * per-worktree git-dir and the shared common dir separately so the file
 * watcher can observe both.
 *
 * These spawn real `git`; no VS Code instance is involved.
 */

import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveWorkingTreeRoot, resolveGitDirs } from '../../utils/git';

/** Runs git in `cwd` with bare-repo safety relaxed so worktree setup works anywhere. */
function git(cwd: string, args: string[]): string {
	return execFileSync('git', ['-c', 'safe.bareRepository=all', ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
	}).trim();
}

interface Fixture {
	root: string;
	bareDir: string;
	worktreeDir: string;
	worktreeGitDir: string;
}

/** Builds a bare repo with one commit on main, then a linked worktree checked out on main. */
function buildBareRepoWithWorktree(): Fixture {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'gs-worktree-')));
	const bareDir = join(root, 'bare.git');
	git(root, ['init', '--bare', bareDir]);

	const seed = join(root, 'seed');
	git(root, ['clone', bareDir, seed]);
	git(seed, ['config', 'user.email', 't@t.com']);
	git(seed, ['config', 'user.name', 'Test']);
	git(seed, ['commit', '--allow-empty', '-m', 'init']);
	git(seed, ['branch', '-M', 'main']);
	git(seed, ['push', 'origin', 'main']);

	const worktreeDir = join(root, 'wt-feature');
	git(bareDir, ['worktree', 'add', worktreeDir, 'main']);
	const worktreeGitDir = join(bareDir, 'worktrees', 'wt-feature');
	return { root, bareDir, worktreeDir, worktreeGitDir };
}

describe('git worktree resolution (issue #68)', () => {
	let fx: Fixture;

	before(() => {
		fx = buildBareRepoWithWorktree();
	});

	after(() => {
		rmSync(fx.root, { recursive: true, force: true });
	});

	describe('resolveWorkingTreeRoot', () => {
		it('returns the worktree working dir when given the worktree path', async () => {
			// gs/git run here exactly like the CLI does inside the worktree.
			assert.strictEqual(await resolveWorkingTreeRoot(fx.worktreeDir), fx.worktreeDir);
		});

		it('resolves up to the worktree root from a subdirectory', async () => {
			// VS Code may report a nested path; we must run gs at the work-tree root.
			const sub = join(fx.worktreeDir, 'src', 'nested');
			mkdirSync(sub, { recursive: true });
			assert.strictEqual(await resolveWorkingTreeRoot(sub), fx.worktreeDir);
		});

		it('falls back to the original path for a bare repo with no work tree', async () => {
			// A bare git-dir has no single work tree; resolution must not throw and
			// must return the input unchanged so error reporting stays meaningful.
			// (This is exactly the `exit 128` cwd the extension must avoid using.)
			assert.strictEqual(await resolveWorkingTreeRoot(fx.bareDir), fx.bareDir);
		});

		it('falls back to the original path for the worktree git-dir (no work tree there)', async () => {
			// The per-worktree gitdir under bare/worktrees/<name> is not itself a
			// work tree; resolution falls back rather than throwing.
			assert.strictEqual(await resolveWorkingTreeRoot(fx.worktreeGitDir), fx.worktreeGitDir);
		});

		it('falls back to the original path for a non-repo directory', async () => {
			assert.strictEqual(await resolveWorkingTreeRoot(fx.root), fx.root);
		});
	});

	describe('resolveGitDirs', () => {
		it('reports distinct per-worktree and common dirs for a worktree', async () => {
			const dirs = await resolveGitDirs(fx.worktreeDir);
			assert.ok(dirs, 'expected git dirs to resolve');
			assert.strictEqual(dirs.gitDir, fx.worktreeGitDir);
			assert.strictEqual(dirs.commonDir, fx.bareDir);
			assert.notStrictEqual(dirs.gitDir, dirs.commonDir);
		});

		it('reports equal dirs for a normal (non-worktree) clone', async () => {
			const dirs = await resolveGitDirs(join(fx.root, 'seed'));
			assert.ok(dirs, 'expected git dirs to resolve');
			assert.strictEqual(dirs.gitDir, dirs.commonDir);
			assert.strictEqual(dirs.gitDir, join(fx.root, 'seed', '.git'));
		});

		it('returns null for a non-repo directory', async () => {
			assert.strictEqual(await resolveGitDirs(fx.root), null);
		});
	});
});
