/**
 * VS Code launcher fixture: downloads VS Code via @vscode/test-electron,
 * launches it with the extension under development, opens a workspace,
 * and attaches Playwright via CDP.
 *
 * Encapsulates the non-obvious bits the C.1 spike discovered:
 * - `_electron.launch()` doesn't work with VS Code (its Node-bootstrap
 *   rejects --inspect=0). We `cp.spawn` directly and attach via
 *   `chromium.connectOverCDP`.
 * - ELECTRON_RUN_AS_NODE must be unset in the child env so Electron
 *   doesn't run as plain Node.
 * - --extensions-dir must be a fresh temp dir to isolate from the
 *   user's installed extensions on macOS (--disable-extensions alone
 *   leaves GitLens et al. visible).
 */

import { chromium, type Browser, type Page } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../../..');
const GS_BIN = process.env.GIT_SPICE_BIN ?? resolve(REPO_ROOT, '.gs/bin/gs');

/**
 * Writes a user-settings.json into the temp `--user-data-dir` to keep
 * snapshot captures clean: hides Copilot/chat chrome that ships built-in
 * in modern VS Code, disables minimap, prevents the welcome page, etc.
 */
function writeUserSettings(userDataDir: string): void {
	const settingsDir = join(userDataDir, 'User');
	mkdirSync(settingsDir, { recursive: true });
	const settings = {
		'workbench.startupEditor': 'none',
		'window.commandCenter': false,
		'chat.commandCenter.enabled': false,
		'chat.experimental.offerSetup': false,
		'workbench.activityBar.location': 'side',
		// Hide the status bar so the gs/git overlay doesn't bleed into
		// `.repo-branch-list` snapshots that extend below the viewport.
		'workbench.statusBar.visible': false,
		'editor.minimap.enabled': false,
		'telemetry.telemetryLevel': 'off',
		'update.mode': 'none',
		'extensions.autoUpdate': false,
		'security.workspace.trust.enabled': false,
	};
	writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(settings, null, 2));
}

/** Reads the pinned VS Code version from .vscode-version at repo root. */
function readPinnedVSCodeVersion(): string {
	const path = resolve(REPO_ROOT, '.vscode-version');
	const raw = readFileSync(path, 'utf8').trim();
	if (!/^\d+\.\d+\.\d+$/.test(raw)) {
		throw new Error(`Invalid .vscode-version: "${raw}" — expected semver like 1.121.0`);
	}
	return raw;
}

/** A live VS Code instance under Playwright's control. */
export interface VSCodeInstance {
	proc: ChildProcess;
	browser: Browser;
	workbench: Page;
	close(): Promise<void>;
}

/** Launches VS Code with the extension loaded and the given workspace open. */
export async function launchVSCode(workspacePath: string): Promise<VSCodeInstance> {
	const vscodePath = await downloadAndUnzipVSCode(readPinnedVSCodeVersion());
	const userDataDir = mkdtempSync(join(tmpdir(), 'gs-e2e-userdata-'));
	const extensionsDir = mkdtempSync(join(tmpdir(), 'gs-e2e-extensions-'));
	writeUserSettings(userDataDir);
	const debugPort = pickPort();

	const childEnv: NodeJS.ProcessEnv = { ...process.env, GIT_SPICE_BIN: GS_BIN };
	delete childEnv.ELECTRON_RUN_AS_NODE;

	// `--extensions-dir=<temp>` already isolates from user-installed extensions
	// (the dir starts empty). We intentionally do NOT pass `--disable-extensions`
	// because our extension depends on the built-in `vscode.git` for repo
	// discovery; that flag disables built-ins too.
	const proc = spawn(
		vscodePath,
		[
			'--no-sandbox',
			'--disable-gpu-sandbox',
			'--disable-updates',
			'--skip-welcome',
			'--skip-release-notes',
			'--disable-workspace-trust',
			'--disable-telemetry',
			`--remote-debugging-port=${debugPort}`,
			`--extensionDevelopmentPath=${REPO_ROOT}`,
			`--extensions-dir=${extensionsDir}`,
			`--user-data-dir=${userDataDir}`,
			workspacePath,
		],
		{ env: childEnv, stdio: ['ignore', 'ignore', 'ignore'] },
	);

	await waitForCdp(debugPort, 60_000);
	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
	const workbench = await waitForWorkbench(browser, 30_000);
	await workbench.locator('.monaco-workbench').waitFor({ state: 'attached', timeout: 30_000 });

	return {
		proc,
		browser,
		workbench,
		close: () => closeInstance(browser, proc),
	};
}

async function closeInstance(browser: Browser, proc: ChildProcess): Promise<void> {
	await browser.close().catch(() => undefined);
	if (proc.killed) return;
	proc.kill('SIGTERM');
	await new Promise((r) => setTimeout(r, 1000));
	if (!proc.killed) proc.kill('SIGKILL');
}

async function waitForCdp(port: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastErr: unknown;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(`http://127.0.0.1:${port}/json/version`);
			if (res.ok) return;
		} catch (err) {
			lastErr = err;
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`CDP did not come up on port ${port} within ${timeoutMs}ms: ${String(lastErr)}`);
}

async function waitForWorkbench(browser: Browser, timeoutMs: number): Promise<Page> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		for (const ctx of browser.contexts()) {
			for (const page of ctx.pages()) {
				if (page.url().includes('workbench.html')) return page;
			}
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`No VS Code workbench page found within ${timeoutMs}ms`);
}

/** Picks a port in the ephemeral range. Random but unverified — collisions are rare in CI. */
function pickPort(): number {
	return 9229 + Math.floor(Math.random() * 1000);
}
