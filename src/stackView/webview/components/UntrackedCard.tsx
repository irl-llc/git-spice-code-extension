/**
 * Untracked branch card: shown when the current branch is not tracked by
 * git-spice. Offers a "Track Branch" action that emits `branchTrack`.
 *
 * Replaces the imperative renderUntrackedCard. Controlled by the parent:
 * `onTrack` is the only outbound callback. The wrapper `<li>` that goes
 * into the stack list lives in untrackedCardRenderer.tsx — this component
 * renders just the card body.
 */

import type { JSX } from 'react';

export interface UntrackedCardProps {
	/** Name of the untracked branch. */
	branchName: string;
	/** Invoked when the user clicks "Track Branch". */
	onTrack: () => void;
}

export function UntrackedCard({ branchName, onTrack }: UntrackedCardProps): JSX.Element {
	return (
		<article className="branch-card untracked expanded">
			<div className="branch-header">
				<div className="branch-name-row">
					<i className="codicon codicon-check current-branch-icon" aria-label="Current branch" />
					<span className="branch-name">{branchName}</span>
				</div>
				<div className="branch-tags">
					<span className="tag tag-error">Untracked</span>
				</div>
			</div>
			<div className="untracked-hint">
				<span>This branch is not tracked by git-spice.</span>
				<button
					type="button"
					className="untracked-track-btn"
					aria-label={`Track ${branchName} with git-spice`}
					onClick={onTrack}
				>
					Track Branch
				</button>
			</div>
		</article>
	);
}
