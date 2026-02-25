/**
 * Generic diffing/reconciliation engine for animated list updates.
 * Uses keyed reconciliation to minimize DOM operations.
 */

import { getTreeFragment } from '../domHelpers';
import type { TreeColors } from '../tree/treeFragment';
import { createTreeFragmentSvg } from '../tree/treeFragment';

/** Configuration for diffList reconciliation. */
export interface DiffListConfig<T> {
	getKey: (item: T) => string;
	render: (item: T) => HTMLElement;
	update?: (element: HTMLElement, item: T) => void;
	needsUpdate?: (element: HTMLElement, item: T) => boolean;
	itemSelector: string;
	itemClass: string;
}

/** Animation callbacks used by diffList. */
export interface DiffAnimations {
	animateIn: (element: HTMLElement) => void;
	animateOut: (element: HTMLElement, onComplete: () => void) => void;
}

/**
 * Reconciles a container's children with a new item list using animations.
 *
 * Operations:
 * - Removes items no longer in the list (with exit animation)
 * - Adds new items (with entrance animation)
 * - Updates existing items if needsUpdate returns true
 * - Reorders items to match new list order
 */
export function diffList<T>(
	container: HTMLElement,
	_oldItems: T[],
	newItems: T[],
	config: DiffListConfig<T>,
	animations: DiffAnimations,
	treeColors: TreeColors,
): void {
	const existingElements = buildExistingElementsMap(container, config.itemSelector);
	const newKeys = new Set(newItems.map(config.getKey));

	removeStaleElements(existingElements, newKeys, container, animations);
	reconcileItems(container, newItems, existingElements, config, animations, treeColors);
}

/** Builds a map of existing elements keyed by data-key attribute. */
function buildExistingElementsMap(container: HTMLElement, selector: string): Map<string, HTMLElement> {
	const map = new Map<string, HTMLElement>();
	container.querySelectorAll(selector).forEach((el) => {
		const key = (el as HTMLElement).dataset.key;
		if (key) {
			map.set(key, el as HTMLElement);
		}
	});
	return map;
}

/** Removes elements whose keys are no longer in the new item set. */
function removeStaleElements(
	existingElements: Map<string, HTMLElement>,
	newKeys: Set<string>,
	container: HTMLElement,
	animations: DiffAnimations,
): void {
	for (const [key, element] of existingElements) {
		if (!newKeys.has(key)) {
			animations.animateOut(element, () => {
				if (element.parentNode === container) {
					container.removeChild(element);
				}
			});
			existingElements.delete(key);
		}
	}
}

/** Adds, updates, or reorders items to match the new list. */
function reconcileItems<T>(
	container: HTMLElement,
	newItems: T[],
	existingElements: Map<string, HTMLElement>,
	config: DiffListConfig<T>,
	animations: DiffAnimations,
	treeColors: TreeColors,
): void {
	let previousElement: HTMLElement | null = null;

	for (const item of newItems) {
		const key = config.getKey(item);
		const existingElement = existingElements.get(key);

		if (existingElement) {
			previousElement = updateExistingElement(
				container,
				existingElement,
				item,
				config,
				previousElement,
				treeColors,
			);
		} else {
			previousElement = insertNewElement(container, item, key, config, animations, previousElement, treeColors);
		}
	}
}

/** Updates an existing element if needed and ensures correct position. */
function updateExistingElement<T>(
	container: HTMLElement,
	existingElement: HTMLElement,
	item: T,
	config: DiffListConfig<T>,
	previousElement: HTMLElement | null,
	treeColors: TreeColors,
): HTMLElement {
	if (config.needsUpdate && config.update) {
		const child = existingElement.querySelector('[data-content]') as HTMLElement;
		if (child && config.needsUpdate(child, item)) {
			const newChild = config.render(item);
			child.replaceWith(newChild);

			if (newChild.dataset.branch) {
				existingElement.dataset.branch = newChild.dataset.branch;
			}

			updateTreeFragmentSvg(existingElement, newChild, treeColors);
		}
	}

	reorderIfNeeded(container, existingElement, previousElement);
	return existingElement;
}

/** Updates the tree fragment SVG if it changed. */
function updateTreeFragmentSvg(wrapper: HTMLElement, newChild: HTMLElement, treeColors: TreeColors): void {
	const newTreeFragment = getTreeFragment(newChild);
	if (!newTreeFragment) return;

	const oldSvg = wrapper.querySelector('.tree-fragment-svg');
	const newSvg = createTreeFragmentSvg(newTreeFragment, treeColors);

	if (oldSvg) {
		oldSvg.replaceWith(newSvg);
	} else {
		wrapper.insertBefore(newSvg, wrapper.firstChild);
	}
}

/** Reorders element if not in correct position. */
function reorderIfNeeded(
	container: HTMLElement,
	element: HTMLElement,
	previousElement: HTMLElement | null,
): void {
	const expectedNext: ChildNode | null = previousElement ? previousElement.nextSibling : container.firstChild;
	if (element !== expectedNext) {
		container.insertBefore(element, expectedNext);
	}
}

/** Creates and inserts a new element with animation. */
function insertNewElement<T>(
	container: HTMLElement,
	item: T,
	key: string,
	config: DiffListConfig<T>,
	animations: DiffAnimations,
	previousElement: HTMLElement | null,
	treeColors: TreeColors,
): HTMLElement {
	const wrapper = document.createElement('li');
	wrapper.className = config.itemClass;
	wrapper.dataset.key = key;

	const child = config.render(item);
	appendTreeFragmentSvg(wrapper, child, treeColors);
	wrapper.appendChild(child);

	if (child.dataset.branch) {
		wrapper.dataset.branch = child.dataset.branch;
	}

	const nextElement: ChildNode | null = previousElement ? previousElement.nextSibling : container.firstChild;
	container.insertBefore(wrapper, nextElement);

	animations.animateIn(wrapper);
	return wrapper;
}

/** Appends tree fragment SVG to wrapper if the child has fragment data. */
function appendTreeFragmentSvg(wrapper: HTMLElement, child: HTMLElement, treeColors: TreeColors): void {
	const treeFragment = getTreeFragment(child);
	if (treeFragment) {
		const svg = createTreeFragmentSvg(treeFragment, treeColors);
		wrapper.appendChild(svg);
	}
}
