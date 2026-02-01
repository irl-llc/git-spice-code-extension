/**
 * Unit tests for messageRouter.ts
 * Tests that all webview message types are routed to the correct handler methods.
 */

import * as assert from 'assert';

import { routeMessage, type MessageHandlerContext, type ExecFunctionMap } from '../../stackView/messageRouter';
import type { WebviewMessage } from '../../stackView/webviewTypes';

/** Creates a mock handler context that tracks which methods were called. */
function createMockContext(): MessageHandlerContext & { calls: string[] } {
	const calls: string[] = [];
	const mockExecFunctions: ExecFunctionMap = {
		untrack: async () => ({ value: undefined }),
		checkout: async () => ({ value: undefined }),
		fold: async () => ({ value: undefined }),
		squash: async () => ({ value: undefined }),
		edit: async () => ({ value: undefined }),
		restack: async () => ({ value: undefined }),
		submit: async () => ({ value: undefined }),
	};

	return {
		calls,
		pushState: () => { calls.push('pushState'); },
		refresh: async () => { calls.push('refresh'); },
		handleOpenExternal: (url: string) => { calls.push(`handleOpenExternal:${url}`); },
		handleOpenCommit: (sha: string) => { calls.push(`handleOpenCommit:${sha}`); },
		handleOpenCommitDiff: async (sha: string) => { calls.push(`handleOpenCommitDiff:${sha}`); },
		handleBranchContextMenu: async (branchName: string) => { calls.push(`handleBranchContextMenu:${branchName}`); },
		handleBranchCommandInternal: async (commandName: string, branchName: string) => {
			calls.push(`handleBranchCommandInternal:${commandName}:${branchName}`);
		},
		handleBranchDelete: async (branchName: string) => { calls.push(`handleBranchDelete:${branchName}`); },
		handleBranchRenamePrompt: async (branchName: string) => { calls.push(`handleBranchRenamePrompt:${branchName}`); },
		handleBranchRename: async (branchName: string, newName: string) => {
			calls.push(`handleBranchRename:${branchName}:${newName}`);
		},
		handleBranchMovePrompt: async (branchName: string) => { calls.push(`handleBranchMovePrompt:${branchName}`); },
		handleBranchMove: async (branchName: string, newParent: string) => {
			calls.push(`handleBranchMove:${branchName}:${newParent}`);
		},
		handleUpstackMovePrompt: async (branchName: string) => { calls.push(`handleUpstackMovePrompt:${branchName}`); },
		handleUpstackMove: async (branchName: string, newParent: string) => {
			calls.push(`handleUpstackMove:${branchName}:${newParent}`);
		},
		handleGetCommitFiles: async (sha: string) => { calls.push(`handleGetCommitFiles:${sha}`); },
		handleOpenFileDiff: async (sha: string, path: string) => { calls.push(`handleOpenFileDiff:${sha}:${path}`); },
		handleOpenCurrentFile: async (path: string) => { calls.push(`handleOpenCurrentFile:${path}`); },
		handleStageFile: async (path: string) => { calls.push(`handleStageFile:${path}`); },
		handleUnstageFile: async (path: string) => { calls.push(`handleUnstageFile:${path}`); },
		handleDiscardFile: async (path: string) => { calls.push(`handleDiscardFile:${path}`); },
		handleOpenWorkingCopyDiff: async (path: string, staged: boolean) => {
			calls.push(`handleOpenWorkingCopyDiff:${path}:${staged}`);
		},
		handleCommitChanges: async (message: string) => { calls.push(`handleCommitChanges:${message}`); },
		handleCreateBranch: async (message: string) => { calls.push(`handleCreateBranch:${message}`); },
		handleCommitCopySha: async (sha: string) => { calls.push(`handleCommitCopySha:${sha}`); },
		handleCommitFixup: async (sha: string) => { calls.push(`handleCommitFixup:${sha}`); },
		handleCommitSplit: async (sha: string, branchName: string) => {
			calls.push(`handleCommitSplit:${sha}:${branchName}`);
		},
		getExecFunctions: () => mockExecFunctions,
	};
}

describe('messageRouter', () => {
	describe('routeMessage', () => {
		describe('state messages', () => {
			it('should route ready message to pushState', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'ready' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['pushState']);
			});

			it('should route refresh message to refresh', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'refresh' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['refresh']);
			});
		});

		describe('navigation messages', () => {
			it('should route openChange message to handleOpenExternal', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'openChange', url: 'https://github.com/pr/123' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleOpenExternal:https://github.com/pr/123']);
			});

			it('should route openCommit message to handleOpenCommit', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'openCommit', sha: 'abc123' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleOpenCommit:abc123']);
			});

			it('should route openCommitDiff message to handleOpenCommitDiff', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'openCommitDiff', sha: 'abc123' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleOpenCommitDiff:abc123']);
			});
		});

		describe('branch context messages', () => {
			it('should route branchContextMenu message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'branchContextMenu', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleBranchContextMenu:feature-1']);
			});

			it('should route branchDelete message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'branchDelete', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleBranchDelete:feature-1']);
			});

			it('should route branchRenamePrompt message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'branchRenamePrompt', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleBranchRenamePrompt:feature-1']);
			});

			it('should route branchRename message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'branchRename', branchName: 'feature-1', newName: 'feature-2' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleBranchRename:feature-1:feature-2']);
			});
		});

		describe('branch move messages', () => {
			it('should route branchMovePrompt message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'branchMovePrompt', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleBranchMovePrompt:feature-1']);
			});

			it('should route branchMove message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'branchMove', branchName: 'feature-1', newParent: 'main' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleBranchMove:feature-1:main']);
			});

			it('should route upstackMovePrompt message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'upstackMovePrompt', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleUpstackMovePrompt:feature-1']);
			});

			it('should route upstackMove message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'upstackMove', branchName: 'feature-1', newParent: 'main' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleUpstackMove:feature-1:main']);
			});
		});

		describe('commit messages', () => {
			it('should route getCommitFiles message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'getCommitFiles', sha: 'abc123' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleGetCommitFiles:abc123']);
			});

			it('should route commitCopySha message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'commitCopySha', sha: 'abc123' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleCommitCopySha:abc123']);
			});

			it('should route commitFixup message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'commitFixup', sha: 'abc123' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleCommitFixup:abc123']);
			});

			it('should route commitSplit message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'commitSplit', sha: 'abc123', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleCommitSplit:abc123:feature-1']);
			});
		});

		describe('file messages', () => {
			it('should route openFileDiff message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'openFileDiff', sha: 'abc123', path: 'src/file.ts' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleOpenFileDiff:abc123:src/file.ts']);
			});

			it('should route openCurrentFile message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'openCurrentFile', path: 'src/file.ts' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleOpenCurrentFile:src/file.ts']);
			});
		});

		describe('working copy messages', () => {
			it('should route stageFile message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'stageFile', path: 'src/file.ts' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleStageFile:src/file.ts']);
			});

			it('should route unstageFile message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'unstageFile', path: 'src/file.ts' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleUnstageFile:src/file.ts']);
			});

			it('should route discardFile message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'discardFile', path: 'src/file.ts' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleDiscardFile:src/file.ts']);
			});

			it('should route openWorkingCopyDiff message for staged files', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'openWorkingCopyDiff', path: 'src/file.ts', staged: true }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleOpenWorkingCopyDiff:src/file.ts:true']);
			});

			it('should route openWorkingCopyDiff message for unstaged files', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'openWorkingCopyDiff', path: 'src/file.ts', staged: false }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleOpenWorkingCopyDiff:src/file.ts:false']);
			});

			it('should route commitChanges message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'commitChanges', message: 'feat: add feature' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleCommitChanges:feat: add feature']);
			});

			it('should route createBranch message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'createBranch', message: 'feat: add feature' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleCreateBranch:feat: add feature']);
			});
		});

		describe('branch command messages', () => {
			it('should route branchUntrack message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'branchUntrack', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleBranchCommandInternal:untrack:feature-1']);
			});

			it('should route branchCheckout message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'branchCheckout', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleBranchCommandInternal:checkout:feature-1']);
			});

			it('should route branchFold message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'branchFold', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleBranchCommandInternal:fold:feature-1']);
			});

			it('should route branchSquash message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'branchSquash', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleBranchCommandInternal:squash:feature-1']);
			});

			it('should route branchEdit message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'branchEdit', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleBranchCommandInternal:edit:feature-1']);
			});

			it('should route branchRestack message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'branchRestack', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleBranchCommandInternal:restack:feature-1']);
			});

			it('should route branchSubmit message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'branchSubmit', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleBranchCommandInternal:submit:feature-1']);
			});
		});
	});
});
