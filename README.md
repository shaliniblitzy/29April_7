# 29April_7

## Architecture Documentation

The platform's microservices architecture — including the comprehensive component topology, the synchronous and asynchronous integration pathways, the polyglot persistence bindings, and the canonical request/response flows — is documented under [`docs/architecture/`](docs/architecture/README.md). The diagrams are authored in [Mermaid](https://mermaid.js.org/) and render natively in GitHub-flavored Markdown.

- [`docs/architecture/microservices-architecture.md`](docs/architecture/microservices-architecture.md) — End-to-end Mermaid architecture diagram of the platform's ten-plus microservices, polyglot persistence layer, SNS+SQS event backbone, and external integration seams (payment processor, email/SMS provider, third-party APIs), grouped into Frontend, Backend, and Infrastructure subgraphs.
- [`docs/architecture/sequence-diagrams/login-flow.md`](docs/architecture/sequence-diagrams/login-flow.md) — Mermaid sequence diagram for the user Login flow, showing the synchronous Client → API Gateway → Authentication → User Profile chain with conditional credential-validity branching and asynchronous fan-out to the Audit service.
- [`docs/architecture/sequence-diagrams/payment-flow.md`](docs/architecture/sequence-diagrams/payment-flow.md) — Mermaid sequence diagram for the Payment processing flow, showing the synchronous Client → API Gateway → Billing → Orders chain with nested RBAC and authorization-outcome branches plus parallel asynchronous fan-out to Notifications, Audit, and Analytics.

## E2E Tests

The Playwright-based End-to-End (E2E) regression test suite is located under [`e2e/`](e2e/README.md) and serves as the safety net for the planned Angular 11→21 framework migration of the Whoville-Client application. The suite establishes approximately **~835 tests across ~101 spec files** that capture the as-is behavior of the Angular 11.2.5 codebase as an executable contract before any framework version change. It is built on **Playwright 1.59.1** with TypeScript and a Page Object Model (POM) architecture, and replaces a defunct Protractor configuration that contained zero spec files. See [`e2e/README.md`](e2e/README.md) for the full developer documentation.

### Three-Tier Test Strategy

| Tier                        | Test Count (target) | Runtime Budget | Trigger                | Browser Matrix                                    |
| --------------------------- | ------------------- | -------------- | ---------------------- | ------------------------------------------------- |
| Tier 1 — Smoke              | ~40                 | ~3 min         | Every commit, every PR | Chromium only                                     |
| Tier 2 — Feature CRUD       | ~640                | ~15 min        | Every PR (post-Tier-1) | Chromium for PRs; Chromium+Firefox+WebKit nightly |
| Tier 3 — Integration / Edge | ~130                | ~25 min        | Nightly + pre-release  | Chromium+Firefox+WebKit                           |

### Running E2E Tests Locally

```bash
# Install Playwright browser binaries (one-time)
npm run e2e:install-browsers

# Run the full suite (all 3 tiers)
npm run e2e

# Run only the Tier 1 smoke tier (~3 min)
npm run e2e:smoke

# Run only the Tier 2 feature-CRUD tier (~15 min)
npm run e2e:crud

# Run only the Tier 3 integration tier (~25 min)
npm run e2e:integration

# Run with visible browser windows (debugging)
npm run e2e:headed

# Open Playwright UI mode (interactive watch)
npm run e2e:ui

# Step through tests with Playwright Inspector
npm run e2e:debug

# View the latest HTML report
npm run e2e:report
```

### Deliverables

- **~101 Spec files** under `e2e/specs/{smoke,feature-crud,integration}/` — covering ~835 tests across the four lazy-loaded feature modules (Workforce, Assessments, Competencies, Authorization) plus App Core.
- **Page Object Models (POMs)** under `e2e/pages/` — one POM class per major page; selectors encapsulated, user actions exposed as async methods.
- **Patterns A–E config-driven templates** under `e2e/patterns/` — Authentication (A), List/Detail (B), Form CRUD (C), Search/Filter (D), Workflow (E).
- **Test fixtures and factories** under `e2e/fixtures/` and `e2e/factories/` — composed `test`/`expect`, mock-API, auth `storageState`, and `@faker-js/faker`-based entity factories.
- **Mock handlers** under `e2e/mocks/` — `page.route()`-based API interception with optional live-API mode.
- **Route inventory** at `e2e/utils/route-inventory.ts` — single source of truth for all ~163 routes across the four lazy-loaded feature modules plus App Core.
- **CI/CD workflows** under `.github/workflows/` (and `azure-pipelines-e2e.yml` for Azure DevOps) — three tier-specific workflows plus a cross-browser nightly and a live-API nightly.
- **Coverage and reporting scripts** under `e2e/scripts/` and `e2e/reporters/` — route-coverage report, multi-tier report merger, flake detector.
- **Living documentation** under `docs/testing/` — strategy, pattern authoring guide, POM conventions, migration playbook.

### Migration-Proofing

The suite is intentionally **migration-proof**: selectors prefer accessibility-tree primitives (role, label, text) over Angular-internal CSS classes, mocks abstract over HTTP API contracts (which migrate slower than UI implementation details), and assertions are designed to remain valid through Angular 12 → 13 → … → 21 upgrades. Branch protection requires Tier 1 + Tier 2 to pass on every PR; Tier 3 failures block release tags. See [`docs/testing/migration-readiness.md`](docs/testing/migration-readiness.md) for the migration playbook.

### Further Reading

- [`e2e/README.md`](e2e/README.md) — Developer guide with installation, debugging, and pattern-authoring instructions.
- [`docs/testing/e2e-strategy.md`](docs/testing/e2e-strategy.md) — Living testing strategy document.
- [`docs/testing/patterns-a-to-e.md`](docs/testing/patterns-a-to-e.md) — Pattern authoring guide.
- [`docs/testing/page-object-conventions.md`](docs/testing/page-object-conventions.md) — POM conventions.
- [`docs/testing/migration-readiness.md`](docs/testing/migration-readiness.md) — Migration playbook.
