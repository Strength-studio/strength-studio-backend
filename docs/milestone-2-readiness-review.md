# Milestone 2 readiness review

Review date: 7 November 2026. Baseline: `d8390ab` — Implement Strength Studio Foundation. Scope: commercial and entitlement review, analysis and implementation planning only.

## Executive summary

**Milestone 2 is not yet ready for implementation as a complete business milestone.** Foundation supplies useful identity, permission, transaction, audit and settings infrastructure, but no commercial persistence or enabled workflows. Owner decisions O-01 and O-03–O-07 remain pending. Three missing/discrepant decisions are recorded as O-15–O-17. Audit B01–B03 and the catalog portion of B05 still require concrete design/test closure before enabling their workflows.

The architecture remains suitable at the current scale. Retain Flutter, Next.js on Vercel, one NestJS modular monolith REST API, Socket.IO, PostgreSQL/Prisma, Redis/BullMQ, Hostinger KVM1 and Nginx/TLS. No additional infrastructure, general accounting ledger, service decomposition or workflow engine is recommended.

The principal conflict is activation authority. The review request specifies Admin-only membership activation; the canonical matrix and Foundation implementation/tests permit explicitly granted Staff on the ordinary verified-funded path. Only activation exceptions are consistently Admin-only today. The plan follows the review request's Admin-only direction, flags the conflicting sources, and changes neither Foundation behavior nor canonical permissions in this review. Resolve O-15 and reconcile those sources before implementing activation.

Read the [decision register](milestone-2-decision-register.md) for available options, tradeoffs, recommendations, approval requirements and impacts. The [implementation plan](milestone-2-implementation-plan.md) contains proposed modules/entities, the finance event effect contract, endpoint inventory, sequence, tests and acceptance criteria. **All recommended business defaults remain proposals. Nothing in these documents approves implementation or a production change.**

## Inspection and evidence

| Area | Files inspected | What the evidence establishes |
|---|---|---|
| Source-of-truth documentation | `README.md`; `docs/architecture-review.md`, `domain-model.md`, `data-dictionary.md`, `permission-matrix.md`, `business-rules.md`, `api-contract.md`, `architecture-decisions.md`, `implementation-roadmap.md`, `open-decisions.md` | Distinguishes Foundation contract, confirmed boundaries, proposed domain model and pending studio values |
| Historical gates | `docs/milestone-0-final-readiness-audit.md` | B01 receipt identity, B02 finance semantics, B03 funding/grace and catalog B05 remain affected-workflow gates; historical empty-workspace wording is not the current baseline |
| Database | `apps/backend/prisma/schema.prisma`; the sole `20261104000100_foundation/migration.sql`; migration lock file; `infra/postgres/01-local-roles.sh`; `compose.dev.yml` | Ten Foundation models only; PostgreSQL 17 local service, separate migrator/runtime roles, private schema deny boundary; no finance/membership schema |
| Backend composition and security | `src/app.ts`, identity controller/DTOs/permissions/access guard/session/password/access-events/realtime, studio controller, platform commands/database/audit/http/config/health, local seed | Current action mapping, deferred endpoints, replay and authorization mechanics, settings limits and actual socket behavior |
| Interfaces and contracts | `packages/api-contract/openapi.json`, backend OpenAPI generation, dashboard session helper/handlers/relay/page, mobile README | Foundation-only contract; dashboard sign-in surface; relay has two allowed upstream operations; Flutter app is deferred |
| Tests and toolchain | Backend unit/integration test files, workspace/backend/dashboard package configuration, lockfile, `.github/workflows/foundation.yml` | Existing coverage and CI commands; commercial test coverage does not exist. Integration setup applies migrations to a disposable database |

The working tree was clean at the start. There were no applicable AGENTS.md instructions found in the project or its ancestor directories. Secrets were not needed for the review; no runtime database contents, remote CI execution or production configuration were inspected.

### Verification performed in this review

| Check | Result / limitation |
|---|---|
| Backend TypeScript compile | Passed using `node apps/backend/node_modules/typescript/bin/tsc -p apps/backend/tsconfig.json` |
| Existing security unit suite | Passed: 3/3 using `node --test apps/backend/test/*.unit.test.cjs`; covers salted Argon2id, independent grants/Admin-only exception and commission boundary, configuration validation |
| Dashboard production build | Passed using `node apps/dashboard/node_modules/next/dist/bin/next build apps/dashboard` |
| Workspace command attempt | `pnpm build && pnpm test:unit` did not reach build/tests: available pnpm 11.25.0 attempted dependency synchronization and aborted with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`; repository pins 10.34.9. Existing installed tool binaries were used directly; no reinstall/toolchain/configuration change was made |
| Existing integration suite and CI | Inspected, **not executed**. Integration setup creates a disposable database and invokes `prisma migrate deploy`, prohibited by this review's no-migrations instruction. CI has install/Compose/migrate/verify/OpenAPI-diff/cleanup steps, but remote CI status is not established here |
| Database/finance races and isolation | Existing integration assertions reviewed; no live DB privilege or commercial race result is claimed. Commercial tables do not yet exist |
| Milestone 2 tests | Proposed in the implementation plan, not written or run |

Builds establish compile/build viability, not finance correctness or deployed security. No migrations were created or applied, no database/production settings were changed, and no application behavior was modified.

## Existing implementation baseline

### Implemented

- Identity supports active/verified-account sign-in with Argon2id, five-minute access tokens, seven-day absolute refresh sessions, digest-only refresh tokens, atomic rotation/replay revocation, logout and single-use 30-second Socket.IO tickets. Current user/session/role/grants are read from PostgreSQL. Socket invalidation and periodic revalidation are implemented; no business rooms/events are implemented.
- Scoped account reads, Admin disablement of non-Admin accounts, independent stored Staff grants and Admin settings publication are present. The action map recognizes only currently supported actions: storing all matrix grant values does not enable all future workflows.
- Settings publication versions timezone and default currency, writes an immutable policy revision and audits it. Commercial `rules` are currently empty; no funding, receipt methods, credit, refund, grace or suspension values are validated or enforced.
- The common command service claims an actor/action/key, digests command arguments, checks current authority/scope, stores a completed success and audits inside the transaction. PostgreSQL commands use READ COMMITTED, bounded lock/statement/transaction timeouts and one retry for classified transient failures. Existing routes use the scope callback and actor/session lock guards. Commercial account locks, posting kinds and durable money-source uniqueness are not implemented yet.
- Health/readiness, strict DTO whitelisting, request IDs, no-store responses and request logs without route/body/credential payloads are implemented. Operational audit and policy rows have insert/select runtime privileges without update/delete.
- The migration creates a restricted `commission_private` schema but no commission tables. Ordinary API, reporting and worker roles have private-schema access revoked; reporting/worker are NOLOGIN placeholders. No commission private connection/service is enabled. The integration source tests ordinary-role denial using a private probe table; this review did not rerun it.
- Next.js implements sign-in/session restore/sign-out and same-origin cookie/CSRF session handlers. The relay only allows GET `/me` and POST `/auth/socket-ticket`; it is not a commercial API proxy.

### Deferred or absent

| Capability | Actual baseline |
|---|---|
| Package catalog, session types, private/custom offers and discounts | Proposed in docs only; no models/controllers/services |
| Purchase requests/records, snapshots, installment schedules | Proposed only; no schema or endpoints |
| Manual receipts, verification, lots, allocation, credit, balances | Proposed only; no financial tables or methods |
| Refund requests/reservations/execution/reconciliation | Proposed only; no persistence or execution workflow |
| Memberships, activation, validity, suspension, grace, extension, entitlement ledger/reviews | No tables or enabled workflows. Ordinary/exception activation are authorization boundary stubs returning `WORKFLOW_NOT_ENABLED` |
| Commission workflows | Admin-gated stub returning `WORKFLOW_NOT_ENABLED`; commercial finance must never load private commission data |
| Client onboarding/recovery | Registration, verification, invitation and reset stubs return `ONBOARDING_POLICY_PENDING`; O-02 remains a real onboarding dependency |
| Mobile, delivery and release infrastructure | Mobile README only; no Flutter app. No Redis/BullMQ dependency/worker/outbox/delivery implementation. No production deployment established by this review |

The integration source contains 12 tests covering health/self/login, account scope, stub role boundaries, concurrent settings retries/audit, token ownership/DB denial, socket single-use/origin/revocation, refresh replay, waiting-write revocation, disable/logout and the built Next.js session flow. Those are useful Foundation regressions, not evidence that funding, refunds or membership activation work.

## Scope and dependencies

| M2 capability | Review scope / dependency |
|---|---|
| Package catalog | Session and time kinds, calendar validity, immutable successor versions, authenticated published public offers, client-owned private quotes, agreed final prices/discount evidence. Minimal session-type reference data is required for future eligibility, without scheduling workflows |
| Purchases | Own requests, rejection/withdrawal, approval/recording, final agreement snapshot, one-item launch proposal, pending membership issuance and explicit cancellation/adjustment |
| Installments | Positive schedule portions, local due dates, split funding, replacement history, outstanding balances; no automatic penalties or arrears suspension |
| Manual payments and credit | Immutable receipts/identity, separate verification, source lots, explicit allocation, partial/multi-purchase settlement, excess unapplied funds, optional approved cash-backed credit conversion/reuse |
| Refunds | Full/partial original-receipt cash refunds, reserve/claim/evidence/post/reconcile, uncertainty, original preservation, explicit debt and membership effects |
| Membership/entitlement | Admin activation direction, session grant/time validity, derived expiry/exhaustion, suspension/reinstatement/cancellation, explicit extension/grace, adjustments/reviews/history |

Finance must serialize by client/currency account and preserve source provenance. Membership activation depends on purchase-matched net allocations, not any receipt in the client's account. Refunds depend on the same finance event rules and must preserve reservations during uncertainty. Eligibility must work without Redis or a scheduler; current database time can enforce expiry. Notifications, reminders and realtime business hints are deferred and must not become money-correctness prerequisites.

Real-client acceptance ultimately depends on approved O-02 onboarding and provisioned accounts. It does not require inventing an invitation workflow in M2: isolated fixtures can support backend development once authorized. Scheduling, attendance, coach commissions, branches, online payments, production deployment and tax/accounting integrations remain out of scope. The implementation plan names the narrow future eligibility and entitlement-posting interfaces without implementing those workflows.

## Settled boundaries to preserve

The following questions are already answered by current contracts and should not be reopened as if undecided:

| Question | Existing requirement / remaining policy |
|---|---|
| Can one payment cover several installments/purchases? | Yes, the source-lot/allocation-event relation permits many targets within the same client/currency. Exact targeting/order still needs O-04 approval |
| Can an installment be paid in several transactions? | Yes, many allocations/lots can fund one installment; no one-payment-per-installment restriction |
| Can price changes alter old purchases? | No. Published versions and agreed purchase-item terms freeze; new terms need a new offer and explicit acceptance |
| Can private offers belong to individual clients? | Yes. Private package requires one client owner; lists/details/acceptance use that owner. Freeze parent privacy to prevent historical exposure |
| Does verification activate membership? | No. Recording, verification, allocation and activation remain distinct commands |
| Can original verified financial rows be edited/deleted? | No. Corrections append compensating events; unverified replacement links the original |
| Does a cash refund restore sessions or cancel service? | No automatic effect. A separate Admin review decides service consequences |
| Can an activated membership be suspended? | Yes, Admin lifecycle command. Whether validity freezes remains O-07 |
| Who decides refunds, extensions and unit corrections? | Existing matrix fixes refund decision/execution/post/reconciliation, membership management and entitlement adjustment to Admin |
| Are commissions operational finance data? | No. Strict Admin-only private boundary; no generic finance/report/cache/worker/notification access |

AD-03/04/12 and much of the data dictionary remain labeled proposed. This review recommends carrying their existing finance-event, reservation and snapshot designs forward; it does not relabel them approved architecture records. Confirm those technical contracts in design review without substituting new abstractions.

## Unresolved decisions and recommended options

The register provides options with advantages/disadvantages and database, permission, API, reporting and future-workflow impacts for every business decision. The practical recommended defaults are:

| ID | Approval choice and reason |
|---|---|
| O-01 | Confirm one currency and short method list; Africa/Cairo, EGP, cash/bank transfer are candidates, not approved values. Local calendar-day validity and local due dates give clients consistent dates; no FX |
| O-03 | Full net verified purchase funding, one item per purchase at launch, separate verifier, unique source identity across keys/clients. This prevents partial funding from activating several items and prevents duplicate receipts. Keep Admin exceptions disabled until categories/evidence are approved |
| O-04 | Explicit operator allocation with oldest-due suggestion; partial/multiple payments allowed. Preserve excess as unapplied, permit explicit cash-backed credit conversion/reuse if approved, no promotional issuance/expiry/cash-out. This retains provenance without hiding excess money |
| O-05 | Reserved, evidenced Admin cash refunds and compensating corrections. Refund does not forgive reopened debt or decide service effects. This separates cash, contract and entitlement history |
| O-06 | Final agreed price in immutable versions; private client quote with explicit expiry; reject superseded/expired acceptance. Admin private pricing at launch via unassigned Staff grants. No arbitrary purchase discount override. This protects private terms and agreements |
| O-07 | Start validity at activation; suspension clock continues; no automatic grace/rollover. Historical unused units remain unusable after expiry unless an Admin explicitly extends; bounded grace remains separate from formal expiry. This avoids hidden entitlement changes |
| O-15 | Admin-only ordinary activation as expressly requested, with canonical matrix/code/test reconciliation before implementation. Preserve the separate exception command |
| O-16 | Allow concurrent memberships with independent units/validity; later booking selects one. This fits the model without pooling or automatic replacement |
| O-17 | Atomic request acceptance/recording requiring both named actions; explicit agreement evidence; immutable recorded terms and explicit cancellation; no zero-price/tax/stacking-discount engine. This avoids half-recorded agreements and implicit financial treatment |

O-15–O-17 are appended to [open decisions](open-decisions.md); original entries are preserved. O-15 is a conflict requiring source reconciliation, O-16 is a missing launch policy rather than a schema cardinality question, and O-17 resolves incomplete purchase lifecycle semantics. Other questions are refinements of existing O-IDs, avoiding duplicate decisions.

### Technical design gaps before migrations

- **B01:** Add a studio-wide receipt identity guard and correction-root semantics. Current optional external reference and HTTP keys cannot stop duplicate physical receipts. Define normalization per method and fail uncertain verification closed.
- **B02 / M2-T01:** Review a closed finance kind/reference/effect/reversal matrix, target balance equations, frozen refund bucket, receipt-cap reservation and one execution claim/terminal posting. The plan supplies a candidate matrix and reconciliation example; no SQL exists yet.
- **B03 / M2-T03:** Approve purchase/item threshold scope, exact activation date rule and grace intervals/revocation/precedence. Store historical evaluated funding and apply the initial grant only once.
- **Catalog B05 / M2-T02:** Freeze parent privacy and client ownership after publication; preserve exact request/version ownership under the package lock.
- **M2-T04:** Funding corrections also need a service review. The dictionary's review only references a refund; extend it to a refund-or-funding-reversal source instead of adding another review system.
- **Policy and permission binding:** Empty Foundation rules cannot enable a workflow. Expand only approved policy schema and required action vocabulary. Foundation's `RequireAction`/`Sessions.authorize` list has **OR semantics**; accepting a request with both review and record authority must explicitly check each action inside the guarded transaction, not assume passing two names means AND.
- **Immutable-table lock privilege:** PostgreSQL row locking needs suitable UPDATE privilege on a lock target. Design tightly limited projection/guard columns without granting mutable financial facts or history. Review migrations/default grants in the later implementation task.

## Risks and security considerations

| Severity / risk | Required control and evidence |
|---|---|
| Critical — double receipt, allocation or cash return | Studio-wide source identity, account serialization, source/target caps, durable posting uniqueness, frozen reservations and one execution claim. Real PostgreSQL concurrent tests required |
| Critical — false activation | Same-purchase net verified cash-backed funding under account lock, approved threshold and one-item attribution, distinct Admin exception, historical evidence; race activation versus refund/reversal |
| Critical — financial history corruption | Immutable receipt/snapshot/event/ledger facts, source-linked compensation, no deletion or writable balance; runtime DB UPDATE/DELETE denial and reconciliation oracle |
| High — authority drift | Reconcile O-15; no grant inference among record/verify/allocate/read/review/record; explicitly conjunctive checks when required; current user/session/grants rechecked under locks and on replay |
| High — private offer or cross-client disclosure | Query-level owner predicates, scoped composite FKs, exact parent/version joins, freeze published privacy; consistent 403/404 and safe list/detail/error/replay DTOs |
| High — cash/debt/service conflation | Separate receipt collection, allocation, charge adjustment, refund cash and membership review; clear outstanding and historical eligibility projections |
| High — refund uncertainty after crash | Persist claim before external handover; no money jobs; keep reservation and execution evidence, require reconciliation before any new payout attempt |
| High — commission leakage through new finance endpoints | No commission queries/private connection on commercial paths. Dedicated allowlisted DTOs and no-store. No identifiers, amounts or aggregates in general reports, logs, audit, caches, workers, outbox, sockets or notifications; negative role/DB/data-path regression tests |
| Medium — date/expiry drift | Stored applied boundaries and policy, local-date validation, post-lock DB clock, exclusive ends and DST tests; no dependency on worker cleanup |
| Medium — unstated correction/discount authority | Reuse only existing Admin correction actions with explicit scope; final-price private version rather than purchase override; policy approval and audit reasons |

Staff finance reads can expose eligible single-studio financial records only through the named grant, not because the caller can record a payment. Client reads expose own records through finance account/purchase/membership ownership. Membership and entitlement reads are Admin/client-own in the canonical matrix, with no Staff read grant. Operational audit access remains distinct from finance access and never includes private commission audit. Sensitive receipt evidence should use safe references, not loggable free-form credentials or uploaded secrets.

No commissions are enabled in M2. The current private-schema denial boundary is useful but does not prove future serializer/cache/delivery isolation. Add probes for each path actually introduced and retain full commission enablement testing for Milestone 4. No new finance worker or notification path is needed just to complete M2.

## Implementation prerequisites and readiness verdict

Before implementation authorization, obtain a decision record for O-01/O-03–O-07/O-15–O-17 with selected defaults/deviations, approving owner/date and effective policy; explicitly mark any optional paths disabled. Do not convert this report into that approval. Resolve the activation-source conflict and purchase/private-management permission interpretations in canonical contracts. Review the proposed finance event matrix, receipt identity guard, scoped keys, refund state machine and grace/review model; use those to close affected audit findings with later tests.

Before acceptance, the implementation task must add actual persistence/API slices, database grants/constraints and commercial tests, run the pinned toolchain plus complete Foundation/M2 integration/race suite, reconcile finance/entitlement history and document uncertain-payout handling. O-02 remains a separate real-onboarding dependency. O-08/O-09 future commitment/attendance policies and O-10–O-13 interface/release decisions are not excuses to add those workflows now; keep their interfaces explicit and their scope deferred.

**Verdict:** the implementation approach is defined, but business approvals and several integrity contracts are blockers to starting the complete milestone. After those are recorded and implementation is explicitly authorized, the sequence in the plan is proportionate to the current project. No production feasibility, deployment or commercial correctness certification is claimed by this documentation review.

## Deliverables and change boundary

Created:

- `docs/milestone-2-readiness-review.md` — this evidence, decision, risk and prerequisite report.
- `docs/milestone-2-decision-register.md` — existing decision refinements, three new decisions, options, recommendations, impacts and approval gates.
- `docs/milestone-2-implementation-plan.md` — modules, entity design, finance effects, API inventory, sequence, tests and acceptance.

Modified only `docs/open-decisions.md`: appended O-15–O-17 and a dated review cross-reference while preserving O-01–O-14. No application, migration, permission matrix, architecture, CI or deployment file was changed. Build artifacts are ignored local verification output. **Stop here; wait for explicit approval before implementing Milestone 2.**
