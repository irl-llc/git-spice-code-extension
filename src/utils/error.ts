/**
 * Error formatting utilities for consistent user-facing messages.
 */

/**
 * Formats an error message with a consistent prefix pattern.
 *
 * @param operation - The operation that failed (e.g., "Branch checkout", "Commit fixup")
 * @param detail - The specific error detail or reason
 * @returns Formatted error string as "Operation: detail"
 */
export function formatError(operation: string, detail: string): string {
	return `${operation}: ${detail}`;
}

/**
 * Converts an unknown error value to a displayable message string.
 *
 * @param error - The caught error (may be Error, string, or unknown)
 * @returns A string representation suitable for display
 */
export function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

/**
 * Result type for operations that may fail.
 * Uses discriminated union for type-safe error handling.
 */
export type Result<T> = { value: T } | { error: string };

/**
 * Checks if a result is an error.
 */
export function isError<T>(result: Result<T>): result is { error: string } {
	return 'error' in result;
}

/**
 * Checks if a result is a success.
 */
export function isSuccess<T>(result: Result<T>): result is { value: T } {
	return 'value' in result;
}
