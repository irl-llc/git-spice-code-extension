/**
 * Unit tests for the watcher refresh throttle (issue #71): a `gs stack submit`
 * event storm must collapse into bounded refreshes.
 */

import * as assert from 'assert';

import { decideRefresh, type ThrottleInputs } from '../../stackView/refreshThrottle';

function inputs(overrides: Partial<ThrottleInputs> = {}): ThrottleInputs {
	return {
		now: 100_000,
		lastRefreshAt: 0,
		minIntervalMs: 1500,
		gitOpInProgress: false,
		gitOpRecheckMs: 1500,
		...overrides,
	};
}

describe('decideRefresh', () => {
	it('defers while a git operation is in progress, regardless of elapsed time', () => {
		const d = decideRefresh(inputs({ gitOpInProgress: true, lastRefreshAt: 0, gitOpRecheckMs: 1500 }));
		assert.deepStrictEqual(d, { refresh: false, deferMs: 1500 });
	});

	it('refreshes when at least the min interval has elapsed', () => {
		const d = decideRefresh(inputs({ now: 100_000, lastRefreshAt: 98_000, minIntervalMs: 1500 }));
		assert.deepStrictEqual(d, { refresh: true });
	});

	it('refreshes on the very first event (lastRefreshAt = 0)', () => {
		const d = decideRefresh(inputs({ now: 5_000, lastRefreshAt: 0 }));
		assert.deepStrictEqual(d, { refresh: true });
	});

	it('defers by the remaining time when too soon since the last refresh', () => {
		const d = decideRefresh(inputs({ now: 100_500, lastRefreshAt: 100_000, minIntervalMs: 1500 }));
		assert.deepStrictEqual(d, { refresh: false, deferMs: 1000 });
	});

	it('a burst of events within one interval yields exactly one refresh', () => {
		// After a refresh at t=100_000, four more events arrive 300ms apart —
		// all within the 1500ms floor — so each defers, not refreshes.
		const lastRefreshAt = 100_000;
		const burst = [100_300, 100_600, 100_900, 101_200];
		const decisions = burst.map((now) => decideRefresh(inputs({ now, lastRefreshAt, minIntervalMs: 1500 })));
		assert.ok(
			decisions.every((d) => !d.refresh),
			'every in-interval event defers',
		);
		// Only an event past the floor refreshes again.
		assert.deepStrictEqual(decideRefresh(inputs({ now: 101_600, lastRefreshAt, minIntervalMs: 1500 })), {
			refresh: true,
		});
	});
});
