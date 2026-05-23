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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
			render(
				<BranchCard
					branch={makeBranch()}
					postMessage={h.postMessage}
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
				/>,
			);
			fireEvent.click(screen.getByRole('button', { name: /create pr for feat-a/i }));
			assert.deepStrictEqual(h.messages, [{ type: 'branchSubmit', branchName: 'feat-a' }]);
		});

		it('submit button label switches to "Submit" when branch already has a change', () => {
			const h = harness();
			render(
				<BranchCard
					branch={makeBranch({ change: { id: '#42' } })}
					postMessage={h.postMessage}
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
				/>,
			);
			const indicator = container.querySelector('.comments-indicator');
			assert.ok(indicator?.classList.contains('has-unresolved'));
		});
	});

	describe('header click bubble', () => {
		it('clicking the header (not a button) toggles expand', () => {
			const h = harness();
			const { container } = render(
				<BranchCard
					branch={makeBranch({ current: false })}
					postMessage={h.postMessage}
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
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
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
				/>,
			);
			fireEvent.click(screen.getByRole('button', { name: /create pr for feat-a/i }));
			const toggle = screen.getByRole('button', { name: /expand feat-a/i });
			assert.strictEqual(toggle.getAttribute('aria-expanded'), 'false');
		});
	});

	describe('meta and slots', () => {
		it('renders branch-meta when change.status is set', () => {
			const h = harness();
			const { container } = render(
				<BranchCard
					branch={makeBranch({ change: { id: '#1', status: 'open' } })}
					postMessage={h.postMessage}
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
				/>,
			);
			assert.ok(container.querySelector('.branch-meta'));
			assert.ok(screen.getByText('open'));
		});

		it('omits branch-meta when change has no status', () => {
			const h = harness();
			const { container } = render(
				<BranchCard
					branch={makeBranch({ change: { id: '#1' } })}
					postMessage={h.postMessage}
					renderCommitsContainer={() => document.createElement('div')}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
				/>,
			);
			assert.strictEqual(container.querySelector('.branch-meta'), null);
		});

		it('invokes the commits delegate with the branch and article element', () => {
			const h = harness();
			let receivedBranch: string | undefined;
			let receivedArticle: HTMLElement | null = null;
			const fakeArticle = document.createElement('article');
			render(
				<BranchCard
					branch={makeBranch({ name: 'feat-z' })}
					postMessage={h.postMessage}
					renderCommitsContainer={(b, article) => {
						receivedBranch = b.name;
						receivedArticle = article;
						const div = document.createElement('div');
						div.className = 'branch-commits';
						return div;
					}}
					setArticleClass={h.setArticleClass}
					getArticle={() => fakeArticle}
				/>,
			);
			assert.strictEqual(receivedBranch, 'feat-z');
			assert.strictEqual(receivedArticle, fakeArticle);
		});

		it('invokes the summary delegate only when the branch has multiple commits', () => {
			const h = harness();
			let invocations = 0;
			const summary = () => {
				invocations += 1;
				const div = document.createElement('div');
				div.className = 'branch-summary';
				return div;
			};
			const { rerender } = render(
				<BranchCard
					branch={makeBranch({ commits: [{ sha: 'a', shortSha: 'a', subject: '1' }] })}
					postMessage={h.postMessage}
					renderCommitsContainer={() => document.createElement('div')}
					renderSummary={summary}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
				/>,
			);
			assert.strictEqual(invocations, 0, 'summary not called for 1-commit branch');
			rerender(
				<BranchCard
					branch={makeBranch({
						commits: [
							{ sha: 'a', shortSha: 'a', subject: '1' },
							{ sha: 'b', shortSha: 'b', subject: '2' },
						],
					})}
					postMessage={h.postMessage}
					renderCommitsContainer={() => document.createElement('div')}
					renderSummary={summary}
					setArticleClass={h.setArticleClass}
					getArticle={h.getArticle}
				/>,
			);
			assert.ok(invocations >= 1, 'summary called once branch has 2 commits');
		});
	});
});
