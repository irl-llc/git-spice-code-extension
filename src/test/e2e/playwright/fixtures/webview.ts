/**
 * Webview fixture: opens the Git Spice view via the command palette and
 * returns a Playwright `Frame` whose DOM contains our webview content.
 *
 * VS Code renders custom webview views through two layered iframes. The
 * OUTER iframe loads VS Code's webview-origin index.html and carries the
 * extensionId query param. The INNER iframe (`fake.html`) is where our
 * `media/stackView.html` actually renders — that's the frame we want.
 *
 * Playwright flattens nested frames into `page.frames()`. We scan all
 * frames from VS Code's webview-origin scheme and pick the one that
 * actually contains our well-known root element. The C.1 spike proved
 * this is reliable.
 */

import type { Frame, Page } from '@playwright/test';

/** Root element our webview always renders (see media/stackView.html). */
const WEBVIEW_ROOT_SELECTOR = '#repoContainer';

/**
 * Focuses the Git Spice view in the SCM container and returns a Frame
 * scoped to the webview's content DOM (our stackView.html, not VS Code's
 * outer wrapper).
 */
export async function openGitSpiceView(workbench: Page): Promise<Frame> {
	await workbench.keyboard.press('F1');
	await workbench.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 10_000 });
	await workbench.keyboard.type('Focus on Git Spice View');
	// Let the palette filter settle before pressing Enter.
	await workbench.waitForTimeout(500);
	await workbench.keyboard.press('Enter');
	return waitForGitSpiceFrame(workbench, 30_000);
}

/**
 * Waits for a webview frame containing our root element. Returns it.
 *
 * Filters by URL scheme to avoid scanning the workbench frame itself,
 * then probes each candidate for `#repoContainer` (cheap; bails fast on
 * non-matches).
 */
export async function waitForGitSpiceFrame(workbench: Page, timeoutMs: number): Promise<Frame> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const candidate = await findGitSpiceFrame(workbench);
		if (candidate) return candidate;
		await workbench.waitForTimeout(250);
	}
	throw new Error(`Git Spice webview frame did not appear within ${timeoutMs}ms`);
}

async function findGitSpiceFrame(workbench: Page): Promise<Frame | undefined> {
	for (const frame of workbench.frames()) {
		if (!frame.url().startsWith('vscode-webview://')) continue;
		const count = await frame
			.locator(WEBVIEW_ROOT_SELECTOR)
			.count()
			.catch(() => 0);
		if (count > 0) return frame;
	}
	return undefined;
}
