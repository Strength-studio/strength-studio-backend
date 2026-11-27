# Application inventory and proposed next vertical slices

**Later S2-A implementation:** [Current implementation and verification](s2a-onboarding-implementation.md) supersedes this document's earlier planning-only readiness for the bounded slice. Historical approvals/proposals below are preserved; broader S2 and production gates remain.

Originally inspected 23 November 2026 at published commit
`62f8043433bcda4789efc879f4da9d8f94aafac5`; execution status and affected inventory
updated 27 November 2026 against merged `main`
`1fb9c220a4f234f3eb21d87019376b95b7635c7a`. Future slices and ledger design remain
**proposals for review**, not authorization to implement. This checkpoint is
post-merge verification, documentation and planning only.
O-09 proposals remain pending in the [owner brief](milestone-3-o09-owner-decision-brief.md).
The [technical report](milestone-3-technical-readiness.md) records actual work/results.

## Execution checkpoint — 27 November 2026

This section tracks current execution within the existing roadmap; the older
technical/consolidation reports retain their dated evidence. See the
[post-merge report](s1b1-post-merge-verification.md) for verification and the next-task contract.

| Slice / capability | Current development status | Remaining boundary |
|---|---|---|
| Foundation, catalog, Client reads, acceptance/funding/activation, scheduling/booking | Implemented and integrated into `main` | These are bounded slices, not completion of every M1–M4 feature. |
| Coach attendance submission, Admin return, Coach ATTENDED reaffirmation | Implemented and integrated | Test-only capture gate; no Admin verification or entitlement debit. |
| S1-A — Admin positive-price commercial operations | COMPLETED — MERGED INTO MAIN, PR #4, baseline `8d2803155b1ead4b9063efa412e04b2c331c4a05` | `/commercial` completes the positive-price journey. SAR 0 issuance API exists, but its entry UI remains outside S1-A. |
| S1-B1 — Admin Client profile maintenance | **COMPLETED — MERGED INTO MAIN**, [PR #5](https://github.com/Strength-studio/strength-studio-backend/pull/5), 27 November 2026 | Admin display-name edit and explicit existing account disablement only; onboarding/reactivation remain excluded. |
| S2 / S3 — Client onboarding and Staff/Coach provisioning | Blocked pending O-02 decisions and reviewed contracts | Recommended next task is S2 / O-02 decision closure, not implementation. |
| S4 / S5 — Membership lifecycle / verified attendance and usage | Not implemented; dependent policy/design gates open | O-07 transitions, O-08 affected bookings, O-09-A/B/C/E and approved canonical ledger/reconciliation design. |
| S6 / S7 — Installments / financial correction, credit and refunds | Not implemented; contract/policy gates open | O-01/O-03/O-04/O-05/O-07/O-17 as applicable. |
| S8 — Inbox and delivery | Not implemented; O-09-D/O-11 gated | Recipient/category, sender, transport and failure operations remain unresolved. |
| S9 / S10 — Client / Coach Flutter interfaces | Not implemented | Mobile source is a placeholder; approved backend policies and interface scope required. |
| S11 — Operational reporting and release evidence | Individual pages exist; wider reporting/release work remains | Source contracts, retention, O-11–O-14 operations and separate go-live approval. |

S1-B1 merge: `1fb9c220a4f234f3eb21d87019376b95b7635c7a`; reviewed feature:
`4630462f807a9e729e66c0d338d752eb9b1c56ee`. Squash and feature trees match exactly.
Foundation CI passed on the merge; this checkpoint reran 11 database-free unit
tests and inspected existing integration/browser evidence. Production migration
remains unapplied under the recorded task history; deployment remains unauthorized
and was not performed. No production environment was inspected.

**Readiness:** These completed development slices do not establish **Usage Testing
Ready** for the full platform; an approved bounded test journey, environment,
fixtures and acceptance review remain necessary. **Production Ready is not
established**: onboarding, attendance/ledger, delivery, retention and operational
release gates remain. No new implementation is in progress in this checkpoint.

## Evidence-based application inventory

“Implemented” below means the stated capability exists, not that the whole module
or production release is complete. Older milestone reviews describe their dated
baselines; current source, schema, tests and bound routes determine this inventory.

| Area | Implemented evidence | Partial, absent or blocked |
|---|---|---|
| Client management/onboarding | `src/clients`: paginated directory, profile and Client own-profile reads; dashboard directory/detail, Admin-only display-name editing and explicit existing account disablement (S1-B1). Active verified-account login and refresh in `src/identity`. | Client creation/invitation, self-registration, verification and recovery routes remain O-02-gated stubs. No reactivation or expanded Staff write authority. |
| Packages/Memberships | `src/catalog`, package/version/session-type models and dashboard CRUD/history; frozen purchased terms; concurrent Memberships with no per-client single-active constraint. | Private offers, pricing composition and wider lifecycle work remain separate. No general Membership-management dashboard. |
| Activation/payment/installments | Purchase acceptance APIs with agreement evidence and positive-price/SAR 0 paths; `src/payments` record/Admin verify/allocate; funding/activation UI. S1-A `/commercial` supplies the Admin positive-price entry-to-explicit-activation journey and scoped audit history. | No SAR 0 entry UI in S1-A. Activation remains activation-date based; future-effective starts, extensions, suspension and termination are not implemented. No installment, client-credit, refund or receivable models. Staff acceptance/delegated verification are not enabled by the existing action map. |
| Coach management/assignment | Coach profiles and active-Coach picker; Admin manually assigns and reassigns scheduled sessions, with overlap checks; Coach own-session reads. | No operational Coach provisioning/profile/availability-request workflow. Manual assignment exists; do not rebuild it as automatic matching. |
| Booking/scheduling | `src/bookings`, `src/scheduling`, dashboard workspaces; exact Membership selection; Admin pending/approve/reject/cancel; capacity and Membership commitment locks; session revision/conflict checks. | No Client self-booking, waitlist, timed holds or rescheduling-request workflow. Confirmed commitments include past non-cancelled Bookings; they are not consumed-unit postings. |
| Attendance | `src/attendance`: assigned-Coach ATTENDED submission, Admin per-participant return, exact-reason acknowledgment/reaffirmation, paginated immutable history, dashboard and OpenAPI. | Production-gated; no acceptance/verification, alternative outcomes, editable details or debit. O-09-A–G remain relevant. |
| Entitlement/session ledger | `Membership.initialSessionAllowance`, validity dates, frozen SESSION/TIME terms and audited activation. Booking code counts confirmed commitments. | **No canonical usage ledger, initial-grant entry, verified-use entry, adjustment/reversal or balance API exists.** A field named allowance is not a ledger. |
| Admin operations/reporting | Catalog, Client, funding/activation, scheduling, booking and attendance pages. | No consolidated operational queue, reconciliation/usage reports, export contract or general reporting service. Financial/commission boundaries must remain explicit in future projections. |
| Notifications | Socket tickets and access invalidation support authenticated connection control. | No durable inbox/outbox, SMTP worker, attendance notification or reminder delivery. Socket invalidation is not a delivery system. O-11 and O-09-D gate notification work. |
| Staff accounts/permissions | `staff-grants` Admin command, action map, current-role/grant checks, session invalidation and tests; non-Admin disablement. | No account-provisioning/permission-management dashboard. Dormant legacy enums do not enable attendance, booking, activation, allocation or commission access. Admin lifecycle remains gated. |
| Audit/traceability | Shared audit writer, append-only runtime privileges, request IDs, idempotent Commands, scoped package audit read, Booking/attendance audit events. | General operational audit viewer, export/retention and source-linked service/finance correction views remain future work. |
| Client mobile | `apps/mobile/README.md` defines later Flutter interface boundary. | No Flutter application or SDK dependency, secure credential store, Member home, booking or ledger UI exists. Backend own-profile read alone is not a mobile app. |
| Coach mobile | Backend own-session/attendance contracts can be reused. | No Flutter Coach schedule, roster, return or reaffirmation UI exists. No commission or unrelated financial API may be added for Coach convenience. |

Evidence roots: `apps/backend/src/app.ts`, controllers/services and action map;
`apps/backend/prisma/schema.prisma` and its ordered migrations (including the
narrow S1-B1 profile-maintenance migration); dashboard route/relay
implementations and integration/browser tests; mobile README; and
[implemented API contracts](api-contract.md). No production records were inspected.

One additional future renewal question is **M3-N02**: current purchase partial
unique indexes and the API contract forbid accepting the same package version
again for the same Client/type, even with a new request key. Preserve that current
duplicate protection in S1. A repeat-purchase/renewal journey needs an explicit
cardinality/idempotency decision before any constraint is changed; do not infer
renewal support from multiple concurrent Membership support.

## Proposed sequence and approval gates

Prioritize a usable journey over a new collection of tables. Existing-client
commercial operations can proceed without waiting for O-09. Onboarding can advance
as its O-02 choices are settled. Entitlement design/reconciliation must precede any
attendance verification/debit implementation. Every slice below still needs its
own short plan, review and implementation authorization; do not run the list
automatically after approval of this document.

### S1 — Existing Client purchase → funding → explicit activation

**Objective/roles/journey:** Admin finds an existing Client, selects an eligible
published public package version, records exact agreement/purpose, records a
manual receipt, verifies it, explicitly allocates it to the purchase, then
separately confirms activation. Include SAR 0 issuance and the existing reasoned
partial-funding activation behavior. Never activate when a payment is recorded.

**Current status:** S1-A is completed and merged through PR #4 for the positive-price
Admin journey, with `/commercial`, secure relay, scoped audit and regression tests.
S1-B1 is completed and merged through PR #5 for existing Client maintenance. The
broader original S1 proposal also included SAR 0 entry UI; that remains future
scope and is not claimed complete by S1-A. The primary next recommendation is
S2 / O-02 decision closure and contract review; no next-slice implementation is authorized.

**Layers/contracts:** Reuse existing purchase, payment, funding and activation
DTOs/endpoints in [the API contract](api-contract.md). Backend additions only if
bounded discovery/lookup is needed, proposed explicitly first; no financial state
redesign. DB: no migration expected for the existing single-package public purchase
contract. Dashboard: entry forms, returned identifiers, review screens and replay/
conflict states in the secure relay. Mobile: none in this Admin-only slice; later
Client summaries use dedicated own-data contracts, not these Admin routes.

**Security/audit/tests:** Keep `purchase.accept_record`, recording, Admin verification,
allocation, funding read and activation independently authorized. All writes retain
CSRF/Origin/Host, bounded JSON, idempotency, transactional audit and current backend
rules. End-to-end tests cover positive/SAR 0, partial funding with explicit reason,
no automatic activation, stale/replayed commands, wrong Clients and all denied roles.
**Dependencies/decisions:** Existing contracts; any new price, installment, credit,
delegated Staff or cancellation behavior remains excluded under O-03/O-04/O-17.

### S2 — Client account setup and recovery

**Objective/roles/journey:** Admin creates a Client or enabled self-registration
creates a pending Client; the person proves email/setup-token ownership, gains
approved access and can recover credentials without exposing another account.

**Current status/layers:** Read/login infrastructure and token-purpose primitives
exist; creation/registration/verification/recovery are stubs. Backend: purpose-bound,
expiring single-use tokens, collision handling, abuse controls, state transitions,
revocation and registration switch. DB: migration only after token/state contract
review. API: replace specific O-02 stubs with versioned DTO/error contracts; no
generic role-creation endpoint. Dashboard: Admin setup and outcome states. Mobile:
Client setup/login/recovery screens when the interface slice is authorized; share
server transitions rather than duplicate policy.

**Security/audit/tests:** Verified active access, no enumeration or token leakage,
single-use races, expired tokens, replay, account collision, disabled registration,
session revocation and auditable sensitive transitions. Delivery transport is a
separate O-11 dependency; no fake successful invite before durable delivery/setup.
**Gate:** O-02 setup channel, activation-after-verification and initial Admin/
recovery responsibilities. Public onboarding cannot be silently enabled.

### S3 — Staff/Coach operational provisioning and manual assignment

**Objective/roles/journey:** Admin provisions an explicitly typed Staff/Coach
account, completes approved setup, assigns independent grants or a Coach profile,
then manually schedules a session with that active Coach. Disablement revokes access.

**Current status/layers:** Grant/disable commands, Coach profiles/picker and manual
scheduling already exist; provisioning and account-management UI do not. Backend/DB:
review account-type/setup contracts, preserve profile ownership and grant history;
do not repurpose Client-only invitation. API: proposed Admin provisioning/profile
routes plus existing grant/disable/schedule routes, reviewed before binding.
Dashboard: Admin account and grant controls; reuse manual Coach assignment. Mobile:
no administrative controls; Coach receives only approved setup/login capability.

**Security/audit/tests:** No Staff self-grant, role escalation, Admin disablement
bypass or legacy-grant activation. Test each action independently, assignment
eligibility, concurrent revocation and audit/replay integrity. **Gate:** O-02 account
setup/Admin lifecycle and explicit Staff/Coach provisioning contract. Do not infer
availability automation or change approved manual assignment.

### S4 — Membership service lifecycle with an operational review queue

**Objective/roles/journey:** Admin reviews a Membership, explicitly extends or
suspends/resumes/terminates it under approved policy, sees affected confirmed
Bookings, and makes separate service decisions. No automatic financial refund.

**Current status/layers:** Activation/validity exists; status enum currently has
only PENDING_ACTIVATION/ACTIVE. Backend: one shared effective-eligibility function,
immutable lifecycle events and versioned validity; approved dated transitions.
DB: reviewed lifecycle/event migration and explicit original-versus-effective dates.
API: proposed reasoned Admin lifecycle commands and scoped history/projections.
Dashboard: dates, history and affected-Booking review; mobile later receives only
own/assigned eligibility summaries, not privileged adjustment controls.

**Security/audit/tests:** Exact Membership scope, current authorization under lock,
Riyadh final-day/midnight boundaries, explicit post-expiry extension, concurrent
booking/lifecycle commands, no automatic grace/refund, original evidence preserved.
**Gate:** Approved O-07 core must be translated into exact transitions; O-08
confirmed-Booking consequences and O-09-C/E service-time/cancellation interactions
remain open. Do not let a new projection independently redefine Booking policy.

### S5 — Admin attendance verification and exact-Membership usage

**Objective/roles/journey:** Admin opens one pending participant revision, reviews
its immutable evidence and selected Membership, sees eligibility/balance/conflicts,
then verifies it with the approved session consequence atomically. Coach/Client
sees only an authorized operational result. A conflict leaves all evidence and
balances unchanged. This must be one complete verification-and-accounting journey,
not a verified flag followed by a later debit job.

**Current status/layers:** Submission/return/reaffirmation exist; verification and
ledger do not. Backend/DB: implement only the separately approved design below,
once-only initial grants/backfill, effective decisions, usage source uniqueness and
membership-before-session locks. API: proposed Admin-only verification command
with expected revision and policy plus scoped balance/history reads; review exact
DTOs before binding. Dashboard: preview, confirm, conflicts and linked history.
Mobile: result/balance views through scoped APIs; no Coach/Client verification.

**Security/audit/tests:** Transactional decision+ledger+audit+retry result; last-unit
races across sessions, same/different-key replay, stale decisions, wrong-Membership
FKs, multiple independent Memberships, TIME with no unit debit, cancellation and
expiry policy, migration/backfill reconciliation and append-only roles. Confirmed
commitment and consumed use must not be counted twice. **Gate:** O-09-A/B/C/E,
ledger/reconciliation approval, relevant lifecycle evidence and explicit slice
authorization. Production gate remains closed even after local implementation.

### S6 — Installment plan and manual servicing

**Objective/roles/journey:** Admin records an explicitly agreed installment plan,
manually allocates eligible funds, sees due/overdue amounts, and reasonedly revises
a due date without losing the original plan. Client later sees only their plan.

**Current status/layers:** Receipt verification/purchase allocation exists; no
installment model. Backend/DB: immutable agreed schedule plus due-date/allocation
events, exact source/target scope and decimal reconciliation. API: proposed Admin
plan/servicing commands and own-summary reads; preserve current purchase allocation
semantics while defining any compatibility migration. Dashboard: schedule entry,
allocation selection and overdue queue. Mobile: own read-only plan after scope review.

**Security/audit/tests:** Independent financial actions, manual allocation only,
replay/over-allocation races, price/receivable invariants, date-change reasons and
source history. No automatic payment request or activation. **Gate:** O-01/O-03/
O-04/O-17 and M2-T01 installment/price/evidence contract closure.

### S7 — One source-linked financial correction/credit/refund path at a time

**Objective/roles/journey:** Start with a narrowly approved Admin receipt correction
or cash-backed refund case: inspect source, authorize, record actual payout/evidence
and reconcile uncertainty, preserving original payment, debt and separate service
review. Do not ship all credit/refund variants as one unreviewable change.

**Current status/layers:** None of credit/refund/receivable-ledger models exists.
Backend/DB: approved typed event and reservation/reconciliation contracts;
same-source, same-Client/currency references, bounded effects, durable posting keys.
API: proposed case-specific commands; provider/manual payout outside the database
transaction. Dashboard: explicit approval, payout evidence and uncertain/failure
states. Mobile: later own balance/history only; no refund execution authority.

**Security/audit/tests:** Admin-only authorization, source availability races,
duplicate/uncertain payout, no automatic debt reduction or Membership unit change,
linked reversals and reasoned adjustments. **Gate:** O-04/O-05/O-07/O-17 and
M2-T01/T04. Credit-conversion trigger/manual-credit refund provenance remain owner
questions, not assumptions hidden in a ledger migration.

### S8 — Durable operational inbox, then approved external delivery

**Objective/roles/journey:** A permitted user receives one actionable inbox item
for an approved event, opens the authoritative record and marks it read; operators
can inspect delivery failure without duplicating the business event.

**Current status/layers:** No inbox/outbox/worker. Backend/DB: transactional inbox/
outbox, deduplication, bounded worker claims, retries and failure visibility under
approved infrastructure. API: recipient-scoped inbox/read commands; socket hints
remain optional invalidation, never authoritative storage. Dashboard/mobile: own
inbox only. Email comes later only for approved essential categories/provider;
push/SMS remain deferred.

**Security/audit/tests:** Wrong-recipient denial, no sensitive/commission payload
leaks, atomic outbox, worker crash/replay/Redis-loss recovery and failed delivery
without business rollback. **Gate:** O-09-D/O-11 recipients/categories, transport,
domain, operations and failure policy. No delivery is enabled by this roadmap.

### S9 — Client mobile: secure access → own Membership → permitted booking

**Objective/roles/journey:** Client completes approved login/setup, sees independent
own Membership validity/units and explicitly chooses the eligible Membership when
requesting a session. Pending request reserves nothing; Admin confirmation reserves
approved capacity/commitment; Client sees the result and own history.

**Current status/layers:** No Flutter app; own-profile and auth APIs exist, but
Booking writes are Admin-only. Backend: reuse canonical eligibility/commitment/
ledger services through proposed scoped Client request/read APIs; never relax Admin
routes or duplicate policy in Flutter. DB: only reviewed request/history needs.
Dashboard: reuse Admin booking review. Mobile: Keychain/Keystore-backed refresh
storage, in-memory access token, logout/replay handling, own views and selection.

**Security/audit/tests:** Cross-Client/Membership denial, pending-versus-confirmed
capacity races, revoked credentials, secure storage, deep links and privacy; no
Coach/Staff commission access. **Gate:** O-02 onboarding, O-08 Client limits/
cancellation/request contract and S4/S5 projections as applicable. A read-only own
Membership release can be proposed first if booking policy remains unresolved.

### S10 — Coach mobile: assigned schedule → attendance → return response

**Objective/roles/journey:** Coach opens only assigned sessions/rosters, submits
selected confirmed participants, reads the exact Admin return reason and explicitly
reaffirms ATTENDED. Prior revisions remain visible; no financial or commission view.

**Current status/layers:** Backend/dashboard contracts exist and remain gated;
Flutter does not exist. Backend/DB: reuse existing attendance commands with any
approved deadline work from A; no new outcome or editable field. API: the existing
own-session/history/submit/return-response contracts, with server clocks and
idempotency preserved. Dashboard: existing Admin review, no duplicate rule engine.
Mobile: shared secure auth shell, explicit reason acknowledgment and same-key
retry/conflict handling.

**Security/audit/tests:** Served-Coach/frozen attribution, other-Coach denial,
account switch/revocation, cancelled and stale records, offline/unconfirmed retry
without automatic successful submission, append-only history and zero debit before
Admin verification. **Gate:** O-09-A for production and the approved mobile scope;
test-environment prototypes still need slice authorization.

### S11 — Admin operational reporting and release-readiness evidence

**Objective/roles/journey:** Admin sees actionable pending/returned/verified and
reconciliation queues, drills into source records, and can distinguish confirmed
commitments, verified use, expiry and unresolved exceptions. Separate release work
proves restore/rollback and operational ownership before any go-live authorization.

**Current status/layers:** Individual operational pages/audit events exist; general
reports do not. Backend/DB: bounded consistent projections from canonical sources,
indexes only where measured; no report-maintained balances. API: proposed explicit
Admin report/audit/export actions and redacted DTOs; legacy report enums alone grant
nothing. Dashboard: filters, drill-down and approved exports. Mobile: own summaries
only, never the Admin finance or commission report surface.

**Security/audit/tests:** Role/field/export denial, snapshot/aggregate reconciliation,
pagination, original source links and approved export audit/retention. Release
evidence includes isolated restore/load/rollback tests and assigned operators;
this phase never deploys or runs production migrations. **Gate:** Each report's
source feature, O-09-G retention and O-11–O-14 infrastructure/release decisions.
Commission distribution remains a separately approved O-10 Admin-only slice;
branches and online gateways remain excluded.

## Entitlement design review required before S5

The following is a **technical proposal**, not an implemented or approved ledger.
Read alongside M2-T03/T04, O-07/O-08 and O-09-B/C/E/F. Authorize the design and its
migration/reconciliation plan before any balance or verification command is added.

### Existing representations and reconciliation needs

* `PackageVersion.sessionAllowance` and the immutable `Purchase.terms` snapshot
  describe SESSION quantities; TIME has null session allowance.
* `Membership.initialSessionAllowance`, `activatedAt`, `validFrom`, `validThrough`
  are set during explicit Admin activation. `MEMBERSHIP_ACTIVATED` audit stores
  purchase/Membership, dates, allowance, funding and override evidence. Activation
  currently creates no ledger entry; SAR 0 issuance alone is not an activated grant.
* Booking choices/approval count **all confirmed non-cancelled-session Bookings**
  for that exact Membership, including past unverified ones, against initial
  allowance. Pending Bookings reserve no seat/unit commitment. No unit debit exists.
* Attendance has immutable submissions and RETURNED decisions only. An ATTENDED
  submission/reaffirmation is never evidence of Admin verification or a debit.
* There are no existing refund, expiry-posting, entitlement-adjustment or accepted
  attendance source tables. Do not infer balances from model names in future-state
  diagrams. No production data census was performed during this investigation.

Before migration, perform a read-only census in an explicitly authorized environment:
classify pending/active SESSION/TIME Memberships, compare frozen terms and activation
audit with stored dates/allowance, enumerate confirmed/cancelled/past Bookings and
attendance, and quarantine any mismatch or missing source. Produce per-Membership
before/after projections and signed reconciliation totals. Never automatically
mark historical submissions verified or debit them to make totals fit. Unverified
historical commitments need an approved resolution, not silent deletion/release.

### Proposed canonical sources and invariants

1. **One accounting source.** An append-only, exact-Membership ledger uses typed
   immutable grant/use/authorized-adjustment/reversal sources with restrictive
   references and a durable source/posting uniqueness key. Define the typed
   activation event or reviewed legacy activation-audit bridge; do not attach
   anonymous initial units to a migration run. Cross-source nullable-shape checks
   and same-Booking/Membership integrity belong in the reviewed FK/SQL design.
2. **Initial grant exactly once.** For each eligible activated SESSION Membership,
   create one grant matching approved activation evidence/frozen terms, with
   effective service dates and recorded migration time distinct. Backfill is
   repeatable without duplicates. Do not issue a second grant when adopting an
   existing activated Membership, accept a pending Membership, or grant numeric
   units to TIME. Existing allowance becomes evidence/projection, not a second
   independently spendable balance. Version the shared read path at cutover.
3. **Effective verification and usage.** A verification references the exact latest
   participant revision, Admin and applied policy. SESSION charging quantity
   (proposed one unit for normal verified ATTENDED) must be approved; TIME posts
   no numeric debit. Decision, usage entry, effective-source linkage, audit and
   retry result commit together. A returned/pending item posts zero usage.
4. **No double-counted commitments.** Under an approved eligibility/expiry policy,
   `freeToConfirm = eligibleLedgerBalance - outstandingConfirmedCommitments`.
   A commitment is a confirmed eligible Booking whose service is not already
   accounted for by effective usage; pending Bookings never count. Verification
   atomically accounts for that Booking while posting its usage. Example: grant
   10, confirmed 3 gives free 7; verify one → balance 9 and outstanding commitments
   2, still free 7. Subtracting the debit and all three confirmed Bookings would
   incorrectly make free 6. Preserve occupancy separately from unit accounting.
5. **Same Membership and global lock order.** Discover immutable Booking references,
   then lock identity/session/idempotency, exact Membership, scheduled session,
   participant/revision, using established entity/ID ordering. Re-read references,
   state and policy after locks; sample database time then. Never obtain the
   Membership lock after a session lock in a verification writer. Concurrent use
   across different sessions must serialize on that Membership's final unit.
6. **Retry and conflict semantics.** HTTP idempotency replays a matching immutable
   outcome, but durable source/decision uniqueness also prevents a new-key double
   debit after HTTP key expiry. Reject stale revision, mismatched Membership,
   cancelled/ineligible service and insufficient units without partial writes.
   Recheck current authorization/scope on replay; bounded transaction retries
   retain the original key. No separate asynchronous debit step.
7. **Expiry/refund/adjustment.** Keep original grant/use records and their effective
   validity. Unused units are unavailable after approved expiry; do not delete
   evidence. Review whether expiry needs a signed event or an eligibility boundary
   and how explicitly approved extensions affect it; do not silently revive units.
   Refund/cancellation creates no automatic credit, debt change or unit restoration.
   Only a separately approved, reasoned service adjustment can append a linked
   same-Membership consequence. Negative balances/automatic switching remain barred.
8. **Accepted corrections.** A later accepted change uses the approved difference
   from the previous effective charge and links original/adjusting sources. A
   return or pending revision leaves the effective accepted result intact. Never
   charge the full quantity again for an amended revision. This is future F work,
   not a reason to add VERIFIED behavior to today's RETURNED-only table now.
9. **Acceptance evidence.** Require dry-run/replayable backfill, fresh/upgrade
   migration tests, DB role/FK/unique checks, two-Membership independence, two last-
   unit verifications, booking-versus-verification races, expiry/cancellation and
   reversal cases, atomic audit rollback, balance/commitment/report reconciliation,
   and a rollback plan that preserves all evidence. Owner approval of this design
   and the relevant policy is an explicit gate, not implied by a ready endpoint.

## Work independent of pending business decisions

This increment safely completes synchronization, closeout evidence, exact-version
verification, evidence-based browser-test reliability work and the decision/roadmap
documents. Existing APIs can support a proposed S1 Admin operations UI without
new O-09 policy; an implementation plan and authorization are still required.
Read-only source/data-shape design, isolated verification/restore drills and
technical contract reviews can also be proposed independently. No dependent
onboarding, ledger, verification, notification or production work starts while its
required decision or authorization is pending.


## S2-A authorized implementation checkpoint — 27 November 2026

S2-A Admin Client onboarding is **IMPLEMENTED LOCALLY — UNCOMMITTED** with isolated
fake-transport and Chrome verification. This later checkpoint supersedes the
planning-only readiness above for this bounded slice; it does not complete all S2.
Admin manual link → separate email proof → password setup → ACTIVE follows the
approved boundary with no commercial/service effect. [Report and evidence](s2a-onboarding-implementation.md);
[current API](api-contract.md#implemented-s2-a-admin-client-onboarding).

Self-registration, recovery, non-Client provisioning, identity correction/restart
and production bootstrap remain deferred. There is no default real email provider
or scheduled sender; real-email usage/production readiness is not established.
Next action is owner review of this implementation, not automatic next-feature
work. Commit/push/PR/migration-to-production/deployment remain separate gates.
