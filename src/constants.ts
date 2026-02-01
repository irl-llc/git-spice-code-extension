/**
 * Application-wide constants.
 * Centralizes magic numbers and configuration values for maintainability.
 */

/** Length of cryptographic nonce for CSP script security. */
export const NONCE_LENGTH = 32;

/** Delay in ms before triggering refresh after file system changes. */
export const FILE_WATCHER_DEBOUNCE_MS = 300;

/** Delay in ms after branch creation to allow SCM view to update. */
export const POST_COMMIT_REFRESH_DELAY_MS = 100;

/** Git-spice CLI timeout for standard operations in ms. */
export const GIT_SPICE_TIMEOUT_MS = 30_000;

/** Git-spice CLI timeout for branch creation in ms. */
export const BRANCH_CREATE_TIMEOUT_MS = 10_000;

/** Number of commits to render per chunk in lazy loading. */
export const COMMIT_RENDER_CHUNK_SIZE = 10;

/** Duration of CSS enter/exit animations in ms. */
export const ANIMATION_DURATION_MS = 200;

/** Duration of flash highlight animation in ms. */
export const FLASH_ANIMATION_DURATION_MS = 300;

/** Stagger delay between animated items in ms. */
export const ANIMATION_STAGGER_MS = 30;
