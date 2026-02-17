/**
 * Repo section renderer — creates and manages per-repo section elements.
 * Each section has a collapsible header, toolbar, and branch list container.
 */

import type { PostMessage } from './branchRenderer';

/** Toolbar action definition for per-repo buttons. */
interface ToolbarAction {
	title: string;
	icon: string;
	messageType: 'stackRestack' | 'repoSync' | 'stackSubmit';
}

const REPO_TOOLBAR_ACTIONS: ToolbarAction[] = [
	{ title: 'Restack Stack', icon: 'codicon-layers', messageType: 'stackRestack' },
	{ title: 'Sync Repository', icon: 'codicon-sync', messageType: 'repoSync' },
	{ title: 'Submit Stack', icon: 'codicon-cloud-upload', messageType: 'stackSubmit' },
];

/** Creates a repo section element with header, toolbar, and branch list. */
export function renderRepoSection(repoId: string, repoName: string, postMessage: PostMessage): HTMLElement {
	const section = document.createElement('section');
	section.className = 'repo-section expanded';
	section.dataset.repoId = repoId;

	section.appendChild(createRepoHeader(repoId, repoName, section, postMessage));
	section.appendChild(createBranchList());
	section.appendChild(createStatusArea('repo-error', 'error hidden'));
	section.appendChild(createStatusArea('repo-empty', 'empty hidden'));

	return section;
}

/** Creates the clickable repo header with icon, name, toolbar, and toggle chevron. */
function createRepoHeader(repoId: string, repoName: string, section: HTMLElement, postMessage: PostMessage): HTMLElement {
	const header = document.createElement('div');
	header.className = 'repo-header';
	header.appendChild(createIcon('codicon-repo'));
	header.appendChild(createNameSpan(repoName));
	header.appendChild(createRepoToolbar(repoId, postMessage));
	header.appendChild(createIcon('codicon-chevron-down repo-toggle'));
	header.addEventListener('click', (e) => {
		// Don't toggle when clicking toolbar buttons
		if ((e.target as HTMLElement).closest('.repo-toolbar')) return;
		toggleSection(section);
	});
	return header;
}

/** Creates the per-repo toolbar with action buttons. */
function createRepoToolbar(repoId: string, postMessage: PostMessage): HTMLElement {
	const toolbar = document.createElement('div');
	toolbar.className = 'repo-toolbar';
	for (const action of REPO_TOOLBAR_ACTIONS) {
		toolbar.appendChild(createActionButton(repoId, action, postMessage));
	}
	return toolbar;
}

/** Creates a single toolbar action button. */
function createActionButton(repoId: string, action: ToolbarAction, postMessage: PostMessage): HTMLElement {
	const btn = document.createElement('button');
	btn.className = 'repo-action-btn';
	btn.title = action.title;
	btn.appendChild(createIcon(action.icon));
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		postMessage({ type: action.messageType, repoId });
	});
	return btn;
}

/** Creates an icon element with the given codicon class. */
function createIcon(codiconClass: string): HTMLElement {
	const icon = document.createElement('i');
	icon.className = `codicon ${codiconClass}`;
	return icon;
}

/** Creates a span for the repo name. */
function createNameSpan(name: string): HTMLElement {
	const span = document.createElement('span');
	span.className = 'repo-name';
	span.textContent = name;
	return span;
}

/** Creates the branch list container within a repo section. */
function createBranchList(): HTMLElement {
	const ul = document.createElement('ul');
	ul.className = 'repo-branch-list stack-list';
	return ul;
}

/** Creates a status area (error or empty message) within a repo section. */
function createStatusArea(dataRole: string, className: string): HTMLElement {
	const el = document.createElement('section');
	el.className = className;
	el.dataset.role = dataRole;
	return el;
}

/** Toggles a repo section between expanded and collapsed. */
function toggleSection(section: HTMLElement): void {
	section.classList.toggle('expanded');
	const toggle = section.querySelector('.repo-toggle');
	if (!toggle) return;
	const isExpanded = section.classList.contains('expanded');
	toggle.classList.toggle('codicon-chevron-down', isExpanded);
	toggle.classList.toggle('codicon-chevron-right', !isExpanded);
}

/** Returns the branch list element from a repo section. */
export function getBranchList(section: HTMLElement): HTMLElement {
	return section.querySelector('.repo-branch-list')!;
}

/** Returns the error element from a repo section. */
export function getErrorElement(section: HTMLElement): HTMLElement {
	return section.querySelector('[data-role="repo-error"]')!;
}

/** Returns the empty element from a repo section. */
export function getEmptyElement(section: HTMLElement): HTMLElement {
	return section.querySelector('[data-role="repo-empty"]')!;
}
