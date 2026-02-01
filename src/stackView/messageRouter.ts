/**
 * Message router for webview-to-extension communication.
 * Routes messages to appropriate handler methods while preserving
 * TypeScript exhaustive type checking on message types.
 */

import * as vscode from 'vscode';

import type { WebviewMessage } from './webviewTypes';

/**
 * Handler context providing methods the message router can call.
 * This interface decouples the router from StackViewProvider.
 */
export interface MessageHandlerContext {
	pushState(): void;
	refresh(): Promise<void>;
	handleOpenCommitDiff(sha: string): Promise<void>;
	handleBranchContextMenu(branchName: string): Promise<void>;
	handleBranchCommandInternal(
		commandName: string,
		branchName: string,
		execFunction: (folder: vscode.WorkspaceFolder, branchName: string) => Promise<{ value?: unknown; error?: string }>,
	): Promise<void>;
	handleBranchDelete(branchName: string): Promise<void>;
	handleBranchRenamePrompt(branchName: string): Promise<void>;
	handleBranchRename(branchName: string, newName: string): Promise<void>;
	handleBranchMovePrompt(branchName: string): Promise<void>;
	handleBranchMove(branchName: string, newParent: string): Promise<void>;
	handleUpstackMovePrompt(branchName: string): Promise<void>;
	handleUpstackMove(branchName: string, newParent: string): Promise<void>;
	handleGetCommitFiles(sha: string): Promise<void>;
	handleOpenFileDiff(sha: string, path: string): Promise<void>;
	handleOpenCurrentFile(path: string): Promise<void>;
	handleStageFile(path: string): Promise<void>;
	handleUnstageFile(path: string): Promise<void>;
	handleDiscardFile(path: string): Promise<void>;
	handleOpenWorkingCopyDiff(path: string, staged: boolean): Promise<void>;
	handleCommitChanges(message: string): Promise<void>;
	handleCreateBranch(message: string): Promise<void>;
	handleCommitCopySha(sha: string): Promise<void>;
	handleCommitFixup(sha: string): Promise<void>;
	handleCommitSplit(sha: string, branchName: string): Promise<void>;
	getExecFunctions(): ExecFunctionMap;
}

/** Map of command names to their execution functions. */
export type ExecFunctionMap = Record<
	string,
	(folder: vscode.WorkspaceFolder, branchName: string) => Promise<{ value?: unknown; error?: string }>
>;

/**
 * Routes webview messages to appropriate handler methods.
 * @returns true if the message was handled, false otherwise.
 */
export function routeMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	return (
		routeStateMessage(message, ctx) ||
		routeNavigationMessage(message, ctx) ||
		routeBranchManagementMessage(message, ctx) ||
		routeCommitMessage(message, ctx) ||
		routeFileMessage(message, ctx) ||
		routeWorkingCopyMessage(message, ctx) ||
		routeBranchCommand(message, ctx)
	);
}

/** Routes state-related messages (ready, refresh). */
function routeStateMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'ready':
			ctx.pushState();
			return true;
		case 'refresh':
			void ctx.refresh();
			return true;
		default:
			return false;
	}
}

/** Routes navigation messages (open URLs, diffs). */
function routeNavigationMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'openChange':
			void vscode.env.openExternal(vscode.Uri.parse(message.url));
			return true;
		case 'openCommit':
			void vscode.commands.executeCommand('git.openCommit', message.sha);
			return true;
		case 'openCommitDiff':
			void ctx.handleOpenCommitDiff(message.sha);
			return true;
		default:
			return false;
	}
}

/** Routes branch management messages (context menu, rename, move, delete). */
function routeBranchManagementMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	return routeBranchContextMessage(message, ctx) || routeBranchMoveMessage(message, ctx);
}

/** Routes branch context/rename/delete messages. */
function routeBranchContextMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'branchContextMenu':
			void ctx.handleBranchContextMenu(message.branchName);
			return true;
		case 'branchDelete':
			void ctx.handleBranchDelete(message.branchName);
			return true;
		case 'branchRenamePrompt':
			void ctx.handleBranchRenamePrompt(message.branchName);
			return true;
		case 'branchRename':
			void ctx.handleBranchRename(message.branchName, message.newName);
			return true;
		default:
			return false;
	}
}

/** Routes branch move messages. */
function routeBranchMoveMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'branchMovePrompt':
			void ctx.handleBranchMovePrompt(message.branchName);
			return true;
		case 'branchMove':
			void ctx.handleBranchMove(message.branchName, message.newParent);
			return true;
		case 'upstackMovePrompt':
			void ctx.handleUpstackMovePrompt(message.branchName);
			return true;
		case 'upstackMove':
			void ctx.handleUpstackMove(message.branchName, message.newParent);
			return true;
		default:
			return false;
	}
}

/** Routes commit-related messages (files, copy, fixup, split). */
function routeCommitMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'getCommitFiles':
			void ctx.handleGetCommitFiles(message.sha);
			return true;
		case 'commitCopySha':
			void ctx.handleCommitCopySha(message.sha);
			return true;
		case 'commitFixup':
			void ctx.handleCommitFixup(message.sha);
			return true;
		case 'commitSplit':
			void ctx.handleCommitSplit(message.sha, message.branchName);
			return true;
		default:
			return false;
	}
}

/** Routes file operation messages (diff, open). */
function routeFileMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'openFileDiff':
			void ctx.handleOpenFileDiff(message.sha, message.path);
			return true;
		case 'openCurrentFile':
			void ctx.handleOpenCurrentFile(message.path);
			return true;
		default:
			return false;
	}
}

/** Routes working copy messages (stage, unstage, discard, commit). */
function routeWorkingCopyMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	return routeStagingMessage(message, ctx) || routeCommitFormMessage(message, ctx);
}

/** Routes staging-related messages (stage, unstage, discard, diff). */
function routeStagingMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'stageFile':
			void ctx.handleStageFile(message.path);
			return true;
		case 'unstageFile':
			void ctx.handleUnstageFile(message.path);
			return true;
		case 'discardFile':
			void ctx.handleDiscardFile(message.path);
			return true;
		case 'openWorkingCopyDiff':
			void ctx.handleOpenWorkingCopyDiff(message.path, message.staged);
			return true;
		default:
			return false;
	}
}

/** Routes commit form messages (commit, create branch). */
function routeCommitFormMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'commitChanges':
			void ctx.handleCommitChanges(message.message);
			return true;
		case 'createBranch':
			void ctx.handleCreateBranch(message.message);
			return true;
		default:
			return false;
	}
}

/** Routes branch-specific commands with exec functions. */
function routeBranchCommand(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	const commandMapping: Record<string, string> = {
		branchUntrack: 'untrack',
		branchCheckout: 'checkout',
		branchFold: 'fold',
		branchSquash: 'squash',
		branchEdit: 'edit',
		branchRestack: 'restack',
		branchSubmit: 'submit',
	};

	const commandName = commandMapping[message.type];
	if (!commandName) return false;

	const execFn = ctx.getExecFunctions()[commandName];
	const branchMsg = message as { branchName?: string };
	if (typeof branchMsg.branchName === 'string' && execFn) {
		void ctx.handleBranchCommandInternal(commandName, branchMsg.branchName, execFn);
	}
	return true;
}
