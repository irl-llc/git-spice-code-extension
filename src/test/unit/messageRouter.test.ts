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
		handleOpenExternal: (_repoId, url) => { calls.push(`handleOpenExternal:${url}`); },
		handleOpenCommit: (_repoId, sha) => { calls.push(`handleOpenCommit:${sha}`); },
		handleOpenCommitDiff: async (_repoId, sha) => { calls.push(`handleOpenCommitDiff:${sha}`); },
		handleBranchContextMenu: async (_repoId, branchName) => { calls.push(`handleBranchContextMenu:${branchName}`); },
		handleBranchCommandInternal: async (_repoId, commandName, branchName) => {
			calls.push(`handleBranchCommandInternal:${commandName}:${branchName}`);
		},
		handleBranchDelete: async (_repoId, branchName) => { calls.push(`handleBranchDelete:${branchName}`); },
		handleBranchRenamePrompt: async (_repoId, branchName) => { calls.push(`handleBranchRenamePrompt:${branchName}`); },
		handleBranchRename: async (_repoId, branchName, newName) => {
			calls.push(`handleBranchRename:${branchName}:${newName}`);
		},
		handleBranchMovePrompt: async (_repoId, branchName) => { calls.push(`handleBranchMovePrompt:${branchName}`); },
		handleBranchMove: async (_repoId, branchName, newParent) => {
			calls.push(`handleBranchMove:${branchName}:${newParent}`);
		},
		handleUpstackMovePrompt: async (_repoId, branchName) => { calls.push(`handleUpstackMovePrompt:${branchName}`); },
		handleUpstackMove: async (_repoId, branchName, newParent) => {
			calls.push(`handleUpstackMove:${branchName}:${newParent}`);
		},
		handleGetCommitFiles: async (_repoId, sha) => { calls.push(`handleGetCommitFiles:${sha}`); },
		handleGetBranchFiles: async (_repoId, branchName) => { calls.push(`handleGetBranchFiles:${branchName}`); },
		handleOpenBranchFileDiff: async (_repoId, branchName, path) => {
			calls.push(`handleOpenBranchFileDiff:${branchName}:${path}`);
		},
		handleOpenFileDiff: async (_repoId, sha, path) => { calls.push(`handleOpenFileDiff:${sha}:${path}`); },
		handleOpenCurrentFile: async (_repoId, path) => { calls.push(`handleOpenCurrentFile:${path}`); },
		handleStageFile: async (_repoId, path) => { calls.push(`handleStageFile:${path}`); },
		handleUnstageFile: async (_repoId, path) => { calls.push(`handleUnstageFile:${path}`); },
		handleDiscardFile: async (_repoId, path) => { calls.push(`handleDiscardFile:${path}`); },
		handleOpenWorkingCopyDiff: async (_repoId, path, staged) => {
			calls.push(`handleOpenWorkingCopyDiff:${path}:${staged}`);
		},
		handleCommitChanges: async (_repoId, message) => { calls.push(`handleCommitChanges:${message}`); },
		handleCreateBranch: async (_repoId, message) => { calls.push(`handleCreateBranch:${message}`); },
		handleCommitCopySha: async (_repoId, sha) => { calls.push(`handleCommitCopySha:${sha}`); },
		handleCommitFixup: async (_repoId, sha) => { calls.push(`handleCommitFixup:${sha}`); },
		handleCommitSplit: async (_repoId, sha, branchName) => {
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

			it('should route getBranchFiles message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'getBranchFiles', branchName: 'feature-1' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleGetBranchFiles:feature-1']);
			});

			it('should route openBranchFileDiff message', () => {
				const ctx = createMockContext();
				const result = routeMessage({ type: 'openBranchFileDiff', branchName: 'feature-1', path: 'src/file.ts' }, ctx);
				assert.strictEqual(result, true);
				assert.deepStrictEqual(ctx.calls, ['handleOpenBranchFileDiff:feature-1:src/file.ts']);
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

		describe('repoId passthrough', () => {
			it('should pass repoId from message to handler', () => {
				const ctx = createMockContext();
				const repoIdCapture: (string | undefined)[] = [];
				ctx.handleStageFile = async (repoId, path) => {
					repoIdCapture.push(repoId);
					ctx.calls.push(`handleStageFile:${path}`);
				};
				routeMessage({ type: 'stageFile', repoId: '/path/to/repo', path: 'file.ts' }, ctx);
				assert.deepStrictEqual(repoIdCapture, ['/path/to/repo']);
			});

			it('should pass undefined repoId when not provided', () => {
				const ctx = createMockContext();
				const repoIdCapture: (string | undefined)[] = [];
				ctx.handleStageFile = async (repoId, path) => {
					repoIdCapture.push(repoId);
					ctx.calls.push(`handleStageFile:${path}`);
				};
				routeMessage({ type: 'stageFile', path: 'file.ts' }, ctx);
				assert.deepStrictEqual(repoIdCapture, [undefined]);
			});
		});
	});
});
