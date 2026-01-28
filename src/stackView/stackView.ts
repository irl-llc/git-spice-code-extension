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
 *    - updateState() → updateBranches() → diffList()
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

import type { BranchViewModel, CommitFileChange, DisplayState } from './types';
import type { WebviewMessage, ExtensionMessage } from './webviewTypes';

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

	private static readonly COMMIT_CHUNK = 10;
	private static readonly ANIMATION_DURATION = 200;
	private static readonly FLASH_DURATION = 300; // Back to normal duration

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

	/**
	 * Builds the data-vscode-context JSON for branch cards.
	 */
	private buildBranchContext(branch: BranchViewModel): string {
		return JSON.stringify({
			webviewSection: 'branch',
			branchName: branch.name,
			webviewBranchIsCurrent: branch.current,
			webviewBranchNeedsRestack: branch.restack,
			preventDefaultContextMenuItems: true,
		});
	}

	/**
	 * Builds the data-vscode-context JSON for commit items.
	 */
	private buildCommitContext(sha: string, branchName: string): string {
		return JSON.stringify({
			webviewSection: 'commit',
			sha,
			branchName,
			preventDefaultContextMenuItems: true,
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

		// Update branch list
		this.updateBranches(oldState?.branches ?? [], newState.branches);
	}

	/**
	 * Generic differ for lists with animations
	 */
	private diffList<T>(
		container: HTMLElement,
		oldItems: T[],
		newItems: T[],
		config: DiffListConfig<T>
	): void {
		const {
			getKey,
			render,
			update,
			needsUpdate,
			itemSelector,
			itemClass,
		} = config;

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

	private updateBranches(oldBranches: BranchViewModel[], newBranches: BranchViewModel[]): void {
		if (newBranches.length === 0) {
			this.emptyEl.textContent = this.currentState?.error ?? 'No branches in the current stack.';
			this.emptyEl.classList.remove('hidden');

			// Fade out all existing items
			const items = this.stackList.querySelectorAll('.stack-item');
			items.forEach((item, index) => {
				(item as HTMLElement).style.animationDelay = `${index * 30}ms`;
				this.animateOut(item as HTMLElement, () => { });
			});
			setTimeout(() => {
				this.stackList.innerHTML = '';
			}, items.length * 30 + StackView.ANIMATION_DURATION);
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

		// Update tree connections on stack-item wrappers
		this.updateTreeConnections(newBranches);
	}

	// Match VSCode's scmHistory.ts dimensions
	private static readonly LANE_WIDTH = 11; // SWIMLANE_WIDTH
	private static readonly NODE_RADIUS = 4; // CIRCLE_RADIUS for non-current branches
	private static readonly NODE_RADIUS_CURRENT = 5; // Larger radius for current branch
	private static readonly NODE_STROKE = 2; // CIRCLE_STROKE_WIDTH
	private static readonly CURVE_RADIUS = 5; // SWIMLANE_CURVE_RADIUS
	private static readonly NODE_GAP = 7; // Gap between line endpoints and node edge

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
	private updateTreeConnections(branches: BranchViewModel[]): void {
		const maxLane = this.computeMaxLane(branches);
		this.updateGraphWidth(maxLane);
		this.removeOldDomTreeNodes();
		// Double-rAF ensures layout is complete before measuring positions
		requestAnimationFrame(() => {
			requestAnimationFrame(() => this.drawTreeSvg(branches));
		});
	}

	private computeMaxLane(branches: BranchViewModel[]): number {
		return branches.reduce((max, b) => Math.max(max, b.tree.lane), 0);
	}

	private updateGraphWidth(maxLane: number): void {
		// VSCode: width accommodates all lanes plus padding
		const width = StackView.LANE_WIDTH * (maxLane + 1) + StackView.NODE_RADIUS;
		this.stackList.style.setProperty('--tree-graph-width', `${width}px`);
	}

	/**
	 * Get X position for a lane. VSCode uses: SWIMLANE_WIDTH * (index + 1)
	 * This centers nodes within their lane column.
	 */
	private getLaneX(lane: number): number {
		return StackView.LANE_WIDTH * (lane + 1);
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

		const paths = this.buildSvgPaths(branches, branchMap, nodePositions);
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

		this.stackList.querySelectorAll('.stack-item').forEach((item) => {
			const wrapper = item as HTMLElement;
			const branchName = wrapper.dataset.branch;
			if (!branchName) return;

			const lane = branchLanes.get(branchName);
			if (lane === undefined) return;

			// Find the branch name span for precise Y alignment, fall back to header or wrapper
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
		paths: Array<{ d: string; restack: boolean }>,
	): SVGSVGElement {
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.classList.add('tree-svg');

		const colors = this.getTreeColors();

		// Draw paths first (behind nodes)
		this.appendPaths(svg, paths, colors);

		// Draw nodes on top
		this.appendNodes(svg, branches, nodePositions, colors);

		this.setSvgDimensions(svg, branches, nodePositions);
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

	private appendPaths(
		svg: SVGSVGElement,
		paths: Array<{ d: string; restack: boolean }>,
		colors: { line: string; restack: string },
	): void {
		paths.forEach(({ d, restack }) => {
			const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', d);
			path.setAttribute('stroke', restack ? colors.restack : colors.line);
			path.setAttribute('stroke-width', '1.5');
			path.setAttribute('fill', 'none');
			path.setAttribute('stroke-linecap', 'round');
			path.setAttribute('stroke-linejoin', 'round');

			if (restack) {
				path.setAttribute('stroke-dasharray', '4 2');
			}

			svg.appendChild(path);
		});
	}

	private appendNodes(
		svg: SVGSVGElement,
		branches: BranchViewModel[],
		nodePositions: Map<string, { x: number; y: number }>,
		colors: { node: string; nodeCurrent: string; bg: string; restack: string },
	): void {
		const branchMap = new Map(branches.map((b) => [b.name, b]));

		nodePositions.forEach(({ x, y }, branchName) => {
			const branch = branchMap.get(branchName);
			const isCurrent = branch?.current ?? false;
			const needsRestack = branch?.restack ?? false;
			const circle = this.createNodeCircle(x, y, isCurrent, needsRestack, colors);
			svg.appendChild(circle);
		});
	}

	/**
	 * Creates an SVG circle for a branch node.
	 * - Current branch: hollow circle with solid stroke
	 * - Needs restack: hollow circle with dashed stroke (warning color)
	 * - Normal: filled circle
	 */
	private createNodeCircle(
		x: number,
		y: number,
		isCurrent: boolean,
		needsRestack: boolean,
		colors: { node: string; nodeCurrent: string; bg: string; restack: string },
	): SVGCircleElement {
		const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		circle.setAttribute('cx', String(x));
		circle.setAttribute('cy', String(y));

		if (needsRestack) {
			// Hollow circle with dashed stroke (warning style)
			circle.setAttribute('r', String(StackView.NODE_RADIUS_CURRENT));
			circle.setAttribute('fill', colors.bg);
			circle.setAttribute('stroke', colors.restack);
			circle.setAttribute('stroke-width', String(StackView.NODE_STROKE));
			circle.setAttribute('stroke-dasharray', '2 2');
		} else if (isCurrent) {
			// Hollow circle with solid stroke (current branch indicator)
			circle.setAttribute('r', String(StackView.NODE_RADIUS_CURRENT));
			circle.setAttribute('fill', colors.bg);
			circle.setAttribute('stroke', colors.nodeCurrent);
			circle.setAttribute('stroke-width', String(StackView.NODE_STROKE));
		} else {
			// Filled circle (normal branch)
			circle.setAttribute('r', String(StackView.NODE_RADIUS));
			circle.setAttribute('fill', colors.node);
		}

		return circle;
	}

	private setSvgDimensions(
		svg: SVGSVGElement,
		branches: BranchViewModel[],
		nodePositions: Map<string, { x: number; y: number }>,
	): void {
		const maxY = this.computeSvgHeight(nodePositions);
		const svgWidth = (this.computeMaxLane(branches) + 1) * StackView.LANE_WIDTH + StackView.NODE_RADIUS;
		svg.setAttribute('width', String(svgWidth));
		svg.setAttribute('height', String(maxY));
		svg.style.width = `${svgWidth}px`;
		svg.style.height = `${maxY}px`;
	}

	/** Builds SVG path data for parent-child connections. */
	private buildSvgPaths(
		branches: BranchViewModel[],
		branchMap: Map<string, BranchViewModel>,
		nodePositions: Map<string, { x: number; y: number }>,
	): Array<{ d: string; restack: boolean }> {
		const paths: Array<{ d: string; restack: boolean }> = [];

		for (const branch of branches) {
			if (!branch.tree.parentName) continue;

			const parent = branchMap.get(branch.tree.parentName);
			if (!parent) continue;

			const childPos = nodePositions.get(branch.name);
			const parentPos = nodePositions.get(branch.tree.parentName);
			if (!childPos || !parentPos) continue;

			const d = this.createRoundedPath(parentPos.x, parentPos.y, childPos.x, childPos.y);
			paths.push({ d, restack: branch.restack });
		}

		return paths;
	}

	/**
	 * Creates SVG path from parent to child using "smooth exit" pattern.
	 * Matches VSCode's scmHistory.ts arc drawing approach.
	 *
	 * Paths include gaps at node boundaries so lines don't overlap the
	 * circular nodes - creating the "halo" effect seen in VSCode.
	 */
	private createRoundedPath(parentX: number, parentY: number, childX: number, childY: number): string {
		const r = StackView.CURVE_RADIUS;
		const gap = StackView.NODE_GAP;

		// Same lane: straight vertical line with gaps at both ends
		if (parentX === childX) {
			// Parent is at larger Y (below), child is at smaller Y (above)
			const startY = parentY - gap; // Above parent's top edge
			const endY = childY + gap; // Below child's bottom edge
			return `M ${parentX} ${startY} L ${childX} ${endY}`;
		}

		// Different lanes: horizontal exit → arc → vertical to child
		const goingRight = childX > parentX;

		// Start with gap from parent's edge (horizontal exit)
		const startX = goingRight ? parentX + gap : parentX - gap;

		// End with gap from child's edge (vertical approach from below)
		const endY = childY + gap;

		// Clamp curve radius to available space
		const dx = Math.abs(childX - startX);
		const dy = Math.abs(parentY - endY);
		const effectiveR = Math.min(r, dx, dy);

		// SVG arc sweep: 0=counter-clockwise (going right), 1=clockwise (going left)
		const sweep = goingRight ? 0 : 1;

		// Horizontal line ends at curve start
		const hLineEndX = goingRight ? childX - effectiveR : childX + effectiveR;

		// Arc ends at child's X, effectiveR above parent's Y
		const arcEndY = parentY - effectiveR;

		return [
			`M ${startX} ${parentY}`,
			`L ${hLineEndX} ${parentY}`,
			`A ${effectiveR} ${effectiveR} 0 0 ${sweep} ${childX} ${arcEndY}`,
			`L ${childX} ${endY}`,
		].join(' ');
	}

	private computeSvgHeight(nodePositions: Map<string, { x: number; y: number }>): number {
		let maxY = 0;
		nodePositions.forEach(({ y }) => {
			if (y > maxY) maxY = y;
		});
		return maxY + StackView.NODE_RADIUS * 2;
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
		card.dataset.vscodeContext = this.buildBranchContext(branch);

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
		card.dataset.vscodeContext = this.buildBranchContext(branch);

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

	private renderCommitsContainer(branch: BranchViewModel, card: HTMLElement): HTMLElement {
		const container = document.createElement('div');
		container.className = 'branch-commits';
		container.dataset.commitsContainer = 'true';

		// Store initial visible count
		const initialCount = Math.min(branch.commits!.length, StackView.COMMIT_CHUNK);
		this.renderCommitsIntoContainer(container, branch.commits!, initialCount, branch.name);

		return container;
	}

	private renderCommitsIntoContainer(container: HTMLElement, commits: BranchViewModel['commits'], visibleCount: number, branchName: string): void {
		if (!commits) return;

		const newCommits = commits.slice(0, visibleCount);

		// Use diffList to reconcile commits inside the container
		this.diffList(container, Array.from(container.querySelectorAll('.commit-wrapper')).map(el => {
			const key = (el as HTMLElement).dataset.key;
			return key ? { sha: key, shortSha: '', subject: '' } : null;
		}).filter((item): item is NonNullable<BranchViewModel['commits']>[0] => item !== null), newCommits, {
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
				return (
					subjectEl?.textContent !== c.subject ||
					shaEl?.textContent !== c.shortSha
				);
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
		});

		// Add "show more" button if needed (ensure it's after the commits)
		const existingMore = container.querySelector('.branch-more');
		if (existingMore) existingMore.remove();
		if (visibleCount < commits.length) {
			const remaining = commits.length - visibleCount;
			const more = document.createElement('button');
			more.type = 'button';
			more.className = 'branch-more';
			more.textContent = remaining > StackView.COMMIT_CHUNK
				? `Show more (${remaining})`
				: `Show remaining ${remaining}`;
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
			row.dataset.vscodeContext = this.buildCommitContext(commit.sha, branchName);
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

	/**
	 * Renders a single file change row.
	 */
	private renderFileChangeRow(file: CommitFileChange, sha: string): HTMLElement {
		const row = document.createElement('div');
		row.className = 'file-change';

		// File icon
		const icon = document.createElement('i');
		icon.className = `file-icon codicon codicon-file`;
		row.appendChild(icon);

		// Extract file name and folder path
		const lastSlash = file.path.lastIndexOf('/');
		const fileName = lastSlash >= 0 ? file.path.slice(lastSlash + 1) : file.path;
		const folderPath = lastSlash >= 0 ? file.path.slice(0, lastSlash) : '';

		// File name
		const nameSpan = document.createElement('span');
		nameSpan.className = 'file-name';
		nameSpan.textContent = fileName;
		row.appendChild(nameSpan);

		// Folder path
		const folderSpan = document.createElement('span');
		folderSpan.className = 'file-folder';
		folderSpan.textContent = folderPath;
		row.appendChild(folderSpan);

		// Status indicator
		const statusSpan = document.createElement('span');
		statusSpan.className = `file-status status-${file.status.toLowerCase()}`;
		statusSpan.textContent = file.status;
		row.appendChild(statusSpan);

		// Open current file button (hidden for deleted files)
		if (file.status !== 'D') {
			const openBtn = document.createElement('button');
			openBtn.type = 'button';
			openBtn.className = 'open-file-btn';
			openBtn.title = 'Open current file';
			openBtn.innerHTML = '<i class="codicon codicon-go-to-file"></i>';
			openBtn.addEventListener('click', (event: Event) => {
				event.stopPropagation();
				this.vscode.postMessage({ type: 'openCurrentFile', path: file.path });
			});
			row.appendChild(openBtn);
		}

		// Click on row opens the diff for this file
		row.addEventListener('click', (event: Event) => {
			const target = event.target as HTMLElement;
			if (target.closest('.open-file-btn')) {
				return;
			}
			event.stopPropagation();
			this.vscode.postMessage({ type: 'openFileDiff', sha, path: file.path });
		});

		return row;
	}

	private createTag(label: string, variant: string): HTMLElement {
		const span = document.createElement('span');
		span.className = 'tag' + (variant ? ' tag-' + variant : '');
		span.textContent = label;
		return span;
	}

}

// Initialize the stack view when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
	new StackView();
});
