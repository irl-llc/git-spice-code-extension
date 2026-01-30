import * as vscode from 'vscode';

/**
 * Validates and trims a string value.
 * Returns undefined and shows an error message if the value is empty or invalid.
 *
 * @param value - The value to validate (unknown type for safety)
 * @param label - Human-readable label for error messages (e.g., "branch name", "commit SHA")
 * @returns The trimmed string if valid, undefined otherwise
 */
export function requireNonEmpty(value: unknown, label: string): string | undefined {
	const trimmed = typeof value === 'string' ? value.trim() : '';
	if (trimmed.length === 0) {
		void vscode.window.showErrorMessage(`Invalid ${label} provided.`);
		return undefined;
	}
	return trimmed;
}

/**
 * Validates that a workspace folder exists.
 * Returns the folder's fsPath if valid, shows error and returns undefined otherwise.
 *
 * @param folder - The workspace folder to validate
 * @returns The folder's fsPath if valid, undefined otherwise
 */
export function requireWorkspace(folder: vscode.WorkspaceFolder | undefined): string | undefined {
	if (!folder) {
		void vscode.window.showErrorMessage('No workspace folder available.');
		return undefined;
	}
	return folder.uri.fsPath;
}

/**
 * Validates multiple string values at once.
 * Returns all trimmed strings if valid, undefined if any are invalid.
 *
 * @param values - Array of [value, label] pairs to validate
 * @returns Array of trimmed strings if all valid, undefined otherwise
 */
export function requireAllNonEmpty(values: Array<[unknown, string]>): string[] | undefined {
	const results: string[] = [];

	for (const [value, label] of values) {
		const trimmed = requireNonEmpty(value, label);
		if (trimmed === undefined) {
			return undefined;
		}
		results.push(trimmed);
	}

	return results;
}
