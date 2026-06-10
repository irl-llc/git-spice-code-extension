/**
 * Unit tests for the watch-driven refresh coalescing helpers (issue #71): a
 * `gs stack submit` storm is held while git-op marker files are present and
 * fires once they clear, with no fixed delay.
 */

import * as assert from 'assert';

import { GIT_OP_MARKERS, isGitOpMarkerPath, shouldRefreshNow } from '../../stackView/refreshThrottle';

describe('isGitOpMarkerPath', () => {
	it('recognizes the marker files by basename', () => {
		assert.ok(isGitOpMarkerPath('/repo/.git/index.lock'));
		assert.ok(isGitOpMarkerPath('/repo/.git/MERGE_HEAD'));
		assert.ok(isGitOpMarkerPath('/repo/.git/CHERRY_PICK_HEAD'));
		assert.ok(isGitOpMarkerPath('/repo/.git/REVERT_HEAD'));
	});

	it('recognizes paths inside a marker directory', () => {
		assert.ok(isGitOpMarkerPath('/repo/.git/rebase-merge/done'));
		assert.ok(isGitOpMarkerPath('/repo/.git/rebase-apply/patch'));
		assert.ok(isGitOpMarkerPath('/repo/.git/rebase-merge')); // the dir itself
	});

	it('handles Windows-style backslash separators', () => {
		assert.ok(isGitOpMarkerPath('C:\\repo\\.git\\index.lock'));
		assert.ok(isGitOpMarkerPath('C:\\repo\\.git\\rebase-merge\\done'));
	});

	it('does not flag real ref/index changes', () => {
		assert.ok(!isGitOpMarkerPath('/repo/.git/index'));
		assert.ok(!isGitOpMarkerPath('/repo/.git/HEAD'));
		assert.ok(!isGitOpMarkerPath('/repo/.git/refs/heads/main'));
		assert.ok(!isGitOpMarkerPath('/repo/.git/refs/spice/data'));
	});

	it('exports the marker list it matches on', () => {
		assert.ok(GIT_OP_MARKERS.includes('index.lock'));
		assert.ok(GIT_OP_MARKERS.includes('rebase-merge'));
	});
});

describe('shouldRefreshNow', () => {
	it('refreshes when a change is pending and no git op is in progress', () => {
		assert.strictEqual(shouldRefreshNow(true, false), true);
	});

	it('holds the refresh while a git op is in progress (any elapsed time)', () => {
		assert.strictEqual(shouldRefreshNow(true, true), false);
	});

	it('does nothing when no change is pending', () => {
		assert.strictEqual(shouldRefreshNow(false, false), false);
		assert.strictEqual(shouldRefreshNow(false, true), false);
	});
});
