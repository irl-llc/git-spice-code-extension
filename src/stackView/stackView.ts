/**
 * Git-Spice Stack View - Main Entry Point
 *
 * Orchestrates the webview UI by coordinating:
 * - State management and updates
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

/**
 * Main stack view controller.
 * Manages state and coordinates rendering of branches and commits.
 */
class StackView {
	private readonly vscode = acquireVsCodeApi();
	private readonly stackList: HTMLElement;
	private readonly errorEl: HTMLElement;
	private readonly emptyEl: HTMLElement;
	private currentState: RepositoryViewModel | null = null;

	private readonly commitState: CommitRendererState = {
		expandedCommits: new Set(),
		fileCache: new Map(),
	};

	private readonly branchSummaryState: BranchSummaryState = {
		expandedBranches: new Set(),
		fileCache: new Map(),
	};

	private readonly workingCopyState: WorkingCopyState = {
		expandedStagedSection: true,
		expandedUnstagedSection: true,
		commitMessageValue: '',
	};

	constructor() {
		this.stackList = document.getElementById('stackList')!;
		this.errorEl = document.getElementById('error')!;
		this.emptyEl = document.getElementById('empty')!;

		this.setupEventListeners();
		this.vscode.postMessage({ type: 'ready' });
	}

	private setupEventListeners(): void {
		window.addEventListener('message', (event: MessageEvent) => {
			const message = event.data as ExtensionMessage;
			if (!message) return;

			if (message.type === 'state') {
				this.updateState(message.payload, message.force);
			} else if (message.type === 'commitFiles') {
				this.handleCommitFiles(message.sha, message.files);
			} else if (message.type === 'branchFiles') {
				this.handleBranchFiles(message.branchName, message.files);
			}
		});
	}

	/** Extracts the first repository from the display state (single-repo shim). */
	private extractRepo(state: DisplayState): RepositoryViewModel | undefined {
		return state.repositories[0];
	}

	private updateState(newState: DisplayState, force?: boolean): void {
		const repo = this.extractRepo(newState);
		if (!repo) return;
		if (!force && this.stateUnchanged(repo)) return;

		const oldBranches = this.currentState?.branches ?? [];
		this.currentState = repo;

		this.updateErrorDisplay(repo);
		this.updateGraphWidth(repo.branches);
		this.updateBranchItems(oldBranches, repo);
		this.updateUncommittedCard(repo);
	}

	private stateUnchanged(repo: RepositoryViewModel): boolean {
		try {
			return JSON.stringify(this.currentState) === JSON.stringify(repo);
		} catch {
			return false;
		}
	}

	private updateErrorDisplay(repo: RepositoryViewModel): void {
		this.errorEl.classList.toggle('hidden', !repo.error);
		this.errorEl.textContent = repo.error ?? '';
	}

	private updateGraphWidth(branches: BranchViewModel[]): void {
		const maxLane = branches.reduce((max, b) => Math.max(max, b.treeFragment.maxLane), 0);
		const width = LANE_WIDTH * (maxLane + 1) + NODE_RADIUS_CURRENT + NODE_STROKE;
		this.stackList.style.setProperty('--tree-graph-width', `${width}px`);
	}

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

	private getPostMessage(): PostMessage {
		const repoId = this.currentState?.id;
		return (message) => {
			const isGlobal = message.type === 'ready' || message.type === 'refresh';
			const enriched = isGlobal || !repoId ? message : { ...message, repoId };
			this.vscode.postMessage(enriched);
		};
	}

	private updateBranchItems(oldBranches: BranchViewModel[], repo: RepositoryViewModel): void {
		if (repo.branches.length === 0) {
			this.handleEmptyState(repo);
			return;
		}

		this.emptyEl.classList.add('hidden');
		this.reconcileBranches(oldBranches, repo.branches);
	}

	private handleEmptyState(repo: RepositoryViewModel): void {
		this.emptyEl.textContent = repo.error ?? 'No branches in the current stack.';
		this.emptyEl.classList.remove('hidden');
		this.animateOutAllItems();
	}

	private animateOutAllItems(): void {
		const items = this.stackList.querySelectorAll('.stack-item');
		items.forEach((item, index) => {
			(item as HTMLElement).style.animationDelay = `${index * ANIMATION_STAGGER_MS}ms`;
			animations.animateOut(item as HTMLElement, () => {});
		});

		setTimeout(() => {
			this.stackList.innerHTML = '';
		}, items.length * ANIMATION_STAGGER_MS + ANIMATION_DURATION_MS);
	}

	private reconcileBranches(oldBranches: BranchViewModel[], newBranches: BranchViewModel[]): void {
		const treeColors = this.getTreeColors();

		diffList(this.stackList, oldBranches, newBranches, {
			getKey: (branch) => branch.name,
			render: (branch) => this.renderBranchCard(branch),
			update: (card, branch) => this.updateBranchCard(card, branch),
			needsUpdate: (card, branch) => branchNeedsUpdate(card, branch),
			itemSelector: '.stack-item',
			itemClass: 'stack-item',
		}, animations, treeColors);
	}

	private renderBranchCard(branch: BranchViewModel): HTMLElement {
		return renderBranch(
			branch,
			this.getPostMessage(),
			(b, card) => this.createCommitsContainer(b, card),
			(name) => this.createSummaryContainer(name),
		);
	}

	private updateBranchCard(card: HTMLElement, branch: BranchViewModel): void {
		updateBranch(
			card,
			branch,
			this.getPostMessage(),
			(b, c) => this.createCommitsContainer(b, c),
			(name) => this.createSummaryContainer(name),
		);
	}

	private createCommitsContainer(branch: BranchViewModel, _card: HTMLElement): HTMLElement {
		return renderCommitsContainer(
			branch,
			this.commitState,
			this.getPostMessage(),
			animations,
			this.getTreeColors(),
		);
	}

	private createSummaryContainer(branchName: string): HTMLElement {
		return renderBranchSummary(branchName, this.branchSummaryState, this.getPostMessage());
	}

	private updateUncommittedCard(repo: RepositoryViewModel): void {
		this.stackList.querySelector('.uncommitted-item')?.remove();

		if (!repo.uncommitted || !repo.uncommittedTreeFragment) return;

		const newCard = renderUncommittedCard(
			repo.uncommitted,
			repo.uncommittedTreeFragment,
			this.getTreeColors(),
			this.workingCopyState,
			this.getPostMessage(),
		);

		const insertionPoint = this.findCurrentBranchElement(repo.branches);
		if (insertionPoint) {
			this.stackList.insertBefore(newCard, insertionPoint);
		} else {
			this.stackList.appendChild(newCard);
		}
	}

	private findCurrentBranchElement(branches: BranchViewModel[]): HTMLElement | null {
		const currentBranch = branches.find((b) => b.current);
		if (!currentBranch) return null;
		return this.stackList.querySelector(`.stack-item[data-key="${currentBranch.name}"]`);
	}

	private handleCommitFiles(sha: string, files: CommitFileChange[]): void {
		handleCommitFilesResponse(sha, files, this.stackList, this.commitState, this.getPostMessage());
	}

	private handleBranchFiles(branchName: string, files: CommitFileChange[]): void {
		handleBranchFilesResponse(branchName, files, this.stackList, this.branchSummaryState, this.getPostMessage());
	}
}

document.addEventListener('DOMContentLoaded', () => {
	new StackView();
});
