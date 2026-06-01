/**
 * Unit tests for integrationMenu.ts
 *
 * Verifies the pure helpers that compose the integration tip-list entries of
 * the branch context menu (the beta ed-irl/git-spice feature; see #39).
 */

import * as assert from 'assert';

import {
	buildIntegrationMenuItems,
	INTEGRATION_TIP_ADD_ACTION,
	INTEGRATION_TIP_REMOVE_ACTION,
	isIntegrationTip,
} from '../../stackView/integrationMenu';
import type { IntegrationState } from '../../utils/integrationState';

const STATE: IntegrationState = {
	name: 'integ',
	tips: [
		{ name: 'feat-a', status: 'current', storedHash: '8f6661d' },
		{ name: 'feat-b', status: 'drifted', storedHash: '8f6661d', currentHash: '384a064' },
	],
	needsRebuild: true,
};

describe('isIntegrationTip', () => {
	it('returns true for a configured tip', () => {
		assert.strictEqual(isIntegrationTip('feat-a', STATE), true);
		assert.strictEqual(isIntegrationTip('feat-b', STATE), true);
	});

	it('returns false for a branch outside the tip list', () => {
		assert.strictEqual(isIntegrationTip('feat-c', STATE), false);
	});

	it('returns false when no integration branch is configured', () => {
		assert.strictEqual(isIntegrationTip('feat-a', null), false);
		assert.strictEqual(isIntegrationTip('feat-a', undefined), false);
	});
});

describe('buildIntegrationMenuItems', () => {
	it('returns no items when integration is unconfigured', () => {
		assert.deepStrictEqual(buildIntegrationMenuItems('feat-a', null), []);
		assert.deepStrictEqual(buildIntegrationMenuItems('feat-a', undefined), []);
	});

	it('offers Remove for a branch already in the tip list', () => {
		const items = buildIntegrationMenuItems('feat-a', STATE);
		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].action, INTEGRATION_TIP_REMOVE_ACTION);
		assert.match(items[0].label, /Remove from integration build/);
	});

	it('offers Add for a branch outside the tip list', () => {
		const items = buildIntegrationMenuItems('feat-c', STATE);
		assert.strictEqual(items.length, 1);
		assert.strictEqual(items[0].action, INTEGRATION_TIP_ADD_ACTION);
		assert.match(items[0].label, /Add to integration build/);
	});

	it('returns no items for the integration branch itself', () => {
		// The integration branch is a real branch and may appear in the list,
		// but it cannot be a tip of itself, so it gets no add/remove actions.
		assert.deepStrictEqual(buildIntegrationMenuItems('integ', STATE), []);
	});
});
