/**
 * Message router for webview-to-extension communication.
 * Routes messages to appropriate handler methods while preserving
 * TypeScript exhaustive type checking on message types.
 */

import type { WebviewMessage } from './webviewTypes';

/** Execution function type for branch commands. Uses unknown folder for flexibility. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExecFunction = (folder: any, branchName: string) => Promise<{ value?: unknown; error?: string }>;

/** Map of command names to their execution functions. */
export type ExecFunctionMap = Record<string, ExecFunction>;

/**
 * Handler context providing methods the message router can call.
 * This interface decouples the router from StackViewProvider.
 * Repo-scoped methods accept an optional repoId to target a specific repository.
 */
export interface MessageHandlerContext {
	pushState(force?: boolean): void;
	refresh(force?: boolean): Promise<void>;
	handleOpenExternal(repoId: string | undefined, url: string): void;
	handleOpenCommit(repoId: string | undefined, sha: string): void;
	handleOpenCommitDiff(repoId: string | undefined, sha: string): Promise<void>;
	handleBranchContextMenu(repoId: string | undefined, branchName: string): Promise<void>;
	handleBranchCommandInternal(repoId: string | undefined, commandName: string, branchName: string, execFunction: ExecFunction): Promise<void>;
	handleBranchTrack(repoId: string | undefined, branchName: string): Promise<void>;
	handleBranchDelete(repoId: string | undefined, branchName: string): Promise<void>;
	handleBranchRenamePrompt(repoId: string | undefined, branchName: string): Promise<void>;
	handleBranchRename(repoId: string | undefined, branchName: string, newName: string): Promise<void>;
	handleBranchMovePrompt(repoId: string | undefined, branchName: string): Promise<void>;
	handleBranchMove(repoId: string | undefined, branchName: string, newParent: string): Promise<void>;
	handleUpstackMovePrompt(repoId: string | undefined, branchName: string): Promise<void>;
	handleUpstackMove(repoId: string | undefined, branchName: string, newParent: string): Promise<void>;
	handleGetCommitFiles(repoId: string | undefined, sha: string): Promise<void>;
	handleGetBranchFiles(repoId: string | undefined, branchName: string): Promise<void>;
	handleOpenBranchFileDiff(repoId: string | undefined, branchName: string, path: string): Promise<void>;
	handleOpenFileDiff(repoId: string | undefined, sha: string, path: string): Promise<void>;
	handleOpenCurrentFile(repoId: string | undefined, path: string): Promise<void>;
	handleStageFile(repoId: string | undefined, path: string): Promise<void>;
	handleUnstageFile(repoId: string | undefined, path: string): Promise<void>;
	handleDiscardFile(repoId: string | undefined, path: string): Promise<void>;
	handleOpenWorkingCopyDiff(repoId: string | undefined, path: string, staged: boolean): Promise<void>;
	handleCommitChanges(repoId: string | undefined, message: string): Promise<void>;
	handleCreateBranch(repoId: string | undefined, message: string): Promise<void>;
	handleCommitCopySha(repoId: string | undefined, sha: string): Promise<void>;
	handleCommitFixup(repoId: string | undefined, sha: string): Promise<void>;
	handleCommitSplit(repoId: string | undefined, sha: string, branchName: string): Promise<void>;
	handleRepoSync(repoId: string | undefined): Promise<void>;
	handleStackRestack(repoId: string | undefined): Promise<void>;
	handleStackSubmit(repoId: string | undefined): Promise<void>;
	getExecFunctions(): ExecFunctionMap;
}

/**
 * Routes webview messages to appropriate handler methods.
 * @returns true if the message was handled, false otherwise.
 */
export function routeMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	return (
		routeStateMessage(message, ctx) ||
		routeRepoToolbarMessage(message, ctx) ||
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
			void ctx.refresh(true);
			return true;
		default:
			return false;
	}
}

/** Routes per-repo toolbar messages (sync, restack, submit). */
function routeRepoToolbarMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'repoSync':
			void ctx.handleRepoSync(message.repoId);
			return true;
		case 'stackRestack':
			void ctx.handleStackRestack(message.repoId);
			return true;
		case 'stackSubmit':
			void ctx.handleStackSubmit(message.repoId);
			return true;
		default:
			return false;
	}
}

/** Routes navigation messages (open URLs, diffs). */
function routeNavigationMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'openChange':
			ctx.handleOpenExternal(message.repoId, message.url);
			return true;
		case 'openCommit':
			ctx.handleOpenCommit(message.repoId, message.sha);
			return true;
		case 'openCommitDiff':
			void ctx.handleOpenCommitDiff(message.repoId, message.sha);
			return true;
		default:
			return false;
	}
}

/** Routes branch management messages (context menu, track, rename, move, delete). */
function routeBranchManagementMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	return routeBranchTrackMessage(message, ctx) || routeBranchContextMessage(message, ctx) || routeBranchMoveMessage(message, ctx);
}

/** Routes branch track message to its dedicated prompt handler. */
function routeBranchTrackMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	if (message.type !== 'branchTrack') return false;
	void ctx.handleBranchTrack(message.repoId, message.branchName);
	return true;
}

/** Routes branch context/rename/delete messages. */
function routeBranchContextMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'branchContextMenu':
			void ctx.handleBranchContextMenu(message.repoId, message.branchName);
			return true;
		case 'branchDelete':
			void ctx.handleBranchDelete(message.repoId, message.branchName);
			return true;
		case 'branchRenamePrompt':
			void ctx.handleBranchRenamePrompt(message.repoId, message.branchName);
			return true;
		case 'branchRename':
			void ctx.handleBranchRename(message.repoId, message.branchName, message.newName);
			return true;
		default:
			return false;
	}
}

/** Routes branch move messages. */
function routeBranchMoveMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'branchMovePrompt':
			void ctx.handleBranchMovePrompt(message.repoId, message.branchName);
			return true;
		case 'branchMove':
			void ctx.handleBranchMove(message.repoId, message.branchName, message.newParent);
			return true;
		case 'upstackMovePrompt':
			void ctx.handleUpstackMovePrompt(message.repoId, message.branchName);
			return true;
		case 'upstackMove':
			void ctx.handleUpstackMove(message.repoId, message.branchName, message.newParent);
			return true;
		default:
			return false;
	}
}

/** Routes commit-related messages (files, copy, fixup, split). */
function routeCommitMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'getCommitFiles':
			void ctx.handleGetCommitFiles(message.repoId, message.sha);
			return true;
		case 'commitCopySha':
			void ctx.handleCommitCopySha(message.repoId, message.sha);
			return true;
		case 'commitFixup':
			void ctx.handleCommitFixup(message.repoId, message.sha);
			return true;
		case 'commitSplit':
			void ctx.handleCommitSplit(message.repoId, message.sha, message.branchName);
			return true;
		default:
			return false;
	}
}

/** Routes file operation messages (diff, open, branch files). */
function routeFileMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'openFileDiff':
			void ctx.handleOpenFileDiff(message.repoId, message.sha, message.path);
			return true;
		case 'openCurrentFile':
			void ctx.handleOpenCurrentFile(message.repoId, message.path);
			return true;
		case 'getBranchFiles':
			void ctx.handleGetBranchFiles(message.repoId, message.branchName);
			return true;
		case 'openBranchFileDiff':
			void ctx.handleOpenBranchFileDiff(message.repoId, message.branchName, message.path);
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
			void ctx.handleStageFile(message.repoId, message.path);
			return true;
		case 'unstageFile':
			void ctx.handleUnstageFile(message.repoId, message.path);
			return true;
		case 'discardFile':
			void ctx.handleDiscardFile(message.repoId, message.path);
			return true;
		case 'openWorkingCopyDiff':
			void ctx.handleOpenWorkingCopyDiff(message.repoId, message.path, message.staged);
			return true;
		default:
			return false;
	}
}

/** Routes commit form messages (commit, create branch). */
function routeCommitFormMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'commitChanges':
			void ctx.handleCommitChanges(message.repoId, message.message);
			return true;
		case 'createBranch':
			void ctx.handleCreateBranch(message.repoId, message.message);
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
	const branchMsg = message as { repoId?: string; branchName?: string };
	if (typeof branchMsg.branchName === 'string' && execFn) {
		void ctx.handleBranchCommandInternal(branchMsg.repoId, commandName, branchMsg.branchName, execFn);
	}
	return true;
}
