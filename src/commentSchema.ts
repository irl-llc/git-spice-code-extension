/**
 * Type definitions and a defensive parser for the per-comment inline-comment
 * data emitted by `gs branch comment list --json` (NDJSON `jsonComment`
 * objects). This is the data-layer foundation for showing forge comments
 * inline in diff interfaces (issue #40); rendering via a CommentController is a
 * deliberate follow-up and lives elsewhere.
 *
 * The shape mirrors the upstream `jsonComment` struct in git-spice's
 * `branch_comment_list.go` at the pinned SHA. Every field is validated and
 * malformed entries are dropped rather than throwing, matching the resilience
 * of `parseGitSpiceBranches`.
 */

/** Whether a comment was authored locally (staged) or fetched from the forge. */
export type InlineCommentKind = 'staged' | 'forge';

/** Granularity a comment is attached to. */
export type InlineCommentScope = 'pr' | 'file' | 'line';

/** Diff side a line-scoped comment is anchored to. */
export type InlineCommentSide = 'left' | 'right';

/** Coarse lifecycle status retained by upstream for back-compat. */
export type InlineCommentStatus = 'open' | 'resolved' | 'outdated';

/** Inclusive multi-line range for a comment spanning more than one line. */
export type InlineCommentRange = Readonly<{
	start: number;
	end: number;
}>;

/** A single inline comment on a Change Request. */
export type InlineComment = Readonly<{
	kind: InlineCommentKind;
	id: string;
	scope: InlineCommentScope;
	body: string;
	path?: string;
	line?: number;
	range?: InlineCommentRange;
	side?: InlineCommentSide;
	commitSha?: string;
	threadId?: string;
	author?: string;
	resolved?: boolean;
	stale?: boolean;
	status?: InlineCommentStatus;
	createdAt?: string;
}>;

type UnknownRecord = Record<string, unknown>;

/**
 * Parses NDJSON inline-comment output from `gs branch comment list --json`.
 * Invalid JSON lines and malformed entries are skipped; never throws.
 */
export function parseInlineComments(raw: string): InlineComment[] {
	const comments: InlineComment[] = [];
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.length === 0) continue;
		const parsed = safeParse(trimmed);
		const comment = parsed ? toInlineComment(parsed) : undefined;
		if (comment) comments.push(comment);
	}
	return comments;
}

function safeParse(value: string): UnknownRecord | undefined {
	try {
		const parsed: unknown = JSON.parse(value);
		return isRecord(parsed) ? parsed : undefined;
	} catch (error) {
		console.error('Failed to parse git-spice comment json line', error);
		return undefined;
	}
}

/** Required-field gate; returns undefined for any entry missing kind/id/scope. */
function toInlineComment(input: UnknownRecord): InlineComment | undefined {
	const kind = readKind(input.kind);
	const id = readString(input.id);
	const scope = readScope(input.scope);
	const body = readString(input.body);
	if (!kind || !id || !scope || body === undefined) return undefined;
	return { kind, id, scope, body, ...readOptionalFields(input) };
}

/** Assembles the optional fields, omitting any that are absent or malformed. */
function readOptionalFields(input: UnknownRecord): Partial<InlineComment> {
	return {
		...definedField('path', readString(input.path)),
		...definedField('line', readNumber(input.line)),
		...definedField('range', readRange(input.range)),
		...definedField('side', readSide(input.side)),
		...definedField('commitSha', readString(input.commitSHA)),
		...definedField('threadId', readString(input.threadID)),
		...definedField('author', readString(input.author)),
		...definedField('resolved', readBoolean(input.resolved)),
		...definedField('stale', readBoolean(input.stale)),
		...definedField('status', readStatus(input.status)),
		...definedField('createdAt', readString(input.createdAt)),
	};
}

/** Wraps a value as a single-key object, or empty when the value is undefined. */
function definedField<K extends string, V>(key: K, value: V | undefined): Record<K, V> | Record<string, never> {
	return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function readKind(value: unknown): InlineCommentKind | undefined {
	return value === 'staged' || value === 'forge' ? value : undefined;
}

function readScope(value: unknown): InlineCommentScope | undefined {
	return value === 'pr' || value === 'file' || value === 'line' ? value : undefined;
}

function readSide(value: unknown): InlineCommentSide | undefined {
	if (typeof value !== 'string') return undefined;
	const lower = value.toLowerCase();
	return lower === 'left' || lower === 'right' ? lower : undefined;
}

function readStatus(value: unknown): InlineCommentStatus | undefined {
	return value === 'open' || value === 'resolved' || value === 'outdated' ? value : undefined;
}

function readRange(value: unknown): InlineCommentRange | undefined {
	if (!isRecord(value)) return undefined;
	const start = readNumber(value.start);
	const end = readNumber(value.end);
	if (start === undefined || end === undefined || start > end) return undefined;
	return { start, end };
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
	// Line/range values are non-negative integers; reject floats and negatives.
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}
