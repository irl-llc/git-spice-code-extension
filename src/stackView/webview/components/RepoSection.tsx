/**
 * Repo section component: per-repository header with collapsible
 * toggle and toolbar (restack/sync/submit).
 *
 * The branch list and error/empty states are rendered as siblings by
 * the parent (StackView's RepoView), not inside this component.</br>
 * Earlier this component also rendered placeholder slot elements for
 * those — those have been removed since the single-root refactor.
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
		</>
	);
}
