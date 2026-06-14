/**
 * Unit tests for conflict-resolution-in-progress detection (issue #81).
 *
 * These exercise the real filesystem/git behaviour against a throwaway repo:
 * we provoke an actual rebase conflict so a `rebase-merge` marker exists in the
 * git-dir, then assert detection flags the current branch — and that a clean
 * repo, an aborted rebase, and a non-repo path all report "no conflict".
 */

import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { detectConflictBranch } from '../../stackView/conflictState';

/** Runs git in `cwd` with global/system config neutralized for determinism. */
function git(cwd: string, args: string[]): string {
	return execFileSync('git', args, {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
	}).trim();
}

/** Runs git tolerating a non-zero exit (e.g. a rebase that stops on a conflict). */
function gitAllowFail(cwd: string, args: string[]): void {
	try {
		git(cwd, args);
	} catch {
		// Expected: a conflicting rebase exits non-zero and parks mid-operation.
	}
}

/** Commits a single-line file `f.txt` with `content` on the current branch. */
function commitLine(cwd: string, content: string, message: string): void {
	writeFileSync(join(cwd, 'f.txt'), content);
	git(cwd, ['add', 'f.txt']);
	git(cwd, ['commit', '-m', message]);
}

/**
 * Builds a repo with trunk + a `feature` branch whose `f.txt` conflicts with a
 * later trunk change, so rebasing `feature` onto trunk parks on a conflict.
 */
function buildRepoWithConflict(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'gs-conflict-')));
	git(root, ['init']);
	git(root, ['config', 'user.email', 't@t.com']);
	git(root, ['config', 'user.name', 'Test']);
	git(root, ['branch', '-M', 'main']);
	commitLine(root, 'base\n', 'base');
	git(root, ['checkout', '-b', 'feature']);
	commitLine(root, 'feature change\n', 'feature');
	git(root, ['checkout', 'main']);
	commitLine(root, 'trunk change\n', 'trunk');
	git(root, ['checkout', 'feature']);
	gitAllowFail(root, ['rebase', 'main']); // conflicts → parks on `feature`
	return root;
}

/**
 * Builds a repo parked on a MERGE conflict (HEAD stays attached to `main`):
 * `feature` and `main` edit the same line, then merging `feature` into `main`
 * conflicts and leaves MERGE_HEAD behind.
 */
function buildRepoWithMergeConflict(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), 'gs-merge-')));
	git(root, ['init']);
	git(root, ['config', 'user.email', 't@t.com']);
	git(root, ['config', 'user.name', 'Test']);
	git(root, ['branch', '-M', 'main']);
	commitLine(root, 'base\n', 'base');
	git(root, ['checkout', '-b', 'feature']);
	commitLine(root, 'feature change\n', 'feature');
	git(root, ['checkout', 'main']);
	commitLine(root, 'trunk change\n', 'trunk');
	gitAllowFail(root, ['merge', 'feature']); // conflicts → MERGE_HEAD on `main`
	return root;
}

describe('conflictState.detectConflictBranch (issue #81)', () => {
	it('returns the rebased branch when a rebase is parked on a conflict', async () => {
		// A rebase detaches HEAD, so the branch is read from rebase metadata,
		// not from the passed-in current branch.
		const root = buildRepoWithConflict();
		try {
			assert.strictEqual(await detectConflictBranch(root, undefined), 'feature');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('returns the current branch when a merge is parked on a conflict', async () => {
		// A merge keeps HEAD attached, so the current branch is the conflict branch.
		const root = buildRepoWithMergeConflict();
		try {
			assert.strictEqual(await detectConflictBranch(root, 'main'), 'main');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('returns undefined once the rebase is aborted (markers cleared)', async () => {
		const root = buildRepoWithConflict();
		try {
			git(root, ['rebase', '--abort']);
			assert.strictEqual(await detectConflictBranch(root, 'feature'), undefined);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('returns undefined for a clean repo with no operation in flight', async () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), 'gs-clean-')));
		try {
			git(root, ['init']);
			git(root, ['config', 'user.email', 't@t.com']);
			git(root, ['config', 'user.name', 'Test']);
			git(root, ['branch', '-M', 'main']);
			commitLine(root, 'base\n', 'base');
			assert.strictEqual(await detectConflictBranch(root, 'main'), undefined);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('returns undefined when cwd is undefined', async () => {
		assert.strictEqual(await detectConflictBranch(undefined, 'feature'), undefined);
	});

	it('returns undefined for a merge conflict when the current branch is unknown', async () => {
		// The merge path needs the current branch (HEAD is attached); without it
		// there is nothing to attribute the conflict to.
		const root = buildRepoWithMergeConflict();
		try {
			assert.strictEqual(await detectConflictBranch(root, undefined), undefined);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('returns undefined for a path that is not a git repository', async () => {
		const root = realpathSync(mkdtempSync(join(tmpdir(), 'gs-norepo-')));
		try {
			assert.strictEqual(await detectConflictBranch(root, 'main'), undefined);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
