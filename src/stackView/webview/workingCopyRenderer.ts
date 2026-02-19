/**
 * Working copy (uncommitted changes) rendering.
 * Handles staged/unstaged file sections and commit form.
 */

import type { TreeFragmentData, UncommittedState, WorkingCopyChange } from '../types';
import type { WebviewMessage } from '../webviewTypes';
import type { TreeColors } from '../tree/treeFragment';
import { createTreeFragmentSvg } from '../tree/treeFragment';
import {
	createFileRow,
	appendFileStatus,
	createFileActionButton,
} from './fileRowHelpers';

/** Callback for posting messages to the extension host. */
export type PostMessage = (message: WebviewMessage) => void;

/** State for expanded sections and commit message. */
export interface WorkingCopyState {
	expandedStagedSection: boolean;
	expandedUnstagedSection: boolean;
	commitMessageValue: string;
}

/** Renders the uncommitted changes card wrapper. */
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
	wrapper.appendChild(createUncommittedCard(uncommitted, state, postMessage));

	return wrapper;
}

/** Creates the uncommitted card element. */
function createUncommittedCard(
	uncommitted: UncommittedState,
	state: WorkingCopyState,
	postMessage: PostMessage,
): HTMLElement {
	const card = document.createElement('article');
	card.className = 'branch-card uncommitted expanded';
	card.appendChild(renderUncommittedContent(uncommitted, state, postMessage));
	return card;
}

/** Renders the inner content of the uncommitted card. */
function renderUncommittedContent(
	uncommitted: UncommittedState,
	state: WorkingCopyState,
	postMessage: PostMessage,
): HTMLElement {
	const content = document.createElement('div');
	content.className = 'branch-content';
	content.appendChild(renderUncommittedHeader());
	content.appendChild(renderChangesSections(uncommitted, state, postMessage));
	content.appendChild(renderCommitForm(state, postMessage));
	return content;
}

/** Renders the uncommitted changes header. */
function renderUncommittedHeader(): HTMLElement {
	const header = document.createElement('div');
	header.className = 'branch-header';

	const spacer = document.createElement('span');
	spacer.className = 'branch-toggle-spacer';
	header.appendChild(spacer);

	const nameSpan = document.createElement('span');
	nameSpan.className = 'branch-name';
	nameSpan.textContent = 'Uncommitted Changes';
	header.appendChild(nameSpan);

	const tags = document.createElement('div');
	tags.className = 'branch-tags';
	header.appendChild(tags);

	return header;
}

/** Renders staged and unstaged sections container. */
function renderChangesSections(
	uncommitted: UncommittedState,
	state: WorkingCopyState,
	postMessage: PostMessage,
): HTMLElement {
	const container = document.createElement('div');
	container.className = 'uncommitted-sections';

	if (uncommitted.staged.length > 0) {
		container.appendChild(
			renderChangesSection('Staged Changes', uncommitted.staged, state.expandedStagedSection, true, state, postMessage),
		);
	}
	if (uncommitted.unstaged.length > 0) {
		container.appendChild(
			renderChangesSection('Changes', uncommitted.unstaged, state.expandedUnstagedSection, false, state, postMessage),
		);
	}

	return container;
}

/** Renders a collapsible section for staged or unstaged changes. */
function renderChangesSection(
	title: string,
	files: WorkingCopyChange[],
	expanded: boolean,
	isStaged: boolean,
	state: WorkingCopyState,
	postMessage: PostMessage,
): HTMLElement {
	const section = document.createElement('div');
	section.className = 'changes-section';

	const fileList = renderFileList(files, isStaged, expanded, postMessage);
	const header = renderSectionHeader(title, files.length, fileList, isStaged, state);

	section.appendChild(header);
	section.appendChild(fileList);
	return section;
}

/** Renders the section header with toggle and count. */
function renderSectionHeader(
	title: string,
	count: number,
	fileList: HTMLElement,
	isStaged: boolean,
	state: WorkingCopyState,
): HTMLElement {
	const header = document.createElement('div');
	header.className = 'changes-section-header';

	const toggle = document.createElement('i');
	toggle.className = `codicon codicon-chevron-${fileList.classList.contains('hidden') ? 'right' : 'down'}`;
	header.appendChild(toggle);

	const titleSpan = document.createElement('span');
	titleSpan.textContent = `${title} (${count})`;
	header.appendChild(titleSpan);

	header.addEventListener('click', () => toggleSection(toggle, fileList, isStaged, state));
	return header;
}

/** Toggles a changes section expanded/collapsed. */
function toggleSection(
	toggle: HTMLElement,
	fileList: HTMLElement,
	isStaged: boolean,
	state: WorkingCopyState,
): void {
	const isExpanded = toggle.classList.contains('codicon-chevron-down');
	toggle.classList.toggle('codicon-chevron-down', !isExpanded);
	toggle.classList.toggle('codicon-chevron-right', isExpanded);
	fileList.classList.toggle('hidden', isExpanded);

	if (isStaged) {
		state.expandedStagedSection = !isExpanded;
	} else {
		state.expandedUnstagedSection = !isExpanded;
	}
}

/** Renders the file list for a changes section. */
function renderFileList(
	files: WorkingCopyChange[],
	isStaged: boolean,
	expanded: boolean,
	postMessage: PostMessage,
): HTMLElement {
	const fileList = document.createElement('div');
	fileList.className = 'commit-files' + (expanded ? '' : ' hidden');

	for (const file of files) {
		fileList.appendChild(renderWorkingCopyFileRow(file, isStaged, postMessage));
	}
	return fileList;
}

/** Renders a file row for working copy changes with actions. */
function renderWorkingCopyFileRow(
	file: WorkingCopyChange,
	isStaged: boolean,
	postMessage: PostMessage,
): HTMLElement {
	const row = createFileRow(file.path);
	appendWorkingCopyActions(row, file, isStaged, postMessage);
	appendFileStatus(row, file.status);
	row.addEventListener('click', (e) => handleFileClick(e, file.path, isStaged, postMessage));
	return row;
}

/** Appends stage/unstage/discard action buttons. */
function appendWorkingCopyActions(
	row: HTMLElement,
	file: WorkingCopyChange,
	isStaged: boolean,
	postMessage: PostMessage,
): void {
	if (isStaged) {
		row.appendChild(createFileActionButton('codicon-remove', 'Unstage', () => {
			postMessage({ type: 'unstageFile', path: file.path });
		}));
	} else {
		row.appendChild(createFileActionButton('codicon-discard', 'Discard Changes', () => {
			postMessage({ type: 'discardFile', path: file.path });
		}));
		row.appendChild(createFileActionButton('codicon-add', 'Stage', () => {
			postMessage({ type: 'stageFile', path: file.path });
		}));
	}

	if (file.status !== 'D') {
		row.appendChild(createFileActionButton('codicon-go-to-file', 'Open File', () => {
			postMessage({ type: 'openCurrentFile', path: file.path });
		}));
	}
}

/** Handles click on a working copy file row. */
function handleFileClick(event: Event, path: string, staged: boolean, postMessage: PostMessage): void {
	if ((event.target as HTMLElement).closest('button')) return;
	event.stopPropagation();
	postMessage({ type: 'openWorkingCopyDiff', path, staged });
}

/** Renders the commit message input and action buttons. */
function renderCommitForm(state: WorkingCopyState, postMessage: PostMessage): HTMLElement {
	const form = document.createElement('div');
	form.className = 'commit-form';

	const createBranchBtn = createCommitButton('Create new branch', 'commit-btn-primary');
	const commitBtn = createCommitButton('Add to current branch', 'commit-btn-secondary');
	const buttons = [createBranchBtn, commitBtn];

	const input = createCommitInput(buttons, state, postMessage);
	form.appendChild(input);

	const actions = document.createElement('div');
	actions.className = 'commit-actions';

	createBranchBtn.addEventListener('click', () => submitCommit(input, 'createBranch', state, postMessage));
	actions.appendChild(createBranchBtn);

	commitBtn.addEventListener('click', () => submitCommit(input, 'commitChanges', state, postMessage));
	actions.appendChild(commitBtn);

	form.appendChild(actions);
	return form;
}

/** Creates the commit message input element. */
function createCommitInput(
	buttons: HTMLButtonElement[],
	state: WorkingCopyState,
	postMessage: PostMessage,
): HTMLInputElement {
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'commit-message-input';
	input.placeholder = 'Message (press Enter to commit)';
	input.value = state.commitMessageValue;

	input.addEventListener('input', () => {
		state.commitMessageValue = input.value;
		syncButtonStates(input, buttons);
	});

	input.addEventListener('keydown', (e: KeyboardEvent) => {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		submitCommit(input, 'createBranch', state, postMessage);
	});

	syncButtonStates(input, buttons);
	return input;
}

/** Syncs commit button enabled state with input value. */
function syncButtonStates(input: HTMLInputElement, buttons: HTMLButtonElement[]): void {
	const hasMessage = input.value.trim().length > 0;
	buttons.forEach((btn) => {
		btn.disabled = !hasMessage;
	});
}

/** Creates a commit action button. */
function createCommitButton(label: string, variant: string): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = `commit-btn ${variant}`;
	btn.textContent = label;
	btn.disabled = true;
	return btn;
}

/** Submits the commit message. */
function submitCommit(
	input: HTMLInputElement,
	type: 'createBranch' | 'commitChanges',
	state: WorkingCopyState,
	postMessage: PostMessage,
): void {
	const message = input.value.trim();
	if (!message) return;

	postMessage({ type, message });
	state.commitMessageValue = '';
	input.value = '';
}
