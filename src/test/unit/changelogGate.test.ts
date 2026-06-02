/**
 * Unit tests for changelogGate.ts — the CI change-fragment gate decision logic.
 */

import * as assert from 'assert';

import { evaluateChangelogGate, SKIP_LABEL, UNRELEASED_DIR, type GateInput } from '../../utils/changelogGate';

function input(overrides: Partial<GateInput>): GateInput {
	return {
		changedPaths: [],
		addedPaths: [],
		labels: [],
		...overrides,
	};
}

describe('changelogGate', () => {
	describe('evaluateChangelogGate', () => {
		it('passes when a fragment is added alongside source changes', () => {
			const fragment = `${UNRELEASED_DIR}fix-flicker.yaml`;
			const decision = evaluateChangelogGate(
				input({
					changedPaths: ['src/stackView/state.ts', fragment],
					addedPaths: [fragment],
				}),
			);
			assert.strictEqual(decision.kind, 'pass');
		});

		it('fails when source changes ship without a fragment', () => {
			const decision = evaluateChangelogGate(
				input({
					changedPaths: ['src/stackView/state.ts'],
					addedPaths: ['src/stackView/state.ts'],
				}),
			);
			assert.strictEqual(decision.kind, 'fail');
			assert.ok(decision.reason.includes('src/stackView/state.ts'));
		});

		it('skips when only docs/CI/non-release files changed', () => {
			const decision = evaluateChangelogGate(
				input({
					changedPaths: ['docs/guide.md', '.github/workflows/ci.yml', 'README.md'],
					addedPaths: ['docs/guide.md'],
				}),
			);
			assert.strictEqual(decision.kind, 'skip');
		});

		it('skips when the skip-changelog label is present even with source changes', () => {
			const decision = evaluateChangelogGate(
				input({
					changedPaths: ['src/extension.ts'],
					addedPaths: [],
					labels: [SKIP_LABEL],
				}),
			);
			assert.strictEqual(decision.kind, 'skip');
			assert.ok(decision.reason.includes(SKIP_LABEL));
		});

		it('does not count the .gitkeep placeholder as a fragment', () => {
			const decision = evaluateChangelogGate(
				input({
					changedPaths: ['src/extension.ts', `${UNRELEASED_DIR}.gitkeep`],
					addedPaths: [`${UNRELEASED_DIR}.gitkeep`],
				}),
			);
			assert.strictEqual(decision.kind, 'fail');
		});

		it('treats a modified (not added) fragment as no new fragment', () => {
			const fragment = `${UNRELEASED_DIR}existing.yaml`;
			const decision = evaluateChangelogGate(
				input({
					changedPaths: ['src/extension.ts', fragment],
					addedPaths: [],
				}),
			);
			assert.strictEqual(decision.kind, 'fail');
		});

		it('skips a markdown-only doc PR anywhere in the tree', () => {
			const decision = evaluateChangelogGate(
				input({
					changedPaths: ['src/stackView/NOTES.md'],
					addedPaths: ['src/stackView/NOTES.md'],
				}),
			);
			assert.strictEqual(decision.kind, 'skip');
		});

		it('label opt-out takes precedence over an added fragment', () => {
			const fragment = `${UNRELEASED_DIR}added.yaml`;
			const decision = evaluateChangelogGate(
				input({
					changedPaths: ['src/extension.ts', fragment],
					addedPaths: [fragment],
					labels: [SKIP_LABEL],
				}),
			);
			assert.strictEqual(decision.kind, 'skip');
		});

		it('skips lockfile / tooling-config-only changes (e.g. dependency bots)', () => {
			const decision = evaluateChangelogGate(
				input({
					changedPaths: ['package-lock.json', 'tsconfig.json'],
					addedPaths: [],
				}),
			);
			assert.strictEqual(decision.kind, 'skip');
		});

		it('treats non-release config dotfiles as non-release at any depth (by basename)', () => {
			const decision = evaluateChangelogGate(
				input({
					changedPaths: ['packages/web/.gitignore', 'packages/web/.prettierrc'],
					addedPaths: [],
				}),
			);
			assert.strictEqual(decision.kind, 'skip');
		});
	});
});
