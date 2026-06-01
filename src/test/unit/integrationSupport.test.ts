/**
 * Unit tests for integrationSupport.ts
 *
 * Verifies the pure capability-detection function that decides whether the
 * resolved git-spice binary advertises the beta integration-branch feature.
 */

import * as assert from 'assert';

import { parseIntegrationSupport } from '../../utils/integrationSupport';

// Abridged `gs --help` from a build WITH the integration feature
// (ed-irl/git-spice). The `integration (int)` group entries are the signal.
const HELP_WITH_INTEGRATION = `Usage: gs <command> [flags]

Commands:
  init                             Initialize a repository

Integration
  integration (int) show           Show the configured integration branch
  integration (int) create (c)     Configure the integration branch
  integration (int) tip add (a)    Add a branch to the integration tip list

CI
  ci merge-guard                   CI/CD integration commands
`;

// Abridged stock upstream `gs --help`: no integration command group. The
// "CI/CD integration commands" prose mentions "integration" but must not match.
const HELP_WITHOUT_INTEGRATION = `Usage: gs <command> [flags]

Commands:
  init                             Initialize a repository

CI
  ci merge-guard                   CI/CD integration commands
`;

describe('integrationSupport', () => {
	describe('parseIntegrationSupport', () => {
		it('returns true when the integration command group is present', () => {
			assert.strictEqual(parseIntegrationSupport(HELP_WITH_INTEGRATION), true);
		});

		it('returns false for a stock build lacking the integration command', () => {
			assert.strictEqual(parseIntegrationSupport(HELP_WITHOUT_INTEGRATION), false);
		});

		it('does not match prose that merely mentions the word integration', () => {
			assert.strictEqual(parseIntegrationSupport('CI/CD integration commands'), false);
		});

		it('returns false for empty or undefined probe output', () => {
			assert.strictEqual(parseIntegrationSupport(''), false);
			assert.strictEqual(parseIntegrationSupport(undefined), false);
		});

		it('matches the integration alias token regardless of surrounding whitespace', () => {
			assert.strictEqual(parseIntegrationSupport('  integration   (int) show  '), true);
		});
	});
});
