/**
 * Animation utilities for DOM element transitions.
 * All animations use CSS classes for performance.
 */

import { ANIMATION_DURATION_MS, FLASH_ANIMATION_DURATION_MS } from '../../constants';

/**
 * Animates element entrance (fade + slide in).
 * Uses CSS class 'item-enter' for the initial state.
 */
export function animateIn(element: HTMLElement): void {
	element.classList.add('item-enter');
	requestAnimationFrame(() => {
		element.classList.remove('item-enter');
	});
}

/**
 * Animates element exit (fade + slide out + collapse).
 * Calls onComplete after animation duration.
 */
export function animateOut(element: HTMLElement, onComplete: () => void): void {
	element.classList.add('item-exit');
	setTimeout(onComplete, ANIMATION_DURATION_MS);
}

/**
 * Animates element update with a flash highlight effect.
 * Prevents overlapping animations by removing existing class first.
 */
export function animateUpdate(element: HTMLElement): void {
	element.classList.remove('item-updated');

	requestAnimationFrame(() => {
		element.classList.add('item-updated');
		setTimeout(() => {
			element.classList.remove('item-updated');
		}, FLASH_ANIMATION_DURATION_MS);
	});
}

/** Animation callbacks bundle for use with diffList. */
export const animations = {
	animateIn,
	animateOut,
	animateUpdate,
};
