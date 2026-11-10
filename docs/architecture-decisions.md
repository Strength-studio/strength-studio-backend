# Architecture decisions

These records retain the Milestone 0 architecture decisions and incorporate the owner’s later business boundaries where they affect the architecture.

| ID | Status | Decision and rationale |
|---|---|---|
| AD-01 | Confirmed direction | Use the modular monolith and agreed hosting split. One NestJS API and one worker entry point share the backend release image. No branch or service decomposition is needed for one studio. |
| AD-02 | Foundation contract | PostgreSQL is authoritative. Prisma manages models and reviewed migrations. Use the [scoped FK and ownership map](data-dictionary.md#scoped-foreign-keys-and-ownership). Explicit SQL covers GiST exclusions, grants, conditional uniqueness, and constraints outside the selected Prisma version. |
| AD-03 | Proposed | Typed finance events represent Admin allocations, credit ledger movements and other postings. Allocation is a filtered set of events with source and target FKs. Payment recording and verification are distinct from final Admin authorization and posting. Preserve original receipts, lots, refund cases and linked correction history. |
| AD-04 | Proposed | Reserve eligible receipt or credit funds before external execution and reconcile uncertain cash movement. Require actual payout evidence or reasoned Admin exception. Keep receivable effects separate. The worker never disburses or retries money. |
| AD-05 | Proposed | One booking participant is one client seat and the public booking ID. A session slot supplies group capacity. No booking header or separate waitlist table is needed. |
| AD-06 | Proposed | Preserve buffered coach assignments and served-reservation attribution. Record immutable attendance revisions, accepted charge and policy, and entitlement deltas. |
| AD-07 | Confirmed boundary, Foundation contract | Commission is strictly Admin-only. Use [restricted DB grants and the private API path](permission-matrix.md#commission-isolation). No shared cache, ordinary worker export, shared logging, notification, or realtime path carries commission data. |
| AD-08 | Foundation contract | Use Next.js same-origin browser handlers and Flutter bearer credentials. NestJS owns both sessions and single-use socket tickets. Use the [canonical action map](permission-matrix.md) and [current authorization and revocation rules](api-contract.md#authorization-and-revocation). |
| AD-09 | Proposed | Use Redis AOF for restart continuity and PostgreSQL outbox/lease reconciliation for queue recovery. Delivery is at least once and domain posting is idempotent. |
| AD-10 | Foundation contract | All writers follow the [shared command transaction](business-rules.md#shared-command-transaction), including actor/session guards, shared lock order, fresh READ COMMITTED reads, and post-lock database time for holds. Commit idempotency outcomes, mutations, audit, and outbox atomically. |
| AD-11 | Approved policy, runtime reconciliation pending | Both ordinary activation and the separately documented exception are Admin-only. Explicitly allocated authorized payment or client credit can qualify at partial funding. Preserve Admin approval time and effective Riyadh start date. SAR 0 issuance has a separate purchase basis. Multi-item funding attribution and exception criteria remain pending. See [O-15](milestone-2-readiness-review.md#o-15-authorization-conflict). |
| AD-12 | Approved snapshot policy, proposed versioning contract | Publish immutable package versions, including owner-scoped private offers with optional Riyadh expiry. Formal acceptance uses a dedicated action and preserves agreement evidence and agreed terms. Catalog updates, cancellation and financial adjustments preserve the original snapshot. |

Business values and approval status are tracked in the [studio decision index](open-decisions.md).
