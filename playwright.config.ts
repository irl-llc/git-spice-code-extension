import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the BDD E2E suite. Launches VS Code via
 * @vscode/test-electron, attaches via CDP, drives real user journeys
 * against a real `gs` binary and a real workspace fixture.
 *
 * The earlier C.1 spike (src/test/playwright-spike/) is documented as a
 * reference but excluded from this run; it lives on its own gs branch
 * and will be deleted after these patterns settle.
 */
export default defineConfig({
	testDir: './src/test/e2e/playwright',
	timeout: 180_000,
	workers: 1,
	reporter: [['list']],
	use: {
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
});
