/**
 * Component tests for IntegrationCard.tsx — the topmost stack node shown when
 * an integration branch is configured. Covers the name, the Integration tag,
 * and the "Rebuild" vs "Built" verbiage / needs-rebuild styling.
 */

// MUST be first — installs JSDOM globals before testing-library imports.
import { installJsdomGlobals } from '../reactTestHelper';

import * as assert from 'assert';
import { cleanup, render, screen } from '@testing-library/react';

import { IntegrationCard } from '../../../../stackView/webview/components/IntegrationCard';
import type { IntegrationViewModel, TreeFragmentData } from '../../../../stackView/types';

function makeFragment(): TreeFragmentData {
	return {
		lanes: [{ continuesFromAbove: false, continuesBelow: true, hasNode: true, needsRestack: false }],
		maxLane: 0,
		nodeLane: 0,
		childForkLanes: [],
		nodeStyle: 'integration',
		nodeNeedsRestack: false,
	};
}

function makeIntegration(overrides?: Partial<IntegrationViewModel>): IntegrationViewModel {
	return { name: 'integ', needsRebuild: false, tipNames: [], treeFragment: makeFragment(), ...overrides };
}

describe('IntegrationCard', () => {
	beforeEach(installJsdomGlobals);
	afterEach(cleanup);

	it('renders the integration branch name and Integration tag', () => {
		render(<IntegrationCard integration={makeIntegration({ name: 'my-integration' })} />);
		assert.ok(screen.getByText('my-integration'));
		assert.ok(screen.getByText('Integration'));
	});

	it('shows "Built" when up to date', () => {
		render(<IntegrationCard integration={makeIntegration({ needsRebuild: false })} />);
		assert.ok(screen.getByText('Built'));
		assert.strictEqual(screen.queryByText('Rebuild'), null);
	});

	it('shows "Rebuild" and needs-rebuild styling when stale', () => {
		const { container } = render(<IntegrationCard integration={makeIntegration({ needsRebuild: true })} />);
		assert.ok(screen.getByText('Rebuild'));
		assert.strictEqual(screen.queryByText('Built'), null);
		assert.ok(container.querySelector('.integration-card.needs-rebuild'));
	});
});
