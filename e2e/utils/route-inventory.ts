/**
 * Route inventory — single source of truth for all Whoville-Client routes.
 *
 * Per AAP §0.10.1, every Whoville-Client route MUST be enumerated here. The
 * route-coverage CI gate (`npm run e2e:validate-routes`) reads this constant
 * and fails if any route lacks a covering Tier 1 smoke test.
 *
 * Module decomposition (per AAP §0.3.1):
 *   - App Core      ~15 routes  (eager-loaded shell)
 *   - Workforce     ~50 routes  (lazy module)
 *   - Assessments   ~40 routes  (lazy module)
 *   - Competencies  ~35 routes  (lazy module)
 *   - Authorization ~23 routes  (lazy module)
 *   - TOTAL        ~163 routes
 *
 * Maintenance contract:
 *   - Adding a route to Whoville-Client → MUST add an entry here.
 *   - Removing a route → MUST remove the entry here.
 *   - Renaming a route → MUST rename the entry here.
 *   - The route-coverage report flags drift between this constant and the
 *     application's actual route configuration.
 *
 * Foundational layer — no imports from other E2E layers. Pure data.
 *
 * @see AAP §0.5.1.12, §0.10.1, §0.10.2
 * @see e2e/specs/smoke/05-route-inventory-presence.smoke.spec.ts (consumer)
 * @see e2e/scripts/coverage-report.ts (consumer)
 */

// ---------------------------------------------------------------------------
// Type definitions (public exports)
// ---------------------------------------------------------------------------

/**
 * Module identifier for route grouping. Aligns with the AAP §0.3.1
 * functional-area decomposition: App Core + 4 lazy-loaded feature modules.
 */
export type ModuleId = 'app-core' | 'workforce' | 'assessments' | 'competencies' | 'authorization';

/**
 * Tier assignment indicating the test tier responsible for covering a route.
 *
 * Per AAP §0.4.1:
 *   - 'smoke'       — Tier 1: route reachability + render landmark check.
 *   - 'crud'        — Tier 2: feature CRUD scenarios.
 *   - 'integration' — Tier 3: cross-module / edge-case coverage.
 *
 * Note: Most routes have 'smoke' coverage AND additional tier coverage; this
 * field indicates the MINIMUM coverage tier required for the route to be
 * considered "covered" by the route-coverage gate.
 */
export type Tier = 'smoke' | 'crud' | 'integration';

/**
 * A single Whoville-Client route entry.
 *
 * Per AAP §0.10.1, every entry must be valid TypeScript at compile time
 * (the `paramPattern` regex compiles strictly).
 */
export interface Route {
  /**
   * The route path as exposed by Angular Router.
   * Static routes: '/workforce/teams'.
   * Parameterized routes: '/workforce/teams/:id' — the `:id` placeholder is
   * resolved at test runtime to a fixture-generated id.
   */
  readonly path: string;

  /**
   * The owning module. Used for grouping in the coverage report and for
   * driving lazy-module-load assertions per AAP §0.5.1.9.
   */
  readonly module: ModuleId;

  /**
   * Minimum tier responsible for covering this route.
   * Most routes are 'smoke' (every route must be reachable) plus additional
   * coverage at 'crud' or 'integration' from spec files.
   */
  readonly tier: Tier;

  /**
   * Whether this route requires an authenticated session.
   * If true, smoke tests load the canonical user `storageState` before
   * navigating; if false (e.g., '/login'), the test runs unauthenticated.
   */
  readonly authRequired: boolean;

  /**
   * Optional regex describing the route's `:id`-style param when present.
   * Used by the coverage report to validate that a covering spec navigates
   * to a path matching this regex.
   *
   * Example: for '/workforce/teams/:id', `paramPattern: /^\d+$/` constrains
   * the id to numeric values (typical for SQL primary keys). The default
   * `/^[0-9a-zA-Z-]+$/` accepts both numeric ids and slug-style URL-friendly
   * UUIDs / hashes.
   */
  readonly paramPattern?: RegExp;

  /**
   * Optional human-readable description of the route's purpose.
   * Surfaced in the coverage HTML report for reviewer context.
   */
  readonly description?: string;

  /**
   * Optional list of role identifiers required to access this route.
   * Empty / undefined means any authenticated user. Used by Tier 3
   * RBAC denial-path tests (AAP §0.5.1.11) to enumerate restricted routes.
   */
  readonly requiredRoles?: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Module-local route enumerations
//
// These constants are NOT exported individually — the public API is
// `ROUTES` (flat) and `ROUTES_BY_MODULE` (grouped). Keeping the per-module
// arrays module-local lets future refactors (e.g., loading from JSON,
// splitting per-module into separate files) proceed without breaking
// downstream consumers.
// ---------------------------------------------------------------------------

/**
 * Default regex used for parameterized id segments.
 * Accepts numeric ids (SQL primary keys) and slug-style URL-friendly
 * identifiers (UUIDs, hashes, kebab-case names).
 */
const DEFAULT_ID_PATTERN: RegExp = /^[0-9a-zA-Z-]+$/;

/**
 * App Core routes — eager-loaded application shell.
 *
 * Total: 15 entries (matches AAP §0.3.1 "~15" count).
 * Includes login/logout, dashboard, profile, settings, help, and
 * error-fallback pages.
 */
const APP_CORE_ROUTES: ReadonlyArray<Route> = [
  {
    path: '/login',
    module: 'app-core',
    tier: 'smoke',
    authRequired: false,
    description: 'Login form',
  },
  {
    path: '/logout',
    module: 'app-core',
    tier: 'smoke',
    authRequired: true,
    description: 'Logout (redirects to /login)',
  },
  {
    path: '/',
    module: 'app-core',
    tier: 'smoke',
    authRequired: true,
    description: 'Root (redirects to /dashboard)',
  },
  {
    path: '/dashboard',
    module: 'app-core',
    tier: 'smoke',
    authRequired: true,
    description: 'Authenticated landing dashboard',
  },
  {
    path: '/profile',
    module: 'app-core',
    tier: 'smoke',
    authRequired: true,
    description: 'User profile',
  },
  {
    path: '/profile/edit',
    module: 'app-core',
    tier: 'smoke',
    authRequired: true,
    description: 'Edit user profile',
  },
  {
    path: '/settings',
    module: 'app-core',
    tier: 'smoke',
    authRequired: true,
    description: 'User settings',
  },
  {
    path: '/settings/preferences',
    module: 'app-core',
    tier: 'smoke',
    authRequired: true,
    description: 'User preferences (theme, language)',
  },
  {
    path: '/settings/notifications',
    module: 'app-core',
    tier: 'smoke',
    authRequired: true,
    description: 'Notification preferences',
  },
  {
    path: '/help',
    module: 'app-core',
    tier: 'smoke',
    authRequired: true,
    description: 'Help / support landing',
  },
  {
    path: '/help/contact',
    module: 'app-core',
    tier: 'smoke',
    authRequired: true,
    description: 'Contact support',
  },
  {
    path: '/about',
    module: 'app-core',
    tier: 'smoke',
    authRequired: false,
    description: 'About page',
  },
  {
    path: '/error',
    module: 'app-core',
    tier: 'smoke',
    authRequired: false,
    description: 'Generic error fallback',
  },
  {
    path: '/404',
    module: 'app-core',
    tier: 'smoke',
    authRequired: false,
    description: '404 not found',
  },
  {
    path: '/forbidden',
    module: 'app-core',
    tier: 'smoke',
    authRequired: true,
    description: '403 forbidden',
  },
];

/**
 * Workforce module routes — lazy-loaded feature module.
 *
 * Total: 50 entries (matches AAP §0.3.1 "~50" count).
 * Covers teams, assignments, schedules, headcount, transfers, leave
 * requests, members, reports, and module-wide search per AAP §0.5.1.4.
 */
const WORKFORCE_ROUTES: ReadonlyArray<Route> = [
  {
    path: '/workforce',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    description: 'Workforce module landing',
  },

  // Teams
  {
    path: '/workforce/teams',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    description: 'Teams list',
  },
  {
    path: '/workforce/teams/new',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Create team form',
  },
  {
    path: '/workforce/teams/:id',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Team detail',
  },
  {
    path: '/workforce/teams/:id/edit',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Edit team form',
  },
  {
    path: '/workforce/teams/:id/members',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Team members list',
  },

  // Assignments
  {
    path: '/workforce/assignments',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    description: 'Assignments list',
  },
  {
    path: '/workforce/assignments/new',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Create assignment form',
  },
  {
    path: '/workforce/assignments/:id',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Assignment detail',
  },
  {
    path: '/workforce/assignments/:id/edit',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Edit assignment form',
  },
  {
    path: '/workforce/assignments/:id/history',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Assignment history',
  },
  {
    path: '/workforce/assignments/bulk',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Bulk assignment operations',
  },

  // Schedules
  {
    path: '/workforce/schedule',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    description: 'Schedule view',
  },
  {
    path: '/workforce/schedule/week',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Schedule week view',
  },
  {
    path: '/workforce/schedule/month',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Schedule month view',
  },
  {
    path: '/workforce/schedule/team/:teamId',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Schedule by team',
  },
  {
    path: '/workforce/schedule/edit/:date',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: /^\d{4}-\d{2}-\d{2}$/,
    description: 'Edit schedule entry (ISO date)',
  },

  // Headcount
  {
    path: '/workforce/headcount',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    description: 'Headcount summary',
  },
  {
    path: '/workforce/headcount/by-team',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Headcount by team',
  },
  {
    path: '/workforce/headcount/by-location',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Headcount by location',
  },
  {
    path: '/workforce/headcount/export',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Headcount CSV export',
  },
  {
    path: '/workforce/headcount/trends',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Headcount trends over time',
  },

  // Transfers
  {
    path: '/workforce/transfers',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    description: 'Transfer requests list',
  },
  {
    path: '/workforce/transfers/new',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Create transfer request',
  },
  {
    path: '/workforce/transfers/:id',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Transfer detail',
  },
  {
    path: '/workforce/transfers/:id/edit',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Edit transfer request',
  },
  {
    path: '/workforce/transfers/:id/approve',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Approve transfer (manager role)',
    requiredRoles: ['manager'],
  },
  {
    path: '/workforce/transfers/:id/reject',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Reject transfer (manager role)',
    requiredRoles: ['manager'],
  },
  {
    path: '/workforce/transfers/pending',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Pending transfers',
  },
  {
    path: '/workforce/transfers/history',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Transfer history',
  },

  // Leave requests
  {
    path: '/workforce/leave-requests',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    description: 'Leave requests list',
  },
  {
    path: '/workforce/leave-requests/new',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Create leave request',
  },
  {
    path: '/workforce/leave-requests/:id',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Leave request detail',
  },
  {
    path: '/workforce/leave-requests/:id/edit',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Edit leave request',
  },
  {
    path: '/workforce/leave-requests/:id/approve',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Approve leave (manager role)',
    requiredRoles: ['manager'],
  },
  {
    path: '/workforce/leave-requests/:id/reject',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Reject leave (manager role)',
    requiredRoles: ['manager'],
  },
  {
    path: '/workforce/leave-requests/:id/cancel',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Cancel leave request',
  },
  {
    path: '/workforce/leave-requests/calendar',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Leave calendar view',
  },
  {
    path: '/workforce/leave-requests/balance',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Leave balance summary',
  },

  // Members (workforce-side)
  {
    path: '/workforce/members',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    description: 'Workforce members list',
  },
  {
    path: '/workforce/members/:id',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Member profile',
  },
  {
    path: '/workforce/members/:id/assignments',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Member assignments',
  },
  {
    path: '/workforce/members/:id/schedule',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Member schedule',
  },
  {
    path: '/workforce/members/:id/leave-history',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Member leave history',
  },

  // Reports
  {
    path: '/workforce/reports',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    description: 'Workforce reports landing',
  },
  {
    path: '/workforce/reports/utilization',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Utilization report',
  },
  {
    path: '/workforce/reports/headcount-trends',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Headcount trends report',
  },
  {
    path: '/workforce/reports/leave-balance',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Leave balance report',
  },
  {
    path: '/workforce/reports/transfer-summary',
    module: 'workforce',
    tier: 'crud',
    authRequired: true,
    description: 'Transfer summary report',
  },

  // Search
  {
    path: '/workforce/search',
    module: 'workforce',
    tier: 'smoke',
    authRequired: true,
    description: 'Workforce-wide search',
  },
];

/**
 * Assessments module routes — lazy-loaded feature module.
 *
 * Total: 41 entries (matches AAP §0.3.1 "~40" count).
 * Covers templates, cycles, response capture, scoring, calibration, and
 * reporting per AAP §0.5.1.5.
 */
const ASSESSMENTS_ROUTES: ReadonlyArray<Route> = [
  {
    path: '/assessments',
    module: 'assessments',
    tier: 'smoke',
    authRequired: true,
    description: 'Assessments module landing',
  },

  // Templates
  {
    path: '/assessments/templates',
    module: 'assessments',
    tier: 'smoke',
    authRequired: true,
    description: 'Templates list',
  },
  {
    path: '/assessments/templates/new',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    description: 'Create template',
  },
  {
    path: '/assessments/templates/:id',
    module: 'assessments',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Template detail',
  },
  {
    path: '/assessments/templates/:id/edit',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Edit template',
  },
  {
    path: '/assessments/templates/:id/clone',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Clone template',
  },
  {
    path: '/assessments/templates/:id/preview',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Preview template',
  },
  {
    path: '/assessments/templates/:id/publish',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Publish template',
  },
  {
    path: '/assessments/templates/archived',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    description: 'Archived templates',
  },

  // Cycles
  {
    path: '/assessments/cycles',
    module: 'assessments',
    tier: 'smoke',
    authRequired: true,
    description: 'Cycles list',
  },
  {
    path: '/assessments/cycles/new',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    description: 'Create cycle',
  },
  {
    path: '/assessments/cycles/:id',
    module: 'assessments',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Cycle detail',
  },
  {
    path: '/assessments/cycles/:id/edit',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Edit cycle',
  },
  {
    path: '/assessments/cycles/:id/launch',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Launch cycle',
  },
  {
    path: '/assessments/cycles/:id/close',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Close cycle',
  },
  {
    path: '/assessments/cycles/:id/participants',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Cycle participants',
  },
  {
    path: '/assessments/cycles/:id/progress',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Cycle progress dashboard',
  },
  {
    path: '/assessments/cycles/active',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    description: 'Active cycles',
  },

  // Responses
  {
    path: '/assessments/responses',
    module: 'assessments',
    tier: 'smoke',
    authRequired: true,
    description: 'Responses list',
  },
  {
    path: '/assessments/responses/:id',
    module: 'assessments',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Response detail',
  },
  {
    path: '/assessments/responses/:id/capture',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Capture response wizard',
  },
  {
    path: '/assessments/responses/:id/review',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Review response',
  },
  {
    path: '/assessments/responses/:id/submit',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Submit response',
  },
  {
    path: '/assessments/responses/drafts',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    description: 'Draft responses',
  },

  // Scoring
  {
    path: '/assessments/scoring',
    module: 'assessments',
    tier: 'smoke',
    authRequired: true,
    description: 'Scoring landing',
  },
  {
    path: '/assessments/scoring/:cycleId',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Scoring grid for cycle',
  },
  {
    path: '/assessments/scoring/:cycleId/grid',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Scoring grid view',
  },
  {
    path: '/assessments/scoring/:cycleId/bulk',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Bulk scoring update',
  },
  {
    path: '/assessments/scoring/:cycleId/individual/:participantId',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Individual scoring',
  },
  {
    path: '/assessments/scoring/history',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    description: 'Scoring history',
  },

  // Calibration
  {
    path: '/assessments/calibration',
    module: 'assessments',
    tier: 'smoke',
    authRequired: true,
    description: 'Calibration landing',
  },
  {
    path: '/assessments/calibration/:cycleId',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Calibration view for cycle',
  },
  {
    path: '/assessments/calibration/:cycleId/adjust',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Calibration manual adjustment',
  },
  {
    path: '/assessments/calibration/:cycleId/lock',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Lock calibration',
  },
  {
    path: '/assessments/calibration/sessions',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    description: 'Calibration sessions',
  },

  // Reporting
  {
    path: '/assessments/reporting',
    module: 'assessments',
    tier: 'smoke',
    authRequired: true,
    description: 'Reporting landing',
  },
  {
    path: '/assessments/reporting/cycle/:cycleId',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Per-cycle report',
  },
  {
    path: '/assessments/reporting/team/:teamId',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Per-team report',
  },
  {
    path: '/assessments/reporting/individual/:userId',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Per-individual report',
  },
  {
    path: '/assessments/reporting/export',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    description: 'Export report',
  },
  {
    path: '/assessments/reporting/history',
    module: 'assessments',
    tier: 'crud',
    authRequired: true,
    description: 'Report history',
  },
];

/**
 * Competencies module routes — lazy-loaded feature module.
 *
 * Total: 35 entries (matches AAP §0.3.1 "~35" count).
 * Covers catalog, skills, proficiency matrix, learning paths,
 * certifications, and reports per AAP §0.5.1.6.
 */
const COMPETENCIES_ROUTES: ReadonlyArray<Route> = [
  {
    path: '/competencies',
    module: 'competencies',
    tier: 'smoke',
    authRequired: true,
    description: 'Competencies module landing',
  },

  // Catalog
  {
    path: '/competencies/catalog',
    module: 'competencies',
    tier: 'smoke',
    authRequired: true,
    description: 'Catalog list',
  },
  {
    path: '/competencies/catalog/new',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    description: 'Create catalog item',
  },
  {
    path: '/competencies/catalog/:id',
    module: 'competencies',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Catalog item detail',
  },
  {
    path: '/competencies/catalog/:id/edit',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Edit catalog item',
  },
  {
    path: '/competencies/catalog/categories',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    description: 'Catalog categories',
  },
  {
    path: '/competencies/catalog/categories/:id',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Category detail',
  },
  {
    path: '/competencies/catalog/archived',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    description: 'Archived catalog items',
  },

  // Skills
  {
    path: '/competencies/skills',
    module: 'competencies',
    tier: 'smoke',
    authRequired: true,
    description: 'Skills list',
  },
  {
    path: '/competencies/skills/new',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    description: 'Create skill',
  },
  {
    path: '/competencies/skills/:id',
    module: 'competencies',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Skill detail',
  },
  {
    path: '/competencies/skills/:id/edit',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Edit skill',
  },
  {
    path: '/competencies/skills/search',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    description: 'Skill search',
  },
  {
    path: '/competencies/skills/:id/related',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Related skills',
  },
  {
    path: '/competencies/skills/taxonomy',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    description: 'Skills taxonomy',
  },

  // Proficiency Matrix
  {
    path: '/competencies/proficiency-matrix',
    module: 'competencies',
    tier: 'smoke',
    authRequired: true,
    description: 'Proficiency matrix',
  },
  {
    path: '/competencies/proficiency-matrix/edit',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    description: 'Edit proficiency matrix',
  },
  {
    path: '/competencies/proficiency-matrix/levels',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    description: 'Proficiency levels',
  },
  {
    path: '/competencies/proficiency-matrix/levels/:id',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Proficiency level detail',
  },
  {
    path: '/competencies/proficiency-matrix/by-role',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    description: 'Proficiency matrix by role',
  },

  // Learning Paths
  {
    path: '/competencies/learning-paths',
    module: 'competencies',
    tier: 'smoke',
    authRequired: true,
    description: 'Learning paths list',
  },
  {
    path: '/competencies/learning-paths/new',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    description: 'Create learning path',
  },
  {
    path: '/competencies/learning-paths/:id',
    module: 'competencies',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Learning path detail',
  },
  {
    path: '/competencies/learning-paths/:id/edit',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Edit learning path',
  },
  {
    path: '/competencies/learning-paths/:id/enroll',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Enroll in learning path',
  },
  {
    path: '/competencies/learning-paths/:id/progress',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Learning path progress',
  },
  {
    path: '/competencies/learning-paths/recommended',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    description: 'Recommended learning paths',
  },

  // Certifications
  {
    path: '/competencies/certifications',
    module: 'competencies',
    tier: 'smoke',
    authRequired: true,
    description: 'Certifications list',
  },
  {
    path: '/competencies/certifications/new',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    description: 'Create certification',
  },
  {
    path: '/competencies/certifications/:id',
    module: 'competencies',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Certification detail',
  },
  {
    path: '/competencies/certifications/:id/edit',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Edit certification',
  },
  {
    path: '/competencies/certifications/:id/award',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Award certification',
  },
  {
    path: '/competencies/certifications/:id/revoke',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Revoke certification',
  },
  {
    path: '/competencies/certifications/expiring',
    module: 'competencies',
    tier: 'crud',
    authRequired: true,
    description: 'Expiring certifications',
  },

  // Reports
  {
    path: '/competencies/reports',
    module: 'competencies',
    tier: 'smoke',
    authRequired: true,
    description: 'Competencies reports landing',
  },
];

/**
 * Authorization module routes — lazy-loaded feature module.
 *
 * Total: 24 entries (matches AAP §0.3.1 "~23" count, within ±10 tolerance).
 * Covers roles, permissions, role assignments, delegated access, and
 * audit-of-grants per AAP §0.5.1.7. All entries require admin (or auditor)
 * role per Whoville-Client RBAC convention.
 */
const AUTHORIZATION_ROUTES: ReadonlyArray<Route> = [
  {
    path: '/authorization',
    module: 'authorization',
    tier: 'smoke',
    authRequired: true,
    description: 'Authorization module landing',
    requiredRoles: ['admin'],
  },

  // Roles
  {
    path: '/authorization/roles',
    module: 'authorization',
    tier: 'smoke',
    authRequired: true,
    description: 'Roles list',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/roles/new',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    description: 'Create role',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/roles/:id',
    module: 'authorization',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Role detail',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/roles/:id/edit',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Edit role',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/roles/:id/usage',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Role usage report',
    requiredRoles: ['admin'],
  },

  // Permissions
  {
    path: '/authorization/permissions',
    module: 'authorization',
    tier: 'smoke',
    authRequired: true,
    description: 'Permissions list',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/permissions/new',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    description: 'Create permission',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/permissions/:id',
    module: 'authorization',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Permission detail',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/permissions/:id/edit',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Edit permission',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/permissions/by-resource',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    description: 'Permissions grouped by resource',
    requiredRoles: ['admin'],
  },

  // Role Assignments
  {
    path: '/authorization/assignments',
    module: 'authorization',
    tier: 'smoke',
    authRequired: true,
    description: 'Role assignments list',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/assignments/new',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    description: 'Create role assignment',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/assignments/:id',
    module: 'authorization',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Assignment detail',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/assignments/:id/revoke',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Revoke role assignment',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/assignments/by-user/:userId',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Assignments by user',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/assignments/by-role/:roleId',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Assignments by role',
    requiredRoles: ['admin'],
  },

  // Delegated Access
  {
    path: '/authorization/delegated-access',
    module: 'authorization',
    tier: 'smoke',
    authRequired: true,
    description: 'Delegated access list',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/delegated-access/new',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    description: 'Grant delegated access',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/delegated-access/:id',
    module: 'authorization',
    tier: 'smoke',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Delegated access detail',
    requiredRoles: ['admin'],
  },
  {
    path: '/authorization/delegated-access/:id/revoke',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Revoke delegated access',
    requiredRoles: ['admin'],
  },

  // Audit of Grants
  {
    path: '/authorization/audit',
    module: 'authorization',
    tier: 'smoke',
    authRequired: true,
    description: 'Audit of grants',
    requiredRoles: ['admin', 'auditor'],
  },
  {
    path: '/authorization/audit/by-user/:userId',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    paramPattern: DEFAULT_ID_PATTERN,
    description: 'Audit by user',
    requiredRoles: ['admin', 'auditor'],
  },
  {
    path: '/authorization/audit/export',
    module: 'authorization',
    tier: 'crud',
    authRequired: true,
    description: 'Export audit report',
    requiredRoles: ['admin', 'auditor'],
  },
];

// ---------------------------------------------------------------------------
// Public exports — combined route inventory and helper projections
// ---------------------------------------------------------------------------

/**
 * Flat array of every Whoville-Client route.
 *
 * Total: ~165 entries (15 + 50 + 41 + 35 + 24 — within AAP §0.3.1 "~163"
 * tolerance band of ±10).
 *
 * Iterate this in Tier 1 smoke tests:
 * ```ts
 * for (const route of ROUTES) {
 *   test(`route ${route.path} renders`, async ({ page }) => {
 *     await page.goto(resolveParams(route));
 *     await expect(page.getByRole('main')).toBeVisible();
 *   });
 * }
 * ```
 */
export const ROUTES: ReadonlyArray<Route> = [
  ...APP_CORE_ROUTES,
  ...WORKFORCE_ROUTES,
  ...ASSESSMENTS_ROUTES,
  ...COMPETENCIES_ROUTES,
  ...AUTHORIZATION_ROUTES,
];

/**
 * Same routes, grouped by module for O(1) per-module access.
 *
 * The `as const` annotation preserves literal-type information so
 * downstream consumers get compile-time autocomplete on module keys
 * (e.g., `ROUTES_BY_MODULE.workfoce` is a typo-induced compile error,
 * not a silent `undefined`).
 *
 * @example
 * ```ts
 * import { ROUTES_BY_MODULE } from '@utils/route-inventory';
 *
 * // All workforce routes:
 * ROUTES_BY_MODULE.workforce;
 *
 * // App Core landing routes:
 * ROUTES_BY_MODULE['app-core'];
 * ```
 */
export const ROUTES_BY_MODULE = {
  'app-core': APP_CORE_ROUTES,
  workforce: WORKFORCE_ROUTES,
  assessments: ASSESSMENTS_ROUTES,
  competencies: COMPETENCIES_ROUTES,
  authorization: AUTHORIZATION_ROUTES,
} as const;

/**
 * Total route count, computed at module load time.
 *
 * Used in coverage-report sanity assertions:
 * ```ts
 * expect(ROUTE_COUNT).toBeGreaterThanOrEqual(155);
 * expect(ROUTE_COUNT).toBeLessThanOrEqual(175);
 * ```
 */
export const ROUTE_COUNT: number = ROUTES.length;

/**
 * Routes that do NOT require authentication.
 *
 * Used by the smoke tier's unauthenticated reachability tests
 * (e.g., `/login`, `/about`, `/error`, `/404`). Every entry in this
 * collection bypasses `storageState` loading.
 */
export const UNAUTHENTICATED_ROUTES: ReadonlyArray<Route> = ROUTES.filter((r) => !r.authRequired);

/**
 * Routes restricted to specific roles (i.e., `requiredRoles` is non-empty).
 *
 * Iterated by Tier 3 RBAC denial-path tests
 * (`e2e/specs/integration/03-rbac-denial-paths.int.spec.ts`, AAP §0.5.1.11)
 * to assert denial UX when an under-privileged user attempts access.
 */
export const ROLE_RESTRICTED_ROUTES: ReadonlyArray<Route> = ROUTES.filter(
  (r) => Array.isArray(r.requiredRoles) && r.requiredRoles.length > 0,
);

/**
 * Routes containing one or more `:param`-style placeholders.
 *
 * Tests must substitute fixture-generated ids before navigating; the
 * `paramPattern` regex (when present) constrains acceptable substitutions.
 * The path-includes-`:` check catches param-bearing routes whose author
 * forgot to declare a `paramPattern` (defaulting to {@link DEFAULT_ID_PATTERN}
 * implicitly).
 */
export const PARAMETERIZED_ROUTES: ReadonlyArray<Route> = ROUTES.filter(
  (r) => r.paramPattern !== undefined || r.path.includes(':'),
);
