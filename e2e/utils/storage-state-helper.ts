/**
 * Storage state read/write helper for Playwright `storageState` JSON files.
 *
 * Per AAP §0.4.4, authenticated browser context state (cookies + localStorage)
 * is cached as JSON under `e2e/storage-states/<role>-user.json` to avoid
 * re-logging in for every test. This helper provides type-safe I/O for those
 * files plus the canonical path-derivation function.
 *
 * Foundational layer — imports only `@playwright/test` (for `Cookie` type) and
 * Node.js built-ins. No layering inversions: this file is consumed BY higher
 * layers (`e2e/global-setup.ts`, `e2e/fixtures/auth.fixture.ts`,
 * `e2e/scripts/generate-storage-states.ts`) but never imports from them.
 *
 * Used by:
 *   - `e2e/global-setup.ts` — writes states after one-time login per role.
 *   - `e2e/fixtures/auth.fixture.ts` — reads states to inject into browser
 *     contexts via `browser.newContext({ storageState })`.
 *   - `e2e/scripts/generate-storage-states.ts` — standalone state generator.
 *
 * Design principles documented in this file:
 *   - Read returns `null` on any failure (missing/malformed/invalid shape) —
 *     reads happen on hot paths (every test) and must never abort tests; the
 *     `null` signal lets callers fall back to fresh login.
 *   - Write throws on any failure — writes happen on cold paths (once per role
 *     per run, in `global-setup.ts`); failing fast there is preferable to
 *     silently producing a degraded test run that re-logs in 640+ times.
 *   - Atomic writes via temp-file + rename — guarantees that any
 *     `readStorageState` call sees either the previous valid state or the new
 *     valid state, never a partial JSON document.
 *   - File mode `0o600` on writes — storageState contains authentication
 *     tokens (cookies + localStorage); restricting to owner-only read/write
 *     matches the OS convention for credential storage (e.g., SSH keys).
 *   - Synchronous I/O — files are tiny (typically < 10 KB) and all callers run
 *     in synchronous-acceptable contexts (setup hooks, worker fixtures); async
 *     would add Promise wrapping for zero observable benefit.
 *   - Role normalization (lowercase + hyphenize) — file systems on macOS
 *     (HFS+/APFS), Windows (NTFS), and Linux (ext4) have different
 *     case-sensitivity behaviors. Normalizing avoids `Admin-user.json` vs
 *     `admin-user.json` ambiguity that breaks tests on case-sensitive runners.
 *
 * @see AAP §0.5.1.12 (Factories, Mocks, and Test Utilities — entry that
 *      mandates this file).
 * @see AAP §0.4.4 (Test Data and Fixtures Design — storageState lifecycle).
 * @see AAP §0.10.2 (Critical Implementation Reminders — storage-state
 *      lifecycle commitment).
 * @see https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state
 */

// ---------------------------------------------------------------------------
// Imports — strictly limited to `@playwright/test` (type-only) and Node.js
// built-ins per the e2e/utils/ foundational-layer constraint (AAP §0.6.2 and
// the e2e/utils/ folder requirements doc, Architectural Pillar 4).
// ---------------------------------------------------------------------------

import * as fs from 'fs';
import * as path from 'path';
// `import type` so the Cookie symbol is erased at compile time and produces
// no runtime require() — keeps this foundational module free of any runtime
// coupling to @playwright/test's internals (only the type signatures depend
// on Playwright's structural Cookie shape).
import type { Cookie } from '@playwright/test';

// ---------------------------------------------------------------------------
// Public type definitions
// ---------------------------------------------------------------------------
//
// Mirrors the on-disk JSON shape produced by Playwright's
// `BrowserContext.storageState({ path })` and accepted by
// `Browser.newContext({ storageState })`. Playwright does NOT export a public
// type alias for this composite shape in 1.59.x, so we redeclare it here with
// a structurally-identical layout. Should Playwright add an official export
// in a future major, this file is the only place that needs to switch from
// the local interface to the official re-export — all consumers of this
// module reference the local types and remain insulated from that change.
// ---------------------------------------------------------------------------

/**
 * A single localStorage key/value entry as serialized inside a
 * Playwright `storageState` JSON file.
 *
 * The `name` is the localStorage key; the `value` is the localStorage value.
 * Both are always strings (web localStorage stores only strings; complex data
 * is JSON-stringified by the application before storage).
 *
 * @example
 * ```json
 * { "name": "auth_token", "value": "eyJhbGciOiJIUzI1NiIsInR5cCI6..." }
 * ```
 */
export interface StorageStateLocalStorageEntry {
  /** localStorage key (always a string in the web platform). */
  name: string;
  /** localStorage value (always a string; complex data is pre-stringified). */
  value: string;
}

/**
 * A single origin's localStorage snapshot inside a Playwright `storageState`.
 *
 * `origin` is the full origin string (scheme + host + optional port) that
 * partitions the localStorage namespace per the web origin model. `localStorage`
 * is the array of all key/value entries present for that origin at the time
 * `BrowserContext.storageState()` was called.
 *
 * @example
 * ```json
 * {
 *   "origin": "http://localhost:4200",
 *   "localStorage": [
 *     { "name": "auth_token", "value": "..." },
 *     { "name": "user_preferences", "value": "{\"theme\":\"dark\"}" }
 *   ]
 * }
 * ```
 */
export interface StorageStateOrigin {
  /** Full origin string (e.g., `http://localhost:4200`). */
  origin: string;
  /** localStorage entries for this origin. May be empty but is never null. */
  localStorage: StorageStateLocalStorageEntry[];
}

/**
 * Re-exported alias for Playwright's `Cookie` type.
 *
 * Consumers of this module use `StorageStateCookie` to type their cookie
 * arrays without taking a direct dependency on `@playwright/test`. If
 * Playwright renames or restructures `Cookie` in a future major version, only
 * this file needs updating; downstream consumers continue using the alias.
 *
 * The structural type is identical to Playwright's `Cookie` interface
 * (`name`, `value`, `domain`, `path`, `expires`, `httpOnly`, `secure`,
 * `sameSite`, optional `partitionKey`).
 */
export type StorageStateCookie = Cookie;

/**
 * The on-disk shape of a Playwright `storageState` JSON file.
 *
 * Matches the structure produced by `BrowserContext.storageState({ path })`
 * and accepted by `Browser.newContext({ storageState })` and
 * `BrowserContext` `storageState` test-fixture overrides. This shape is
 * structurally compatible with the `StorageState` type that Playwright's
 * `browser.newContext({ storageState })` accepts.
 *
 * @example
 * ```json
 * {
 *   "cookies": [
 *     {
 *       "name": "session",
 *       "value": "abc123",
 *       "domain": "localhost",
 *       "path": "/",
 *       "expires": -1,
 *       "httpOnly": true,
 *       "secure": false,
 *       "sameSite": "Lax"
 *     }
 *   ],
 *   "origins": [
 *     {
 *       "origin": "http://localhost:4200",
 *       "localStorage": [{ "name": "auth_token", "value": "..." }]
 *     }
 *   ]
 * }
 * ```
 */
export interface StorageState {
  /** All cookies captured at storageState snapshot time. */
  cookies: StorageStateCookie[];
  /** Per-origin localStorage snapshots. */
  origins: StorageStateOrigin[];
}

// ---------------------------------------------------------------------------
// Module constants and helpers
// ---------------------------------------------------------------------------

/**
 * Canonical directory where storageState JSON files live.
 *
 * Resolved relative to this file: `e2e/utils/` → `e2e/storage-states/`.
 * Using `path.resolve(__dirname, ...)` makes the constant invariant under any
 * working-directory choice (`cwd` inside CI runners varies by reporter
 * configuration); the constant is always anchored to the file's own location
 * on disk.
 *
 * Override at runtime with the `E2E_STORAGE_STATES_DIR` env var for
 * non-default layouts (e.g., `/tmp/e2e-storage-$RUNNER_ID` on self-hosted CI
 * runners that want ephemeral, per-run storage to prevent cross-run state
 * pollution).
 */
const DEFAULT_STORAGE_STATES_DIR = path.resolve(__dirname, '..', 'storage-states');

/**
 * Filename prefix appended to the normalized role identifier when computing
 * the storageState file name (e.g., `admin` → `admin-user.json`).
 *
 * The `-user` suffix matches the convention already used by
 * `e2e/global-setup.ts` (which writes `${role}-user.json` directly).
 * Centralizing the suffix here keeps the file naming policy in a single
 * place.
 */
const ROLE_FILENAME_SUFFIX = '-user.json';

/**
 * Resolve the canonical storage-states directory at call time.
 *
 * Reading the env var inside a function (rather than at module-load time)
 * lets tests and tooling adjust `E2E_STORAGE_STATES_DIR` after the module is
 * loaded — useful for in-process unit tests of this helper itself.
 *
 * @returns Absolute path to the directory where storageState files are
 *          stored.
 */
function getStorageStatesDir(): string {
  const overridden = process.env.E2E_STORAGE_STATES_DIR;
  if (overridden && overridden.trim().length > 0) {
    return path.resolve(overridden.trim());
  }
  return DEFAULT_STORAGE_STATES_DIR;
}

/**
 * Type guard validating that an unknown value matches the {@link StorageState}
 * shape.
 *
 * Performs a structural check only (presence and array-ness of `cookies` and
 * `origins`). Does NOT deeply validate every Cookie field or every origin's
 * localStorage entries — Playwright is the authoritative validator of those
 * sub-shapes when it accepts the storageState in `browser.newContext()`. If
 * a sub-field is malformed but the top-level structure is valid, Playwright
 * surfaces a clear error message at context-creation time, which is more
 * informative than a deep-validation failure here.
 *
 * @param value Value of unknown type to test.
 * @returns `true` if `value` has the {@link StorageState} top-level shape.
 */
function isValidStorageState(value: unknown): value is StorageState {
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }
  // Cast to indexable record only after the object check above succeeds; the
  // record cast is purely for property access — the actual type guard is the
  // boolean returned by this function.
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.cookies) && Array.isArray(obj.origins);
}

// ---------------------------------------------------------------------------
// Public API — path derivation
// ---------------------------------------------------------------------------

/**
 * Compute the canonical storageState file path for a given role.
 *
 * Role names are normalized to a file-system-safe form before being joined
 * with the storage-states directory:
 *
 *   1. Convert to lowercase (case-insensitive equality on case-sensitive file
 *      systems — `Admin` and `admin` and `ADMIN` all map to the same file).
 *   2. Replace any run of non-alphanumeric characters with a single hyphen
 *      (handles spaces, slashes, special characters that would create
 *      unexpected nested paths or fail file creation).
 *   3. Trim leading/trailing hyphens (prevents filenames like
 *      `--user.json` from inputs like `'@admin@'`).
 *
 * The normalized name is suffixed with `-user.json` (matching the convention
 * used by {@link https://playwright.dev/docs/auth | Playwright auth docs}
 * and by `e2e/global-setup.ts`).
 *
 * @example
 * ```ts
 * getStorageStatePathForRole('canonical')
 *   // → '/.../e2e/storage-states/canonical-user.json'
 *
 * getStorageStatePathForRole('Admin')
 *   // → '/.../e2e/storage-states/admin-user.json'
 *
 * getStorageStatePathForRole('view-only')
 *   // → '/.../e2e/storage-states/view-only-user.json'
 *
 * getStorageStatePathForRole('Restricted Account!')
 *   // → '/.../e2e/storage-states/restricted-account-user.json'
 * ```
 *
 * @param role The role identifier (e.g., `'canonical'`, `'admin'`,
 *             `'viewer'`, `'restricted'`).
 * @returns Absolute path to the storageState JSON file for that role.
 * @throws {Error} when `role` is not a non-empty string, or when the
 *                 normalized form is empty (i.e., the input contained only
 *                 non-alphanumeric characters).
 */
export function getStorageStatePathForRole(role: string): string {
  if (typeof role !== 'string' || role.length === 0) {
    throw new Error(
      '[storage-state-helper] getStorageStatePathForRole requires a non-empty role string',
    );
  }

  const normalized = role
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (normalized.length === 0) {
    throw new Error(
      `[storage-state-helper] Role '${role}' normalizes to an empty string; cannot derive path`,
    );
  }

  return path.join(getStorageStatesDir(), `${normalized}${ROLE_FILENAME_SUFFIX}`);
}

// ---------------------------------------------------------------------------
// Public API — read
// ---------------------------------------------------------------------------

/**
 * Read a storageState JSON file from disk and validate its top-level shape.
 *
 * Returns `null` when:
 *   - `filePath` is empty or not a string.
 *   - The file does not exist on disk.
 *   - The file content cannot be read (permission denied, etc.).
 *   - The content is not valid JSON.
 *   - The parsed JSON does not match the {@link StorageState} shape (i.e.,
 *     either `cookies` or `origins` is not an array).
 *
 * Failure modes are LOGGED with the `[storage-state-helper]` prefix using
 * `console.warn` but NEVER thrown. This matches the AAP §0.4.4 "fall back to
 * fresh login on read failure" contract: read happens on every test and
 * must never abort the test — the `null` return is the explicit
 * "not available, do fresh login" signal.
 *
 * @param filePath Absolute or relative path to the storageState JSON file.
 *                 Use {@link getStorageStatePathForRole} to compute the
 *                 canonical path for a role.
 * @returns The parsed {@link StorageState}, or `null` on any failure.
 *
 * @example
 * ```ts
 * import { readStorageState, getStorageStatePathForRole } from '@utils/storage-state-helper';
 *
 * const path = getStorageStatePathForRole('admin');
 * const state = readStorageState(path);
 *
 * if (state) {
 *   const context = await browser.newContext({ storageState: state });
 *   // ... use cached state
 * } else {
 *   // ... fall back to fresh login
 * }
 * ```
 */
export function readStorageState(filePath: string): StorageState | null {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return null;
  }

  if (!fs.existsSync(filePath)) {
    return null;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    // Permission denied, transient I/O, or file disappeared between
    // existsSync and readFileSync (race). Log and fall through.
    console.warn(`[storage-state-helper] Failed to read ${filePath}: ${(err as Error).message}`);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Most likely cause: a previous write was interrupted before the atomic
    // rename completed and a stale temp file ended up in place. Treat as
    // "no usable state" and let the caller relogin.
    console.warn(
      `[storage-state-helper] Failed to parse ${filePath} as JSON: ${(err as Error).message}`,
    );
    return null;
  }

  if (!isValidStorageState(parsed)) {
    // Content is JSON but doesn't match the storageState shape — could be a
    // file-name collision with an unrelated JSON file in the directory, or a
    // hand-edited file that introduced a typo. Refuse to use it.
    console.warn(
      `[storage-state-helper] ${filePath} does not match the StorageState shape; ignoring`,
    );
    return null;
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Public API — write
// ---------------------------------------------------------------------------

/**
 * Write a {@link StorageState} to disk as JSON.
 *
 * Behavior:
 *   - Creates the parent directory (recursively) if it does not already
 *     exist (matches the `mkdir -p` semantic; see
 *     {@link https://nodejs.org/api/fs.html#fsmkdirsyncpath-options | Node fs.mkdirSync `recursive: true`}).
 *   - Writes the JSON to a temporary file in the same directory, then renames
 *     it atomically over the destination. This guarantees that any
 *     concurrent {@link readStorageState} call sees either the previous
 *     valid state or the new valid state — never a partial JSON document.
 *     Atomic rename is required because a process kill mid-write (Ctrl+C,
 *     OOM, runner timeout) would otherwise leave a truncated file that
 *     subsequent reads would treat as malformed and reject.
 *   - Sets the file mode to `0o600` (owner read+write only) — the
 *     storageState contains authentication tokens (cookies + localStorage),
 *     and `0o600` is the standard Linux convention for credential files
 *     (e.g., SSH private keys default to `0o600`). On Windows, the mode is
 *     translated to NTFS ACLs that approximate the same protection — not
 *     100% strict but a best-effort signal.
 *
 * Failure modes:
 *   - Throws on invalid arguments (empty path, missing/invalid state).
 *   - Throws on any I/O failure (permission, disk full, parent-dir denial)
 *     after attempting to clean up any leftover temp file.
 *
 * Asymmetric to {@link readStorageState} (which returns `null` on failure):
 * writes happen on cold paths (once per role per run, in `global-setup.ts`),
 * and a silent write failure would degrade the entire run by forcing 640+
 * redundant logins for Tier 2 alone. Failing fast in setup surfaces the
 * problem immediately.
 *
 * @param filePath Absolute or relative path to write. Parent directories
 *                 are created automatically.
 * @param state The {@link StorageState} to serialize. Must have `cookies`
 *              and `origins` arrays at the top level.
 * @throws {Error} when `filePath` is invalid, when `state` does not have the
 *                 required top-level shape, or when any file system
 *                 operation fails.
 *
 * @example
 * ```ts
 * import { writeStorageState, getStorageStatePathForRole } from '@utils/storage-state-helper';
 *
 * const state = await context.storageState(); // capture from a logged-in context
 * writeStorageState(getStorageStatePathForRole('admin'), state);
 * ```
 */
export function writeStorageState(filePath: string, state: StorageState): void {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('[storage-state-helper] writeStorageState requires a non-empty filePath');
  }

  if (state === null || state === undefined || typeof state !== 'object') {
    throw new Error('[storage-state-helper] writeStorageState requires a StorageState object');
  }

  // Top-level structural validation. We deliberately do not deep-validate
  // each Cookie / origin entry — Playwright validates those when the
  // storageState is consumed by `browser.newContext({ storageState })`.
  if (!Array.isArray(state.cookies) || !Array.isArray(state.origins)) {
    throw new Error(
      '[storage-state-helper] writeStorageState received an invalid StorageState shape (cookies and origins must both be arrays)',
    );
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    // Recursive ensures intermediate directories are created. Mode is left
    // at the default for directories (typically 0o755), which is appropriate
    // — the directory itself contains no secrets, only files inside it do.
    fs.mkdirSync(dir, { recursive: true });
  }

  // Pretty-printed JSON for human-readability when debugging captured states.
  // Two-space indent matches the project Prettier configuration; the cost of
  // pretty-printing for files this small (~few KB) is negligible.
  const json = JSON.stringify(state, null, 2);

  // Atomic write: write to temp file in same directory, then rename. The
  // temp file name embeds the PID and timestamp so two concurrent writers in
  // the same directory cannot collide on the temp filename — important when
  // multiple Playwright workers happen to call writeStorageState for the
  // same role concurrently (defensive: this should not happen with the
  // design but is cheap to guard against).
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  try {
    // mode: 0o600 → owner read+write only (rw-------). Matches OS convention
    // for credential storage; on Linux the kernel enforces it strictly, on
    // Windows it is mapped to NTFS ACLs.
    fs.writeFileSync(tmpPath, json, { encoding: 'utf-8', mode: 0o600 });
    // renameSync is atomic on POSIX file systems when source and destination
    // are on the same filesystem (which they are by construction here, since
    // tmpPath is in the same directory). On Windows, the rename behavior is
    // best-effort but the worst case is overwriting an existing file —
    // never producing a half-written file at the destination.
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Best-effort temp-file cleanup. If the write succeeded but rename
    // failed, the temp file would otherwise leak. We swallow cleanup errors
    // because the original error is the meaningful one to propagate.
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // ignore cleanup failures; the original error is what matters
    }
    throw new Error(
      `[storage-state-helper] Failed to write ${filePath}: ${(err as Error).message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API — lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Check whether a storageState file exists on disk.
 *
 * Useful for fixture short-circuit logic: if the state file is missing, fall
 * through to fresh login; if present, load and inject. The synchronous
 * boolean return means zero latency on the hot path (every test calls this
 * once during fixture setup).
 *
 * Returns `false` (not throwing) on empty/invalid `filePath` so callers can
 * pass through unchecked values — a falsy file path is by definition "no
 * state available".
 *
 * @param filePath Absolute or relative path to a storageState JSON file.
 * @returns `true` if the file exists; `false` if it does not, if `filePath`
 *          is empty, or if `filePath` is not a string.
 *
 * @example
 * ```ts
 * import { storageStateExists, readStorageState, getStorageStatePathForRole } from '@utils/storage-state-helper';
 *
 * const path = getStorageStatePathForRole('admin');
 * if (storageStateExists(path)) {
 *   const state = readStorageState(path);
 *   // ... reuse cached state
 * } else {
 *   // ... do fresh login
 * }
 * ```
 */
export function storageStateExists(filePath: string): boolean {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return false;
  }
  return fs.existsSync(filePath);
}

/**
 * Remove a storageState file from disk.
 *
 * Useful for forcing re-login on the next test run (e.g., after a global
 * password rotation, or when debugging an auth-related test failure where
 * stale cached credentials are suspected).
 *
 * Returns `true` if a file was removed, `false` if no file existed or the
 * path was invalid. I/O failures (permission denied, etc.) are LOGGED with
 * the `[storage-state-helper]` prefix using `console.warn` but NEVER
 * thrown — the caller can treat a `false` return as "the file is in an
 * unknown state, but it should be safe to attempt fresh login".
 *
 * @param filePath Absolute or relative path to a storageState JSON file.
 * @returns `true` when a file was removed; `false` when no file existed,
 *          when `filePath` was invalid, or when removal failed (with a
 *          warning logged in the latter case).
 *
 * @example
 * ```ts
 * import { clearStorageState, getStorageStatePathForRole } from '@utils/storage-state-helper';
 *
 * // Force re-login on next run for the admin role
 * clearStorageState(getStorageStatePathForRole('admin'));
 * ```
 */
export function clearStorageState(filePath: string): boolean {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return false;
  }
  if (!fs.existsSync(filePath)) {
    return false;
  }
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    console.warn(`[storage-state-helper] Failed to remove ${filePath}: ${(err as Error).message}`);
    return false;
  }
}
