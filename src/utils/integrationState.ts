/**
 * Parser for `gs integration show` output (the beta integration-branch
 * feature; see ed-irl/git-spice).
 *
 * Unlike `gs ll`, the integration command group does not emit `--json`, so the
 * extension parses the human-readable text. Parsing lives in a pure function so
 * it is unit-testable without spawning a process or importing `vscode`. The
 * thin exec wrapper that runs the probe is in {@link ./gitSpice}.
 *
 * Example output for a configured, rebuilt integration branch with one drifted
 * tip:
 *
 *     Integration branch: integ
 *     Last pushed: 8f6661d
 *     Tips:
 *       - feat-a (drifted: stored=8f6661d current=384a064)
 *       - feat-b (4e5d399)
 *
 * When no integration branch is configured, `gs` prints an informational
 * "No integration branch configured." line instead; that maps to `undefined`.
 */

/** Rebuild-status of a single integration tip branch. */
export type IntegrationTipStatus =
	/** Tip is up to date: its stored hash matches its current hash. */
	| 'current'
	/** Tip has drifted from the last rebuild and needs a rebuild. */
	| 'drifted'
	/** Tip has never been rebuilt (configured but not yet materialized). */
	| 'pending'
	/** Tip branch no longer exists in the repository. */
	| 'missing';

/** A single branch composing the integration branch tip list. */
export type IntegrationTip = {
	name: string;
	status: IntegrationTipStatus;
	/** Hash recorded at the last successful rebuild, when known. */
	storedHash?: string;
	/** Current hash of the tip branch, when it differs from the stored hash. */
	currentHash?: string;
};

/** Parsed state of the configured integration branch. */
export type IntegrationState = {
	/** Local integration branch name. */
	name: string;
	/** Remote-side branch name, when distinct from {@link name}. */
	upstreamBranch?: string;
	/** Hash recorded at the last successful push, when known. */
	lastPushedHash?: string;
	/** Configured tip branches, in display order. */
	tips: IntegrationTip[];
	/**
	 * True when any tip is drifted, pending, or missing — i.e. the integration
	 * branch needs to be rebuilt to reflect the current tip hashes.
	 */
	needsRebuild: boolean;
};

const INTEGRATION_BRANCH_PATTERN = /^Integration branch:\s*(.+)$/;
const UPSTREAM_BRANCH_PATTERN = /^Upstream branch:\s*(.+)$/;
const LAST_PUSHED_PATTERN = /^Last pushed:\s*(.+)$/;
const TIP_LINE_PATTERN = /^-\s*(.+)$/;
const DRIFTED_PATTERN = /^(.+?)\s*\(drifted:\s*stored=(\S+)\s+current=(\S+)\)$/;
const PENDING_PATTERN = /^(.+?)\s*\(pending rebuild\)$/;
const MISSING_PATTERN = /^(.+?)\s*\(missing\)$/;
const CURRENT_PATTERN = /^(.+?)\s*\(([0-9a-f]+)\)$/;

/** Parses a single `  - <name> (...)` tip line into an {@link IntegrationTip}. */
function parseTipLine(body: string): IntegrationTip | undefined {
	const drifted = DRIFTED_PATTERN.exec(body);
	if (drifted) {
		return { name: drifted[1].trim(), status: 'drifted', storedHash: drifted[2], currentHash: drifted[3] };
	}
	const pending = PENDING_PATTERN.exec(body);
	if (pending) {
		return { name: pending[1].trim(), status: 'pending' };
	}
	const missing = MISSING_PATTERN.exec(body);
	if (missing) {
		return { name: missing[1].trim(), status: 'missing' };
	}
	const current = CURRENT_PATTERN.exec(body);
	if (current) {
		return { name: current[1].trim(), status: 'current', storedHash: current[2] };
	}
	return undefined;
}

/** Extracts a single header field value matching `pattern` from `lines`. */
function findHeaderField(lines: string[], pattern: RegExp): string | undefined {
	for (const line of lines) {
		const match = pattern.exec(line.trim());
		if (match) {
			return match[1].trim();
		}
	}
	return undefined;
}

/** Collects parsed tips from all `  - ...` lines following the `Tips:` header. */
function parseTips(lines: string[]): IntegrationTip[] {
	const tips: IntegrationTip[] = [];
	for (const line of lines) {
		const match = TIP_LINE_PATTERN.exec(line.trim());
		if (!match) {
			continue;
		}
		const tip = parseTipLine(match[1].trim());
		if (tip) {
			tips.push(tip);
		}
	}
	return tips;
}

/**
 * Parses `gs integration show` output. Returns `undefined` when no integration
 * branch is configured (or the output is empty/unrecognized), and a populated
 * {@link IntegrationState} otherwise.
 */
export function parseIntegrationState(output: string | undefined): IntegrationState | undefined {
	if (typeof output !== 'string' || output.trim().length === 0) {
		return undefined;
	}
	const lines = output.split('\n');
	const name = findHeaderField(lines, INTEGRATION_BRANCH_PATTERN);
	if (!name) {
		return undefined;
	}
	const tips = parseTips(lines);
	return {
		name,
		upstreamBranch: findHeaderField(lines, UPSTREAM_BRANCH_PATTERN),
		lastPushedHash: findHeaderField(lines, LAST_PUSHED_PATTERN),
		tips,
		needsRebuild: tips.some((tip) => tip.status !== 'current'),
	};
}
