/**
 * Untracked branch card renderer.
 * Shows a standalone card when the current branch is not tracked by git-spice.
 */

import type { PostMessage } from './branchRenderer';

/** Renders the untracked branch card as a list item (no tree SVG). */
export function renderUntrackedCard(branchName: string, postMessage: PostMessage): HTMLElement {
	const wrapper = document.createElement('li');
	wrapper.className = 'stack-item untracked-item';
	wrapper.dataset.branch = branchName;

	wrapper.appendChild(createUntrackedCard(branchName, postMessage));
	return wrapper;
}

/** Creates the untracked card article element. */
function createUntrackedCard(branchName: string, postMessage: PostMessage): HTMLElement {
	const card = document.createElement('article');
	card.className = 'branch-card untracked expanded';

	card.appendChild(createUntrackedHeader(branchName));
	card.appendChild(createTrackHint(branchName, postMessage));
	return card;
}

/** Creates the card header with branch name, current icon, and UNTRACKED badge. */
function createUntrackedHeader(branchName: string): HTMLElement {
	const header = document.createElement('div');
	header.className = 'branch-header';

	const nameRow = document.createElement('div');
	nameRow.className = 'branch-name-row';
	nameRow.appendChild(createCurrentIcon());
	nameRow.appendChild(createBranchName(branchName));
	header.appendChild(nameRow);

	header.appendChild(createUntrackedTag());
	return header;
}

/** Creates the current-branch checkmark icon. */
function createCurrentIcon(): HTMLElement {
	const icon = document.createElement('i');
	icon.className = 'codicon codicon-check current-branch-icon';
	return icon;
}

/** Creates the branch name span. */
function createBranchName(name: string): HTMLElement {
	const span = document.createElement('span');
	span.className = 'branch-name';
	span.textContent = name;
	return span;
}

/** Creates the UNTRACKED badge tag. */
function createUntrackedTag(): HTMLElement {
	const tags = document.createElement('div');
	tags.className = 'branch-tags';

	const tag = document.createElement('span');
	tag.className = 'tag tag-error';
	tag.textContent = 'Untracked';
	tags.appendChild(tag);

	return tags;
}

/** Creates a hint about tracking the branch with a track button. */
function createTrackHint(branchName: string, postMessage: PostMessage): HTMLElement {
	const hint = document.createElement('div');
	hint.className = 'untracked-hint';

	const text = document.createElement('span');
	text.textContent = 'This branch is not tracked by git-spice.';
	hint.appendChild(text);

	const btn = document.createElement('button');
	btn.className = 'untracked-track-btn';
	btn.textContent = 'Track Branch';
	btn.title = `Track ${branchName} with git-spice`;
	btn.addEventListener('click', () => {
		postMessage({ type: 'branchTrack', branchName });
	});
	hint.appendChild(btn);

	return hint;
}
