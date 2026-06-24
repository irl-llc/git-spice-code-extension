/**
 * Branch command runner — executes branch operations with progress and result handling.
 */

import * as vscode from 'vscode';

import {
	execBranchUntrack,
	execBranchCheckout,
	execBranchFold,
	execBranchSquash,
	execBranchEdit,
	execBranchRestack,
	execBranchSubmit,
} from '../../utils/gitSpice';
import type { ExecFunctionMap, ExecFunction } from '../messageRouter';

/** Result shape from branch commands — has optional error. */
type CommandResult = { value?: unknown; error?: string };

/**
 * Begin/end gate raised for the duration of a multi-step operation so the file
 * watcher holds its refreshes until the operation completes (issue #71). The
 * FileWatcherManager supplies one via its `operationGate`.
 */
export type OperationGate = { begin: () => void; end: () => void };

/** Post-operation refresh plus the optional storm-suppression gate (issue #71). */
export type ProgressDeps = { refresh: () => Promise<void>; gate?: OperationGate };

/** Dependencies needed by the branch command runner. */
export interface BranchCommandRunnerDeps {
	getActiveWorkspaceFolder: () => vscode.WorkspaceFolder | undefined;
	refresh: () => Promise<void>;
	gate?: OperationGate;
}

/** Map of command names to their execution functions. */
const COMMAND_MAP: Record<string, ExecFunction> = {
	untrack: execBranchUntrack,
	checkout: execBranchCheckout,
	fold: execBranchFold,
	squash: execBranchSquash,
	edit: execBranchEdit,
	restack: execBranchRestack,
	submit: execBranchSubmit,
};

/** Returns the exec function map for the message router. */
export function getExecFunctions(): ExecFunctionMap {
	return { ...COMMAND_MAP };
}

/** Dispatches a named branch command. */
export async function executeBranchCommand(
	commandName: string,
	branchName: string,
	deps: BranchCommandRunnerDeps,
): Promise<void> {
	const execFunction = COMMAND_MAP[commandName];
	if (!execFunction) {
		void vscode.window.showErrorMessage(`Unknown command: ${commandName}`);
		return;
	}
	await executeBranchCommandWithExec(commandName, branchName, execFunction, deps);
}

/** Executes a branch command using the given exec function. */
export async function executeBranchCommandWithExec(
	commandName: string,
	branchName: string,
	execFunction: ExecFunction,
	deps: BranchCommandRunnerDeps,
): Promise<void> {
	const trimmedName = branchName?.trim();
	if (!trimmedName) {
		void vscode.window.showErrorMessage(`Branch name for ${commandName} cannot be empty.`);
		return;
	}

	const folder = deps.getActiveWorkspaceFolder();
	if (!folder) {
		void vscode.window.showErrorMessage('No workspace folder available.');
		return;
	}

	const title = `${commandName.charAt(0).toUpperCase() + commandName.slice(1)}ing branch: ${trimmedName}`;
	const successMessage = `Branch ${trimmedName} ${commandName}ed successfully.`;
	await runWithProgress(title, () => execFunction(folder, trimmedName), successMessage, deps);
}

/** Runs a branch command with progress notification. */
export async function runWithProgress(
	title: string,
	operation: () => Promise<CommandResult>,
	successMessage: string,
	deps: ProgressDeps,
): Promise<boolean> {
	let success = false;
	await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, () =>
		runProgressBody(operation, successMessage, deps, (value) => (success = value)),
	);
	return success;
}

/**
 * Body of the progress notification: runs the operation and reports the result.
 * The operation gate is raised for the whole body so watcher refreshes are held
 * until the (multi-step, possibly network-bound) operation finishes — then the
 * explicit `refresh()` provides the single coalesced update (issue #71).
 */
async function runProgressBody(
	operation: () => Promise<CommandResult>,
	successMessage: string,
	deps: ProgressDeps,
	setSuccess: (value: boolean) => void,
): Promise<void> {
	deps.gate?.begin();
	let shouldRefresh = false;
	try {
		setSuccess(showResult(await operation(), successMessage));
		shouldRefresh = true;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Unexpected error: ${message}`);
	} finally {
		// Lower the gate BEFORE the explicit refresh so it coalesces with any
		// watcher events held during the operation, avoiding a double refresh.
		deps.gate?.end();
		if (shouldRefresh) await deps.refresh();
	}
}

/** Shows the result of a branch command. Returns true on success. */
function showResult(result: CommandResult, successMessage: string): boolean {
	if (result.error) {
		void vscode.window.showErrorMessage(result.error);
		return false;
	}
	void vscode.window.showInformationMessage(successMessage);
	return true;
}
