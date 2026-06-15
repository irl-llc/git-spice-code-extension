/**
 * Unit tests for integrationState.ts
 *
 * Verifies the pure parser that turns `gs integration show` text output into a
 * structured {@link IntegrationState}. The fixtures mirror the exact line
 * formats emitted by abhinav/git-spice's integration command group.
 */

import * as assert from 'assert';

import { parseIntegrationState } from '../../utils/integrationState';

// Configured + rebuilt, with one drifted tip and one up-to-date tip.
const SHOW_DRIFTED = `Integration branch: integ
Last pushed: 8f6661d
Tips:
  - feat-a (drifted: stored=8f6661d current=384a064)
  - feat-b (4e5d399)`;

// Newly configured, never rebuilt: every tip is pending.
const SHOW_PENDING = `Integration branch: integ
Tips:
  - feat-a (pending rebuild)
  - feat-b (pending rebuild)`;

// Configured with an upstream rename and a missing tip.
const SHOW_UPSTREAM_MISSING = `Integration branch: integ
Upstream branch: origin-integ
Tips:
  - feat-a (8f6661d)
  - gone (missing)`;

// All tips up to date.
const SHOW_CURRENT = `Integration branch: integ
Tips:
  - feat-a (8f6661d)
  - feat-b (4e5d399)`;

// What gs prints when nothing is configured.
const SHOW_NOT_CONFIGURED = `No integration branch configured.
Run 'gs integration create <name>' to configure one.`;

describe('integrationState', () => {
	describe('parseIntegrationState', () => {
		it('parses the integration branch name', () => {
			const state = parseIntegrationState(SHOW_CURRENT);
			assert.strictEqual(state?.name, 'integ');
		});

		it('parses a drifted tip with stored and current hashes', () => {
			const state = parseIntegrationState(SHOW_DRIFTED);
			assert.deepStrictEqual(state?.tips[0], {
				name: 'feat-a',
				status: 'drifted',
				storedHash: '8f6661d',
				currentHash: '384a064',
			});
		});

		it('parses an up-to-date tip with only a stored hash', () => {
			const state = parseIntegrationState(SHOW_DRIFTED);
			assert.deepStrictEqual(state?.tips[1], { name: 'feat-b', status: 'current', storedHash: '4e5d399' });
		});

		it('parses pending tips and reports needsRebuild', () => {
			const state = parseIntegrationState(SHOW_PENDING);
			assert.strictEqual(state?.tips.length, 2);
			assert.strictEqual(
				state?.tips.every((t) => t.status === 'pending'),
				true,
			);
			assert.strictEqual(state?.needsRebuild, true);
		});

		it('parses upstream branch and a missing tip', () => {
			const state = parseIntegrationState(SHOW_UPSTREAM_MISSING);
			assert.strictEqual(state?.upstreamBranch, 'origin-integ');
			assert.deepStrictEqual(state?.tips[1], { name: 'gone', status: 'missing' });
		});

		it('parses the last-pushed hash header', () => {
			const state = parseIntegrationState(SHOW_DRIFTED);
			assert.strictEqual(state?.lastPushedHash, '8f6661d');
		});

		it('reports needsRebuild false when every tip is current', () => {
			const state = parseIntegrationState(SHOW_CURRENT);
			assert.strictEqual(state?.needsRebuild, false);
		});

		it('returns undefined when no integration branch is configured', () => {
			assert.strictEqual(parseIntegrationState(SHOW_NOT_CONFIGURED), undefined);
		});

		it('returns undefined for empty or undefined output', () => {
			assert.strictEqual(parseIntegrationState(''), undefined);
			assert.strictEqual(parseIntegrationState('   \n  '), undefined);
			assert.strictEqual(parseIntegrationState(undefined), undefined);
		});
	});
});
