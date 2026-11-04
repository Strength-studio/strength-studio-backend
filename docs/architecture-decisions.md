# Architecture decisions

These records capture the Milestone 0 proposal. The studio must approve the milestone before implementation.

| ID | Status | Decision and rationale |
|---|---|---|
| AD-01 | Confirmed direction | Use the modular monolith and agreed hosting split. One NestJS API and one worker entry point share the backend release image. No branch or service decomposition is needed for one studio. |
| AD-02 | Foundation contract | PostgreSQL is authoritative. Prisma manages models and reviewed migrations. Use the [scoped FK and ownership map](data-dictionary.md#scoped-foreign-keys-and-ownership). Explicit SQL covers GiST exclusions, grants, conditional uniqueness, and constraints outside the selected Prisma version. |
| AD-03 | Proposed | Typed finance events represent allocation and other operational money movements. The allocation relation is a filtered set of events with source and target FKs. Omit a duplicate allocation table and double-entry journal. Preserve original receipts, lots, refund cases, and event history. |
| AD-04 | Proposed | Reserve manual refund funds before external execution and reconcile uncertain cash movement. The worker never disburses or retries money. |
| AD-05 | Proposed | One booking participant is one client seat and the public booking ID. A session slot supplies group capacity. No booking header or separate waitlist table is needed. |
| AD-06 | Proposed | Preserve buffered coach assignments and served-reservation attribution. Record immutable attendance revisions, accepted charge and policy, and entitlement deltas. |
| AD-07 | Confirmed boundary, Foundation contract | Commission is strictly Admin-only. Use [restricted DB grants and the private API path](permission-matrix.md#commission-isolation). No shared cache, ordinary worker export, shared logging, notification, or realtime path carries commission data. |
| AD-08 | Foundation contract | Use Next.js same-origin browser handlers and Flutter bearer credentials. NestJS owns both sessions and single-use socket tickets. Use the [canonical action map](permission-matrix.md) and [current authorization and revocation rules](api-contract.md#authorization-and-revocation). |
| AD-09 | Proposed | Use Redis AOF for restart continuity and PostgreSQL outbox/lease reconciliation for queue recovery. Delivery is at least once and domain posting is idempotent. |
| AD-10 | Foundation contract | All writers follow the [shared command transaction](business-rules.md#shared-command-transaction), including actor/session guards, shared lock order, fresh READ COMMITTED reads, and post-lock database time for holds. Commit idempotency outcomes, mutations, audit, and outbox atomically. |
| AD-11 | Confirmed boundary | Verified-funded activation and the documented Admin exception are distinct [API commands](api-contract.md#route-families). Staff cannot invoke the exception. Funding thresholds and exception criteria remain pending. |
| AD-12 | Proposed | Publish immutable package versions, including private client offers. Purchase items preserve agreed snapshots. Renegotiation creates new terms instead of updating recorded purchases. |

Business values are listed in [open decisions](open-decisions.md). The decisions here do not supply those values.
