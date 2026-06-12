/**
 * Component tests for StackView.tsx — message handling and the initial-state
 * handshake. Also guards that no in-view refresh indicator renders (#71):
 * progress feedback lives in VS Code notifications, not the view.
 */

// MUST be first — installs JSDOM globals before testing-library imports.
import { installJsdomGlobals } from '../reactTestHelper';

import * as assert from 'assert';
import { act, cleanup, render } from '@testing-library/react';

import { StackView } from '../../../../stackView/webview/components/StackView';
import type { ExtensionMessage, WebviewMessage } from '../../../../stackView/webviewTypes';

interface Harness {
	emit: (message: ExtensionMessage) => void;
	messages: WebviewMessage[];
	container: HTMLElement;
}

function renderStackView(): Harness {
	const handlers: Array<(message: ExtensionMessage) => void> = [];
	const messages: WebviewMessage[] = [];
	const { container } = render(
		<StackView
			postMessage={(m) => messages.push(m)}
			subscribeMessages={(handler) => {
				handlers.push(handler);
				return () => {
					const i = handlers.indexOf(handler);
					if (i >= 0) handlers.splice(i, 1);
				};
			}}
		/>,
	);
	const emit = (message: ExtensionMessage): void => {
		act(() => {
			for (const handler of handlers) handler(message);
		});
	};
	return { emit, messages, container };
}

describe('StackView refresh indicator (removed, issue #71)', () => {
	beforeEach(installJsdomGlobals);
	afterEach(cleanup);

	// The in-view refresh banner was removed: user-initiated operations get a
	// VS Code progress notification, and background watch refreshes are
	// silent. The old banner appeared/disappeared per refresh, shifting layout
	// on every watcher cycle — the visible half of the refresh storm.
	it('never renders an in-view refresh indicator, even across state updates', () => {
		const h = renderStackView();
		assert.strictEqual(h.container.querySelector('[data-role="refresh-indicator"]'), null);
		h.emit({ type: 'state', payload: { repositories: [] } });
		assert.strictEqual(h.container.querySelector('[data-role="refresh-indicator"]'), null);
		assert.strictEqual(h.container.querySelector('.refresh-indicator'), null);
	});
});

describe('StackView initial-state handshake (issue #67)', () => {
	beforeEach(installJsdomGlobals);
	afterEach(cleanup);

	it('posts `ready` from the subscribe effect, so the listener is attached first', () => {
		const h = renderStackView();
		// `ready` is posted by the subscribe effect (after the message listener
		// is attached), not synchronously at bootstrap before it — otherwise the
		// host's state reply could land before we subscribe and be dropped.
		assert.deepStrictEqual(h.messages, [{ type: 'ready' }]);
		// The listener is live, so the host's state reply renders.
		h.emit({ type: 'state', payload: { repositories: [] } });
		assert.ok(h.container.querySelector('.empty'), 'state reply renders once the listener is attached');
	});
});
