/**
 * Trunk sync-state detection — surfaces two distinct "your trunk is not in sync
 * with the remote" affordances on the trunk branch card (issue #82):
 *
 *  - `remote-unknown`: git-spice has no remote configured for the repo, so it
 *    cannot tell whether the trunk is up to date. Many `gs` commands (submit,
 *    sync) fail or drop into the init prompt in this state. Detected purely from
 *    git: a repo with zero remotes has no `origin` for git-spice to use.
 *  - `origin-ahead`: the trunk's upstream tracking branch (e.g. `origin/main`)
 *    has commits the local trunk does not — a `gs repo sync` would fast-forward
 *    it. Detected with `git rev-list --count <trunk>..<upstream>`.
 *
 * The detection is split from its parsing so the parsing (the part with the
 * branching logic) is unit-testable without spawning git.
 */

import { execGit } from './git';

/** Non-default sync state of the trunk branch relative to its remote. */
export type TrunkSyncState = 'remote-unknown' | 'origin-ahead';

/** Raw git readings used to derive the trunk sync state. */
export type TrunkSyncReadings = {
	/** Number of git remotes configured (`git remote` line count). */
	remoteCount: number;
	/**
	 * Commits the upstream tracking ref has that local trunk lacks, or undefined
	 * when there is no upstream to compare against.
	 */
	commitsAhead?: number;
};

/**
 * Derives the trunk's non-default sync state from raw git readings. Returns
 * undefined when the trunk is in the default in-sync state (a remote exists and
 * the upstream is not ahead) — the UI shows nothing in that case.
 */
export function deriveTrunkSyncState(readings: TrunkSyncReadings): TrunkSyncState | undefined {
	if (readings.remoteCount === 0) {
		return 'remote-unknown';
	}
	if (readings.commitsAhead !== undefined && readings.commitsAhead > 0) {
		return 'origin-ahead';
	}
	return undefined;
}

/** Lists configured git remote names; empty on any failure (fail to "unknown"). */
async function listRemotes(cwd: string): Promise<string[]> {
	try {
		const { stdout } = await execGit(cwd, ['remote']);
		return stdout
			.trim()
			.split('\n')
			.filter((line) => line.length > 0);
	} catch {
		return [];
	}
}

/**
 * Counts commits the given comparison ref has that the local trunk lacks
 * (`git rev-list --count <trunk>..<ref>`). Returns undefined when the ref does
 * not resolve (e.g. no upstream, or no remote-tracking branch yet) or on any
 * other failure — the caller treats undefined as "nothing to compare".
 */
async function countAheadOf(cwd: string, trunkName: string, ref: string): Promise<number | undefined> {
	try {
		const { stdout } = await execGit(cwd, ['rev-list', '--count', `${trunkName}..${ref}`]);
		const count = Number.parseInt(stdout.trim(), 10);
		return Number.isFinite(count) ? count : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Counts commits the trunk's remote side is ahead by. Prefers the configured
 * upstream (`<trunk>@{upstream}`, honoring explicit tracking or a renamed
 * remote) and falls back to the remote-tracking branch `<remote>/<trunk>` —
 * git-spice pushes the trunk without setting upstream tracking, so the fallback
 * is the common case. Returns undefined when neither ref resolves.
 */
async function countCommitsAhead(cwd: string, trunkName: string, remotes: string[]): Promise<number | undefined> {
	const upstream = await countAheadOf(cwd, trunkName, `${trunkName}@{upstream}`);
	if (upstream !== undefined) {
		return upstream;
	}
	const remote = remotes.includes('origin') ? 'origin' : remotes[0];
	return countAheadOf(cwd, trunkName, `${remote}/${trunkName}`);
}

/**
 * Reads the trunk's sync state against its remote. Returns undefined when the
 * trunk is in the default in-sync state, so the caller renders no affordance.
 */
export async function fetchTrunkSyncState(cwd: string, trunkName: string): Promise<TrunkSyncState | undefined> {
	const remotes = await listRemotes(cwd);
	if (remotes.length === 0) {
		return deriveTrunkSyncState({ remoteCount: 0 });
	}
	const commitsAhead = await countCommitsAhead(cwd, trunkName, remotes);
	return deriveTrunkSyncState({ remoteCount: remotes.length, commitsAhead });
}
