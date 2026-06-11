/**
 * Unit tests for the watch-driven refresh coalescing helpers (issue #71): a
 * `gs stack submit` storm is held while git-op marker files are present and
 * fires once they clear, with no fixed delay.
 */

import * as assert from 'assert';

import {
	GIT_OP_MARKERS,
	isGitOpMarkerPath,
	OperationCounter,
	RefreshRateLimiter,
	shouldRefreshNow,
} from '../../stackView/refreshThrottle';

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

describe('OperationCounter', () => {
	it('reports in-progress between begin and end', () => {
		const ops = new OperationCounter();
		assert.strictEqual(ops.inProgress, false);
		ops.begin();
		assert.strictEqual(ops.inProgress, true);
		assert.strictEqual(ops.end(), true); // reached idle
		assert.strictEqual(ops.inProgress, false);
	});

	it('stays in-progress until the LAST nested op ends (submit-with-restack)', () => {
		const ops = new OperationCounter();
		ops.begin();
		ops.begin();
		assert.strictEqual(ops.end(), false); // one still in flight
		assert.strictEqual(ops.inProgress, true);
		assert.strictEqual(ops.end(), true); // now idle
		assert.strictEqual(ops.inProgress, false);
	});

	it('never goes negative when end is called while already idle', () => {
		const ops = new OperationCounter();
		assert.strictEqual(ops.end(), true);
		assert.strictEqual(ops.inProgress, false);
		ops.begin();
		assert.strictEqual(ops.inProgress, true);
	});
});

describe('RefreshRateLimiter', () => {
	it('fires immediately on the leading edge (no added latency for a lone change)', () => {
		const limiter = new RefreshRateLimiter(2000);
		assert.strictEqual(limiter.tryAcquire(10_000), 0);
	});

	it('defers a second refresh inside the interval to the trailing edge', () => {
		const limiter = new RefreshRateLimiter(2000);
		assert.strictEqual(limiter.tryAcquire(10_000), 0);
		assert.strictEqual(limiter.tryAcquire(10_500), 1500); // wait the remainder
		assert.strictEqual(limiter.tryAcquire(11_999), 1); // still inside
	});

	it('allows the next refresh once the interval has elapsed', () => {
		const limiter = new RefreshRateLimiter(2000);
		assert.strictEqual(limiter.tryAcquire(10_000), 0);
		assert.strictEqual(limiter.tryAcquire(12_000), 0);
		assert.strictEqual(limiter.tryAcquire(12_100), 1900); // new window from 12_000
	});

	it('a sustained storm collapses to one refresh per interval', () => {
		const limiter = new RefreshRateLimiter(2000);
		let fired = 0;
		// Events every 300ms (the debounce cadence) for 10 seconds.
		for (let now = 0; now <= 10_000; now += 300) {
			if (limiter.tryAcquire(now) === 0) fired++;
		}
		// 0, 2100, 4200, 6300, 8400 — bounded to ~1 per 2s, not 34.
		assert.ok(fired <= 6, `fired ${fired} times; expected at most 6`);
	});
});
