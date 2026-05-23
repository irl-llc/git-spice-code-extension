/**
 * Commits container mount wrapper.
 *
 * Thin bridge between StackView's imperative DOM tree and the CommitList
 * React component. Preserves the existing API
 * (renderCommitsContainer, handleCommitFilesResponse,
 * CommitRendererState) so stackView.ts and branchRenderer don't need
 * to change.
 *
 * Pattern matches branchSummaryRenderer.tsx: per-container WeakMap of
 * React root + rerender closure. handleCommitFilesResponse mutates the
 * state map and calls rerender to push fresh files into CommitList.
 */

import { createRoot, type Root } from 'react-dom/client';

import type { BranchViewModel, CommitFileChange } from '../types';
import type { WebviewMessage } from '../webviewTypes';
import { CommitList } from './components/CommitList';

/** Callback for posting messages to the extension host. */
export type PostMessage = (message: WebviewMessage) => void;

/** State management for expanded commits and file cache. */
export interface CommitRendererState {
	expandedCommits: Set<string>;
	fileCache: Map<string, CommitFileChange[]>;
}

interface MountedCommits {
	root: Root;
	rerender: () => void;
}

const mounted = new WeakMap<Element, MountedCommits>();

/** Creates a commits container for a branch. */
export function renderCommitsContainer(
	branch: BranchViewModel,
	state: CommitRendererState,
	postMessage: PostMessage,
	// Animations + treeColors were used by the imperative diffList; React handles
	// reconciliation now, so they're accepted-and-ignored for signature compat.
	_animations: unknown,
	_treeColors: unknown,
): HTMLElement {
	const container = document.createElement('div');
	const root = createRoot(container);

	const rerender = (): void => {
		root.render(
			<CommitList
				branchName={branch.name}
				commits={branch.commits ?? []}
				expandedShas={state.expandedCommits}
				fileCache={state.fileCache}
				onToggle={(sha) => handleToggle(sha, state, postMessage, rerender)}
				onOpenCommitDiff={(sha) => {
					if (typeof sha !== 'string' || sha.length === 0) {
						console.error('Invalid commit SHA for diff request:', sha);
						return;
					}
					postMessage({ type: 'openCommitDiff', sha });
				}}
				onOpenFileDiff={(sha, path) => postMessage({ type: 'openFileDiff', sha, path })}
				onOpenCurrentFile={(path) => postMessage({ type: 'openCurrentFile', path })}
			/>,
		);
	};

	mounted.set(container, { root, rerender });
	rerender();
	return container;
}

/** Toggles expansion of a commit's file list, fetching files on first expand. */
function handleToggle(sha: string, state: CommitRendererState, postMessage: PostMessage, rerender: () => void): void {
	if (state.expandedCommits.has(sha)) {
		state.expandedCommits.delete(sha);
	} else {
		state.expandedCommits.add(sha);
		if (!state.fileCache.has(sha)) {
			postMessage({ type: 'getCommitFiles', sha });
		}
	}
	rerender();
}

/**
 * Public toggle entry point (preserved from the imperative API in case
 * external callers existed; the container arg is used to locate the
 * mounted root).
 */
export function toggleCommitExpand(
	sha: string,
	container: HTMLElement,
	state: CommitRendererState,
	postMessage: PostMessage,
): void {
	const mount = mounted.get(container);
	if (mount) {
		handleToggle(sha, state, postMessage, mount.rerender);
	}
}

/** Handles response containing file changes for a commit. */
export function handleCommitFilesResponse(
	sha: string,
	files: CommitFileChange[],
	stackList: HTMLElement,
	state: CommitRendererState,
	// postMessage retained for signature compatibility; the React path
	// re-renders via the stored rerender closure.
	_postMessage: PostMessage,
): void {
	state.fileCache.set(sha, files);

	// The commits container that holds the React root could be anywhere
	// under stackList. Walk up from a sha-matching child if present.
	const commitContainer = stackList.querySelector(`.commit-container[data-sha="${sha}"]`);
	if (!commitContainer) return;

	const commitsRoot = commitContainer.closest('[data-commits-container="true"]')?.parentElement;
	if (!commitsRoot) return;

	mounted.get(commitsRoot)?.rerender();
}
