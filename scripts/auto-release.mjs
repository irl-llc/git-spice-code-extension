#!/usr/bin/env node
// Scheduled daily auto-release (issue #30, Part 3).
//
// Run by .github/workflows/auto-release.yml on a daily schedule. If there are
// pending Changie fragments under .changes/unreleased/, it:
//   1. derives the next 0.x version from the fragments' kinds (minor for a
//      feature/breaking change, patch for bug fixes) via the unit-tested
//      out/utils/releaseBump.js module,
//   2. runs `changie batch <level>` + `changie merge` to fold the fragments
//      into CHANGELOG.md and a versioned notes file,
//   3. bumps package.json to the new version,
//   4. commits, tags `v<version>`, pushes, and
//   5. creates a GitHub Release — which feeds the existing publish job in
//      ci.yml (it publishes on `refs/tags/*`).
// With no pending fragments it no-ops silently (exit 0), so a quiet day makes
// no release — the owner's binding decision on #30.
//
// Env: CHANGIE_BIN (path to changie, default `changie`), DRY_RUN=1 to compute
// and print the plan without mutating git/forge. Authenticated `gh` + a git
// identity are required for a real run.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const UNRELEASED_DIR = resolve(REPO_ROOT, '.changes/unreleased');
const PACKAGE_JSON = resolve(REPO_ROOT, 'package.json');
const BUMP_MODULE = resolve(REPO_ROOT, 'out/utils/releaseBump.js');
const CHANGIE = process.env.CHANGIE_BIN || 'changie';
const DRY_RUN = process.env.DRY_RUN === '1';

function fail(message) {
	console.error(`auto-release: ${message}`);
	process.exit(1);
}

function run(cmd, args) {
	const result = spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
	if (result.status !== 0) {
		fail(`\`${cmd} ${args.join(' ')}\` failed: ${result.stderr || result.stdout}`);
	}
	return result.stdout.trim();
}

/** Reads the `kind:` line from each pending fragment YAML (skips .gitkeep). */
function pendingKinds() {
	if (!existsSync(UNRELEASED_DIR)) {
		return [];
	}
	const files = readdirSync(UNRELEASED_DIR).filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'));
	return files.map(readKind).filter((kind) => kind !== null);
}

function readKind(fileName) {
	const text = readFileSync(resolve(UNRELEASED_DIR, fileName), 'utf8');
	const match = /^kind:\s*(.+?)\s*$/m.exec(text);
	return match ? match[1].replace(/^['"]|['"]$/g, '') : null;
}

function currentVersion() {
	return JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).version;
}

function writeVersion(version) {
	const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
	pkg.version = version;
	writeFileSync(PACKAGE_JSON, `${JSON.stringify(pkg, null, '\t')}\n`);
}

function applyChangie(level, version) {
	run(CHANGIE, ['batch', level]);
	run(CHANGIE, ['merge']);
	writeVersion(version);
}

function commitAndRelease(version) {
	const tag = `v${version}`;
	run('git', ['add', '-A']);
	run('git', ['commit', '-m', `chore(release): ${tag}`]);
	run('git', ['tag', tag]);
	run('git', ['push', 'origin', 'HEAD', '--tags']);
	const notes = resolve(REPO_ROOT, '.changes', `${version}.md`);
	const notesArgs = existsSync(notes) ? ['--notes-file', notes] : ['--generate-notes'];
	run('gh', ['release', 'create', tag, '--title', tag, ...notesArgs]);
	console.log(`auto-release: created release ${tag}`);
}

async function main() {
	if (!existsSync(BUMP_MODULE)) {
		fail(`compiled bump module missing at ${BUMP_MODULE}; run \`npm run compile-tests\`.`);
	}
	const { deriveNextVersion } = await import(BUMP_MODULE);
	const kinds = pendingKinds();
	const { level, nextVersion } = deriveNextVersion(currentVersion(), kinds);
	if (!nextVersion) {
		console.log('auto-release: no pending change fragments; nothing to release.');
		return;
	}
	console.log(`auto-release: ${kinds.length} pending fragment(s) → ${level} bump → v${nextVersion}`);
	if (DRY_RUN) {
		console.log('auto-release: DRY_RUN set; not mutating git/forge.');
		return;
	}
	applyChangie(level, nextVersion);
	commitAndRelease(nextVersion);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
