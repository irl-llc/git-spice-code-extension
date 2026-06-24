/**
 * Branch card React component: header (toggle, name, tags including the
 * change-request status badge), optional Summarized Changes, and a slot for
 * the commits container.
 *
 * Renders the INTERIOR of the article element. The wrapper
 * (branchRenderer.tsx) creates the article itself and sets static
 * attributes (data-branch, data-vscode-context, base classes). This
 * component handles dynamic state — the `expanded` toggle, button
 * clicks, and the lifecycle of the slot-mounted children
 * (BranchSummary and the commits container).
 */

import { useCallback, useEffect, useState, type JSX, type ReactNode } from 'react';

import type { GitSpiceChangeStatus, GitSpiceComments } from '../../../gitSpiceSchema';
import { worktreeColorClass, worktreeLabel } from '../../../utils/worktreeColor';
import type { BranchViewModel } from '../../types';
import type { WebviewMessage } from '../../webviewTypes';

/** Callback for posting messages to the extension host. */
export type PostMessage = (message: WebviewMessage) => void;

export interface BranchCardProps {
	branch: BranchViewModel;
	postMessage: PostMessage;
	/** Toggles a class on the parent article. */
	setArticleClass: (className: string, on: boolean) => void;
	/** Optional Summarized Changes subtree to render between header and commits. */
	summary?: ReactNode;
	/** Optional commits container subtree to render at the bottom. */
	commits?: ReactNode;
}

export function BranchCard(props: BranchCardProps): JSX.Element {
	const { branch, postMessage, setArticleClass, summary, commits } = props;
	const hasCommits = Boolean(branch.commits && branch.commits.length > 0);

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
			{summary ?? null}
			{commits ?? null}
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

/** Icon + label for each change-request status, shown as a colored badge. */
const CHANGE_STATUS_DISPLAY: Record<GitSpiceChangeStatus, { icon: string; label: string }> = {
	open: { icon: 'codicon-git-pull-request', label: 'Open' },
	merged: { icon: 'codicon-git-merge', label: 'Merged' },
	closed: { icon: 'codicon-git-pull-request-closed', label: 'Closed' },
};

/** Colored badge showing the change-request (PR/MR) status from the forge. */
function ChangeStatusBadge({ status }: { status: GitSpiceChangeStatus }): JSX.Element {
	// Defensive: a future CLI/forge status outside the known set would otherwise
	// crash the webview on the destructure — fall back to the raw value.
	const { icon, label } = CHANGE_STATUS_DISPLAY[status] ?? { icon: 'codicon-git-pull-request', label: status };
	return (
		<span className={`tag tag-cr tag-cr-${status}`} title={`Change request ${label.toLowerCase()}`}>
			<i className={`codicon ${icon}`} aria-hidden="true" />
			<span>{label}</span>
		</span>
	);
}

interface BranchTagsProps {
	branch: BranchViewModel;
	postMessage: PostMessage;
}

/**
 * Badge naming the other git worktree this branch is parked in, colored by a
 * deterministic per-path palette slot so each worktree reads as visually
 * distinct. Full path is in the tooltip; the pill shows the basename.
 */
function WorktreeBadge({ worktree }: { worktree: string }): JSX.Element {
	return (
		<span className={`tag tag-worktree ${worktreeColorClass(worktree)}`} title={`Checked out in worktree ${worktree}`}>
			<i className="codicon codicon-repo-forked" aria-hidden="true" />
			<span>{worktreeLabel(worktree)}</span>
		</span>
	);
}

/** The read-only status pills shown before the action buttons. */
function BranchBadges({ branch }: { branch: BranchViewModel }): JSX.Element {
	const comments = branch.change?.comments;
	return (
		<>
			{branch.worktree ? <WorktreeBadge worktree={branch.worktree} /> : null}
			{branch.restack ? <span className="tag tag-warning">Restack</span> : null}
			{branch.change?.status ? <ChangeStatusBadge status={branch.change.status} /> : null}
			{comments && comments.total > 0 ? <CommentsIndicator comments={comments} /> : null}
		</>
	);
}

function BranchTags({ branch, postMessage }: BranchTagsProps): JSX.Element {
	const showSquash = Boolean(branch.commits && branch.commits.length > 1);
	return (
		<div className="branch-tags">
			<BranchBadges branch={branch} />
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

/** Serializes comments for change detection comparison. */
export function serializeComments(comments: GitSpiceComments | undefined): string | undefined {
	if (!comments) return undefined;
	return `${comments.resolved}/${comments.total}`;
}
