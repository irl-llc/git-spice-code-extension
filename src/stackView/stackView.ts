/**
 * Git-Spice Stack View - Main Entry Point
 *
 * Orchestrates the webview UI by coordinating:
 * - Per-repository state management and rendering
 * - Branch/commit/working-copy rendering via extracted modules
 * - Animation and diffing via dedicated engines
 */

import type { BranchViewModel, CommitFileChange, DisplayState, RepositoryViewModel } from './types';
import type { ExtensionMessage } from './webviewTypes';
import { ANIMATION_DURATION_MS, ANIMATION_STAGGER_MS } from '../constants';
import { LANE_WIDTH, NODE_RADIUS_CURRENT, NODE_STROKE } from './tree/treeConstants';
import type { TreeColors } from './tree/treeFragment';

import { animations } from './webview/animationHelpers';
import { diffList } from './webview/diffEngine';
import {
	renderBranch,
	updateBranch,
	branchNeedsUpdate,
	type PostMessage,
} from './webview/branchRenderer';
import {
	renderCommitsContainer,
	handleCommitFilesResponse,
	type CommitRendererState,
} from './webview/commitRenderer';
import {
	renderBranchSummary,
	handleBranchFilesResponse,
	type BranchSummaryState,
} from './webview/branchSummaryRenderer';
import {
	renderUncommittedCard,
	type WorkingCopyState,
} from './webview/workingCopyRenderer';
import {
	renderRepoSection,
	getBranchList,
	getErrorElement,
	getEmptyElement,
} from './webview/repoSectionRenderer';

/** Per-repository view state. */
interface RepoViewState {
	currentState: RepositoryViewModel | null;
	commitState: CommitRendererState;
	branchSummaryState: BranchSummaryState;
	workingCopyState: WorkingCopyState;
	sectionElement: HTMLElement;
}

/** Creates a fresh per-repo view state with a new section element. */
function createRepoViewState(repoId: string, repoName: string): RepoViewState {
	return {
		currentState: null,
		commitState: { expandedCommits: new Set(), fileCache: new Map() },
		branchSummaryState: { expandedBranches: new Set(), fileCache: new Map() },
		workingCopyState: { expandedStagedSection: true, expandedUnstagedSection: true, commitMessageValue: '' },
		sectionElement: renderRepoSection(repoId, repoName),
	};
}

/**
 * Main stack view controller.
 * Manages per-repo state and coordinates rendering across repositories.
 */
class StackView {
	private readonly vscode = acquireVsCodeApi();
	private readonly repoContainer: HTMLElement;
	private readonly globalErrorEl: HTMLElement;
	private readonly globalEmptyEl: HTMLElement;
	private readonly repoViews = new Map<string, RepoViewState>();

	constructor() {
		this.repoContainer = document.getElementById('repoContainer')!;
		this.globalErrorEl = document.getElementById('error')!;
		this.globalEmptyEl = document.getElementById('empty')!;

		this.setupEventListeners();
		this.vscode.postMessage({ type: 'ready' });
	}

	private setupEventListeners(): void {
		window.addEventListener('message', (event: MessageEvent) => {
			this.handleMessage(event.data as ExtensionMessage);
		});
	}

	private handleMessage(message: ExtensionMessage): void {
		if (!message) return;
		if (message.type === 'state') this.updateState(message.payload, message.force);
		if (message.type === 'commitFiles') this.handleCommitFiles(message.repoId, message.sha, message.files);
		if (message.type === 'branchFiles') this.handleBranchFiles(message.repoId, message.branchName, message.files);
	}

	// --- State Updates ---

	private updateState(newState: DisplayState, force?: boolean): void {
		if (newState.repositories.length === 0) {
			this.showGlobalEmpty();
			return;
		}

		this.globalEmptyEl.classList.add('hidden');
		this.globalErrorEl.classList.add('hidden');
		this.reconcileRepoSections(newState.repositories);
		this.updateAllRepos(newState.repositories, force);
		this.applySingleRepoMode(newState.repositories.length === 1);
	}

	private showGlobalEmpty(): void {
		this.globalEmptyEl.textContent = 'No git-spice repositories found.';
		this.globalEmptyEl.classList.remove('hidden');
		this.removeAllRepoSections();
	}

	private removeAllRepoSections(): void {
		for (const view of this.repoViews.values()) {
			view.sectionElement.remove();
		}
		this.repoViews.clear();
	}

	/** Adds/removes repo sections to match the current repository list. */
	private reconcileRepoSections(repos: RepositoryViewModel[]): void {
		const repoIds = new Set(repos.map((r) => r.id));
		this.removeStaleRepoSections(repoIds);
		for (const repo of repos) this.ensureRepoSection(repo);
	}

	private removeStaleRepoSections(activeIds: Set<string>): void {
		for (const [id, view] of this.repoViews) {
			if (activeIds.has(id)) continue;
			view.sectionElement.remove();
			this.repoViews.delete(id);
		}
	}

	private ensureRepoSection(repo: RepositoryViewModel): void {
		if (this.repoViews.has(repo.id)) return;
		const view = createRepoViewState(repo.id, repo.name);
		this.repoViews.set(repo.id, view);
		this.repoContainer.appendChild(view.sectionElement);
	}

	private updateAllRepos(repos: RepositoryViewModel[], force?: boolean): void {
		for (const repo of repos) this.updateRepoSection(repo, force);
	}

	/** Toggles .single-repo class on all sections for single-repo mode. */
	private applySingleRepoMode(isSingle: boolean): void {
		for (const view of this.repoViews.values()) {
			view.sectionElement.classList.toggle('single-repo', isSingle);
		}
	}

	// --- Per-Repo Rendering ---

	private updateRepoSection(repo: RepositoryViewModel, force?: boolean): void {
		const view = this.repoViews.get(repo.id);
		if (!view) return;
		if (!force && this.repoUnchanged(view, repo)) return;

		const oldBranches = view.currentState?.branches ?? [];
		view.currentState = repo;

		const branchList = getBranchList(view.sectionElement);
		this.updateRepoError(view.sectionElement, repo);
		this.updateGraphWidth(branchList, repo.branches);
		this.updateRepoBranches(branchList, oldBranches, repo, view);
		this.updateRepoUncommitted(branchList, repo, view);
	}

	private repoUnchanged(view: RepoViewState, repo: RepositoryViewModel): boolean {
		try {
			return JSON.stringify(view.currentState) === JSON.stringify(repo);
		} catch {
			return false;
		}
	}

	private updateRepoError(section: HTMLElement, repo: RepositoryViewModel): void {
		const errorEl = getErrorElement(section);
		errorEl.classList.toggle('hidden', !repo.error);
		errorEl.textContent = repo.error ?? '';
	}

	private updateGraphWidth(branchList: HTMLElement, branches: BranchViewModel[]): void {
		const maxLane = branches.reduce((max, b) => Math.max(max, b.treeFragment.maxLane), 0);
		const width = LANE_WIDTH * (maxLane + 1) + NODE_RADIUS_CURRENT + NODE_STROKE;
		branchList.style.setProperty('--tree-graph-width', `${width}px`);
	}

	private updateRepoBranches(
		branchList: HTMLElement,
		oldBranches: BranchViewModel[],
		repo: RepositoryViewModel,
		view: RepoViewState,
	): void {
		const emptyEl = getEmptyElement(view.sectionElement);

		if (repo.branches.length === 0) {
			emptyEl.textContent = repo.error ?? 'No branches in the current stack.';
			emptyEl.classList.remove('hidden');
			this.animateOutAllItems(branchList);
			return;
		}

		emptyEl.classList.add('hidden');
		this.reconcileBranches(branchList, oldBranches, repo.branches, view);
	}

	private animateOutAllItems(branchList: HTMLElement): void {
		const items = branchList.querySelectorAll('.stack-item');
		items.forEach((item, index) => {
			(item as HTMLElement).style.animationDelay = `${index * ANIMATION_STAGGER_MS}ms`;
			animations.animateOut(item as HTMLElement, () => {});
		});

		setTimeout(() => {
			branchList.innerHTML = '';
		}, items.length * ANIMATION_STAGGER_MS + ANIMATION_DURATION_MS);
	}

	// --- Branch Reconciliation ---

	private reconcileBranches(
		branchList: HTMLElement,
		oldBranches: BranchViewModel[],
		newBranches: BranchViewModel[],
		view: RepoViewState,
	): void {
		diffList(branchList, oldBranches, newBranches, {
			getKey: (branch) => branch.name,
			render: (branch) => this.renderBranchCard(branch, view),
			update: (card, branch) => this.updateBranchCard(card, branch, view),
			needsUpdate: (card, branch) => branchNeedsUpdate(card, branch),
			itemSelector: '.stack-item',
			itemClass: 'stack-item',
		}, animations, this.getTreeColors());
	}

	private renderBranchCard(branch: BranchViewModel, view: RepoViewState): HTMLElement {
		const postMessage = this.getPostMessage(view.currentState?.id);
		return renderBranch(
			branch,
			postMessage,
			(b, card) => this.createCommitsContainer(b, card, view),
			(name) => this.createSummaryContainer(name, view),
		);
	}

	private updateBranchCard(card: HTMLElement, branch: BranchViewModel, view: RepoViewState): void {
		const postMessage = this.getPostMessage(view.currentState?.id);
		updateBranch(
			card,
			branch,
			postMessage,
			(b, c) => this.createCommitsContainer(b, c, view),
			(name) => this.createSummaryContainer(name, view),
		);
	}

	private createCommitsContainer(branch: BranchViewModel, _card: HTMLElement, view: RepoViewState): HTMLElement {
		return renderCommitsContainer(branch, view.commitState, this.getPostMessage(view.currentState?.id), animations, this.getTreeColors());
	}

	private createSummaryContainer(branchName: string, view: RepoViewState): HTMLElement {
		return renderBranchSummary(branchName, view.branchSummaryState, this.getPostMessage(view.currentState?.id));
	}

	// --- Uncommitted Changes ---

	private updateRepoUncommitted(branchList: HTMLElement, repo: RepositoryViewModel, view: RepoViewState): void {
		branchList.querySelector('.uncommitted-item')?.remove();
		if (!repo.uncommitted || !repo.uncommittedTreeFragment) return;

		const hasChanges = repo.uncommitted.staged.length > 0 || repo.uncommitted.unstaged.length > 0;
		if (!hasChanges) return;

		const newCard = renderUncommittedCard(
			repo.uncommitted, repo.uncommittedTreeFragment, this.getTreeColors(), view.workingCopyState, this.getPostMessage(view.currentState?.id),
		);

		const insertionPoint = this.findCurrentBranchElement(branchList, repo.branches);
		if (insertionPoint) {
			branchList.insertBefore(newCard, insertionPoint);
		} else {
			branchList.appendChild(newCard);
		}
	}

	private findCurrentBranchElement(branchList: HTMLElement, branches: BranchViewModel[]): HTMLElement | null {
		const currentBranch = branches.find((b) => b.current);
		if (!currentBranch) return null;
		return branchList.querySelector(`.stack-item[data-key="${currentBranch.name}"]`);
	}

	// --- Shared Helpers ---

	private getTreeColors(): TreeColors {
		const styles = getComputedStyle(document.documentElement);
		return {
			line: styles.getPropertyValue('--tree-line-color').trim() || '#888888',
			restack: styles.getPropertyValue('--tree-line-restack-color').trim() || '#cca700',
			node: styles.getPropertyValue('--tree-node-color').trim() || '#888888',
			nodeCurrent: styles.getPropertyValue('--tree-node-current-color').trim() || '#3794ff',
			bg: styles.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e',
		};
	}

	private getPostMessage(repoId?: string): PostMessage {
		return (message) => {
			const isGlobal = message.type === 'ready' || message.type === 'refresh';
			const enriched = isGlobal || !repoId ? message : { ...message, repoId };
			this.vscode.postMessage(enriched);
		};
	}

	// --- File Response Handlers ---

	/** Handles commit file responses — targets the specified repo section if repoId is set. */
	private handleCommitFiles(repoId: string | undefined, sha: string, files: CommitFileChange[]): void {
		const targets = repoId ? [this.repoViews.get(repoId)] : this.repoViews.values();
		for (const view of targets) {
			if (!view) continue;
			const branchList = getBranchList(view.sectionElement);
			handleCommitFilesResponse(sha, files, branchList, view.commitState, this.getPostMessage());
		}
	}

	/** Handles branch file responses — targets the specified repo section if repoId is set. */
	private handleBranchFiles(repoId: string | undefined, branchName: string, files: CommitFileChange[]): void {
		const targets = repoId ? [this.repoViews.get(repoId)] : this.repoViews.values();
		for (const view of targets) {
			if (!view) continue;
			const branchList = getBranchList(view.sectionElement);
			handleBranchFilesResponse(branchName, files, branchList, view.branchSummaryState, this.getPostMessage());
		}
	}
}

document.addEventListener('DOMContentLoaded', () => {
	new StackView();
});
