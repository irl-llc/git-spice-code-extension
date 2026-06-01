/**
 * Capability detection for the git-spice integration-branch feature.
 *
 * The integration-branch feature is a beta addition to git-spice (see
 * ed-irl/git-spice). It is not present in stock upstream builds, so the
 * extension must detect whether the resolved `gs` binary supports it before
 * exposing any integration UI. We probe `gs --help`, whose top-level command
 * listing includes an `integration` command group only when the feature is
 * compiled in.
 *
 * Detection lives in a pure function so it can be unit-tested without spawning
 * a process or importing the `vscode` module. The thin exec wrapper that runs
 * the probe is in {@link ./gitSpice}.
 */

/**
 * Matches the `integration` command group entry in `gs --help` output.
 *
 * Stock git-spice never lists an `integration` command, so the presence of the
 * group is a reliable, version-agnostic signal. We anchor on the `(int)` alias
 * token to avoid false positives from prose that merely mentions the word
 * "integration" (e.g. the unrelated "CI/CD integration commands" help line).
 */
const INTEGRATION_COMMAND_PATTERN = /\bintegration\s+\(int\)/;

/**
 * Matches ANSI SGR/CSI escape sequences (e.g. color codes) so they can be
 * stripped before pattern-matching. Forced-color environments
 * (`CLICOLOR_FORCE`, `FORCE_COLOR`) can colorize `gs --help` output, which would
 * otherwise inject escape codes between the `integration` and `(int)` tokens
 * and defeat {@link INTEGRATION_COMMAND_PATTERN}.
 */
const ANSI_ESCAPE_PATTERN = /\[[0-9;]*[A-Za-z]/g;

/**
 * Returns true when `gs --help` output advertises the integration-branch
 * command group, i.e. the resolved binary supports the feature.
 *
 * Pure function: takes the captured stdout (and tolerates undefined/empty for
 * the failure-to-probe case) and returns a boolean. ANSI color escapes are
 * stripped first so forced-color environments still match. No I/O.
 */
export function parseIntegrationSupport(helpOutput: string | undefined): boolean {
	if (typeof helpOutput !== 'string' || helpOutput.length === 0) {
		return false;
	}
	const cleanOutput = helpOutput.replace(ANSI_ESCAPE_PATTERN, '');
	return INTEGRATION_COMMAND_PATTERN.test(cleanOutput);
}
