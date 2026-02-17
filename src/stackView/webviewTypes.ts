import type { CommitFileChange, DisplayState } from './types';

/** Global messages not scoped to a specific repository. */
type GlobalWebviewMessage =
	| { type: 'ready' }
	| { type: 'refresh' };

/** Repo-scoped messages sent from webview to extension. */
type RepoWebviewMessage =
	| { type: 'openChange'; repoId?: string; url: string }
	| { type: 'openCommit'; repoId?: string; sha: string }
	| { type: 'openCommitDiff'; repoId?: string; sha: string }
	| { type: 'branchContextMenu'; repoId?: string; branchName: string }
	| { type: 'branchUntrack'; repoId?: string; branchName: string }
	| { type: 'branchDelete'; repoId?: string; branchName: string }
	| { type: 'branchCheckout'; repoId?: string; branchName: string }
	| { type: 'branchFold'; repoId?: string; branchName: string }
	| { type: 'branchSquash'; repoId?: string; branchName: string }
	| { type: 'branchEdit'; repoId?: string; branchName: string }
	| { type: 'branchRenamePrompt'; repoId?: string; branchName: string }
	| { type: 'branchRename'; repoId?: string; branchName: string; newName: string }
	| { type: 'branchRestack'; repoId?: string; branchName: string }
	| { type: 'branchSubmit'; repoId?: string; branchName: string }
	| { type: 'commitCopySha'; repoId?: string; sha: string }
	| { type: 'commitFixup'; repoId?: string; sha: string }
	| { type: 'commitSplit'; repoId?: string; sha: string; branchName: string }
	| { type: 'branchMovePrompt'; repoId?: string; branchName: string }
	| { type: 'branchMove'; repoId?: string; branchName: string; newParent: string }
	| { type: 'upstackMovePrompt'; repoId?: string; branchName: string }
	| { type: 'upstackMove'; repoId?: string; branchName: string; newParent: string }
	| { type: 'getCommitFiles'; repoId?: string; sha: string }
	| { type: 'openFileDiff'; repoId?: string; sha: string; path: string }
	| { type: 'openCurrentFile'; repoId?: string; path: string }
	| { type: 'getBranchFiles'; repoId?: string; branchName: string }
	| { type: 'openBranchFileDiff'; repoId?: string; branchName: string; path: string }
	| { type: 'stageFile'; repoId?: string; path: string }
	| { type: 'unstageFile'; repoId?: string; path: string }
	| { type: 'discardFile'; repoId?: string; path: string }
	| { type: 'openWorkingCopyDiff'; repoId?: string; path: string; staged: boolean }
	| { type: 'commitChanges'; repoId?: string; message: string }
	| { type: 'createBranch'; repoId?: string; message: string }
	| { type: 'branchTrack'; repoId?: string; branchName: string }
	| { type: 'repoSync'; repoId?: string }
	| { type: 'stackRestack'; repoId?: string }
	| { type: 'stackSubmit'; repoId?: string };

/** All messages from webview to extension. */
export type WebviewMessage = GlobalWebviewMessage | RepoWebviewMessage;

/** Messages from extension to webview. */
export type ExtensionMessage =
	| { type: 'state'; payload: DisplayState; force?: boolean }
	| { type: 'commitFiles'; repoId?: string; sha: string; files: CommitFileChange[] }
	| { type: 'branchFiles'; repoId?: string; branchName: string; files: CommitFileChange[] };

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
