/**
 * Git-Spice Stack View — webview entry point.
 *
 * Mounts the StackView React tree into the webview's #repoContainer
 * and bridges acquireVsCodeApi to it. All UI behavior lives in
 * components/StackView.tsx; this file only handles the bootstrap
 * (DOM mount, message subscription, posting 'ready').
 */

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { StackView } from './webview/components/StackView';
import type { ExtensionMessage, WebviewMessage } from './webviewTypes';

document.addEventListener('DOMContentLoaded', () => {
	try {
		bootstrap();
	} catch (err) {
		const errorEl = document.getElementById('error');
		if (errorEl) {
			errorEl.textContent = `StackView init error: ${err instanceof Error ? err.message : String(err)}`;
			errorEl.classList.remove('hidden');
		}
		console.error('StackView initialization error:', err);
	}
});

function bootstrap(): void {
	const vscode = acquireVsCodeApi();
	const container = document.getElementById('repoContainer');
	if (!container) throw new Error('#repoContainer not found in webview HTML');

	const post = (message: WebviewMessage): void => vscode.postMessage(message);
	const subscribe = (handler: (message: ExtensionMessage) => void): (() => void) => {
		const listener = (event: MessageEvent): void => handler(event.data as ExtensionMessage);
		window.addEventListener('message', listener);
		return () => window.removeEventListener('message', listener);
	};

	const root = createRoot(container);
	root.render(createElement(StackView, { postMessage: post, subscribeMessages: subscribe }));
	post({ type: 'ready' });
}
