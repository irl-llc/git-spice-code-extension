/**
 * Commit list rendering and interaction logic.
 * Handles expandable commit items with file change details.
 */

import type { BranchViewModel, CommitFileChange } from '../types';
import type { WebviewMessage } from '../webviewTypes';
import { COMMIT_RENDER_CHUNK_SIZE } from '../../constants';
import { buildCommitContext } from '../contextBuilder';
import { animateUpdate } from './animationHelpers';
import { diffList, type DiffAnimations, type DiffListConfig } from './diffEngine';
import {
	createFileRow,
	appendFileStatus,
	createFileActionButton,
} from './fileRowHelpers';
import type { TreeColors } from '../tree/treeFragment';

/** Callback for posting messages to the extension host. */
export type PostMessage = (message: WebviewMessage) => void;

/** State management for expanded commits and file cache. */
export interface CommitRendererState {
	expandedCommits: Set<string>;
	fileCache: Map<string, CommitFileChange[]>;
}

/** Creates a commits container for a branch. */
export function renderCommitsContainer(
	branch: BranchViewModel,
	state: CommitRendererState,
	postMessage: PostMessage,
	animations: DiffAnimations,
	treeColors: TreeColors,
): HTMLElement {
	const container = document.createElement('div');
	container.className = 'branch-commits expandable-section';
	container.dataset.commitsContainer = 'true';

	const initialCount = Math.min(branch.commits!.length, COMMIT_RENDER_CHUNK_SIZE);
	renderCommitsIntoContainer(container, branch.commits!, initialCount, branch.name, state, postMessage, animations, treeColors);

	return container;
}

/** Renders commits into a container with pagination support. */
export function renderCommitsIntoContainer(
	container: HTMLElement,
	commits: NonNullable<BranchViewModel['commits']>,
	visibleCount: number,
	branchName: string,
	state: CommitRendererState,
	postMessage: PostMessage,
	animations: DiffAnimations,
	treeColors: TreeColors,
): void {
	const newCommits = commits.slice(0, visibleCount);
	const oldItems = extractOldCommitItems(container);

	const config = createCommitDiffConfig(branchName, state, postMessage);
	diffList(container, oldItems, newCommits, config, animations, treeColors);

	renderShowMoreButton(container, commits, visibleCount, branchName, state, postMessage, animations, treeColors);
}

/** Extracts existing commit items from container for diffing. */
function extractOldCommitItems(container: HTMLElement): NonNullable<BranchViewModel['commits']> {
	return Array.from(container.querySelectorAll('.commit-wrapper'))
		.map((el) => {
			const key = (el as HTMLElement).dataset.key;
			return key ? { sha: key, shortSha: '', subject: '' } : null;
		})
		.filter((item): item is NonNullable<BranchViewModel['commits']>[0] => item !== null);
}

/** Creates diffList config for commit reconciliation. */
function createCommitDiffConfig(
	branchName: string,
	state: CommitRendererState,
	postMessage: PostMessage,
): DiffListConfig<NonNullable<BranchViewModel['commits']>[0]> {
	return {
		getKey: (c) => c.sha,
		render: (c) => renderCommitWrapper(c, branchName, state, postMessage),
		needsUpdate: (el, c) => commitNeedsUpdate(el, c),
		update: (el, c) => updateCommitRow(el, c, branchName, state, postMessage),
		itemSelector: '.commit-wrapper',
		itemClass: 'commit-wrapper',
	};
}

/** Creates a commit wrapper element. */
function renderCommitWrapper(
	commit: NonNullable<BranchViewModel['commits']>[0],
	branchName: string,
	state: CommitRendererState,
	postMessage: PostMessage,
): HTMLElement {
	const wrapper = document.createElement('div');
	wrapper.className = 'commit-wrapper';
	wrapper.dataset.key = commit.sha;

	const container = renderCommitItem(commit, branchName, state, postMessage);
	wrapper.appendChild(container);
	return wrapper;
}

/** Checks if a commit row needs to be updated. */
function commitNeedsUpdate(el: HTMLElement, commit: NonNullable<BranchViewModel['commits']>[0]): boolean {
	const row = el.querySelector('.commit-item');
	if (!row) return true;

	const subjectEl = row.querySelector('.commit-subject');
	const shaEl = row.querySelector('.commit-sha');
	return subjectEl?.textContent !== commit.subject || shaEl?.textContent !== commit.shortSha;
}

/** Updates an existing commit row with new data. */
function updateCommitRow(
	el: HTMLElement,
	commit: NonNullable<BranchViewModel['commits']>[0],
	branchName: string,
	state: CommitRendererState,
	postMessage: PostMessage,
): void {
	const oldRow = el.querySelector('.commit-item');
	if (!oldRow) return;

	const oldSubject = oldRow.querySelector('.commit-subject')?.textContent;
	const oldSha = oldRow.querySelector('.commit-sha')?.textContent;

	const newContainer = renderCommitItem(commit, branchName, state, postMessage);
	const newRow = newContainer.querySelector('.commit-item');

	el.innerHTML = '';
	el.appendChild(newContainer);

	if (newRow) {
		if (oldSubject !== commit.subject) {
			const newSubject = newRow.querySelector('.commit-subject');
			if (newSubject) animateUpdate(newSubject as HTMLElement);
		}
		if (oldSha !== commit.shortSha) {
			const newSha = newRow.querySelector('.commit-sha');
			if (newSha) animateUpdate(newSha as HTMLElement);
		}
	}
}

/** Renders "show more" button if there are more commits to display. */
function renderShowMoreButton(
	container: HTMLElement,
	commits: NonNullable<BranchViewModel['commits']>,
	visibleCount: number,
	branchName: string,
	state: CommitRendererState,
	postMessage: PostMessage,
	animations: DiffAnimations,
	treeColors: TreeColors,
): void {
	container.querySelector('.branch-more')?.remove();

	if (visibleCount >= commits.length) return;

	const remaining = commits.length - visibleCount;
	const more = document.createElement('button');
	more.type = 'button';
	more.className = 'branch-more';
	more.textContent = remaining > COMMIT_RENDER_CHUNK_SIZE
		? `Show more (${remaining})`
		: `Show remaining ${remaining}`;

	more.addEventListener('click', (event: Event) => {
		event.stopPropagation();
		renderCommitsIntoContainer(
			container,
			commits,
			visibleCount + COMMIT_RENDER_CHUNK_SIZE,
			branchName,
			state,
			postMessage,
			animations,
			treeColors,
		);
	});

	container.appendChild(more);
}

/** Renders a single commit item with toggle, subject, and sha. */
function renderCommitItem(
	commit: NonNullable<BranchViewModel['commits']>[0],
	branchName: string,
	state: CommitRendererState,
	postMessage: PostMessage,
): HTMLElement {
	const container = document.createElement('div');
	container.className = 'commit-container';
	container.dataset.sha = commit.sha;

	const row = createCommitRow(commit, branchName);
	const toggle = appendCommitToggle(row, commit.sha, state);

	appendCommitContent(row, commit);
	setupCommitRowClick(row, commit, postMessage);

	container.appendChild(row);
	container.appendChild(createFileListContainer(commit.sha, state, toggle, container, postMessage));

	return container;
}

/** Creates the base commit row element. */
function createCommitRow(commit: NonNullable<BranchViewModel['commits']>[0], branchName: string): HTMLElement {
	const row = document.createElement('div');
	row.className = 'commit-item';
	row.dataset.content = 'true';
	row.dataset.vscodeContext = buildCommitContext(commit.sha, branchName);
	return row;
}

/** Appends the expand toggle to a commit row. */
function appendCommitToggle(row: HTMLElement, sha: string, state: CommitRendererState): HTMLElement {
	const isExpanded = state.expandedCommits.has(sha);
	const toggle = document.createElement('i');
	toggle.className = `commit-toggle codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`;
	toggle.role = 'button';
	toggle.tabIndex = 0;
	row.appendChild(toggle);
	return toggle;
}

/** Appends subject and sha spans to a commit row. */
function appendCommitContent(row: HTMLElement, commit: NonNullable<BranchViewModel['commits']>[0]): void {
	const subject = document.createElement('span');
	subject.className = 'commit-subject';
	subject.textContent = commit.subject;
	row.appendChild(subject);

	const sha = document.createElement('span');
	sha.className = 'commit-sha';
	sha.textContent = commit.shortSha;
	row.appendChild(sha);
}

/** Sets up click handler for commit row to open diff. */
function setupCommitRowClick(
	row: HTMLElement,
	commit: NonNullable<BranchViewModel['commits']>[0],
	postMessage: PostMessage,
): void {
	row.addEventListener('click', (event: Event) => {
		event.stopPropagation();
		const target = event.target as HTMLElement;
		if (target.classList.contains('commit-toggle')) return;

		if (typeof commit.sha !== 'string' || commit.sha.length === 0) {
			console.error('Invalid commit SHA for diff request:', commit);
			return;
		}
		postMessage({ type: 'openCommitDiff', sha: commit.sha });
	});
}

/** Creates the file list container for a commit. */
function createFileListContainer(
	sha: string,
	state: CommitRendererState,
	toggle: HTMLElement,
	container: HTMLElement,
	postMessage: PostMessage,
): HTMLElement {
	const fileList = document.createElement('div');
	fileList.className = 'commit-files';

	const isExpanded = state.expandedCommits.has(sha);
	if (!isExpanded) {
		fileList.classList.add('hidden');
	}

	toggle.addEventListener('click', (event: Event) => {
		event.stopPropagation();
		toggleCommitExpand(sha, container, state, postMessage);
	});

	if (isExpanded && state.fileCache.has(sha)) {
		renderFileChanges(fileList, state.fileCache.get(sha)!, sha, postMessage);
	}

	return fileList;
}

/** Toggles expansion of a commit's file list. */
export function toggleCommitExpand(
	sha: string,
	container: HTMLElement,
	state: CommitRendererState,
	postMessage: PostMessage,
): void {
	const isExpanded = state.expandedCommits.has(sha);
	const toggle = container.querySelector('.commit-toggle') as HTMLElement;
	const fileList = container.querySelector('.commit-files') as HTMLElement;

	if (isExpanded) {
		collapseCommitFiles(sha, toggle, fileList, state);
	} else {
		expandCommitFiles(sha, toggle, fileList, state, postMessage);
	}
}

/** Collapses a commit's file list. */
function collapseCommitFiles(
	sha: string,
	toggle: HTMLElement,
	fileList: HTMLElement,
	state: CommitRendererState,
): void {
	state.expandedCommits.delete(sha);
	toggle.classList.remove('codicon-chevron-down');
	toggle.classList.add('codicon-chevron-right');
	fileList.classList.add('hidden');
}

/** Expands a commit's file list and fetches files if needed. */
function expandCommitFiles(
	sha: string,
	toggle: HTMLElement,
	fileList: HTMLElement,
	state: CommitRendererState,
	postMessage: PostMessage,
): void {
	state.expandedCommits.add(sha);
	toggle.classList.remove('codicon-chevron-right');
	toggle.classList.add('codicon-chevron-down');
	fileList.classList.remove('hidden');

	if (!state.fileCache.has(sha)) {
		fileList.innerHTML = '<div class="commit-files-loading">Loading...</div>';
		postMessage({ type: 'getCommitFiles', sha });
	} else {
		renderFileChanges(fileList, state.fileCache.get(sha)!, sha, postMessage);
	}
}

/** Handles response containing file changes for a commit. */
export function handleCommitFilesResponse(
	sha: string,
	files: CommitFileChange[],
	stackList: HTMLElement,
	state: CommitRendererState,
	postMessage: PostMessage,
): void {
	state.fileCache.set(sha, files);

	const container = stackList.querySelector(`.commit-container[data-sha="${sha}"]`);
	if (!container) return;

	const fileList = container.querySelector('.commit-files') as HTMLElement;
	if (fileList && state.expandedCommits.has(sha)) {
		renderFileChanges(fileList, files, sha, postMessage);
	}
}

/** Renders file changes list for a commit. */
export function renderFileChanges(
	container: HTMLElement,
	files: CommitFileChange[],
	sha: string,
	postMessage: PostMessage,
): void {
	container.innerHTML = '';

	if (files.length === 0) {
		container.innerHTML = '<div class="commit-files-empty">No files changed</div>';
		return;
	}

	for (const file of files) {
		container.appendChild(renderFileChangeRow(file, sha, postMessage));
	}
}

/** Renders a single file change row for a commit. */
function renderFileChangeRow(file: CommitFileChange, sha: string, postMessage: PostMessage): HTMLElement {
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
		postMessage({ type: 'openFileDiff', sha, path: file.path });
	});

	return row;
}
