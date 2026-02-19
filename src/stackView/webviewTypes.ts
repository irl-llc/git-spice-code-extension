import type { CommitFileChange, DisplayState, UncommittedState } from './types';

// Messages from webview to extension
export type WebviewMessage =
	| { type: 'ready' }
	| { type: 'refresh' }
	| { type: 'openChange'; url: string }
	| { type: 'openCommit'; sha: string }
	| { type: 'openCommitDiff'; sha: string }
	| { type: 'branchContextMenu'; branchName: string }
	| { type: 'branchUntrack'; branchName: string }
	| { type: 'branchDelete'; branchName: string }
	| { type: 'branchCheckout'; branchName: string }
	| { type: 'branchFold'; branchName: string }
	| { type: 'branchSquash'; branchName: string }
	| { type: 'branchEdit'; branchName: string }
	| { type: 'branchRenamePrompt'; branchName: string }
	| { type: 'branchRename'; branchName: string; newName: string }
	| { type: 'branchRestack'; branchName: string }
	| { type: 'branchSubmit'; branchName: string }
	| { type: 'commitCopySha'; sha: string }
	| { type: 'commitFixup'; sha: string }
	| { type: 'commitSplit'; sha: string; branchName: string }
	| { type: 'branchMovePrompt'; branchName: string }
	| { type: 'branchMove'; branchName: string; newParent: string }
	| { type: 'upstackMovePrompt'; branchName: string }
	| { type: 'upstackMove'; branchName: string; newParent: string }
	| { type: 'getCommitFiles'; sha: string }
	| { type: 'openFileDiff'; sha: string; path: string }
	| { type: 'openCurrentFile'; path: string }
	// Branch summary operations
	| { type: 'getBranchFiles'; branchName: string }
	| { type: 'openBranchFileDiff'; branchName: string; path: string }
	// Working copy operations
	| { type: 'stageFile'; path: string }
	| { type: 'unstageFile'; path: string }
	| { type: 'discardFile'; path: string }
	| { type: 'openWorkingCopyDiff'; path: string; staged: boolean }
	| { type: 'commitChanges'; message: string }
	| { type: 'createBranch'; message: string };

// Messages from extension to webview
export type ExtensionMessage =
	| { type: 'state'; payload: DisplayState; force?: boolean }
	| { type: 'commitFiles'; sha: string; files: CommitFileChange[] }
	| { type: 'branchFiles'; branchName: string; files: CommitFileChange[] };

/**
 * State persisted by the webview across sessions.
 * Currently unused but typed for future use.
 */
export type WebviewState = Record<string, unknown>;

// VSCode webview API type declaration
declare global {
	const acquireVsCodeApi: () => {
		postMessage(message: WebviewMessage): void;
		setState(state: WebviewState): void;
		getState(): WebviewState | undefined;
	};
}
