/**
 * Handler-dependency factories.
 *
 * Each `build*HandlerDeps` function assembles the dependency object a handler
 * group needs from a small host surface (`HandlerDepsHost`). Splitting these
 * out of StackViewProvider keeps the provider focused on lifecycle and message
 * routing while the wiring lives in one testable place.
 */

import * as vscode from 'vscode';

import { runWithProgress, type OperationGate } from './handlers/branchCommandRunner';
import type { BranchHandlerDeps } from './handlers/branchHandlers';
import type { CommitHandlerDeps } from './handlers/commitHandlers';
import type { DiffHandlerDeps } from './handlers/diffHandlers';
import type { WorkingCopyHandlerDeps } from './handlers/workingCopyHandlers';
import type { BranchFileHandlerDeps } from './handlers/branchFileHandlers';
import type { ExecFunction } from './messageRouter';
import type { RepoState } from './repoStateBuilder';

/** The slice of StackViewProvider that the dependency factories rely on. */
export interface HandlerDepsHost {
	resolveRepoState(repoId?: string): RepoState | undefined;
	resolveWorkspaceFolder(repoId?: string): vscode.WorkspaceFolder | undefined;
	refresh(force?: boolean): Promise<void>;
	/** Gate that holds watcher refreshes for the duration of a multi-step op (issue #71). */
	operationGate: OperationGate;
	broadcast(message: unknown): void;
	handleBranchCommandInternal(
		repoId: string | undefined,
		commandName: string,
		branchName: string,
		execFunction: ExecFunction,
	): Promise<void>;
}

export function buildBranchHandlerDeps(host: HandlerDepsHost, repoId?: string): BranchHandlerDeps {
	const state = host.resolveRepoState(repoId);
	return {
		workspaceFolder: host.resolveWorkspaceFolder(repoId),
		branches: state?.branches ?? [],
		integration: state?.integration ?? null,
		runBranchCommand: (title, op, msg) =>
			runWithProgress(title, op, msg, { refresh: () => host.refresh(), gate: host.operationGate }),
		handleBranchCommandInternal: (cmd, branch, fn) => host.handleBranchCommandInternal(repoId, cmd, branch, fn),
		postMessageToWebview: (message) => host.broadcast(message),
	};
}

export function buildCommitHandlerDeps(host: HandlerDepsHost, repoId?: string): CommitHandlerDeps {
	return {
		workspaceFolder: host.resolveWorkspaceFolder(repoId),
		runBranchCommand: (title, op, msg) =>
			runWithProgress(title, op, msg, { refresh: () => host.refresh(), gate: host.operationGate }),
		refresh: () => host.refresh(),
		postCommitFilesToWebview: (sha, files) => host.broadcast({ type: 'commitFiles', repoId, sha, files }),
	};
}

export function buildDiffHandlerDeps(host: HandlerDepsHost, repoId?: string): DiffHandlerDeps {
	return { workspaceFolder: host.resolveWorkspaceFolder(repoId) };
}

export function buildWorkingCopyHandlerDeps(host: HandlerDepsHost, repoId?: string): WorkingCopyHandlerDeps {
	return {
		workspaceFolder: host.resolveWorkspaceFolder(repoId),
		uncommitted: host.resolveRepoState(repoId)?.uncommitted,
		refresh: () => host.refresh(),
	};
}

export function buildBranchFileHandlerDeps(host: HandlerDepsHost, repoId?: string): BranchFileHandlerDeps {
	const state = host.resolveRepoState(repoId);
	return {
		workspaceFolder: host.resolveWorkspaceFolder(repoId),
		branches: state?.branches ?? [],
		postBranchFilesToWebview: (branchName, files) => host.broadcast({ type: 'branchFiles', repoId, branchName, files }),
	};
}
