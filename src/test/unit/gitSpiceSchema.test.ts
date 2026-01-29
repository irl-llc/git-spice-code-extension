import * as assert from 'assert';
import { parseGitSpiceBranches, type GitSpiceBranch } from '../../gitSpiceSchema';

describe('gitSpiceSchema', () => {
	describe('parseGitSpiceBranches', () => {
		it('should parse empty input as empty array', () => {
			const result = parseGitSpiceBranches('');
			assert.deepStrictEqual(result, []);
		});

		it('should parse whitespace-only input as empty array', () => {
			const result = parseGitSpiceBranches('   \n\n   \n');
			assert.deepStrictEqual(result, []);
		});

		it('should parse a single branch with minimal fields', () => {
			const input = '{"name":"feature-1"}';
			const result = parseGitSpiceBranches(input);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].name, 'feature-1');
			assert.strictEqual(result[0].current, undefined);
			assert.strictEqual(result[0].down, undefined);
			assert.strictEqual(result[0].ups, undefined);
		});

		it('should parse a branch with current flag', () => {
			const input = '{"name":"feature-1","current":true}';
			const result = parseGitSpiceBranches(input);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].current, true);
		});

		it('should parse a branch with down link', () => {
			const input = '{"name":"feature-2","down":{"name":"feature-1","needsRestack":true}}';
			const result = parseGitSpiceBranches(input);

			assert.strictEqual(result.length, 1);
			assert.deepStrictEqual(result[0].down, { name: 'feature-1', needsRestack: true });
		});

		it('should parse a branch with up links', () => {
			const input = '{"name":"feature-1","ups":[{"name":"feature-2"},{"name":"feature-3","needsRestack":true}]}';
			const result = parseGitSpiceBranches(input);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].ups?.length, 2);
			assert.strictEqual(result[0].ups?.[0].name, 'feature-2');
			assert.strictEqual(result[0].ups?.[1].needsRestack, true);
		});

		it('should parse a branch with commits', () => {
			const input = '{"name":"feature-1","commits":[{"sha":"abc123def","subject":"Initial commit"}]}';
			const result = parseGitSpiceBranches(input);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].commits?.length, 1);
			assert.strictEqual(result[0].commits?.[0].sha, 'abc123def');
			assert.strictEqual(result[0].commits?.[0].subject, 'Initial commit');
		});

		it('should parse a branch with change (PR) info', () => {
			const input =
				'{"name":"feature-1","change":{"id":"#123","url":"https://github.com/org/repo/pull/123","status":"open"}}';
			const result = parseGitSpiceBranches(input);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].change?.id, '#123');
			assert.strictEqual(result[0].change?.url, 'https://github.com/org/repo/pull/123');
			assert.strictEqual(result[0].change?.status, 'open');
		});

		it('should parse multiple branches from newline-delimited JSON', () => {
			const input =
				'{"name":"main"}\n{"name":"feature-1","down":{"name":"main"}}\n{"name":"feature-2","down":{"name":"feature-1"}}';
			const result = parseGitSpiceBranches(input);

			assert.strictEqual(result.length, 3);
			assert.strictEqual(result[0].name, 'main');
			assert.strictEqual(result[1].name, 'feature-1');
			assert.strictEqual(result[2].name, 'feature-2');
		});

		it('should skip invalid JSON lines without failing', () => {
			const input = '{"name":"feature-1"}\ninvalid json here\n{"name":"feature-2"}';
			const result = parseGitSpiceBranches(input);

			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].name, 'feature-1');
			assert.strictEqual(result[1].name, 'feature-2');
		});

		it('should skip JSON objects without name field', () => {
			const input = '{"current":true}\n{"name":"feature-1"}';
			const result = parseGitSpiceBranches(input);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].name, 'feature-1');
		});

		it('should handle Windows-style line endings', () => {
			const input = '{"name":"feature-1"}\r\n{"name":"feature-2"}';
			const result = parseGitSpiceBranches(input);

			assert.strictEqual(result.length, 2);
		});

		it('should parse push info when present', () => {
			const input = '{"name":"feature-1","push":{"ahead":2,"behind":1,"needsPush":true}}';
			const result = parseGitSpiceBranches(input);

			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0].push?.ahead, 2);
			assert.strictEqual(result[0].push?.behind, 1);
			assert.strictEqual(result[0].push?.needsPush, true);
		});

		it('should only accept valid change status values', () => {
			const validStatuses = ['open', 'closed', 'merged'];
			for (const status of validStatuses) {
				const input = `{"name":"feature","change":{"id":"1","url":"http://x","status":"${status}"}}`;
				const result = parseGitSpiceBranches(input);
				assert.strictEqual(result[0].change?.status, status);
			}

			// Invalid status should result in no status field
			const invalidInput = '{"name":"feature","change":{"id":"1","url":"http://x","status":"invalid"}}';
			const invalidResult = parseGitSpiceBranches(invalidInput);
			assert.strictEqual(invalidResult[0].change?.status, undefined);
		});
	});
});
