/**
 * Component tests for BranchCard.tsx.
 *
 * Covers the interactive contract — chevron toggle, header click-to-expand,
 * tag visibility (restack, comments, squash, submit, PR link), each
 * button's outbound message — and the slot delegate invocations for
 * summary and commits.
 */

// MUST be first — installs JSDOM globals before testing-library imports.
import { installJsdomGlobals } from '../reactTestHelper';

import * as assert from 'assert';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { BranchCard } from '../../../../stackView/webview/components/BranchCard';
import type { BranchViewModel, TreeFragmentData, TreePosition } from '../../../../stackView/types';
import type { WebviewMessage } from '../../../../stackView/webviewTypes';

function makeTreeFragment(overrides?: Partial<TreeFragmentData>): TreeFragmentData {
	return {
		lanes: [{ continuesFromAbove: false, continuesBelow: false, hasNode: true, needsRestack: false }],
		maxLane: 0,
		nodeLane: 0,
		childForkLanes: [],
		nodeStyle: 'normal',
		nodeNeedsRestack: false,
		...overrides,
	};
}

function makeTreePosition(overrides?: Partial<TreePosition>): TreePosition {
	return {
		depth: 0,
		isLastChild: true,
		ancestorIsLast: [],
		siblingIndex: 0,
		siblingCount: 1,
		lane: 0,
		...overrides,
	};
}

function makeBranch(overrides?: Partial<BranchViewModel>): BranchViewModel {
	return {
		name: 'feat-a',
		current: false,
		restack: false,
		commits: [{ sha: 'abc123', shortSha: 'abc', subject: 'first' }],
		tree: makeTreePosition(),
		treeFragment: makeTreeFragment(),
		...overrides,
	};
}

interface Harness {
	messages: WebviewMessage[];
	postMessage: (m: WebviewMessage) => void;
	setArticleClass: (cls: string, on: boolean) => void;
	getArticle: () => HTMLElement | null;
	commitsCalls: string[];
	summaryCalls: string[];
	classToggles: Array<[string, boolean]>;
}

function harness(): Harness {
	const messages: WebviewMessage[] = [];
	const classToggles: Array<[string, boolean]> = [];
	const commitsCalls: string[] = [];
	const summaryCalls: string[] = [];
	return {
		messages,
		postMessage: (m) => messages.push(m),
		setArticleClass: (cls, on) => classToggles.push([cls, on]),
		getArticle: () => document.createElement('article'),
		commitsCalls,
		summaryCalls,
		classToggles,
	};
}

describe('BranchCard', () => {
	beforeEach(installJsdomGlobals);
	afterEach(cleanup);

	describe('header', () => {
		it('displays the branch name', () => {
			const h = harness();
			render(
				<BranchCard
					branch={makeBranch({ name: 'feat-a' })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			assert.ok(screen.getByText('feat-a'), 'branch name visible');
		});

		it('chevron has aria-expanded matching local state, toggles on click', () => {
			const h = harness();
			render(
				<BranchCard
					branch={makeBranch({ current: false })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			const toggle = screen.getByRole('button', { name: /expand feat-a/i });
			assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
			fireEvent.click(toggle);
			const collapse = screen.getByRole('button', { name: /collapse feat-a/i });
			assert.strictEqual(collapse.getAttribute('aria-expanded'), 'true');
		});

		it('chevron starts expanded when branch.current is true', () => {
			const h = harness();
			render(
				<BranchCard
					branch={makeBranch({ current: true })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			const toggle = screen.getByRole('button', { name: /collapse feat-a/i });
			assert.strictEqual(toggle.getAttribute('aria-expanded'), 'true');
		});

		it('setArticleClass receives "expanded" updates when state toggles', () => {
			const h = harness();
			render(
				<BranchCard
					branch={makeBranch({ current: false })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			// Initial effect fires with expanded=false.
			assert.deepStrictEqual(h.classToggles, [['expanded', false]]);
			fireEvent.click(screen.getByRole('button', { name: /expand feat-a/i }));
			assert.deepStrictEqual(h.classToggles, [
				['expanded', false],
				['expanded', true],
			]);
		});

		it('renders a spacer (no toggle button) when branch has no commits', () => {
			const h = harness();
			const { container } = render(
				<BranchCard
					branch={makeBranch({ commits: [] })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			assert.strictEqual(screen.queryByRole('button', { name: /expand/i }), null);
			assert.ok(container.querySelector('.branch-toggle-spacer'), 'spacer present');
		});
	});

	describe('tags', () => {
		it('shows the Restack tag when branch.restack is true', () => {
			const h = harness();
			render(
				<BranchCard
					branch={makeBranch({ restack: true })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			assert.ok(screen.getByText('Restack'));
		});

		it('does not render the Restack tag when branch.restack is false', () => {
			const h = harness();
			render(
				<BranchCard
					branch={makeBranch({ restack: false })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			assert.strictEqual(screen.queryByText('Restack'), null);
		});

		it('renders a squash button only when the branch has multiple commits', () => {
			const h = harness();
			const { rerender } = render(
				<BranchCard
					branch={makeBranch({
						commits: [{ sha: 'a', shortSha: 'a', subject: 'first' }],
					})}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			assert.strictEqual(screen.queryByRole('button', { name: /squash/i }), null);
			rerender(
				<BranchCard
					branch={makeBranch({
						commits: [
							{ sha: 'a', shortSha: 'a', subject: 'first' },
							{ sha: 'b', shortSha: 'b', subject: 'second' },
						],
					})}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			assert.ok(screen.getByRole('button', { name: /squash commits on feat-a/i }));
		});

		it('clicking squash posts branchSquash and does not toggle the header', () => {
			const h = harness();
			render(
				<BranchCard
					branch={makeBranch({
						commits: [
							{ sha: 'a', shortSha: 'a', subject: 'first' },
							{ sha: 'b', shortSha: 'b', subject: 'second' },
						],
					})}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			fireEvent.click(screen.getByRole('button', { name: /squash commits on feat-a/i }));
			assert.deepStrictEqual(h.messages, [{ type: 'branchSquash', branchName: 'feat-a' }]);
			// Header toggle should not have fired — chevron state unchanged.
			const toggle = screen.getByRole('button', { name: /expand feat-a/i });
			assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
		});

		it('clicking submit posts branchSubmit', () => {
			const h = harness();
			render(<BranchCard branch={makeBranch()} postMessage={h.postMessage} setArticleClass={h.setArticleClass} />);
			fireEvent.click(screen.getByRole('button', { name: /create pr for feat-a/i }));
			assert.deepStrictEqual(h.messages, [{ type: 'branchSubmit', branchName: 'feat-a' }]);
		});

		it('submit button label switches to "Submit" when branch already has a change', () => {
			const h = harness();
			render(
				<BranchCard
					branch={makeBranch({ change: { id: '#42' } })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			assert.ok(screen.getByRole('button', { name: /submit feat-a and ancestors/i }));
		});

		it('PR link opens the URL when present and posts openChange', () => {
			const h = harness();
			render(
				<BranchCard
					branch={makeBranch({ change: { id: '#42', url: 'https://github.com/x/y/pull/42' } })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			fireEvent.click(screen.getByRole('button', { name: /open pr #42 for feat-a/i }));
			assert.deepStrictEqual(h.messages, [{ type: 'openChange', url: 'https://github.com/x/y/pull/42' }]);
		});

		it('PR link is disabled when no URL is available', () => {
			const h = harness();
			render(
				<BranchCard
					branch={makeBranch({ change: { id: '#42' } })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			const prLink = screen.getByRole('button', { name: /pr #42 \(no url\)/i });
			assert.strictEqual((prLink as HTMLButtonElement).disabled, true);
		});

		it('comments indicator renders resolved/total with all-resolved style when comments are complete', () => {
			const h = harness();
			render(
				<BranchCard
					branch={makeBranch({
						change: { id: '#42', comments: { total: 3, resolved: 3, unresolved: 0 } },
					})}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			assert.ok(screen.getByText('3/3'));
		});

		it('comments indicator uses has-unresolved style when some remain unresolved', () => {
			const h = harness();
			const { container } = render(
				<BranchCard
					branch={makeBranch({
						change: { id: '#42', comments: { total: 5, resolved: 2, unresolved: 3 } },
					})}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			const indicator = container.querySelector('.comments-indicator');
			assert.ok(indicator?.classList.contains('has-unresolved'));
		});

		it('renders a worktree badge with basename label and per-path color class when parked', () => {
			const h = harness();
			const { container } = render(
				<BranchCard
					branch={makeBranch({ worktree: '/home/u/repo-wt-a' })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			const badge = container.querySelector('.tag-worktree');
			assert.ok(badge, 'worktree badge should be present');
			assert.ok(screen.getByText('repo-wt-a'), 'badge shows the worktree basename');
			assert.ok(
				/\btag-wt-[0-7]\b/.test(badge!.className),
				`badge should carry a palette color class, got "${badge!.className}"`,
			);
			assert.strictEqual(badge!.getAttribute('title'), 'Checked out in worktree /home/u/repo-wt-a');
		});

		it('does not render a worktree badge when the branch is not parked elsewhere', () => {
			const h = harness();
			const { container } = render(
				<BranchCard branch={makeBranch()} postMessage={h.postMessage} setArticleClass={h.setArticleClass} />,
			);
			assert.strictEqual(container.querySelector('.tag-worktree'), null);
		});
	});

	describe('header click bubble', () => {
		it('clicking the header (not a button) toggles expand', () => {
			const h = harness();
			const { container } = render(
				<BranchCard
					branch={makeBranch({ current: false })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			const header = container.querySelector('.branch-header') as HTMLElement;
			fireEvent.click(header);
			assert.ok(screen.getByRole('button', { name: /collapse feat-a/i }));
		});

		it('clicking a button inside the header does NOT toggle the header', () => {
			const h = harness();
			render(
				<BranchCard
					branch={makeBranch({ current: false })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			fireEvent.click(screen.getByRole('button', { name: /create pr for feat-a/i }));
			const toggle = screen.getByRole('button', { name: /expand feat-a/i });
			assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
		});
	});

	describe('meta and slots', () => {
		it('renders the open CR status as a steady pill tag', () => {
			const h = harness();
			const { container } = render(
				<BranchCard
					branch={makeBranch({ change: { id: '#1', status: 'open' } })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			const badge = container.querySelector('.tag-cr.tag-cr-open');
			assert.ok(badge, 'open badge present');
			assert.strictEqual(container.querySelector('.cr-transient'), null, 'open is not a transient note');
			assert.ok(screen.getByText('Open'), 'label Open visible');
		});

		it('renders merged/closed as transient inline notes, not steady pills', () => {
			const cases = [
				['merged', 'Merged'],
				['closed', 'Closed'],
			] as const;
			for (const [status, label] of cases) {
				const h = harness();
				const { container } = render(
					<BranchCard
						branch={makeBranch({ change: { id: '#1', status } })}
						postMessage={h.postMessage}
						setArticleClass={h.setArticleClass}
					/>,
				);
				const note = container.querySelector(`.cr-transient.cr-transient-${status}`);
				assert.ok(note, `transient note for ${status} present`);
				assert.strictEqual(container.querySelector('.tag-cr'), null, `${status} does not render the steady CR pill`);
				assert.ok(screen.getByText(label), `label ${label} visible`);
				cleanup();
			}
		});

		it('marks the closed transient note as an error-styled call-out', () => {
			const h = harness();
			const { container } = render(
				<BranchCard
					branch={makeBranch({ change: { id: '#1', status: 'closed' } })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			const note = container.querySelector('.cr-transient-closed');
			assert.ok(note, 'closed note present');
			assert.match(note?.getAttribute('title') ?? '', /re-created on the next submit/i);
		});

		it('marks the merged transient note with a removed-on-next-sync hint', () => {
			const h = harness();
			const { container } = render(
				<BranchCard
					branch={makeBranch({ change: { id: '#1', status: 'merged' } })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			const note = container.querySelector('.cr-transient-merged');
			assert.ok(note, 'merged note present');
			assert.match(note?.getAttribute('title') ?? '', /removed on the next repo sync/i);
		});

		it('omits the CR affordance entirely when change has no status', () => {
			const h = harness();
			const { container } = render(
				<BranchCard
					branch={makeBranch({ change: { id: '#1' } })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
				/>,
			);
			assert.strictEqual(container.querySelector('.tag-cr'), null);
			assert.strictEqual(container.querySelector('.cr-transient'), null);
		});

		it('renders an unknown CR status defensively as a steady tag (no crash, raw label)', () => {
			const h = harness();
			// Simulate a future CLI/forge status outside the typed set.
			const change = { id: '#1', status: 'draft' as unknown as 'open' };
			const { container } = render(
				<BranchCard branch={makeBranch({ change })} postMessage={h.postMessage} setArticleClass={h.setArticleClass} />,
			);
			assert.ok(container.querySelector('.tag-cr.tag-cr-draft'), 'tag still renders for unknown status');
			assert.ok(screen.getByText('draft'), 'falls back to the raw status text');
		});

		it('renders the `commits` child prop when provided', () => {
			const h = harness();
			const { container } = render(
				<BranchCard
					branch={makeBranch({ name: 'feat-z' })}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
					commits={<div className="branch-commits sentinel-commits" />}
				/>,
			);
			assert.ok(
				container.querySelector('.branch-content .sentinel-commits'),
				'commits child rendered inside branch-content',
			);
		});

		it('renders the `summary` child prop when provided', () => {
			const h = harness();
			const { container } = render(
				<BranchCard
					branch={makeBranch({
						commits: [
							{ sha: 'a', shortSha: 'a', subject: '1' },
							{ sha: 'b', shortSha: 'b', subject: '2' },
						],
					})}
					postMessage={h.postMessage}
					setArticleClass={h.setArticleClass}
					summary={<div className="branch-summary sentinel-summary" />}
				/>,
			);
			assert.ok(
				container.querySelector('.branch-content .sentinel-summary'),
				'summary child rendered inside branch-content',
			);
		});

		it('does not render slots when neither `summary` nor `commits` is provided', () => {
			const h = harness();
			const { container } = render(
				<BranchCard branch={makeBranch()} postMessage={h.postMessage} setArticleClass={h.setArticleClass} />,
			);
			assert.strictEqual(container.querySelector('.branch-summary'), null);
			assert.strictEqual(container.querySelector('.branch-commits'), null);
		});
	});
});
