/**
 * Component tests for StackView.tsx — focused on the refresh indicator.
 *
 * The extension host sends a `refreshing` message when a refresh starts and
 * a `state` message when it completes. The indicator must appear on the
 * former and clear on the latter, so users get visible feedback that the
 * refresh button actually did something.
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

function indicator(container: HTMLElement): Element | null {
	return container.querySelector('[data-role="refresh-indicator"]');
}

describe('StackView refresh indicator', () => {
	beforeEach(installJsdomGlobals);
	afterEach(cleanup);

	it('is hidden before any refresh begins', () => {
		const h = renderStackView();
		assert.strictEqual(indicator(h.container), null);
	});

	it('appears on a `refreshing` message even before any state arrives', () => {
		const h = renderStackView();
		h.emit({ type: 'refreshing' });
		assert.ok(indicator(h.container), 'expected refresh indicator to render');
	});

	it('clears when the resulting `state` message arrives', () => {
		const h = renderStackView();
		h.emit({ type: 'refreshing' });
		assert.ok(indicator(h.container), 'indicator should be visible during refresh');
		h.emit({ type: 'state', payload: { repositories: [] } });
		assert.strictEqual(indicator(h.container), null, 'indicator should clear after state arrives');
	});

	it('re-appears on a subsequent refresh after a completed one', () => {
		const h = renderStackView();
		h.emit({ type: 'refreshing' });
		h.emit({ type: 'state', payload: { repositories: [] } });
		h.emit({ type: 'refreshing' });
		assert.ok(indicator(h.container), 'indicator should re-appear on the next refresh');
	});
});
