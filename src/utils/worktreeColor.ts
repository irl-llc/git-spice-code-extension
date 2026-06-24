/**
 * Deterministic color assignment for worktree (a.k.a. "anchor") badges.
 *
 * git-spice can park a branch in a separate git worktree to give concurrent
 * agents a measure of isolation. The stack view shows each such branch with a
 * badge naming its worktree, and we want every distinct worktree to get a
 * stable, visually distinct color.
 *
 * Rather than persist a color-assignment file (mutable state to manage and
 * migrate), the color is derived deterministically from the worktree path: a
 * stable string hash selects one of {@link WORKTREE_COLOR_COUNT} curated
 * palette slots. The slots are spread across the hue wheel (see the
 * `.tag-wt-*` rules in media/stackView.css) so adjacent indices never visually
 * collide. The mapping is pure and session-stable: the same path always yields
 * the same slot, with no storage involved.
 *
 * Collisions only occur once more than {@link WORKTREE_COLOR_COUNT} distinct
 * worktrees are visible at once, which is well beyond expected concurrency.
 */

/** Number of palette slots; mirrored by the `.tag-wt-0..N-1` CSS classes. */
export const WORKTREE_COLOR_COUNT = 8;

/**
 * Maps a worktree path to a palette slot index in [0, WORKTREE_COLOR_COUNT).
 *
 * Uses a 32-bit FNV-1a hash over the UTF-16 code units of the path — small,
 * dependency-free, and well-distributed for short strings like filesystem
 * paths. The result is reduced modulo the palette size.
 */
export function worktreeColorIndex(worktreePath: string): number {
	let hash = 0x811c9dc5; // FNV offset basis
	for (let i = 0; i < worktreePath.length; i++) {
		hash ^= worktreePath.charCodeAt(i);
		// FNV prime multiply via shifts to stay in 32-bit int math.
		hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
	}
	return hash % WORKTREE_COLOR_COUNT;
}

/** The CSS class selecting the badge color for a worktree path. */
export function worktreeColorClass(worktreePath: string): string {
	return `tag-wt-${worktreeColorIndex(worktreePath)}`;
}

/**
 * The short, human-readable label for a worktree badge: the final path segment
 * (basename) of the worktree directory. Falls back to the full path when there
 * is no separator. Tolerates trailing separators.
 */
export function worktreeLabel(worktreePath: string): string {
	const trimmed = worktreePath.replace(/[/\\]+$/, '');
	const lastSep = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	return lastSep >= 0 ? trimmed.slice(lastSep + 1) : trimmed;
}
