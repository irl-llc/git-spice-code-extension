/**
 * Branch summary component: shows the "Summarized Changes" header for a
 * branch with a chevron toggle and a clickable label that opens the
 * multi-file changes view.
 *
 * Replaces the imperative renderBranchSummary in branchSummaryRenderer.ts.
 * Controlled by the parent: `expanded`, `files`, and the four callbacks are
 * external. The component itself is pure — no internal state, no internal
 * postMessage calls. This keeps test arrange/assert simple and lets the
 * parent (still vanilla DOM during the migration) own all webview-to-host
 * communication.
 */

import type { JSX } from 'react';

import type { CommitFileChange } from '../../types';

export interface BranchSummaryProps {
	/** Name of the branch whose summary this is. */
	branchName: string;
	/** Whether the file list is expanded. Controlled by parent. */
	expanded: boolean;
	/** Files in the summary, or undefined while loading. */
	files: CommitFileChange[] | undefined;
	/** Invoked when the chevron toggle is clicked. */
	onToggle: () => void;
	/** Invoked when the "Summarized Changes" label is clicked. */
	onOpenDiff: () => void;
	/** Invoked when a file row is clicked (anywhere but its action buttons). */
	onOpenFileDiff: (path: string, status: string) => void;
	/** Invoked when the "open current file" action button is clicked. */
	onOpenCurrentFile: (path: string) => void;
}

export function BranchSummary(props: BranchSummaryProps): JSX.Element {
	const { branchName, expanded, files, onToggle, onOpenDiff } = props;
	return (
		<div className="branch-summary expandable-section" data-branch-summary={branchName}>
			<div className="branch-summary-header">
				<button
					type="button"
					className="branch-summary-toggle"
					aria-label={expanded ? `Collapse summary for ${branchName}` : `Expand summary for ${branchName}`}
					aria-expanded={expanded}
					onClick={onToggle}
				>
					<span className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} aria-hidden="true" />
				</button>
				<button
					type="button"
					className="branch-summary-label-button"
					aria-label={`Open changes view for ${branchName}`}
					onClick={onOpenDiff}
				>
					<span className="branch-summary-label">Summarized Changes</span>
				</button>
			</div>
			<div className={`branch-summary-files${expanded ? '' : ' hidden'}`}>
				{expanded ? renderFiles(files, props) : null}
			</div>
		</div>
	);
}

function renderFiles(files: CommitFileChange[] | undefined, props: BranchSummaryProps): JSX.Element {
	if (files === undefined) {
		return <div className="branch-summary-loading">Loading...</div>;
	}
	if (files.length === 0) {
		return <div className="branch-summary-empty">No files changed</div>;
	}
	return (
		<>
			{files.map((file) => (
				<FileRow
					key={file.path}
					file={file}
					branchName={props.branchName}
					onOpenFileDiff={props.onOpenFileDiff}
					onOpenCurrentFile={props.onOpenCurrentFile}
				/>
			))}
		</>
	);
}

interface FileRowProps {
	file: CommitFileChange;
	branchName: string;
	onOpenFileDiff: (path: string, status: string) => void;
	onOpenCurrentFile: (path: string) => void;
}

function FileRow({ file, onOpenFileDiff, onOpenCurrentFile }: FileRowProps): JSX.Element {
	const { fileName, folderPath } = splitPath(file.path);
	return (
		<div
			className="file-change"
			role="button"
			tabIndex={0}
			aria-label={`Open diff for ${file.path}`}
			onClick={(e) => {
				if ((e.target as HTMLElement).closest('button')) return;
				onOpenFileDiff(file.path, file.status);
			}}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onOpenFileDiff(file.path, file.status);
				}
			}}
		>
			<i className="file-icon codicon codicon-file" aria-hidden="true" />
			<span className="file-name">{fileName}</span>
			<span className="file-folder">{folderPath}</span>
			{file.status !== 'D' ? (
				<button
					type="button"
					className="file-action-btn"
					aria-label={`Open current file ${file.path}`}
					title="Open current file"
					onClick={(e) => {
						e.stopPropagation();
						onOpenCurrentFile(file.path);
					}}
				>
					<i className="codicon codicon-go-to-file" aria-hidden="true" />
				</button>
			) : null}
			<span className={`file-status status-${file.status.toLowerCase()}`}>{file.status}</span>
		</div>
	);
}

function splitPath(path: string): { fileName: string; folderPath: string } {
	const lastSlash = path.lastIndexOf('/');
	return {
		fileName: lastSlash >= 0 ? path.slice(lastSlash + 1) : path,
		folderPath: lastSlash >= 0 ? path.slice(0, lastSlash) : '',
	};
}
