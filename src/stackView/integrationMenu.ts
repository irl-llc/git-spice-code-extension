/**
 * Pure helpers for the integration-branch entries of the branch context menu
 * (the beta ed-irl/git-spice feature; see #39).
 *
 * Kept free of `vscode` imports so the menu-composition logic is unit-testable
 * without a VSCode instance. The handler that shows the menu and dispatches the
 * selected action lives in {@link ./handlers/branchHandlers}.
 */

import type { IntegrationState } from '../utils/integrationState';
import type { BranchContextMenuItem } from './types';

/** Action id dispatched when adding a branch to the integration tip list. */
export const INTEGRATION_TIP_ADD_ACTION = 'integrationTipAdd';
/** Action id dispatched when removing a branch from the integration tip list. */
export const INTEGRATION_TIP_REMOVE_ACTION = 'integrationTipRemove';

/** True when `branchName` is currently one of the configured integration tips. */
export function isIntegrationTip(branchName: string, integration: IntegrationState | null | undefined): boolean {
	if (!integration) {
		return false;
	}
	return integration.tips.some((tip) => tip.name === branchName);
}

/**
 * Builds the integration tip-list menu items for a branch. Returns an empty
 * array when no integration branch is configured (so stock builds and
 * unconfigured repos show no integration entries). When configured, offers
 * "Add to integration build" for branches outside the tip list and "Remove
 * from integration build" for tips — the inverse of the "X" out-of-integration
 * marker rendered in the stack view. The integration branch itself is excluded:
 * it is a real branch that may appear in the list, but it cannot be a tip of
 * itself, so showing add/remove actions on it would be an invalid no-op.
 */
export function buildIntegrationMenuItems(
	branchName: string,
	integration: IntegrationState | null | undefined,
): BranchContextMenuItem[] {
	if (!integration || branchName === integration.name) {
		return [];
	}
	if (isIntegrationTip(branchName, integration)) {
		return [{ label: '$(circle-slash) Remove from integration build', action: INTEGRATION_TIP_REMOVE_ACTION }];
	}
	return [{ label: '$(add) Add to integration build', action: INTEGRATION_TIP_ADD_ACTION }];
}
