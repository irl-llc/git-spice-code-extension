/**
 * Integration + screenshot coverage for PR comment counts, driven end-to-end
 * by the shamhub fake forge (per the CLAUDE.md feature-coverage policy:
 * remote-dependent features are exercised against shamhub, not mocked).
 *
 * The seed flow mirrors git-spice's own `log_comments` testscript:
 *   gs repo init -> add shamhub remote -> push -> gs auth login ->
 *   create stack -> gs stack submit (creates CRs) -> seed resolvable comments.
 *
 * Then VS Code is launched against the same repo + env, and we screenshot the
 * stack with comment progress OFF (counts hidden) and ON (counts shown:
 * feat1 has an unresolved comment, feat2 is fully resolved, feat3 has none).
 *
 * Linux-rendered snapshots — regenerate via the Docker compose harness.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { startShamhub, type ShamhubServer } from './fixtures/shamhub';
import { openGitSpiceEditor } from './fixtures/webview';

// This spec lives in playwright/ (one level above fixtures/), so four `..`
// reach the repo root.
const REPO_ROOT = resolve(__dirname, '../../../..');
const GS_BIN = process.env.GIT_SPICE_BIN ?? resolve(REPO_ROOT, '.gs/bin/gs');
const TRUNK = 'main';

interface Scenario {
	shamhub: ShamhubServer;
	repoPath: string;
	env: Record<string, string>;
	cleanup(): void;
}

/** Runs the full init -> submit -> seed flow against shamhub. */
async function seedShamhubStack(): Promise<Scenario> {
	const shamhub = await startShamhub();
	const repoPath = mkdtempSync(join(tmpdir(), 'gs-shamhub-'));
	const home = mkdtempSync(join(tmpdir(), 'gs-shamhub-home-'));
	const env: Record<string, string> = {
		...shamhub.env,
		HOME: home,
		XDG_CONFIG_HOME: join(home, '.config'),
		GIT_SPICE_BIN: GS_BIN,
	};
	const execEnv = { ...process.env, ...env };
	const git = (...a: string[]): void => void execFileSync('git', ['-C', repoPath, ...a], { env: execEnv });
	const gs = (...a: string[]): void => void execFileSync(GS_BIN, a, { cwd: repoPath, env: execEnv });
	const write = (rel: string, content: string): void => {
		const abs = join(repoPath, rel);
		mkdirSync(join(abs, '..'), { recursive: true });
		writeFileSync(abs, content);
	};

	git('init', '-q', '-b', TRUNK);
	git('config', 'user.email', 'e2e@example.com');
	git('config', 'user.name', 'E2E Bot');
	git('commit', '-q', '--allow-empty', '-m', 'Initial commit');
	gs('repo', 'init', '--trunk', TRUNK);
	git('remote', 'add', 'origin', shamhub.repoUrl);
	git('push', '-q', 'origin', TRUNK);
	gs('auth', 'login');

	for (const name of ['feat1', 'feat2', 'feat3']) {
		write(`${name}.txt`, `${name}\n`);
		git('add', '.');
		gs('branch', 'create', '-m', name, '--no-prompt', '--no-verify', name);
	}
	gs('stack', 'submit', '--fill');

	// feat1 (#1): one unresolved + one resolved -> 1/2; feat2 (#2): resolved -> 1/1.
	await shamhub.seedComment(1, false, 'feat1 unresolved');
	await shamhub.seedComment(1, true, 'feat1 resolved');
	await shamhub.seedComment(2, true, 'feat2 resolved');

	return {
		shamhub,
		repoPath,
		env,
		cleanup: () => {
			rmSync(repoPath, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		},
	};
}

/** Enables comment progress via the command palette (default is off). */
async function enableCommentProgress(workbench: Page): Promise<void> {
	await workbench.keyboard.press('F1');
	await workbench.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 10_000 });
	await workbench.keyboard.type('Show Comment Progress');
	// Wait for the palette to filter to the command (deterministic, not a timeout).
	await workbench.locator('.quick-input-list-entry', { hasText: 'Show Comment Progress' }).first().waitFor();
	await workbench.keyboard.press('Enter');
}

test.describe('comment counts (shamhub)', () => {
	let scenario: Scenario;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		scenario = await seedShamhubStack();
		vscode = await launchVSCode(scenario.repoPath, scenario.env);
	});

	test.afterAll(async () => {
		await vscode?.close();
		await scenario?.shamhub.close();
		scenario?.cleanup();
	});

	test('renders PR comment counts fetched from the forge', async () => {
		const workbench = vscode.workbench;
		const webview = await openGitSpiceEditor(workbench);
		const repoContainer = webview.locator('#repoContainer');
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 30_000 });

		// OFF (default): no comment indicators rendered. (toHaveScreenshot has
		// built-in stability waits, so no explicit timeout is needed.)
		await expect(webview.locator('.comments-indicator')).toHaveCount(0);
		await expect(repoContainer).toHaveScreenshot('comment-counts-hidden.png');

		// ON: enable comment progress; counts fetched from shamhub appear.
		await enableCommentProgress(workbench);
		// feat1 (1/2) and feat2 (1/1) both show an indicator; feat3 has none.
		await expect(webview.locator('.comments-indicator')).toHaveCount(2);
		await expect(webview.locator('.comments-indicator', { hasText: '1/2' })).toBeVisible();
		await expect(webview.locator('.comments-indicator', { hasText: '1/1' })).toBeVisible();
		await expect(repoContainer).toHaveScreenshot('comment-counts-shown.png');
	});
});
