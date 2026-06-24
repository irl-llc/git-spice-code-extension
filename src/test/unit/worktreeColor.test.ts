import * as assert from 'assert';
import {
	WORKTREE_COLOR_COUNT,
	worktreeColorClass,
	worktreeColorIndex,
	worktreeLabel,
} from '../../utils/worktreeColor';

describe('worktreeColor', () => {
	describe('worktreeColorIndex', () => {
		it('returns an index within the palette range', () => {
			const paths = ['/home/u/repo', '/tmp/wt-a', 'C:\\Users\\u\\repo', '', '/x'];
			for (const p of paths) {
				const idx = worktreeColorIndex(p);
				assert.ok(Number.isInteger(idx), `index for ${p} must be an integer`);
				assert.ok(idx >= 0 && idx < WORKTREE_COLOR_COUNT, `index ${idx} out of range for ${p}`);
			}
		});

		it('is deterministic: same path always yields the same index', () => {
			const p = '/home/u/workspaces/repo-wt-feature';
			assert.strictEqual(worktreeColorIndex(p), worktreeColorIndex(p));
		});

		it('spreads distinct paths across multiple slots (no single-bucket collapse)', () => {
			const slots = new Set<number>();
			for (let i = 0; i < 40; i++) {
				slots.add(worktreeColorIndex(`/home/u/repo-wt-${i}`));
			}
			// A healthy hash should reach most of the palette; require > half.
			assert.ok(slots.size > WORKTREE_COLOR_COUNT / 2, `only used ${slots.size} of ${WORKTREE_COLOR_COUNT} slots`);
		});
	});

	describe('worktreeColorClass', () => {
		it('formats the class as tag-wt-<index>', () => {
			const p = '/tmp/wt-a';
			assert.strictEqual(worktreeColorClass(p), `tag-wt-${worktreeColorIndex(p)}`);
		});
	});

	describe('worktreeLabel', () => {
		it('returns the final path segment for posix paths', () => {
			assert.strictEqual(worktreeLabel('/home/u/repo-wt-a'), 'repo-wt-a');
		});

		it('returns the final segment for windows paths', () => {
			assert.strictEqual(worktreeLabel('C:\\Users\\u\\repo-wt-a'), 'repo-wt-a');
		});

		it('tolerates trailing separators', () => {
			assert.strictEqual(worktreeLabel('/home/u/repo-wt-a/'), 'repo-wt-a');
		});

		it('falls back to the whole string when there is no separator', () => {
			assert.strictEqual(worktreeLabel('repo-wt-a'), 'repo-wt-a');
		});
	});
});
