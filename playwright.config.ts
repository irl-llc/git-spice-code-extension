import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the C.1 spike: validate we can reach our webview iframe DOM
 * through @vscode/test-electron + Playwright. If this proves out, the same patterns
 * graduate into the real E2E suite under Thread C.2.
 */
export default defineConfig({
	testDir: './src/test/playwright-spike',
	timeout: 180_000,
	workers: 1,
	reporter: [['list']],
	use: {
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
});
