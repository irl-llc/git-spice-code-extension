/**
 * Visual coverage for the trunk sync affordances (issue #82): two distinct,
 * non-default states surfaced on the trunk branch card.
 *
 *  - remote-unknown: a gs repo with no git remote configured. git-spice cannot
 *    determine the trunk's remote state, so the trunk card shows a cloud badge.
 *    Driven by a plain temp repo (no remote) — no forge involved.
 *  - origin-ahead: the remote trunk has commits the local trunk lacks. Per the
 *    CLAUDE.md feature-coverage policy this is remote-dependent, so it is driven
 *    end-to-end by the shamhub fake forge: seed + push trunk, then advance the
 *    forge's trunk from a second clone and fetch, so `origin/main` is ahead of
 *    local `main`. The trunk card shows a cloud-download badge.
 *
 * Linux-rendered snapshots — regenerate via the Docker compose harness
 * (`npm run test:e2e:playwright:docker:update`).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { createTempRepo, type WorkspaceRepo } from './fixtures/repo';
import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { seedShamhubStack, type ShamhubStack } from './fixtures/shamhub';
import { openGitSpiceEditor } from './fixtures/webview';

const TRUNK = 'main';

test.describe('trunk sync: remote not configured', () => {
	let repo: WorkspaceRepo;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		repo = createTempRepo();
		repo.initTrunk(TRUNK); // no `git remote add` — sync state is unknowable
		repo.createBranch({
			name: 'feat-a',
			base: TRUNK,
			commits: [{ message: 'add a', files: { 'a.txt': 'a\n' } }],
		});
		vscode = await launchVSCode(repo.path);
	});

	test.afterAll(async () => {
		await vscode?.close();
		repo?.cleanup();
	});

	test('matches snapshot trunk-remote-unknown.png', async () => {
		const webview = await openGitSpiceEditor(vscode.workbench);
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 30_000 });
		await expect(webview.locator('.tag-trunk-sync-remote-unknown')).toBeVisible();
		await vscode.workbench.waitForTimeout(500);
		await expect(webview.locator('#repoContainer')).toHaveScreenshot('trunk-remote-unknown.png');
	});
});

/** Pushes one extra commit to the forge's trunk from a throwaway clone. */
function advanceForgeTrunk(repoUrl: string, env: Record<string, string>): void {
	const dir = mkdtempSync(join(tmpdir(), 'gs-origin-ahead-'));
	const execEnv = { ...process.env, ...env };
	const git = (...args: string[]): void => void execFileSync('git', ['-C', dir, ...args], { env: execEnv });
	try {
		execFileSync('git', ['clone', '-q', repoUrl, dir], { env: execEnv });
		git('config', 'user.email', 'e2e@example.com');
		git('config', 'user.name', 'E2E Bot');
		git('commit', '-q', '--allow-empty', '-m', 'remote advances trunk');
		git('push', '-q', 'origin', TRUNK);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test.describe('trunk sync: origin ahead (shamhub)', () => {
	let scenario: ShamhubStack;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		scenario = await seedShamhubStack({ branches: ['feat-a'], submit: false });
		try {
			// Advance the forge trunk, then fetch so origin/main moves ahead of
			// the local main without fast-forwarding the local branch.
			advanceForgeTrunk(scenario.shamhub.repoUrl, scenario.env);
			execFileSync('git', ['-C', scenario.repoPath, 'fetch', '-q', 'origin'], {
				env: { ...process.env, ...scenario.env },
			});
		} catch (error) {
			await scenario.shamhub.close();
			scenario.cleanup();
			throw error;
		}
		vscode = await launchVSCode(scenario.repoPath, scenario.env);
	});

	test.afterAll(async () => {
		await vscode?.close();
		await scenario?.shamhub.close();
		scenario?.cleanup();
	});

	test('matches snapshot trunk-origin-ahead.png', async () => {
		const webview = await openGitSpiceEditor(vscode.workbench);
		await webview.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 60_000 });
		await expect(webview.locator('.tag-trunk-sync-origin-ahead')).toBeVisible();
		await vscode.workbench.waitForTimeout(500);
		await expect(webview.locator('#repoContainer')).toHaveScreenshot('trunk-origin-ahead.png');
	});
});
