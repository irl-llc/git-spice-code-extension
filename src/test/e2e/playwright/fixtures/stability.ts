/**
 * Snapshot-stability helpers for Playwright tests.
 *
 * VS Code's webview CSP blocks `frame.addStyleTag` (style-src 'self'
 * https://*.vscode-cdn.net), so we can't inject a global "kill
 * transitions" stylesheet. We rely on Playwright's config-level
 * `toHaveScreenshot.animations: 'disabled'` to handle in-flight
 * animations and use only this `waitForFontsReady` helper from the
 * webview fixture.
 */

import type { Frame } from '@playwright/test';

/** Resolves once all web fonts in the frame are loaded. */
export async function waitForFontsReady(frame: Frame): Promise<void> {
	await frame.evaluate(() => document.fonts?.ready);
}
