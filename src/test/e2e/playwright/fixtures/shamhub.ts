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

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SHAMHUB_BIN = process.env.SHAMHUB_BIN ?? resolve(REPO_ROOT, '.gs/bin/shamhub-server');

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
		seedComment: (change, resolved, body) => seedComment(child, pendingReplies, change, resolved, body),
		close: () => closeChild(child),
	};
}

function seedComment(
	child: ChildProcessByStdio<Writable, Readable, Readable>,
	pendingReplies: Array<(line: string) => void>,
	change: number,
	resolved: boolean,
	body: string,
): Promise<void> {
	return new Promise<void>((res, rej) => {
		pendingReplies.push((line) => (line.startsWith('OK') ? res() : rej(new Error(`seed comment failed: ${line}`))));
		child.stdin.write(`comment ${change} ${resolved ? 'resolved' : 'unresolved'} ${body}\n`);
	});
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
