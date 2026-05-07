/**
 * WorkforceAssignment entity factory for the Whoville-Client Workforce
 * module.
 *
 * A `WorkforceAssignment` represents the assignment of a user to a team,
 * project, or schedule with optional start/end dates and approval state.
 *
 * Generates entities with `e2e-test-` prefixed references so the
 * live-mode entity sweeper (e2e/utils/test-data-cleanup.ts) can identify
 * orphan test entities for removal per AAP §0.4.4.
 *
 * Uses `@faker-js/faker` (version pinned per AAP §0.6.1: `^9.0.0`).
 *
 * Foundational layer — imports only `@faker-js/faker`. Pure data
 * generation with no I/O, no Node.js built-ins, no other factory
 * dependencies (no sibling-factory imports per AAP §0.10.1). Each call
 * produces an independent, parallel-safe instance.
 *
 * ## Cleanup contract (AAP §0.4.4 — Live-mode database hygiene)
 *
 * The live-mode sweeper identifies deletion candidates by inspecting the
 * `reference` field. The field begins with the configured `e2e-test-`
 * prefix (default), and a randomized 8-character alphanumeric suffix
 * guarantees uniqueness across parallel workers.
 *
 * ## Migration-proof shape (AAP §0.10.1)
 *
 * All exported types use only primitive TypeScript types.
 *
 * ## Determinism (AAP §0.4.4)
 *
 * All `faker.date.*` calls use a seed-deterministic `refDate` produced
 * by `deterministicDateAnchor()`. Chronological invariants (`startDate ≤
 * endDate`, `approvedAt ≥ submittedAt`, `endDate > startDate when
 * non-null`) are enforced by anchoring secondary date generators to
 * primary ones.
 *
 * @see AAP §0.5.1.12, §0.4.4, §0.10.1.
 * @see e2e/pages/workforce/assignment-list.page.ts,
 *      assignment-detail.page.ts, assignment-form.page.ts — POM consumers.
 * @see e2e/mocks/handlers/workforce.handler.ts — mock handler consumer.
 * @see e2e/fixtures/api-responses/workforce/assignments-list.json,
 *      assignment-detail.json — fixture shape references.
 */

// ---------------------------------------------------------------------------
// Imports — strictly limited to `@faker-js/faker`.
// ---------------------------------------------------------------------------

import { faker } from '@faker-js/faker';

// ---------------------------------------------------------------------------
// Public type definitions
// ---------------------------------------------------------------------------

/**
 * Type of workforce assignment.
 *
 * Closed union for compile-time safety.
 *
 * - `'project'`  — Project-based assignment with explicit start/end.
 * - `'team'`     — Permanent team membership; typically open-ended.
 * - `'rotation'` — Time-bounded rotation (training, secondment).
 * - `'temp'`     — Short-term temporary assignment.
 */
export type AssignmentType = 'project' | 'team' | 'rotation' | 'temp';

/**
 * Approval workflow status of an assignment.
 *
 * Closed union for compile-time safety.
 *
 * - `'draft'`     — Submitter is still editing; not yet sent for approval.
 * - `'pending'`   — Awaiting approver action.
 * - `'approved'`  — Approver has approved; the assignment is in effect.
 * - `'rejected'`  — Approver has rejected; the assignment is invalid.
 * - `'cancelled'` — Submitter cancelled before approver acted.
 * - `'completed'` — Assignment is past its `endDate` and considered done.
 */
export type AssignmentStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'completed';

/**
 * WorkforceAssignment entity. Represents a user's assignment to a team,
 * project, or rotation in the Whoville-Client Workforce module.
 *
 * Migration-proof shape: primitive types only. Cross-factory
 * relationships stored as UUID strings.
 *
 * Field stability:
 *   - `id` and `reference` are stable identifiers; `reference` is the
 *     cleanup marker.
 *   - `userId` and `teamId` are required UUID references.
 *   - `projectId` is optional — assignments not associated with a
 *     specific project (e.g., team membership) leave it null.
 *   - `startDate` and `endDate` are date-only ISO strings (`'YYYY-MM-DD'`)
 *     because workforce assignments are typically scheduled at day
 *     granularity, not minute granularity.
 *   - Approval-conditional fields (`approvedAt`, `approvedById`,
 *     `rejectionReason`) are populated only in their corresponding
 *     status states.
 */
export interface WorkforceAssignment {
  /** UUID identifier (RFC 4122 v4). */
  readonly id: string;
  /**
   * `e2e-test-assignment-` prefixed reference label for live-mode
   * cleanup eligibility.
   *
   * Format: `e2e-test-assignment-<type>-<8-char-suffix>` (e.g.,
   * `'e2e-test-assignment-project-x7y8a3bc'`).
   */
  readonly reference: string;
  /**
   * Title / display label of the assignment. Realistic prose generated
   * by faker for fixture data.
   */
  readonly title: string;
  /** Type of assignment (closed union — see {@link AssignmentType}). */
  readonly type: AssignmentType;
  /** UUID of the assigned user. */
  readonly userId: string;
  /** UUID of the team the user is assigned to. */
  readonly teamId: string;
  /**
   * UUID of the project the assignment is for. `null` for non-project
   * assignments (e.g., team membership, rotations).
   */
  readonly projectId: string | null;
  /** Current approval workflow status (closed union — see {@link AssignmentStatus}). */
  readonly status: AssignmentStatus;
  /**
   * ISO 8601 date-only string (`'YYYY-MM-DD'`) for assignment start.
   * Anchored to the deterministic date anchor for seed reproducibility.
   */
  readonly startDate: string;
  /**
   * ISO 8601 date-only string (`'YYYY-MM-DD'`) for assignment end.
   * `null` for open-ended assignments (e.g., permanent team membership).
   * When non-null, guaranteed to be ≥ `startDate`.
   */
  readonly endDate: string | null;
  /**
   * Allocation percentage (0–100) representing how much of the user's
   * time is dedicated to this assignment. Integer for typical usage;
   * half-allocations (50%) are common in production.
   */
  readonly allocationPercent: number;
  /**
   * UUID of the user who submitted the assignment for approval. May
   * differ from `userId` (e.g., a manager creating an assignment on
   * behalf of a team member).
   */
  readonly submittedById: string;
  /** ISO 8601 timestamp of submission for approval. */
  readonly submittedAt: string;
  /**
   * UUID of the user who approved the assignment. Optional — present
   * only when `status === 'approved'`.
   */
  readonly approvedById?: string;
  /**
   * ISO 8601 timestamp when the assignment was approved. `null` for
   * assignments not yet approved or in a non-approval terminal state.
   */
  readonly approvedAt: string | null;
  /**
   * Optional rejection reason. Populated only when
   * `status === 'rejected'`; absent otherwise.
   */
  readonly rejectionReason?: string;
  /**
   * Optional notes / additional context. Realistic prose generated by
   * faker; absent for ~50% of generated assignments (matching
   * production reality where many routine assignments have no notes).
   */
  readonly notes?: string;
  /** ISO 8601 timestamp of creation. */
  readonly createdAt: string;
  /** ISO 8601 timestamp of last update. Optional. */
  readonly updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Internal constants — file-local; not exported.
// ---------------------------------------------------------------------------

/** Common prefix applied for cleanup eligibility. */
const E2E_TEST_PREFIX = 'e2e-test-';

/** Length of the random alphanumeric uniqueness suffix. */
const UNIQUE_SUFFIX_LENGTH = 8;

/** Closed list of values emitted for `AssignmentType`. */
const ASSIGNMENT_TYPES: ReadonlyArray<AssignmentType> = ['project', 'team', 'rotation', 'temp'];

/**
 * Weighted distribution for `AssignmentStatus`. `'approved'` is
 * over-represented to match production reality where most assignments
 * have completed approval and are in effect.
 */
const ASSIGNMENT_STATUS_DISTRIBUTION: ReadonlyArray<AssignmentStatus> = [
  'approved',
  'approved',
  'approved',
  'approved',
  'pending',
  'pending',
  'completed',
  'completed',
  'draft',
  'rejected',
  'cancelled',
];

/** Probability (0–1) that a generated assignment has notes. */
const PROBABILITY_HAS_NOTES = 0.5;

/** Probability (0–1) that a generated assignment is associated with a project. */
const PROBABILITY_HAS_PROJECT = 0.6;

/** Probability (0–1) that a generated assignment has a non-null `endDate`. */
const PROBABILITY_HAS_END_DATE = 0.85;

/**
 * Allocation percentage choices. Typical workforce assignments are full
 * (100%), half (50%), or quarter (25%) — fractional allocations between
 * these are uncommon. The bias matches production reality.
 */
const ALLOCATION_CHOICES: ReadonlyArray<number> = [100, 100, 100, 100, 75, 50, 50, 25, 10];

/** Lookback window (days) for `createdAt` and `submittedAt` timestamps. */
const RECENT_DAYS_CREATED = 365;

/** Lookback window (days) for `updatedAt` timestamps. */
const RECENT_DAYS_UPDATED = 30;

/** Days into the future for `startDate`, relative to the anchor. */
const START_DATE_FUTURE_MIN_DAYS = 0;
const START_DATE_FUTURE_MAX_DAYS = 60;

/** Duration (days) added to `startDate` to compute `endDate`. */
const ASSIGNMENT_DURATION_MIN_DAYS = 14;
const ASSIGNMENT_DURATION_MAX_DAYS = 365;

/** Minimum / maximum word count for the title. */
const MIN_TITLE_WORDS = 3;
const MAX_TITLE_WORDS = 7;

/** Minimum / maximum word count for the notes / rejection reason. */
const MIN_NOTES_WORDS = 4;
const MAX_NOTES_WORDS = 15;

// ---------------------------------------------------------------------------
// Determinism anchor (per AAP §0.4.4)
// ---------------------------------------------------------------------------

/** Lower bound of the deterministic date anchor: 2020-01-01T00:00:00.000Z. */
const ANCHOR_MIN_EPOCH_MS = Date.UTC(2020, 0, 1);

/** Upper bound of the deterministic date anchor: 2030-12-31T00:00:00.000Z. */
const ANCHOR_MAX_EPOCH_MS = Date.UTC(2030, 11, 31);

/**
 * Generate a seed-deterministic `Date` anchor without consulting the
 * wall-clock. See e2e/factories/role-grant.factory.ts for the full
 * rationale (the contained fix for QA Issue #3).
 */
function deterministicDateAnchor(): Date {
  return new Date(faker.number.int({ min: ANCHOR_MIN_EPOCH_MS, max: ANCHOR_MAX_EPOCH_MS }));
}

/**
 * Convert a `Date` to an ISO 8601 date-only string (`'YYYY-MM-DD'`).
 *
 * Workforce assignments are scheduled at day granularity, not minute
 * granularity, so the date-only form matches the API contract for
 * `startDate` / `endDate` fields. Implemented inline (rather than
 * importing a date library) to keep the foundational-layer constraint
 * intact.
 */
function dateOnlyIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Generate a {@link WorkforceAssignment} instance with sensible defaults
 * and optional overrides.
 *
 * Each invocation produces an independent, parallel-safe instance with
 * internally-consistent status-conditional fields:
 *   - `id` is a fresh RFC 4122 v4 UUID.
 *   - `reference` carries the `e2e-test-assignment-` prefix.
 *   - `startDate` and `endDate` are date-only ISO strings; `endDate` is
 *     guaranteed ≥ `startDate` when non-null.
 *   - `approvedAt` and `approvedById` are populated only when
 *     `status === 'approved'`.
 *   - `rejectionReason` is populated only when `status === 'rejected'`.
 *   - `allocationPercent` is drawn from the realistic-bias distribution.
 *
 * @example Default assignment (typically approved, with project):
 * ```ts
 * const a = assignmentFactory();
 * ```
 *
 * @example Targeted override (specific user + team, draft state):
 * ```ts
 * const draft = assignmentFactory({
 *   userId: knownUser.id,
 *   teamId: knownTeam.id,
 *   status: 'draft',
 * });
 * ```
 *
 * @example Rejected assignment for negative-path tests:
 * ```ts
 * const rejected = assignmentFactory({
 *   status: 'rejected',
 *   rejectionReason: 'Insufficient capacity',
 * });
 * ```
 *
 * @param overrides Partial fields to override on the generated instance.
 *                  Defaults to an empty object.
 * @returns A fully-populated {@link WorkforceAssignment} object.
 */
export function workforceAssignmentFactory(
  overrides: Partial<WorkforceAssignment> = {},
): WorkforceAssignment {
  // 8-character lowercase alphanumeric suffix for parallel-worker uniqueness.
  const uniqueSuffix = faker.string.alphanumeric({
    length: UNIQUE_SUFFIX_LENGTH,
    casing: 'lower',
  });

  const type: AssignmentType = faker.helpers.arrayElement<AssignmentType>(ASSIGNMENT_TYPES);
  const reference = `${E2E_TEST_PREFIX}assignment-${type}-${uniqueSuffix}`;

  // Title: realistic short phrase suitable for UI rendering. Capitalised
  // first letter for natural display.
  const titleRaw = faker.lorem.words({ min: MIN_TITLE_WORDS, max: MAX_TITLE_WORDS });
  const title = titleRaw.charAt(0).toUpperCase() + titleRaw.slice(1);

  // Status: weighted random per ASSIGNMENT_STATUS_DISTRIBUTION.
  const status: AssignmentStatus = faker.helpers.arrayElement<AssignmentStatus>(
    ASSIGNMENT_STATUS_DISTRIBUTION,
  );

  // Allocation: drawn from the realistic-bias choice set.
  const allocationPercent = faker.helpers.arrayElement(ALLOCATION_CHOICES);

  // Cross-factory references stored as UUID strings.
  const userId = faker.string.uuid();
  const teamId = faker.string.uuid();
  const submittedById = faker.string.uuid();
  const hasProject = faker.datatype.boolean({ probability: PROBABILITY_HAS_PROJECT });
  const projectId = hasProject ? faker.string.uuid() : null;

  // Determinism anchor — see `deterministicDateAnchor()`.
  const dateAnchor = deterministicDateAnchor();

  // Compute `startDate` from a future-window relative to the anchor.
  // Anchoring to the deterministic anchor (rather than wall-clock)
  // preserves byte-identical reproducibility.
  const startDateMs =
    dateAnchor.getTime() +
    faker.number.int({
      min: START_DATE_FUTURE_MIN_DAYS * 24 * 60 * 60 * 1000,
      max: START_DATE_FUTURE_MAX_DAYS * 24 * 60 * 60 * 1000,
    });
  const startDate = dateOnlyIso(new Date(startDateMs));

  // Compute `endDate` by adding a duration to `startDate`. Some
  // assignments are open-ended (~15%) — those have `endDate: null`.
  const hasEndDate = faker.datatype.boolean({ probability: PROBABILITY_HAS_END_DATE });
  let endDate: string | null = null;
  if (hasEndDate) {
    const durationMs =
      faker.number.int({
        min: ASSIGNMENT_DURATION_MIN_DAYS,
        max: ASSIGNMENT_DURATION_MAX_DAYS,
      }) *
      24 *
      60 *
      60 *
      1000;
    endDate = dateOnlyIso(new Date(startDateMs + durationMs));
  }

  // Submission timestamp anchored to the deterministic anchor.
  const submittedAtDate = faker.date.recent({
    days: RECENT_DAYS_CREATED,
    refDate: dateAnchor,
  });
  const submittedAt = submittedAtDate.toISOString();

  // Approval-conditional fields. `approvedAt` falls strictly within
  // (submittedAtDate, dateAnchor] via faker.date.between to enforce
  // the chronological invariant.
  let approvedAt: string | null = null;
  let approvedById: string | undefined;
  if (status === 'approved') {
    approvedAt = faker.date.between({ from: submittedAtDate, to: dateAnchor }).toISOString();
    approvedById = faker.string.uuid();
  }

  // Rejection-conditional reason.
  const rejectionReason =
    status === 'rejected'
      ? faker.lorem.sentence({ min: MIN_NOTES_WORDS, max: MAX_NOTES_WORDS })
      : undefined;

  // Notes are present in ~50% of assignments.
  const hasNotes = faker.datatype.boolean({ probability: PROBABILITY_HAS_NOTES });
  const notes = hasNotes
    ? faker.lorem.sentence({ min: MIN_NOTES_WORDS, max: MAX_NOTES_WORDS })
    : undefined;

  // createdAt / updatedAt anchored to the deterministic anchor.
  const createdAt = faker.date
    .recent({ days: RECENT_DAYS_CREATED, refDate: dateAnchor })
    .toISOString();
  const updatedAt = faker.date
    .recent({ days: RECENT_DAYS_UPDATED, refDate: dateAnchor })
    .toISOString();

  return {
    id: faker.string.uuid(),
    reference,
    title,
    type,
    userId,
    teamId,
    projectId,
    status,
    startDate,
    endDate,
    allocationPercent,
    submittedById,
    submittedAt,
    approvedById,
    approvedAt,
    rejectionReason,
    notes,
    createdAt,
    updatedAt,
    ...overrides,
  };
}
