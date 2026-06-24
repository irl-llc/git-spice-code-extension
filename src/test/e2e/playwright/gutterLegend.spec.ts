/**
 * Visual snapshot tests for the swimlane gutter color legend (issue #79).
 *
 * The gutter lane/node colors encode branch state but carry no inline label
 * (the read-only badges that used to spell this out are being removed in the
 * #65 visual clean-up). The legend restores that meaning as detail-on-hover:
 * an invisible full-height strip over the gutter reveals a small swatch
 * legend popover when pointed at.
 *
 * Two states are captured, per the visual-design rule "hover for detail; show
 * non-default status only":
 *   - default: the legend is hidden (no omnipresent chrome).
 *   - hovered: the legend popover is visible, listing each color/state.
 *
 * Snapshots are Linux-rendered (Docker compose); regenerate via
 * `npm run test:e2e:playwright:docker:update`.
 */

import { expect, test, type Frame } from '@playwright/test';

import { createTempRepo, type WorkspaceRepo } from './fixtures/repo';
import { launchVSCode, type VSCodeInstance } from './fixtures/vscode';
import { openGitSpiceEditor } from './fixtures/webview';

const TRUNK = 'main';

/**
 * Seeds a linear three-branch stack so the gutter shows the default lane
 * color, the current-branch node, and the integration fork — the states the
 * legend popover names.
 */
function seedStack(repo: WorkspaceRepo): void {
	repo.createBranch({ name: 'feat-a', base: TRUNK, commits: [{ message: 'add a', files: { 'a.txt': 'a\n' } }] });
	repo.createBranch({ name: 'feat-b', base: 'feat-a', commits: [{ message: 'add b', files: { 'b.txt': 'b\n' } }] });
	repo.createBranch({ name: 'feat-c', base: 'feat-b', commits: [{ message: 'add c', files: { 'c.txt': 'c\n' } }] });
}

test.describe('gutter legend', () => {
	let repo: WorkspaceRepo;
	let vscode: VSCodeInstance;

	test.beforeAll(async () => {
		repo = createTempRepo();
		repo.initTrunk(TRUNK);
		seedStack(repo);
		vscode = await launchVSCode(repo.path);
	});

	test.afterAll(async () => {
		await vscode?.close();
		repo?.cleanup();
	});

	async function openFrame(): Promise<Frame> {
		const frame = await openGitSpiceEditor(vscode.workbench);
		await frame.locator('.stack-item').first().waitFor({ state: 'visible', timeout: 30_000 });
		await frame.locator('.gutter-legend').first().waitFor({ state: 'attached', timeout: 30_000 });
		// Quiet the workbench chrome whose ongoing animations otherwise trip the
		// screenshot stability check: dismiss the Docker "running as root" toast
		// and close the Copilot Chat auxiliary bar (it streams content in).
		await runPaletteCommand(vscode.workbench, 'Notifications: Clear All Notifications');
		await runPaletteCommand(vscode.workbench, 'View: Hide Secondary Side Bar');
		// Let the initial React state message settle before snapshotting.
		await vscode.workbench.waitForTimeout(500);
		return frame;
	}

	async function runPaletteCommand(workbench: typeof vscode.workbench, command: string): Promise<void> {
		await workbench.keyboard.press('F1');
		await workbench.locator('.quick-input-widget').waitFor({ state: 'visible', timeout: 10_000 });
		await workbench.keyboard.type(command);
		await workbench.waitForTimeout(300);
		await workbench.keyboard.press('Enter');
		await workbench.waitForTimeout(300);
	}

	test('legend is hidden by default', async () => {
		const frame = await openFrame();
		const list = frame.locator('.repo-branch-list').first();
		await expect(list.locator('.gutter-legend-popover')).toBeHidden();
		await expect(list).toHaveScreenshot('gutter-legend-default.png');
	});

	test('legend popover appears when pinned open', async () => {
		const frame = await openFrame();
		const list = frame.locator('.repo-branch-list').first();
		// Hover reveals the popover in normal use; for a deterministic snapshot
		// we pin it open (the same affordance keyboard/touch users rely on).
		// We dispatch the click via evaluate() rather than locator.click() to
		// skip Playwright's actionability wait: the strip is an absolutely
		// positioned overlay that the surrounding workbench chrome keeps nudging
		// by sub-pixel amounts, which stalls the "element stable" check.
		await list
			.locator('.gutter-legend')
			.first()
			.evaluate((el) => (el as HTMLElement).click());
		const popover = list.locator('.gutter-legend-popover');
		await expect(popover).toBeVisible();
		await expect(list).toHaveScreenshot('gutter-legend-pinned.png');
	});
});
