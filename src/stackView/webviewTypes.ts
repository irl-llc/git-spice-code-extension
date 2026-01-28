import type { DisplayState } from './types';

// Messages from webview to extension
export type WebviewMessage =
	| { type: 'ready' }
	| { type: 'refresh' }
	| { type: 'openChange'; url: string }
	| { type: 'openCommit'; sha: string }
	| { type: 'openCommitDiff'; sha: string }
	| { type: 'branchUntrack'; branchName: string }
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
	| { type: 'upstackMove'; branchName: string; newParent: string };

// Messages from extension to webview
export type ExtensionMessage =
	| { type: 'state'; payload: DisplayState };

// VSCode webview API type declaration
declare global {
	const acquireVsCodeApi: () => {
		postMessage(message: WebviewMessage): void;
		setState(state: any): void;
		getState(): any;
	};
}
