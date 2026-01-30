/**
 * Git-Spice Stack View
 *
 * Architecture:
 *
 * 1. STATE MANAGEMENT
 *    - Single source of truth: currentState
 *    - Immutable updates trigger diffing and rendering
 *    - State includes: error, branches (with commits, changes, etc.)
 *
 * 2. DIFFING ABSTRACTION
 *    - Generic diffList() function handles list animations
 *    - Works at any level: branches, commits, tags, etc.
 *    - Three operations: add (animate in), remove (animate out), update (flash)
 *    - Keyed reconciliation prevents unnecessary re-renders
 *
 * 3. RENDERING PIPELINE
 *    - updateState() → updateBranchItems() → diffList()
 *    - Each branch tracks its own data for change detection
 *    - Commits can be expanded/animated independently
 *    - All animations are CSS-based for performance
 *
 * 4. ANIMATION SYSTEM
 *    - animateIn(): Entrance animation (fade + slide)
 *    - animateOut(): Exit animation (fade + slide + collapse)
 *    - animateUpdate(): Flash animation to highlight changes
 *    - All durations are constants for easy tweaking
 *
 * 5. EXTENSIBILITY
 *    - Add new animatable elements by wrapping in diffList()
 *    - New animations: add CSS classes and update constants
 *    - New state fields: extend updateState() and render functions
 */

import type { BranchViewModel, CommitFileChange, DisplayState, UncommittedState, WorkingCopyChange } from './types';
import type { WebviewMessage, ExtensionMessage } from './webviewTypes';
import { buildBranchContext, buildCommitContext } from './contextBuilder';
import {
	LANE_WIDTH,
	NODE_RADIUS,
	NODE_RADIUS_CURRENT,
	NODE_STROKE,
	CURVE_RADIUS,
	NODE_GAP,
} from './tree/treeConstants';
import { createRoundedPath, buildSvgPaths, type PathData } from './tree/treePath';
import {
	createNodeCircle,
	createUncommittedNodeCircle,
	appendPaths,
	appendNodes,
	type TreeColors,
} from './tree/treeNodes';

/** Action button configuration for file rows. */
type FileRowAction = {
	icon: string;
	title: string;
	onClick: () => void;
};

interface BranchData {
	current: boolean;
	restack: boolean;
	commitsCount: number;
	hasChange: boolean;
	changeId?: string;
	changeStatus?: string;
	treeDepth: number;
	treeIsLastChild: boolean;
	treeAncestorIsLast: string;
	treeLane: number;
}

interface DiffListConfig<T> {
	getKey: (item: T) => string;
	render: (item: T) => HTMLElement;
	update?: (element: HTMLElement, item: T) => void;
	needsUpdate?: (element: HTMLElement, item: T) => boolean;
	itemSelector: string;
	itemClass: string;
}

class StackView {
	private readonly vscode = acquireVsCodeApi();
	private readonly stackList: HTMLElement;
	private readonly errorEl: HTMLElement;
	private readonly emptyEl: HTMLElement;
	private currentState: DisplayState | null = null;
	private fileCache: Map<string, CommitFileChange[]> = new Map();
	private expandedCommits: Set<string> = new Set();
	private expandedStagedSection = true;
	private expandedUnstagedSection = true;
	private commitMessageValue = '';
	private pendingTreeDraw: ReturnType<typeof setTimeout> | undefined;

	private static readonly COMMIT_CHUNK = 10;
	private static readonly ANIMATION_DURATION = 200;
	private static readonly FLASH_DURATION = 300;

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
			if (!message) {
				return;
			}
			if (message.type === 'state') {
				this.updateState(message.payload);
			} else if (message.type === 'commitFiles') {
				this.handleCommitFilesResponse(message.sha, message.files);
			}
		});
	}

	private updateState(newState: DisplayState): void {
		const oldState = this.currentState;

		// Avoid no-op updates: shallow compare serialized JSON (cheap for small states)
		try {
			const oldJson = JSON.stringify(oldState);
			const newJson = JSON.stringify(newState);
			if (oldJson === newJson) {
				return; // no visible changes, skip update
			}
		} catch (e) {
			// fallback to updating if serialization fails
		}

		this.currentState = newState;

		// Update error display
		this.errorEl.classList.toggle('hidden', !newState.error);
		this.errorEl.textContent = newState.error ?? '';

		// Render branches first so DOM elements exist for positioning
		this.updateBranchItems(oldState?.branches ?? [], newState.branches);

		// Position uncommitted card relative to the current branch
		this.updateUncommittedCard(newState.uncommitted, newState.branches);

		// Draw tree after entrance animations settle into final positions
		this.updateTreeConnections(newState.branches, /* waitForAnimations */ true);
	}

	/**
	 * Updates the uncommitted changes card, positioned above the current branch.
	 */
	private updateUncommittedCard(uncommitted: UncommittedState | undefined, branches: BranchViewModel[]): void {
		// Always remove first so re-insertion positions correctly after branch switches
		this.stackList.querySelector('.uncommitted-item')?.remove();

		const hasChanges = uncommitted && (uncommitted.staged.length > 0 || uncommitted.unstaged.length > 0);
		if (!hasChanges) return;

		const newCard = this.renderUncommittedCard(uncommitted);
		const insertionPoint = this.findCurrentBranchElement(branches);

		if (insertionPoint) {
			this.stackList.insertBefore(newCard, insertionPoint);
		} else {
			this.stackList.appendChild(newCard);
		}
	}

	/** Finds the DOM element for the current branch. */
	private findCurrentBranchElement(branches: BranchViewModel[]): HTMLElement | null {
		const currentBranch = branches.find((b) => b.current);
		if (!currentBranch) {
			return null;
		}
		return this.stackList.querySelector(`.stack-item[data-key="${currentBranch.name}"]`);
	}

	/**
	 * Generic differ for lists with animations
	 */
	private diffList<T>(container: HTMLElement, _oldItems: T[], newItems: T[], config: DiffListConfig<T>): void {
		const { getKey, render, update, needsUpdate, itemSelector, itemClass } = config;

		// Build map of existing elements
		const existingElements = new Map<string, HTMLElement>();
		container.querySelectorAll(itemSelector).forEach((el) => {
			const key = (el as HTMLElement).dataset.key;
			if (key) {
				existingElements.set(key, el as HTMLElement);
			}
		});

		const newKeys = new Set(newItems.map(getKey));

		// Remove items that no longer exist
		for (const [key, element] of existingElements) {
			if (!newKeys.has(key)) {
				this.animateOut(element, () => {
					if (element.parentNode === container) {
						container.removeChild(element);
					}
				});
				existingElements.delete(key);
			}
		}

		// Add or update items
		let previousElement: HTMLElement | null = null;
		for (const item of newItems) {
			const key = getKey(item);
			const existingElement = existingElements.get(key);

			if (existingElement) {
				// Update existing item if needed
				if (needsUpdate && update) {
					const child = existingElement.querySelector('[data-content]') as HTMLElement;
					if (child && needsUpdate(child, item)) {
						const newChild = render(item);
						// Don't animate here - let the update function handle specific animations
						child.replaceWith(newChild);

						// Update the wrapper's dataset.branch if it changed
						if (newChild.dataset.branch) {
							existingElement.dataset.branch = newChild.dataset.branch;
						}
					}
				}

				// Reorder if necessary
				const nextElement: ChildNode | null = previousElement ? previousElement.nextSibling : container.firstChild;
				if (existingElement !== nextElement) {
					container.insertBefore(existingElement, nextElement);
				}
				previousElement = existingElement;
			} else {
				// Add new item
				const wrapper = document.createElement('li');
				wrapper.className = itemClass;
				wrapper.dataset.key = key;

				const child = render(item);
				wrapper.appendChild(child);

				// Copy branch name to wrapper for tree graph positioning
				if (child.dataset.branch) {
					wrapper.dataset.branch = child.dataset.branch;
				}

				const nextElement: ChildNode | null = previousElement ? previousElement.nextSibling : container.firstChild;
				container.insertBefore(wrapper, nextElement);

				this.animateIn(wrapper);
				previousElement = wrapper;
			}
		}
	}

	/**
	 * Animate element entrance
	 */
	private animateIn(element: HTMLElement): void {
		element.classList.add('item-enter');
		requestAnimationFrame(() => {
			element.classList.remove('item-enter');
		});
	}

	/**
	 * Animate element exit
	 */
	private animateOut(element: HTMLElement, onComplete: () => void): void {
		element.classList.add('item-exit');
		setTimeout(onComplete, StackView.ANIMATION_DURATION);
	}

	/**
	 * Animate element update (flash)
	 */
	private animateUpdate(element: HTMLElement): void {
		// Prevent overlapping animations by removing existing animation class first
		element.classList.remove('item-updated');

		// Use requestAnimationFrame to ensure the class removal takes effect
		requestAnimationFrame(() => {
			element.classList.add('item-updated');
			setTimeout(() => {
				element.classList.remove('item-updated');
			}, StackView.FLASH_DURATION);
		});
	}

	/** Renders/updates branch DOM elements without drawing the tree. */
	private updateBranchItems(oldBranches: BranchViewModel[], newBranches: BranchViewModel[]): void {
		if (newBranches.length === 0) {
			this.emptyEl.textContent = this.currentState?.error ?? 'No branches in the current stack.';
			this.emptyEl.classList.remove('hidden');

			// Fade out all existing items
			const items = this.stackList.querySelectorAll('.stack-item');
			items.forEach((item, index) => {
				(item as HTMLElement).style.animationDelay = `${index * 30}ms`;
				this.animateOut(item as HTMLElement, () => {});
			});
			setTimeout(
				() => {
					this.stackList.innerHTML = '';
				},
				items.length * 30 + StackView.ANIMATION_DURATION,
			);
			return;
		}

		this.emptyEl.classList.add('hidden');

		// Post-order traversal already gives correct top-to-bottom order (no reverse needed)
		this.diffList(this.stackList, oldBranches, newBranches, {
			getKey: (branch) => branch.name,
			render: (branch) => this.renderBranch(branch),
			update: (card, branch) => {
				this.updateBranch(card, branch);
			},
			needsUpdate: (card, branch) => this.branchNeedsUpdate(card, branch),
			itemSelector: '.stack-item',
			itemClass: 'stack-item',
		});
	}

	// Match VSCode's scmHistory.ts dimensions

	/**
	 * Redraws the tree using the current state.
	 */
	private redrawTree(): void {
		if (this.currentState?.branches) {
			this.updateTreeConnections(this.currentState.branches);
		}
	}

	/**
	 * Draws the complete tree graph in SVG (both paths and nodes).
	 * Uses lane assignments to create a multi-column graph showing branch divergence.
	 */
	private updateTreeConnections(branches: BranchViewModel[], waitForAnimations = false): void {
		const hasUncommitted = !!this.stackList.querySelector('.uncommitted-item');
		const branchMaxLane = this.computeMaxLane(branches);
		// Only fork to a new lane if the current branch has children (divergence)
		const needsDivergenceLane = hasUncommitted && !this.currentBranchIsStackTip(branches);
		const maxLane = needsDivergenceLane ? branchMaxLane + 1 : branchMaxLane;
		this.updateGraphWidth(maxLane);
		this.removeOldDomTreeNodes();
		this.scheduleTreeDraw(branches, waitForAnimations);
	}

	/** Schedules the SVG tree draw, cancelling any pending draw first. */
	private scheduleTreeDraw(branches: BranchViewModel[], waitForAnimations: boolean): void {
		if (this.pendingTreeDraw !== undefined) {
			clearTimeout(this.pendingTreeDraw);
		}
		// Wait for entrance animations (200ms) before measuring positions,
		// or draw immediately (setTimeout 0) for redraws with no new animations.
		const delay = waitForAnimations ? StackView.ANIMATION_DURATION : 0;
		this.pendingTreeDraw = setTimeout(() => {
			requestAnimationFrame(() => this.drawTreeSvg(branches));
		}, delay);
	}

	private computeMaxLane(branches: BranchViewModel[]): number {
		return branches.reduce((max, b) => Math.max(max, b.tree.lane), 0);
	}

	/** Whether the current branch has children — if not, it's the stack tip. */
	private currentBranchIsStackTip(branches: BranchViewModel[]): boolean {
		const current = branches.find((b) => b.current);
		if (!current) return true;
		return !branches.some((b) => b.tree.parentName === current.name);
	}

	private updateGraphWidth(maxLane: number): void {
		// VSCode: width accommodates all lanes plus padding
		const width = LANE_WIDTH * (maxLane + 1) + NODE_RADIUS;
		this.stackList.style.setProperty('--tree-graph-width', `${width}px`);
	}

	/**
	 * Get X position for a lane. VSCode uses: SWIMLANE_WIDTH * (index + 1)
	 * This centers nodes within their lane column.
	 */
	private getLaneX(lane: number): number {
		return LANE_WIDTH * (lane + 1);
	}

	/** Removes legacy DOM-based tree nodes (now drawn in SVG). */
	private removeOldDomTreeNodes(): void {
		this.stackList.querySelectorAll('.tree-node').forEach((node) => node.remove());
	}

	private drawTreeSvg(branches: BranchViewModel[]): void {
		this.removeExistingSvg();

		const branchMap = new Map(branches.map((b) => [b.name, b]));
		const nodePositions = this.collectNodePositions(branches);

		if (nodePositions.size === 0) return;

		const paths = buildSvgPaths(branches, branchMap, nodePositions);
		const svg = this.createTreeSvgElement(branches, nodePositions, paths);
		this.stackList.insertBefore(svg, this.stackList.firstChild);
	}

	private removeExistingSvg(): void {
		const existingSvg = this.stackList.querySelector('.tree-svg');
		if (existingSvg) existingSvg.remove();
	}

	/**
	 * Collects node positions by finding the branch name element.
	 * This ensures nodes align precisely with the branch name text.
	 */
	private collectNodePositions(branches: BranchViewModel[]): Map<string, { x: number; y: number }> {
		const positions = new Map<string, { x: number; y: number }>();
		const listRect = this.stackList.getBoundingClientRect();
		const branchLanes = new Map(branches.map((b) => [b.name, b.tree.lane]));

		// Tip of stack: same lane as current branch; otherwise fork to a new lane
		const currentBranch = branches.find((b) => b.current);
		const isTip = this.currentBranchIsStackTip(branches);
		const uncommittedLane = isTip ? (currentBranch?.tree.lane ?? 0) : this.computeMaxLane(branches) + 1;

		this.stackList.querySelectorAll('.stack-item').forEach((item) => {
			const wrapper = item as HTMLElement;
			const branchName = wrapper.dataset.branch;
			if (!branchName) return;

			const isUncommitted = branchName === '__uncommitted__';
			const lane = isUncommitted ? uncommittedLane : branchLanes.get(branchName);
			if (lane === undefined) return;

			// Find the branch name span for precise Y alignment
			const nameEl = wrapper.querySelector('.branch-name');
			const headerEl = wrapper.querySelector('.branch-header');
			const targetEl = nameEl ?? headerEl ?? wrapper;
			const targetRect = targetEl.getBoundingClientRect();
			const y = targetRect.top + targetRect.height / 2 - listRect.top;
			const x = this.getLaneX(lane);

			positions.set(branchName, { x, y });
		});

		return positions;
	}

	private createTreeSvgElement(
		branches: BranchViewModel[],
		nodePositions: Map<string, { x: number; y: number }>,
		paths: Array<{ d: string; restack: boolean; uncommitted?: boolean }>,
	): SVGSVGElement {
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.classList.add('tree-svg');

		const colors = this.getTreeColors();

		// Draw paths first (behind nodes)
		appendPaths(svg, paths, colors);

		// Draw nodes on top
		appendNodes(svg, branches, nodePositions, colors);

		this.setSvgDimensions(svg, nodePositions);
		return svg;
	}

	private getTreeColors(): { line: string; restack: string; node: string; nodeCurrent: string; bg: string } {
		const styles = getComputedStyle(document.documentElement);
		return {
			line: styles.getPropertyValue('--tree-line-color').trim() || '#888888',
			restack: styles.getPropertyValue('--tree-line-restack-color').trim() || '#cca700',
			node: styles.getPropertyValue('--tree-node-color').trim() || '#888888',
			nodeCurrent: styles.getPropertyValue('--tree-node-current-color').trim() || '#3794ff',
			bg: styles.getPropertyValue('--vscode-editor-background').trim() || '#1e1e1e',
		};
	}

	private setSvgDimensions(svg: SVGSVGElement, nodePositions: Map<string, { x: number; y: number }>): void {
		const maxY = this.computeSvgHeight(nodePositions);
		const maxX = this.computeSvgWidth(nodePositions);
		svg.setAttribute('width', String(maxX));
		svg.setAttribute('height', String(maxY));
		svg.style.width = `${maxX}px`;
		svg.style.height = `${maxY}px`;
	}

	private computeSvgWidth(nodePositions: Map<string, { x: number; y: number }>): number {
		let maxX = 0;
		for (const { x } of nodePositions.values()) {
			maxX = Math.max(maxX, x);
		}
		return maxX + NODE_RADIUS;
	}

	private computeSvgHeight(nodePositions: Map<string, { x: number; y: number }>): number {
		let maxY = 0;
		nodePositions.forEach(({ y }) => {
			if (y > maxY) maxY = y;
		});
		return maxY + NODE_RADIUS * 2;
	}

	private renderBranch(branch: BranchViewModel): HTMLElement {
		const card = document.createElement('article');
		card.className = 'branch-card';
		card.dataset.content = 'true';
		card.dataset.branch = branch.name;
		card.dataset.depth = String(branch.tree.depth);
		if (branch.tree.parentName) {
			card.dataset.parentBranch = branch.tree.parentName;
		}

		// Add VSCode native context menu support
		card.dataset.vscodeContext = buildBranchContext(branch);

		if (branch.current) {
			card.classList.add('is-current');
		}
		if (branch.restack) {
			card.classList.add('needs-restack');
		}

		// Store branch data for diffing
		(card as any)._branchData = {
			current: branch.current,
			restack: branch.restack,
			commitsCount: branch.commits?.length ?? 0,
			hasChange: Boolean(branch.change),
			changeId: branch.change?.id,
			changeStatus: branch.change?.status,
			treeDepth: branch.tree.depth,
			treeIsLastChild: branch.tree.isLastChild,
			treeAncestorIsLast: JSON.stringify(branch.tree.ancestorIsLast),
			treeLane: branch.tree.lane,
		} as BranchData;

		// Tree connectors (left column)
		const connectors = this.renderTreeConnectors(branch);
		card.appendChild(connectors);

		// Content wrapper (right column)
		const content = document.createElement('div');
		content.className = 'branch-content';

		const header = this.renderBranchHeader(branch, card);
		content.appendChild(header);

		if (branch.change?.status) {
			const meta = this.renderBranchMeta(branch);
			content.appendChild(meta);
		}

		if (branch.commits && branch.commits.length > 0) {
			const commitsContainer = this.renderCommitsContainer(branch, card);
			content.appendChild(commitsContainer);
		}

		card.appendChild(content);

		return card;
	}

	/**
	 * Renders tree connector lines based on branch position in hierarchy.
	 */
	private renderTreeConnectors(branch: BranchViewModel): HTMLElement {
		const container = document.createElement('div');
		container.className = 'tree-connectors';

		const { depth, isLastChild, ancestorIsLast } = branch.tree;

		// Render pass-through lines for each ancestor level
		for (let i = 0; i < depth; i++) {
			const segment = document.createElement('div');
			segment.className = 'tree-segment';

			// Draw vertical line if ancestor at this level has more siblings below
			const isAncestorLast = ancestorIsLast[i] ?? false;
			if (!isAncestorLast) {
				segment.classList.add('has-line');
			}

			container.appendChild(segment);
		}

		// Render connector segment to this node (if not root)
		if (depth > 0) {
			const connector = document.createElement('div');
			connector.className = 'tree-segment connector has-line';

			if (isLastChild) {
				connector.classList.add('last-child');
			}

			container.appendChild(connector);
		}

		// Branch node dot
		const dot = document.createElement('div');
		dot.className = 'tree-node';
		if (branch.current) {
			dot.classList.add('current');
		}
		container.appendChild(dot);

		return container;
	}

	private updateBranch(card: HTMLElement, branch: BranchViewModel): void {
		const oldData = (card as any)._branchData as BranchData;

		// Update classes
		card.classList.toggle('is-current', Boolean(branch.current));
		card.classList.toggle('needs-restack', Boolean(branch.restack));

		// Update VSCode context menu data
		card.dataset.vscodeContext = buildBranchContext(branch);

		// Update data attributes for tree position
		card.dataset.depth = String(branch.tree.depth);
		if (branch.tree.parentName) {
			card.dataset.parentBranch = branch.tree.parentName;
		} else {
			delete card.dataset.parentBranch;
		}

		// Update stored data
		(card as any)._branchData = {
			current: branch.current,
			restack: branch.restack,
			commitsCount: branch.commits?.length ?? 0,
			hasChange: Boolean(branch.change),
			changeId: branch.change?.id,
			changeStatus: branch.change?.status,
			treeDepth: branch.tree.depth,
			treeIsLastChild: branch.tree.isLastChild,
			treeAncestorIsLast: JSON.stringify(branch.tree.ancestorIsLast),
			treeLane: branch.tree.lane,
		} as BranchData;

		// Granular updates with targeted animations
		if (oldData) {
			// Flash current branch indicator if it changed TO current (not FROM current)
			if (!oldData.current && Boolean(branch.current)) {
				const currentIcon = card.querySelector('.current-branch-icon');
				if (currentIcon) {
					this.animateUpdate(currentIcon as HTMLElement);
				}
			}

			// Flash restack tag if it changed
			if (oldData.restack !== Boolean(branch.restack)) {
				const restackTag = card.querySelector('.tag-warning');
				if (restackTag) {
					this.animateUpdate(restackTag as HTMLElement);
				}
			}

			// Flash PR link if it changed
			if (oldData.hasChange !== Boolean(branch.change) || oldData.changeId !== branch.change?.id) {
				const prLink = card.querySelector('.branch-pr-link');
				if (prLink) {
					this.animateUpdate(prLink as HTMLElement);
				}
			}

			// Flash meta status if it changed
			if (oldData.changeStatus !== branch.change?.status) {
				const metaStatus = card.querySelector('.branch-meta span');
				if (metaStatus) {
					this.animateUpdate(metaStatus as HTMLElement);
				}
			}
		}

		// Update header (tags, etc.) - only if needed
		const header = card.querySelector('.branch-header');
		if (header) {
			const newHeader = this.renderBranchHeader(branch, card);
			header.replaceWith(newHeader);
		}

		// Update meta
		const existingMeta = card.querySelector('.branch-meta');
		if (branch.change?.status) {
			const newMeta = this.renderBranchMeta(branch);
			if (existingMeta) {
				existingMeta.replaceWith(newMeta);
			} else {
				const insertBefore = card.querySelector('.branch-commits');
				if (insertBefore) {
					card.insertBefore(newMeta, insertBefore);
				} else {
					card.appendChild(newMeta);
				}
			}
		} else if (existingMeta) {
			existingMeta.remove();
		}

		// Update commits with animation
		const existingCommits = card.querySelector('.branch-commits');
		if (branch.commits && branch.commits.length > 0) {
			const newCommitsContainer = this.renderCommitsContainer(branch, card);
			if (existingCommits) {
				existingCommits.replaceWith(newCommitsContainer);
			} else {
				card.appendChild(newCommitsContainer);
			}
		} else if (existingCommits) {
			existingCommits.remove();
		}
	}

	private branchNeedsUpdate(card: HTMLElement, branch: BranchViewModel): boolean {
		const oldData = (card as any)._branchData as BranchData;
		if (!oldData) return true;

		const newTreeAncestorIsLast = JSON.stringify(branch.tree.ancestorIsLast);

		return (
			oldData.current !== Boolean(branch.current) ||
			oldData.restack !== Boolean(branch.restack) ||
			oldData.commitsCount !== (branch.commits?.length ?? 0) ||
			oldData.hasChange !== Boolean(branch.change) ||
			oldData.changeId !== branch.change?.id ||
			oldData.changeStatus !== branch.change?.status ||
			oldData.treeDepth !== branch.tree.depth ||
			oldData.treeIsLastChild !== branch.tree.isLastChild ||
			oldData.treeAncestorIsLast !== newTreeAncestorIsLast ||
			oldData.treeLane !== branch.tree.lane
		);
	}

	private renderBranchHeader(branch: BranchViewModel, card: HTMLElement): HTMLElement {
		const header = document.createElement('div');
		header.className = 'branch-header';

		const hasCommits = branch.commits && branch.commits.length > 0;

		if (hasCommits) {
			const toggle = document.createElement('i');
			toggle.className = 'branch-toggle codicon codicon-chevron-right';
			toggle.role = 'button';
			toggle.tabIndex = 0;
			const expandedByDefault = branch.current === true;
			if (expandedByDefault) {
				card.classList.add('expanded');
				toggle.classList.add('expanded');
			}
			header.appendChild(toggle);

			header.style.cursor = 'pointer';
			header.addEventListener('click', (event: Event) => {
				if ((event.target as HTMLElement).closest('.branch-pr-link')) {
					return;
				}
				card.classList.toggle('expanded');
				toggle.classList.toggle('expanded');
				// Redraw tree after CSS transition completes (200ms)
				setTimeout(() => {
					this.redrawTree();
				}, StackView.ANIMATION_DURATION);
			});
		} else {
			const spacer = document.createElement('span');
			spacer.className = 'branch-toggle-spacer';
			header.appendChild(spacer);
		}

		const nameSpan = document.createElement('span');
		nameSpan.className = 'branch-name';
		nameSpan.textContent = branch.name;
		header.appendChild(nameSpan);

		const tags = document.createElement('div');
		tags.className = 'branch-tags';

		if (branch.restack) {
			tags.appendChild(this.createTag('Restack', 'warning'));
		}

		// Submit button (submits this branch and ancestors)
		const submitBtn = document.createElement('button');
		submitBtn.type = 'button';
		submitBtn.className = 'branch-submit-btn';
		submitBtn.title = branch.change ? 'Submit branch and ancestors' : 'Create PR for branch and ancestors';
		submitBtn.innerHTML = '<i class="codicon codicon-cloud-upload"></i>';
		submitBtn.addEventListener('click', (event: Event) => {
			event.stopPropagation();
			this.vscode.postMessage({ type: 'branchSubmit', branchName: branch.name });
		});
		tags.appendChild(submitBtn);

		if (branch.change) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'branch-pr-link';
			button.textContent = branch.change.id;
			if (branch.change.url) {
				button.addEventListener('click', (event: Event) => {
					event.stopPropagation();
					this.vscode.postMessage({ type: 'openChange', url: branch.change?.url! });
				});
			} else {
				button.disabled = true;
			}
			tags.appendChild(button);
		}

		header.appendChild(tags);
		return header;
	}

	private renderBranchMeta(branch: BranchViewModel): HTMLElement {
		const meta = document.createElement('div');
		meta.className = 'branch-meta';
		const status = document.createElement('span');
		status.textContent = branch.change!.status!;
		meta.appendChild(status);
		return meta;
	}

	private renderCommitsContainer(branch: BranchViewModel, _card: HTMLElement): HTMLElement {
		const container = document.createElement('div');
		container.className = 'branch-commits';
		container.dataset.commitsContainer = 'true';

		// Store initial visible count
		const initialCount = Math.min(branch.commits!.length, StackView.COMMIT_CHUNK);
		this.renderCommitsIntoContainer(container, branch.commits!, initialCount, branch.name);

		return container;
	}

	private renderCommitsIntoContainer(
		container: HTMLElement,
		commits: BranchViewModel['commits'],
		visibleCount: number,
		branchName: string,
	): void {
		if (!commits) return;

		const newCommits = commits.slice(0, visibleCount);

		// Use diffList to reconcile commits inside the container
		this.diffList(
			container,
			Array.from(container.querySelectorAll('.commit-wrapper'))
				.map((el) => {
					const key = (el as HTMLElement).dataset.key;
					return key ? { sha: key, shortSha: '', subject: '' } : null;
				})
				.filter((item): item is NonNullable<BranchViewModel['commits']>[0] => item !== null),
			newCommits,
			{
				getKey: (c) => c.sha,
				render: (c) => {
					const wrapper = document.createElement('div');
					wrapper.className = 'commit-wrapper';
					wrapper.dataset.key = c.sha;
					const row = this.renderCommitItem(c, branchName);
					wrapper.appendChild(row);
					return wrapper;
				},
				needsUpdate: (el, c) => {
					const row = el.querySelector('.commit-item');
					if (!row) return true;
					// simple check: subject or shortSha changed
					const subjectEl = row.querySelector('.commit-subject');
					const shaEl = row.querySelector('.commit-sha');
					return subjectEl?.textContent !== c.subject || shaEl?.textContent !== c.shortSha;
				},
				update: (el, c) => {
					const newRow = this.renderCommitItem(c, branchName);
					const oldRow = el.querySelector('.commit-item');
					if (oldRow) {
						// Check what specifically changed and flash only that part
						const oldSubject = oldRow.querySelector('.commit-subject')?.textContent;
						const oldSha = oldRow.querySelector('.commit-sha')?.textContent;

						oldRow.replaceWith(newRow);

						// Flash changed elements
						if (oldSubject !== c.subject) {
							const newSubject = newRow.querySelector('.commit-subject');
							if (newSubject) this.animateUpdate(newSubject as HTMLElement);
						}
						if (oldSha !== c.shortSha) {
							const newSha = newRow.querySelector('.commit-sha');
							if (newSha) this.animateUpdate(newSha as HTMLElement);
						}
					}
				},
				itemSelector: '.commit-wrapper',
				itemClass: 'commit-wrapper',
			},
		);

		// Add "show more" button if needed (ensure it's after the commits)
		const existingMore = container.querySelector('.branch-more');
		if (existingMore) existingMore.remove();
		if (visibleCount < commits.length) {
			const remaining = commits.length - visibleCount;
			const more = document.createElement('button');
			more.type = 'button';
			more.className = 'branch-more';
			more.textContent =
				remaining > StackView.COMMIT_CHUNK ? `Show more (${remaining})` : `Show remaining ${remaining}`;
			more.addEventListener('click', (event: Event) => {
				event.stopPropagation();
				this.renderCommitsIntoContainer(container, commits, visibleCount + StackView.COMMIT_CHUNK, branchName);
			});
			container.appendChild(more);
		}
	}

	private renderCommitItem(commit: NonNullable<BranchViewModel['commits']>[0], branchName?: string): HTMLElement {
		const container = document.createElement('div');
		container.className = 'commit-container';
		container.dataset.sha = commit.sha;

		const row = document.createElement('div');
		row.className = 'commit-item';
		row.dataset.content = 'true';

		// Add VSCode native context menu support
		if (branchName) {
			row.dataset.vscodeContext = buildCommitContext(commit.sha, branchName);
		}

		// Toggle chevron for file list
		const toggle = document.createElement('i');
		const isExpanded = this.expandedCommits.has(commit.sha);
		toggle.className = `commit-toggle codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`;
		toggle.role = 'button';
		toggle.tabIndex = 0;
		toggle.addEventListener('click', (event: Event) => {
			event.stopPropagation();
			this.toggleCommitExpand(commit.sha, container);
		});
		row.appendChild(toggle);

		const subject = document.createElement('span');
		subject.className = 'commit-subject';
		subject.textContent = commit.subject;
		row.appendChild(subject);

		const sha = document.createElement('span');
		sha.className = 'commit-sha';
		sha.textContent = commit.shortSha;
		row.appendChild(sha);

		// Click on commit row (not toggle) opens the full diff
		row.addEventListener('click', (event: Event) => {
			event.stopPropagation();
			const target = event.target as HTMLElement;
			if (target.classList.contains('commit-toggle')) {
				return;
			}
			if (typeof commit.sha !== 'string' || commit.sha.length === 0) {
				console.error('❌ Invalid commit SHA provided for diff request:', commit);
				return;
			}
			this.vscode.postMessage({ type: 'openCommitDiff', sha: commit.sha });
		});

		container.appendChild(row);

		// File list container (hidden by default unless expanded)
		const fileList = document.createElement('div');
		fileList.className = 'commit-files';
		if (!isExpanded) {
			fileList.classList.add('hidden');
		}

		// If we have cached files and it's expanded, render them
		if (isExpanded && this.fileCache.has(commit.sha)) {
			this.renderFileChanges(fileList, this.fileCache.get(commit.sha)!, commit.sha);
		}

		container.appendChild(fileList);

		return container;
	}

	/**
	 * Toggles expansion of a commit's file list.
	 */
	private toggleCommitExpand(sha: string, container: HTMLElement): void {
		const isExpanded = this.expandedCommits.has(sha);
		const toggle = container.querySelector('.commit-toggle') as HTMLElement;
		const fileList = container.querySelector('.commit-files') as HTMLElement;

		if (isExpanded) {
			this.expandedCommits.delete(sha);
			toggle.classList.remove('codicon-chevron-down');
			toggle.classList.add('codicon-chevron-right');
			fileList.classList.add('hidden');
		} else {
			this.expandedCommits.add(sha);
			toggle.classList.remove('codicon-chevron-right');
			toggle.classList.add('codicon-chevron-down');
			fileList.classList.remove('hidden');

			// Fetch files if not cached
			if (!this.fileCache.has(sha)) {
				fileList.innerHTML = '<div class="commit-files-loading">Loading...</div>';
				this.vscode.postMessage({ type: 'getCommitFiles', sha });
			} else {
				this.renderFileChanges(fileList, this.fileCache.get(sha)!, sha);
			}
		}

		// Redraw tree after DOM update
		requestAnimationFrame(() => this.redrawTree());
	}

	/**
	 * Handles the response containing file changes for a commit.
	 */
	private handleCommitFilesResponse(sha: string, files: CommitFileChange[]): void {
		this.fileCache.set(sha, files);

		// Find the container for this commit and render the files
		const container = this.stackList.querySelector(`.commit-container[data-sha="${sha}"]`);
		if (!container) {
			return;
		}

		const fileList = container.querySelector('.commit-files') as HTMLElement;
		if (fileList && this.expandedCommits.has(sha)) {
			this.renderFileChanges(fileList, files, sha);
			// Redraw tree after files are rendered
			requestAnimationFrame(() => this.redrawTree());
		}
	}

	/**
	 * Renders the file changes list for a commit.
	 */
	private renderFileChanges(container: HTMLElement, files: CommitFileChange[], sha: string): void {
		container.innerHTML = '';

		if (files.length === 0) {
			container.innerHTML = '<div class="commit-files-empty">No files changed</div>';
			return;
		}

		for (const file of files) {
			const row = this.renderFileChangeRow(file, sha);
			container.appendChild(row);
		}
	}

	/** Creates a file-change row with icon, name, and folder. */
	private createFileRow(path: string): HTMLDivElement {
		const row = document.createElement('div');
		row.className = 'file-change';
		this.appendFileIdentity(row, path);
		return row;
	}

	/** Appends file icon, name, and folder path to a row. */
	private appendFileIdentity(row: HTMLElement, path: string): void {
		const icon = document.createElement('i');
		icon.className = 'file-icon codicon codicon-file';
		row.appendChild(icon);

		const lastSlash = path.lastIndexOf('/');
		const fileName = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
		const folderPath = lastSlash >= 0 ? path.slice(0, lastSlash) : '';

		const nameSpan = document.createElement('span');
		nameSpan.className = 'file-name';
		nameSpan.textContent = fileName;
		row.appendChild(nameSpan);

		const folderSpan = document.createElement('span');
		folderSpan.className = 'file-folder';
		folderSpan.textContent = folderPath;
		row.appendChild(folderSpan);
	}

	/** Appends a file status badge (e.g., M, A, D, U). */
	private appendFileStatus(row: HTMLElement, status: string): void {
		const span = document.createElement('span');
		span.className = `file-status status-${status.toLowerCase()}`;
		span.textContent = status;
		row.appendChild(span);
	}

	/** Renders a single commit file change row. */
	private renderFileChangeRow(file: CommitFileChange, sha: string): HTMLElement {
		const row = this.createFileRow(file.path);

		if (file.status !== 'D') {
			const openBtn = this.createFileActionButton('codicon-go-to-file', 'Open current file', () => {
				this.vscode.postMessage({ type: 'openCurrentFile', path: file.path });
			});
			row.appendChild(openBtn);
		}

		this.appendFileStatus(row, file.status);
		row.addEventListener('click', (e) => this.handleCommitFileClick(e, sha, file.path));
		return row;
	}

	private handleCommitFileClick(event: Event, sha: string, path: string): void {
		if ((event.target as HTMLElement).closest('button')) return;
		event.stopPropagation();
		this.vscode.postMessage({ type: 'openFileDiff', sha, path });
	}

	private createTag(label: string, variant: string): HTMLElement {
		const span = document.createElement('span');
		span.className = 'tag' + (variant ? ' tag-' + variant : '');
		span.textContent = label;
		return span;
	}

	/** Renders the uncommitted changes card wrapper. */
	private renderUncommittedCard(uncommitted: UncommittedState): HTMLElement {
		const wrapper = document.createElement('li');
		wrapper.className = 'stack-item uncommitted-item';
		wrapper.dataset.branch = '__uncommitted__';

		const node = document.createElement('div');
		node.className = 'tree-node uncommitted';
		wrapper.appendChild(node);

		const card = document.createElement('article');
		card.className = 'branch-card uncommitted expanded';
		card.appendChild(this.renderUncommittedContent(uncommitted));
		wrapper.appendChild(card);

		return wrapper;
	}

	/** Renders the inner content of the uncommitted card. */
	private renderUncommittedContent(uncommitted: UncommittedState): HTMLElement {
		const content = document.createElement('div');
		content.className = 'branch-content';
		content.appendChild(this.renderUncommittedHeader());
		content.appendChild(this.renderChangesSections(uncommitted));
		content.appendChild(this.renderCommitForm());
		return content;
	}

	/** Renders staged and unstaged sections container. */
	private renderChangesSections(uncommitted: UncommittedState): HTMLElement {
		const container = document.createElement('div');
		container.className = 'uncommitted-sections';

		if (uncommitted.staged.length > 0) {
			container.appendChild(
				this.renderChangesSection('Staged Changes', uncommitted.staged, this.expandedStagedSection, true),
			);
		}
		if (uncommitted.unstaged.length > 0) {
			container.appendChild(
				this.renderChangesSection('Changes', uncommitted.unstaged, this.expandedUnstagedSection, false),
			);
		}

		return container;
	}

	private renderUncommittedHeader(): HTMLElement {
		const header = document.createElement('div');
		header.className = 'branch-header';

		const spacer = document.createElement('span');
		spacer.className = 'branch-toggle-spacer';
		header.appendChild(spacer);

		const nameSpan = document.createElement('span');
		nameSpan.className = 'branch-name';
		nameSpan.textContent = 'Uncommitted Changes';
		header.appendChild(nameSpan);

		const tags = document.createElement('div');
		tags.className = 'branch-tags';
		header.appendChild(tags);

		return header;
	}

	/** Renders a collapsible section for staged or unstaged changes. */
	private renderChangesSection(
		title: string,
		files: WorkingCopyChange[],
		expanded: boolean,
		isStaged: boolean,
	): HTMLElement {
		const section = document.createElement('div');
		section.className = 'changes-section';

		const fileList = this.renderFileList(files, isStaged, expanded);
		const header = this.renderChangesSectionHeader(title, files.length, fileList, isStaged);

		section.appendChild(header);
		section.appendChild(fileList);
		return section;
	}

	private renderChangesSectionHeader(
		title: string,
		count: number,
		fileList: HTMLElement,
		isStaged: boolean,
	): HTMLElement {
		const header = document.createElement('div');
		header.className = 'changes-section-header';

		const toggle = document.createElement('i');
		toggle.className = `codicon codicon-chevron-${fileList.classList.contains('hidden') ? 'right' : 'down'}`;
		header.appendChild(toggle);

		const titleSpan = document.createElement('span');
		titleSpan.textContent = `${title} (${count})`;
		header.appendChild(titleSpan);

		header.addEventListener('click', () => this.toggleChangesSection(toggle, fileList, isStaged));
		return header;
	}

	private toggleChangesSection(toggle: HTMLElement, fileList: HTMLElement, isStaged: boolean): void {
		const isExpanded = toggle.classList.contains('codicon-chevron-down');
		toggle.classList.toggle('codicon-chevron-down', !isExpanded);
		toggle.classList.toggle('codicon-chevron-right', isExpanded);
		fileList.classList.toggle('hidden', isExpanded);

		if (isStaged) {
			this.expandedStagedSection = !isExpanded;
		} else {
			this.expandedUnstagedSection = !isExpanded;
		}
	}

	private renderFileList(files: WorkingCopyChange[], isStaged: boolean, expanded: boolean): HTMLElement {
		const fileList = document.createElement('div');
		fileList.className = 'commit-files' + (expanded ? '' : ' hidden');

		for (const file of files) {
			fileList.appendChild(this.renderWorkingCopyFileRow(file, isStaged));
		}
		return fileList;
	}

	/** Renders a file row for working copy changes with appropriate actions. */
	private renderWorkingCopyFileRow(file: WorkingCopyChange, isStaged: boolean): HTMLElement {
		const row = this.createFileRow(file.path);
		this.appendWorkingCopyActions(row, file, isStaged);
		this.appendFileStatus(row, file.status);
		row.addEventListener('click', (e) => this.handleWorkingCopyFileClick(e, file.path, isStaged));
		return row;
	}

	private appendWorkingCopyActions(row: HTMLElement, file: WorkingCopyChange, isStaged: boolean): void {
		if (isStaged) {
			row.appendChild(
				this.createFileActionButton('codicon-remove', 'Unstage', () => {
					this.vscode.postMessage({ type: 'unstageFile', path: file.path });
				}),
			);
		} else {
			row.appendChild(
				this.createFileActionButton('codicon-discard', 'Discard Changes', () => {
					this.vscode.postMessage({ type: 'discardFile', path: file.path });
				}),
			);
			row.appendChild(
				this.createFileActionButton('codicon-add', 'Stage', () => {
					this.vscode.postMessage({ type: 'stageFile', path: file.path });
				}),
			);
		}

		if (file.status !== 'D') {
			row.appendChild(
				this.createFileActionButton('codicon-go-to-file', 'Open File', () => {
					this.vscode.postMessage({ type: 'openCurrentFile', path: file.path });
				}),
			);
		}
	}

	private handleWorkingCopyFileClick(event: Event, path: string, staged: boolean): void {
		if ((event.target as HTMLElement).closest('button')) return;
		event.stopPropagation();
		this.vscode.postMessage({ type: 'openWorkingCopyDiff', path, staged });
	}

	private createFileActionButton(iconClass: string, title: string, onClick: () => void): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'file-action-btn';
		btn.title = title;
		btn.innerHTML = `<i class="codicon ${iconClass}"></i>`;
		btn.addEventListener('click', (event: Event) => {
			event.stopPropagation();
			onClick();
		});
		return btn;
	}

	/** Renders the commit message input and action buttons. */
	private renderCommitForm(): HTMLElement {
		const form = document.createElement('div');
		form.className = 'commit-form';

		const createBranchBtn = this.createCommitButton('Create new branch', 'commit-btn-primary');
		const commitBtn = this.createCommitButton('Add to current branch', 'commit-btn-secondary');
		const buttons = [createBranchBtn, commitBtn];

		const input = this.createCommitInput(buttons);
		form.appendChild(input);

		const actions = document.createElement('div');
		actions.className = 'commit-actions';

		createBranchBtn.addEventListener('click', () => {
			this.submitCommitMessage(input, 'createBranch');
		});
		actions.appendChild(createBranchBtn);

		commitBtn.addEventListener('click', () => {
			this.submitCommitMessage(input, 'commitChanges');
		});
		actions.appendChild(commitBtn);

		form.appendChild(actions);
		return form;
	}

	private createCommitInput(buttons: HTMLButtonElement[]): HTMLInputElement {
		const input = document.createElement('input');
		input.type = 'text';
		input.className = 'commit-message-input';
		input.placeholder = 'Message (press Enter to commit)';
		input.value = this.commitMessageValue;

		input.addEventListener('input', () => this.handleCommitInputChange(input, buttons));
		input.addEventListener('keydown', (e: KeyboardEvent) => this.handleCommitKeydown(e, input));

		this.syncCommitButtonStates(input, buttons);
		return input;
	}

	private handleCommitInputChange(input: HTMLInputElement, buttons: HTMLButtonElement[]): void {
		this.commitMessageValue = input.value;
		this.syncCommitButtonStates(input, buttons);
	}

	private handleCommitKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
		if (event.key !== 'Enter') return;
		event.preventDefault();
		this.submitCommitMessage(input, 'createBranch');
	}

	private syncCommitButtonStates(input: HTMLInputElement, buttons: HTMLButtonElement[]): void {
		const hasMessage = input.value.trim().length > 0;
		buttons.forEach((btn) => {
			btn.disabled = !hasMessage;
		});
	}

	private createCommitButton(label: string, variant: string): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = `commit-btn ${variant}`;
		btn.textContent = label;
		btn.disabled = true;
		return btn;
	}

	private submitCommitMessage(input: HTMLInputElement, type: 'createBranch' | 'commitChanges'): void {
		const message = input.value.trim();
		if (!message) return;

		this.vscode.postMessage({ type, message });
		this.commitMessageValue = '';
		input.value = '';
	}
}

// Initialize the stack view when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
	new StackView();
});
