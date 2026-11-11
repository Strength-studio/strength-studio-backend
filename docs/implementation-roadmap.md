# Implementation roadmap

Milestone 0 ended with the documentation corrections. The owner subsequently authorized Milestone 1 Foundation. Initial production go-live remains pending under O-14.

| Order | Deliverable | Exit gate |
|---|---|---|
| 0. Architecture review | Review the documents and audit corrections. | A01–A06 are addressed in documentation. The owner authorized Foundation. |
| 1. Foundation | After authorization, initialize Git and the approved monorepo. Pin tooling, establish CI and local Compose, and build identity, authorization, settings, health, and the OpenAPI baseline. | Test denied routes and scoped ownership, independent grants, revocation versus writes, refresh replay, missed socket invalidation, atomic retries, reviewed migrations, and ordinary DB role denial for the private schema. Close audit B06 and the remaining O-02 onboarding choices before enabling real onboarding. |
| 2. Commercial and entitlement | Versioned offers, purchases, installments, manual payments, allocations, credit, refund reservations, membership lifecycle, and entitlement ledger. | Close audit B01–B03 and the catalog part of B05 before affected workflows. Reconcile O-15 before activation. Pass payment authorization, credit reconciliation, lifecycle, refund uncertainty and concurrent posting tests. |
| 3. Scheduling and attendance | Coach availability, buffered slots, holds, booking decisions, per-participant revisions, verification, and corrections. | Close audit B04 and the scheduling part of B05. Test PostgreSQL races including post-lock hold expiry and per-participant entitlement. Waitlisting stays disabled unless approved. |
| 4. Interfaces and delivery | Flutter client, Next.js role views, reports, private commission records and distributions, inbox, SMTP, and socket hints. | Close audit B07–B08 before enabling delivery and commissions. Pass end-to-end workflows, negative commission tests across all data paths, and Redis-loss recovery. |
| 5. Release readiness | Verify production prerequisites, TLS/SMTP, KVM1 mixed-load performance, off-server backup restore, rollback runbook, and handover. | Close audit B09. Owner approves remaining launch policies and measured readiness. Initial production deployment requires separate authorization. Subsequent audited deployments follow O-13. |

Proposed repository layout after foundation approval: `apps/backend`, `apps/dashboard`, `apps/mobile`, `packages/api-contract`, `infra`, and `docs`. Use a pnpm TypeScript workspace and native Flutter tooling. Keep Prisma and domain rules inside the backend. Local and production environments remain separate.

Client Management Slice 1 implements the authorized directory, detail, and Client own-profile reads on the Foundation schema. The dashboard includes the directory and detail views. Client profile writes and onboarding are later work. O-02 still gates onboarding. [Implemented API contract](api-contract.md#implemented-client-reads)

## Readiness after the audit corrections

The [original audit](milestone-0-final-readiness-audit.md) is retained as the pre-correction record. Its Foundation findings are addressed in the current contracts:

| Finding | Documentation correction |
|---|---|
| A01 | [Canonical permissions](permission-matrix.md) and [bound routes](api-contract.md#route-families), including Client-only invitations and a separate Admin activation exception. |
| A02 | [Revocation rules](api-contract.md#authorization-and-revocation) and transaction guards for writes, refresh replay, and connected sockets. |
| A03 | [Scoped FK and ownership map](data-dictionary.md#scoped-foreign-keys-and-ownership). |
| A04 | [Atomic retry outcome and write rules](business-rules.md#shared-command-transaction). |
| A05 | [Shared lock order](business-rules.md#shared-command-transaction) and [post-lock hold expiry](business-rules.md#hold-expiry-and-seat-locks). |
| A06 | [Private database and data-path boundaries](permission-matrix.md#commission-isolation) with tests scheduled in the Foundation and reporting gates above. |

The Foundation recommendation was based on a documentation cross-check. The owner has authorized Foundation. [Open studio decisions](open-decisions.md) still gate their affected workflows. The audit's later-workflow findings remain open. See [local setup and verification](../README.md) for the implementation scope and test commands.
