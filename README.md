# 29April_7

## Architecture Documentation

The platform's microservices architecture — including the comprehensive component topology, the synchronous and asynchronous integration pathways, the polyglot persistence bindings, and the canonical request/response flows — is documented under [`docs/architecture/`](docs/architecture/README.md). The diagrams are authored in [Mermaid](https://mermaid.js.org/) and render natively in GitHub-flavored Markdown.

- [`docs/architecture/microservices-architecture.md`](docs/architecture/microservices-architecture.md) — End-to-end Mermaid architecture diagram of the platform's ten-plus microservices, polyglot persistence layer, SNS+SQS event backbone, and external integration seams (payment processor, email/SMS provider, third-party APIs), grouped into Frontend, Backend, and Infrastructure subgraphs.
- [`docs/architecture/sequence-diagrams/login-flow.md`](docs/architecture/sequence-diagrams/login-flow.md) — Mermaid sequence diagram for the user Login flow, showing the synchronous Client → API Gateway → Authentication → User Profile chain with conditional credential-validity branching and asynchronous fan-out to the Audit service.
- [`docs/architecture/sequence-diagrams/payment-flow.md`](docs/architecture/sequence-diagrams/payment-flow.md) — Mermaid sequence diagram for the Payment processing flow, showing the synchronous Client → API Gateway → Billing → Orders chain with nested RBAC and authorization-outcome branches plus parallel asynchronous fan-out to Notifications, Audit, and Analytics.
