/**
 * Latency injection helper for Playwright mock route handlers.
 *
 * Wraps an existing route handler with configurable artificial latency,
 * useful for testing:
 *   - Loading-state UX (skeleton screens, spinners) before data arrives.
 *   - Retry logic with backoff (Tier 3 spec: 04-network-failure-recovery).
 *   - Concurrency boundaries when a slow API arrives mid-edit.
 *   - Performance budgets (Tier 3 spec: 06-large-list-performance).
 *
 * Public surface (per AAP section 0.5.1.12 schema):
 *   - withLatency(handler, ms)            -> wrap with a fixed delay (ms).
 *   - withLatency(handler, options)       -> wrap with delay + jitter + predicate.
 *   - withDelayRange(handler, min, max)   -> wrap with uniform random delay in [min, max].
 *   - withSlowResponse(handler, ms?)      -> preset slow-backend wrapper (default 3000ms).
 *
 * Per AAP section 0.10.1, this is the documented exception to the
 * "no page.waitForTimeout() / setTimeout in test code" rule. Latency
 * injection inside MOCK HANDLERS is acceptable because the delay simulates
 * a real network condition, not a test-code timing assumption. Tests
 * themselves continue to rely on Playwright's web-first auto-waiting
 * locators / assertions; only the mock layer schedules an explicit delay.
 *
 * Layering contract (per the e2e/mocks/ folder requirements):
 *   - This file imports nothing from siblings (api-router.ts,
 *     error-injector.ts, handlers/*).
 *   - This file imports nothing from @fixtures, @pages, @patterns,
 *     @factories, or @utils.
 *   - This file uses no Node.js built-in modules (no fs, no path,
 *     no node:timers/promises). The setTimeout reference resolves to the
 *     standard JavaScript global, available on every supported runtime.
 *   - This file is consumed by handlers and tests; the reverse is forbidden
 *     to avoid circular-import risks.
 *
 * Statelessness and parallel-safety (per AAP section 0.10.1):
 *   Every wrapper returns a fresh closure that captures only the resolved
 *   configuration. No module-level mutable state exists; each invocation
 *   creates a new Promise, so parallel test workers (Tier 2 / Tier 3
 *   parallel projects) execute the wrapped handlers without contention.
 *
 * Migration-proofness (per AAP section 0.10.1):
 *   The implementation uses only ES2020 globals (Promise, Math.random,
 *   Math.max, Math.min, Number.isFinite, setTimeout). These primitives
 *   are stable across decades of JavaScript runtimes and are unaffected by
 *   the Angular 11 -> 21 framework migration this suite guards.
 *
 * Composition with the sibling error-injector module:
 *   ```ts
 *   import { withLatency } from '@mocks/latency-injector';
 *   import { withRandomFailure } from '@mocks/error-injector';
 *
 *   // 50% chance of error after 500ms delay.
 *   const slowFlaky = withLatency(withRandomFailure(handler, 0.5), 500);
 *   await page.route('** / api/workforce/teams', slowFlaky);
 *   ```
 *
 * @see AAP section 0.5.1.12 (Factories, Mocks, and Test Utilities - mandate)
 * @see AAP section 0.3.1 (Test Target Identification - latency injection scope)
 * @see AAP section 0.5.1.11 (Tier 3 Integration / Edge Cases - consumers)
 * @see AAP section 0.10.1 (Migration-proof framework directive)
 * @see e2e/mocks/handlers/*.handler.ts (consumers wrap their handlers via withLatency)
 * @see e2e/mocks/error-injector.ts (sibling helper for error injection)
 */

// ---------------------------------------------------------------------------
// Imports - strictly limited to `@playwright/test` (type-only) per the
// e2e/mocks/ layering contract. The `import type` statement is fully erased
// at compile time, so no runtime dependency exists on the package; the
// generated JavaScript contains no `require('@playwright/test')` call.
// ---------------------------------------------------------------------------

import type { Route, Request } from '@playwright/test';

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/**
 * Common log prefix used by every thrown Error in this module so that
 * stack traces and CI output can be grep'd to a single source.
 *
 * Scoped to a constant (rather than inlined into each throw site) to keep
 * messages consistent if the prefix is ever changed - mirrors the pattern
 * established by the sibling `error-injector.ts`.
 */
const LOG_PREFIX = '[mock-api/latency-injector]';

/**
 * Default base delay (in milliseconds) used by {@link withSlowResponse}
 * when the caller omits an explicit `ms` argument.
 *
 * 3000ms (3 seconds) is the median of the loading-state-UX delays cited by
 * AAP section 0.5.1.11 Tier 3 specs (`04-network-failure-recovery`,
 * `06-large-list-performance`). Long enough to make a skeleton screen
 * visible to the user during a test; short enough to keep tier wall-time
 * within the 25-minute Tier 3 budget.
 */
const DEFAULT_SLOW_RESPONSE_MS = 3000;

/**
 * Maximum jitter (in milliseconds) auto-applied by {@link withSlowResponse}.
 *
 * For typical 3000ms slow responses, ±500ms jitter realistically simulates
 * server-side variability. For shorter base delays, the helper additionally
 * caps jitter to `ms / 4` so a 100ms preset does not produce a
 * 100 ± 500 ms range that crosses zero.
 */
const SLOW_RESPONSE_MAX_JITTER_MS = 500;

/**
 * Quotient applied to the `ms` argument of {@link withSlowResponse} when
 * computing the jitter ceiling. Selected so that even a `withSlowResponse(handler, 100)`
 * call produces a sensible 100 ± 25 ms range rather than the confusing
 * 100 ± 500 ms range that would result from applying the static
 * SLOW_RESPONSE_MAX_JITTER_MS to a short base.
 */
const SLOW_RESPONSE_JITTER_QUOTIENT = 4;

// ---------------------------------------------------------------------------
// Public type definitions
// ---------------------------------------------------------------------------

/**
 * Playwright route handler signature.
 *
 * Matches the second-argument-style overload of `page.route(url, handler)`
 * callbacks: the handler may return `void` or `Promise<void>`. The
 * `Request` argument is a convenience pass-through (also accessible via
 * `route.request()`); we preserve it so predicate-based wrappers can
 * inspect the request directly without an extra hop.
 *
 * Defined locally (rather than imported from `api-router.ts` or
 * `error-injector.ts`) to keep this file independent of sibling files.
 * Layering: `api-router.ts` and handlers consume this file; this file
 * imports nothing from siblings. The sibling `error-injector.ts` defines
 * a structurally identical `RouteHandler` type for the same reason.
 */
export type RouteHandler = (route: Route, request: Request) => Promise<void> | void;

/**
 * Predicate for selectively applying latency only to matching requests.
 *
 * Receives the {@link Request}; returns `true` to apply latency, `false`
 * to pass through immediately. The predicate is invoked synchronously
 * before any timer is scheduled; it must NOT have side effects other than
 * reading from the request itself (`request.method()`, `request.url()`,
 * `request.headers()`, `request.postDataJSON()`, etc.).
 *
 * Per AAP section 0.10.1 ("All tests can run independently and in
 * parallel"), predicates should be pure functions of the request to
 * preserve test isolation across workers.
 *
 * @example Match POST requests only:
 * ```ts
 * const onlyPosts: LatencyPredicate = (req) => req.method() === 'POST';
 * ```
 *
 * @example Match a specific resource path:
 * ```ts
 * const teamWrites: LatencyPredicate = (req) =>
 *   ['POST', 'PUT', 'PATCH'].includes(req.method()) &&
 *   req.url().includes('/api/workforce/teams');
 * ```
 */
export type LatencyPredicate = (request: Request) => boolean;

/**
 * Options for the object-form overload of {@link withLatency}.
 *
 * Supports a base delay, optional symmetric jitter, and an optional
 * predicate to selectively apply latency. All fields except `ms` are
 * optional; sensible defaults are documented per field.
 */
export interface LatencyOptions {
  /**
   * Base delay in milliseconds. Required. Must be a non-negative finite
   * number; values <= 0 effectively pass through with no delay (but the
   * wrapper is still applied, so the predicate is still consulted and
   * `setTimeout(0)` is intentionally avoided to spare the event-loop
   * scheduler one trip).
   *
   * Validated at wrap time via {@link validateLatencyOptions}; misconfigured
   * values throw immediately so test authors see a clear stack trace at
   * fixture setup rather than at request time.
   */
  ms: number;

  /**
   * Optional random jitter in milliseconds. The actual delay becomes
   * `ms + (Math.random() * 2 - 1) * jitterMs`, clamped to `>= 0` so even
   * pathological configurations (e.g., `ms: 50, jitterMs: 1000`) produce
   * non-negative delays.
   *
   * Default: 0 (no jitter; deterministic latency).
   *
   * @example `{ ms: 500, jitterMs: 200 }` produces uniform random delays
   * in `[300, 700]` ms (since `Math.random() * 2 - 1` is in `[-1, 1)`).
   */
  jitterMs?: number;

  /**
   * Optional predicate to selectively apply latency. If omitted, latency
   * is applied to ALL requests handled by the wrapped function.
   *
   * Predicate semantics are intentionally simple:
   *   - Returns `true`  -> apply latency, then invoke the inner handler.
   *   - Returns `false` -> skip latency, invoke the inner handler immediately.
   *
   * Tests that need request-conditional latency variation can compose
   * multiple `withLatency(...)` wrappers rather than embedding the
   * variation logic in a single predicate.
   *
   * @example
   * ```ts
   * { predicate: (req) => req.method() === 'POST' }
   * ```
   */
  predicate?: LatencyPredicate;
}

// ---------------------------------------------------------------------------
// Internal helpers - not exported.
// ---------------------------------------------------------------------------

/**
 * Validate a {@link LatencyOptions} descriptor at wrap time.
 *
 * Per AAP section 0.10.1 ("Throw on Bad Inputs"), misconfigured options
 * surface during test setup (clear stack trace, identifies the originating
 * `withLatency(...)` call) rather than at request time (cryptic Playwright
 * internals). The same fail-fast rationale governs every higher-order
 * wrapper in this module.
 *
 * Each invariant is checked separately so the resulting Error message
 * names the specific malformed field, easing debugging.
 *
 * @param options The descriptor to validate. Mutates nothing.
 * @throws Error When any field is malformed.
 */
function validateLatencyOptions(options: LatencyOptions): void {
  // ----- ms: non-negative finite number -----
  // typeof / Number.isFinite / range check are split out for precise
  // error messages. NaN, +Infinity, -Infinity, and negative values all
  // fail fast.
  if (typeof options.ms !== 'number' || !Number.isFinite(options.ms) || options.ms < 0) {
    throw new Error(
      `${LOG_PREFIX} LatencyOptions.ms must be a non-negative finite number; ` +
        `got ${String(options.ms)}`,
    );
  }

  // ----- jitterMs: optional non-negative finite number -----
  // `undefined` is permitted (default 0). Any other non-numeric or
  // negative / non-finite value is rejected.
  if (options.jitterMs !== undefined) {
    if (
      typeof options.jitterMs !== 'number' ||
      !Number.isFinite(options.jitterMs) ||
      options.jitterMs < 0
    ) {
      throw new Error(
        `${LOG_PREFIX} LatencyOptions.jitterMs must be a non-negative finite number or undefined; ` +
          `got ${String(options.jitterMs)}`,
      );
    }
  }

  // ----- predicate: optional function -----
  // We accept undefined (no predicate) or a function. Anything else is
  // rejected explicitly to avoid confusing failures at invocation time
  // when Playwright would attempt to call a non-callable.
  if (options.predicate !== undefined && typeof options.predicate !== 'function') {
    throw new Error(
      `${LOG_PREFIX} LatencyOptions.predicate must be a function or undefined; ` +
        `got ${typeof options.predicate}`,
    );
  }
}

/**
 * Schedule a Promise that resolves after the given delay using the
 * standard JavaScript `setTimeout` global.
 *
 * Centralized here (rather than inlined at every call site) so:
 *   - The "documented exception to the no-setTimeout rule" lives in a
 *     single function whose role is unambiguous.
 *   - A future refactor that wants to swap to `node:timers/promises` or
 *     to inject a fake-timer for unit testing can change one call site.
 *
 * The `void` return type matches the resolved value's intent: callers
 * `await` the function for its side effect (the delay), not its value.
 *
 * @param ms Delay in milliseconds. Caller is responsible for ensuring
 *   `ms > 0`; this helper does not short-circuit zero / negative values
 *   so it can be used in performance-critical paths without an extra
 *   branch (the wrapper itself short-circuits before calling this).
 * @returns A promise that resolves after `ms` milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    // setTimeout resolves to the JavaScript runtime global. No module
    // import is required (and none is permitted by the layering contract).
    setTimeout(resolve, ms);
  });
}

/**
 * Compute the effective delay for a single invocation given a base `ms`
 * and optional symmetric `jitterMs`.
 *
 * The jitter offset is uniformly distributed in `[-jitterMs, +jitterMs]`
 * via `Math.random() * 2 - 1` (which produces a value in `[-1, 1)`). The
 * result is clamped to `>= 0` via `Math.max(0, ...)` so even pathological
 * configurations (e.g., `ms: 50, jitterMs: 1000`) produce non-negative
 * delays - a negative `setTimeout` argument would be coerced to 0 by the
 * runtime anyway, but explicit clamping keeps the contract auditable and
 * surfaces accidentally negative configurations to a future code reader.
 *
 * Pure function: same `(ms, jitterMs)` input produces the same statistical
 * distribution. Each individual call returns a single random sample.
 *
 * @param ms Base delay (already validated >= 0 and finite).
 * @param jitterMs Symmetric jitter range (already validated >= 0 and finite).
 * @returns Effective delay in milliseconds, guaranteed >= 0.
 */
function computeEffectiveMs(ms: number, jitterMs: number): number {
  // Skip RNG entirely for the deterministic case. This both shaves a
  // negligible amount of time off the hot path AND makes test failures
  // easier to reproduce when no jitter is configured.
  if (jitterMs <= 0) {
    return ms;
  }
  // Math.random() returns [0, 1). The mapping `* 2 - 1` shifts to [-1, 1).
  // Multiplying by jitterMs scales to [-jitterMs, +jitterMs).
  const jitterOffset = (Math.random() * 2 - 1) * jitterMs;
  return Math.max(0, ms + jitterOffset);
}

// ---------------------------------------------------------------------------
// Public function: withLatency (overloads + implementation)
// ---------------------------------------------------------------------------

/**
 * Wrap a route handler with a fixed artificial latency.
 *
 * Numeric overload for the common "delay this by X milliseconds" case.
 * No jitter, no predicate - every invocation waits exactly `ms` before
 * delegating to the inner handler.
 *
 * @param handler The original route handler to wrap. Must be a function.
 * @param ms The base delay in milliseconds. Must be a non-negative finite
 *   number; otherwise an Error is thrown at wrap time.
 * @returns A new RouteHandler that delays by `ms` before invoking the original.
 *
 * @throws Error When `handler` is not a function or `ms` is malformed.
 *
 * @example Basic 500ms delay on every workforce-teams request:
 * ```ts
 * import { withLatency } from '@mocks/latency-injector';
 *
 * await page.route(
 *   '** / api/workforce/teams',
 *   withLatency(async (route) => {
 *     await route.fulfill({ status: 200, body: '...' });
 *   }, 500),
 * );
 * ```
 */
export function withLatency(handler: RouteHandler, ms: number): RouteHandler;

/**
 * Wrap a route handler with configurable latency, jitter, and predicate.
 *
 * Object-form overload for advanced cases where jitter or selective
 * application is required.
 *
 * @param handler The original route handler to wrap. Must be a function.
 * @param options Configuration controlling latency behavior. See
 *   {@link LatencyOptions}.
 * @returns A new RouteHandler.
 *
 * @throws Error When `handler` is not a function, or any field of
 *   `options` is malformed (negative `ms`, non-finite `jitterMs`,
 *   non-function `predicate`, etc.).
 *
 * @example Apply 1000ms latency only to POST requests:
 * ```ts
 * await page.route(
 *   '** / api/**',
 *   withLatency(originalHandler, {
 *     ms: 1000,
 *     predicate: (req) => req.method() === 'POST',
 *   }),
 * );
 * ```
 *
 * @example Apply 500ms latency with ±100ms jitter (uniform [400, 600] ms):
 * ```ts
 * await page.route(
 *   '** / api/**',
 *   withLatency(originalHandler, { ms: 500, jitterMs: 100 }),
 * );
 * ```
 */
export function withLatency(handler: RouteHandler, options: LatencyOptions): RouteHandler;

/**
 * Implementation signature accepting either form.
 *
 * Internal: not exposed at the type level - the two declared overloads
 * above describe the public API shape. The union parameter is normalised
 * to a {@link LatencyOptions} object at the start of the function body.
 */
export function withLatency(
  handler: RouteHandler,
  msOrOptions: number | LatencyOptions,
): RouteHandler {
  // ----- handler: must be a function -----
  // Validated separately so the error message names `withLatency` (the
  // public API the caller used) rather than an internal helper.
  if (typeof handler !== 'function') {
    throw new Error(`${LOG_PREFIX} withLatency requires a RouteHandler function`);
  }

  // Normalise the parameter union to a single LatencyOptions shape so the
  // remaining code path is uniform regardless of which overload was used.
  const options: LatencyOptions =
    typeof msOrOptions === 'number' ? { ms: msOrOptions } : msOrOptions;

  // Defensive null/undefined check on the options object itself - guards
  // against `withLatency(handler, null as any)` which TypeScript would
  // accept under loose typing but which would crash at the property
  // access below.
  if (options === null || typeof options !== 'object') {
    throw new Error(
      `${LOG_PREFIX} withLatency requires a number or LatencyOptions object as the second argument; ` +
        `got ${typeof options}`,
    );
  }

  // Validate the resolved options shape at wrap time. Throws on any
  // malformed field with a descriptive message.
  validateLatencyOptions(options);

  // Capture the resolved configuration for the closure. We promote
  // `jitterMs` to a non-undefined number so the per-invocation hot path
  // does not pay a coalescing cost on every request.
  const baseMs = options.ms;
  const jitterMs = options.jitterMs ?? 0;
  const predicate = options.predicate;

  // The returned function carries the RouteHandler signature unchanged so
  // it can be passed transparently to `page.route(url, handler)`.
  return async (route, request) => {
    // Predicate gate: if provided AND returns false, skip the delay
    // entirely and delegate to the inner handler immediately.
    if (predicate && !predicate(request)) {
      return handler(route, request);
    }

    const effectiveMs = computeEffectiveMs(baseMs, jitterMs);

    // Skip the timer entirely when the effective delay is 0 or negative
    // (the latter is impossible after the Math.max(0, ...) clamp inside
    // computeEffectiveMs but the explicit check guards against future
    // refactors that might remove the clamp).
    if (effectiveMs > 0) {
      await delay(effectiveMs);
    }

    return handler(route, request);
  };
}

// ---------------------------------------------------------------------------
// Public function: withDelayRange
// ---------------------------------------------------------------------------

/**
 * Wrap a handler with a uniform random latency in `[minMs, maxMs]`.
 *
 * Convenience wrapper around {@link withLatency} for tests that prefer to
 * specify a min/max range rather than computing a base/jitter pair manually.
 * Internally translates to:
 *
 * ```ts
 * withLatency(handler, {
 *   ms:       (minMs + maxMs) / 2,
 *   jitterMs: (maxMs - minMs) / 2,
 * });
 * ```
 *
 * The translation is mathematically equivalent: a base of `(min + max) / 2`
 * with symmetric jitter of `(max - min) / 2` produces uniform delays in
 * `[min, max]` (modulo the `Math.random() * 2 - 1` half-open interval,
 * which closes at `min` and approaches but does not reach `max`).
 *
 * Use this helper when testing UX that must handle variable network
 * conditions (e.g., a list view's loading state) - random delays in a
 * range are a more realistic simulation than a single fixed value, and
 * help surface race conditions that fixed delays can mask.
 *
 * @param handler The original route handler. Must be a function.
 * @param minMs Lower bound of the range (inclusive, non-negative).
 * @param maxMs Upper bound of the range (must be >= minMs).
 * @returns A RouteHandler with random delay in the range.
 *
 * @throws Error When `handler` is not a function or the range is malformed
 *   (negative, non-finite, or `maxMs < minMs`).
 *
 * @example Simulate variable network conditions between 100ms and 500ms:
 * ```ts
 * import { withDelayRange } from '@mocks/latency-injector';
 *
 * await page.route(
 *   '** / api/**',
 *   withDelayRange(originalHandler, 100, 500),
 * );
 * ```
 */
export function withDelayRange(handler: RouteHandler, minMs: number, maxMs: number): RouteHandler {
  // ----- handler: must be a function -----
  // Validated here (even though withLatency also validates it) to produce
  // an error message that names the public API the caller used.
  if (typeof handler !== 'function') {
    throw new Error(`${LOG_PREFIX} withDelayRange requires a RouteHandler function`);
  }

  // ----- minMs / maxMs: finite, non-negative, ordered -----
  // Each invariant is checked together because the error message
  // "0 <= minMs <= maxMs" describes the joint constraint succinctly.
  if (
    typeof minMs !== 'number' ||
    typeof maxMs !== 'number' ||
    !Number.isFinite(minMs) ||
    !Number.isFinite(maxMs) ||
    minMs < 0 ||
    maxMs < minMs
  ) {
    throw new Error(
      `${LOG_PREFIX} withDelayRange requires 0 <= minMs <= maxMs (finite numbers); ` +
        `got [${String(minMs)}, ${String(maxMs)}]`,
    );
  }

  // Translate the [min, max] range to a (center, halfRange) pair that
  // withLatency understands as (ms, jitterMs).
  const center = (minMs + maxMs) / 2;
  const halfRange = (maxMs - minMs) / 2;

  return withLatency(handler, { ms: center, jitterMs: halfRange });
}

// ---------------------------------------------------------------------------
// Public function: withSlowResponse
// ---------------------------------------------------------------------------

/**
 * Preset latency wrapper simulating a slow backend response.
 *
 * Default: 3000ms (3 seconds) with up to ±500ms jitter. For shorter base
 * delays the jitter ceiling is lowered to `ms / 4` so a 100ms preset does
 * not produce a 100 ± 500 ms range that would cross zero (effectively
 * 100 ± 25 ms).
 *
 * Useful for testing loading-state UX (skeleton screens, spinners) and
 * retry logic per AAP section 0.5.1.11 (Tier 3 specs:
 * `04-network-failure-recovery`, `06-large-list-performance`).
 *
 * Tests should explicitly opt into latency injection because it inflates
 * test runtime; this preset reduces boilerplate for the common "slow
 * backend" case but does not change the default behaviour of any
 * unwrapped handler.
 *
 * @param handler The original route handler. Must be a function.
 * @param ms Optional base delay (default {@link DEFAULT_SLOW_RESPONSE_MS} = 3000).
 *   Must be a non-negative finite number.
 * @returns A RouteHandler with slow-response latency.
 *
 * @throws Error When `handler` is not a function or `ms` is malformed.
 *
 * @example Simulate a 3-second backend response (default):
 * ```ts
 * import { withSlowResponse } from '@mocks/latency-injector';
 *
 * await page.route(
 *   '** / api/workforce/teams',
 *   withSlowResponse(originalHandler),
 * );
 * ```
 *
 * @example Simulate a 1-second backend response (custom base):
 * ```ts
 * await page.route(
 *   '** / api/competencies/skills',
 *   withSlowResponse(originalHandler, 1000),
 * );
 * ```
 */
export function withSlowResponse(
  handler: RouteHandler,
  ms: number = DEFAULT_SLOW_RESPONSE_MS,
): RouteHandler {
  // Compute the jitter ceiling defensively: take the smaller of the
  // module-level cap (500ms) and a quarter of the configured base. This
  // keeps short base delays from producing inflated jitter ranges that
  // would cross zero, while leaving the default 3000ms case at the
  // intended ±500ms.
  //
  // Math.max(0, ...) defends against Math.min returning NaN if `ms` were
  // somehow NaN; that case is already rejected by withLatency's own
  // validation (see below), but the clamp keeps this helper robust if a
  // future refactor changes withLatency's validation semantics.
  const jitterCeiling = Math.max(
    0,
    Math.min(SLOW_RESPONSE_MAX_JITTER_MS, ms / SLOW_RESPONSE_JITTER_QUOTIENT),
  );

  // Delegate to withLatency (which performs its own validation of `ms` and
  // `jitterMs` at wrap time, surfacing any misconfiguration with a clear
  // error message naming the malformed field).
  return withLatency(handler, { ms, jitterMs: jitterCeiling });
}
