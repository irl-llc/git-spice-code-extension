/**
 * E2E tests for extension activation.
 * Verifies the extension loads and registers commands correctly.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { EXTENSION_ID } from '../constants';
import { activateExtension } from '../helpers/extensionHelper';

const EXTENSION_COMMANDS = [
	'git-spice.refresh',
	'git-spice.syncRepo',
	'git-spice.up',
	'git-spice.down',
	'git-spice.trunk',
	'git-spice.branchCheckout',
	'git-spice.branchEdit',
	'git-spice.branchRestack',
	'git-spice.branchSubmit',
	'git-spice.branchFold',
	'git-spice.branchSquash',
	'git-spice.branchUntrack',
	'git-spice.branchRename',
	'git-spice.branchMove',
	'git-spice.branchMoveWithChildren',
	'git-spice.branchDelete',
	'git-spice.stackRestack',
	'git-spice.stackSubmit',
	'git-spice.branchCreateFromCommitMessage',
	'git-spice.toggleCommentProgress',
	'git-spice.commitCopySha',
	'git-spice.commitSplit',
];

describe('Extension Activation', () => {
	it('should be present in installed extensions', () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, `Extension ${EXTENSION_ID} should be installed`);
	});

	it('should activate successfully', async () => {
		const extension = await activateExtension();
		assert.strictEqual(extension.isActive, true, 'Extension should be active');
	});

	describe('Command Registration', () => {
		before(async () => {
			await activateExtension();
		});

		it('should register all expected commands', async () => {
			const allCommands = await vscode.commands.getCommands(true);
			const missing = EXTENSION_COMMANDS.filter((cmd) => !allCommands.includes(cmd));
			assert.strictEqual(missing.length, 0, `Missing commands: ${missing.join(', ')}`);
		});
	});

	describe('Webview Provider Registration', () => {
		before(async () => {
			await activateExtension();
		});

		it('should register the branches webview provider', async () => {
			// Focusing the view exercises the provider registration path;
			// if the provider was not registered this command would throw.
			await assert.doesNotReject(
				() => vscode.commands.executeCommand('gitSpice.branches.focus'),
				'Focusing the branches view should not throw',
			);
		});
	});
});
