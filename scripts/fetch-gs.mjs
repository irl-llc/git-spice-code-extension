#!/usr/bin/env node
// Fetches and builds the pinned `gs` binary from ed-irl/git-spice into .gs/bin/gs.
// Idempotent: skips work if .gs/.built-sha already matches the pin in .gs-version.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const GS_DIR = resolve(REPO_ROOT, '.gs');
const SRC_DIR = resolve(GS_DIR, 'src');
const BIN_DIR = resolve(GS_DIR, 'bin');
const BIN_PATH = resolve(BIN_DIR, 'gs');
const BUILT_SHA_PATH = resolve(GS_DIR, '.built-sha');
const VERSION_FILE = resolve(REPO_ROOT, '.gs-version');
const UPSTREAM = 'https://github.com/ed-irl/git-spice';
// The shamhub test helper lives in this repo but must be built from inside the
// gs module (shamhub is an `internal/` package). We copy it into the cloned
// source tree and build it alongside gs. See scripts/shamhub-server/main.go.
const SHAMHUB_SRC = resolve(REPO_ROOT, 'scripts/shamhub-server/main.go');
const SHAMHUB_PKG_DIR = resolve(SRC_DIR, 'cmd/shamhub-server');
const SHAMHUB_BIN = resolve(BIN_DIR, 'shamhub-server');
// Registers the shamhub forge into the gs binary; copied into the module root.
const SHAMHUB_REGISTER_SRC = resolve(REPO_ROOT, 'scripts/shamhub-register.go');
const SHAMHUB_REGISTER_DEST = resolve(SRC_DIR, 'zz_shamhub_register.go');

/**
 * Build marker = pinned SHA + a hash of the injected Go sources. Changing the
 * helper or forge-registration source busts the cached `.gs` build.
 */
function buildMarker(pinnedSha) {
	const hash = createHash('sha256');
	for (const f of [SHAMHUB_SRC, SHAMHUB_REGISTER_SRC]) {
		hash.update(existsSync(f) ? readFileSync(f) : Buffer.alloc(0));
	}
	return `${pinnedSha}:${hash.digest('hex').slice(0, 12)}`;
}

function fail(msg) {
	console.error(`fetch-gs: ${msg}`);
	process.exit(1);
}

function readPinnedSha() {
	if (!existsSync(VERSION_FILE)) {
		fail(`Missing .gs-version at repo root. Expected ${VERSION_FILE}`);
	}
	const sha = readFileSync(VERSION_FILE, 'utf8').trim();
	if (!/^[0-9a-f]{40}$/i.test(sha)) {
		fail(`Invalid SHA in .gs-version: "${sha}" — must be a full 40-char commit SHA`);
	}
	return sha;
}

function readBuiltSha() {
	if (!existsSync(BUILT_SHA_PATH)) return null;
	return readFileSync(BUILT_SHA_PATH, 'utf8').trim();
}

function run(cmd, args, opts = {}) {
	const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
	if (result.status !== 0) {
		fail(`Command failed (${result.status}): ${cmd} ${args.join(' ')}`);
	}
}

function requireGo() {
	const r = spawnSync('go', ['version'], { stdio: 'pipe' });
	if (r.status !== 0) {
		fail('go is required to build gs. Install Go 1.22+ and retry.');
	}
}

function fetchSource(sha) {
	// Blow away any prior partial state for a clean fetch. Cheap because shallow.
	if (existsSync(SRC_DIR)) {
		rmSync(SRC_DIR, { recursive: true, force: true });
	}
	mkdirSync(SRC_DIR, { recursive: true });
	run('git', ['init', '--quiet', SRC_DIR]);
	run('git', ['-C', SRC_DIR, 'remote', 'add', 'origin', UPSTREAM]);
	// GitHub allows fetching specific SHAs by id with depth=1.
	run('git', ['-C', SRC_DIR, 'fetch', '--depth', '1', '--quiet', 'origin', sha]);
	run('git', ['-C', SRC_DIR, 'checkout', '--quiet', sha]);
}

function buildBinary() {
	mkdirSync(BIN_DIR, { recursive: true });
	// Inject the shamhub forge registration into the (test-only) gs binary.
	if (!existsSync(SHAMHUB_REGISTER_SRC)) {
		fail(`Missing shamhub registration source at ${SHAMHUB_REGISTER_SRC}`);
	}
	copyFileSync(SHAMHUB_REGISTER_SRC, SHAMHUB_REGISTER_DEST);
	// git-spice's main package lives at the module root.
	run('go', ['build', '-o', BIN_PATH, '.'], { cwd: SRC_DIR });
	if (!existsSync(BIN_PATH)) {
		fail(`go build succeeded but ${BIN_PATH} is missing`);
	}
}

// Builds the shamhub test helper into .gs/bin/shamhub-server by copying its
// source into the gs module (so the `internal/` import resolves) and building.
function buildShamhubHelper() {
	if (!existsSync(SHAMHUB_SRC)) {
		fail(`Missing shamhub helper source at ${SHAMHUB_SRC}`);
	}
	mkdirSync(SHAMHUB_PKG_DIR, { recursive: true });
	copyFileSync(SHAMHUB_SRC, resolve(SHAMHUB_PKG_DIR, 'main.go'));
	run('go', ['build', '-o', SHAMHUB_BIN, './cmd/shamhub-server'], { cwd: SRC_DIR });
	if (!existsSync(SHAMHUB_BIN)) {
		fail(`go build succeeded but ${SHAMHUB_BIN} is missing`);
	}
}

function main() {
	const pinnedSha = readPinnedSha();
	const marker = buildMarker(pinnedSha);
	const builtSha = readBuiltSha();
	if (existsSync(BIN_PATH) && existsSync(SHAMHUB_BIN) && builtSha === marker) {
		console.log(`fetch-gs: ${BIN_PATH} and ${SHAMHUB_BIN} already built at ${marker}`);
		return;
	}
	console.log(`fetch-gs: building gs at ${pinnedSha}`);
	requireGo();
	fetchSource(pinnedSha);
	buildBinary();
	buildShamhubHelper();
	writeFileSync(BUILT_SHA_PATH, marker + '\n');
	console.log(`fetch-gs: built ${BIN_PATH} and ${SHAMHUB_BIN}`);
}

main();
