/**
 * Unit tests for repoSyncPrompt.ts (the `gs repo sync` prompt parser).
 *
 * Pins the branch-deletion confirmation prompt-text contract: `gs repo sync`
 * emits `Delete <branch>?: [y/N]` for the single closed/merged-branch case.
 * If gs changes that text, `extractBranchFromPrompt` returns undefined and the
 * interactive confirmation is silently bypassed (issue #107) — these tests fail
 * loudly instead.
 */

import * as assert from 'assert';

import { extractBranchFromPrompt } from '../../utils/repoSyncPrompt';

describe('repoSyncPrompt', () => {
	describe('extractBranchFromPrompt', () => {
		it('matches the current gs prompt: Delete <branch>?: [y/N]', () => {
			assert.strictEqual(extractBranchFromPrompt('Delete feature1?: [y/N]'), 'feature1');
		});

		it('matches a branch with a different name', () => {
			assert.strictEqual(extractBranchFromPrompt('Delete feature?: [y/N]'), 'feature');
		});

		it('matches branch names containing slashes', () => {
			assert.strictEqual(extractBranchFromPrompt('Delete feat/login?: [y/N]'), 'feat/login');
		});

		it('still matches the legacy prompt shape', () => {
			assert.strictEqual(extractBranchFromPrompt("Delete branch 'feature1'? [y/N]"), 'feature1');
		});

		it('matches when the prompt is embedded in a larger buffer', () => {
			const buffer = 'INFO syncing branches\nDelete feature1?: [y/N] ';
			assert.strictEqual(extractBranchFromPrompt(buffer), 'feature1');
		});

		it('is case-insensitive on the [y/N] suffix', () => {
			assert.strictEqual(extractBranchFromPrompt('Delete feature1?: [Y/n]'), 'feature1');
		});

		it('returns undefined when no deletion prompt is present', () => {
			assert.strictEqual(extractBranchFromPrompt('2 branches synced'), undefined);
		});

		it('requires the Delete prefix (ignores other [y/N] confirmations)', () => {
			assert.strictEqual(extractBranchFromPrompt('Continue?: [y/N]'), undefined);
		});
	});
});
