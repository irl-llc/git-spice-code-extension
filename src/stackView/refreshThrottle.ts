/**
 * Pure decision logic for watch-driven refresh coalescing (issue #71).
 *
 * A multi-step git operation such as `gs stack submit` rewrites refs, the index,
 * and refs/spice/data dozens of times over its run, firing a watcher event each
 * time and producing a ~2-minute refresh storm. Rather than guess a fixed delay,
 * we hold refreshes while a git operation is in progress — detected by watching
 * its marker files — and fire once the markers have cleared. Because a multi-
 * step op cycles those markers many times, the file watcher resets its debounce
 * on each marker event, so the refresh lands once the markers have stayed clear
 * through one debounce window (the "settle"). Kept free of `vscode`/fs so it is
 * unit-testable.
 */

import { basename } from 'node:path';

/**
 * Marker paths under a repo's git dir that indicate an in-progress multi-step
 * operation (rebase/merge/cherry-pick) or an index lock. `rebase-merge` and
 * `rebase-apply` are directories; the rest are files.
 */
export const GIT_OP_MARKERS = [
	'index.lock',
	'rebase-merge',
	'rebase-apply',
	'MERGE_HEAD',
	'CHERRY_PICK_HEAD',
	'REVERT_HEAD',
];

/**
 * True when a changed git path IS a marker file, or lives inside a marker
 * directory (e.g. `…/rebase-merge/done`). Used to tell git-op *activity* (which
 * only resets the settle window) apart from a real ref/index change.
 */
export function isGitOpMarkerPath(fsPath: string): boolean {
	const normalized = fsPath.replace(/\\/g, '/');
	const base = basename(normalized);
	return GIT_OP_MARKERS.some((marker) => base === marker || normalized.includes(`/${marker}/`));
}

/**
 * Whether a pending refresh should fire now: only when something has actually
 * changed and no git operation's marker files are present. While an operation is
 * in progress the refresh is held until the markers clear (signalled by their
 * own watch events), with no fixed delay.
 */
export function shouldRefreshNow(refreshRequested: boolean, gitOpInProgress: boolean): boolean {
	return refreshRequested && !gitOpInProgress;
}

/**
 * Counts in-flight extension-initiated operations (submit/restack/sync/branch
 * commands) so the watcher can hold its refreshes for their whole duration
 * (issue #71). A `gs stack submit` rewrites refs between network pushes that
 * leave no marker file, so the marker-based hold alone releases in those gaps;
 * because the extension knows exactly when its own operation runs, it gates
 * deterministically and refreshes once at the end. Nesting-safe and pure.
 */
export class OperationCounter {
	private depth = 0;

	/** Raises the gate (a new operation started). */
	begin(): void {
		this.depth++;
	}

	/** Lowers the gate; returns true when it reaches idle (no ops in flight). */
	end(): boolean {
		if (this.depth > 0) this.depth--;
		return this.depth === 0;
	}

	/** True while at least one operation is in flight. */
	get inProgress(): boolean {
		return this.depth > 0;
	}
}

/**
 * Leading-edge rate limiter for watcher-driven refreshes (issue #71).
 *
 * The marker/gate holds only cover operations we can detect; a git operation
 * driven from the TERMINAL (e.g. `gs repo sync` between PR merges) interleaves
 * network transfers with ref writes, and every inter-write gap longer than the
 * debounce produces another refresh. This limiter bounds that to one refresh
 * per interval: the FIRST event fires immediately (no added latency for a
 * lone change), and later events within the interval are deferred to the
 * interval's end (trailing edge), so a final refresh always lands. Pure —
 * the caller supplies the clock.
 */
export class RefreshRateLimiter {
	private lastFiredAt = Number.NEGATIVE_INFINITY;

	constructor(private readonly intervalMs: number) {}

	/**
	 * Attempts to start a refresh at `nowMs`. Returns 0 when allowed (and
	 * records the firing); otherwise the milliseconds to wait before retrying.
	 */
	tryAcquire(nowMs: number): number {
		const wait = this.lastFiredAt + this.intervalMs - nowMs;
		if (wait > 0) return wait;
		this.lastFiredAt = nowMs;
		return 0;
	}
}
