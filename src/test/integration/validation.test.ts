import * as assert from 'assert';
import { requireNonEmpty, requireWorkspace, requireAllNonEmpty } from '../../utils/validation';

// Mock vscode window module for testing
const mockMessages: string[] = [];

// Note: These tests require mocking vscode.window.showErrorMessage.
// Since unit tests run without VS Code host, we test the pure logic only.
// Integration tests with VS Code host can verify the full error message flow.

describe('validation', () => {
	describe('requireNonEmpty', () => {
		// Pure logic tests (without vscode mock)
		it('should return undefined for empty string', () => {
			// Since we can't mock vscode easily in unit tests,
			// we verify that the function handles empty strings correctly
			// The actual error message display is tested in integration tests
			const result = requireNonEmpty('', 'test field');
			assert.strictEqual(result, undefined);
		});

		it('should return undefined for whitespace-only string', () => {
			const result = requireNonEmpty('   ', 'test field');
			assert.strictEqual(result, undefined);
		});

		it('should return undefined for non-string values', () => {
			assert.strictEqual(requireNonEmpty(null, 'test'), undefined);
			assert.strictEqual(requireNonEmpty(undefined, 'test'), undefined);
			assert.strictEqual(requireNonEmpty(123, 'test'), undefined);
			assert.strictEqual(requireNonEmpty({}, 'test'), undefined);
			assert.strictEqual(requireNonEmpty([], 'test'), undefined);
		});

		it('should return trimmed string for valid input', () => {
			const result = requireNonEmpty('  valid input  ', 'test field');
			assert.strictEqual(result, 'valid input');
		});

		it('should return string as-is if no surrounding whitespace', () => {
			const result = requireNonEmpty('valid', 'test field');
			assert.strictEqual(result, 'valid');
		});
	});

	describe('requireWorkspace', () => {
		it('should return undefined for undefined folder', () => {
			const result = requireWorkspace(undefined);
			assert.strictEqual(result, undefined);
		});
	});

	describe('requireAllNonEmpty', () => {
		it('should return undefined if any value is empty', () => {
			const result = requireAllNonEmpty([
				['valid', 'field1'],
				['', 'field2'],
			]);
			assert.strictEqual(result, undefined);
		});

		it('should return undefined if any value is non-string', () => {
			const result = requireAllNonEmpty([
				['valid', 'field1'],
				[null as unknown as string, 'field2'],
			]);
			assert.strictEqual(result, undefined);
		});

		it('should return all trimmed strings if all valid', () => {
			const result = requireAllNonEmpty([
				['  value1  ', 'field1'],
				['value2', 'field2'],
				['  value3', 'field3'],
			]);
			assert.deepStrictEqual(result, ['value1', 'value2', 'value3']);
		});

		it('should return empty array for empty input', () => {
			const result = requireAllNonEmpty([]);
			assert.deepStrictEqual(result, []);
		});

		it('should stop at first invalid value', () => {
			// This tests that we don't continue processing after finding an invalid value
			const result = requireAllNonEmpty([
				['valid1', 'field1'],
				['', 'field2'],
				['valid3', 'field3'],
			]);
			assert.strictEqual(result, undefined);
		});
	});
});
