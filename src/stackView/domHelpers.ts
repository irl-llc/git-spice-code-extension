/**
 * DOM helper utilities for type-safe element operations.
 * Provides typed alternatives to querySelector and element data storage.
 */

import type { TreeFragmentData } from './types';

/**
 * Branch data stored on DOM elements for change detection.
 */
export type BranchElementData = {
	current: boolean;
	restack: boolean;
	commitsCount: number;
	hasChange: boolean;
	changeId?: string;
	changeStatus?: string;
	changeCommentsKey?: string;
	treeDepth: number;
	treeIsLastChild: boolean;
	treeAncestorIsLast: string;
	treeLane: number;
};

/** WeakMap storing branch data keyed by DOM element. */
const branchDataMap = new WeakMap<HTMLElement, BranchElementData>();

/** WeakMap storing tree fragment data keyed by DOM element. */
const treeFragmentMap = new WeakMap<HTMLElement, TreeFragmentData>();

/**
 * Stores branch data associated with a DOM element.
 */
export function setBranchData(element: HTMLElement, data: BranchElementData): void {
	branchDataMap.set(element, data);
}

/**
 * Retrieves branch data associated with a DOM element.
 */
export function getBranchData(element: HTMLElement): BranchElementData | undefined {
	return branchDataMap.get(element);
}

/**
 * Stores tree fragment data associated with a DOM element.
 */
export function setTreeFragment(element: HTMLElement, data: TreeFragmentData): void {
	treeFragmentMap.set(element, data);
}

/**
 * Retrieves tree fragment data associated with a DOM element.
 */
export function getTreeFragment(element: HTMLElement): TreeFragmentData | undefined {
	return treeFragmentMap.get(element);
}

/**
 * Type guard to check if an element is an HTMLElement.
 */
export function isHTMLElement(el: Element | null): el is HTMLElement {
	return el instanceof HTMLElement;
}

/**
 * Type guard to check if an element is an HTMLInputElement.
 */
export function isInputElement(el: Element | null): el is HTMLInputElement {
	return el instanceof HTMLInputElement;
}

/**
 * Type guard to check if an element is an HTMLTextAreaElement.
 */
export function isTextAreaElement(el: Element | null): el is HTMLTextAreaElement {
	return el instanceof HTMLTextAreaElement;
}

/**
 * Queries for an element and returns it typed, or null if not found.
 */
export function queryElement<T extends Element>(
	parent: Element | Document,
	selector: string,
	guard: (el: Element) => el is T,
): T | null {
	const el = parent.querySelector(selector);
	if (el && guard(el)) {
		return el;
	}
	return null;
}

/**
 * Queries for an element and asserts it exists and matches the type guard.
 * Throws if element not found or doesn't match.
 */
export function assertElement<T extends Element>(
	parent: Element | Document,
	selector: string,
	guard: (el: Element) => el is T,
): T {
	const el = queryElement(parent, selector, guard);
	if (!el) {
		throw new Error(`Element not found or wrong type: ${selector}`);
	}
	return el;
}
