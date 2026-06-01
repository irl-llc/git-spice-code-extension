#!/usr/bin/env node
// CI change-fragment gate (issue #30).
//
// Fails a pull request that makes release-worthy changes without adding a
// Changie fragment under .changes/unreleased/. Docs/CI-only PRs and PRs
// carrying the `skip-changelog` label are skipped. The decision logic lives in
// the unit-tested pure module src/utils/changelogGate.ts (compiled to
// out/utils/changelogGate.js by `npm run compile-tests`); this script only
// gathers the PR's changed files + labels from the GitHub event and reports.
//
// Inputs (provided by the workflow): GH_PR_NUMBER. Authenticated `gh` CLI.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const GATE_MODULE = resolve(REPO_ROOT, 'out/utils/changelogGate.js');

function fail(message) {
	console.error(`changelog-gate: ${message}`);
	process.exit(1);
}

function gh(args) {
	const result = spawnSync('gh', args, { encoding: 'utf8' });
	if (result.status !== 0) {
		fail(`\`gh ${args.join(' ')}\` failed: ${result.stderr || result.stdout}`);
	}
	return result.stdout;
}

async function main() {
	const prNumber = process.env.GH_PR_NUMBER;
	if (!prNumber) {
		fail('GH_PR_NUMBER is not set; this gate only runs on pull_request events.');
	}
	if (!existsSync(GATE_MODULE)) {
		fail(`compiled gate module missing at ${GATE_MODULE}; run \`npm run compile-tests\`.`);
	}

	const data = JSON.parse(gh(['pr', 'view', prNumber, '--json', 'files,labels']));
	const changedPaths = data.files.map((f) => f.path);
	// `gh pr view` reports additions/deletions per file; a file that is purely
	// added has deletions === 0 and did not exist before. The forge does not
	// expose change-type directly here, so we approximate "added" as a path that
	// is a new change-fragment file (the only added-vs-modified distinction the
	// gate cares about) by checking it lives under the unreleased dir.
	const { evaluateChangelogGate, UNRELEASED_DIR } = await import(GATE_MODULE);
	const addedPaths = changedPaths.filter((p) => p.startsWith(UNRELEASED_DIR));
	const labels = data.labels.map((l) => l.name);

	const decision = evaluateChangelogGate({ changedPaths, addedPaths, labels });
	const line = `changelog-gate: ${decision.kind.toUpperCase()} — ${decision.reason}`;
	if (decision.kind === 'fail') {
		fail(decision.reason);
	}
	console.log(line);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
