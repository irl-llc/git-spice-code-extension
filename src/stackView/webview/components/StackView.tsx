/**
 * Top-level webview component. Holds the entire UI tree in a single React
 * root, replacing the imperative StackView class and the per-renderer
 * mount wrappers.
 *
 * Responsibilities:
 * - Subscribe to messages from the extension host (refreshing, state,
 *   commitFiles, branchFiles) and reduce them into local state. The
 *   `refreshing` message toggles a transient in-flight indicator that
 *   `state` clears, giving the user visible refresh feedback.
 * - Manage per-repo UI state (expanded shas, file caches, commit message,
 *   section toggles). Reducer-shaped so all the mutations are explicit.
 * - Render repo sections, each containing the branch stack and the
 *   uncommitted-changes pseudo-branch.
 *
 * Replaces: stackView.ts (the imperative orchestrator), and removes the
 * need for branchRenderer.tsx / branchSummaryRenderer.tsx /
 * commitRenderer.tsx / repoSectionRenderer.tsx /
 * untrackedCardRenderer.tsx / workingCopyRenderer.tsx wrappers.
 */

import { useEffect, useMemo, useReducer, useRef, type JSX } from 'react';

import { LANE_WIDTH, NODE_RADIUS_CURRENT, NODE_STROKE } from '../../tree/treeConstants';
import { TreeFragmentSvg, type TreeColors } from '../../tree/treeFragment';
import type {
	BranchViewModel,
	CommitFileChange,
	DisplayState,
	IntegrationViewModel,
	RepositoryViewModel,
} from '../../types';
import type { ExtensionMessage, WebviewMessage } from '../../webviewTypes';
import { buildBranchContext } from '../../contextBuilder';
import { BranchCard } from './BranchCard';
import { BranchSummary } from './BranchSummary';
import { CommitList } from './CommitList';
import { IntegrationCard } from './IntegrationCard';
import { RepoSection } from './RepoSection';
import { UncommittedCard } from './UncommittedCard';
import { UntrackedCard } from './UntrackedCard';

export type PostMessage = (message: WebviewMessage) => void;

/** Per-repo UI state managed entirely in React. */
interface RepoUiState {
	expandedCommits: Set<string>;
	expandedBranches: Set<string>;
	commitFileCache: Map<string, CommitFileChange[]>;
	branchFileCache: Map<string, CommitFileChange[]>;
	expandedStagedSection: boolean;
	expandedUnstagedSection: boolean;
	commitMessageValue: string;
}

function initialRepoUi(): RepoUiState {
	return {
		expandedCommits: new Set(),
		expandedBranches: new Set(),
		commitFileCache: new Map(),
		branchFileCache: new Map(),
		expandedStagedSection: true,
		expandedUnstagedSection: true,
		commitMessageValue: '',
	};
}

interface AppState {
	display: DisplayState | null;
	ui: Record<string, RepoUiState>;
	refreshing: boolean;
}

type Action =
	| { type: 'refreshing' }
	| { type: 'setDisplay'; payload: DisplayState }
	| { type: 'commitFiles'; repoId: string | undefined; sha: string; files: CommitFileChange[] }
	| { type: 'branchFiles'; repoId: string | undefined; branchName: string; files: CommitFileChange[] }
	| { type: 'toggleCommit'; repoId: string; sha: string }
	| { type: 'toggleBranchSummary'; repoId: string; branchName: string }
	| { type: 'toggleStaged'; repoId: string }
	| { type: 'toggleUnstaged'; repoId: string }
	| { type: 'setCommitMessage'; repoId: string; value: string }
	| { type: 'clearCommitMessage'; repoId: string };

function reducer(state: AppState, action: Action): AppState {
	switch (action.type) {
		case 'refreshing':
			return state.refreshing ? state : { ...state, refreshing: true };
		case 'setDisplay':
			return applySetDisplay(state, action.payload);
		case 'commitFiles':
			return mapMatchingRepos(state, action.repoId, (repoUi) => ({
				...repoUi,
				commitFileCache: new Map(repoUi.commitFileCache).set(action.sha, action.files),
			}));
		case 'branchFiles':
			return mapMatchingRepos(state, action.repoId, (repoUi) => ({
				...repoUi,
				branchFileCache: new Map(repoUi.branchFileCache).set(action.branchName, action.files),
			}));
		default:
			return uiReducer(state, action);
	}
}

/** Rebuilds per-repo UI state for a fresh display payload, dropping dead repos. */
function applySetDisplay(state: AppState, payload: DisplayState): AppState {
	const activeIds = new Set(payload.repositories.map((r) => r.id));
	const ui: Record<string, RepoUiState> = {};
	for (const [id, repoUi] of Object.entries(state.ui)) {
		if (activeIds.has(id)) ui[id] = repoUi;
	}
	for (const repo of payload.repositories) ui[repo.id] ??= initialRepoUi();
	// A fresh state always clears the in-flight refresh indicator.
	return { ...state, display: payload, ui, refreshing: false };
}

/** Reducer slice for per-repo UI toggles and the commit-message field. */
function uiReducer(state: AppState, action: Action): AppState {
	switch (action.type) {
		case 'toggleCommit':
			return updateRepo(state, action.repoId, (repoUi) => ({
				...repoUi,
				expandedCommits: toggleSet(repoUi.expandedCommits, action.sha),
			}));
		case 'toggleBranchSummary':
			return updateRepo(state, action.repoId, (repoUi) => ({
				...repoUi,
				expandedBranches: toggleSet(repoUi.expandedBranches, action.branchName),
			}));
		case 'toggleStaged':
			return updateRepo(state, action.repoId, (repoUi) => ({
				...repoUi,
				expandedStagedSection: !repoUi.expandedStagedSection,
			}));
		case 'toggleUnstaged':
			return updateRepo(state, action.repoId, (repoUi) => ({
				...repoUi,
				expandedUnstagedSection: !repoUi.expandedUnstagedSection,
			}));
		case 'setCommitMessage':
			return updateRepo(state, action.repoId, (repoUi) => ({ ...repoUi, commitMessageValue: action.value }));
		case 'clearCommitMessage':
			return updateRepo(state, action.repoId, (repoUi) => ({ ...repoUi, commitMessageValue: '' }));
		default:
			return state;
	}
}

function mapMatchingRepos(
	state: AppState,
	repoId: string | undefined,
	mapper: (repoUi: RepoUiState) => RepoUiState,
): AppState {
	const ui: Record<string, RepoUiState> = {};
	let changed = false;
	for (const [id, repoUi] of Object.entries(state.ui)) {
		if (repoId === undefined || repoId === id) {
			ui[id] = mapper(repoUi);
			changed = true;
		} else {
			ui[id] = repoUi;
		}
	}
	return changed ? { ...state, ui } : state;
}

function updateRepo(state: AppState, repoId: string, mapper: (repoUi: RepoUiState) => RepoUiState): AppState {
	const current = state.ui[repoId];
	if (!current) return state;
	return { ...state, ui: { ...state.ui, [repoId]: mapper(current) } };
}

function toggleSet<T>(set: Set<T>, value: T): Set<T> {
	const next = new Set(set);
	if (next.has(value)) {
		next.delete(value);
	} else {
		next.add(value);
	}
	return next;
}

export interface StackViewProps {
	postMessage: PostMessage;
	subscribeMessages: (handler: (message: ExtensionMessage) => void) => () => void;
}

export function StackView({ postMessage, subscribeMessages }: StackViewProps): JSX.Element {
	const [state, dispatch] = useReducer(reducer, { display: null, ui: {}, refreshing: false });
	const dispatchRef = useRef(dispatch);
	dispatchRef.current = dispatch;
	const treeColors = useReadTreeColors();

	useEffect(() => {
		const unsubscribe = subscribeMessages((message) => {
			if (message.type === 'refreshing') dispatchRef.current({ type: 'refreshing' });
			else if (message.type === 'state') dispatchRef.current({ type: 'setDisplay', payload: message.payload });
			else if (message.type === 'commitFiles')
				dispatchRef.current({ type: 'commitFiles', repoId: message.repoId, sha: message.sha, files: message.files });
			else if (message.type === 'branchFiles')
				dispatchRef.current({
					type: 'branchFiles',
					repoId: message.repoId,
					branchName: message.branchName,
					files: message.files,
				});
		});
		// Announce readiness only now that the listener is attached. Posting
		// 'ready' earlier (e.g. from the bootstrap right after render()) races
		// this effect: the host's state push can arrive before we subscribe and
		// be dropped, leaving the view blank (issue #67).
		postMessage({ type: 'ready' });
		return unsubscribe;
	}, [subscribeMessages, postMessage]);

	const repos = state.display?.repositories ?? [];
	const isSingle = repos.length === 1;
	return (
		<>
			<RefreshIndicator active={state.refreshing} />
			{state.display !== null && repos.length === 0 ? (
				<section className="empty">No git-spice repositories found.</section>
			) : null}
			{repos.map((repo) => (
				<RepoView
					key={repo.id}
					repo={repo}
					ui={state.ui[repo.id] ?? initialRepoUi()}
					treeColors={treeColors}
					isSingleRepo={isSingle}
					postMessage={makeRepoScopedPostMessage(postMessage, repo.id)}
					dispatch={dispatch}
				/>
			))}
		</>
	);
}

/**
 * Thin top banner shown while a refresh is in flight. Gives the user
 * immediate feedback that the refresh button (or a file-watch refresh)
 * is doing work, so they don't assume it is broken and click repeatedly.
 */
function RefreshIndicator({ active }: { active: boolean }): JSX.Element {
	if (!active) return <></>;
	return (
		<div className="refresh-indicator" role="status" aria-live="polite" data-role="refresh-indicator">
			<i className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
			<span>Refreshing…</span>
		</div>
	);
}

function makeRepoScopedPostMessage(post: PostMessage, repoId: string): PostMessage {
	return (message) => {
		const isGlobal = message.type === 'ready' || message.type === 'refresh';
		post(isGlobal ? message : ({ ...message, repoId } as WebviewMessage));
	};
}

function useReadTreeColors(): TreeColors {
	return useMemo(() => {
		const styles = getComputedStyle(document.documentElement);
		return {
			line: styles.getPropertyValue('--tree-line-color').trim() || '#888888',
			restack: styles.getPropertyValue('--tree-line-restack-color').trim() || '#cca700',
			node: styles.getPropertyValue('--tree-node-color').trim() || '#888888',
			nodeCurrent: styles.getPropertyValue('--tree-node-current-color').trim() || '#3794ff',
			bg: styles.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e',
		};
	}, []);
}

interface RepoViewProps {
	repo: RepositoryViewModel;
	ui: RepoUiState;
	treeColors: TreeColors;
	isSingleRepo: boolean;
	postMessage: PostMessage;
	dispatch: React.Dispatch<Action>;
}

function RepoView({ repo, ui, treeColors, isSingleRepo, postMessage, dispatch }: RepoViewProps): JSX.Element {
	const sectionRef = useRef<HTMLElement | null>(null);
	useEffect(() => {
		if (sectionRef.current) sectionRef.current.classList.toggle('single-repo', isSingleRepo);
	}, [isSingleRepo]);

	const maxLane = repo.branches.reduce((max, b) => Math.max(max, b.treeFragment.maxLane), 0);
	const graphWidth = LANE_WIDTH * (maxLane + 1) + NODE_RADIUS_CURRENT + NODE_STROKE;

	return (
		<section
			ref={sectionRef}
			className={`repo-section expanded${isSingleRepo ? ' single-repo' : ''}`}
			data-repo-id={repo.id}
		>
			<RepoSection
				repoId={repo.id}
				repoName={repo.name}
				postMessage={postMessage}
				setSectionClass={(cls, on) => sectionRef.current?.classList.toggle(cls, on)}
			/>
			<ul
				className="repo-branch-list stack-list"
				style={{ ['--tree-graph-width' as string]: `${graphWidth}px` } as React.CSSProperties}
			>
				<RepoStack repo={repo} ui={ui} treeColors={treeColors} postMessage={postMessage} dispatch={dispatch} />
			</ul>
			<RepoErrorEmpty repo={repo} />
		</section>
	);
}

function RepoErrorEmpty({ repo }: { repo: RepositoryViewModel }): JSX.Element {
	if (repo.error) {
		return (
			<section className="error" data-role="repo-error">
				{repo.error}
			</section>
		);
	}
	if (repo.branches.length === 0) {
		return (
			<section className="empty" data-role="repo-empty">
				No branches in the current stack.
			</section>
		);
	}
	return <></>;
}

interface RepoStackProps {
	repo: RepositoryViewModel;
	ui: RepoUiState;
	treeColors: TreeColors;
	postMessage: PostMessage;
	dispatch: React.Dispatch<Action>;
}

function RepoStack({ repo, ui, treeColors, postMessage, dispatch }: RepoStackProps): JSX.Element {
	const showUncommitted =
		repo.uncommitted && (repo.uncommitted.staged.length > 0 || repo.uncommitted.unstaged.length > 0);
	const insertUncommittedAtTop = Boolean(repo.untrackedBranch);

	return (
		<>
			{repo.integration ? <IntegrationItem integration={repo.integration} treeColors={treeColors} /> : null}
			{showUncommitted && insertUncommittedAtTop ? (
				<UncommittedItem repo={repo} ui={ui} postMessage={postMessage} dispatch={dispatch} treeless />
			) : null}
			{repo.untrackedBranch ? <UntrackedItem branchName={repo.untrackedBranch} postMessage={postMessage} /> : null}
			{repo.branches.map((branch) => (
				<BranchStackItem
					key={branch.name}
					branch={branch}
					repoId={repo.id}
					ui={ui}
					treeColors={treeColors}
					postMessage={postMessage}
					dispatch={dispatch}
					uncommittedSlot={
						showUncommitted && !insertUncommittedAtTop && branch.current ? (
							<UncommittedItem repo={repo} ui={ui} postMessage={postMessage} dispatch={dispatch} />
						) : null
					}
				/>
			))}
		</>
	);
}

interface BranchStackItemProps {
	branch: BranchViewModel;
	repoId: string;
	ui: RepoUiState;
	treeColors: TreeColors;
	postMessage: PostMessage;
	dispatch: React.Dispatch<Action>;
	uncommittedSlot: JSX.Element | null;
}

function BranchStackItem({
	branch,
	repoId,
	ui,
	treeColors,
	postMessage,
	dispatch,
	uncommittedSlot,
}: BranchStackItemProps): JSX.Element {
	const articleRef = useRef<HTMLElement | null>(null);

	const hasCommits = Boolean(branch.commits && branch.commits.length > 0);
	const showSummary = hasCommits && (branch.commits?.length ?? 0) > 1;

	return (
		<>
			{uncommittedSlot}
			<li className="stack-item" data-key={branch.name} data-branch={branch.name}>
				<TreeFragmentSvg
					fragment={branch.treeFragment}
					colors={treeColors}
					outOfIntegration={branch.outOfIntegration}
				/>
				<article
					ref={articleRef}
					className={`branch-card${branch.current ? ' is-current' : ''}${branch.restack ? ' needs-restack' : ''}`}
					data-content="true"
					data-branch={branch.name}
					data-depth={String(branch.tree.depth)}
					data-parent-branch={branch.tree.parentName}
					data-vscode-context={buildBranchContext(branch)}
				>
					<BranchCard
						branch={branch}
						postMessage={postMessage}
						setArticleClass={(cls, on) => articleRef.current?.classList.toggle(cls, on)}
						summary={
							showSummary ? (
								<InlineBranchSummary
									branchName={branch.name}
									repoId={repoId}
									ui={ui}
									postMessage={postMessage}
									dispatch={dispatch}
								/>
							) : undefined
						}
						commits={
							hasCommits ? (
								<InlineCommitList
									branch={branch}
									repoId={repoId}
									ui={ui}
									postMessage={postMessage}
									dispatch={dispatch}
								/>
							) : undefined
						}
					/>
				</article>
			</li>
		</>
	);
}

interface InlineBranchSummaryProps {
	branchName: string;
	repoId: string;
	ui: RepoUiState;
	postMessage: PostMessage;
	dispatch: React.Dispatch<Action>;
}

function InlineBranchSummary({ branchName, repoId, ui, postMessage, dispatch }: InlineBranchSummaryProps): JSX.Element {
	const expanded = ui.expandedBranches.has(branchName);
	const files = ui.branchFileCache.get(branchName);
	return (
		<BranchSummary
			branchName={branchName}
			expanded={expanded}
			files={files}
			onToggle={() => {
				dispatch({ type: 'toggleBranchSummary', repoId, branchName });
				if (!expanded && !ui.branchFileCache.has(branchName)) {
					postMessage({ type: 'getBranchFiles', branchName });
				}
			}}
			onOpenDiff={() => postMessage({ type: 'openBranchDiff', branchName })}
			onOpenFileDiff={(path, status) => postMessage({ type: 'openBranchFileDiff', branchName, path, status })}
			onOpenCurrentFile={(path) => postMessage({ type: 'openCurrentFile', path })}
		/>
	);
}

interface InlineCommitListProps {
	branch: BranchViewModel;
	repoId: string;
	ui: RepoUiState;
	postMessage: PostMessage;
	dispatch: React.Dispatch<Action>;
}

function InlineCommitList({ branch, repoId, ui, postMessage, dispatch }: InlineCommitListProps): JSX.Element {
	return (
		<CommitList
			branchName={branch.name}
			commits={branch.commits ?? []}
			expandedShas={ui.expandedCommits}
			fileCache={ui.commitFileCache}
			onToggle={(sha) => {
				dispatch({ type: 'toggleCommit', repoId, sha });
				if (!ui.expandedCommits.has(sha) && !ui.commitFileCache.has(sha)) {
					postMessage({ type: 'getCommitFiles', sha });
				}
			}}
			onOpenCommitDiff={(sha) => {
				if (typeof sha !== 'string' || sha.length === 0) return;
				postMessage({ type: 'openCommitDiff', sha });
			}}
			onOpenFileDiff={(sha, path) => postMessage({ type: 'openFileDiff', sha, path })}
			onOpenCurrentFile={(path) => postMessage({ type: 'openCurrentFile', path })}
		/>
	);
}

interface UncommittedItemProps {
	repo: RepositoryViewModel;
	ui: RepoUiState;
	postMessage: PostMessage;
	dispatch: React.Dispatch<Action>;
	treeless?: boolean;
}

function UncommittedItem({ repo, ui, postMessage, dispatch, treeless }: UncommittedItemProps): JSX.Element {
	const colors = useReadTreeColors();
	return (
		<li className={`stack-item uncommitted-item${treeless ? ' treeless' : ''}`} data-branch="__uncommitted__">
			{!treeless && repo.uncommittedTreeFragment ? (
				<TreeFragmentSvg fragment={repo.uncommittedTreeFragment} colors={colors} />
			) : null}
			<UncommittedCard
				uncommitted={repo.uncommitted!}
				expandedStaged={ui.expandedStagedSection}
				expandedUnstaged={ui.expandedUnstagedSection}
				commitMessage={ui.commitMessageValue}
				onToggleStaged={() => dispatch({ type: 'toggleStaged', repoId: repo.id })}
				onToggleUnstaged={() => dispatch({ type: 'toggleUnstaged', repoId: repo.id })}
				onCommitMessageChange={(v) => dispatch({ type: 'setCommitMessage', repoId: repo.id, value: v })}
				onStage={(path) => postMessage({ type: 'stageFile', path })}
				onUnstage={(path) => postMessage({ type: 'unstageFile', path })}
				onDiscard={(path) => postMessage({ type: 'discardFile', path })}
				onOpenFile={(path) => postMessage({ type: 'openCurrentFile', path })}
				onOpenDiff={(path, staged, status) => postMessage({ type: 'openWorkingCopyDiff', path, staged, status })}
				onCreateBranch={(message) => {
					postMessage({ type: 'createBranch', message });
					dispatch({ type: 'clearCommitMessage', repoId: repo.id });
				}}
				onCommit={(message) => {
					postMessage({ type: 'commitChanges', message });
					dispatch({ type: 'clearCommitMessage', repoId: repo.id });
				}}
			/>
		</li>
	);
}

interface IntegrationItemProps {
	integration: IntegrationViewModel;
	treeColors: TreeColors;
}

function IntegrationItem({ integration, treeColors }: IntegrationItemProps): JSX.Element {
	return (
		<li className="stack-item integration-item" data-branch="__integration__">
			<TreeFragmentSvg fragment={integration.treeFragment} colors={treeColors} />
			<IntegrationCard integration={integration} />
		</li>
	);
}

interface UntrackedItemProps {
	branchName: string;
	postMessage: PostMessage;
}

function UntrackedItem({ branchName, postMessage }: UntrackedItemProps): JSX.Element {
	return (
		<li className="stack-item untracked-item" data-branch={branchName}>
			<UntrackedCard branchName={branchName} onTrack={() => postMessage({ type: 'branchTrack', branchName })} />
		</li>
	);
}
