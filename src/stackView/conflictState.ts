/**
 * Conflict-resolution-in-progress detection.
 *
 * git-spice's `gs ll --json` does not surface a mid-rebase/merge state, so we
 * read it directly from the repository's git-dir. When a rebase or merge is in
 * flight git leaves well-known marker files behind; their presence means the
 * working copy is parked mid-operation and the user is resolving conflicts.
 *
 * We attribute the state to the branch the operation is FOR. During a rebase
 * git detaches HEAD, so `git branch --show-current` is empty — the branch name
 * lives in `rebase-merge/head-name` (or `rebase-apply/head-name`) as a
 * `refs/heads/<branch>` ref instead. For a merge/cherry-pick/revert HEAD stays
 * attached, so the passed-in current branch is the right answer.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveGitDirs } from '../utils/git';

/**
 * Markers (relative to the per-worktree git-dir) for operations that leave HEAD
 * ATTACHED to its branch — a conflicted merge, cherry-pick, or revert. In these
 * states the caller's current branch is the conflict branch.
 *
 * - `MERGE_HEAD` — an unresolved merge.
 * - `CHERRY_PICK_HEAD`, `REVERT_HEAD` — sequencer ops that can conflict.
 */
const ATTACHED_HEAD_MARKERS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD'] as const;

/**
 * Rebase state directories (relative to the git-dir). A rebase DETACHES HEAD, so
 * the branch being rebased is read from the `head-name` file inside, not from
 * the current branch. `rebase-merge` is the interactive/merge backend;
 * `rebase-apply` is the `am`/`--apply` backend.
 */
const REBASE_DIRS = ['rebase-merge', 'rebase-apply'] as const;

/** Resolves true when `markerPath` exists, false otherwise (any stat error). */
async function markerExists(markerPath: string): Promise<boolean> {
	try {
		await fs.access(markerPath);
		return true;
	} catch {
		return false;
	}
}

/** Reads `<gitDir>/<dir>/head-name` and returns the bare branch name, if present. */
async function readRebaseBranch(gitDir: string, dir: string): Promise<string | undefined> {
	try {
		const raw = await fs.readFile(path.join(gitDir, dir, 'head-name'), 'utf8');
		const ref = raw.trim();
		if (!ref) return undefined;
		return ref.replace(/^refs\/heads\//, '');
	} catch {
		return undefined;
	}
}

/** Returns the branch a parked rebase is rebasing, or undefined if no rebase. */
async function rebaseBranch(gitDir: string): Promise<string | undefined> {
	for (const dir of REBASE_DIRS) {
		const branch = await readRebaseBranch(gitDir, dir);
		if (branch) return branch;
	}
	return undefined;
}

/** Returns true if any attached-HEAD conflict marker (merge/cherry-pick/revert) exists. */
async function hasAttachedHeadConflict(gitDir: string): Promise<boolean> {
	const checks = ATTACHED_HEAD_MARKERS.map((m) => markerExists(path.join(gitDir, m)));
	return (await Promise.all(checks)).some(Boolean);
}

/**
 * Detects whether `cwd` is mid-rebase/merge and, if so, returns the branch the
 * conflict is being resolved on. A rebase reports its branch from rebase
 * metadata (HEAD is detached); a merge/cherry-pick/revert uses `currentBranch`.
 * Returns undefined when nothing is in flight or on any git/filesystem error —
 * detection must never take a repo refresh down.
 *
 * @param cwd - Repository working-tree root
 * @param currentBranch - Name of the checked-out branch, if known
 */
export async function detectConflictBranch(
	cwd: string | undefined,
	currentBranch: string | undefined,
): Promise<string | undefined> {
	if (!cwd) return undefined;
	try {
		const dirs = await resolveGitDirs(cwd);
		if (!dirs) return undefined;
		const rebasing = await rebaseBranch(dirs.gitDir);
		if (rebasing) return rebasing;
		return currentBranch && (await hasAttachedHeadConflict(dirs.gitDir)) ? currentBranch : undefined;
	} catch {
		return undefined;
	}
}
