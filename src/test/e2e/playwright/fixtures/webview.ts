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

import { waitForFontsReady } from './stability';

/** Root element our webview always renders (see media/stackView.html). */
const WEBVIEW_ROOT_SELECTOR = '#repoContainer';

/**
 * Focuses the Git Spice view in the SCM container and returns a Frame
 * scoped to the webview's content DOM (our stackView.html, not VS Code's
 * outer wrapper). Waits for web fonts before returning so snapshots are
 * not racing the font swap. Animations are disabled at the config level
 * via `toHaveScreenshot.animations: 'disabled'` (the webview's CSP blocks
 * inline-style injection, so we can't kill animations via addStyleTag).
 */
export async function openGitSpiceView(workbench: Page): Promise<Frame> {
	await runCommand(workbench, 'Focus on Git Spice View');
	const frame = await waitForGitSpiceFrame(workbench, 30_000);
	await waitForFontsReady(frame);
	return frame;
}

/**
 * Opens the Git Spice view as a full editor pane (via the
 * `git-spice.openInEditor` command). Gives snapshot tests a wide canvas
 * and clean visual context (no sidebar siblings, no scrollbars, no
 * narrow-column clipping).
 *
 * The caller should NOT call `openGitSpiceView` in the same test —
 * otherwise both the sidebar webview and the editor webview will match
 * `#repoContainer` and the frame selector becomes ambiguous.
 */
export async function openGitSpiceEditor(workbench: Page): Promise<Frame> {
	await runCommand(workbench, 'Git Spice: Open in Editor');
	// 60s gives ample headroom for the WebviewPanel handshake on slow
	// Docker runs; the local fast path is still ~2s.
	const frame = await waitForGitSpiceFrame(workbench, 60_000);
	await waitForFontsReady(frame);
	return frame;
}

async function runCommand(workbench: Page, command: string): Promise<void> {
	await workbench.keyboard.press('F1');
	await workbench.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 10_000 });
	await workbench.keyboard.type(command);
	// Let the palette filter settle before pressing Enter.
	await workbench.waitForTimeout(500);
	await workbench.keyboard.press('Enter');
}

/**
 * Drags the sash between the primary sidebar and the editor area so the
 * sidebar is `widthPx` wide. Default is ~300px which clips branch cards
 * horizontally; widening to ~500 gives the cards room to lay out
 * naturally. Sashes live in `.sash-container` divs at the workbench
 * root, not inside the sidebar — we find the one whose center sits at
 * the sidebar's right edge.
 */
export async function setSidebarWidth(workbench: Page, widthPx: number): Promise<void> {
	const sidebar = workbench.locator('.monaco-workbench .part.sidebar').first();
	const sbBox = await sidebar.boundingBox();
	if (!sbBox) throw new Error('Primary sidebar has no bounding box');
	const rightEdge = sbBox.x + sbBox.width;
	// Pick the vertical sash whose horizontal center is closest to the
	// sidebar's right edge. Each sash is ~4px wide and centered on the
	// boundary it controls.
	const sashHandle = await workbench
		.locator('.monaco-sash.vertical')
		.evaluateAll((els, target) => {
			let bestIndex = -1;
			let bestDelta = Infinity;
			els.forEach((el, i) => {
				const r = el.getBoundingClientRect();
				const center = r.x + r.width / 2;
				const delta = Math.abs(center - target);
				if (delta < bestDelta) {
					bestDelta = delta;
					bestIndex = i;
				}
			});
			return { index: bestIndex, delta: bestDelta };
		}, rightEdge);
	if (sashHandle.index < 0 || sashHandle.delta > 8) {
		throw new Error(`No vertical sash found near sidebar right edge (x=${rightEdge}); best delta ${sashHandle.delta}`);
	}
	const sash = workbench.locator('.monaco-sash.vertical').nth(sashHandle.index);
	const box = await sash.boundingBox();
	if (!box) throw new Error('Resolved sash has no bounding box');
	const startX = box.x + box.width / 2;
	const startY = box.y + box.height / 2;
	const targetX = sbBox.x + widthPx;
	await workbench.mouse.move(startX, startY);
	await workbench.mouse.down();
	await workbench.mouse.move(targetX, startY, { steps: 10 });
	await workbench.mouse.up();
	// Let the resize settle before downstream layout reads.
	await workbench.waitForTimeout(150);
}

/**
 * Collapses every pane in the primary sidebar EXCEPT the one whose
 * aria-label contains `keepLabel` (case-insensitive). Used to free
 * vertical space for the Git Spice section so multi-branch stacks fit
 * in a single screenshot. Scoped to `.part.sidebar` so it doesn't touch
 * the auxiliary bar (Chat).
 */
export async function collapseSidebarSiblings(workbench: Page, keepLabel: string): Promise<void> {
	const headers = workbench.locator('.monaco-workbench .part.sidebar .pane-header');
	const count = await headers.count();
	if (count === 0) throw new Error('No pane-headers found in primary sidebar');
	const keep = keepLabel.toLowerCase();
	for (let i = 0; i < count; i++) {
		const header = headers.nth(i);
		const label = (await header.getAttribute('aria-label')) ?? '';
		if (label.toLowerCase().includes(keep)) continue;
		const expanded = await header.getAttribute('aria-expanded');
		if (expanded === 'true') {
			await header.click({ timeout: 2_000 });
		}
	}
	// Let the collapse animations finish before downstream layout reads.
	await workbench.waitForTimeout(200);
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
