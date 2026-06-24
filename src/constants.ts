/**
 * Application-wide constants.
 * Centralizes magic numbers and configuration values for maintainability.
 */

/** Length of cryptographic nonce for CSP script security. */
export const NONCE_LENGTH = 32;

/**
 * Delay in ms before triggering a refresh after file system changes. Also the
 * "settle" window: a git-op marker event re-arms this timer, so a refresh held
 * during a multi-step op (issue #71) only fires once the markers have stayed
 * clear for one debounce window.
 */
export const FILE_WATCHER_DEBOUNCE_MS = 300;

/**
 * Safety backstop (ms) for the watch-driven refresh hold. The primary signal
 * that a git operation finished is its marker files clearing (a watch event),
 * but VS Code's FileSystemWatcher can occasionally miss a very rapid
 * create/delete; if a refresh is held this long it is re-evaluated from disk so
 * a dropped completion event can't strand the view stale (issue #71).
 */
export const GIT_OP_BACKSTOP_MS = 5000;

/**
 * Minimum interval (ms) between watcher-driven refreshes (issue #71). Bounds
 * the refresh rate during git activity the extension cannot gate — terminal
 * `gs repo sync`/`submit` interleave network transfers with ref writes, and
 * each inter-write gap longer than the debounce would otherwise refresh.
 * Leading-edge: a lone change still refreshes immediately; only sustained
 * storms coalesce to one trailing refresh per interval.
 */
export const WATCHER_REFRESH_MIN_INTERVAL_MS = 2000;

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
