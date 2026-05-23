/**
 * Uncommitted-changes card: the "Uncommitted Changes" pseudo-branch in
 * the stack view. Renders staged + unstaged sections (collapsible) and
 * a commit form (input + Create-branch / Add-to-current buttons).
 *
 * Controlled component: parent owns expanded sections and the commit
 * message text, all callbacks fire outward. Replaces the imperative
 * renderUncommittedCard / renderTreelessUncommittedCard inner trees.
 */

import { type JSX } from 'react';

import type { FileChangeStatus, UncommittedState, WorkingCopyChange } from '../../types';

export interface UncommittedCardProps {
	uncommitted: UncommittedState;
	expandedStaged: boolean;
	expandedUnstaged: boolean;
	commitMessage: string;
	onToggleStaged: () => void;
	onToggleUnstaged: () => void;
	onCommitMessageChange: (value: string) => void;
	onStage: (path: string) => void;
	onUnstage: (path: string) => void;
	onDiscard: (path: string) => void;
	onOpenFile: (path: string) => void;
	onOpenDiff: (path: string, staged: boolean, status: FileChangeStatus) => void;
	onCreateBranch: (message: string) => void;
	onCommit: (message: string) => void;
}

export function UncommittedCard(props: UncommittedCardProps): JSX.Element {
	const trimmed = props.commitMessage.trim();
	const canSubmit = trimmed.length > 0;
	return (
		<article className="branch-card uncommitted expanded">
			<div className="branch-content">
				<UncommittedHeader />
				<div className="uncommitted-sections">
					{props.uncommitted.staged.length > 0 ? (
						<ChangesSection
							title="Staged Changes"
							files={props.uncommitted.staged}
							isStaged
							expanded={props.expandedStaged}
							onToggle={props.onToggleStaged}
							onStage={props.onStage}
							onUnstage={props.onUnstage}
							onDiscard={props.onDiscard}
							onOpenFile={props.onOpenFile}
							onOpenDiff={props.onOpenDiff}
						/>
					) : null}
					{props.uncommitted.unstaged.length > 0 ? (
						<ChangesSection
							title="Changes"
							files={props.uncommitted.unstaged}
							isStaged={false}
							expanded={props.expandedUnstaged}
							onToggle={props.onToggleUnstaged}
							onStage={props.onStage}
							onUnstage={props.onUnstage}
							onDiscard={props.onDiscard}
							onOpenFile={props.onOpenFile}
							onOpenDiff={props.onOpenDiff}
						/>
					) : null}
				</div>
				<CommitForm
					value={props.commitMessage}
					canSubmit={canSubmit}
					onChange={props.onCommitMessageChange}
					onCreateBranch={() => canSubmit && props.onCreateBranch(trimmed)}
					onCommit={() => canSubmit && props.onCommit(trimmed)}
				/>
			</div>
		</article>
	);
}

function UncommittedHeader(): JSX.Element {
	return (
		<div className="branch-header">
			<span className="branch-toggle-spacer" />
			<span className="branch-name">Uncommitted Changes</span>
			<div className="branch-tags" />
		</div>
	);
}

interface ChangesSectionProps {
	title: string;
	files: WorkingCopyChange[];
	isStaged: boolean;
	expanded: boolean;
	onToggle: () => void;
	onStage: (path: string) => void;
	onUnstage: (path: string) => void;
	onDiscard: (path: string) => void;
	onOpenFile: (path: string) => void;
	onOpenDiff: (path: string, staged: boolean, status: FileChangeStatus) => void;
}

function ChangesSection(props: ChangesSectionProps): JSX.Element {
	const sectionLabel = `${props.expanded ? 'Collapse' : 'Expand'} ${props.title} (${props.files.length})`;
	return (
		<div className="changes-section">
			<div className="changes-section-header">
				<button
					type="button"
					className={`codicon codicon-chevron-${props.expanded ? 'down' : 'right'}`}
					aria-label={sectionLabel}
					aria-expanded={props.expanded}
					onClick={(e) => {
						e.stopPropagation();
						props.onToggle();
					}}
				/>
				<span>{`${props.title} (${props.files.length})`}</span>
			</div>
			<div className={`commit-files${props.expanded ? '' : ' hidden'}`}>
				{props.files.map((file) => (
					<FileRow
						key={file.path}
						file={file}
						isStaged={props.isStaged}
						onStage={props.onStage}
						onUnstage={props.onUnstage}
						onDiscard={props.onDiscard}
						onOpenFile={props.onOpenFile}
						onOpenDiff={props.onOpenDiff}
					/>
				))}
			</div>
		</div>
	);
}

interface FileRowProps {
	file: WorkingCopyChange;
	isStaged: boolean;
	onStage: (path: string) => void;
	onUnstage: (path: string) => void;
	onDiscard: (path: string) => void;
	onOpenFile: (path: string) => void;
	onOpenDiff: (path: string, staged: boolean, status: FileChangeStatus) => void;
}

function FileRow({ file, isStaged, onStage, onUnstage, onDiscard, onOpenFile, onOpenDiff }: FileRowProps): JSX.Element {
	const { fileName, folderPath } = splitPath(file.path);
	return (
		<div
			className="file-change"
			role="button"
			tabIndex={0}
			aria-label={`Open ${isStaged ? 'staged' : 'unstaged'} diff for ${file.path}`}
			onClick={(e) => {
				if ((e.target as HTMLElement).closest('button')) return;
				onOpenDiff(file.path, isStaged, file.status);
			}}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onOpenDiff(file.path, isStaged, file.status);
				}
			}}
		>
			<i className="file-icon codicon codicon-file" aria-hidden="true" />
			<span className="file-name">{fileName}</span>
			<span className="file-folder">{folderPath}</span>
			{isStaged ? (
				<ActionButton
					icon="codicon-remove"
					label={`Unstage ${file.path}`}
					title="Unstage"
					onClick={() => onUnstage(file.path)}
				/>
			) : (
				<>
					<ActionButton
						icon="codicon-discard"
						label={`Discard changes to ${file.path}`}
						title="Discard Changes"
						onClick={() => onDiscard(file.path)}
					/>
					<ActionButton
						icon="codicon-add"
						label={`Stage ${file.path}`}
						title="Stage"
						onClick={() => onStage(file.path)}
					/>
				</>
			)}
			{file.status !== ('D' as FileChangeStatus) ? (
				<ActionButton
					icon="codicon-go-to-file"
					label={`Open file ${file.path}`}
					title="Open File"
					onClick={() => onOpenFile(file.path)}
				/>
			) : null}
			<span className={`file-status status-${file.status.toLowerCase()}`}>{file.status}</span>
		</div>
	);
}

interface ActionButtonProps {
	icon: string;
	label: string;
	title: string;
	onClick: () => void;
}

function ActionButton({ icon, label, title, onClick }: ActionButtonProps): JSX.Element {
	return (
		<button
			type="button"
			className="file-action-btn"
			title={title}
			aria-label={label}
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
		>
			<i className={`codicon ${icon}`} aria-hidden="true" />
		</button>
	);
}

interface CommitFormProps {
	value: string;
	canSubmit: boolean;
	onChange: (value: string) => void;
	onCreateBranch: () => void;
	onCommit: () => void;
}

function CommitForm({ value, canSubmit, onChange, onCreateBranch, onCommit }: CommitFormProps): JSX.Element {
	return (
		<div className="commit-form">
			<input
				type="text"
				className="commit-message-input"
				placeholder="Message (press Enter to commit)"
				aria-label="Commit message"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				onKeyDown={(e) => {
					if (e.key !== 'Enter') return;
					e.preventDefault();
					onCreateBranch();
				}}
			/>
			<div className="commit-actions">
				<button
					type="button"
					className="commit-btn commit-btn-primary"
					disabled={!canSubmit}
					aria-label="Create new branch with this commit message"
					onClick={onCreateBranch}
				>
					Create new branch
				</button>
				<button
					type="button"
					className="commit-btn commit-btn-secondary"
					disabled={!canSubmit}
					aria-label="Add this commit to the current branch"
					onClick={onCommit}
				>
					Add to current branch
				</button>
			</div>
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
