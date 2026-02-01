/**
 * Unit tests for error.ts
 * Tests error formatting and result type utilities.
 */

import * as assert from 'assert';

import { formatError, toErrorMessage, isError, isSuccess, type Result } from '../../utils/error';

describe('error', () => {
	describe('formatError', () => {
		it('should format operation and detail with colon separator', () => {
			const result = formatError('Branch checkout', 'Branch not found');
			assert.strictEqual(result, 'Branch checkout: Branch not found');
		});

		it('should handle empty operation string', () => {
			const result = formatError('', 'Some error');
			assert.strictEqual(result, ': Some error');
		});

		it('should handle empty detail string', () => {
			const result = formatError('Operation', '');
			assert.strictEqual(result, 'Operation: ');
		});

		it('should preserve whitespace in both parts', () => {
			const result = formatError('  Operation  ', '  Detail  ');
			assert.strictEqual(result, '  Operation  :   Detail  ');
		});
	});

	describe('toErrorMessage', () => {
		it('should extract message from Error object', () => {
			const error = new Error('Something went wrong');
			const result = toErrorMessage(error);
			assert.strictEqual(result, 'Something went wrong');
		});

		it('should convert string directly', () => {
			const result = toErrorMessage('String error');
			assert.strictEqual(result, 'String error');
		});

		it('should convert number to string', () => {
			const result = toErrorMessage(42);
			assert.strictEqual(result, '42');
		});

		it('should convert null to string', () => {
			const result = toErrorMessage(null);
			assert.strictEqual(result, 'null');
		});

		it('should convert undefined to string', () => {
			const result = toErrorMessage(undefined);
			assert.strictEqual(result, 'undefined');
		});

		it('should convert object to string representation', () => {
			const result = toErrorMessage({ foo: 'bar' });
			assert.strictEqual(result, '[object Object]');
		});

		it('should handle Error with empty message', () => {
			const error = new Error('');
			const result = toErrorMessage(error);
			assert.strictEqual(result, '');
		});
	});

	describe('isError', () => {
		it('should return true for error result', () => {
			const result: Result<string> = { error: 'Something failed' };
			assert.strictEqual(isError(result), true);
		});

		it('should return false for success result', () => {
			const result: Result<string> = { value: 'success' };
			assert.strictEqual(isError(result), false);
		});

		it('should narrow type to error in conditional', () => {
			const result: Result<number> = { error: 'failed' };
			if (isError(result)) {
				// TypeScript should allow accessing error property
				assert.strictEqual(result.error, 'failed');
			} else {
				assert.fail('Expected error result');
			}
		});
	});

	describe('isSuccess', () => {
		it('should return true for success result', () => {
			const result: Result<string> = { value: 'data' };
			assert.strictEqual(isSuccess(result), true);
		});

		it('should return false for error result', () => {
			const result: Result<string> = { error: 'failed' };
			assert.strictEqual(isSuccess(result), false);
		});

		it('should narrow type to success in conditional', () => {
			const result: Result<number> = { value: 42 };
			if (isSuccess(result)) {
				// TypeScript should allow accessing value property
				assert.strictEqual(result.value, 42);
			} else {
				assert.fail('Expected success result');
			}
		});

		it('should handle undefined value as success', () => {
			const result: Result<undefined> = { value: undefined };
			assert.strictEqual(isSuccess(result), true);
		});

		it('should handle null value as success', () => {
			const result: Result<null> = { value: null };
			assert.strictEqual(isSuccess(result), true);
		});
	});
});
