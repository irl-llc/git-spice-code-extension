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
 * Returns true if the message was handled, false otherwise.
 */
export function routeMessage(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	switch (message.type) {
		case 'ready':
			ctx.pushState();
			return true;
		case 'refresh':
			void ctx.refresh();
			return true;
		case 'openChange':
			if (typeof message.url === 'string') {
				void vscode.env.openExternal(vscode.Uri.parse(message.url));
			}
			return true;
		case 'openCommit':
			if (typeof message.sha === 'string') {
				void vscode.commands.executeCommand('git.openCommit', message.sha);
			}
			return true;
		case 'openCommitDiff':
			if (typeof message.sha === 'string') void ctx.handleOpenCommitDiff(message.sha);
			return true;
		case 'branchContextMenu':
			if (typeof message.branchName === 'string') void ctx.handleBranchContextMenu(message.branchName);
			return true;
		case 'branchDelete':
			if (typeof message.branchName === 'string') void ctx.handleBranchDelete(message.branchName);
			return true;
		case 'branchRenamePrompt':
			if (typeof message.branchName === 'string') void ctx.handleBranchRenamePrompt(message.branchName);
			return true;
		case 'branchRename':
			if (typeof message.branchName === 'string' && typeof message.newName === 'string') {
				void ctx.handleBranchRename(message.branchName, message.newName);
			}
			return true;
		case 'branchMovePrompt':
			if (typeof message.branchName === 'string') void ctx.handleBranchMovePrompt(message.branchName);
			return true;
		case 'branchMove':
			if (typeof message.branchName === 'string' && typeof message.newParent === 'string') {
				void ctx.handleBranchMove(message.branchName, message.newParent);
			}
			return true;
		case 'upstackMovePrompt':
			if (typeof message.branchName === 'string') void ctx.handleUpstackMovePrompt(message.branchName);
			return true;
		case 'upstackMove':
			if (typeof message.branchName === 'string' && typeof message.newParent === 'string') {
				void ctx.handleUpstackMove(message.branchName, message.newParent);
			}
			return true;
		case 'getCommitFiles':
			if (typeof message.sha === 'string') void ctx.handleGetCommitFiles(message.sha);
			return true;
		case 'openFileDiff':
			if (typeof message.sha === 'string' && typeof message.path === 'string') {
				void ctx.handleOpenFileDiff(message.sha, message.path);
			}
			return true;
		case 'openCurrentFile':
			if (typeof message.path === 'string') void ctx.handleOpenCurrentFile(message.path);
			return true;
		case 'stageFile':
			if (typeof message.path === 'string') void ctx.handleStageFile(message.path);
			return true;
		case 'unstageFile':
			if (typeof message.path === 'string') void ctx.handleUnstageFile(message.path);
			return true;
		case 'discardFile':
			if (typeof message.path === 'string') void ctx.handleDiscardFile(message.path);
			return true;
		case 'openWorkingCopyDiff':
			if (typeof message.path === 'string' && typeof message.staged === 'boolean') {
				void ctx.handleOpenWorkingCopyDiff(message.path, message.staged);
			}
			return true;
		case 'commitChanges':
			if (typeof message.message === 'string') void ctx.handleCommitChanges(message.message);
			return true;
		case 'createBranch':
			if (typeof message.message === 'string') void ctx.handleCreateBranch(message.message);
			return true;
		case 'commitCopySha':
			if (typeof message.sha === 'string') void ctx.handleCommitCopySha(message.sha);
			return true;
		case 'commitFixup':
			if (typeof message.sha === 'string') void ctx.handleCommitFixup(message.sha);
			return true;
		case 'commitSplit':
			if (typeof message.sha === 'string' && typeof message.branchName === 'string') {
				void ctx.handleCommitSplit(message.sha, message.branchName);
			}
			return true;
		default:
			return routeBranchCommand(message, ctx);
	}
}

/** Routes branch-specific commands with exec functions. */
function routeBranchCommand(message: WebviewMessage, ctx: MessageHandlerContext): boolean {
	const execFunctions = ctx.getExecFunctions();
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

	const execFn = execFunctions[commandName];
	const branchMsg = message as { branchName?: string };
	if (typeof branchMsg.branchName === 'string' && execFn) {
		void ctx.handleBranchCommandInternal(commandName, branchMsg.branchName, execFn);
	}
	return true;
}
