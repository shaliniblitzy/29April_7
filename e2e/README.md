# Whoville-Client E2E Test Suite

Playwright-based end-to-end regression tests for the Whoville-Client Angular 11.2.5 application — the regression safety net for the planned Angular 11→21 framework migration.

This directory holds the entire E2E test suite: spec files, page object models, fixtures, factories, mocks, custom reporters, scripts, and supporting documentation. Configuration files (`playwright.config.ts`, `tsconfig.e2e.json`, `package.json`, `.env.e2e.example`) live at the repository root because they apply to the project as a whole; everything else lives here under `e2e/`.

> **Where this file fits in.** This README is the canonical entry point that every contributor reads when working on the E2E suite. It is referenced from the repository root [`README.md`](../README.md) "E2E Tests" section and is the binding contract for adding new tests, new entities, and new modules. For deeper conceptual material see the [References and Further Reading](#references-and-further-reading) section at the bottom of this file.

---

## Overview

The suite is a **greenfield** initiative authored from scratch — no Playwright, Cypress, or Selenium tests exist in the prior codebase. It replaces a defunct Protractor configuration that contained zero spec files (Protractor itself reached end-of-life in August 2023 and is no longer maintained for Angular projects).

**Purpose.** Capture the _current_ observable behavior of the Whoville-Client Angular 11.2.5 application as an executable regression contract before any framework version change. The suite is the acceptance gate for every Angular migration PR: all tier-1 and tier-2 tests must pass before any migration PR merges.

**Volume.** Approximately **~835 Playwright tests across ~101 spec files**, stratified into three runtime tiers (see [Three-Tier Strategy](#three-tier-strategy)).

**Surface.** All ~163 routes across the four lazy-loaded feature modules — **Workforce, Assessments, Competencies, Authorization** — plus the **App Core** (eager-loaded shell, header, sidenav, login, profile menu, error boundary, 404/500 pages, breadcrumbs).

**Migration target.** Angular 11.2.5 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20 → 21 (sequential majors). Every selector, fixture, and mock is authored to survive each step.

**Why Playwright.**

- Modern auto-waiting locators eliminate the brittle `sleep`/`waitForAngular` patterns that plagued Protractor.
- Cross-browser execution out of the box: Chromium, Firefox, WebKit.
- First-class trace, video, and screenshot capture for migration-era debugging.
- Network interception via `page.route()` removes the need for a separate mocking library.
- Active development cadence and a vibrant ecosystem post-Angular-15 (when Angular dropped Protractor support).

**Why three tiers.** Different feedback loops require different runtime budgets. A 3-minute smoke tier runs on every commit and PR; a 15-minute CRUD tier gates every PR before merge; a 25-minute integration tier runs nightly and pre-release. Splitting them keeps the PR feedback fast without sacrificing depth.

---

## Quick Start

```bash
# 1. Use Node 20.x (matches e2e/.nvmrc)
nvm use

# 2. Install all npm dependencies (run from repository root)
npm ci

# 3. Install Playwright browser binaries (Chromium, Firefox, WebKit + OS deps)
npm run e2e:install-browsers

# 4. Copy the env template and fill in real values for your local environment
cp .env.e2e.example .env.e2e
# Edit .env.e2e — at minimum, set E2E_TEST_USER_PASSWORD to a real
# password (or leave the defaults if you only run the mocked tier).

# 5. Start the Whoville-Client dev server in one terminal
#    (When the Whoville-Client app is committed alongside this suite,
#     this script binds to ng serve --port=4200. Until then it is a
#     placeholder that exits with status 1 — see the start:e2e note in
#     package.json scripts.)
npm run start:e2e

# 6. In a second terminal, run the smoke tier (~3 minutes)
npm run e2e:smoke
```

After the smoke tier passes, browse the HTML report:

```bash
npm run e2e:report
```

For ongoing development, prefer the interactive **UI mode** which watches your specs and re-runs only what changed:

```bash
npm run e2e:ui
```

---

## Three-Tier Strategy

The suite is stratified into three execution tiers. Each tier maps to a Playwright `project` in [`playwright.config.ts`](../playwright.config.ts) with its own `testMatch` glob, runtime budget, retry policy, and worker allocation.

| Tier                          | Test Count | Runtime Budget | Trigger                | Browser Matrix                                    | Failure Tolerance                     |
| ----------------------------- | ---------- | -------------- | ---------------------- | ------------------------------------------------- | ------------------------------------- |
| **Tier 1 — Smoke**            | ~40        | ~3 min         | Every commit, every PR | Chromium only                                     | Zero (PR-blocking)                    |
| **Tier 2 — Feature CRUD**     | ~640       | ~15 min        | Every PR (post-Tier-1) | Chromium for PRs; Chromium+Firefox+WebKit nightly | Zero on merge gate; flake retry × 1   |
| **Tier 3 — Integration/Edge** | ~130       | ~25 min        | Nightly + pre-release  | Chromium+Firefox+WebKit                           | Zero on release gate; flake retry × 2 |
| **Total**                     | **~810**   | ~43 min cum.   | —                      | —                                                 | —                                     |

> The "**~810**" total is within rounding tolerance of the user-specified ~835 budget; the remaining headroom is reserved for additions during stabilization (typically rotated/skipped tests promoted back into tier scope after a flake fix).

**How the tier separation is enforced.** [`playwright.config.ts`](../playwright.config.ts) declares one Playwright `project` per tier, each with a `testMatch` regular-expression glob:

| Project name           | `testMatch` glob                         | Spec directory                     |
| ---------------------- | ---------------------------------------- | ---------------------------------- |
| `smoke`                | `/smoke\/.*\.smoke\.spec\.ts$/`          | `e2e/specs/smoke/`                 |
| `feature-crud`         | `/feature-crud\/.*\.crud\.spec\.ts$/`    | `e2e/specs/feature-crud/<module>/` |
| `integration`          | `/integration\/.*\.int\.spec\.ts$/`      | `e2e/specs/integration/`           |
| `feature-crud-firefox` | (same as `feature-crud`, Firefox device) | `e2e/specs/feature-crud/<module>/` |
| `feature-crud-webkit`  | (same as `feature-crud`, WebKit device)  | `e2e/specs/feature-crud/<module>/` |
| `integration-firefox`  | (same as `integration`, Firefox device)  | `e2e/specs/integration/`           |
| `integration-webkit`   | (same as `integration`, WebKit device)   | `e2e/specs/integration/`           |

Adding a spec to the wrong directory (or with the wrong filename suffix) means it will not be picked up by any project — the spec quietly does nothing. The route-coverage report (`npm run e2e:coverage-report`) catches this and fails CI with a "spec is not matched by any project" warning.

**Tier-by-tier scenario coverage.**

- **Tier 1 — Smoke** covers application bootstrap (app loads, root component renders, no console errors), authentication smoke (login/logout, post-login redirect), lazy-module bundle integrity (each of the 4 lazy modules loads its bundle without 404), and route reachability (each module's landing route renders a stable landmark).

- **Tier 2 — Feature CRUD** covers per-entity CRUD (Create / Read / Update / Delete / List / Search) for every CRUD-eligible entity in the four lazy modules, plus form-validation scenarios, list-view interactions (pagination, sort, filter, multi-select, bulk action), and detail-view assertions (field rendering, breadcrumb, navigation back, related entity links).

- **Tier 3 — Integration / Edge Cases** covers cross-module workflows, RBAC denial paths, network-failure recovery (5xx, timeout, offline), validation boundary cases (max length, special characters, Unicode, empty strings, leading/trailing whitespace), large-list performance (1k–10k row virtualization), concurrency (two-tab editing, refresh-mid-form, browser-back-after-submit), and deep-linking / bookmark scenarios.

---

## Folder Architecture

The structure below reflects the **target** layout once all source-code agents have authored their files. Items already committed are marked with **(committed)**; items pending authoring per AAP are marked with **(pending)**.

```
e2e/
├── README.md                       # This file (committed)
├── .nvmrc                          # Node 20.x pin (committed)
├── .eslintrc.json                  # Locator-preference + no-raw-selectors-in-specs ESLint rules (committed)
├── .prettierrc.json                # Prettier formatting (committed)
├── global-setup.ts                 # Pre-suite: env validation, storageState gen, mock-API warm-up (committed)
├── global-teardown.ts              # Post-suite: cleanup, live-mode sweep, coverage finalize (pending)
├── specs/                          # Test specs by tier (pending)
│   ├── smoke/                      #   Tier 1 (~6 specs, ~40 tests)
│   ├── feature-crud/               #   Tier 2 (~80 specs, ~640 tests)
│   │   ├── workforce/              #     ~25 specs
│   │   ├── assessments/            #     ~22 specs
│   │   ├── competencies/           #     ~18 specs
│   │   └── authorization/          #     ~15 specs
│   └── integration/                #   Tier 3 (~15 specs, ~130 tests)
├── pages/                          # Page Object Models (pending)
│   ├── base.page.ts                #   Abstract base class
│   ├── app-shell/                  #   App Core POMs (login, header, sidenav, error pages, profile menu)
│   ├── workforce/                  #   Workforce POMs
│   ├── assessments/                #   Assessments POMs
│   ├── competencies/               #   Competencies POMs
│   └── authorization/              #   Authorization POMs
├── patterns/                       # Patterns A–E config-driven test templates (pending)
│   ├── types.ts                    #   EntityConfig<T>, FormPatternConfig<T>, etc.
│   ├── pattern-a-auth.template.ts
│   ├── pattern-b-list-detail.template.ts
│   ├── pattern-c-form-crud.template.ts
│   ├── pattern-d-search-filter.template.ts
│   └── pattern-e-workflow.template.ts
├── fixtures/                       # Composed test/expect, fixtures, JSON api-responses (pending)
│   ├── index.ts                    #   Re-exports `test` and `expect` extended with custom fixtures
│   ├── auth.fixture.ts             #   storageState-backed authenticatedPage / adminPage / viewerPage
│   ├── mock-api.fixture.ts         #   page.route() registration when MOCK_API=true
│   ├── factories.fixture.ts        #   Composed entity factories
│   ├── route-inventory.fixture.ts  #   Typed route inventory exposure
│   └── api-responses/              #   Static JSON keyed by API scope (auth/, workforce/, errors/, …)
├── factories/                      # @faker-js/faker entity factories (pending)
│   ├── user.factory.ts
│   ├── team.factory.ts
│   ├── workforce-assignment.factory.ts
│   ├── assessment.factory.ts
│   ├── competency.factory.ts
│   ├── role-grant.factory.ts
│   └── index.ts                    #   Barrel export
├── mocks/                          # page.route() handlers + injectors (pending)
│   ├── api-router.ts               #   Central dispatcher
│   ├── handlers/                   #   Per-scope handlers (auth, workforce, assessments, …)
│   ├── latency-injector.ts         #   Wraps a handler with configurable latency
│   └── error-injector.ts           #   Wraps a handler with configurable error injection
├── utils/                          # Shared helpers (pending)
│   ├── route-inventory.ts          #   Single source of truth for all ~163 routes
│   ├── wait-for-angular.ts         #   Defensive zone-stability shim (rare use)
│   ├── test-data-cleanup.ts        #   Live-mode entity sweeper (e2e-test- prefixed)
│   ├── storage-state-helper.ts     #   storageState JSON read/write
│   └── index.ts                    #   Barrel export
├── scripts/                        # Standalone CLI scripts (pending)
│   ├── coverage-report.ts          #   route-inventory ↔ specs reconciliation → e2e-coverage.html
│   ├── merge-tier-reports.ts       #   Merges tier HTML reports into one
│   ├── flake-detector.ts           #   30-day rolling flake-rate report
│   └── generate-storage-states.ts  #   Pre-suite storageState generator (also called by global-setup.ts)
├── reporters/                      # Custom Playwright reporters (pending)
│   ├── route-coverage-reporter.ts  #   Emits route-coverage delta when specs are added/removed
│   └── index.ts                    #   Barrel export
└── storage-states/                 # Per-role auth state JSON
    └── .gitkeep                    #   Directory placeholder; *.json files are gitignored (committed)
```

The configuration files at the repository root that govern this suite are:

| Path                                                 | Purpose                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [`../package.json`](../package.json)                 | Test framework dependencies (`@playwright/test`, faker, etc.) and the canonical npm `e2e:*` scripts. |
| [`../playwright.config.ts`](../playwright.config.ts) | Project matrix (3 tiers × up to 3 browsers), reporters, timeouts, conditional global hooks.          |
| [`../tsconfig.e2e.json`](../tsconfig.e2e.json)       | TypeScript config scoped to `e2e/**` with the path-alias map.                                        |
| [`../.env.e2e.example`](../.env.e2e.example)         | Environment-variable template. Copy to `.env.e2e` for local dev.                                     |
| [`../.gitignore`](../.gitignore)                     | Excludes `playwright-report/`, `test-results/`, `e2e/storage-states/*.json`, `.env.e2e`, traces.     |

---

## Running Tests

All test invocations route through the npm scripts declared in [`../package.json`](../package.json). The scripts are the **only sanctioned developer interface**; they are also the entry points used by every CI workflow, so what you run locally is what CI runs.

### Run All Three Tiers

```bash
npm run e2e
```

Equivalent to `npx playwright test`. Executes the `smoke`, `feature-crud`, and `integration` projects in parallel (subject to worker constraints). Use this for a full pre-release rehearsal; expect ~43 minutes cumulative on a default CI runner.

### Run a Single Tier

```bash
npm run e2e:smoke           # Tier 1, ~3 min, Chromium only
npm run e2e:crud            # Tier 2, ~15 min
npm run e2e:integration     # Tier 3, ~25 min
```

Each script targets one Playwright project via `--project=<name>`. The smoke script is what runs on every commit to feature branches; the crud script gates PR merges; the integration script runs nightly and pre-release.

### Run a Single Spec File

```bash
npx playwright test e2e/specs/feature-crud/workforce/team-create.crud.spec.ts
```

Useful when iterating on a specific spec. Playwright will still apply the matching project's settings (timeouts, retries, browser device).

### Run a Single Test by Name

```bash
npx playwright test -g "should log in with valid credentials"
```

The `-g` (or `--grep`) flag matches against the full test title (all `test.describe` blocks concatenated with the `test()` title). Use it for surgical re-runs while debugging.

### Run Only the Tests That Failed Last Time

```bash
npx playwright test --last-failed
```

Reads `test-results/.last-run.json` from the previous run and restricts execution to tests that failed. Combine with `--retries=0` to investigate flakes.

### Headed Mode (Visible Browser Window)

```bash
npm run e2e:headed
```

Adds `--headed` so Chromium/Firefox/WebKit windows are visible. Use this for visual debugging; never use in CI (CI runs headless).

### UI Mode (Interactive Watch Mode)

```bash
npm run e2e:ui
```

Launches Playwright's UI mode with a watch-style spec list, time-travel debugger, and step-by-step trace viewer. The recommended interactive workflow for authoring new specs.

### Debug Mode (Playwright Inspector)

```bash
npm run e2e:debug

# Or invoke directly with PWDEBUG=1 to scope to a single spec:
PWDEBUG=1 npx playwright test e2e/specs/integration/04-network-failure-recovery.int.spec.ts
```

Opens the Playwright Inspector, which pauses execution before each step and lets you walk through the test action by action.

### Codegen (Generate a Spec from Manual Interactions)

```bash
npm run e2e:codegen
```

Records your interactions in a real browser and emits Playwright code. Useful as a starting skeleton, but **always rewrite to use POMs and Patterns A–E** before committing — codegen output uses raw selectors, which is forbidden in spec files (see [Page Object Model Conventions](#page-object-model-conventions)).

### View the HTML Report

```bash
npm run e2e:report
```

Opens the most recent HTML report from `playwright-report/`. The report is also generated automatically in CI and uploaded as a build artifact.

### Cross-Browser Execution

The Playwright project matrix includes three cross-browser variants for Tier 2 and three for Tier 3:

```bash
# Tier 2 in Firefox
npx playwright test --project=feature-crud-firefox

# Tier 2 in WebKit (Safari engine)
npx playwright test --project=feature-crud-webkit

# Tier 3 in Firefox
npx playwright test --project=integration-firefox

# Tier 3 in WebKit
npx playwright test --project=integration-webkit
```

These projects run only in nightly cross-browser workflows by default (the PR-gate workflows pin to Chromium for speed).

### Live-API Mode

```bash
E2E_API_MODE=live \
  E2E_BASE_URL=https://staging.whoville.example.internal \
  npx playwright test --project=integration
```

Bypasses every `page.route('**/api/**', …)` interceptor. The suite calls the real backend at `E2E_BASE_URL`. Use this only for the periodic contract-validation lane — typically the nightly `e2e-live-api-nightly.yml` workflow. Live mode requires VPN/network connectivity to the staging cluster and valid `E2E_TEST_USER_*` credentials. See [Mocking and Live-API Mode](#mocking-and-live-api-mode) for details.

### Sharding Across CI Runners

```bash
# Split work across 4 runners
npx playwright test --shard=1/4    # runner 1
npx playwright test --shard=2/4    # runner 2
npx playwright test --shard=3/4    # runner 3
npx playwright test --shard=4/4    # runner 4
```

Built into Playwright. The CI workflows in `.github/workflows/e2e-tier-*.yml` use this to bring Tier 2 wall time below the budget.

### Type-Check the Suite Without Running It

```bash
npm run e2e:typecheck
```

Runs `tsc --noEmit -p tsconfig.e2e.json`. Catches type errors and unused imports before a long test run.

### Lint and Format

```bash
npm run lint:e2e            # ESLint with the Playwright plugin
npm run format:e2e          # Prettier (writes changes)
npm run format:e2e:check    # Prettier (CI-style check, exits non-zero on diff)
```

The ESLint configuration enforces the locator preference order and bans raw selectors in spec files. See [Page Object Model Conventions](#page-object-model-conventions).

---

## Adding a New Entity

This section is the **binding contract** for adding a new entity to the test surface. The user-emphasized directive is that adding a new tested entity must require only authoring a configuration object — not new test logic. The Patterns A–E templates in `e2e/patterns/` exist precisely for this purpose.

> If you find yourself authoring custom `test()` blocks for a new entity that look like the existing tests for another entity, **stop**. You should be instantiating one of the five pattern templates with a typed `EntityConfig<T>` object. Custom test code for a new entity is rejected at code review unless explicitly justified in the PR description and approved as an architectural exception.

### The Five Patterns at a Glance

| Pattern | When to Use                         | Config Type                | Typical Spec Location                                                   |
| ------- | ----------------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| **A**   | Login / logout / session flows      | `AuthPatternConfig`        | `e2e/specs/smoke/02-authentication.smoke.spec.ts`                       |
| **B**   | List view + drill-into-detail       | `EntityConfig<T>`          | `e2e/specs/feature-crud/<module>/<entity>-list.crud.spec.ts`            |
| **C**   | Create / Edit forms                 | `FormPatternConfig<T>`     | `e2e/specs/feature-crud/<module>/<entity>-{create,edit}.crud.spec.ts`   |
| **D**   | Search bars and filter sidebars     | `SearchPatternConfig<T>`   | `e2e/specs/feature-crud/<module>/<entity>-search.crud.spec.ts`          |
| **E**   | Multi-step wizards and bulk actions | `WorkflowPatternConfig<T>` | `e2e/specs/feature-crud/<module>/<entity>-{bulk,approval}.crud.spec.ts` |

### Pattern A — Authentication

**Use for:** login, logout, post-login redirect, session expiration.

**Config shape:** `AuthPatternConfig` — login URL, success-indicator selector, valid-credentials object, invalid-credentials object, expected error-banner selector and message.

**Spec location:** `e2e/specs/smoke/02-authentication.smoke.spec.ts`. Pattern A is invoked exactly once for the canonical login form; per-role variations are tested via `storageState` reuse rather than additional Pattern A invocations.

**Worked example skeleton:**

```typescript
// e2e/specs/smoke/02-authentication.smoke.spec.ts
import { test } from '@fixtures';
import { runAuthPattern } from '@patterns';
import { LoginPage } from '@pages/app-shell/login.page';

runAuthPattern(test, {
  pageObject: LoginPage,
  loginUrl: '/login',
  successIndicator: { role: 'navigation', name: 'Main' },
  validCredentials: {
    username: process.env.E2E_TEST_USER_USERNAME!,
    password: process.env.E2E_TEST_USER_PASSWORD!,
  },
  invalidCredentials: {
    username: 'wrong.user@example',
    password: 'wrong-password',
  },
  expectedErrorMessage: /invalid credentials/i,
});
```

### Pattern B — List/Detail

**Use for:** any list view that offers pagination, sorting, filtering, or row-click drill-down to a detail view.

**Config shape:** `EntityConfig<T>` — list URL, row selector, pagination control selectors, detail URL pattern (with `:id` placeholder), expected column headers, expected detail-page landmark.

**Spec location:** `e2e/specs/feature-crud/<module>/<entity>-list.crud.spec.ts`.

**Worked example — adding a hypothetical "Project" entity:**

```typescript
// e2e/specs/feature-crud/workforce/project-list.crud.spec.ts
import { test } from '@fixtures';
import { runListDetailPattern } from '@patterns';
import { ProjectListPage } from '@pages/workforce/project-list.page';
import { ProjectDetailPage } from '@pages/workforce/project-detail.page';
import { projectFactory } from '@factories';

runListDetailPattern(test, {
  entityName: 'Project',
  listPageObject: ProjectListPage,
  detailPageObject: ProjectDetailPage,
  listUrl: '/workforce/projects',
  detailUrlPattern: '/workforce/projects/:id',
  factory: projectFactory,
  expectedColumns: ['Name', 'Status', 'Owner', 'Updated'],
  paginationPageSize: 25,
  defaultSortColumn: 'Updated',
  defaultSortDirection: 'desc',
});
```

This single config emits the canonical 8-test scenario set: empty-list state, populated rows, pagination next/prev, sort toggle, filter narrowing, row click → detail navigation, detail-page landmark assertion, breadcrumb back-navigation.

### Pattern C — Form CRUD

**Use for:** Create and Edit forms across all modules. Pattern C is invoked twice per entity (once for create, once for edit) because the field set is the same but the success-redirect and pre-fill behaviors differ.

**Config shape:** `FormPatternConfig<T>` — form URL, field map keyed by `data-testid` (with per-field validators: required, format, min/max length, allowed characters), submit-button selector, cancel-button selector, success-redirect URL pattern.

**Spec location:** `<entity>-create.crud.spec.ts` and `<entity>-edit.crud.spec.ts` under the entity's module directory.

**Worked example — Create form for Project:**

```typescript
// e2e/specs/feature-crud/workforce/project-create.crud.spec.ts
import { test } from '@fixtures';
import { runFormCrudPattern } from '@patterns';
import { ProjectFormPage } from '@pages/workforce/project-form.page';
import { projectFactory } from '@factories';

runFormCrudPattern(test, {
  mode: 'create',
  formPageObject: ProjectFormPage,
  formUrl: '/workforce/projects/new',
  successRedirectPattern: /\/workforce\/projects\/[a-f0-9-]+$/,
  factory: projectFactory,
  fields: {
    name: { required: true, maxLength: 100, allowedChars: /^[\w\s-]+$/ },
    description: { required: false, maxLength: 500 },
    ownerEmail: { required: true, format: 'email' },
    startDate: { required: true, format: 'iso-date' },
    budget: { required: false, format: 'positive-integer' },
  },
});
```

Pattern C emits per-field required-omission tests, per-field format-violation tests, max-length boundary tests, server-error display tests, and the happy-path submit test.

### Pattern D — Search/Filter

**Use for:** keyword search bars (with or without debounce), filter sidebars (chip/checkbox), saved-search dropdowns.

**Config shape:** `SearchPatternConfig<T>` — search-box selector, filter-chip selectors, debounce time (ms), expected result-row selector, dataset for zero-result/single-result/many-result scenarios.

**Spec location:** `<entity>-search.crud.spec.ts`.

**Worked example:**

```typescript
// e2e/specs/feature-crud/workforce/project-search.crud.spec.ts
import { test } from '@fixtures';
import { runSearchFilterPattern } from '@patterns';
import { ProjectListPage } from '@pages/workforce/project-list.page';

runSearchFilterPattern(test, {
  listPageObject: ProjectListPage,
  listUrl: '/workforce/projects',
  searchDebounceMs: 300,
  filters: [
    { name: 'Status', values: ['Active', 'On Hold', 'Completed', 'Cancelled'] },
    { name: 'Owner', values: ['me', 'team', 'org'] },
  ],
  scenarios: {
    zeroResults: { keyword: 'zzzz-no-such-project-zzzz' },
    singleResult: { keyword: 'unique-fixture-marker' },
    manyResults: { keyword: 'project' },
    specialChars: { keyword: "O'Brien & Sons (2024) — α/β" },
    unicode: { keyword: '日本語テスト' },
  },
});
```

### Pattern E — Bulk Operations / Workflow

**Use for:** multi-step wizards (with back/forward and per-step validation), bulk actions on a list (select-all + bulk delete / update / approve), approval workflows.

**Config shape:** `WorkflowPatternConfig<T>` — ordered step list (each step contains its own field map and validators), bulk-action selectors, partial-failure UX selectors, cancel/abort selectors.

**Spec location:** `<entity>-bulk.crud.spec.ts` for bulk operations; `<entity>-approval.crud.spec.ts` for approval workflows.

**Worked example — multi-step Project approval wizard:**

```typescript
// e2e/specs/feature-crud/workforce/project-approval.crud.spec.ts
import { test } from '@fixtures';
import { runWorkflowPattern } from '@patterns';
import { ProjectApprovalPage } from '@pages/workforce/project-approval.page';

runWorkflowPattern(test, {
  workflowName: 'Project Approval',
  pageObject: ProjectApprovalPage,
  startUrl: '/workforce/projects/:id/approval',
  steps: [
    { name: 'Review', fields: { reviewerComment: { required: true, maxLength: 1000 } } },
    { name: 'Risk', fields: { riskLevel: { required: true, oneOf: ['Low', 'Medium', 'High'] } } },
    { name: 'Sign-off', fields: { signature: { required: true } } },
  ],
  bulkAction: {
    selectionStrategy: 'select-all-on-page',
    actionLabel: 'Approve selected',
    confirmDialogText: /approve [0-9]+ project/i,
    partialFailureSelector: '[data-testid="bulk-action-error-row"]',
  },
});
```

### Checklist for Adding a New Entity

When you add a new entity (whether a brand-new module or a new resource within an existing module), complete every step:

- [ ] Add the new route(s) to [`e2e/utils/route-inventory.ts`](utils/route-inventory.ts). The route-coverage report (`npm run e2e:validate-routes`) fails CI if any route is missing.
- [ ] Create the POM(s) under `e2e/pages/<module>/<entity>.page.ts`. Extend `BasePage`. Selectors are private; user actions are public async methods. See [Page Object Model Conventions](#page-object-model-conventions).
- [ ] Create the factory under `e2e/factories/<entity>.factory.ts`. Use `@faker-js/faker` and seed deterministically. Factory-created entity names must be UUID-suffixed for parallel-worker isolation.
- [ ] Add canned API responses under `e2e/fixtures/api-responses/<module>/<entity>-*.json`. At minimum: `<entity>-list.json`, `<entity>-detail.json`. Include error-injection variants (`<entity>-422.json`, `<entity>-500.json`) where the spec exercises them.
- [ ] Add a mock-handler entry in `e2e/mocks/handlers/<module>.handler.ts` so `page.route('**/api/<scope>/**', …)` routes new requests to your fixtures.
- [ ] Author the spec file(s) using one of Patterns A–E with a typed config object. Do not write raw `test()` blocks.
- [ ] Run the new spec locally: `npx playwright test e2e/specs/feature-crud/<module>/<entity>-list.crud.spec.ts`.
- [ ] Run the route-coverage report: `npm run e2e:coverage-report` and verify the new route is reflected as covered in `e2e-coverage.html`.

---

## Mocking and Live-API Mode

The suite is **mocked by default** — every `**/api/**` request is intercepted by `page.route()` handlers backed by JSON fixtures. Live mode is opt-in via the `E2E_API_MODE` environment variable.

### How Mocking Works

When `E2E_API_MODE=mock` (the default) and `MOCK_API=true` (the default):

1. `e2e/global-setup.ts` reads the `MOCK_API`/`E2E_API_MODE` env vars and warms the JSON fixture cache by parse-validating every file under `e2e/fixtures/api-responses/`.
2. `e2e/fixtures/mock-api.fixture.ts` registers `page.route('**/api/**', …)` for every test that depends on the `mockApi` fixture.
3. The central dispatcher in `e2e/mocks/api-router.ts` matches the request URL to a per-scope handler in `e2e/mocks/handlers/`.
4. The handler returns a fulfillment built from a JSON fixture, optionally wrapped by `latencyInjector` or `errorInjector` for Tier 3 timing/failure scenarios.

### Adding a New Mock Handler

For a new endpoint within an existing module:

1. Open `e2e/mocks/handlers/<module>.handler.ts`.
2. Add a route-pattern entry that maps the URL glob to either a static JSON fixture path or a dynamic factory call.
3. Add the corresponding fixture JSON under `e2e/fixtures/api-responses/<module>/`.
4. Run the spec that depends on the new endpoint — Playwright's `page.route()` logging will confirm the handler is hit.

For a brand-new module:

1. Create `e2e/mocks/handlers/<new-module>.handler.ts` modeled after an existing module's handler.
2. Register it in `e2e/mocks/handlers/index.ts` so the central dispatcher picks it up.
3. Create `e2e/fixtures/api-responses/<new-module>/` and seed canonical responses (list, detail, error variants).

### Per-Test Override

Sometimes a single test needs to override the default mock — for example, to assert error-handling UX. Use the `mockApi.intercept()` helper:

```typescript
import { test, expect } from '@fixtures';

test('Project create form shows server-side validation error', async ({ page, mockApi }) => {
  // Override just this test's POST /api/workforce/projects to return 422
  await mockApi.intercept('POST /api/workforce/projects', {
    status: 422,
    body: { errors: { name: 'Project name already exists' } },
  });

  await page.goto('/workforce/projects/new');
  // ... fill form, submit, assert inline error appears
});
```

The override applies only for the lifetime of the test; it does not leak across tests because each test has its own `BrowserContext`.

### Latency and Error Injection

Tier 3 timing tests use the `latencyInjector` wrapper to delay specific responses:

```typescript
await mockApi.intercept('GET /api/workforce/projects', {
  body: longList,
  latencyMs: 2_500, // Simulates a 2.5-second backend delay
});
```

Error injection wraps a handler with a configurable HTTP status:

```typescript
await mockApi.intercept('GET /api/workforce/projects', {
  errorRate: 1.0, // 100% — always errors
  errorStatus: 500,
  errorBody: '{"error":"Database unreachable"}',
});
```

### Opting Into Live-API Mode

Live mode is the periodic contract-validation lane. It runs nightly via `.github/workflows/e2e-live-api-nightly.yml` and exists to detect drift between the JSON fixtures and the real backend.

```bash
E2E_API_MODE=live \
  E2E_BASE_URL=https://staging.whoville.example.internal \
  E2E_TEST_USER_USERNAME=service-account@whoville.example.internal \
  E2E_TEST_USER_PASSWORD="$LIVE_API_PASSWORD" \
  npx playwright test --project=integration
```

In live mode:

- All `page.route('**/api/**', …)` registrations are skipped by `mock-api.fixture.ts`.
- Factories generate real entities via real POSTs — entity names are prefixed with `e2e-test-` for the live-mode cleanup sweep.
- `e2e/global-teardown.ts` invokes `e2e/utils/test-data-cleanup.ts` to delete any orphaned `e2e-test-*` entities at suite end.
- A separate scheduled workflow (`e2e-nightly-cleanup.yml`) sweeps any test entities that survived a crashed run.

> **Schedule a quarterly contract-validation run.** Even with the nightly live-API lane, fixtures drift over time. Run a full Tier 3 in live mode every quarter and update any fixture that the live-mode run reveals as stale. The mock-vs-live diff is the canonical source of "API contract changed" awareness.

---

## Page Object Model Conventions

The Page Object Model (POM) is the architectural seam that isolates _what the page looks like_ from _what the test asserts_. **Every selector lives in a POM class. Spec files contain zero raw selectors.** This is enforced by ESLint, by code review, and by the route-coverage report.

### Locator Preference Order

When choosing how to find an element in a POM, prefer locators in this order. Drop to a lower-priority option only when the higher-priority option is genuinely unavailable, and add an inline comment explaining why:

1. **`page.getByRole(...)`** — accessibility-tree role + accessible name. The most stable locator across framework upgrades because it depends on ARIA semantics, not Angular's CSS class output.
2. **`page.getByLabel(...)`** — form labels. Stable for inputs, selects, and checkboxes that have proper `<label>` associations.
3. **`page.getByText(...)`** — visible text. Use sparingly for elements without role or label; pair with a regex when text may be partially translated or pluralized.
4. **`page.getByTestId(...)`** — `data-testid` attribute. Use **only** when ARIA semantics are insufficient to disambiguate. `data-testid` is added to the Whoville-Client templates as a small, reviewable change in a separate PR.
5. **`page.locator('css=...')` / CSS selectors** — last resort. Each occurrence requires an inline justification comment, and reviewers should push back on every one.

### POM Class Structure

```typescript
// e2e/pages/workforce/team-form.page.ts
import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from '@pages/base.page';

export class TeamFormPage extends BasePage {
  // Selectors are private — only POM methods touch them.
  private readonly nameInput: Locator;
  private readonly descriptionInput: Locator;
  private readonly submitButton: Locator;
  private readonly cancelButton: Locator;
  private readonly errorBanner: Locator;

  constructor(page: Page) {
    super(page);
    this.nameInput = page.getByLabel('Team name');
    this.descriptionInput = page.getByLabel('Description');
    this.submitButton = page.getByRole('button', { name: 'Save team' });
    this.cancelButton = page.getByRole('button', { name: 'Cancel' });
    this.errorBanner = page.getByRole('alert');
  }

  // User-facing actions are public, async, and verb-first.
  async createTeam(input: { name: string; description?: string }): Promise<void> {
    await this.nameInput.fill(input.name);
    if (input.description) {
      await this.descriptionInput.fill(input.description);
    }
    await this.submitButton.click();
  }

  async cancel(): Promise<void> {
    await this.cancelButton.click();
  }

  // Web-first assertion helpers also live on the POM.
  async expectErrorBanner(message: string | RegExp): Promise<void> {
    await expect(this.errorBanner).toBeVisible();
    await expect(this.errorBanner).toContainText(message);
  }
}
```

### POM Naming and Structure Rules

| Rule                            | Detail                                                                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| File name                       | `<scope>.page.ts` — kebab-case, ends with `.page.ts`. Example: `team-form.page.ts`.                                    |
| Class name                      | `PascalCase` — example: `TeamFormPage`. Always ends with `Page`.                                                       |
| Base class                      | All concrete POMs `extends BasePage` (defined in [`e2e/pages/base.page.ts`](pages/base.page.ts)).                      |
| Selector visibility             | `private readonly` — selectors must not leak out of the POM.                                                           |
| Method naming                   | `camelCase` — descriptive verb-first names: `createTeam`, `selectAllRows`, `expectErrorBanner`.                        |
| Method return type              | Always `Promise<void>` for actions; `Promise<<TypedResult>>` for queries. Never `void` (Playwright methods are async). |
| One POM per major page or route | If a route has tabs/dialogs that change the URL or visible landmark, make those sub-POMs.                              |
| Barrel exports                  | Each module directory has an `index.ts` that re-exports its POMs. Specs import from the barrel, not the file path.     |

---

## Test Authoring Conventions

The conventions below are enforced by ESLint, Prettier, and code review. They keep the suite legible across hundreds of files and migration-proof across Angular major versions.

### File Naming

| Tier                 | Filename pattern        | Example                                   |
| -------------------- | ----------------------- | ----------------------------------------- |
| Tier 1 — Smoke       | `<scope>.smoke.spec.ts` | `02-authentication.smoke.spec.ts`         |
| Tier 2 — CRUD        | `<scope>.crud.spec.ts`  | `team-create.crud.spec.ts`                |
| Tier 3 — Integration | `<scope>.int.spec.ts`   | `04-network-failure-recovery.int.spec.ts` |

The numeric prefix on smoke and integration specs (`01-`, `02-`, …) gives a stable execution order and makes the spec list deterministic in HTML reports. CRUD specs do not need numeric prefixes because they are entity-keyed.

### Test Description Style

Use the convention `'<entity> <action> <expected outcome>'`:

```typescript
test('Team form submits with valid data', ...);
test('Team form shows required-field error when name is empty', ...);
test('Team list paginates to page 2', ...);
test('Project approval wizard advances after Risk step is filled', ...);
```

Avoid:

- `'should ...'` — redundant; every test "should" do something.
- `'test 1', 'test 2'` — opaque.
- Descriptions that name the implementation (`'TeamFormComponent.onSubmit()'`) — those break under Angular refactors.

### Imports — Use Path Aliases

Always import via the path aliases declared in [`tsconfig.e2e.json`](../tsconfig.e2e.json):

```typescript
// ✅ Good
import { test, expect } from '@fixtures';
import { TeamListPage } from '@pages/workforce';
import { teamFactory } from '@factories';
import { ROUTES } from '@utils/route-inventory';

// ❌ Bad — banned by ESLint
import { test, expect } from '@playwright/test'; // Use @fixtures
import { TeamListPage } from '../../pages/workforce/team-list.page'; // Use the alias
import { TeamComponent } from 'src/app/workforce/team'; // Application source — forbidden
```

The aliases are: `@e2e/*`, `@pages/*`, `@fixtures/*`, `@factories/*`, `@mocks/*`, `@patterns/*`, `@utils/*`.

### Web-First Assertions

Always use Playwright's web-first assertions, which auto-wait for the condition to become true:

```typescript
// ✅ Good — auto-waits
await expect(locator).toBeVisible();
await expect(locator).toContainText('Saved successfully');
await expect(page).toHaveURL(/\/workforce\/teams\/[a-f0-9-]+$/);

// ❌ Bad — racy, banned by ESLint
expect(await locator.isVisible()).toBe(true);
expect(await locator.textContent()).toContain('Saved successfully');
expect(page.url()).toMatch(/\/workforce\/teams\/[a-f0-9-]+$/);
```

### No Hard Waits

`page.waitForTimeout()` is **forbidden** in spec files and POMs. The only sanctioned use is inside `latency-injector.ts` to simulate backend latency in mocks. Use auto-waiting locators instead.

### One Concept per Test

Each `test()` block asserts one user-observable outcome. Multi-assertion tests are fine (e.g., a happy-path scenario asserts both navigation and toast), but a single test must not exercise two unrelated scenarios.

### Test Isolation

Tests do not share mutable state. The default Playwright `BrowserContext` is per-test, which gives you fresh cookies, localStorage, sessionStorage, and IndexedDB. Factory-created entities use UUID-suffixed names so two parallel workers do not collide on a shared identifier.

### `test.describe.configure({ mode: 'serial' })` Is Restricted

Serial mode forces a `describe` block to run on a single worker. Use it only when:

1. The block exercises a stateful workflow that genuinely requires step ordering (e.g., approval workflow).
2. You add a code comment explaining the constraint and linking back to this README.

If you find yourself reaching for serial mode to mask a flake, fix the flake instead — the most common cause is shared mutable test state, which the factory pattern is designed to prevent.

### Tagging and Filtering

Use `test.skip` and `test.fixme` sparingly and always with a descriptive reason and a tracking ticket reference:

```typescript
// ❌ Bad — opaque skip
test.skip('Team detail loads', ...);

// ✅ Good — explicit reason and ticket reference
test.skip('Team detail loads — flaky on Firefox under WHO-1234, fix-in-progress', ...);
```

`test.only` is forbidden in committed code (the ESLint `playwright/no-focused-test` rule fails the build if it leaks in).

---

## Troubleshooting

The most common issues, in roughly the order new contributors hit them.

### Browser Binary Not Found

**Symptom:** `Error: browserType.launch: Executable doesn't exist at /home/.../ms-playwright/chromium-<revision>/chrome-linux/chrome` (where `<revision>` is a numeric identifier such as `1217`).

**Resolution:**

```bash
npm run e2e:install-browsers
```

This invokes `playwright install --with-deps`, which downloads the bundled browser revisions and (with `--with-deps`) installs the matching OS-level shared libraries via `apt`/`brew`. Re-run after every Playwright version bump.

### Dev Server Not Reachable

**Symptom:** Every test times out at `page.goto('/')` with `Error: net::ERR_CONNECTION_REFUSED`.

**Resolution:**

1. Confirm the Angular dev server is running: `curl -sI http://localhost:4200`.
2. Confirm `E2E_BASE_URL` matches the dev-server port in `.env.e2e`.
3. Check for port conflicts with `lsof -i :4200`.
4. If you start the dev server via `npm run start:e2e`, the placeholder script intentionally exits with status 1 until the Whoville-Client app is committed. Override it locally to invoke `ng serve --configuration=e2e --port=4200`.

### Storage State Generation Failing

**Symptom:** `e2e/global-setup.ts` errors during the per-role login flow with "credential validation failed" or writes a zero-byte JSON.

**Resolution:**

1. Verify `E2E_TEST_USER_USERNAME` and `E2E_TEST_USER_PASSWORD` are set in `.env.e2e`. Confirm the password is not the placeholder `replace-with-real-password` from the template.
2. Run the standalone generator: `npm run e2e:generate-storage-states`.
3. Manually inspect the generated file: `jq . e2e/storage-states/canonical-user.json` — it should contain a non-empty `cookies` array and `origins` entries.
4. Clean and regenerate: `npm run e2e:cleanup-storage-states && npm run e2e:generate-storage-states`.

### Tests Pass Locally But Fail in CI

**Symptom:** A spec is green every time on your laptop but red intermittently in CI.

**Common causes and fixes:**

- **Timing.** CI runners are slower than developer laptops. Increase `actionTimeout` (default 10s) or `navigationTimeout` (default 30s) in [`playwright.config.ts`](../playwright.config.ts).
- **Race with `webServer` startup.** The first test runs before the dev server is ready. Add `wait-on http://127.0.0.1:4200` between `npm run start:e2e &` and `npx playwright test` in the workflow.
- **Worker count differs.** Locally you may default to 1 worker; CI defaults to 50%. Reproduce with `npx playwright test --workers=4` locally.
- **Locale or time zone.** [`playwright.config.ts`](../playwright.config.ts) pins `locale: 'en-US'` and `timezoneId: 'America/New_York'`; if a test depends on local-machine settings, it will fail in CI. Always honor the configured locale and time zone in assertions.
- **Headless-only bug.** Toggle `--headed` locally to see the browser. Sometimes a hover-dependent flow only fails in headless mode.

### Flaky Test Detection

**Symptom:** A test passes ~95% of the time and fails ~5% with no apparent cause.

**Resolution:**

1. Run `npm run e2e:flake-report` to identify tests with retry rate > 1% over the last 30 days.
2. The most common root causes (in order of frequency):
   - **CSS-based locator drift** — refactor to `getByRole`/`getByLabel`/`getByTestId`.
   - **Race between API mock and UI render** — make the assertion auto-wait via `expect(locator).toBeVisible()` rather than `expect(await locator.count())`.
   - **Shared mutable state** — make the entity name UUID-suffixed via the factory; do not hard-code a name across tests.
   - **Animation timing** — add `await expect(locator).toBeStable()` before the assertion.
3. If the underlying cause cannot be fixed immediately, gate the test behind a retry count of 1 or 2 in the project config — but file a ticket and fix the root cause; retries are a band-aid, not a remedy.

### Mock Drift From Real API

**Symptom:** Mocked tests pass; live-API nightly run fails on the same scenarios.

**Resolution:**

1. Run a Tier 3 live-API session locally:
   ```bash
   E2E_API_MODE=live \
     E2E_BASE_URL=https://staging.whoville.example.internal \
     npx playwright test --project=integration
   ```
2. Inspect the failing requests in the trace viewer — the response body or status code has likely diverged.
3. Update the relevant fixture under `e2e/fixtures/api-responses/<module>/`.
4. Re-run mock-mode to confirm the updated fixture still passes.
5. Schedule a quarterly contract-validation run as a calendar event so this drift is caught proactively, not reactively.

### Trace Viewer Not Opening

**Symptom:** `npx playwright show-trace ...` opens a browser window with "Cannot load trace" or hangs.

**Resolution:**

```bash
# Make sure the trace.zip path is correct (relative or absolute)
ls test-results/*/trace.zip

# Open it explicitly
npx playwright show-trace test-results/<spec-name>-<test-name>-chromium/trace.zip

# Alternative: drag the trace.zip into https://trace.playwright.dev
```

If the trace.zip is missing, the test did not retry (traces are captured `on-first-retry` by default). Re-run the failing test with `--trace=on` to force trace capture every run:

```bash
npx playwright test e2e/specs/integration/04-network-failure-recovery.int.spec.ts --trace=on
```

### `test.only` Slipped Into a Commit

**Symptom:** CI fails immediately with `Error: forbid-only is enabled in the playwright config`.

**Resolution:** Search and remove every `.only`:

```bash
git grep -nE "test\.only|describe\.only|test\.fixme\.only" e2e/
```

The `forbidOnly: isCI` setting in [`playwright.config.ts`](../playwright.config.ts) and the `playwright/no-focused-test` ESLint rule both gate against this; the rule should catch it during `npm run lint:e2e` before commit.

### `start:e2e` Placeholder Exits Immediately

**Symptom:** `npm run start:e2e` prints a warning about being a placeholder and exits with status 1.

**Resolution:** This is intentional. The Whoville-Client Angular dev server is not committed in this documentation-locus repository (per AAP §0.8.2). When integrating into the actual Whoville-Client repository, replace `package.json` `scripts.start:e2e` with the real Angular invocation, e.g.:

```json
"start:e2e": "ng serve --configuration=e2e --port=4200"
```

Also enable the `webServer` block in `playwright.config.ts` (currently commented out for the same reason) so Playwright auto-starts the dev server before the suite.

---

## Migration-Proofing Notes

The suite exists to make the Angular 11→21 migration safe. Every architectural decision below is in service of that goal: a test that fails after an Angular major-version bump should be either _intentionally_ failing (because the user-visible behavior actually changed) or _easy_ to fix at the framework seam — never _broken_ at the spec level by the migration itself.

### Why Selectors Prefer Accessibility Primitives

`page.getByRole('button', { name: 'Save team' })` keeps working when Angular changes the generated CSS class from `mat-mdc-button-base` to `mdc-button-base` to `cdk-button-v3`. `page.locator('.mat-mdc-button-base')` does not.

Accessibility roles are defined by ARIA, not by Angular. They are anchored to the user-facing semantic, which is the contract the migration must preserve. CSS class names, by contrast, are an implementation detail of whichever Angular Material / CDK / Tailwind / custom theme version the app currently uses — they are not a contract and are expected to churn.

The same logic applies to text-based and label-based locators. They depend on user-visible content, not on the underlying component library. Test IDs (`data-testid`) are a deliberate fallback for when no semantic primitive disambiguates; they too are stable across migrations because they are explicit attributes the developers control.

### Why Mocks Abstract Over HTTP API Contracts

The Whoville-Client backend services (Authentication, Workforce, Assessments, Competencies, Authorization) migrate on a different cadence from the Angular front end. The HTTP API contract — paths, methods, request/response shapes — changes far less frequently than the UI implementation.

By mocking at the HTTP layer (via `page.route('**/api/**', …)`) rather than at the Angular `HttpClient` layer, the suite becomes immune to changes in:

- The HTTP client library Angular uses internally.
- The Angular `HttpInterceptor` chain.
- The injection token graph.
- Any `Observable`-vs-`Promise` plumbing.

When the Angular major version changes, the HTTP requests still go out the wire in the same shape, so the mocks still match. The only thing that needs to be re-validated is the user-facing rendering behavior, which is what the suite is intentionally exercising.

### The Defensive `waitForAngular` Shim

A `waitForAngular(page)` helper is provided at [`e2e/utils/wait-for-angular.ts`](utils/wait-for-angular.ts) for the rare edge cases where Playwright's auto-waiting locators are not enough — typically before screenshot capture during heavy zone activity in Angular 11.

**Use it sparingly.** Playwright's auto-waiting handles 99% of stability needs, and Angular's testability hooks are slated for change as zone.js evolves through Angular 12-21 (Angular 18 introduces the option of zoneless change detection). Every call site of `waitForAngular` becomes a candidate for revisit during migration; minimize the count.

### Pre-Migration Rehearsal

Before any Angular major-version migration PR (e.g., the eventual `ng update @angular/core@12 @angular/cli@12`), execute the following rehearsal:

1. **Baseline.** On the pre-migration `main` branch, run the full suite and capture pass rate, flake rate, and runtime per tier:
   ```bash
   npm run e2e
   npm run e2e:flake-report
   ```
2. **Migrate.** Apply the Angular update on a feature branch. Do **not** modify the E2E suite during the update.
3. **Rehearse.** On the post-migration branch, run the full suite again:
   ```bash
   npm run e2e
   ```
4. **Triage.** For every failing test, classify the failure:
   - **Real regression.** The migration broke a user-facing behavior. The migration PR must include the application-side fix.
   - **Selector drift.** Angular changed a generated CSS class or DOM structure. The fix is in the POM (one selector, one line) — not in the spec.
   - **Mock drift.** The migration changed the HTTP request shape (rare; usually not migration-driven). Update the mock handler.
   - **Infrastructure.** Node version, Playwright version, or browser-binary mismatch. Reconcile to the lock-step pin.
5. **Compare flake rate.** A material increase in flake rate is a smoke signal that the migration introduced async timing changes. Investigate before merging.

### Where to Look First When a Test Fails After an Upgrade

| Failure pattern                                      | Most likely cause                   | Where to fix                                                                       |
| ---------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| `Locator not found`                                  | CSS class name changed              | The POM file                                                                       |
| `Locator resolved to N elements`                     | DOM structure changed               | The POM file                                                                       |
| `Timeout exceeded waiting for...`                    | Async timing changed                | Use `expect(...).toBeVisible()` web-first; check for new spinner state             |
| `Expected: <text>, Received: <different text>`       | User-visible string changed         | Either the spec assertion (if intentional) or the migration itself (if regression) |
| `page.goto: net::ERR_*`                              | Routing changed                     | Update [`route-inventory.ts`](utils/route-inventory.ts) and the spec               |
| `route() not matching`                               | API contract changed                | Update the mock handler under `e2e/mocks/handlers/<module>.handler.ts`             |
| Trace shows zone.js stack overflow / detection cycle | Angular change detection regression | File a ticket against the migration; the test is correctly flagging a regression   |

---

## Coverage and Reporting

E2E coverage is **route coverage** and **scenario coverage**, not source-line coverage. The suite never instruments application source code; it measures coverage by reconciling the spec inventory against [`e2e/utils/route-inventory.ts`](utils/route-inventory.ts).

### Route Coverage Report

```bash
npm run e2e:coverage-report
```

Reads [`e2e/utils/route-inventory.ts`](utils/route-inventory.ts) and every spec file under `e2e/specs/`, then emits `e2e-coverage.html` in the repository root. The report lists each route with the spec(s) that cover it (Tier 1 / 2 / 3 column-tagged).

### Route Validation (CI Gate)

```bash
npm run e2e:validate-routes
```

Same logic as the coverage report, but exits non-zero if any route in the inventory lacks a covering spec or any spec covers a route not in the inventory. CI workflows run this as a gating step before the suite executes — catching dead specs and orphaned routes before they cost test runtime.

### Flake Detection

```bash
npm run e2e:flake-report
```

Reads `test-results/*.json` from the last 30 days and emits a per-test flake-rate report. Tests with a retry rate > 1% are flagged for refactor.

### Multi-Tier Report Merge

```bash
npm run e2e:merge-tier-reports
```

Merges the HTML reports from all three tiers into a single combined report. CI uploads this combined report as a build artifact for review.

### HTML Report

```bash
npm run e2e:report
```

Opens the most recent HTML report. Each test entry links to its trace, video, and screenshot artifacts. The report is also generated automatically in CI and uploaded as `playwright-report/` artifact.

### Per-Tier Coverage Targets

| Metric                     | Target                              | Enforcement                                                                                           |
| -------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Route presence (Tier 1)    | 100% of ~163 routes                 | Route-coverage report fails CI if any route is uncovered                                              |
| CRUD coverage (Tier 2)     | 100% of CRUD-eligible entities      | Static check: each entity directory has `<entity>-list/create/edit/delete/detail/search.crud.spec.ts` |
| RBAC denial paths (Tier 3) | ≥1 denial test per restricted route | `e2e/specs/integration/03-rbac-denial-paths.int.spec.ts`                                              |
| Cross-browser nightly      | Chromium + Firefox + WebKit         | `.github/workflows/e2e-cross-browser-nightly.yml`                                                     |
| Flake rate                 | < 1%                                | `e2e/scripts/flake-detector.ts`                                                                       |
| Tier 1 runtime             | ≤ 3 minutes                         | `e2e-tier-1-smoke.yml` `timeout-minutes: 5`                                                           |
| Tier 2 runtime             | ≤ 15 minutes                        | `e2e-tier-2-crud.yml` `timeout-minutes: 25`                                                           |
| Tier 3 runtime             | ≤ 25 minutes                        | `e2e-tier-3-integration.yml` `timeout-minutes: 35`                                                    |

---

## CI/CD Integration

CI is a first-class deliverable. The E2E suite ships with both GitHub Actions and Azure DevOps pipelines so the suite plugs into either CI substrate without rework.

### GitHub Actions Workflows

All workflows live under `.github/workflows/` and share a composite setup action at `.github/actions/setup-playwright/action.yml` for consistent Node + Playwright + browser install across jobs.

| Workflow                                          | Trigger                         | Tier(s)         | Wall time |
| ------------------------------------------------- | ------------------------------- | --------------- | --------- |
| `.github/workflows/e2e-tier-1-smoke.yml`          | Every push, every PR            | Tier 1          | ~5 min    |
| `.github/workflows/e2e-tier-2-crud.yml`           | Every PR (gated on Tier 1)      | Tier 2          | ~20 min   |
| `.github/workflows/e2e-tier-3-integration.yml`    | Nightly + pre-release tag       | Tier 3          | ~30 min   |
| `.github/workflows/e2e-cross-browser-nightly.yml` | Nightly schedule                | Tier 2 + Tier 3 | ~60 min   |
| `.github/workflows/e2e-live-api-nightly.yml`      | Nightly schedule (live backend) | Tier 3          | ~30 min   |

Each workflow:

1. Checks out the repo and sets up Node 20.x via the composite setup action.
2. Restores `~/.cache/ms-playwright/` from the actions cache.
3. Runs `npm ci` and `npx playwright install --with-deps`.
4. Starts the dev server (or the e2e build) and `wait-on`s the base URL.
5. Runs the appropriate `npm run e2e:*` script.
6. Uploads `playwright-report/`, `test-results/`, and traces as artifacts on every run (success or failure).

### Azure DevOps Pipeline

[`../azure-pipelines-e2e.yml`](../azure-pipelines-e2e.yml) is the equivalent for Azure DevOps environments. It mirrors the same three-tier execution model with three pipeline stages and reuses the same npm scripts. Variable groups (`whoville-e2e-secrets`) carry the test-user credentials and live-API credentials.

### Branch Protection

The repository's branch-protection settings on `main` and `develop` require these status checks before merge:

- `e2e-tier-1-smoke / smoke (chromium)` — Tier 1 must pass.
- `e2e-tier-2-crud / feature-crud (chromium)` — Tier 2 must pass.

Tier 3 failures do **not** block PR merges, but they do block release tags. The `release/*` branch protection adds:

- `e2e-tier-3-integration / integration (chromium)`.
- `e2e-cross-browser-nightly / feature-crud-firefox` and `feature-crud-webkit`.

### Cron Schedules

Nightly workflows run on a UTC cron expressed in each workflow's `on.schedule.cron` field. Recommended schedule:

| Workflow                        | Cron (UTC)            | Notes                                         |
| ------------------------------- | --------------------- | --------------------------------------------- |
| `e2e-tier-3-integration.yml`    | `0 4 * * *` (04:00)   | Before US morning so failures are visible     |
| `e2e-cross-browser-nightly.yml` | `0 5 * * *` (05:00)   | After Tier 3 completes                        |
| `e2e-live-api-nightly.yml`      | `0 6 * * 1-5` (06:00) | Weekdays only — staging traffic only weekdays |

Pre-release runs are triggered by tagging `release/*` branches; the workflow concatenates all three tiers + cross-browser into a single end-to-end gate.

---

## References and Further Reading

### In-Repository Documentation

- [`../README.md`](../README.md) — Repository root README; project overview and the link back to this file.
- [`docs/testing/e2e-strategy.md`](../docs/testing/e2e-strategy.md) — Living testing strategy document. Why three tiers, how runtime budgets were derived, what is in/out of scope.
- [`docs/testing/patterns-a-to-e.md`](../docs/testing/patterns-a-to-e.md) — Full pattern authoring guide with a worked example per pattern.
- [`docs/testing/page-object-conventions.md`](../docs/testing/page-object-conventions.md) — POM conventions in depth (selector preference order, base class contract, naming rules).
- [`docs/testing/migration-readiness.md`](../docs/testing/migration-readiness.md) — Migration playbook: how to interpret a test failure during Angular 11→21 migration (selector vs API contract vs visual regression).

### Configuration Files

- [`../playwright.config.ts`](../playwright.config.ts) — Playwright project matrix, reporters, timeouts.
- [`../tsconfig.e2e.json`](../tsconfig.e2e.json) — TypeScript config and path aliases.
- [`../package.json`](../package.json) — Dependencies and the canonical `e2e:*` npm scripts.
- [`../.env.e2e.example`](../.env.e2e.example) — Environment-variable template.
- [`../.gitignore`](../.gitignore) — Excluded paths (reports, traces, storage states, secrets).
- [`.eslintrc.json`](.eslintrc.json) — ESLint rules (locator preference, no-raw-selectors-in-specs, web-first assertions).
- [`.prettierrc.json`](.prettierrc.json) — Prettier formatting.
- [`.nvmrc`](.nvmrc) — Node 20.x pin.

### Playwright Documentation (External)

- [Playwright Test Projects](https://playwright.dev/docs/test-projects) — How `projects` array drives the tier matrix.
- [Test API reference](https://playwright.dev/docs/api/class-test) — `test.extend()`, `test.describe`, fixtures.
- [Best Practices](https://playwright.dev/docs/best-practices) — Locator preference, web-first assertions, parallelism.
- [Locators](https://playwright.dev/docs/locators) — `getByRole`, `getByLabel`, `getByText`, `getByTestId`.
- [Network mocking](https://playwright.dev/docs/network) — `page.route()` interception API.
- [Trace Viewer](https://playwright.dev/docs/trace-viewer) — Reading traces produced by `trace: 'on-first-retry'`.
- [Migrating from Protractor](https://playwright.dev/docs/protractor) — Reference for the (defunct) Protractor patterns this suite replaces.

### Agent Action Plan

The Agent Action Plan (AAP) §0 is the binding requirements document for this suite. The most relevant sections for contributors:

- AAP §0.1 — Intent clarification and the user-specified test/runtime budgets.
- AAP §0.4 — Test strategy and the canonical scenario blueprint per pattern.
- AAP §0.5 — File-by-file test plan; spec-by-spec mapping.
- AAP §0.6 — Dependency inventory and lock-step versioning.
- AAP §0.7 — Coverage and quality criteria.
- AAP §0.8 — Scope boundaries (in / out).
- AAP §0.9 — Execution parameters and command interface.
- AAP §0.10 — User-specified testing directives and "do not forget" reminders.

---

## License and Maintainership

This test suite is internal Nationwide / Whoville-Client team property. It is not licensed for redistribution outside the originating organization. The committed code is governed by the repository's `UNLICENSED` declaration in [`../package.json`](../package.json).

**Maintainer:** Whoville-Client QA team (or the Whoville-Client engineering team during the migration window). Pull requests against this suite must be reviewed by at least one maintainer plus the team owner of the affected feature module (Workforce / Assessments / Competencies / Authorization / App Core).

**Last updated:** This README is maintained alongside the test suite — it is updated whenever the canonical scripts, paths, patterns, or policies change. There is intentionally no static "last-updated" date; the authoritative version is whatever is committed on `main`. Use `git log -- e2e/README.md` to see the change history.
