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

/** Creates a fresh empty temp dir. Caller must call cleanup(). */
export function createTempRepo(): WorkspaceRepo {
	const path = mkdtempSync(join(tmpdir(), 'gs-e2e-'));

	const git = (...args: string[]): string => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' });
	const gs = (...args: string[]): string => execFileSync(GS_BIN, args, { cwd: path, encoding: 'utf8' });
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
