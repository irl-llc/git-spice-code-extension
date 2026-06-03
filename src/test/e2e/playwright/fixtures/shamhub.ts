/**
 * Fixture that runs git-spice's "shamhub" fake forge as a child process so
 * Playwright tests can drive the real `gs` binary against it (submit, comment
 * counts). The helper binary is built by `scripts/fetch-gs.mjs` from
 * `scripts/shamhub-server/main.go`.
 *
 * The helper provisions a fixed `alice/example` repo and speaks a line
 * protocol on stdio (see shamhub-server/main.go). This module wraps that:
 * read the URLs at startup, expose `env` to point `gs` at the forge, and
 * `seedComment` to post resolvable PR comments after submit.
 */

import { spawn, execFileSync, type ChildProcessByStdio } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Readable, Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SHAMHUB_BIN = process.env.SHAMHUB_BIN ?? resolve(REPO_ROOT, '.gs/bin/shamhub-server');
const GS_BIN = process.env.GIT_SPICE_BIN ?? resolve(REPO_ROOT, '.gs/bin/gs');
const TRUNK = 'main';

/** Environment variables that point `gs` (and git) at this shamhub instance. */
export interface ShamhubEnv {
	SHAMHUB_URL: string;
	SHAMHUB_API_URL: string;
	SHAMHUB_USERNAME: string;
	/** Force the file-based secret stash so `gs auth login` persists headlessly. */
	GIT_SPICE_SECRET_BACKEND: string;
}

/** A running shamhub server with seeding controls. */
export interface ShamhubServer {
	/** Git remote URL for the provisioned `alice/example` repo. */
	repoUrl: string;
	env: ShamhubEnv;
	/** Posts a resolvable comment on a change; `resolved` drives the counts. */
	seedComment(change: number, resolved: boolean, body: string): Promise<void>;
	/** Marks a change merged (its CR status becomes "merged"). */
	mergeChange(change: number): Promise<void>;
	/** Rejects a change without merging (its CR status becomes "closed"). */
	closeChange(change: number): Promise<void>;
	close(): Promise<void>;
}

const READY_TIMEOUT_MS = 15_000;

/** Starts the shamhub helper and resolves once it reports READY. */
export async function startShamhub(): Promise<ShamhubServer> {
	const child = spawn(SHAMHUB_BIN, [], { stdio: ['pipe', 'pipe', 'pipe'] });
	const vars: Record<string, string> = {};
	const pendingReplies: Array<(line: string) => void> = [];
	let ready = false;

	let stderr = '';
	child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));

	const readyPromise = new Promise<void>((resolveReady, rejectReady) => {
		createInterface({ input: child.stdout }).on('line', (line) => {
			if (!ready) {
				if (line === 'READY') {
					ready = true;
					resolveReady();
					return;
				}
				const eq = line.indexOf('=');
				if (eq > 0) vars[line.slice(0, eq)] = line.slice(eq + 1);
				return;
			}
			pendingReplies.shift()?.(line);
		});
		child.on('error', rejectReady);
		child.on('exit', (code) => {
			if (!ready) rejectReady(new Error(`shamhub-server exited (${code}) before ready: ${stderr}`));
		});
	});

	await withTimeout(readyPromise, READY_TIMEOUT_MS, () => `shamhub-server not ready: ${stderr}`);

	return {
		repoUrl: vars.REPO_URL,
		env: {
			SHAMHUB_URL: vars.SHAMHUB_URL,
			SHAMHUB_API_URL: vars.SHAMHUB_API_URL,
			SHAMHUB_USERNAME: 'alice',
			GIT_SPICE_SECRET_BACKEND: 'file',
		},
		seedComment: (change, resolved, body) => seedComment({ child, pendingReplies }, change, resolved, body),
		mergeChange: (change) => sendCommand({ child, pendingReplies }, `merge ${change}`),
		closeChange: (change) => sendCommand({ child, pendingReplies }, `close ${change}`),
		close: () => closeChild(child),
	};
}

/** stdio channel to the shamhub helper: the process and its reply queue. */
interface ShamhubChannel {
	child: ChildProcessByStdio<Writable, Readable, Readable>;
	pendingReplies: Array<(line: string) => void>;
}

/** Writes one line-protocol command and resolves when the server replies OK. */
function sendCommand(channel: ShamhubChannel, command: string): Promise<void> {
	return new Promise<void>((res, rej) => {
		channel.pendingReplies.push((line) =>
			line.startsWith('OK') ? res() : rej(new Error(`shamhub '${command.split(' ')[0]}' failed: ${line}`)),
		);
		channel.child.stdin.write(`${command}\n`);
	});
}

function seedComment(channel: ShamhubChannel, change: number, resolved: boolean, body: string): Promise<void> {
	return sendCommand(channel, `comment ${change} ${resolved ? 'resolved' : 'unresolved'} ${body}`);
}

function closeChild(child: ChildProcessByStdio<Writable, Readable, Readable>): Promise<void> {
	return new Promise<void>((res) => {
		const forceKill = setTimeout(() => child.kill('SIGKILL'), 3000);
		child.on('exit', () => {
			clearTimeout(forceKill);
			res();
		});
		child.stdin.on('error', () => {});
		child.stdin.write('quit\n');
		child.stdin.end();
	});
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: () => string): Promise<T> {
	return Promise.race([promise, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(message())), ms))]);
}

/** Options for seeding a submitted stack against a fresh shamhub instance. */
export interface SeedStackOptions {
	/** Branch names to create on top of trunk, bottom-to-top. */
	branches: string[];
	/** Trunk branch name. Defaults to `main`. */
	trunk?: string;
	/** Pass `--fill` to `gs stack submit` so CR bodies are auto-filled. Default true. */
	submit?: boolean;
	/**
	 * When true, each branch gets a multi-line file and a second commit, so the
	 * webview's "Summarized Changes" button renders (it requires >1 commit) and
	 * line-anchored inline comments have real lines to attach to. Default false
	 * to preserve the simple single-commit shape other specs depend on.
	 */
	multiCommit?: boolean;
}

/** A running shamhub + a local repo with a submitted stack, ready for VS Code. */
export interface ShamhubStack {
	shamhub: ShamhubServer;
	/** Filesystem path to the seeded git repo. */
	repoPath: string;
	/** Env that points VS Code, `gs`, and git at this shamhub instance. */
	env: Record<string, string>;
	/**
	 * Posts an inline forge comment end-to-end via `gs branch comment add`,
	 * which writes through shamhub so `gs branch comment list --json` (and the
	 * extension's CommentController) then surface it. `anchor` follows the gs
	 * grammar: `file.txt:42` for a line, `file.txt` for a file, or `undefined`
	 * for a whole-PR comment (`--pr`).
	 */
	addInlineComment(branch: string, anchor: string | undefined, body: string): void;
	/** Removes the temp repo and home dirs. Call shamhub.close() separately. */
	cleanup(): void;
}

/** Runs `gs branch comment add` in the seeded repo to post an inline comment. */
function postInlineComment(
	runners: RepoRunners,
	branch: string,
	anchor: string | undefined,
	body: string,
): void {
	const head = ['branch', 'comment', 'add', '--branch', branch];
	const tail = anchor === undefined ? ['--pr', '-m', body] : [anchor, '-m', body];
	runners.gs(...head, ...tail);
}

/** Bound git/gs runners plus a file writer, all scoped to one repo + env. */
interface RepoRunners {
	git(...args: string[]): void;
	gs(...args: string[]): void;
	write(rel: string, content: string): void;
}

/**
 * Starts shamhub and seeds a submitted stack: `gs repo init` -> add remote ->
 * push trunk -> `gs auth login` -> create each branch -> `gs stack submit`.
 * Mirrors git-spice's own testscripts so every spec is a few lines.
 */
export async function seedShamhubStack(options: SeedStackOptions): Promise<ShamhubStack> {
	const shamhub = await startShamhub();
	const repoPath = mkdtempSync(join(tmpdir(), 'gs-shamhub-'));
	const home = mkdtempSync(join(tmpdir(), 'gs-shamhub-home-'));
	try {
		const env = buildStackEnv(home, shamhub.env);
		const runners = createRepoRunners(repoPath, env);
		seedStackRepo(runners, shamhub.repoUrl, options);
		return {
			shamhub,
			repoPath,
			env,
			addInlineComment: (branch, anchor, body) => postInlineComment(runners, branch, anchor, body),
			cleanup: () => cleanupDirs(repoPath, home),
		};
	} catch (error) {
		// Setup threw partway through: don't leak the shamhub child or temp dirs.
		await shamhub.close();
		cleanupDirs(repoPath, home);
		throw error;
	}
}

/** init -> push trunk -> create branches -> submit, against an already-started shamhub. */
function seedStackRepo(runners: RepoRunners, repoUrl: string, options: SeedStackOptions): void {
	const trunk = options.trunk ?? TRUNK;
	initAndPushTrunk(runners, repoUrl, trunk);
	for (const name of options.branches) createSubmittableBranch(runners, name, options.multiCommit ?? false);
	if (options.submit ?? true) runners.gs('stack', 'submit', '--fill');
}

/** Env pointing VS Code, `gs`, and git at the shared shamhub home + forge. */
function buildStackEnv(home: string, shamhubEnv: ShamhubEnv): Record<string, string> {
	return {
		...shamhubEnv,
		HOME: home,
		XDG_CONFIG_HOME: join(home, '.config'),
		GIT_SPICE_BIN: GS_BIN,
	};
}

/** Binds git/gs/write helpers to one repo + env (env merged onto process.env). */
function createRepoRunners(repoPath: string, env: Record<string, string>): RepoRunners {
	const execEnv = { ...process.env, ...env };
	return {
		git: (...a) => void execFileSync('git', ['-C', repoPath, ...a], { env: execEnv }),
		gs: (...a) => void execFileSync(GS_BIN, a, { cwd: repoPath, env: execEnv }),
		write: (rel, content) => {
			const abs = join(repoPath, rel);
			mkdirSync(dirname(abs), { recursive: true });
			writeFileSync(abs, content);
		},
	};
}

/** git init -> trunk commit -> gs repo init -> add shamhub remote -> push -> auth. */
function initAndPushTrunk(runners: RepoRunners, repoUrl: string, trunk: string): void {
	const { git, gs } = runners;
	git('init', '-q', '-b', trunk);
	git('config', 'user.email', 'e2e@example.com');
	git('config', 'user.name', 'E2E Bot');
	git('commit', '-q', '--allow-empty', '-m', 'Initial commit');
	gs('repo', 'init', '--trunk', trunk);
	git('remote', 'add', 'origin', repoUrl);
	git('push', '-q', 'origin', trunk);
	gs('auth', 'login');
}

/**
 * Writes a one-file commit and creates a tracked branch ready for submit. When
 * `multiCommit` is set, the file is multi-line and a second commit is added so
 * the branch has >1 commit (Summarized Changes button) and real lines for
 * inline-comment anchors.
 */
function createSubmittableBranch(runners: RepoRunners, name: string, multiCommit: boolean): void {
	const initial = multiCommit ? `${name} line 1\n${name} line 2\n${name} line 3\n` : `${name}\n`;
	runners.write(`${name}.txt`, initial);
	runners.git('add', '.');
	runners.gs('branch', 'create', '-m', name, '--no-prompt', '--no-verify', name);
	if (!multiCommit) return;
	runners.write(`${name}.txt`, `${initial}${name} line 4\n`);
	runners.git('add', '.');
	runners.gs('commit', 'create', '-m', `${name} second commit`, '--no-verify');
}

function cleanupDirs(...dirs: string[]): void {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
