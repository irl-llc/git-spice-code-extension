/**
 * Git-Spice Stack View - Main Entry Point
 *
 * Orchestrates the webview UI by coordinating:
 * - State management and updates
 * - Branch/commit/working-copy rendering via extracted modules
 * - Animation and diffing via dedicated engines
 */

import type { BranchViewModel, CommitFileChange, DisplayState } from './types';
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
	private currentState: DisplayState | null = null;

	private readonly commitState: CommitRendererState = {
		expandedCommits: new Set(),
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
				this.updateState(message.payload);
			} else if (message.type === 'commitFiles') {
				this.handleCommitFiles(message.sha, message.files);
			}
		});
	}

	private updateState(newState: DisplayState): void {
		if (this.stateUnchanged(newState)) return;

		const oldBranches = this.currentState?.branches ?? [];
		this.currentState = newState;

		this.updateErrorDisplay(newState);
		this.updateGraphWidth(newState.branches);
		this.updateBranchItems(oldBranches, newState);
		this.updateUncommittedCard(newState);
	}

	private stateUnchanged(newState: DisplayState): boolean {
		try {
			return JSON.stringify(this.currentState) === JSON.stringify(newState);
		} catch {
			return false;
		}
	}

	private updateErrorDisplay(state: DisplayState): void {
		this.errorEl.classList.toggle('hidden', !state.error);
		this.errorEl.textContent = state.error ?? '';
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
		return (message) => this.vscode.postMessage(message);
	}

	private updateBranchItems(oldBranches: BranchViewModel[], state: DisplayState): void {
		const newBranches = state.branches;

		if (newBranches.length === 0) {
			this.handleEmptyState(state);
			return;
		}

		this.emptyEl.classList.add('hidden');
		this.reconcileBranches(oldBranches, newBranches);
	}

	private handleEmptyState(state: DisplayState): void {
		this.emptyEl.textContent = state.error ?? 'No branches in the current stack.';
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
		);
	}

	private updateBranchCard(card: HTMLElement, branch: BranchViewModel): void {
		updateBranch(
			card,
			branch,
			this.getPostMessage(),
			(b, c) => this.createCommitsContainer(b, c),
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

	private updateUncommittedCard(state: DisplayState): void {
		this.stackList.querySelector('.uncommitted-item')?.remove();

		const uncommitted = state.uncommitted;
		const treeFragment = state.uncommittedTreeFragment;
		if (!uncommitted || !treeFragment) return;

		const hasChanges = uncommitted.staged.length > 0 || uncommitted.unstaged.length > 0;
		if (!hasChanges) return;

		const newCard = renderUncommittedCard(
			uncommitted,
			treeFragment,
			this.getTreeColors(),
			this.workingCopyState,
			this.getPostMessage(),
		);

		const insertionPoint = this.findCurrentBranchElement(state.branches);
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
}

document.addEventListener('DOMContentLoaded', () => {
	new StackView();
});
