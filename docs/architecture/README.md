# Architecture Documentation

This directory contains the platform's architecture documentation, authored as [Mermaid](https://mermaid.js.org/) diagrams embedded in Markdown. The diagrams render natively in GitHub-flavored Markdown viewers (GitHub, GitLab, IntelliJ IDEA, VS Code with Markdown preview) and require no build step, no package installation, and no runtime dependency to view.

## Contents

- [`microservices-architecture.md`](microservices-architecture.md) — End-to-end Mermaid architecture diagram of the platform's ten-plus microservices, polyglot persistence, event backbone, and external integration seams.
- [`sequence-diagrams/login-flow.md`](sequence-diagrams/login-flow.md) — Mermaid sequence diagram for the user Login flow.
- [`sequence-diagrams/payment-flow.md`](sequence-diagrams/payment-flow.md) — Mermaid sequence diagram for the Payment processing flow.

## Reading Order

For new readers, we recommend the following sequence:

1. Start with [`microservices-architecture.md`](microservices-architecture.md) for the high-level component topology, the Frontend / Backend / Infrastructure grouping, and the synchronous + asynchronous integration pathways.
2. Continue with [`sequence-diagrams/login-flow.md`](sequence-diagrams/login-flow.md) to see how a representative authenticated request traverses the platform synchronously, with credential-validity branching and asynchronous fan-out to the Audit service.
3. Finish with [`sequence-diagrams/payment-flow.md`](sequence-diagrams/payment-flow.md) for a more complex flow that combines RBAC and authorization-outcome conditionals with parallel post-settlement fan-out to Notifications, Audit, and Analytics.

---

← [Back to repository root](../../README.md)
