/**
 * Commit list component: renders a paginated list of commit rows for a
 * branch, with expandable per-commit file lists.
 *
 * Replaces the imperative renderCommitsContainer / renderCommitsIntoContainer
 * pair. State that lived in CommitRendererState (expanded sha set, file
 * cache) is parent-owned and passed in via props; this matches the
 * existing per-repo state container so handleCommitFilesResponse can
 * inject files and trigger a re-render.
 */

import { useState, type JSX } from 'react';

import { COMMIT_RENDER_CHUNK_SIZE } from '../../../constants';
import { buildCommitContext } from '../../contextBuilder';
import type { BranchCommitViewModel, CommitFileChange, FileChangeStatus } from '../../types';

export interface CommitListProps {
	branchName: string;
	commits: BranchCommitViewModel[];
	/** Shas of commits whose file list is currently expanded. Controlled by parent. */
	expandedShas: ReadonlySet<string>;
	/** Map of sha → files (undefined if not yet fetched). Controlled by parent. */
	fileCache: ReadonlyMap<string, CommitFileChange[]>;
	/** Called when the user toggles a commit's file list. */
	onToggle: (sha: string) => void;
	/** Called when the user clicks a commit row (away from any button). */
	onOpenCommitDiff: (sha: string) => void;
	/** Called when the user clicks a file row. */
	onOpenFileDiff: (sha: string, path: string) => void;
	/** Called when the user clicks the open-current-file action button. */
	onOpenCurrentFile: (path: string) => void;
}

export function CommitList(props: CommitListProps): JSX.Element {
	const [visibleCount, setVisibleCount] = useState(() => Math.min(props.commits.length, COMMIT_RENDER_CHUNK_SIZE));

	const visible = props.commits.slice(0, visibleCount);
	const remaining = props.commits.length - visibleCount;
	const showMoreLabel =
		remaining > COMMIT_RENDER_CHUNK_SIZE ? `Show more (${remaining})` : `Show remaining ${remaining}`;

	return (
		<div className="branch-commits expandable-section" data-commits-container="true">
			{visible.map((commit) => (
				<CommitItem
					key={commit.sha}
					branchName={props.branchName}
					commit={commit}
					expanded={props.expandedShas.has(commit.sha)}
					files={props.fileCache.get(commit.sha)}
					onToggle={() => props.onToggle(commit.sha)}
					onOpenCommitDiff={() => props.onOpenCommitDiff(commit.sha)}
					onOpenFileDiff={(path) => props.onOpenFileDiff(commit.sha, path)}
					onOpenCurrentFile={props.onOpenCurrentFile}
				/>
			))}
			{remaining > 0 ? (
				<button
					type="button"
					className="branch-more"
					aria-label={`Show ${remaining} more commit${remaining === 1 ? '' : 's'} on ${props.branchName}`}
					onClick={(e) => {
						e.stopPropagation();
						setVisibleCount((v) => Math.min(props.commits.length, v + COMMIT_RENDER_CHUNK_SIZE));
					}}
				>
					{showMoreLabel}
				</button>
			) : null}
		</div>
	);
}

interface CommitItemProps {
	branchName: string;
	commit: BranchCommitViewModel;
	expanded: boolean;
	files: CommitFileChange[] | undefined;
	onToggle: () => void;
	onOpenCommitDiff: () => void;
	onOpenFileDiff: (path: string) => void;
	onOpenCurrentFile: (path: string) => void;
}

function CommitItem(props: CommitItemProps): JSX.Element {
	const { branchName, commit, expanded, files } = props;
	return (
		<div className="commit-container" data-sha={commit.sha}>
			<div
				className="commit-item"
				data-content="true"
				data-vscode-context={buildCommitContext(commit.sha, branchName)}
				onClick={(e) => {
					if ((e.target as HTMLElement).closest('button')) return;
					e.stopPropagation();
					props.onOpenCommitDiff();
				}}
			>
				<button
					type="button"
					className={`commit-toggle codicon codicon-chevron-${expanded ? 'down' : 'right'}`}
					aria-label={`${expanded ? 'Collapse' : 'Expand'} file list for commit ${commit.shortSha}`}
					aria-expanded={expanded}
					onClick={(e) => {
						e.stopPropagation();
						props.onToggle();
					}}
				/>
				<span className="commit-subject">{commit.subject}</span>
				<span className="commit-sha">{commit.shortSha}</span>
			</div>
			<div className={`commit-files${expanded ? '' : ' hidden'}`}>{expanded ? renderFiles(files, props) : null}</div>
		</div>
	);
}

function renderFiles(files: CommitFileChange[] | undefined, props: CommitItemProps): JSX.Element {
	if (files === undefined) {
		return <div className="commit-files-loading">Loading...</div>;
	}
	if (files.length === 0) {
		return <div className="commit-files-empty">No files changed</div>;
	}
	return (
		<>
			{files.map((file) => (
				<FileRow
					key={file.path}
					file={file}
					onOpenFileDiff={() => props.onOpenFileDiff(file.path)}
					onOpenCurrentFile={() => props.onOpenCurrentFile(file.path)}
				/>
			))}
		</>
	);
}

interface FileRowProps {
	file: CommitFileChange;
	onOpenFileDiff: () => void;
	onOpenCurrentFile: () => void;
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
				onOpenFileDiff();
			}}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onOpenFileDiff();
				}
			}}
		>
			<i className="file-icon codicon codicon-file" aria-hidden="true" />
			<span className="file-name">{fileName}</span>
			<span className="file-folder">{folderPath}</span>
			{file.status !== ('D' as FileChangeStatus) ? (
				<button
					type="button"
					className="file-action-btn"
					aria-label={`Open current file ${file.path}`}
					title="Open current file"
					onClick={(e) => {
						e.stopPropagation();
						onOpenCurrentFile();
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
