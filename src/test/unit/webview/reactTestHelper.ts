/**
 * JSDOM environment for @testing-library/react component tests.
 *
 * Holds ONE long-lived JSDOM instance for the whole mocha process. Other
 * test files in this repo use a teardownDom() that calls `dom.window.close()`
 * and deletes `globalThis.document`. Closed JSDOMs can never be reused, so
 * we keep ours separate and just re-bind globalThis to it in `beforeEach`.
 *
 * Why a top-level side-effect: @testing-library/dom captures references at
 * import time. The first call to `installJsdomGlobals()` therefore happens
 * at module load, so the first time testing-library imports run, real
 * globals exist.
 *
 * Usage:
 *
 *     import { installJsdomGlobals } from '../reactTestHelper'; // first
 *     import { render, screen } from '@testing-library/react';
 *     // …
 *     beforeEach(installJsdomGlobals);
 */

import { JSDOM } from 'jsdom';

let dom: JSDOM | undefined;

/** Returns the singleton JSDOM, creating it on first call. */
function getDom(): JSDOM {
	if (!dom) {
		dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
			url: 'http://localhost/',
			pretendToBeVisual: true,
		});
		copyConstructorsToGlobalThis(dom);
	}
	return dom;
}

/** Copies window properties that aren't already on globalThis (one-time). */
function copyConstructorsToGlobalThis(jsdom: JSDOM): void {
	const g = globalThis as Record<string, unknown>;
	const w = jsdom.window as unknown as Record<string, unknown>;
	for (const key of Object.getOwnPropertyNames(jsdom.window)) {
		if (key in g) continue;
		try {
			g[key] = w[key];
		} catch {
			// Read-only globals (Infinity, NaN, undefined) — skip.
		}
	}
}

/**
 * (Re-)binds globalThis.window and globalThis.document to our singleton
 * JSDOM and clears document.body. Safe to call repeatedly.
 */
export function installJsdomGlobals(): void {
	const jsdom = getDom();
	const g = globalThis as Record<string, unknown>;
	g.window = jsdom.window;
	g.document = jsdom.window.document;
	g.IS_REACT_ACT_ENVIRONMENT = true;
	// Reset body in case a previous test (or another suite's teardown) left
	// orphaned nodes behind.
	jsdom.window.document.body.innerHTML = '';
}

// Run once at module load so testing-library's import-time captures find
// a real document.
installJsdomGlobals();
