/**
 * Thread C.1 spike (kept as reference for Thread C.2's fixture work).
 *
 * Proves that Playwright can reach the DOM inside our custom webview view
 * (`gitSpice.branches`) when VS Code is launched as a real test instance.
 *
 * Findings — the non-obvious bits to preserve when factoring this into
 * reusable fixtures:
 *
 *   1. Do NOT use `_electron.launch()`. It injects `--inspect=0
 *      --remote-debugging-port=0`, which the Node-bootstrapped Electron
 *      binary inside VS Code rejects with `bad option:`. Instead, cp.spawn
 *      the binary directly and attach Playwright via
 *      chromium.connectOverCDP.
 *
 *   2. Clear `ELECTRON_RUN_AS_NODE` from the child env. When set (as it is
 *      under Claude Code's harness), VS Code's Electron runs as plain Node
 *      and rejects every CLI flag. @vscode/test-cli's desktop runner clears
 *      it for the same reason.
 *
 *   3. `--disable-extensions` alone does NOT isolate from the user's
 *      installed extensions on macOS — GitLens leaked in. Pass
 *      `--extensions-dir=<temp>` AND `--disable-extensions` together.
 *
 *   4. The webview shows up as a frame on the workbench page with URL
 *      `vscode-webview://<hash>/index.html?…extensionId=IRLAILLC.git-spice…
 *      purpose=webviewView`. There's also a sibling `pending-frame` with
 *      `fake.html` from VS Code's swap mechanism; both expose the same DOM.
 *
 *   5. The package.json view title is "Git Spice" (not "Branches"). The
 *      auto-generated focus command palette title is "Focus on Git Spice
 *      View".
 *
 * Success criterion: locate `#repoContainer` (rendered by
 * media/stackView.html) inside the webview iframe. Passes in ~13s end-to-
 * end.
 */

import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../..');
const GS_BIN = process.env.GIT_SPICE_BIN ?? resolve(REPO_ROOT, '.gs/bin/gs');
const DEBUG_PORT = 9229;

/** Creates a temp dir with a single-commit git repo initialized as a gs trunk. */
function seedWorkspace(): string {
	const dir = mkdtempSync(join(tmpdir(), 'gs-spike-'));
	execFileSync('git', ['init', '-q', '-b', 'main', dir]);
	execFileSync('git', ['-C', dir, 'config', 'user.email', 'spike@example.com']);
	execFileSync('git', ['-C', dir, 'config', 'user.name', 'Spike']);
	writeFileSync(join(dir, 'README.md'), '# spike\n');
	execFileSync('git', ['-C', dir, 'add', '.']);
	execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'init']);
	execFileSync(GS_BIN, ['repo', 'init', '--trunk', 'main'], { cwd: dir });
	return dir;
}

/** Waits for the VS Code workbench page to appear in any context. */
async function waitForWorkbench(ctx: BrowserContext, timeoutMs: number): Promise<Page> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const page of ctx.pages()) {
			if (page.url().includes('workbench.html')) return page;
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`No workbench page found within ${timeoutMs}ms`);
}

/** Waits for VS Code's CDP endpoint to respond. */
async function waitForCdp(port: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastErr: unknown = null;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (res.ok) return;
		} catch (err) {
			lastErr = err;
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`CDP did not come up on port ${port}: ${String(lastErr)}`);
}

test.describe('Playwright spike: webview iframe reachability via CDP', () => {
	let vscodeProc: ChildProcess;
	let browser: Browser;
	let workspace: string;

	test.beforeAll(async () => {
		workspace = seedWorkspace();
		console.log(`[spike] workspace at ${workspace}`);
		console.log(`[spike] GS_BIN=${GS_BIN}`);
		const vscodePath = await downloadAndUnzipVSCode('stable');
		console.log(`[spike] launching VS Code from ${vscodePath}`);

		const userDataDir = mkdtempSync(join(tmpdir(), 'gs-spike-userdata-'));
		// ELECTRON_RUN_AS_NODE=1 in our shell makes the Electron binary act as Node,
		// which rejects all VS Code flags. @vscode/test-cli's runner clears it for the
		// same reason — see node_modules/@vscode/test-cli/out/cli/platform/desktop.mjs.
		const childEnv = { ...process.env, GIT_SPICE_BIN: GS_BIN };
		delete childEnv.ELECTRON_RUN_AS_NODE;

		// Use isolated extensions-dir too; --disable-extensions alone doesn't fully
		// isolate from the user's installed extensions on macOS (GitLens leaked through).
		const extensionsDir = mkdtempSync(join(tmpdir(), 'gs-spike-extensions-'));

		vscodeProc = spawn(
			vscodePath,
			[
				'--no-sandbox',
				'--disable-gpu-sandbox',
				'--disable-updates',
				'--skip-welcome',
				'--skip-release-notes',
				'--disable-workspace-trust',
				'--disable-telemetry',
				`--remote-debugging-port=${DEBUG_PORT}`,
				`--extensionDevelopmentPath=${REPO_ROOT}`,
				`--extensions-dir=${extensionsDir}`,
				`--user-data-dir=${userDataDir}`,
				workspace,
			],
			{
				env: childEnv,
				stdio: ['ignore', 'inherit', 'inherit'],
			},
		);
		vscodeProc.on('error', (err) => console.error('[spike] VS Code process error:', err));

		await waitForCdp(DEBUG_PORT, 60_000);
		console.log(`[spike] CDP endpoint up at port ${DEBUG_PORT}`);
		browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
	});

	test.afterAll(async () => {
		if (browser) await browser.close().catch(() => undefined);
		if (vscodeProc && !vscodeProc.killed) {
			vscodeProc.kill('SIGTERM');
			await new Promise((r) => setTimeout(r, 1000));
			if (!vscodeProc.killed) vscodeProc.kill('SIGKILL');
		}
	});

	test('can locate #repoContainer inside the gitSpice.branches webview', async () => {
		const ctx: BrowserContext = browser.contexts()[0];

		// Find the workbench page by URL (title is empty during initial load).
		const workbench = await waitForWorkbench(ctx, 30_000);
		console.log(`[spike] workbench page: ${workbench.url()}`);

		// Wait for the workbench DOM itself to be ready.
		await workbench.locator('.monaco-workbench').waitFor({ state: 'attached', timeout: 30_000 });
		console.log('[spike] .monaco-workbench attached');

		// Focus the Git Spice view. The view title is "Git Spice" in the SCM container.
		// Using the command palette text "Focus on Git Spice View" — VS Code auto-
		// generates a focus command per view.
		await workbench.keyboard.press('F1');
		await workbench.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 5_000 });
		await workbench.keyboard.type('Focus on Git Spice View');
		await workbench.waitForTimeout(800);
		await workbench.keyboard.press('Enter');
		// Webview resolution + JS bundle execution takes a beat.
		await workbench.waitForTimeout(6000);

		// Dump frames across all pages for diagnostics — the webview may live on
		// the workbench page (workbench-embedded webviews) or as a separate page.
		const allPages = ctx.pages();
		console.log(`[spike] context has ${allPages.length} page(s):`);
		for (const page of allPages) {
			console.log(`  - url=${page.url()}`);
			for (const frame of page.frames()) {
				console.log(`      frame url=${frame.url()}  name=${frame.name() || '(none)'}`);
			}
		}

		// Search every frame in every page for #repoContainer.
		let found = false;
		let foundUrl = '';
		for (const page of allPages) {
			for (const frame of page.frames()) {
				const count = await frame.locator('#repoContainer').count().catch(() => 0);
				if (count > 0) {
					foundUrl = frame.url();
					found = true;
					break;
				}
			}
			if (found) break;
		}

		if (found) {
			console.log(`[spike] FOUND #repoContainer in frame url=${foundUrl}`);
		} else {
			console.log('[spike] #repoContainer not found in any frame');
		}

		expect(found, 'should locate #repoContainer in at least one frame').toBe(true);
	});
});
