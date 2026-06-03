/**
 * Pure decision logic for throttling watcher-driven refreshes (issue #71).
 *
 * A multi-step git operation such as `gs stack submit` rewrites refs, the
 * index, and refs/spice/data dozens of times over its run, firing a watcher
 * event each time. Refreshing on every one produces a ~2-minute refresh storm.
 * This module collapses such bursts into bounded refreshes: defer entirely
 * while a git operation is mid-flight, and otherwise enforce a minimum interval
 * between refreshes. Kept free of `vscode`/fs so it is unit-testable.
 */

/** Inputs for a single throttle decision. */
export interface ThrottleInputs {
	/** Current time (ms, e.g. `Date.now()`). */
	now: number;
	/** When the last refresh actually fired (ms); 0 if none yet. */
	lastRefreshAt: number;
	/** Minimum spacing between refreshes (ms). */
	minIntervalMs: number;
	/** Whether a git operation (rebase/merge/index lock) is in progress. */
	gitOpInProgress: boolean;
	/** How long to wait before re-checking an in-progress git operation (ms). */
	gitOpRecheckMs: number;
}

/** Refresh now, or defer by `deferMs` and re-evaluate then. */
export type ThrottleDecision = { refresh: true } | { refresh: false; deferMs: number };

/**
 * Decides whether a pending refresh should fire now or be deferred:
 * - while a git operation is in progress, always defer (refresh once it ends);
 * - otherwise refresh only if at least `minIntervalMs` has elapsed since the
 *   last one, else defer by the remaining time.
 */
export function decideRefresh(input: ThrottleInputs): ThrottleDecision {
	if (input.gitOpInProgress) return { refresh: false, deferMs: input.gitOpRecheckMs };
	const elapsed = input.now - input.lastRefreshAt;
	if (elapsed >= input.minIntervalMs) return { refresh: true };
	return { refresh: false, deferMs: input.minIntervalMs - elapsed };
}
