/**
 * Branch operation handlers extracted from StackViewProvider.
 * Handles branch context menu, delete, rename, and move operations.
 */

import * as vscode from 'vscode';

import type { GitSpiceBranch } from '../../gitSpiceSchema';
import type { BranchContextMenuItem } from '../types';
import type { BranchCommandResult } from '../../utils/gitSpice';
import {
	execBranchUntrack,
	execBranchDelete,
	execBranchCheckout,
	execBranchFold,
	execBranchSquash,
	execBranchEdit,
	execBranchRename,
	execBranchRestack,
	execBranchSubmit,
	execBranchMove,
	execUpstackMove,
} from '../../utils/gitSpice';
import { requireNonEmpty, requireAllNonEmpty, requireWorkspace } from '../../utils/validation';

/** Dependencies needed by branch handlers. */
export interface BranchHandlerDeps {
	workspaceFolder: vscode.WorkspaceFolder | undefined;
	branches: GitSpiceBranch[];
	runBranchCommand: (
		title: string,
		operation: () => Promise<BranchCommandResult>,
		successMessage: string,
	) => Promise<boolean>;
	handleBranchCommandInternal: (
		commandName: string,
		branchName: string,
		execFunction: (folder: vscode.WorkspaceFolder, branchName: string) => Promise<BranchCommandResult>,
	) => Promise<void>;
	postMessageToWebview: (message: { type: string; branchName: string; newName: string }) => void;
}

/** Shows a native VSCode QuickPick menu for branch actions. */
export async function handleBranchContextMenu(branchName: string, deps: BranchHandlerDeps): Promise<void> {
	const branch = deps.branches.find((b) => b.name === branchName);
	if (!branch) return;

	const items = buildContextMenuItems(branch);
	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: `Actions for branch '${branchName}'`,
	});
	if (!selected) return;

	dispatchContextMenuAction(selected.action, branchName, deps);
}

/** Builds the context menu items based on branch state. */
function buildContextMenuItems(branch: GitSpiceBranch): BranchContextMenuItem[] {
	const isCurrent = branch.current === true;
	const needsRestack =
		branch.down?.needsRestack === true || (branch.ups ?? []).some((link) => link.needsRestack === true);
	const hasPR = Boolean(branch.change);

	const items: BranchContextMenuItem[] = [
		{ label: '$(git-branch) Checkout', action: 'checkout' },
		{ label: '$(tag) Rename...', action: 'rename' },
		{ label: '$(move) Move onto...', action: 'move' },
		{ label: '$(type-hierarchy) Move with children onto...', action: 'upstackMove' },
	];

	if (isCurrent) {
		items.push({ label: '$(edit) Edit', action: 'edit' });
	}

	if (needsRestack) {
		items.push({ label: '$(refresh) Restack', action: 'restack', description: 'Needs restack' });
	}

	items.push({
		label: hasPR ? '$(cloud-upload) Submit' : '$(git-pull-request) Submit (create PR)',
		action: 'submit',
	});

	items.push({ label: '$(fold) Fold', action: 'fold' });
	items.push({ label: '$(fold-down) Squash', action: 'squash' });
	items.push({ label: '$(eye-closed) Untrack', action: 'untrack' });
	items.push({ label: '$(trash) Delete', action: 'delete' });

	return items;
}

/** Dispatches a context menu action to the appropriate handler. */
function dispatchContextMenuAction(action: string, branchName: string, deps: BranchHandlerDeps): void {
	const execActions: Record<string, typeof execBranchCheckout> = {
		checkout: execBranchCheckout,
		edit: execBranchEdit,
		restack: execBranchRestack,
		submit: execBranchSubmit,
		fold: execBranchFold,
		squash: execBranchSquash,
		untrack: execBranchUntrack,
	};

	const execFn = execActions[action];
	if (execFn) {
		void deps.handleBranchCommandInternal(action, branchName, execFn);
		return;
	}

	const promptActions: Record<string, () => void> = {
		rename: () => void handleBranchRenamePrompt(branchName, deps),
		move: () => void handleBranchMovePrompt(branchName, deps),
		upstackMove: () => void handleUpstackMovePrompt(branchName, deps),
		delete: () => void handleBranchDelete(branchName, deps),
	};

	promptActions[action]?.();
}

/** Handles branch deletion with confirmation dialog. */
export async function handleBranchDelete(branchName: string, deps: BranchHandlerDeps): Promise<void> {
	const trimmedName = requireNonEmpty(branchName, 'branch name for delete');
	if (!trimmedName) return;

	if (!requireWorkspace(deps.workspaceFolder)) return;

	const confirmed = await vscode.window.showWarningMessage(
		`Delete branch '${trimmedName}'? This will untrack it and delete the local branch.`,
		{ modal: true },
		'Delete',
	);
	if (confirmed !== 'Delete') return;

	await deps.runBranchCommand(
		`Deleting branch: ${trimmedName}`,
		() => execBranchDelete(deps.workspaceFolder!, trimmedName),
		`Branch ${trimmedName} deleted successfully.`,
	);
}

/** Prompts user for new branch name and dispatches rename message. */
export async function handleBranchRenamePrompt(branchName: string, deps: BranchHandlerDeps): Promise<void> {
	const trimmedName = requireNonEmpty(branchName, 'branch name for rename');
	if (!trimmedName) return;

	try {
		const newName = await vscode.window.showInputBox({
			prompt: `Enter new name for branch '${trimmedName}':`,
			value: trimmedName,
			validateInput: (input) => {
				if (!input || !input.trim()) return 'Branch name cannot be empty.';
				if (input.trim() === trimmedName) return 'New name must be different from current name.';
				return null;
			},
		});

		if (newName && newName.trim() && newName !== trimmedName) {
			deps.postMessageToWebview({ type: 'branchRename', branchName: trimmedName, newName: newName.trim() });
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(`Error showing rename prompt: ${message}`);
	}
}

/** Executes branch rename with new name. */
export async function handleBranchRename(
	branchName: string,
	newName: string,
	deps: BranchHandlerDeps,
): Promise<void> {
	const validated = requireAllNonEmpty([
		[branchName, 'branch name for rename'],
		[newName, 'new name for rename'],
	]);
	if (!validated) return;
	const [trimmedBranch, trimmedNew] = validated;

	if (!requireWorkspace(deps.workspaceFolder)) return;

	await deps.runBranchCommand(
		`Renaming branch: ${trimmedBranch} → ${trimmedNew}`,
		() => execBranchRename(deps.workspaceFolder!, trimmedBranch, trimmedNew),
		`Branch renamed from ${trimmedBranch} to ${trimmedNew} successfully.`,
	);
}

/** Prompts user to select a new parent branch for the move operation. */
export async function handleBranchMovePrompt(branchName: string, deps: BranchHandlerDeps): Promise<void> {
	const trimmedName = requireNonEmpty(branchName, 'branch name for move');
	if (!trimmedName) return;

	const availableParents = deps.branches.filter((b) => b.name !== trimmedName).map((b) => b.name);
	if (availableParents.length === 0) {
		void vscode.window.showWarningMessage('No other branches available to move onto.');
		return;
	}

	const selected = await vscode.window.showQuickPick(availableParents, {
		placeHolder: `Select new parent for '${trimmedName}'`,
		title: 'Move Branch Onto...',
	});

	if (selected) {
		void handleBranchMove(trimmedName, selected, deps);
	}
}

/** Moves a branch to a new parent. */
export async function handleBranchMove(
	branchName: string,
	newParent: string,
	deps: BranchHandlerDeps,
): Promise<void> {
	const validated = requireAllNonEmpty([
		[branchName, 'branch name for move'],
		[newParent, 'parent name for move'],
	]);
	if (!validated) return;
	const [trimmedBranch, trimmedParent] = validated;

	if (!requireWorkspace(deps.workspaceFolder)) return;

	await deps.runBranchCommand(
		`Moving branch: ${trimmedBranch} → ${trimmedParent}`,
		() => execBranchMove(deps.workspaceFolder!, trimmedBranch, trimmedParent),
		`Branch ${trimmedBranch} moved onto ${trimmedParent} successfully.`,
	);
}

/** Prompts user to select a new parent branch for moving with children. */
export async function handleUpstackMovePrompt(branchName: string, deps: BranchHandlerDeps): Promise<void> {
	const trimmedName = requireNonEmpty(branchName, 'branch name for upstack move');
	if (!trimmedName) return;

	const availableParents = deps.branches.filter((b) => b.name !== trimmedName).map((b) => b.name);
	if (availableParents.length === 0) {
		void vscode.window.showWarningMessage('No other branches available to move onto.');
		return;
	}

	const selected = await vscode.window.showQuickPick(availableParents, {
		placeHolder: `Select new parent for '${trimmedName}' and its children`,
		title: 'Move Branch with Children Onto...',
	});

	if (selected) {
		void handleUpstackMove(trimmedName, selected, deps);
	}
}

/** Moves a branch and all its descendants to a new parent. */
export async function handleUpstackMove(
	branchName: string,
	newParent: string,
	deps: BranchHandlerDeps,
): Promise<void> {
	const validated = requireAllNonEmpty([
		[branchName, 'branch name for upstack move'],
		[newParent, 'parent name for upstack move'],
	]);
	if (!validated) return;
	const [trimmedBranch, trimmedParent] = validated;

	if (!requireWorkspace(deps.workspaceFolder)) return;

	await deps.runBranchCommand(
		`Moving branch with children: ${trimmedBranch} → ${trimmedParent}`,
		() => execUpstackMove(deps.workspaceFolder!, trimmedBranch, trimmedParent),
		`Branch ${trimmedBranch} and children moved onto ${trimmedParent} successfully.`,
	);
}
