/**
 * Uncommitted-changes mount wrapper.
 *
 * Creates the `<li class="stack-item uncommitted-item">` wrapper,
 * prepends the tree-fragment SVG (still produced by the imperative
 * createTreeFragmentSvg helper), and mounts the UncommittedCard
 * React tree inside.
 *
 * Per-container WeakMap holds the React root + rerender closure so
 * state mutations (toggle a section, update the commit message text)
 * trigger a re-render with fresh props.
 */

import { createRoot, type Root } from 'react-dom/client';

import type { TreeFragmentData, FileChangeStatus, UncommittedState } from '../types';
import type { WebviewMessage } from '../webviewTypes';
import { type TreeColors, createTreeFragmentSvg } from '../tree/treeFragment';
import { UncommittedCard } from './components/UncommittedCard';

/** Callback for posting messages to the extension host. */
export type PostMessage = (message: WebviewMessage) => void;

/** State for expanded sections and commit message. */
export interface WorkingCopyState {
	expandedStagedSection: boolean;
	expandedUnstagedSection: boolean;
	commitMessageValue: string;
}

interface MountedCard {
	root: Root;
	rerender: () => void;
}

const mounted = new WeakMap<Element, MountedCard>();

/** Renders the uncommitted changes card wrapper with tree SVG. */
export function renderUncommittedCard(
	uncommitted: UncommittedState,
	treeFragment: TreeFragmentData,
	treeColors: TreeColors,
	state: WorkingCopyState,
	postMessage: PostMessage,
): HTMLElement {
	const wrapper = document.createElement('li');
	wrapper.className = 'stack-item uncommitted-item';
	wrapper.dataset.branch = '__uncommitted__';

	wrapper.appendChild(createTreeFragmentSvg(treeFragment, treeColors));
	wrapper.appendChild(mountCard(uncommitted, state, postMessage));
	return wrapper;
}

/** Renders without a tree SVG (used when the current branch is untracked). */
export function renderTreelessUncommittedCard(
	uncommitted: UncommittedState,
	state: WorkingCopyState,
	postMessage: PostMessage,
): HTMLElement {
	const wrapper = document.createElement('li');
	wrapper.className = 'stack-item uncommitted-item treeless';
	wrapper.dataset.branch = '__uncommitted__';
	wrapper.appendChild(mountCard(uncommitted, state, postMessage));
	return wrapper;
}

function mountCard(uncommitted: UncommittedState, state: WorkingCopyState, postMessage: PostMessage): HTMLElement {
	const host = document.createElement('div');
	const root = createRoot(host);

	const rerender = (): void => {
		root.render(
			<UncommittedCard
				uncommitted={uncommitted}
				expandedStaged={state.expandedStagedSection}
				expandedUnstaged={state.expandedUnstagedSection}
				commitMessage={state.commitMessageValue}
				onToggleStaged={() => {
					state.expandedStagedSection = !state.expandedStagedSection;
					rerender();
				}}
				onToggleUnstaged={() => {
					state.expandedUnstagedSection = !state.expandedUnstagedSection;
					rerender();
				}}
				onCommitMessageChange={(v) => {
					state.commitMessageValue = v;
					rerender();
				}}
				onStage={(path) => postMessage({ type: 'stageFile', path })}
				onUnstage={(path) => postMessage({ type: 'unstageFile', path })}
				onDiscard={(path) => postMessage({ type: 'discardFile', path })}
				onOpenFile={(path) => postMessage({ type: 'openCurrentFile', path })}
				onOpenDiff={(path, staged, status: FileChangeStatus) =>
					postMessage({ type: 'openWorkingCopyDiff', path, staged, status })
				}
				onCreateBranch={(message) => {
					postMessage({ type: 'createBranch', message });
					state.commitMessageValue = '';
					rerender();
				}}
				onCommit={(message) => {
					postMessage({ type: 'commitChanges', message });
					state.commitMessageValue = '';
					rerender();
				}}
			/>,
		);
	};

	mounted.set(host, { root, rerender });
	rerender();
	return host;
}
