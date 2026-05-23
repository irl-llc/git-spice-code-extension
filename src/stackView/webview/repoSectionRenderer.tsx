/**
 * Repo section mount wrapper.
 *
 * Creates the `<section class="repo-section">` element, sets
 * data-repo-id, mounts RepoSection React component inside, and
 * preserves the getBranchList / getErrorElement / getEmptyElement
 * accessors that StackView uses to populate slots imperatively
 * (the branch list and error/empty status are not yet React-owned).
 */

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { RepoSection, type PostMessage } from './components/RepoSection';

/** Creates a repo section element with header, toolbar, and branch list. */
export function renderRepoSection(repoId: string, repoName: string, postMessage: PostMessage): HTMLElement {
	const section = document.createElement('section');
	section.className = 'repo-section expanded';
	section.dataset.repoId = repoId;

	const root = createRoot(section);
	// flushSync so the slot elements (branch-list, error, empty) exist
	// in the DOM by the time we return — StackView's getBranchList etc.
	// query them synchronously.
	flushSync(() => {
		root.render(
			<RepoSection
				repoId={repoId}
				repoName={repoName}
				postMessage={postMessage}
				setSectionClass={(cls, on) => section.classList.toggle(cls, on)}
			/>,
		);
	});

	return section;
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
