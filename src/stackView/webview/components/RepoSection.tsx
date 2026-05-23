/**
 * Repo section component: per-repository wrapper with collapsible
 * header, toolbar (restack/sync/submit), and slots for the
 * StackView-managed branch list and error/empty states.
 *
 * Renders the INTERIOR of the section element. The wrapper
 * (repoSectionRenderer.tsx) creates the section, sets data-repo-id,
 * and exposes getBranchList / getErrorElement / getEmptyElement so
 * StackView can still query and mutate those slots imperatively.
 */

import { useCallback, useEffect, useState, type JSX } from 'react';

import type { WebviewMessage } from '../../webviewTypes';

export type PostMessage = (message: WebviewMessage) => void;

interface ToolbarAction {
	label: string;
	icon: string;
	messageType: 'stackRestack' | 'repoSync' | 'stackSubmit';
}

const TOOLBAR_ACTIONS: ToolbarAction[] = [
	{ label: 'Restack Stack', icon: 'codicon-layers', messageType: 'stackRestack' },
	{ label: 'Sync Repository', icon: 'codicon-sync', messageType: 'repoSync' },
	{ label: 'Submit Stack', icon: 'codicon-cloud-upload', messageType: 'stackSubmit' },
];

export interface RepoSectionProps {
	repoId: string;
	repoName: string;
	postMessage: PostMessage;
	/** Callback so the wrapper can toggle the parent section's `.expanded` class. */
	setSectionClass: (className: string, on: boolean) => void;
}

export function RepoSection({ repoId, repoName, postMessage, setSectionClass }: RepoSectionProps): JSX.Element {
	const [expanded, setExpanded] = useState(true);
	useEffect(() => {
		setSectionClass('expanded', expanded);
	}, [expanded, setSectionClass]);

	const toggle = useCallback(() => setExpanded((v) => !v), []);
	const onHeaderClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if ((event.target as HTMLElement).closest('.repo-toolbar')) return;
			toggle();
		},
		[toggle],
	);

	return (
		<>
			<div className="repo-header" onClick={onHeaderClick}>
				<i className="codicon codicon-repo" aria-hidden="true" />
				<span className="repo-name">{repoName}</span>
				<div className="repo-toolbar">
					{TOOLBAR_ACTIONS.map((action) => (
						<button
							key={action.messageType}
							type="button"
							className="repo-action-btn"
							title={action.label}
							aria-label={`${action.label} for ${repoName}`}
							onClick={(e) => {
								e.stopPropagation();
								postMessage({ type: action.messageType, repoId });
							}}
						>
							<i className={`codicon ${action.icon}`} aria-hidden="true" />
						</button>
					))}
				</div>
				<i
					className={`codicon repo-toggle ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`}
					aria-label={expanded ? 'Collapse section' : 'Expand section'}
				/>
			</div>
			<ul className="repo-branch-list stack-list" />
			<section className="error hidden" data-role="repo-error" />
			<section className="empty hidden" data-role="repo-empty" />
		</>
	);
}
