/** Default git-spice executable, resolved on the user's PATH. */
export const DEFAULT_GIT_SPICE_BINARY = 'git-spice';

/** Returns a trimmed, non-empty string, or undefined for any other value. */
function asNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolves which git-spice executable to invoke.
 *
 * Precedence:
 *  1. `configuredPath` — the `git-spice.path` setting, when set to a non-empty string.
 *  2. `envBin` — the `GIT_SPICE_BIN` environment variable (used by the test harness/CI).
 *  3. {@link DEFAULT_GIT_SPICE_BINARY} on the PATH.
 *
 * `configuredPath` is typed `unknown` because VS Code does not enforce the
 * settings schema at runtime — a user can put any JSON value in `settings.json`.
 * Non-string (or empty/whitespace) values are treated as unset rather than throwing.
 *
 * This is a pure function so it can be unit-tested without the `vscode` module.
 */
export function resolveGitSpiceBinary(configuredPath: unknown, envBin: string | undefined): string {
	return asNonEmptyString(configuredPath) ?? asNonEmptyString(envBin) ?? DEFAULT_GIT_SPICE_BINARY;
}
