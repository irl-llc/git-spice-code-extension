/**
 * Branch card React component: header (toggle, name, tags), optional meta,
 * optional Summarized Changes, and a slot for the commits container.
 *
 * Renders the INTERIOR of the article element. The wrapper
 * (branchRenderer.tsx) creates the article itself and sets static
 * attributes (data-branch, data-vscode-context, base classes). This
 * component handles dynamic state — the `expanded` toggle, button
 * clicks, and the lifecycle of the slot-mounted children
 * (BranchSummary and the commits container).
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import type { GitSpiceComments } from '../../../gitSpiceSchema';
import type { BranchViewModel } from '../../types';
import type { WebviewMessage } from '../../webviewTypes';

/** Callback for posting messages to the extension host. */
export type PostMessage = (message: WebviewMessage) => void;

/** Delegate for rendering the commits container subtree. */
export type CommitsContainerRenderer = (branch: BranchViewModel, card: HTMLElement) => HTMLElement;

/** Delegate for rendering the BranchSummary subtree. */
export type SummaryRenderer = (branchName: string, card: HTMLElement) => HTMLElement;

export interface BranchCardProps {
	branch: BranchViewModel;
	postMessage: PostMessage;
	renderCommitsContainer: CommitsContainerRenderer;
	renderSummary?: SummaryRenderer;
	/** Toggles a class on the parent article. The wrapper sets initial
	 * `is-current` / `needs-restack` / `expanded`; this callback lets the
	 * component update `expanded` as local state changes. */
	setArticleClass: (className: string, on: boolean) => void;
	/** Provides the parent article element so slot renderers can use it
	 * for querySelector-based lookups. */
	getArticle: () => HTMLElement | null;
}

export function BranchCard(props: BranchCardProps): JSX.Element {
	const { branch, postMessage, renderCommitsContainer, renderSummary, setArticleClass, getArticle } = props;
	const hasCommits = Boolean(branch.commits && branch.commits.length > 0);
	const showSummary = Boolean(renderSummary && hasCommits && branch.commits!.length > 1);

	const [expanded, setExpanded] = useState(branch.current === true);
	useEffect(() => {
		setArticleClass('expanded', expanded);
	}, [expanded, setArticleClass]);

	const toggle = useCallback(() => setExpanded((v) => !v), []);
	const handleHeaderClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if (!hasCommits) return;
			if ((event.target as HTMLElement).closest('button')) return;
			toggle();
		},
		[hasCommits, toggle],
	);

	return (
		<div className="branch-content">
			<BranchHeader
				branch={branch}
				expanded={expanded}
				hasCommits={hasCommits}
				postMessage={postMessage}
				onToggle={toggle}
				onHeaderClick={handleHeaderClick}
			/>
			{branch.change?.status ? <BranchMeta status={branch.change.status} /> : null}
			{showSummary ? <SummarySlot branchName={branch.name} render={renderSummary!} getArticle={getArticle} /> : null}
			{hasCommits ? <CommitsSlot branch={branch} render={renderCommitsContainer} getArticle={getArticle} /> : null}
		</div>
	);
}

interface BranchHeaderProps {
	branch: BranchViewModel;
	expanded: boolean;
	hasCommits: boolean;
	postMessage: PostMessage;
	onToggle: () => void;
	onHeaderClick: (event: React.MouseEvent<HTMLDivElement>) => void;
}

function BranchHeader({
	branch,
	expanded,
	hasCommits,
	postMessage,
	onToggle,
	onHeaderClick,
}: BranchHeaderProps): JSX.Element {
	return (
		<div className="branch-header" style={hasCommits ? { cursor: 'pointer' } : undefined} onClick={onHeaderClick}>
			{hasCommits ? (
				<button
					type="button"
					className={`branch-toggle codicon codicon-chevron-${expanded ? 'down' : 'right'}${
						expanded ? ' expanded' : ''
					}`}
					aria-label={`${expanded ? 'Collapse' : 'Expand'} ${branch.name}`}
					aria-expanded={expanded}
					onClick={(e) => {
						e.stopPropagation();
						onToggle();
					}}
				/>
			) : (
				<span className="branch-toggle-spacer" />
			)}
			<span className="branch-name">{branch.name}</span>
			<BranchTags branch={branch} postMessage={postMessage} />
		</div>
	);
}

function BranchMeta({ status }: { status: string }): JSX.Element {
	return (
		<div className="branch-meta">
			<span>{status}</span>
		</div>
	);
}

interface BranchTagsProps {
	branch: BranchViewModel;
	postMessage: PostMessage;
}

function BranchTags({ branch, postMessage }: BranchTagsProps): JSX.Element {
	const showSquash = Boolean(branch.commits && branch.commits.length > 1);
	return (
		<div className="branch-tags">
			{branch.restack ? <span className="tag tag-warning">Restack</span> : null}
			{branch.change?.comments && branch.change.comments.total > 0 ? (
				<CommentsIndicator comments={branch.change.comments} />
			) : null}
			{showSquash ? (
				<button
					type="button"
					className="branch-action-btn"
					title="Squash commits into one"
					aria-label={`Squash commits on ${branch.name} into one`}
					onClick={(e) => {
						e.stopPropagation();
						postMessage({ type: 'branchSquash', branchName: branch.name });
					}}
				>
					<i className="codicon codicon-fold-down" aria-hidden="true" />
				</button>
			) : null}
			<button
				type="button"
				className="branch-submit-btn"
				title={branch.change ? 'Submit branch and ancestors' : 'Create PR for branch and ancestors'}
				aria-label={
					branch.change ? `Submit ${branch.name} and ancestors` : `Create PR for ${branch.name} and ancestors`
				}
				onClick={(e) => {
					e.stopPropagation();
					postMessage({ type: 'branchSubmit', branchName: branch.name });
				}}
			>
				<i className="codicon codicon-cloud-upload" aria-hidden="true" />
			</button>
			{branch.change ? <PrLink branch={branch} postMessage={postMessage} /> : null}
		</div>
	);
}

function PrLink({ branch, postMessage }: BranchTagsProps): JSX.Element {
	const change = branch.change!;
	const hasUrl = Boolean(change.url);
	return (
		<button
			type="button"
			className="branch-pr-link"
			disabled={!hasUrl}
			aria-label={hasUrl ? `Open PR ${change.id} for ${branch.name}` : `PR ${change.id} (no URL)`}
			onClick={
				hasUrl
					? (e) => {
							e.stopPropagation();
							postMessage({ type: 'openChange', url: change.url! });
						}
					: undefined
			}
		>
			{change.id}
		</button>
	);
}

function CommentsIndicator({ comments }: { comments: GitSpiceComments }): JSX.Element {
	const allResolved = comments.resolved === comments.total;
	return (
		<span className={`comments-indicator ${allResolved ? 'all-resolved' : 'has-unresolved'}`}>
			<i className={`codicon ${allResolved ? 'codicon-pass' : 'codicon-comment-discussion'}`} aria-hidden="true" />
			<span>
				{comments.resolved}/{comments.total}
			</span>
		</span>
	);
}

interface SlotProps<T> {
	getArticle: () => HTMLElement | null;
	render: (item: T, card: HTMLElement) => HTMLElement;
}

/** Mount slot for the BranchSummary subtree (currently still mounted by the legacy renderer). */
function SummarySlot({
	branchName,
	render,
	getArticle,
}: {
	branchName: string;
	render: SummaryRenderer;
	getArticle: () => HTMLElement | null;
}): JSX.Element {
	const ref = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const article = getArticle();
		const host = ref.current;
		if (!host || !article) return;
		const subtree = render(branchName, article);
		host.replaceChildren(subtree);
	}, [branchName, render, getArticle]);
	return <div ref={ref} className="branch-summary-slot" />;
}

/** Mount slot for the commits container subtree. */
function CommitsSlot({
	branch,
	render,
	getArticle,
}: {
	branch: BranchViewModel;
	render: CommitsContainerRenderer;
	getArticle: () => HTMLElement | null;
}): JSX.Element {
	const ref = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const article = getArticle();
		const host = ref.current;
		if (!host || !article) return;
		const subtree = render(branch, article);
		host.replaceChildren(subtree);
		// CSS uses descendant selectors (.branch-content .branch-commits, etc.)
		// so the wrapping slot div is fine.
	}, [branch, render, getArticle]);
	return <div ref={ref} className="branch-commits-slot" />;
}

/** Serializes comments for change detection comparison (used by branchRenderer wrapper). */
export function serializeComments(comments: GitSpiceComments | undefined): string | undefined {
	if (!comments) return undefined;
	return `${comments.resolved}/${comments.total}`;
}
