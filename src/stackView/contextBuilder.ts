import type { BranchViewModel } from './types';

/**
 * Builds the data-vscode-context JSON for branch cards.
 * This enables native VS Code context menus.
 */
export function buildBranchContext(branch: BranchViewModel): string {
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
 * This enables native VS Code context menus for commits.
 */
export function buildCommitContext(sha: string, branchName: string): string {
	return JSON.stringify({
		webviewSection: 'commit',
		sha,
		branchName,
		preventDefaultContextMenuItems: true,
	});
}
