/**
 * Unit tests for gitSpiceBinary.ts
 * Tests the executable resolution precedence: setting > env var > default.
 */

import * as assert from 'assert';

import { resolveGitSpiceBinary, DEFAULT_GIT_SPICE_BINARY } from '../../utils/gitSpiceBinary';

describe('gitSpiceBinary', () => {
	describe('resolveGitSpiceBinary', () => {
		it('defaults to git-spice when nothing is configured', () => {
			assert.strictEqual(resolveGitSpiceBinary(undefined, undefined), 'git-spice');
			assert.strictEqual(resolveGitSpiceBinary(undefined, undefined), DEFAULT_GIT_SPICE_BINARY);
		});

		it('uses the configured setting when provided', () => {
			assert.strictEqual(resolveGitSpiceBinary('/opt/bin/gs', undefined), '/opt/bin/gs');
		});

		it('uses GIT_SPICE_BIN when no setting is configured', () => {
			assert.strictEqual(resolveGitSpiceBinary(undefined, '/ci/.gs/bin/gs'), '/ci/.gs/bin/gs');
			assert.strictEqual(resolveGitSpiceBinary('', '/ci/.gs/bin/gs'), '/ci/.gs/bin/gs');
		});

		it('prefers the setting over the environment variable', () => {
			assert.strictEqual(resolveGitSpiceBinary('/opt/bin/gs', '/ci/.gs/bin/gs'), '/opt/bin/gs');
		});

		it('treats whitespace-only values as unset', () => {
			assert.strictEqual(resolveGitSpiceBinary('   ', '   '), DEFAULT_GIT_SPICE_BINARY);
			assert.strictEqual(resolveGitSpiceBinary('  ', '/ci/gs'), '/ci/gs');
		});

		it('trims surrounding whitespace from resolved values', () => {
			assert.strictEqual(resolveGitSpiceBinary('  /opt/bin/gs  ', undefined), '/opt/bin/gs');
			assert.strictEqual(resolveGitSpiceBinary(undefined, '  /ci/gs  '), '/ci/gs');
		});

		it('treats non-string configured values as unset (misconfigured settings.json)', () => {
			// VS Code does not enforce the settings schema at runtime, so a user
			// could set git-spice.path to a non-string and we must not throw.
			assert.strictEqual(resolveGitSpiceBinary(true, undefined), DEFAULT_GIT_SPICE_BINARY);
			assert.strictEqual(resolveGitSpiceBinary(123, undefined), DEFAULT_GIT_SPICE_BINARY);
			assert.strictEqual(resolveGitSpiceBinary({}, undefined), DEFAULT_GIT_SPICE_BINARY);
			assert.strictEqual(resolveGitSpiceBinary(null, '/ci/gs'), '/ci/gs');
		});
	});
});
