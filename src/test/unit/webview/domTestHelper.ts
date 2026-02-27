/**
 * JSDOM test environment for webview renderer tests.
 * Provides DOM globals (document, window, HTMLElement, etc.)
 * so renderer functions can be tested in Node.js.
 */

import { JSDOM } from 'jsdom';

let dom: JSDOM | undefined;

/** Sets up a JSDOM environment with minimal HTML structure. */
export function setupDom(): void {
	dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
	const g = globalThis as Record<string, unknown>;
	g.document = dom.window.document;
	g.window = dom.window;
	g.HTMLElement = dom.window.HTMLElement;
	g.HTMLInputElement = dom.window.HTMLInputElement;
	g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
	g.Element = dom.window.Element;
}

/** Tears down the JSDOM environment and cleans up globals. */
export function teardownDom(): void {
	dom?.window.close();
	dom = undefined;
	const g = globalThis as Record<string, unknown>;
	delete g.document;
	delete g.window;
	delete g.HTMLElement;
	delete g.HTMLInputElement;
	delete g.HTMLTextAreaElement;
	delete g.Element;
}
