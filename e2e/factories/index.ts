/**
 * Barrel export for the `e2e/factories` foundational layer.
 *
 * Provides a single, stable import surface for every entity factory used
 * by the Whoville-Client Playwright suite. Per the path-alias convention
 * declared in `tsconfig.e2e.json`, consumers import factories via:
 *
 *     import { userFactory, teamFactory, type User } from '@factories';
 *
 * rather than reaching into individual factory files. This keeps the
 * spec / fixture layer decoupled from the on-disk file layout — adding a
 * new factory becomes a single re-export entry here, and no spec needs
 * to update its import path.
 *
 * ## Layering constraint (AAP §0.10.1)
 *
 * This barrel imports ONLY from sibling factory files within the same
 * directory. It does NOT import from `@fixtures`, `@pages`, `@patterns`,
 * `@mocks`, `@utils`, or any other E2E layer — that would create a cycle
 * because higher layers import this barrel.
 *
 * ## Re-export style (AAP §0.6.2 import convention)
 *
 * - Function exports use `export { fn } from './file'`.
 * - Type exports use `export type { T } from './file'` to ensure
 *   type-only imports compile down to nothing at runtime.
 * - Named re-exports rather than `export *` so the public API surface is
 *   visible at a glance and IDE auto-import suggestions stay focused.
 *
 * @see AAP §0.5.1.12 — file mandate ("`e2e/factories/index.ts` |
 *      CREATE | n/a | Barrel export.").
 * @see AAP §0.6.2 — Import update convention (path aliases).
 * @see AAP §0.10.1 — Foundational layer constraints (no sibling-factory
 *      imports inside individual factories; the barrel re-exports those
 *      siblings to consumers without violating the no-sibling-import
 *      rule on the factories themselves).
 */

// ---------------------------------------------------------------------------
// Authorization module — Permission and RoleGrant entities
// ---------------------------------------------------------------------------

export { permissionFactory, roleGrantFactory } from './role-grant.factory';
export type {
  Permission,
  PermissionAction,
  RoleGrant,
  RoleGrantStatus,
} from './role-grant.factory';

// ---------------------------------------------------------------------------
// App Core / cross-cutting — User entity
// ---------------------------------------------------------------------------

export {
  userFactory,
  adminUserFactory,
  viewerUserFactory,
  restrictedUserFactory,
  managerUserFactory,
  auditorUserFactory,
} from './user.factory';
export type { User, UserRole } from './user.factory';

// ---------------------------------------------------------------------------
// Workforce module — Team and WorkforceAssignment entities
// ---------------------------------------------------------------------------

export { teamFactory } from './team.factory';
export type { Team } from './team.factory';

export { workforceAssignmentFactory } from './workforce-assignment.factory';
export type {
  WorkforceAssignment,
  WorkforceAssignmentType,
  WorkforceAssignmentStatus,
} from './workforce-assignment.factory';

// ---------------------------------------------------------------------------
// Assessments module — Assessment and AssessmentResponse entities
// ---------------------------------------------------------------------------

export { assessmentFactory, assessmentResponseFactory } from './assessment.factory';
export type {
  Assessment,
  AssessmentScore,
  AssessmentStatus,
  AssessmentResponse,
  AssessmentResponseStatus,
} from './assessment.factory';

// ---------------------------------------------------------------------------
// Competencies module — Competency and CompetencyLevel entities
// ---------------------------------------------------------------------------

export { competencyFactory, competencyLevelFactory } from './competency.factory';
export type { Competency, CompetencyCategory, CompetencyLevel } from './competency.factory';
