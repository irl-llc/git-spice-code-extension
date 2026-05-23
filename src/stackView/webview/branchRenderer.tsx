/**
 * Branch card mount wrapper.
 *
 * Creates the `<article class="branch-card">` element, sets the data-*
 * attributes that downstream selectors and VS Code's context-menu system
 * rely on, mounts the BranchCard React tree inside, and stores the
 * tree-fragment + BranchViewModel for downstream consumers.
 *
 * Static state (initial classes, data attrs, tree fragment) is set
 * imperatively before React mounts. Dynamic state (expanded class,
 * button clicks, internal layout) lives inside BranchCard.
 */

import { createRoot } from 'react-dom/client';

import type { GitSpiceComments } from '../../gitSpiceSchema';
import type { BranchViewModel } from '../types';
import { setTreeFragment } from '../domHelpers';
import { buildBranchContext } from '../contextBuilder';
import {
	BranchCard,
	type CommitsContainerRenderer,
	type PostMessage,
	type SummaryRenderer,
} from './components/BranchCard';

export type { PostMessage, CommitsContainerRenderer, SummaryRenderer } from './components/BranchCard';
export { serializeComments } from './components/BranchCard';

/** Stores the BranchViewModel that the article was last rendered with, for needsUpdate. */
const renderedModel = new WeakMap<HTMLElement, BranchViewModel>();

/**
 * Renders a branch card element with header, metadata, summary, and commits.
 */
export function renderBranch(
	branch: BranchViewModel,
	postMessage: PostMessage,
	renderCommitsContainer: CommitsContainerRenderer,
	renderSummary?: SummaryRenderer,
): HTMLElement {
	const article = document.createElement('article');
	applyStaticAttributes(article, branch);
	setTreeFragment(article, branch.treeFragment);
	renderedModel.set(article, branch);

	const root = createRoot(article);
	root.render(
		<BranchCard
			branch={branch}
			postMessage={postMessage}
			renderCommitsContainer={renderCommitsContainer}
			renderSummary={renderSummary}
			setArticleClass={(cls, on) => article.classList.toggle(cls, on)}
			getArticle={() => article}
		/>,
	);

	return article;
}

/** Sets the data attributes and base classes the wrapper owns (not React-managed). */
function applyStaticAttributes(article: HTMLElement, branch: BranchViewModel): void {
	article.className = 'branch-card';
	article.dataset.content = 'true';
	article.dataset.branch = branch.name;
	article.dataset.depth = String(branch.tree.depth);
	if (branch.tree.parentName) {
		article.dataset.parentBranch = branch.tree.parentName;
	}
	article.dataset.vscodeContext = buildBranchContext(branch);
	if (branch.current) article.classList.add('is-current');
	if (branch.restack) article.classList.add('needs-restack');
}

/**
 * Decides whether the diffList framework should re-render this card.
 * Compares the new BranchViewModel against the one stored at last render.
 * Returns true if any field that affects rendering changed.
 */
export function branchNeedsUpdate(card: HTMLElement, branch: BranchViewModel): boolean {
	const old = renderedModel.get(card);
	if (!old) return true;
	return (
		old.current !== branch.current ||
		old.restack !== branch.restack ||
		(old.commits?.length ?? 0) !== (branch.commits?.length ?? 0) ||
		Boolean(old.change) !== Boolean(branch.change) ||
		old.change?.id !== branch.change?.id ||
		old.change?.status !== branch.change?.status ||
		commentsKey(old.change?.comments) !== commentsKey(branch.change?.comments) ||
		old.tree.depth !== branch.tree.depth ||
		old.tree.isLastChild !== branch.tree.isLastChild ||
		old.tree.lane !== branch.tree.lane ||
		JSON.stringify(old.tree.ancestorIsLast) !== JSON.stringify(branch.tree.ancestorIsLast) ||
		JSON.stringify(old.treeFragment) !== JSON.stringify(branch.treeFragment)
	);
}

function commentsKey(c: GitSpiceComments | undefined): string | undefined {
	return c ? `${c.resolved}/${c.total}` : undefined;
}
