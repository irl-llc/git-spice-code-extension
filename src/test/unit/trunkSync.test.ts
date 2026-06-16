import * as assert from 'assert';
import { deriveTrunkSyncState, type TrunkSyncReadings } from '../../utils/trunkSync';

describe('trunkSync', () => {
	describe('deriveTrunkSyncState', () => {
		it('reports remote-unknown when no remote is configured', () => {
			const readings: TrunkSyncReadings = { remoteCount: 0 };
			assert.strictEqual(deriveTrunkSyncState(readings), 'remote-unknown');
		});

		it('prefers remote-unknown over ahead count when no remote exists', () => {
			// Defensive: a 0-remote repo cannot have a meaningful upstream count.
			const readings: TrunkSyncReadings = { remoteCount: 0, commitsAhead: 5 };
			assert.strictEqual(deriveTrunkSyncState(readings), 'remote-unknown');
		});

		it('reports origin-ahead when the upstream has commits the trunk lacks', () => {
			const readings: TrunkSyncReadings = { remoteCount: 1, commitsAhead: 3 };
			assert.strictEqual(deriveTrunkSyncState(readings), 'origin-ahead');
		});

		it('returns undefined when a remote exists and the upstream is not ahead', () => {
			const readings: TrunkSyncReadings = { remoteCount: 1, commitsAhead: 0 };
			assert.strictEqual(deriveTrunkSyncState(readings), undefined);
		});

		it('returns undefined when a remote exists but there is no upstream to compare', () => {
			const readings: TrunkSyncReadings = { remoteCount: 1 };
			assert.strictEqual(deriveTrunkSyncState(readings), undefined);
		});
	});
});
