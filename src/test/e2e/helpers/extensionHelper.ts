/**
 * Helper utilities for E2E extension testing.
 */

import * as vscode from 'vscode';
import { EXTENSION_ID } from '../constants';

/** Ensures the extension is activated. */
export async function activateExtension(): Promise<vscode.Extension<unknown>> {
	const extension = vscode.extensions.getExtension(EXTENSION_ID);
	if (!extension) {
		throw new Error(`Extension ${EXTENSION_ID} not found`);
	}

	if (!extension.isActive) {
		await extension.activate();
	}

	return extension;
}

/** Waits for a specified duration. */
export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Executes a command and returns any result. */
export async function executeCommand<T>(commandId: string, ...args: unknown[]): Promise<T | undefined> {
	return vscode.commands.executeCommand<T>(commandId, ...args);
}

/** Gets all registered commands matching a prefix. */
export async function getCommandsWithPrefix(prefix: string): Promise<string[]> {
	const allCommands = await vscode.commands.getCommands(true);
	return allCommands.filter((cmd) => cmd.startsWith(prefix));
}
