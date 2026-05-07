/**
 * Defensive Angular zone stability shim.
 *
 * Pauses test execution until all `NgZone` instances on the page report
 * stability (no pending macrotasks/microtasks in the zone). Used ONLY when
 * Playwright's built-in web-first auto-waiting is insufficient — primarily
 * before screenshot capture in zone-heavy Angular 11 flows where pending
 * RxJS subscriptions can cause flicker between assertions.
 *
 * Per the Agent Action Plan §0.10.1:
 *   "All other places rely on Playwright's web-first auto-waiting locators.
 *    Use waitForAngular only for the rare edge case where zone stability
 *    matters (e.g., before screenshot capture during heavy zone activity in
 *    Angular 11)."
 *
 * Adapted from the official Playwright migration-from-Protractor guide.
 * Compatible with Angular 2+ through Angular 21+ via the
 * `getAllAngularTestabilities` debug hook, which has remained backward-
 * compatible across every Angular major release. This API stability is the
 * basis of the shim's migration-proofness per AAP §0.10.1.
 *
 * The shim silently no-ops on non-Angular pages or production-mode Angular
 * without testability hooks — calling it on a login screen, error page,
 * 404, or pre-bootstrap blank tab will return immediately.
 *
 * Foundational layer — the only import is `@playwright/test` (type-only,
 * for the `Page` interface). No file system, no network, no Node built-ins
 * other than the global `setTimeout` / `clearTimeout` symbols, no fixtures
 * / pages / patterns / factories / mocks (layering inversion forbidden by
 * AAP §0.6.2 and the e2e/utils/ folder requirements).
 *
 * @see AAP §0.5.1.12 (Factories, Mocks, and Test Utilities — entry that
 *      mandates this file).
 * @see AAP §0.2.2 (Web Search Research — Playwright migration guide adoption).
 * @see AAP §0.10.1 (Defensive `waitForAngular` shim — usage policy).
 * @see https://playwright.dev/docs/protractor — Migrating from Protractor.
 */

// ---------------------------------------------------------------------------
// Imports — strictly limited to `@playwright/test` per the e2e/utils layering.
// Type-only so the runtime bundle has no dependency on Playwright internals
// at the foundational layer.
// ---------------------------------------------------------------------------

import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

/**
 * Default timeout (in milliseconds) for {@link waitForAngular}.
 *
 * Aligned with `playwright.config.ts` `actionTimeout: 10_000` and the
 * AAP §0.7.2 quality criterion ("per-step timeout: 10 seconds"). Most
 * stable Angular pages settle in well under 1 second; 10 s is generous
 * headroom for slow CI runners while still failing fast on a genuinely
 * stuck zone.
 *
 * Tests that need a different ceiling pass it explicitly:
 *   `await waitForAngular(page, 30_000);`
 */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Outer-timeout headroom (in milliseconds) added on top of the user-
 * requested `timeoutMs` for the safety-net outer timeout.
 *
 * The inner timeout (inside `page.evaluate`) is set to exactly `timeoutMs`
 * so the function honors the documented contract "rejects when the total
 * wait exceeds `timeoutMs`". The outer timeout fires `OUTER_TIMEOUT_HEADROOM_MS`
 * later to catch truly broken cases where `page.evaluate` itself hangs and
 * the in-page Promise never delivers any signal back to the Node side.
 *
 * The 500 ms value is empirically chosen to be longer than typical
 * Playwright IPC latency (~5–50 ms) but short enough that the user-visible
 * timeout still feels prompt.
 */
const OUTER_TIMEOUT_HEADROOM_MS = 500;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wait for all Angular zones on the page to become stable.
 *
 * Resolves when EITHER:
 *   - `window.getAllAngularTestabilities` is undefined or returns an empty
 *     array (page hasn't bootstrapped Angular yet, Angular crashed during
 *     bootstrap, the page is served by a different framework, or the build
 *     omitted testability hooks via `enableProdMode()`), OR
 *   - All testabilities have signaled `whenStable`.
 *
 * Rejects (throws) if:
 *   - The `page` argument is null/undefined.
 *   - The `timeoutMs` argument is not a positive finite number.
 *   - The total wait exceeds `timeoutMs` — either because the in-page
 *     inner timeout fired (zone never stabilized) or because the outer
 *     race timeout fired (page.evaluate itself hung past `timeoutMs`
 *     plus IPC headroom).
 *   - The underlying `page.evaluate` call itself throws (e.g., the page
 *     navigated away mid-evaluation, or the browser context closed).
 *
 * Use sparingly — Playwright's locator auto-waiting handles the vast
 * majority of cases. Common legitimate uses:
 *   - Before screenshot capture in zone-heavy flows (avoid flicker between
 *     `expect(locator).toBeVisible()` and `page.screenshot()`).
 *   - Before `expect(page).toHaveScreenshot()` for visual regression.
 *   - When asserting against a freshly-rendered DOM tree that involves
 *     async pipes or RxJS `combineLatest` with multiple sources.
 *   - During Angular 11 → 21 migration debugging when an unexpected zone
 *     stability difference is suspected (the trace shows whether the
 *     wait succeeded or timed out).
 *
 * Implementation notes (cross-referenced to the AAP rationale):
 *
 *   1. The function uses two layered timeouts. The INNER timeout (inside
 *      `page.evaluate`) fires at exactly `timeoutMs` and signals back via
 *      a return value of 'INNER_TIMEOUT'; this is the user-visible timeout.
 *      The OUTER timeout (in Node) fires at `timeoutMs + 500ms` and is a
 *      safety net for the rare case where `page.evaluate` itself hangs and
 *      never returns any value at all (e.g., page navigation mid-eval, or
 *      browser context closure).
 *
 *   2. The in-page Promise resolves with a small union string: 'STABLE'
 *      when all zones settled (or none were present), and 'INNER_TIMEOUT'
 *      when the inner timeout fired before stability. The outer code
 *      inspects this value and throws a timeout error in the
 *      'INNER_TIMEOUT' case — using a return-value sentinel rather than a
 *      thrown exception inside `page.evaluate` because exceptions thrown
 *      inside `page.evaluate` are serialized to a generic Playwright error
 *      that loses our `[wait-for-angular]` log prefix.
 *
 *   3. The `whenStable` invocation is wrapped in try/catch because some
 *      Angular implementations (notably Angular 11 with patched zone.js)
 *      throw if `whenStable` is called after the testability has been
 *      destroyed. Treating the throw as "stable" is the conservative
 *      choice — alternatives would cause `waitForAngular` to fail tests
 *      for an Angular-internal edge case unrelated to the user's logic.
 *
 *   4. The window globals are typed inline via
 *      `as unknown as { getAllAngularTestabilities?: ... }` so no Angular
 *      types leak into the test code, ensuring the file works against
 *      every Angular version from 2 through 21+ with no source change.
 *
 *   5. The outer-timeout `setTimeout` handle is captured and cleared in a
 *      `finally` block so a successful resolve does not keep the Node
 *      event loop alive until the timeout would have fired.
 *
 * @param page The Playwright {@link Page} instance to query. Must not be
 *             null or undefined.
 * @param timeoutMs Maximum time to wait, in milliseconds. Must be a
 *                  positive finite number. Defaults to 10 000 ms (aligned
 *                  with `playwright.config.ts` `actionTimeout`).
 * @returns A Promise that resolves with `void` when zones are stable, or
 *          when no Angular instance is present on the page.
 * @throws {@link Error} when arguments are invalid or when the timeout
 *         elapses before all zones stabilize. The thrown message is
 *         prefixed with `[wait-for-angular]` for log-grep-ability.
 *
 * @example
 * Basic use before screenshot capture:
 * ```ts
 * import { waitForAngular } from '@utils/wait-for-angular';
 *
 * await page.goto('/workforce/teams');
 * await waitForAngular(page); // ensures async pipes have resolved
 * await expect(page).toHaveScreenshot('teams-list.png');
 * ```
 *
 * @example
 * Custom timeout for a slow page (e.g., heavy initial dataset):
 * ```ts
 * await waitForAngular(page, 30_000);
 * ```
 *
 * @example
 * Idempotent — calling repeatedly is safe and cheap when zones are
 * already stable:
 * ```ts
 * await waitForAngular(page);
 * await waitForAngular(page); // returns near-instantly the second time
 * ```
 */
export async function waitForAngular(
  page: Page,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  // ---------------------------------------------------------------
  // Argument validation
  // ---------------------------------------------------------------
  // Defensive checks against common misuse — caught at the top of the
  // function so the caller gets an immediate, attributable error rather
  // than an obscure failure deep inside `page.evaluate`.
  if (page === null || page === undefined) {
    throw new Error(
      '[wait-for-angular] waitForAngular requires a non-null Playwright Page instance.',
    );
  }
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(
      `[wait-for-angular] waitForAngular timeoutMs must be a positive finite number; got ${String(
        timeoutMs,
      )}.`,
    );
  }

  // ---------------------------------------------------------------
  // Outer-timeout machinery (safety net)
  // ---------------------------------------------------------------
  // We need a handle to the outer timeout's setTimeout id so we can clear
  // it when the in-page evaluation resolves successfully — otherwise Node
  // would keep the event loop alive until the timeout fires, even after
  // the test has moved on.
  //
  // The outer timeout fires at `timeoutMs + 500ms` (NOT `timeoutMs`):
  //   - The inner timeout inside page.evaluate fires at exactly `timeoutMs`.
  //   - In the normal case, the inner timeout fires first, page.evaluate
  //     returns 'INNER_TIMEOUT', and the outer code translates that into a
  //     thrown error — the outer timeout never fires.
  //   - The outer timeout exists ONLY to catch pathological hangs where
  //     `page.evaluate` itself never returns (e.g., page navigation,
  //     browser context closure, IPC hang). The 500 ms headroom is enough
  //     for normal IPC latency (~5–50 ms) plus a generous safety margin.
  let outerTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const outerTimeoutMs = timeoutMs + OUTER_TIMEOUT_HEADROOM_MS;

  const outerTimeoutPromise: Promise<never> = new Promise<never>((_resolve, reject) => {
    outerTimeoutHandle = setTimeout(() => {
      reject(
        new Error(
          `[wait-for-angular] Timed out after ${timeoutMs}ms waiting for Angular zone stability.`,
        ),
      );
    }, outerTimeoutMs);
  });

  // ---------------------------------------------------------------
  // In-page evaluation
  // ---------------------------------------------------------------
  // The `page.evaluate` body is serialized and executed inside the browser
  // context, so it cannot reference outer module values (only the
  // explicitly passed `args` tuple). All TypeScript types are erased at
  // compile time, so the type annotations inside the body are purely for
  // the type-checker — they have no runtime cost.
  //
  // Return type semantics:
  //   - 'STABLE'        — all zones signaled stable, OR no Angular present.
  //   - 'INNER_TIMEOUT' — inner timeout fired before zones stabilized; the
  //                       outer code translates this to a timeout error.
  // We use a discriminated string union (rather than throwing inside the
  // page.evaluate) because exceptions thrown inside page.evaluate are
  // serialized to a generic Playwright error that loses our prefix.
  const inPagePromise: Promise<'STABLE' | 'INNER_TIMEOUT'> = page.evaluate(
    async (innerTimeoutMs) => {
      // Local typing of the window globals. The double-cast via `unknown`
      // is required because `Window` does not declare
      // `getAllAngularTestabilities` in lib.dom.d.ts, and we deliberately
      // avoid augmenting the global Window interface (which would couple
      // every test file to this declaration and leak Angular semantics
      // into framework-agnostic code).
      const win = window as unknown as {
        getAllAngularTestabilities?: () => Array<{
          whenStable: (cb: (didWork: boolean) => void) => void;
        }>;
      };

      // No-op when Angular is absent or testability is disabled. Per AAP
      // §0.10.1 this is the "defensive" qualifier: calling this on a non-
      // Angular page (login screen, error fallback, blank tab) must not
      // fail.
      if (typeof win.getAllAngularTestabilities !== 'function') {
        return 'STABLE' as const;
      }

      let testabilities: Array<{
        whenStable: (cb: (didWork: boolean) => void) => void;
      }>;
      try {
        testabilities = win.getAllAngularTestabilities();
      } catch {
        // Some patched zone.js builds throw if testability has been torn
        // down (mid-navigation, hot-reload, etc.). Treat as "no Angular
        // present" and return — the caller's intent is satisfied either
        // way.
        return 'STABLE' as const;
      }

      if (!Array.isArray(testabilities) || testabilities.length === 0) {
        return 'STABLE' as const;
      }

      // Inner timeout fires at exactly `innerTimeoutMs` so the function
      // honors the documented "rejects after timeoutMs" contract.
      // `Math.max(1, …)` guards against any caller-supplied non-positive
      // value that survived argument validation due to floating-point
      // weirdness (Number.isFinite catches NaN/Infinity but allows tiny
      // sub-millisecond values like 1e-10).
      const innerTimeoutFloor = Math.max(1, innerTimeoutMs);

      const result = await Promise.race<'STABLE' | 'INNER_TIMEOUT'>([
        // Branch A — all testabilities signal stability. Resolves with
        // 'STABLE' when every Promise in the array fulfills.
        Promise.all(
          testabilities.map(
            (testability) =>
              new Promise<void>((resolve) => {
                try {
                  testability.whenStable(() => {
                    resolve();
                  });
                } catch {
                  // Defensive: an Angular implementation that throws
                  // inside `whenStable` should not block the test. Treat
                  // as already stable and resolve so the outer Promise.all
                  // can settle.
                  resolve();
                }
              }),
          ),
        ).then(() => 'STABLE' as const),

        // Branch B — inner timeout. Ensures the in-page Promise always
        // settles even if Angular never reaches stability for some
        // pathological reason (zone leak, infinite microtask loop, etc.).
        // Resolves with 'INNER_TIMEOUT' which the outer code translates
        // into a thrown timeout error.
        new Promise<'INNER_TIMEOUT'>((resolve) => {
          setTimeout(() => {
            resolve('INNER_TIMEOUT');
          }, innerTimeoutFloor);
        }),
      ]);

      return result;
    },
    timeoutMs,
  );

  // ---------------------------------------------------------------
  // Race the in-page eval against the outer timeout
  // ---------------------------------------------------------------
  // try/finally ensures we always clear the outer-timeout handle so the
  // Node event loop can exit promptly after the function returns; without
  // this, the test process would idle until `outerTimeoutMs` elapsed even
  // on a fast successful resolve.
  //
  // Three possible outcomes:
  //   1. inPagePromise resolves with 'STABLE'        -> return normally.
  //   2. inPagePromise resolves with 'INNER_TIMEOUT' -> throw timeout err.
  //   3. outerTimeoutPromise rejects                 -> propagate the err
  //                                                     (handles cases
  //                                                      where page.evaluate
  //                                                      itself hangs).
  try {
    const result = await Promise.race<'STABLE' | 'INNER_TIMEOUT'>([
      inPagePromise,
      outerTimeoutPromise,
    ]);
    if (result === 'INNER_TIMEOUT') {
      throw new Error(
        `[wait-for-angular] Timed out after ${timeoutMs}ms waiting for Angular zone stability.`,
      );
    }
  } finally {
    if (outerTimeoutHandle !== undefined) {
      clearTimeout(outerTimeoutHandle);
    }
  }
}
