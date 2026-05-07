/**
 * Error injection helper for Playwright mock route handlers.
 *
 * Provides type-safe primitives for testing failure-path UX:
 *   - withError(status, body?)            -> always returns the configured error.
 *   - withErrorInjection(handler, opts)   -> wraps a handler with conditional errors.
 *   - withRandomFailure(handler, p, opts) -> fails p% of the time.
 *   - withFirstNFailures(handler, n)      -> fails first N invocations, then succeeds.
 *   - withErrorForPredicate(handler, fn)  -> fails only when predicate returns true.
 *
 * Per the Agent Action Plan (AAP) section 0.5.1.11, Tier 3 integration
 * specs (`04-network-failure-recovery.int.spec.ts`,
 * `13-bulk-partial-failure.int.spec.ts`, etc.) use these to test:
 *
 *   - Network failure recovery (5xx, retry, error toast, form-state preservation).
 *   - Bulk operation partial-failure UX (per-item error rendering).
 *   - RBAC denial paths (403 responses).
 *   - Validation failure rendering (422 responses).
 *   - Session expiration redirect (401 responses).
 *   - Missing-entity 404 handling.
 *
 * Per AAP section 0.5.1.13, canonical error response bodies live at
 * `e2e/fixtures/api-responses/errors/{401,403,404,422,500}.json`.
 * Per-scope handlers (`e2e/mocks/handlers/*.handler.ts`) read those
 * fixtures and pass the body content to `withError(status, body)`.
 * This file does NOT import the fixtures directly - that responsibility
 * lives in handlers, keeping this utility independent of fixture file paths.
 *
 * Foundational layer - imports only `@playwright/test` (type-only).
 *
 * Layering contract (per the e2e/mocks/ folder requirements):
 *   - This file imports nothing from siblings (api-router.ts,
 *     latency-injector.ts, handlers/*).
 *   - This file imports nothing from @fixtures, @pages, @patterns,
 *     @factories, or @utils.
 *   - This file uses no Node.js built-ins (no fs, no path, no http).
 *   - This file is consumed by handlers and tests; the reverse is forbidden
 *     to avoid circular-import risks.
 *
 * Migration-proofness (per AAP section 0.10.1):
 *   The implementation uses only ES2020 globals (`Promise`, `JSON.stringify`,
 *   `Math.random`, `Number.isInteger`, `Number.isFinite`). These primitives
 *   are stable across decades of JavaScript runtimes and are unaffected by
 *   the Angular 11 -> 21 framework migration.
 *
 * @see AAP section 0.5.1.12 (Factories, Mocks, and Test Utilities - mandate)
 * @see AAP section 0.3.1 (Test Target Identification - error injection scope)
 * @see AAP section 0.5.1.11 (Tier 3 Integration / Edge Cases - consumers)
 * @see AAP section 0.5.1.13 (API Response Fixtures - canonical error bodies)
 * @see AAP section 0.10.1 (Migration-proof framework directive)
 * @see e2e/mocks/handlers/*.handler.ts (consumers wrap their handlers)
 * @see e2e/mocks/latency-injector.ts (sibling helper for latency injection)
 * @see e2e/fixtures/api-responses/errors/*.json (canonical error response bodies)
 */

// ---------------------------------------------------------------------------
// Imports - strictly limited to `@playwright/test` (type-only) per the
// e2e/mocks/ layering contract. No runtime dependency on the package; the
// `import type` statement is fully erased at compile time.
// ---------------------------------------------------------------------------

import type { Route, Request } from '@playwright/test';

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/**
 * Common log prefix used by every thrown Error in this module so that
 * stack traces and CI output can be grep'd to a single source.
 *
 * Scoped to a constant rather than inlined to keep messages consistent if
 * the prefix is ever changed (e.g., on rename to `error-helper.ts`).
 */
const LOG_PREFIX = '[mock-api/error-injector]';

/**
 * Lower bound of the HTTP status code range accepted by
 * {@link validateErrorOptions}. Includes informational 1xx codes although
 * they are virtually never injected in practice; permitting the full range
 * avoids forcing a future test that wants to assert browser handling of a
 * 100 Continue or 101 Switching Protocols response to monkey-patch this
 * file. RFC 9110 section 15 defines status codes as three-digit integers
 * in `[100, 599]`.
 */
const HTTP_STATUS_MIN = 100;

/**
 * Upper bound of the HTTP status code range accepted by
 * {@link validateErrorOptions}. Per RFC 9110 section 15.
 */
const HTTP_STATUS_MAX = 599;

/**
 * Default status used by {@link withRandomFailure} and
 * {@link withErrorForPredicate} when the caller omits an explicit
 * `errorOptions` argument. 500 (Internal Server Error) is the canonical
 * generic-failure code per the AAP section 0.3.1 example.
 */
const DEFAULT_ERROR_STATUS_GENERIC: ErrorStatus = 500;

/**
 * Default status used by {@link withFirstNFailures}. 503 (Service
 * Unavailable) better models the "transient-failure-then-recovery"
 * scenario that {@code withFirstNFailures} is designed to test. Clients
 * implementing exponential-backoff retry logic typically scope retries
 * to 5xx codes including 503.
 */
const DEFAULT_ERROR_STATUS_TRANSIENT: ErrorStatus = 503;

// ---------------------------------------------------------------------------
// Public type definitions
// ---------------------------------------------------------------------------

/**
 * Playwright route handler signature.
 *
 * Defined locally (rather than imported from `api-router.ts` or
 * `latency-injector.ts`) to keep this file independent of sibling files.
 * Layering: `api-router.ts` and handlers consume this file; this file
 * imports nothing from siblings.
 *
 * Both async (`Promise<void>`) and sync (`void`) handlers are accepted to
 * mirror Playwright's `page.route(url, handler)` flexibility - although
 * the canonical handler shape used throughout `e2e/mocks/handlers/*.ts`
 * is the async form.
 *
 * The signature accepts a second `Request` argument even though many
 * handlers only consult `route.request()` internally; we preserve the
 * second parameter to align with Playwright's official API and to make
 * predicate-based handlers ergonomic (predicates need the Request directly).
 */
export type RouteHandler = (route: Route, request: Request) => Promise<void> | void;

/**
 * Predicate for selectively triggering errors only on matching requests.
 *
 * Receives the `Request`; returns `true` to inject an error, `false` to
 * delegate to the original handler. The predicate is invoked synchronously
 * before any error response is constructed; it must NOT have side effects
 * other than reading from the request itself (`request.method()`,
 * `request.url()`, `request.headers()`, `request.postDataJSON()`, etc.).
 *
 * Per AAP section 0.10.1 ("All tests can run independently and in
 * parallel"), predicates should be pure functions of the request to
 * preserve test isolation across workers.
 *
 * @example Match POST requests only:
 * ```ts
 * const onlyPosts: ErrorPredicate = (req) => req.method() === 'POST';
 * ```
 *
 * @example Match a specific resource path:
 * ```ts
 * const teamCreates: ErrorPredicate = (req) =>
 *   req.method() === 'POST' && req.url().endsWith('/api/workforce/teams');
 * ```
 */
export type ErrorPredicate = (request: Request) => boolean;

/**
 * HTTP status codes that this module is designed to inject.
 *
 * The named members align with the AAP section 0.5.1.13 canonical error
 * response fixtures stored at
 * `e2e/fixtures/api-responses/errors/<status>.json`:
 *
 *   - 401 - Unauthorized (session expired, deep-link without auth)
 *   - 403 - Forbidden (RBAC denial, restricted action)
 *   - 404 - Not Found (missing entity, stale list link)
 *   - 422 - Unprocessable Entity (validation failure)
 *   - 500 - Internal Server Error (generic backend failure)
 *   - 503 - Service Unavailable (transient failure for retry tests)
 *
 * The type is widened to `number` so consumers can pass less-common codes
 * (e.g., 429 Too Many Requests, 502 Bad Gateway, 504 Gateway Timeout)
 * without having to extend the union at the call site. Runtime validation
 * in {@link validateErrorOptions} ensures the value is a valid HTTP status
 * integer in `[100, 599]` regardless.
 *
 * Migration note: this is a type alias, not an enum. Const enums are
 * avoided because the AAP section 0.10.1 migration-proofness directive
 * favours plain literal types that survive any TypeScript major-version
 * upgrade unchanged.
 *
 * Implementation note: the trailing `(number & Record<never, never>)` is
 * the canonical "loose-autocomplete" pattern in TypeScript. A union of
 * `literal | number` collapses to plain `number` (TS removes the redundant
 * constituents), which destroys IDE autocomplete on the literals.
 * Intersecting `number` with an empty record type defeats the collapse
 * without changing the accepted runtime value set: the type still accepts
 * every JavaScript `number`, but TypeScript surfaces the canonical literals
 * (401, 403, ...) at call sites for autocompletion. `Record<never, never>`
 * is preferred over the older `{}` form so the @typescript-eslint/ban-types
 * rule remains satisfied.
 */
export type ErrorStatus = 401 | 403 | 404 | 422 | 500 | 503 | (number & Record<never, never>);

/**
 * Options for constructing an HTTP error response.
 *
 * Used directly by {@link withError} and as a sub-object of
 * {@link ErrorInjectionOptions} for the conditional-injection wrappers.
 * All fields except `status` are optional; sensible defaults are applied
 * by {@link prepareErrorResponse}.
 */
export interface ErrorOptions {
  /**
   * HTTP status code to return. Required. Must be an integer in
   * `[100, 599]` per RFC 9110 section 15; otherwise
   * {@link validateErrorOptions} throws at wrap time.
   */
  status: ErrorStatus;

  /**
   * Response body. Accepts:
   *
   *   - `string` - returned verbatim. Default Content-Type becomes
   *     `text/plain` unless the caller overrides it via {@link headers}.
   *   - `object` (record) - JSON-serialised via `JSON.stringify`. Default
   *     Content-Type becomes `application/json`.
   *   - `unknown[]` (array) - JSON-serialised via `JSON.stringify`. Default
   *     Content-Type becomes `application/json`.
   *   - `undefined` (default) - a minimal `{ "error": "HTTP <status>" }`
   *     JSON body is generated and Content-Type defaults to
   *     `application/json`.
   *
   * The body is computed exactly once at wrap time (closure-captured) so
   * that high-frequency endpoints do not pay per-invocation
   * `JSON.stringify` cost. See the file-level docstring for the
   * rationale.
   */
  body?: string | Record<string, unknown> | unknown[];

  /**
   * HTTP response headers. Optional.
   *
   * Defaults are applied by {@link prepareErrorResponse}:
   *   - `application/json` Content-Type when body is an object/array or
   *     when body is `undefined` (synthesized JSON).
   *   - `text/plain` Content-Type when body is a string.
   *
   * Caller-supplied headers always win; merging happens at wrap time
   * (object spread `{ ...defaults, ...callerHeaders }`).
   *
   * No automatic CORS or auth headers are injected; tests requiring those
   * pass them explicitly to keep the helper minimal.
   */
  headers?: Record<string, string>;
}

/**
 * Options for {@link withErrorInjection}.
 *
 * Combines an {@link ErrorOptions} descriptor with optional
 * gating predicates that determine whether the error is injected on a
 * given invocation.
 *
 * Two-gate logic (predicate first, probability second) is documented in
 * the file-level docstring under "Why withErrorInjection Uses
 * Predicate-Then-Probability".
 */
export interface ErrorInjectionOptions {
  /**
   * Error response configuration. Required. Validated at wrap time via
   * {@link validateErrorOptions}.
   */
  error: ErrorOptions;

  /**
   * Probability of injecting the error per invocation, in `[0, 1]`.
   * Default: `1` (always inject when no predicate is provided, or when
   * the predicate returns `true`).
   *
   * Examples:
   *   - `0`   -> never inject (delegates 100% of the time).
   *   - `0.5` -> 50% of eligible requests fail.
   *   - `1`   -> always inject when eligible (the default).
   *
   * Per the AAP section 0.5.1.11, partial-failure scenarios use values
   * like `0.3` to model "30% of bulk operations partially fail."
   */
  probability?: number;

  /**
   * Optional predicate evaluated before the probability check.
   *
   * Semantics:
   *   - If `predicate` is `undefined`, every request is eligible for the
   *     probability check.
   *   - If `predicate` is provided AND returns `false` for a request, the
   *     error is NOT injected (delegates regardless of probability).
   *   - If `predicate` is provided AND returns `true` for a request, the
   *     probability check still applies.
   *
   * Useful for targeting only a subset of requests reaching a single
   * `page.route()` glob (e.g., POST-only failure on a CRUD endpoint).
   */
  predicate?: ErrorPredicate;
}

// ---------------------------------------------------------------------------
// Internal helpers - not exported.
// ---------------------------------------------------------------------------

/**
 * Validate an {@link ErrorOptions} descriptor at wrap time.
 *
 * Per AAP section 0.10.1 ("Throw on Bad Inputs"), misconfigured options
 * surface during test setup (clear stack trace, identifies the originating
 * `withError(...)` call) rather than at request time (cryptic Playwright
 * internals). The same rationale governs every higher-order wrapper in
 * this module.
 *
 * @param options The descriptor to validate.
 * @throws Error When any field is malformed.
 */
function validateErrorOptions(options: ErrorOptions): void {
  // ----- status: integer in [100, 599] -----
  // We test number-ness, integer-ness, and range separately so the error
  // message is precise about which constraint failed.
  if (
    typeof options.status !== 'number' ||
    !Number.isInteger(options.status) ||
    options.status < HTTP_STATUS_MIN ||
    options.status > HTTP_STATUS_MAX
  ) {
    throw new Error(
      `${LOG_PREFIX} ErrorOptions.status must be an integer in ` +
        `[${HTTP_STATUS_MIN}, ${HTTP_STATUS_MAX}]; got ${String(options.status)}`,
    );
  }

  // ----- body: string | object | array | undefined -----
  // typeof null === 'object' in JavaScript, so we must check for `null`
  // explicitly to avoid passing `null` through to JSON.stringify(null)
  // which would emit the string "null" with no error semantics.
  if (
    options.body !== undefined &&
    typeof options.body !== 'string' &&
    (typeof options.body !== 'object' || options.body === null)
  ) {
    throw new Error(
      `${LOG_PREFIX} ErrorOptions.body must be string, object, array, or undefined; ` +
        `got ${typeof options.body}`,
    );
  }

  // ----- headers: plain object | undefined -----
  // Same null guard as for body.
  if (
    options.headers !== undefined &&
    (typeof options.headers !== 'object' || options.headers === null)
  ) {
    throw new Error(
      `${LOG_PREFIX} ErrorOptions.headers must be a plain object or undefined; ` +
        `got ${typeof options.headers}`,
    );
  }
}

/**
 * Pre-compute the response body and headers from an {@link ErrorOptions}
 * descriptor.
 *
 * Performance rationale:
 *   Each invocation of the returned handler hits
 *   `route.fulfill({ status, body, headers })`. If we computed
 *   `JSON.stringify(...)` and merged headers on every invocation, a
 *   high-frequency endpoint (e.g., a polling API receiving hundreds of
 *   hits per Tier 3 run) would incur per-request serialisation overhead.
 *   By computing once at wrap time and capturing in the closure, we trade
 *   a small memory cost (one string per handler) for a deterministic
 *   per-call performance profile.
 *
 * @param options The validated descriptor.
 * @returns Pre-serialised body and resolved header map.
 */
function prepareErrorResponse(options: ErrorOptions): {
  responseBody: string;
  responseHeaders: Record<string, string>;
} {
  let responseBody: string;
  let defaultContentType: string;

  if (options.body === undefined) {
    // Synthesize a minimal default body. The shape matches the AAP
    // section 0.3.1 example: `{ "error": "HTTP <status>" }`.
    responseBody = JSON.stringify({ error: `HTTP ${String(options.status)}` });
    defaultContentType = 'application/json';
  } else if (typeof options.body === 'string') {
    // Strings pass through verbatim - the caller controls Content-Type
    // semantics via the `headers` field if they need a non-text body.
    responseBody = options.body;
    defaultContentType = 'text/plain';
  } else {
    // Object or array -> JSON-serialise. The validation in
    // validateErrorOptions has already excluded `null` from this branch.
    responseBody = JSON.stringify(options.body);
    defaultContentType = 'application/json';
  }

  // Merge default headers with caller-provided headers (caller wins).
  // The default Content-Type is placed first so that an explicit override
  // in `options.headers` (e.g., `'application/problem+json'`) takes
  // precedence via object-spread ordering semantics.
  const responseHeaders: Record<string, string> = {
    'Content-Type': defaultContentType,
    ...(options.headers ?? {}),
  };

  return { responseBody, responseHeaders };
}

/**
 * Construct a Playwright route handler from an {@link ErrorOptions}
 * descriptor.
 *
 * Internal helper shared by {@link withError}, {@link withErrorInjection},
 * {@link withRandomFailure}, {@link withFirstNFailures}, and
 * {@link withErrorForPredicate}. Validates the descriptor at wrap time
 * and pre-computes the response payload so per-invocation cost is just
 * the `route.fulfill(...)` call.
 *
 * @param options The error response descriptor.
 * @returns A {@link RouteHandler} that always responds with the configured error.
 */
function buildErrorHandler(options: ErrorOptions): RouteHandler {
  validateErrorOptions(options);

  // Pre-serialise the body and resolve headers ONCE at wrap time so each
  // invocation is fast (no per-request JSON.stringify overhead).
  const { responseBody, responseHeaders } = prepareErrorResponse(options);

  // Capture the status as a plain number so the closure does not retain
  // the entire `options` object (which, after validation, is no longer
  // needed at request time).
  const status = options.status;

  // The returned function is async to match Playwright's preferred
  // handler shape; the unused `_request` parameter is retained for API
  // ergonomics and to satisfy the RouteHandler signature contract.
  return async (route, _request) => {
    await route.fulfill({
      status,
      body: responseBody,
      headers: responseHeaders,
    });
  };
}

// ---------------------------------------------------------------------------
// Public function: withError
// ---------------------------------------------------------------------------

/**
 * Construct a route handler that ALWAYS returns the configured error.
 *
 * Use as a primary handler (NOT a wrapper around another handler) when
 * you want a route to fail unconditionally.
 *
 * The function name follows the dominant ecosystem convention for
 * "always-error" handlers (e.g., MSW's
 * `rest.get(url, (req, res, ctx) => res(ctx.status(500)))`). For
 * conditional/sometimes-fail behaviour, use {@link withErrorInjection}
 * or one of the convenience presets ({@link withRandomFailure},
 * {@link withFirstNFailures}, {@link withErrorForPredicate}).
 *
 * @param status HTTP status code to return. Must be an integer in
 *   `[100, 599]`; otherwise an Error is thrown at wrap time.
 * @param body Optional response body. See {@link ErrorOptions.body} for
 *   accepted shapes and default behaviour.
 * @returns A {@link RouteHandler} that fulfills every request with the
 *   configured error response.
 *
 * @throws Error When `status` is out of range or not an integer.
 *
 * @example Simple 500 error with default JSON body:
 * ```ts
 * import { withError } from '@mocks/error-injector';
 *
 * await page.route(
 *   '** / api/workforce/teams',
 *   withError(500),
 * );
 * ```
 *
 * @example 401 with explicit JSON body:
 * ```ts
 * await page.route(
 *   '** / api/auth/me',
 *   withError(401, { error: 'Session expired' }),
 * );
 * ```
 *
 * @example 422 with canonical fixture body:
 * ```ts
 * import errorBody from '@e2e/fixtures/api-responses/errors/422.json';
 * await page.route('** / api/workforce/teams', withError(422, errorBody));
 * ```
 */
export function withError(status: ErrorStatus, body?: ErrorOptions['body']): RouteHandler {
  return buildErrorHandler({ status, body });
}

// ---------------------------------------------------------------------------
// Public function: withErrorInjection
// ---------------------------------------------------------------------------

/**
 * Wrap a route handler so it returns an error response a configurable
 * fraction of the time (or based on a predicate); otherwise delegates to
 * the original handler.
 *
 * Two-gate logic per the file-level docstring:
 *   1. If a predicate is provided AND returns `false`, the error is NOT
 *      injected (delegates immediately).
 *   2. Otherwise, the probability gate fires `Math.random() < probability`
 *      to decide whether to inject.
 *
 * @param handler The original route handler. Must be a function.
 * @param options Configuration controlling when to inject errors.
 * @returns A {@link RouteHandler} that may inject an error or delegate.
 *
 * @throws Error When `handler` is not a function, or any field of
 *   `options` is malformed (status out of range, probability outside
 *   `[0, 1]`, etc.).
 *
 * @example Inject 500 error on 30% of POST requests:
 * ```ts
 * import { withErrorInjection } from '@mocks/error-injector';
 *
 * const flaky = withErrorInjection(originalHandler, {
 *   error: { status: 500 },
 *   probability: 0.3,
 *   predicate: (req) => req.method() === 'POST',
 * });
 * await page.route('** / api/**', flaky);
 * ```
 *
 * @example Always-fail predicate for DELETEs (acts like withErrorForPredicate):
 * ```ts
 * const blockDeletes = withErrorInjection(originalHandler, {
 *   error: { status: 403, body: { error: 'Forbidden' } },
 *   predicate: (req) => req.method() === 'DELETE',
 * });
 * ```
 */
export function withErrorInjection(
  handler: RouteHandler,
  options: ErrorInjectionOptions,
): RouteHandler {
  // ----- handler: must be a function -----
  if (typeof handler !== 'function') {
    throw new Error(`${LOG_PREFIX} withErrorInjection requires a RouteHandler function`);
  }

  // ----- options.error: validated through buildErrorHandler below, but
  //       called directly here too so we fail fast even when probability
  //       is 0 (in which case buildErrorHandler would still be invoked).
  validateErrorOptions(options.error);

  // ----- options.probability: number in [0, 1] -----
  // Default to 1 (always inject when eligible). We test number-ness and
  // finite-ness explicitly to reject NaN / +Infinity / -Infinity which
  // would otherwise pass the range comparison silently.
  const probability = options.probability ?? 1;
  if (
    typeof probability !== 'number' ||
    !Number.isFinite(probability) ||
    probability < 0 ||
    probability > 1
  ) {
    throw new Error(
      `${LOG_PREFIX} ErrorInjectionOptions.probability must be in [0, 1]; ` +
        `got ${String(probability)}`,
    );
  }

  // ----- options.predicate: must be a function or undefined -----
  if (options.predicate !== undefined && typeof options.predicate !== 'function') {
    throw new Error(
      `${LOG_PREFIX} ErrorInjectionOptions.predicate must be a function or undefined; ` +
        `got ${typeof options.predicate}`,
    );
  }

  // Capture for the closure to avoid repeated property lookups per request.
  const predicate = options.predicate;
  const errorHandler = buildErrorHandler(options.error);

  return async (route, request) => {
    // Predicate gates error eligibility (false -> always delegate).
    // Evaluating the predicate first means a `false` predicate skips the
    // RNG entirely - a small perf win for high-frequency endpoints.
    if (predicate && !predicate(request)) {
      return handler(route, request);
    }

    // Probability gates whether the eligible request actually fails.
    // The `< 1` short-circuit avoids invoking Math.random() when the
    // caller explicitly opted into 100% failure (the common case for
    // predicate-driven scenarios).
    if (probability < 1 && Math.random() >= probability) {
      return handler(route, request);
    }

    return errorHandler(route, request);
  };
}

// ---------------------------------------------------------------------------
// Public function: withRandomFailure
// ---------------------------------------------------------------------------

/**
 * Wrap a handler so it fails with the given probability per request.
 *
 * Convenience wrapper around {@link withErrorInjection} for the common
 * "X% of requests fail" scenario, omitting the predicate argument.
 * Equivalent to:
 *
 * ```ts
 * withErrorInjection(handler, { error: errorOptions, probability });
 * ```
 *
 * @param handler The original route handler.
 * @param probability Failure probability in `[0, 1]` (e.g., `0.1` = 10%).
 * @param errorOptions Optional error response configuration.
 *   Defaults to `{ status: 500 }` (generic 500 with synthesized JSON body).
 * @returns A {@link RouteHandler} that may fail or delegate.
 *
 * @throws Error When `handler` is not a function, `probability` is out of
 *   range, or `errorOptions` is malformed.
 *
 * @example 10% chance of 503 Service Unavailable:
 * ```ts
 * await page.route(
 *   '** / api/workforce/**',
 *   withRandomFailure(originalHandler, 0.1, { status: 503 }),
 * );
 * ```
 *
 * @example Default 500 error on 25% of requests:
 * ```ts
 * await page.route('** / api/assessments/**', withRandomFailure(handler, 0.25));
 * ```
 */
export function withRandomFailure(
  handler: RouteHandler,
  probability: number,
  errorOptions: ErrorOptions = { status: DEFAULT_ERROR_STATUS_GENERIC },
): RouteHandler {
  return withErrorInjection(handler, {
    error: errorOptions,
    probability,
  });
}

// ---------------------------------------------------------------------------
// Public function: withFirstNFailures
// ---------------------------------------------------------------------------

/**
 * Wrap a handler so the first N invocations fail, after which the original
 * handler is invoked normally. Useful for testing retry-with-backoff logic.
 *
 * STATEFUL CLOSURE - INTENTIONAL EXCEPTION TO PARALLEL-SAFE DEFAULT:
 *   This wrapper uses a closure-scoped counter (`invocationCount`).
 *   Every call to `withFirstNFailures(...)` produces a fresh counter
 *   instance, so different `withFirstNFailures(...)` invocations are
 *   isolated from one another. However, sharing a SINGLE returned
 *   function across two parallel tests would also share the counter -
 *   which is documented as forbidden.
 *
 *   In practice, fixtures construct a fresh wrapper per test (or per
 *   `page.route()` call), so the parallel-safety contract holds. Per
 *   AAP section 0.10.1, this stateful behaviour is justified because
 *   retry-logic testing fundamentally requires per-test invocation
 *   counter state.
 *
 *   The same pattern is used by mainstream testing libraries (e.g., MSW's
 *   `res.once(...)` / `rest.get(..., once)`) for the same scenario.
 *
 * @param handler The original route handler.
 * @param n Number of initial failures. Must be a non-negative integer.
 *   `n = 0` produces a wrapper that never fails (delegates immediately).
 * @param errorOptions Optional error response configuration.
 *   Defaults to `{ status: 503 }` (Service Unavailable - the canonical
 *   transient-failure code that retry logic typically scopes to).
 * @returns A stateful {@link RouteHandler}.
 *
 * @throws Error When `handler` is not a function, `n` is not a
 *   non-negative integer, or `errorOptions` is malformed.
 *
 * @example First 2 requests fail with 503; the 3rd and beyond succeed:
 * ```ts
 * await page.route(
 *   '** / api/workforce/teams',
 *   withFirstNFailures(originalHandler, 2, { status: 503 }),
 * );
 * ```
 *
 * @example First 5 requests fail with 500 (default), then succeed:
 * ```ts
 * await page.route('** / api/assessments/**', withFirstNFailures(handler, 5));
 * ```
 */
export function withFirstNFailures(
  handler: RouteHandler,
  n: number,
  errorOptions: ErrorOptions = { status: DEFAULT_ERROR_STATUS_TRANSIENT },
): RouteHandler {
  // ----- handler: must be a function -----
  if (typeof handler !== 'function') {
    throw new Error(`${LOG_PREFIX} withFirstNFailures requires a RouteHandler function`);
  }

  // ----- n: non-negative integer -----
  // typeof N is checked for runtime safety even though TypeScript would
  // catch a non-number at compile time; tests using `as any` to defeat
  // TS would otherwise crash at request time with a confusing message.
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
    throw new Error(
      `${LOG_PREFIX} withFirstNFailures requires a non-negative integer n; got ${String(n)}`,
    );
  }

  // ----- errorOptions: validated through buildErrorHandler below, but
  //       called directly here so we fail fast if n === 0 (in which case
  //       the error handler is constructed but never invoked).
  validateErrorOptions(errorOptions);

  // Pre-compute the error handler at wrap time. Even if n === 0 (so the
  // error path is never taken), constructing the handler still validates
  // the options, which surfaces config bugs at setup time.
  const errorHandler = buildErrorHandler(errorOptions);

  // Closure-scoped invocation counter. Initialised per call to
  // withFirstNFailures(), so different wrapper instances are isolated.
  let invocationCount = 0;

  return async (route, request) => {
    invocationCount++;
    if (invocationCount <= n) {
      return errorHandler(route, request);
    }
    return handler(route, request);
  };
}

// ---------------------------------------------------------------------------
// Public function: withErrorForPredicate
// ---------------------------------------------------------------------------

/**
 * Wrap a handler so it injects an error ONLY when the predicate returns
 * `true`; otherwise delegates to the original handler.
 *
 * Useful for targeted failure scenarios such as "fail only POST requests
 * with a specific id" or "fail only when the request payload contains a
 * given field". Internally a thin wrapper around
 * {@link withErrorInjection} with `probability: 1` (deterministic
 * injection when the predicate matches).
 *
 * @param handler The original route handler.
 * @param predicate Function that decides whether to inject an error.
 *   Receives the {@link Request}; returns `true` to inject, `false` to
 *   delegate.
 * @param errorOptions Optional error response configuration.
 *   Defaults to `{ status: 500 }`.
 * @returns A {@link RouteHandler}.
 *
 * @throws Error When `handler` is not a function, `predicate` is not a
 *   function, or `errorOptions` is malformed.
 *
 * @example Fail any DELETE request targeting a protected team:
 * ```ts
 * import { withErrorForPredicate } from '@mocks/error-injector';
 *
 * await page.route(
 *   '** / api/workforce/teams/**',
 *   withErrorForPredicate(
 *     originalHandler,
 *     (req) => req.method() === 'DELETE' && req.url().includes('forbidden-team'),
 *     { status: 403, body: { error: 'Cannot delete protected team' } },
 *   ),
 * );
 * ```
 *
 * @example Reject requests missing an Authorization header:
 * ```ts
 * await page.route(
 *   '** / api/**',
 *   withErrorForPredicate(
 *     originalHandler,
 *     (req) => !req.headers().authorization,
 *     { status: 401 },
 *   ),
 * );
 * ```
 */
export function withErrorForPredicate(
  handler: RouteHandler,
  predicate: ErrorPredicate,
  errorOptions: ErrorOptions = { status: DEFAULT_ERROR_STATUS_GENERIC },
): RouteHandler {
  // ----- predicate: must be a function -----
  // We validate the predicate here (even though withErrorInjection also
  // validates it) to produce an error message that names the public API
  // the caller used, not the internal delegation target.
  if (typeof predicate !== 'function') {
    throw new Error(`${LOG_PREFIX} withErrorForPredicate requires a predicate function`);
  }

  // Delegate to withErrorInjection with probability locked to 1. The
  // probability gate is then a no-op: when the predicate returns true,
  // the error is injected deterministically.
  return withErrorInjection(handler, {
    error: errorOptions,
    probability: 1,
    predicate,
  });
}
