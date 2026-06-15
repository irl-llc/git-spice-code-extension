/**
 * Integration-branch card: rendered as the topmost node of the stack when an
 * integration branch is configured (the beta abhinav/git-spice feature).
 *
 * The integration build is "rebuilt" (not restacked); the needs-rebuild state
 * reuses the warning (marigold) status color via the `needs-rebuild` class and
 * a "Rebuild" tag, keeping verbiage consistent with the issue.
 */

import { type JSX } from 'react';

import type { IntegrationViewModel } from '../../types';

export interface IntegrationCardProps {
	integration: IntegrationViewModel;
}

export function IntegrationCard({ integration }: IntegrationCardProps): JSX.Element {
	return (
		<article
			className={`branch-card integration-card${integration.needsRebuild ? ' needs-rebuild' : ''}`}
			data-content="true"
			data-integration={integration.name}
		>
			<div className="branch-content">
				<div className="branch-header">
					<span className="branch-toggle-spacer" />
					<span className="branch-name integration-name">
						<i className="codicon codicon-target integration-icon" aria-hidden="true" />
						{integration.name}
					</span>
					<IntegrationTags integration={integration} />
				</div>
			</div>
		</article>
	);
}

function IntegrationTags({ integration }: IntegrationCardProps): JSX.Element {
	return (
		<div className="branch-tags">
			<span className="tag tag-accent">Integration</span>
			{integration.needsRebuild ? (
				<span className="tag tag-warning" aria-label="Integration build needs rebuild">
					Rebuild
				</span>
			) : (
				<span className="tag" aria-label="Integration build up to date">
					Built
				</span>
			)}
		</div>
	);
}
