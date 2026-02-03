/**
 * Branch summary renderer for displaying aggregated file changes across a branch.
 * Shows an expandable section with all files changed from merge-base to branch tip.
 */

import type { CommitFileChange } from '../types';
import type { WebviewMessage } from '../webviewTypes';
import {
	createFileRow,
	appendFileStatus,
	createFileActionButton,
} from './fileRowHelpers';

/** Callback for posting messages to the extension host. */
export type PostMessage = (message: WebviewMessage) => void;

/** State for tracking expanded branch summaries and cached file data. */
export interface BranchSummaryState {
	expandedBranches: Set<string>;
	fileCache: Map<string, CommitFileChange[]>;
}

/** Renders the expandable "Summarized Changes" section for a branch. */
export function renderBranchSummary(
	branchName: string,
	state: BranchSummaryState,
	postMessage: PostMessage,
): HTMLElement {
	const container = document.createElement('div');
	container.className = 'branch-summary';
	container.dataset.branchSummary = branchName;

	const header = renderSummaryHeader(branchName, container, state, postMessage);
	container.appendChild(header);

	const fileList = renderSummaryFileList(branchName, state, postMessage);
	container.appendChild(fileList);

	return container;
}

/** Renders the clickable summary header with chevron toggle and label. */
function renderSummaryHeader(
	branchName: string,
	container: HTMLElement,
	state: BranchSummaryState,
	postMessage: PostMessage,
): HTMLElement {
	const header = document.createElement('div');
	header.className = 'branch-summary-header';

	const isExpanded = state.expandedBranches.has(branchName);
	header.appendChild(createToggleIcon(isExpanded));
	header.appendChild(createSummaryLabel());

	header.addEventListener('click', (event: Event) => {
		event.stopPropagation();
		toggleSummaryExpand(branchName, container, state, postMessage);
	});

	return header;
}

/** Creates the chevron toggle icon. */
function createToggleIcon(isExpanded: boolean): HTMLElement {
	const toggle = document.createElement('i');
	const direction = isExpanded ? 'down' : 'right';
	toggle.className = `branch-summary-toggle codicon codicon-chevron-${direction}`;
	toggle.role = 'button';
	toggle.tabIndex = 0;
	return toggle;
}

/** Creates the "Summarized Changes" label element. */
function createSummaryLabel(): HTMLElement {
	const label = document.createElement('span');
	label.className = 'branch-summary-label';
	label.textContent = 'Summarized Changes';
	return label;
}

/** Renders the file list container (hidden or populated based on state). */
function renderSummaryFileList(
	branchName: string,
	state: BranchSummaryState,
	postMessage: PostMessage,
): HTMLElement {
	const fileList = document.createElement('div');
	fileList.className = 'branch-summary-files';

	const isExpanded = state.expandedBranches.has(branchName);
	if (!isExpanded) {
		fileList.classList.add('hidden');
	}

	if (isExpanded && state.fileCache.has(branchName)) {
		renderBranchFileChanges(fileList, state.fileCache.get(branchName)!, branchName, postMessage);
	}

	return fileList;
}

/** Toggles expansion of the summary section. */
function toggleSummaryExpand(
	branchName: string,
	container: HTMLElement,
	state: BranchSummaryState,
	postMessage: PostMessage,
): void {
	const isExpanded = state.expandedBranches.has(branchName);
	const toggle = container.querySelector('.branch-summary-toggle') as HTMLElement;
	const fileList = container.querySelector('.branch-summary-files') as HTMLElement;

	if (isExpanded) {
		collapseSummary(branchName, toggle, fileList, state);
	} else {
		expandSummary(branchName, toggle, fileList, state, postMessage);
	}
}

/** Collapses the summary file list. */
function collapseSummary(
	branchName: string,
	toggle: HTMLElement,
	fileList: HTMLElement,
	state: BranchSummaryState,
): void {
	state.expandedBranches.delete(branchName);
	toggle.classList.remove('codicon-chevron-down');
	toggle.classList.add('codicon-chevron-right');
	fileList.classList.add('hidden');
}

/** Expands the summary file list and fetches files if needed. */
function expandSummary(
	branchName: string,
	toggle: HTMLElement,
	fileList: HTMLElement,
	state: BranchSummaryState,
	postMessage: PostMessage,
): void {
	state.expandedBranches.add(branchName);
	toggle.classList.remove('codicon-chevron-right');
	toggle.classList.add('codicon-chevron-down');
	fileList.classList.remove('hidden');

	if (!state.fileCache.has(branchName)) {
		fileList.innerHTML = '<div class="branch-summary-loading">Loading...</div>';
		postMessage({ type: 'getBranchFiles', branchName });
	} else {
		renderBranchFileChanges(fileList, state.fileCache.get(branchName)!, branchName, postMessage);
	}
}

/** Handles the response containing file changes for a branch summary. */
export function handleBranchFilesResponse(
	branchName: string,
	files: CommitFileChange[],
	stackList: HTMLElement,
	state: BranchSummaryState,
	postMessage: PostMessage,
): void {
	state.fileCache.set(branchName, files);

	const container = stackList.querySelector(`.branch-summary[data-branch-summary="${branchName}"]`);
	if (!container) return;

	const fileList = container.querySelector('.branch-summary-files') as HTMLElement;
	if (fileList && state.expandedBranches.has(branchName)) {
		renderBranchFileChanges(fileList, files, branchName, postMessage);
	}
}

/** Renders the file change rows into the summary file list. */
function renderBranchFileChanges(
	container: HTMLElement,
	files: CommitFileChange[],
	branchName: string,
	postMessage: PostMessage,
): void {
	container.innerHTML = '';

	if (files.length === 0) {
		container.innerHTML = '<div class="branch-summary-empty">No files changed</div>';
		return;
	}

	for (const file of files) {
		container.appendChild(renderBranchFileRow(file, branchName, postMessage));
	}
}

/** Renders a single file change row for a branch summary. */
function renderBranchFileRow(file: CommitFileChange, branchName: string, postMessage: PostMessage): HTMLElement {
	const row = createFileRow(file.path);

	if (file.status !== 'D') {
		row.appendChild(createFileActionButton('codicon-go-to-file', 'Open current file', () => {
			postMessage({ type: 'openCurrentFile', path: file.path });
		}));
	}

	appendFileStatus(row, file.status);

	row.addEventListener('click', (e) => {
		if ((e.target as HTMLElement).closest('button')) return;
		e.stopPropagation();
		postMessage({ type: 'openBranchFileDiff', branchName, path: file.path });
	});

	return row;
}
