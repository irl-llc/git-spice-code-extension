/**
 * Collapsed-subtree placeholder card (issue #66).
 *
 * Renders in place of one or more hidden subtrees: a dashed empty lane (drawn
 * by the row's TreeFragmentSvg) beside a card summarizing how many subtrees and
 * branches are hidden, with a centered [+] that expands them. Only the [+]
 * expands — clicking the card body does nothing (binding design answer #4).
 */

import { type JSX } from 'react';

import type { CollapsedPlaceholderViewModel } from '../../types';

export interface CollapsedPlaceholderProps {
	placeholder: CollapsedPlaceholderViewModel;
	/** Expands the hidden subtrees (posts the roots back to the extension host). */
	onExpand: (roots: string[]) => void;
}

/** Pluralizes a noun by count: "1 subtree" / "2 subtrees" / "2 branches". */
function plural(count: number, noun: string): string {
	if (count === 1) return `1 ${noun}`;
	// Sibilant endings (e.g. "branch") take "-es", not "-s".
	const suffix = /(s|x|z|ch|sh)$/.test(noun) ? 'es' : 's';
	return `${count} ${noun}${suffix}`;
}

export function CollapsedPlaceholder({ placeholder, onExpand }: CollapsedPlaceholderProps): JSX.Element {
	const label = `${plural(placeholder.subtreeCount, 'subtree')} / ${plural(placeholder.branchCount, 'branch')}`;
	return (
		<div className="collapsed-placeholder" data-role="collapsed-placeholder">
			<button
				type="button"
				className="collapsed-placeholder-expand codicon codicon-add"
				aria-label={`Expand ${label}`}
				title="Expand collapsed subtrees"
				onClick={() => onExpand(placeholder.roots)}
			/>
			<span className="collapsed-placeholder-summary">{label}</span>
		</div>
	);
}
