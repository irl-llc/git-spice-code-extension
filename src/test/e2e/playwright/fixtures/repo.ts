/**
 * Test repository fixture: temp dir with git + pinned gs initialized.
 *
 * Each test gets its own throwaway repo. The path to the pinned gs binary
 * comes from GIT_SPICE_BIN (set by CI) or defaults to .gs/bin/gs at repo
 * root (set by `npm run gs:fetch`).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const GS_BIN = process.env.GIT_SPICE_BIN ?? resolve(REPO_ROOT, '.gs/bin/gs');

/** A single commit in a branch's history. */
export interface Commit {
	message: string;
	/** Files to write before committing — keyed by repo-relative path. */
	files: Record<string, string>;
}

/** A branch in the seeded stack. */
export interface BranchSpec {
	name: string;
	/** Base branch name. Defaults to the trunk. */
	base?: string;
	commits: Commit[];
}

/** A temp git+gs repo with helpers for staging stack state. */
export interface WorkspaceRepo {
	path: string;
	cleanup(): void;
	git(...args: string[]): string;
	gs(...args: string[]): string;
	writeFile(relPath: string, content: string): void;
	/** Initial setup: git init + initial trunk commit + `gs repo init`. */
	initTrunk(trunk: string): void;
	/** Create a branch with the given commits, stacked on `base` (or the trunk). */
	createBranch(spec: BranchSpec): void;
}

/**
 * Creates a fresh empty temp dir. Caller must call cleanup().
 *
 * `gsBinary` overrides which git-spice binary seeds the repo — pass the stock
 * binary (`.gs/bin/gs-stock`, via GIT_SPICE_STOCK_BIN) to seed a vanilla repo
 * for the beta-gating specs (issue #72). Defaults to the pinned ed-irl `gs`.
 */
export function createTempRepo(gsBinary: string = GS_BIN): WorkspaceRepo {
	const path = mkdtempSync(join(tmpdir(), 'gs-e2e-'));

	const git = (...args: string[]): string => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' });
	const gs = (...args: string[]): string => execFileSync(gsBinary, args, { cwd: path, encoding: 'utf8' });
	const writeFile = (relPath: string, content: string): void => {
		const abs = join(path, relPath);
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content);
	};

	const initTrunk = (trunk: string): void => {
		git('init', '-q', '-b', trunk);
		git('config', 'user.email', 'e2e@example.com');
		git('config', 'user.name', 'E2E Bot');
		writeFile('README.md', '# e2e\n');
		git('add', '.');
		git('commit', '-q', '-m', 'initial');
		gs('repo', 'init', '--trunk', trunk);
	};

	const createBranch = (spec: BranchSpec): void => {
		const base = spec.base;
		if (base) gs('branch', 'checkout', base);
		const [first, ...rest] = spec.commits;
		if (!first) throw new Error(`Branch ${spec.name} must have at least one commit`);

		writeFiles(writeFile, first.files);
		// `-a` won't pick up untracked files; explicit add first.
		git('add', '.');
		gs('branch', 'create', '-m', first.message, '--no-prompt', '--no-verify', spec.name);

		for (const commit of rest) {
			writeFiles(writeFile, commit.files);
			git('add', '.');
			gs('commit', 'create', '-m', commit.message, '--no-prompt', '--no-verify');
		}
	};

	return {
		path,
		git,
		gs,
		writeFile,
		initTrunk,
		createBranch,
		cleanup: () => rmSync(path, { recursive: true, force: true }),
	};
}

function writeFiles(write: (p: string, c: string) => void, files: Record<string, string>): void {
	for (const [path, content] of Object.entries(files)) {
		write(path, content);
	}
}

/** A bare repository plus a linked worktree checked out and gs-initialized (issue #68). */
export interface BareRepoWorktree {
	/** Path to the bare repository (`*.git`). */
	barePath: string;
	/** Path to the linked worktree working directory — open this as the workspace. */
	worktreePath: string;
	cleanup(): void;
	git(...args: string[]): string;
	gs(...args: string[]): string;
}

/**
 * Creates a bare repo with an initial trunk commit, adds a linked worktree, and
 * runs `gs repo init` inside the worktree. Opening {@link BareRepoWorktree.worktreePath}
 * as the VS Code workspace reproduces issue #68's environment.
 */
export function createBareRepoWorktree(trunk: string): BareRepoWorktree {
	const root = mkdtempSync(join(tmpdir(), 'gs-e2e-wt-'));
	const barePath = join(root, 'repo.git');
	const seed = join(root, 'seed');
	const worktreePath = join(root, 'worktree');

	const runGit = (cwd: string, ...args: string[]): string =>
		execFileSync('git', ['-c', 'safe.bareRepository=all', '-C', cwd, ...args], { encoding: 'utf8' });

	execFileSync('git', ['init', '--bare', '-b', trunk, barePath], { encoding: 'utf8' });
	execFileSync('git', ['clone', barePath, seed], { encoding: 'utf8' });
	runGit(seed, 'config', 'user.email', 'e2e@example.com');
	runGit(seed, 'config', 'user.name', 'E2E Bot');
	runGit(seed, 'commit', '--allow-empty', '-q', '-m', 'initial');
	runGit(seed, 'push', '-q', 'origin', trunk);
	runGit(barePath, 'worktree', 'add', worktreePath, trunk);
	// The linked worktree is off the bare repo, which never got an identity (only
	// the seed clone did); set one here so `gs branch create` can commit in CI.
	runGit(worktreePath, 'config', 'user.email', 'e2e@example.com');
	runGit(worktreePath, 'config', 'user.name', 'E2E Bot');

	const git = (...args: string[]): string => runGit(worktreePath, ...args);
	const gs = (...args: string[]): string => execFileSync(GS_BIN, args, { cwd: worktreePath, encoding: 'utf8' });
	gs('repo', 'init', '--trunk', trunk);

	return {
		barePath,
		worktreePath,
		git,
		gs,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}
