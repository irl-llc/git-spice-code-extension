import { spawn } from 'node:child_process';

import * as vscode from 'vscode';

import { GIT_SPICE_TIMEOUT_MS } from '../constants';
import { toErrorMessage } from './error';
import { getGitSpiceBinary, getWorkspaceFolderPath, NO_OPTIONAL_LOCKS_ENV } from './gitSpice';

export type RepoSyncResult = { value: { deletedBranches: string[]; syncedBranches: number } } | { error: string };

/** Parses the number of synced branches from git-spice output. */
function parseSyncedBranchCount(output: string): number {
	const match = output.match(/(\d+) branch(?:es)? synced/i);
	return match ? Number.parseInt(match[1], 10) : 0;
}

/** Extracts branch name from a deletion prompt if present. */
function extractBranchFromPrompt(text: string): string | undefined {
	const match = text.match(/Delete branch '([^']+)'\? \[y\/N\]/i);
	return match?.[1];
}

/** State for tracking repo sync process. */
interface SyncProcessState {
	deletedBranches: string[];
	outputBuffer: string;
	errorBuffer: string;
	isResolved: boolean;
}

/** Wiring needed to drive a repo sync subprocess to completion. */
interface SyncProcessContext {
	state: SyncProcessState;
	childProcess: ReturnType<typeof spawn>;
	promptCallback: (branchName: string) => Promise<boolean>;
	resolveOnce: (result: RepoSyncResult) => void;
	timeout: NodeJS.Timeout;
}

/** Creates handlers for the repo sync process events. */
function createSyncProcessHandlers(ctx: SyncProcessContext): void {
	// stdio: ['pipe', 'pipe', 'pipe'] guarantees these are non-null
	ctx.childProcess.stdout!.on('data', (data: Buffer) => handleSyncStdout(ctx, data));
	ctx.childProcess.stderr!.on('data', (data: Buffer) => {
		ctx.state.errorBuffer += data.toString();
	});
	ctx.childProcess.on('close', (code) => handleSyncClose(ctx, code));
	ctx.childProcess.on('error', (error) => {
		clearTimeout(ctx.timeout);
		ctx.resolveOnce({ error: `Failed to execute gs repo sync: ${toErrorMessage(error)}` });
	});
}

/** Accumulates stdout and responds to any branch-deletion prompt it contains. */
function handleSyncStdout(ctx: SyncProcessContext, data: Buffer): void {
	const { state, childProcess, promptCallback } = ctx;
	state.outputBuffer += data.toString();
	// Check accumulated buffer to handle prompts split across chunks.
	// Consume the matched portion so repeated data events don't re-trigger.
	const branchName = extractBranchFromPrompt(state.outputBuffer);
	if (branchName) {
		state.outputBuffer = state.outputBuffer.replace(/Delete branch '[^']+'\? \[y\/N\]/i, '');
		handleBranchDeletePrompt(branchName, childProcess, state.deletedBranches, promptCallback);
	}
}

/** Resolves the sync promise from the subprocess exit code and buffers. */
function handleSyncClose(ctx: SyncProcessContext, code: number | null): void {
	const { state, resolveOnce, timeout } = ctx;
	clearTimeout(timeout);
	if (code === 0) {
		resolveOnce({
			value: { deletedBranches: state.deletedBranches, syncedBranches: parseSyncedBranchCount(state.outputBuffer) },
		});
		return;
	}
	const errorMessage = state.errorBuffer.trim() || state.outputBuffer.trim() || `Process exited with code ${code}`;
	resolveOnce({ error: `Repository sync failed: ${errorMessage}` });
}

/** Handles a branch deletion prompt by asking the user. */
function handleBranchDeletePrompt(
	branchName: string,
	childProcess: ReturnType<typeof spawn>,
	deletedBranches: string[],
	promptCallback: (branchName: string) => Promise<boolean>,
): void {
	void (async () => {
		try {
			const shouldDelete = await promptCallback(branchName);
			childProcess.stdin!.write(shouldDelete ? 'y\n' : 'n\n');
			if (shouldDelete) deletedBranches.push(branchName);
		} catch {
			childProcess.stdin!.write('n\n');
		}
	})();
}

/** Executes `gs repo sync` with interactive prompts for branch deletion. */
export async function execRepoSync(
	folder: vscode.WorkspaceFolder,
	promptCallback: (branchName: string) => Promise<boolean>,
): Promise<RepoSyncResult> {
	const cwd = getWorkspaceFolderPath(folder);
	if (!cwd) return { error: 'Invalid workspace folder provided' };
	return new Promise<RepoSyncResult>((resolve) => startSyncProcess(cwd, promptCallback, resolve));
}

/** Builds a `resolveOnce` guard that resolves the sync promise at most once. */
function makeResolveOnce(
	state: SyncProcessState,
	resolve: (result: RepoSyncResult) => void,
): (result: RepoSyncResult) => void {
	return (result: RepoSyncResult): void => {
		if (state.isResolved) return;
		state.isResolved = true;
		resolve(result);
	};
}

/** Spawns `gs repo sync`, wires its handlers, and arms the timeout. */
function startSyncProcess(
	cwd: string,
	promptCallback: (branchName: string) => Promise<boolean>,
	resolve: (result: RepoSyncResult) => void,
): void {
	const state: SyncProcessState = { deletedBranches: [], outputBuffer: '', errorBuffer: '', isResolved: false };
	const resolveOnce = makeResolveOnce(state, resolve);

	const childProcess = spawn(getGitSpiceBinary(), ['repo', 'sync'], {
		cwd,
		stdio: ['pipe', 'pipe', 'pipe'],
		env: NO_OPTIONAL_LOCKS_ENV,
	});
	const timeout = setTimeout(() => {
		childProcess.kill();
		resolveOnce({ error: 'Repository sync timed out after 30 seconds' });
	}, GIT_SPICE_TIMEOUT_MS);

	createSyncProcessHandlers({ state, childProcess, promptCallback, resolveOnce, timeout });
}
