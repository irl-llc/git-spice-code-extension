/**
 * Branch card rendering and update logic.
 * Handles the visual representation of branches in the stack view.
 */

import type { BranchViewModel } from '../types';
import type { GitSpiceComments } from '../../gitSpiceSchema';
import type { WebviewMessage } from '../webviewTypes';
import { getBranchData, setBranchData, setTreeFragment } from '../domHelpers';
import { buildBranchContext } from '../contextBuilder';
import { animateUpdate } from './animationHelpers';

/** Callback for posting messages to the extension host. */
export type PostMessage = (message: WebviewMessage) => void;

/** Delegate for rendering commits container within a branch card. */
export type CommitsContainerRenderer = (branch: BranchViewModel, card: HTMLElement) => HTMLElement;

/**
 * Renders a branch card element with header, metadata, and commits.
 */
export function renderBranch(
	branch: BranchViewModel,
	postMessage: PostMessage,
	renderCommitsContainer: CommitsContainerRenderer,
): HTMLElement {
	const card = createBranchCard(branch);
	const content = document.createElement('div');
	content.className = 'branch-content';

	content.appendChild(renderBranchHeader(branch, card, postMessage));

	if (branch.change?.status) {
		content.appendChild(renderBranchMeta(branch));
	}

	if (branch.commits && branch.commits.length > 0) {
		content.appendChild(renderCommitsContainer(branch, card));
	}

	card.appendChild(content);
	return card;
}

/** Creates the base branch card element with data attributes. */
function createBranchCard(branch: BranchViewModel): HTMLElement {
	const card = document.createElement('article');
	card.className = 'branch-card';
	card.dataset.content = 'true';
	card.dataset.branch = branch.name;
	card.dataset.depth = String(branch.tree.depth);

	if (branch.tree.parentName) {
		card.dataset.parentBranch = branch.tree.parentName;
	}

	card.dataset.vscodeContext = buildBranchContext(branch);

	if (branch.current) {
		card.classList.add('is-current');
	}
	if (branch.restack) {
		card.classList.add('needs-restack');
	}

	storeBranchData(card, branch);
	setTreeFragment(card, branch.treeFragment);

	return card;
}

/** Stores branch data on the card element for change detection. */
function storeBranchData(card: HTMLElement, branch: BranchViewModel): void {
	setBranchData(card, {
		current: branch.current,
		restack: branch.restack,
		commitsCount: branch.commits?.length ?? 0,
		hasChange: Boolean(branch.change),
		changeId: branch.change?.id,
		changeStatus: branch.change?.status,
		changeCommentsKey: serializeComments(branch.change?.comments),
		treeDepth: branch.tree.depth,
		treeIsLastChild: branch.tree.isLastChild,
		treeAncestorIsLast: JSON.stringify(branch.tree.ancestorIsLast),
		treeLane: branch.tree.lane,
	});
}

/**
 * Updates an existing branch card with new data.
 * Applies targeted animations for changed elements.
 */
export function updateBranch(
	card: HTMLElement,
	branch: BranchViewModel,
	postMessage: PostMessage,
	renderCommitsContainer: CommitsContainerRenderer,
): void {
	const oldData = getBranchData(card);

	updateBranchClasses(card, branch);
	updateBranchDataAttributes(card, branch);
	storeBranchData(card, branch);

	if (oldData) {
		animateChangedElements(card, branch, oldData);
	}

	updateHeader(card, branch, postMessage, oldData);
	updateMeta(card, branch);
	updateCommits(card, branch, renderCommitsContainer);
}

/** Updates CSS classes on the branch card. */
function updateBranchClasses(card: HTMLElement, branch: BranchViewModel): void {
	card.classList.toggle('is-current', Boolean(branch.current));
	card.classList.toggle('needs-restack', Boolean(branch.restack));
}

/** Updates data attributes on the branch card. */
function updateBranchDataAttributes(card: HTMLElement, branch: BranchViewModel): void {
	card.dataset.vscodeContext = buildBranchContext(branch);
	card.dataset.depth = String(branch.tree.depth);

	if (branch.tree.parentName) {
		card.dataset.parentBranch = branch.tree.parentName;
	} else {
		delete card.dataset.parentBranch;
	}
}

/** Type for stored branch element data. */
type BranchElementData = ReturnType<typeof getBranchData>;

/** Animates specific elements that changed. */
function animateChangedElements(
	card: HTMLElement,
	branch: BranchViewModel,
	oldData: NonNullable<BranchElementData>,
): void {
	if (!oldData.current && Boolean(branch.current)) {
		const currentIcon = card.querySelector('.current-branch-icon');
		if (currentIcon) animateUpdate(currentIcon as HTMLElement);
	}

	if (oldData.restack !== Boolean(branch.restack)) {
		const restackTag = card.querySelector('.tag-warning');
		if (restackTag) animateUpdate(restackTag as HTMLElement);
	}

	if (oldData.hasChange !== Boolean(branch.change) || oldData.changeId !== branch.change?.id) {
		const prLink = card.querySelector('.branch-pr-link');
		if (prLink) animateUpdate(prLink as HTMLElement);
	}

	if (oldData.changeStatus !== branch.change?.status) {
		const metaStatus = card.querySelector('.branch-meta span');
		if (metaStatus) animateUpdate(metaStatus as HTMLElement);
	}
}

/** Updates the branch header element. */
function updateHeader(
	card: HTMLElement,
	branch: BranchViewModel,
	postMessage: PostMessage,
	oldData: BranchElementData | undefined,
): void {
	const header = card.querySelector('.branch-header');
	if (!header) return;

	const newHeader = renderBranchHeader(branch, card, postMessage);
	header.replaceWith(newHeader);

	const newCommentsKey = serializeComments(branch.change?.comments);
	if (oldData && oldData.changeCommentsKey !== newCommentsKey) {
		const commentsIndicator = newHeader.querySelector('.comments-indicator');
		if (commentsIndicator) animateUpdate(commentsIndicator as HTMLElement);
	}
}

/** Updates the branch metadata element. */
function updateMeta(card: HTMLElement, branch: BranchViewModel): void {
	const existingMeta = card.querySelector('.branch-meta');

	if (branch.change?.status) {
		const newMeta = renderBranchMeta(branch);
		if (existingMeta) {
			existingMeta.replaceWith(newMeta);
		} else {
			const insertBefore = card.querySelector('.branch-commits');
			if (insertBefore) {
				card.insertBefore(newMeta, insertBefore);
			} else {
				card.appendChild(newMeta);
			}
		}
	} else if (existingMeta) {
		existingMeta.remove();
	}
}

/** Updates the commits container. */
function updateCommits(
	card: HTMLElement,
	branch: BranchViewModel,
	renderCommitsContainer: CommitsContainerRenderer,
): void {
	const existingCommits = card.querySelector('.branch-commits');

	if (branch.commits && branch.commits.length > 0) {
		const newCommitsContainer = renderCommitsContainer(branch, card);
		if (existingCommits) {
			existingCommits.replaceWith(newCommitsContainer);
		} else {
			card.appendChild(newCommitsContainer);
		}
	} else if (existingCommits) {
		existingCommits.remove();
	}
}

/**
 * Determines if a branch card needs to be updated based on stored data.
 */
export function branchNeedsUpdate(card: HTMLElement, branch: BranchViewModel): boolean {
	const oldData = getBranchData(card);
	if (!oldData) return true;

	const newTreeAncestorIsLast = JSON.stringify(branch.tree.ancestorIsLast);
	const newCommentsKey = serializeComments(branch.change?.comments);

	return (
		oldData.current !== Boolean(branch.current) ||
		oldData.restack !== Boolean(branch.restack) ||
		oldData.commitsCount !== (branch.commits?.length ?? 0) ||
		oldData.hasChange !== Boolean(branch.change) ||
		oldData.changeId !== branch.change?.id ||
		oldData.changeStatus !== branch.change?.status ||
		oldData.changeCommentsKey !== newCommentsKey ||
		oldData.treeDepth !== branch.tree.depth ||
		oldData.treeIsLastChild !== branch.tree.isLastChild ||
		oldData.treeAncestorIsLast !== newTreeAncestorIsLast ||
		oldData.treeLane !== branch.tree.lane
	);
}

/** Renders the branch header with toggle, name, tags, and PR link. */
function renderBranchHeader(branch: BranchViewModel, card: HTMLElement, postMessage: PostMessage): HTMLElement {
	const header = document.createElement('div');
	header.className = 'branch-header';

	const hasCommits = Boolean(branch.commits && branch.commits.length > 0);
	appendHeaderToggle(header, card, hasCommits, branch.current === true);

	const nameSpan = document.createElement('span');
	nameSpan.className = 'branch-name';
	nameSpan.textContent = branch.name;
	header.appendChild(nameSpan);

	header.appendChild(renderBranchTags(branch, postMessage));
	return header;
}

/** Appends toggle or spacer to header based on whether branch has commits. */
function appendHeaderToggle(
	header: HTMLElement,
	card: HTMLElement,
	hasCommits: boolean,
	isCurrent: boolean,
): void {
	if (hasCommits) {
		const toggle = document.createElement('i');
		toggle.className = 'branch-toggle codicon codicon-chevron-right';
		toggle.role = 'button';
		toggle.tabIndex = 0;

		if (isCurrent) {
			card.classList.add('expanded');
			toggle.classList.add('expanded');
		}

		header.appendChild(toggle);
		header.style.cursor = 'pointer';
		header.addEventListener('click', (event: Event) => {
			if ((event.target as HTMLElement).closest('.branch-pr-link')) return;
			card.classList.toggle('expanded');
			toggle.classList.toggle('expanded');
		});
	} else {
		const spacer = document.createElement('span');
		spacer.className = 'branch-toggle-spacer';
		header.appendChild(spacer);
	}
}

/** Renders the branch tags section (restack, comments, submit, PR link). */
function renderBranchTags(branch: BranchViewModel, postMessage: PostMessage): HTMLElement {
	const tags = document.createElement('div');
	tags.className = 'branch-tags';

	if (branch.restack) {
		tags.appendChild(createTag('Restack', 'warning'));
	}

	if (branch.change?.comments && branch.change.comments.total > 0) {
		tags.appendChild(renderCommentsIndicator(branch.change.comments));
	}

	tags.appendChild(createSubmitButton(branch, postMessage));

	if (branch.change) {
		tags.appendChild(createPrLinkButton(branch, postMessage));
	}

	return tags;
}

/** Creates the submit button for a branch. */
function createSubmitButton(branch: BranchViewModel, postMessage: PostMessage): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'branch-submit-btn';
	btn.title = branch.change ? 'Submit branch and ancestors' : 'Create PR for branch and ancestors';
	btn.innerHTML = '<i class="codicon codicon-cloud-upload"></i>';
	btn.addEventListener('click', (event: Event) => {
		event.stopPropagation();
		postMessage({ type: 'branchSubmit', branchName: branch.name });
	});
	return btn;
}

/** Creates the PR link button for a branch. */
function createPrLinkButton(branch: BranchViewModel, postMessage: PostMessage): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'branch-pr-link';
	btn.textContent = branch.change!.id;

	if (branch.change!.url) {
		btn.addEventListener('click', (event: Event) => {
			event.stopPropagation();
			postMessage({ type: 'openChange', url: branch.change!.url! });
		});
	} else {
		btn.disabled = true;
	}

	return btn;
}

/** Renders the branch metadata (status). */
function renderBranchMeta(branch: BranchViewModel): HTMLElement {
	const meta = document.createElement('div');
	meta.className = 'branch-meta';
	const status = document.createElement('span');
	status.textContent = branch.change!.status!;
	meta.appendChild(status);
	return meta;
}

/** Creates a tag element with label and optional variant. */
function createTag(label: string, variant: string): HTMLElement {
	const span = document.createElement('span');
	span.className = 'tag' + (variant ? ' tag-' + variant : '');
	span.textContent = label;
	return span;
}

/** Serializes comments for change detection comparison. */
export function serializeComments(comments: GitSpiceComments | undefined): string | undefined {
	if (!comments) return undefined;
	return `${comments.resolved}/${comments.total}`;
}

/** Renders a comments indicator showing resolved/total with icon. */
function renderCommentsIndicator(comments: GitSpiceComments): HTMLElement {
	const indicator = document.createElement('span');
	const allResolved = comments.resolved === comments.total;
	indicator.className = `comments-indicator ${allResolved ? 'all-resolved' : 'has-unresolved'}`;

	const icon = document.createElement('i');
	icon.className = `codicon ${allResolved ? 'codicon-pass' : 'codicon-comment-discussion'}`;
	indicator.appendChild(icon);

	const text = document.createElement('span');
	text.textContent = `${comments.resolved}/${comments.total}`;
	indicator.appendChild(text);

	return indicator;
}
