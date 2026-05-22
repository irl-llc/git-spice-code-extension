/**
 * Untracked branch card mount wrapper.
 *
 * Thin bridge between StackView's imperative DOM tree and the
 * UntrackedCard React component. Returns the `<li>` wrapper that goes
 * into the stack list and mounts the React content inside.
 */

import { createRoot } from 'react-dom/client';

import { UntrackedCard } from './components/UntrackedCard';
import type { PostMessage } from './branchRenderer';

/** Renders the untracked branch card as a list item (no tree SVG). */
export function renderUntrackedCard(branchName: string, postMessage: PostMessage): HTMLElement {
	const wrapper = document.createElement('li');
	wrapper.className = 'stack-item untracked-item';
	wrapper.dataset.branch = branchName;

	const root = createRoot(wrapper);
	root.render(
		<UntrackedCard branchName={branchName} onTrack={() => postMessage({ type: 'branchTrack', branchName })} />,
	);

	return wrapper;
}
