/**
 * Application-wide constants.
 * Centralizes magic numbers and configuration values for maintainability.
 */

/** Length of cryptographic nonce for CSP script security. */
export const NONCE_LENGTH = 32;

/** Delay in ms before triggering refresh after file system changes. */
export const FILE_WATCHER_DEBOUNCE_MS = 300;

/**
 * Minimum spacing (ms) between watcher-driven refreshes. A multi-step git
 * operation (e.g. `gs stack submit`) rewrites refs/index dozens of times over
 * its run; without a floor that would fire a refresh every debounce window.
 * Bursts within this interval coalesce into a single trailing refresh.
 */
export const MIN_REFRESH_INTERVAL_MS = 1500;

/**
 * How often (ms) to re-check whether an in-progress git operation has finished.
 * Decoupled from {@link MIN_REFRESH_INTERVAL_MS}: the floor exists to coalesce a
 * submit storm, but once the operation ends the user wants the view promptly, so
 * polling for completion is kept short. (The post-op refresh still respects the
 * floor — this only governs how quickly completion is noticed.)
 */
export const GIT_OP_RECHECK_MS = 250;

/** Delay in ms after branch creation to allow SCM view to update. */
export const POST_COMMIT_REFRESH_DELAY_MS = 100;

/** Git-spice CLI timeout for standard operations in ms. */
export const GIT_SPICE_TIMEOUT_MS = 30_000;

/** Git-spice CLI timeout for branch creation in ms. */
export const BRANCH_CREATE_TIMEOUT_MS = 10_000;

/**
 * Git-spice CLI timeout for the `--help` capability probe in ms.
 * Kept short: the probe runs on every refresh and a hung/misconfigured binary
 * should not block integration detection for the full standard timeout.
 */
export const GIT_SPICE_PROBE_TIMEOUT_MS = 5_000;

/** Number of commits to render per chunk in lazy loading. */
export const COMMIT_RENDER_CHUNK_SIZE = 10;

/** Duration of CSS enter/exit animations in ms. */
export const ANIMATION_DURATION_MS = 200;

/** Duration of flash highlight animation in ms. */
export const FLASH_ANIMATION_DURATION_MS = 300;

/** Stagger delay between animated items in ms. */
export const ANIMATION_STAGGER_MS = 30;
