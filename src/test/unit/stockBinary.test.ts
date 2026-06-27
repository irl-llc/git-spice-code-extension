/**
 * Stock-binary gating tests (issue #72).
 *
 * These run against a VANILLA upstream git-spice build (pinned in
 * .gs-stock-version, built to .gs/bin/gs-stock by `npm run gs:fetch`). They
 * prove the extension's beta surfaces stay gated OFF when the resolved binary
 * is stock git-spice — the real-world fallback case — rather than relying only
 * on hand-written `--help` fixtures.
 *
 * State-only: each test spawns the stock binary directly and feeds its output
 * through the extension's pure parsers. No `vscode` import, so mocha runs them.
 *
 * The suite resolves the stock binary from GIT_SPICE_STOCK_BIN (set by CI) or
 * the default .gs/bin/gs-stock. When neither exists it SKIPS rather than fails,
 * so a checkout that hasn't run `npm run gs:fetch` still passes `test:unit`.
 */

import * as assert from 'assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseIntegrationSupport } from '../../utils/integrationSupport';
import { parseGitSpiceBranches } from '../../gitSpiceSchema';

const REPO_ROOT = resolve(__dirname, '../../../..');
const DEFAULT_STOCK_BIN = resolve(REPO_ROOT, '.gs/bin/gs-stock');

/** Resolves the stock binary path, or undefined when it is not built. */
function resolveStockBinary(): string | undefined {
	const candidate = process.env.GIT_SPICE_STOCK_BIN ?? DEFAULT_STOCK_BIN;
	return existsSync(candidate) ? candidate : undefined;
}

/** Captures `gs-stock --help`, tolerating Kong's non-zero help exit code. */
function stockHelpOutput(bin: string): string {
	const result = spawnSync(bin, ['--help'], { encoding: 'utf8' });
	return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

/** Spins up a throwaway git + stock-gs repo with one tracked branch. */
function seedStockRepo(bin: string): { path: string; cleanup: () => void } {
	const path = mkdtempSync(join(tmpdir(), 'gs-stock-'));
	const cleanup = (): void => rmSync(path, { recursive: true, force: true });
	try {
		const git = (...a: string[]): void => void execFileSync('git', ['-C', path, ...a], { encoding: 'utf8' });
		git('init', '-q', '-b', 'main');
		git('config', 'user.email', 'stock@example.com');
		git('config', 'user.name', 'Stock Bot');
		git('commit', '-q', '--allow-empty', '-m', 'root');
		// `--no-prompt` keeps init non-interactive; stock gs only needs a trunk for a
		// purely-local repo (remotes are prompted for push/pull ops we never run).
		execFileSync(bin, ['repo', 'init', '--trunk', 'main', '--no-prompt'], { cwd: path, encoding: 'utf8' });
		return { path, cleanup };
	} catch (err) {
		cleanup();
		throw err;
	}
}

const stockBin = resolveStockBinary();

describe('stock git-spice binary gating', function () {
	before(function () {
		if (!stockBin) {
			this.skip(); // gs-stock not built (no `npm run gs:fetch`); skip, don't fail.
		}
	});

	it('does not advertise the integration command group (integration gated off)', function () {
		const help = stockHelpOutput(stockBin!);
		assert.ok(help.length > 0, 'stock gs --help produced no output');
		assert.strictEqual(
			parseIntegrationSupport(help),
			false,
			'stock git-spice must NOT report integration support — the integration card stays hidden',
		);
	});

	it('lists branches as plain JSON from the local `gs ll` path', function () {
		const repo = seedStockRepo(stockBin!);
		try {
			const json = execFileSync(stockBin!, ['ll', '-a', '--json'], { cwd: repo.path, encoding: 'utf8' });
			const branches = parseGitSpiceBranches(json);
			assert.ok(Array.isArray(branches), 'stock `gs ll --json` did not parse to a branch array');
		} finally {
			repo.cleanup();
		}
	});

	it('degrades cleanly on the forge-status path (`gs ll -S`) without a remote', function () {
		const repo = seedStockRepo(stockBin!);
		try {
			assertForgeStatusDegradesCleanly(stockBin!, repo.path);
		} finally {
			repo.cleanup();
		}
	});
});

/**
 * The #61 CR-status path adds `-c -S` to `gs ll`, a forge round-trip. Against a
 * stock binary with no remote configured this must DEGRADE cleanly: either the
 * binary errors (non-zero exit, which the extension maps to a clean
 * `{ error }`), or it emits JSON our parser accepts. It must never emit output
 * that crashes `parseGitSpiceBranches`.
 */
function assertForgeStatusDegradesCleanly(bin: string, cwd: string): void {
	const result = spawnSync(bin, ['ll', '-a', '-c', '-S', '--json'], { cwd, encoding: 'utf8' });
	if (result.status !== 0) {
		return; // Clean failure: extension surfaces this as a formatted error.
	}
	const branches = parseGitSpiceBranches(result.stdout ?? '');
	assert.ok(Array.isArray(branches), 'forge-status JSON did not parse to a branch array');
}
