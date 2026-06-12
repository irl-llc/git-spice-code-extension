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

import type { Frame, Locator } from '@playwright/test';

/**
 * Font family used by VS Code Codicons. Glyphs from this family (chevrons,
 * file icons, the cloud submit affordance) only render once the font is
 * actually loaded; the webview requests it lazily the first time a codicon
 * paints.
 */
const CODICON_FONT_FAMILY = 'codicon';

/**
 * Resolves once the frame's web fonts — including the lazily-loaded codicon
 * icon font — are loaded and painted.
 *
 * `document.fonts.ready` alone is insufficient: it resolves immediately when
 * no font load is pending, which is the common case at the instant we check
 * (React may not have painted any codicon glyph yet, so the codicon font has
 * not been requested). We therefore explicitly `load()` the codicon family to
 * force the request, then await `ready` so all in-flight loads settle. Without
 * this, snapshots race the codicon swap and intermittently capture rows that
 * are ~9px shorter with every chevron/icon missing.
 */
export async function waitForFontsReady(frame: Frame): Promise<void> {
	await frame.evaluate(async (fontFamily) => {
		const fonts = document.fonts;
		if (!fonts) return;
		// Trigger the lazy codicon font request if it has not started; ignore
		// failures so a missing font never hangs the suite (the screenshot
		// diff will still surface a genuinely absent font).
		try {
			await fonts.load(`16px "${fontFamily}"`);
		} catch {
			// best-effort: fall through to ready below
		}
		await fonts.ready;
	}, CODICON_FONT_FAMILY);
}

/** Default consecutive equal-width samples that count as "settled". */
const DEFAULT_STABLE_FRAMES = 5;
/** Default ceiling on how long we wait for the width to settle. */
const DEFAULT_STABLE_TIMEOUT_MS = 10_000;
/**
 * Wall-clock gap between width samples. A pure `requestAnimationFrame` cadence
 * (~16ms) can declare stability before a late async forge reflow even begins;
 * spacing samples ~50ms apart means the settle window spans enough real time
 * for that reflow to land and be observed.
 */
const SAMPLE_INTERVAL_MS = 50;

/**
 * Resolves once `locator`'s rendered width stops changing — i.e. the element
 * has reported the same integer width for `stableFrames` consecutive
 * samples (~50ms apart).
 *
 * This closes the snapshot race behind issue #78: the forge-status specs
 * (commentCounts / crStatusBadges) capture `#repoContainer` after the first
 * `.stack-item` paints, but an in-flight async forge fetch can still reflow
 * the card row from its 632px baseline to the 680px with-badges layout a beat
 * later. `toHaveCount(0)`-style assertions pass during that transient window,
 * so `toHaveScreenshot` occasionally freezes the mid-reflow width. Waiting for
 * a width that holds steady across several frames is deterministic — no
 * arbitrary sleep, no baseline change — and lets the capture fire only once
 * the layout has genuinely settled.
 *
 * Width is rounded to whole pixels so sub-pixel antialiasing jitter does not
 * masquerade as motion. Throws if the width never settles within `timeoutMs`
 * so a genuinely unstable layout surfaces as a test failure rather than a
 * silent flake.
 */
export async function waitForStableWidth(
	locator: Locator,
	options: { stableFrames?: number; timeoutMs?: number } = {},
): Promise<void> {
	const stableFrames = options.stableFrames ?? DEFAULT_STABLE_FRAMES;
	const timeoutMs = options.timeoutMs ?? DEFAULT_STABLE_TIMEOUT_MS;
	const deadline = Date.now() + timeoutMs;
	const run = { lastWidth: Number.NaN, stableCount: 0 };
	while (Date.now() < deadline) {
		const width = await measureWidth(locator);
		if (recordSample(run, width) >= stableFrames) return;
		await nextSample(locator);
	}
	throw new Error(`Width of locator did not settle within ${timeoutMs}ms (last width ${run.lastWidth}px)`);
}

/**
 * Folds one width sample into the running settle state and returns the current
 * consecutive-stable count (reset to 1 whenever the width changes).
 */
function recordSample(run: { lastWidth: number; stableCount: number }, width: number): number {
	if (width === run.lastWidth) {
		run.stableCount += 1;
		return run.stableCount;
	}
	run.lastWidth = width;
	run.stableCount = 1;
	return run.stableCount;
}

/** Rounded rendered width of `locator` in CSS pixels. */
async function measureWidth(locator: Locator): Promise<number> {
	const box = await locator.boundingBox();
	if (!box) throw new Error('waitForStableWidth: locator has no bounding box');
	return Math.round(box.width);
}

/**
 * Spaces width samples by `SAMPLE_INTERVAL_MS`, then yields one animation frame
 * so any pending reflow has both wall-clock time to start and a frame to land
 * before the next measurement.
 */
async function nextSample(locator: Locator): Promise<void> {
	await locator.evaluate(
		(_el, intervalMs) =>
			new Promise<void>((resolve) => {
				setTimeout(() => requestAnimationFrame(() => resolve()), intervalMs);
			}),
		SAMPLE_INTERVAL_MS,
	);
}
