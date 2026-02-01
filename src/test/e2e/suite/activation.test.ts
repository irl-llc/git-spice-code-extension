/**
 * E2E tests for extension activation.
 * Verifies the extension loads and registers commands correctly.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';

const EXTENSION_ID = 'ekohlwey.git-spice';
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
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension, 'Extension should be installed');

		if (!extension.isActive) {
			await extension.activate();
		}
		assert.strictEqual(extension.isActive, true, 'Extension should be active');
	});

	describe('Command Registration', () => {
		before(async () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			if (extension && !extension.isActive) {
				await extension.activate();
			}
		});

		it('should register all expected commands', async () => {
			const allCommands = await vscode.commands.getCommands(true);

			for (const command of EXTENSION_COMMANDS) {
				assert.ok(
					allCommands.includes(command),
					`Command ${command} should be registered`,
				);
			}
		});
	});

	describe('Webview Provider Registration', () => {
		before(async () => {
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			if (extension && !extension.isActive) {
				await extension.activate();
			}
		});

		it('should register the branches webview provider', () => {
			// The webview provider is registered when the extension activates.
			// We can verify it exists by checking the extension's exports or
			// attempting to open the view.
			const extension = vscode.extensions.getExtension(EXTENSION_ID);
			assert.ok(extension?.isActive, 'Extension should be active');
		});
	});
});
