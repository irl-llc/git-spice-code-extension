#!/usr/bin/env node
// Fetches and builds two `gs` binaries:
//   .gs/bin/gs        — pinned ed-irl/git-spice build (SHA in .gs-version) with
//                       the shamhub forge + beta integration feature compiled in.
//   .gs/bin/gs-stock  — VANILLA upstream abhinav/git-spice build at the release
//                       tag in .gs-stock-version. Used to prove the extension's
//                       beta surfaces (integration command group, forge-status)
//                       stay gated OFF against a stock binary. See issue #72.
// Idempotent: each build skips when its build marker already matches the pin.

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
// Vanilla upstream sources + build marker for the stock binary (issue #72).
const STOCK_SRC_DIR = resolve(GS_DIR, 'src-stock');
const STOCK_BIN_PATH = resolve(BIN_DIR, 'gs-stock');
const STOCK_BUILT_TAG_PATH = resolve(GS_DIR, '.built-stock-tag');
const STOCK_VERSION_FILE = resolve(REPO_ROOT, '.gs-stock-version');
const STOCK_UPSTREAM = 'https://github.com/abhinav/git-spice';
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

function readStockTag() {
	if (!existsSync(STOCK_VERSION_FILE)) {
		fail(`Missing .gs-stock-version at repo root. Expected ${STOCK_VERSION_FILE}`);
	}
	const tag = readFileSync(STOCK_VERSION_FILE, 'utf8').trim();
	if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
		fail(`Invalid tag in .gs-stock-version: "${tag}" — must be a release tag like "v0.29.0"`);
	}
	return tag;
}

function readBuiltStockTag() {
	if (!existsSync(STOCK_BUILT_TAG_PATH)) return null;
	return readFileSync(STOCK_BUILT_TAG_PATH, 'utf8').trim();
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

function fetchSource(srcDir, remote, ref) {
	// Blow away any prior partial state for a clean fetch. Cheap because shallow.
	if (existsSync(srcDir)) {
		rmSync(srcDir, { recursive: true, force: true });
	}
	mkdirSync(srcDir, { recursive: true });
	run('git', ['init', '--quiet', srcDir]);
	run('git', ['-C', srcDir, 'remote', 'add', 'origin', remote]);
	// GitHub allows fetching a specific SHA or tag ref by id with depth=1.
	run('git', ['-C', srcDir, 'fetch', '--depth', '1', '--quiet', 'origin', ref]);
	run('git', ['-C', srcDir, 'checkout', '--quiet', 'FETCH_HEAD']);
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

// Builds the VANILLA upstream gs into .gs/bin/gs-stock from a pinned release
// tag. No shamhub registration and no beta integration patches are injected:
// this is exactly what a user on a stock install would run, so tests can prove
// the extension's beta surfaces stay gated OFF against it (issue #72).
function buildStockBinary() {
	mkdirSync(BIN_DIR, { recursive: true });
	run('go', ['build', '-o', STOCK_BIN_PATH, '.'], { cwd: STOCK_SRC_DIR });
	if (!existsSync(STOCK_BIN_PATH)) {
		fail(`go build succeeded but ${STOCK_BIN_PATH} is missing`);
	}
}

/** Builds the pinned ed-irl gs (+ shamhub helper). Idempotent on its marker. */
function buildPinnedGs() {
	const pinnedSha = readPinnedSha();
	const marker = buildMarker(pinnedSha);
	if (existsSync(BIN_PATH) && existsSync(SHAMHUB_BIN) && readBuiltSha() === marker) {
		console.log(`fetch-gs: ${BIN_PATH} and ${SHAMHUB_BIN} already built at ${marker}`);
		return;
	}
	console.log(`fetch-gs: building gs at ${pinnedSha}`);
	fetchSource(SRC_DIR, UPSTREAM, pinnedSha);
	buildBinary();
	buildShamhubHelper();
	writeFileSync(BUILT_SHA_PATH, marker + '\n');
	console.log(`fetch-gs: built ${BIN_PATH} and ${SHAMHUB_BIN}`);
}

/** Builds the vanilla stock gs from the pinned release tag. Idempotent. */
function buildStockGs() {
	const tag = readStockTag();
	if (existsSync(STOCK_BIN_PATH) && readBuiltStockTag() === tag) {
		console.log(`fetch-gs: ${STOCK_BIN_PATH} already built at ${tag}`);
		return;
	}
	console.log(`fetch-gs: building stock gs at ${tag}`);
	fetchSource(STOCK_SRC_DIR, STOCK_UPSTREAM, `refs/tags/${tag}`);
	buildStockBinary();
	writeFileSync(STOCK_BUILT_TAG_PATH, tag + '\n');
	console.log(`fetch-gs: built ${STOCK_BIN_PATH}`);
}

function main() {
	requireGo();
	buildPinnedGs();
	buildStockGs();
}

main();
