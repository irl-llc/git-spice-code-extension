/**
 * Pure parsing of the `gs repo sync` branch-deletion confirmation prompt.
 *
 * Kept free of any `vscode` import so it can be unit-tested directly
 * (see src/test/unit/repoSyncPrompt.test.ts).
 */

/**
 * Matches the single-branch deletion confirmation that `gs repo sync` emits.
 *
 * The current gs prompt is `Delete <branch>?: [y/N]` — the prompt widget
 * appends `: [y/N]` to the `Delete <branch>?` title (see git-spice testdata
 * `repo_sync_closed_pr_prompt.txt`). Older gs builds wrote
 * `Delete branch '<branch>'? [y/N]`. We accept both so the confirmation keeps
 * working across a gs version bump, anchoring on the `[y/N]` suffix so a future
 * prompt-text change fails to match (and is caught by the unit test) instead of
 * silently capturing the wrong text.
 */
export const BRANCH_DELETE_PROMPT_PATTERN = /Delete (?:branch '([^']+)'\? |(.+?)\?: )\[y\/N\]/i;

/** Extracts the branch name from a deletion prompt if one is present. */
export function extractBranchFromPrompt(text: string): string | undefined {
	const match = text.match(BRANCH_DELETE_PROMPT_PATTERN);
	if (!match) return undefined;
	return match[1] ?? match[2];
}
