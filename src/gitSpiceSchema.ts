export type GitSpiceChangeStatus = 'open' | 'closed' | 'merged';

export type GitSpiceBranchLink = Readonly<{
	name: string;
	needsRestack?: boolean;
}>;

export type GitSpiceCommit = Readonly<{
	sha: string;
	subject: string;
}>;

export type GitSpiceComments = Readonly<{
	total: number;
	resolved: number;
	unresolved: number;
}>;

/**
 * Rolled-up CI/checks state for a change, driving the card build-status
 * indicator. Deliberately collapsed to four values (the upstream contract
 * agreed in issue #63): `success`/`failure`/`pending` plus `none` (no checks
 * reported, distinct from "all passed"). Forge-native fidelity lives in
 * {@link GitSpiceCheckRun.state}, not here.
 */
export type GitSpiceChecksRollup = 'success' | 'failure' | 'pending' | 'none';

/**
 * A single CI check/run. `state` is the raw forge-native string (e.g.
 * `success`, `failure`, `neutral`, `cancelled`, `in_progress`) so future
 * detail surfaces can render per-run nuance the rollup intentionally drops.
 */
export type GitSpiceCheckRun = Readonly<{
	name: string;
	state: string;
	url?: string;
}>;

/**
 * CI/checks information for a change. `rollup` drives the card indicator;
 * `runs[]` carries forge-native per-check detail for future surfaces; `url`
 * is the forge checks-summary page used as the indicator's click target.
 */
export type GitSpiceChecks = Readonly<{
	rollup: GitSpiceChecksRollup;
	runs?: ReadonlyArray<GitSpiceCheckRun>;
	url?: string;
}>;

export type GitSpiceChange = Readonly<{
	id: string;
	url: string;
	status?: GitSpiceChangeStatus;
	comments?: GitSpiceComments;
	checks?: GitSpiceChecks;
}>;

export type GitSpicePush = Readonly<{
	ahead: number;
	behind: number;
	needsPush?: boolean;
}>;

export type GitSpiceBranch = Readonly<{
	name: string;
	current?: boolean;
	down?: GitSpiceBranchLink;
	ups?: ReadonlyArray<GitSpiceBranchLink>;
	commits?: ReadonlyArray<GitSpiceCommit>;
	change?: GitSpiceChange;
	push?: GitSpicePush;
}>;

export function parseGitSpiceBranches(raw: string): GitSpiceBranch[] {
	const branches: GitSpiceBranch[] = [];

	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			continue;
		}

		const parsed = safeParse(trimmed);
		if (!parsed) {
			continue;
		}

		const branch = toBranch(parsed);
		if (branch) {
			branches.push(branch);
		}
	}

	return branches;
}

type UnknownRecord = Record<string, unknown>;

function safeParse(value: string): UnknownRecord | undefined {
	try {
		const parsed = JSON.parse(value);
		return typeof parsed === 'object' && parsed !== null ? (parsed as UnknownRecord) : undefined;
	} catch (error) {
		console.error('Failed to parse git-spice json line', error);
		return undefined;
	}
}

function toBranch(input: UnknownRecord): GitSpiceBranch | undefined {
	const name = readString(input.name);
	if (!name) {
		return undefined;
	}

	return {
		name,
		current: readBoolean(input.current) === true ? true : undefined,
		down: readBranchLink(input.down),
		ups: readBranchLinks(input.ups),
		commits: readCommits(input.commits),
		change: readChange(input.change),
		push: readPush(input.push),
	};
}

function readBranchLink(value: unknown): GitSpiceBranchLink | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const name = readString(value.name);
	if (!name) {
		return undefined;
	}

	const needsRestack = readBoolean(value.needsRestack) === true ? true : undefined;
	return { name, needsRestack };
}

function readBranchLinks(value: unknown): ReadonlyArray<GitSpiceBranchLink> | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const links = value
		.map((entry) => readBranchLink(entry))
		.filter((link): link is GitSpiceBranchLink => link !== undefined);

	return links.length > 0 ? links : undefined;
}

function readCommits(value: unknown): ReadonlyArray<GitSpiceCommit> | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const commits = value
		.map((entry) => readCommit(entry))
		.filter((commit): commit is GitSpiceCommit => commit !== undefined);

	return commits.length > 0 ? commits : undefined;
}

function readCommit(value: unknown): GitSpiceCommit | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const sha = readString(value.sha);
	const subject = readString(value.subject);

	if (!sha || !subject) {
		return undefined;
	}

	return { sha, subject };
}

function readChange(value: unknown): GitSpiceChange | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const id = readString(value.id);
	const url = readString(value.url);
	if (!id || !url) {
		return undefined;
	}

	const status = readChangeStatus(value.status);
	const comments = readComments(value.comments);
	const checks = readChecks(value.checks);

	return {
		id,
		url,
		...(status && { status }),
		...(comments && { comments }),
		...(checks && { checks }),
	};
}

function readChecks(value: unknown): GitSpiceChecks | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const rollup = readChecksRollup(value.rollup);
	if (!rollup) {
		return undefined;
	}

	const runs = readCheckRuns(value.runs);
	const url = readString(value.url);

	return {
		rollup,
		...(runs && { runs }),
		...(url && { url }),
	};
}

function readChecksRollup(value: unknown): GitSpiceChecksRollup | undefined {
	if (value === 'success' || value === 'failure' || value === 'pending' || value === 'none') {
		return value;
	}

	return undefined;
}

function readCheckRuns(value: unknown): ReadonlyArray<GitSpiceCheckRun> | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const runs = value.map((entry) => readCheckRun(entry)).filter((run): run is GitSpiceCheckRun => run !== undefined);

	return runs.length > 0 ? runs : undefined;
}

function readCheckRun(value: unknown): GitSpiceCheckRun | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const name = readString(value.name);
	const state = readString(value.state);
	if (!name || !state) {
		return undefined;
	}

	const url = readString(value.url);
	return { name, state, ...(url && { url }) };
}

function readComments(value: unknown): GitSpiceComments | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const total = readNumber(value.total);
	const resolved = readNumber(value.resolved);
	const unresolved = readNumber(value.unresolved);

	const isMissing = total === undefined || resolved === undefined || unresolved === undefined;
	const isInconsistent = !isMissing && resolved + unresolved !== total;
	if (isMissing || isInconsistent) {
		return undefined;
	}

	return { total, resolved, unresolved };
}

function readChangeStatus(value: unknown): GitSpiceChangeStatus | undefined {
	if (value === 'open' || value === 'closed' || value === 'merged') {
		return value;
	}

	return undefined;
}

function readPush(value: unknown): GitSpicePush | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const ahead = readNumber(value.ahead);
	const behind = readNumber(value.behind);
	if (ahead === undefined || behind === undefined) {
		return undefined;
	}

	const needsPush = readBoolean(value.needsPush) === true ? true : undefined;
	return { ahead, behind, needsPush };
}

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
