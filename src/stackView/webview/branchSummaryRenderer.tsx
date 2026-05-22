/**
 * Branch summary renderer — mounts the React BranchSummary component inside
 * a DOM container and bridges the imperative parent (StackView) to the
 * React tree.
 *
 * The parent owns expanded/file state via BranchSummaryState. This module
 * captures a `rerender` closure per container so the parent can mutate
 * state and trigger a fresh React render without re-creating the root.
 */

import { createRoot, type Root } from 'react-dom/client';

import type { CommitFileChange } from '../types';
import type { WebviewMessage } from '../webviewTypes';
import { BranchSummary } from './components/BranchSummary';

/** Callback for posting messages to the extension host. */
export type PostMessage = (message: WebviewMessage) => void;

/** State for tracking expanded branch summaries and cached file data. */
export interface BranchSummaryState {
	expandedBranches: Set<string>;
	fileCache: Map<string, CommitFileChange[]>;
}

/** Per-container metadata for triggering re-renders from outside. */
interface MountedSummary {
	root: Root;
	rerender: () => void;
}

const mounted = new WeakMap<Element, MountedSummary>();

/** Renders the expandable "Summarized Changes" section for a branch. */
export function renderBranchSummary(
	branchName: string,
	state: BranchSummaryState,
	postMessage: PostMessage,
): HTMLElement {
	const container = document.createElement('div');
	container.dataset.branchSummary = branchName;

	const root = createRoot(container);
	const rerender = (): void => {
		const expanded = state.expandedBranches.has(branchName);
		const files = state.fileCache.get(branchName);
		root.render(
			<BranchSummary
				branchName={branchName}
				expanded={expanded}
				files={files}
				onToggle={() => handleToggle(branchName, state, postMessage, rerender)}
				onOpenDiff={() => postMessage({ type: 'openBranchDiff', branchName })}
				onOpenFileDiff={(path, status) => postMessage({ type: 'openBranchFileDiff', branchName, path, status })}
				onOpenCurrentFile={(path) => postMessage({ type: 'openCurrentFile', path })}
			/>,
		);
	};

	mounted.set(container, { root, rerender });
	rerender();
	return container;
}

/** Toggles expansion, requesting files lazily on first expand. */
function handleToggle(
	branchName: string,
	state: BranchSummaryState,
	postMessage: PostMessage,
	rerender: () => void,
): void {
	if (state.expandedBranches.has(branchName)) {
		state.expandedBranches.delete(branchName);
	} else {
		state.expandedBranches.add(branchName);
		if (!state.fileCache.has(branchName)) {
			postMessage({ type: 'getBranchFiles', branchName });
		}
	}
	rerender();
}

/** Handles the response containing file changes for a branch summary. */
export function handleBranchFilesResponse(
	branchName: string,
	files: CommitFileChange[],
	stackList: HTMLElement,
	state: BranchSummaryState,
	// postMessage retained for signature compatibility; not used in the React path.
	_postMessage: PostMessage,
): void {
	state.fileCache.set(branchName, files);

	const container =
		stackList.querySelector(`.branch-summary[data-branch-summary="${branchName}"]`) ??
		stackList.querySelector(`[data-branch-summary="${branchName}"]`);
	if (!container) return;

	mounted.get(container)?.rerender();
}
