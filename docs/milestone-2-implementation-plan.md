# Milestone 2 implementation plan

Review date: 7 November 2026. **Proposed plan only. No source changes, schema, migrations or enabled workflows are delivered by this review.** Business defaults below depend on the [decision register](milestone-2-decision-register.md). The [readiness review](milestone-2-readiness-review.md) states the implementation gate.

## Scope and modules

Keep the approved Flutter client, Next.js dashboard on Vercel, NestJS modular monolith REST API, Socket.IO, PostgreSQL/Prisma, Redis/BullMQ, Hostinger KVM1, Nginx and TLS. M2 is primarily backend/API work. Full mobile/dashboard workflow screens, reports/exports UI and delivery remain Milestone 4. No online payment gateway, booking, attendance, commissions or branches are added.

Foundation currently wires controllers/providers in one Nest application (`src/app.ts`), rather than separate implemented commercial Nest modules. Add ordinary in-process feature modules; do not introduce service decomposition or a generic workflow engine.

| Proposed module | Responsibility | Dependencies |
|---|---|---|
| Catalog | Packages, drafts, immutable publication, public/client-private views, minimal session-type reference catalog | Current identity, settings/policy, audit and command transaction |
| Purchases | Requests, exact-version acceptance, assisted recording, immutable item snapshots and installment schedules | Catalog, finance account/posting service, membership issuance |
| Finance | Accounts, receipt identity, payments/verification, lots, allocations, balances, credit conversion, reversals and purchase adjustments | Current identity, policy, audit/idempotency; purchase references |
| Refunds | Request, reservation, execution claim, post/reconcile and review creation | Finance's shared lock/effect rules; membership review API inside the monolith |
| Memberships | Pending issuance, activation, lifecycle/validity/grace events, entitlement entries and reviews | Purchase items, locked finance funding query, policy |
| Existing platform/identity | Extend the action map, command inputs and audit vocabulary only as authorized during implementation | Retain current credentials, revocation, guards, request IDs, no-store and logging architecture |

Use a small shared finance posting service within Finance; Purchases and Refunds call it inside the caller's transaction. Membership issuance is an internal function invoked by purchase recording. Avoid bidirectional module orchestration: a purchase application command coordinates snapshot, charge and issuance; a refund command coordinates finance and review creation. No independent second ledger or allocation table.

Policy integration is necessary: Foundation's settings DTO currently accepts only timezone/default currency and stores empty rules. Later implementation must validate the approved commercial policy schema, reject missing values and attach its immutable revision to decisions. It must not interpret empty rules as approved defaults. Client onboarding remains gated by O-02; existing development fixtures can support isolated commercial development after implementation is authorized.

## Proposed domain entities

This is a design delta to the **proposed dictionary**, not a claim that these entities exist. Reuse the existing ten Foundation models. All domain FKs restrict deletion; UUIDs and creation instants follow the dictionary. Add necessary leading FK indexes, not speculative reporting indexes. Every consequential state transition commits operational audit in the same transaction, with actor/session, request ID, reason where required, safe old/new values and policy reference. Domain history is separate from an HTTP replay record.

### Catalog and agreement

| Entity / responsibility | Important fields and relationships | Lifecycle, integrity and indexes | Audit requirements |
|---|---|---|---|
| PACKAGE — offer identity | Code, visibility, optional client FK, archive timestamp; owns versions | Public iff client is null; private iff client exists. Unique code; index owner/visibility/archive. Freeze client/visibility after publication; archive rather than delete | Creation, draft ownership changes before publication, archive; never transfer published private history |
| PACKAGE_VERSION — published terms | Package FK, sequential version, based-on FK within package, kind, name/description, price/currency, validity days, session allowance, publication/supersession, proposed acceptance-expiry timestamp; optional list price and discount reason | Draft → published → superseded/archived for new acceptance. Unique package/version and one current published version; nonnegative price, positive validity and session allowance for session kind; allowance null for time kind. Launch purchase rule rejects zero price. All published business fields and eligibility immutable | Draft change, publication, successor and retirement; accepted content preserved |
| SESSION_TYPE — eligibility reference only | Code, name, individual/group mode, archive timestamp | Unique code; preserve referenced mode/history. Minimal classification in M2; no slots, capacity, coaches or attendance | Admin reference create/archive under catalog management |
| PACKAGE_VERSION_SESSION_TYPE — eligibility join | Version and session-type FKs | Composite PK; reverse type index; cannot change published links; require a valid explicit allowed set at publication | Covered by package publication audit, with version reference |
| PURCHASE_REQUEST — client acceptance proposal | Client FK, exact version FK, state, decision actor/time/reason; proposed acceptance-evidence reference for quoted terms | REQUESTED → ACCEPTED/REJECTED/WITHDRAWN. Client/state/created index and version FK index. At acceptance recheck owner, publication, expiry, supersession and price; no version substitution | Submission, withdrawal, rejection and acceptance, including actor and exact version |
| PURCHASE — contract/receivable source | Finance account/currency, optional request FK, recorder, immutable agreed total; proposed lifecycle/cancellation metadata and acceptance evidence | RECORDED → CANCELLED. Unique request; account/time index and unique scoped keys. One or more items structurally, exactly one at launch if O-03 approved. Atomic charge/item/membership issuance. Monetary settlement derived | Recording and explicit cancellation/adjustment; retain original amount and all evidence |
| PURCHASE_ITEM — agreed snapshot | Purchase/version FKs, line number, description/price/currency/validity/allowance snapshots; optional agreed discount evidence | Unique purchase/line. Currency matches purchase. Sum equals total; positive launch total. Use immutable published version for membership kind and allowed session types; do not duplicate those links. Reject updates/deletes after recording | Created with purchase; historical terms readable even after catalog archive |
| INSTALLMENT — receivable schedule | Scoped purchase FK, sequence, due date, amount, replaces FK, retirement | Positive portions; active purchase/sequence unique, replacement unique and same scoped purchase. Initial sum equals total; effective obligation includes targeted immutable charge adjustments. Index active due dates and purchase. Funded portions cannot be retired without explicit reversal/reallocation; original amounts remain immutable | Original schedule, linked replacements and targeted adjustment events, reason, policy and any reallocation events |

### Money and refunds

| Entity / responsibility | Important fields and relationships | Lifecycle, integrity and indexes | Audit requirements |
|---|---|---|---|
| FINANCE_ACCOUNT — serialization scope | Client FK and currency | Unique client/currency and id/currency. Created on first commercial operation. No overwritten balance. Lock before all aggregate validations | Creation through first purchase/receipt; subsequent money changes audited at source |
| RECEIPT_IDENTITY — proposed minimal B01 guard beyond dictionary | Normalized method/provider/receiving-account namespace and external identity or controlled cash receipt number; correction-chain root; optional effective verified-payment pointer | Unique studio-wide namespace/key, independent of client/amount. One identity may have original plus linked correction receipts; at most one effective verified chain member. Claim uniquely and lock on verification/reversal. Normalization deterministic. Duplicate detection must not disclose another client's record | Claim, correction linkage and effective-verification changes. Never delete to bypass duplication |
| PAYMENT — immutable reported receipt | Account/currency, receipt-identity FK, amount, received-at, method/ref, recorder, corrects FK, set-once verification event; proposed supersession marker | Recorded/unverified → superseded or verified, with effective verification later reversed through events. Facts immutable. Positive amount; scoped correction and one direct replacement. Unique verification link; account/received and identity indexes. Marker/pointer changes guarded; original verification pointer remains historical | Recording, replacement, verification and linked reversal evidence; no raw sensitive attachment data |
| CREDIT_LOT — funding provenance | Scope, source-payment FK, origin kind | One cash-backed lot per verified payment; cash origin requires payment. One origin event. No mutable balance. Original source retained through credit conversion/spending/refund | Creation with verification; movements audited through events |
| FINANCE_EVENT — append-only money movement AND allocation | Scope, kind, positive amount, effective-at, posted-at/created-at, actor, durable posting key/digest; lot/purchase/installment/refund/original-event FKs and bucket fields | Closed kind/reference matrix below; scoped FKs; unique account/posting key, lot origin and refund terminal cash posting; indexes account/lot/purchase/installment + effective time, refund and reversal. Runtime cannot UPDATE/DELETE postings. Cumulative reversal limits enforced under lock | Posting command reason/evidence and immutable event; distinguish service effective date from actual posting date |
| REFUND — manual cash return case and reservation | Scope and original payment/lot FKs, requested/approved amounts, kind/state, decision actor/time, proposed frozen bucket, reserved amount, execution token/actor/time, evidence ref, actual paid/released amounts | REQUESTED → REJECTED or APPROVED_RESERVED → EXECUTING → POSTED or RECONCILE_REQUIRED; approval may VOID only on evidence of no payment. Unique execution token; one terminal cash event. Payment/state and lot/state indexes. Approval fixes source/bucket/amount; reservation remains until proven post/void/reconciliation. Payment and lot must match | Append transition/evidence audit; preserve approved versus actual. Never erase an execution attempt or overwrite the original receipt |

RECEIPT_IDENTITY is the only new money aggregate beyond the dictionary and solves a concrete audit blocker. Reusing only HTTP idempotency keys cannot solve it. Preserve scoped correction FKs: cross-client/currency correction/reassignment is not an ordinary command; reject it rather than silently moving financial history. A later explicitly authorized cross-account reconciliation would need its own sorted account lock set and evidence.

The current refund projection may hold its latest state, but its approved source terms freeze on reservation. Existing append-only operational audit records each state/evidence revision, including reconciliation observations, while immutable finance events record actual monetary effects. This avoids an extra refund-history table. Store a stable evidence reference and safe metadata, not uploaded files or secrets.

### Membership and entitlements

| Entity / responsibility | Important fields and relationships | Lifecycle, integrity and indexes | Audit requirements |
|---|---|---|---|
| MEMBERSHIP — current lifecycle/validity projection | Unique purchase-item FK, client FK, lifecycle, starts-at, valid-until | PENDING_ACTIVATION → ACTIVE → SUSPENDED/ACTIVE or CANCELLED; pending can cancel. Expiry/exhaustion derived, not destructive state changes. Unique id/client; client/state/validity index. Ownership derives through purchase/account. No unique active-client rule if O-16 approved | Every authorized lifecycle change references its event; no silent expiry write needed |
| MEMBERSHIP_EVENT — immutable authorization | Membership, actor/policy, kind/effective-at/reason, funding basis/evidence event/amount/currency, old/new validity, review FK; proposed grace starts/ends and revokes-event FK | One activation per membership; exactly the appropriate evidence branch for funded activation or Admin exception; grace interval valid, overlaps/revocation checked under membership lock. Grant/suspension/reinstatement/cancellation/extension/grace events never edited. Index membership/time, review and evidence | Event itself records authority; matching operational audit identifies command/request. Retain evaluated historical funding even after refund |
| ENTITLEMENT_REVIEW — explicit service consequence of finance change | Membership FK; refund FK or proposed funding-reversal-event FK; state/outcome, reason, decision actor/time | Exactly one financial source; unique source/membership; same client and affected purchase. PENDING → RESOLVED once, with no-change, lifecycle/validity or unit-adjustment outcome. Create when funding changes affect an activated membership; no automatic cancellation | Opening, decision and any resulting membership event/entry atomically; source finances remain untouched |
| ENTITLEMENT_ENTRY — immutable signed session-unit ledger | Membership, signed integer delta, kind, source membership-event or review; linked reversal | Nonzero; exactly one valid source. Unique source and full-reversal link; reverse original membership once by exact opposite units. Under membership lock, prevent negative launch balance for discretionary adjustments. Initial grant once and only on activation. Index membership/time and source FKs | Append adjustment/reversal and authority/reason; time packages have no unit rows |

Do not create ATTENDANCE or ATTENDANCE_VERIFICATION tables in M2 solely to satisfy a nullable future FK. M2 supports only membership-event and review sources. The dictionary's third authorized source is introduced with its actual FK and exactly-one-source check in Milestone 3. Provide a narrow internal posting interface requiring source type/ID, membership, units and posting uniqueness; future accepted attendance supplies its real source. Do not accept arbitrary external entitlement sources from API callers.

Existing POLICY_REVISION, AUDIT_LOG and IDEMPOTENCY_KEY are reused. Later implementation needs approved typed policy rules, commercial audit action/target values, safe reason support, and canonical command identifiers for different operations sharing one permission. Preserve Foundation replay identity for existing routes; add operation names for new commands without changing authentication or revocation semantics. There is no outbox/delivery implementation prerequisite when M2 emits no notifications or socket business events.

## Finance event contract (proposed)

This matrix closes the technical ambiguity in audit B02 if accepted at design review. Amounts are positive decimal values; event kind determines direction. Let:

- `V` = effective verified receipt origins less verification-error reversals; `R` = posted cash refunds.
- `A` = allocations less linked allocation reversals, across unapplied and credit source buckets.
- `Q` = initial purchase charge plus explicit charge adjustments (increases minus decreases).
- `U`, `C` = event-derived unapplied and credit balances. Active reservations reduce their spendable amounts, without being counted as cash already returned.
- Purchase outstanding = `Q - A`. Installment outstanding = original scheduled amount plus net charge adjustments targeting it, minus net allocations targeting it. With a schedule, every later charge adjustment must target an installment and the sum of effective scheduled obligations must equal Q. Installment allocations are included in purchase `A` exactly once.
- Cash held from recorded verified receipts = `V - R`; money must reconcile as `V - R = A + U + C` per cash-backed account. Reservations are subsets of U/C, shown separately. No FX or noncash credit origins are enabled by default.

| Kind | Required references / forbidden extra references | Effects | Reversal/correction |
|---|---|---|---|
| PURCHASE_CHARGE | Purchase; no lot/buckets/installment/refund/original-event | Increase Q; no cash effect | Reasoned Admin purchase adjustment, not editing charge |
| PURCHASE_INCREASE / PURCHASE_DECREASE | Purchase and original charge/adjustment reference; installment required if scheduled, absent otherwise; no lot/buckets/refund | Change Q and targeted installment obligation only; validate Q ≥ A and adjusted installment obligation ≥ its net allocations, with schedule consistency after entire command | Linked compensating adjustment, with cumulative remainder limits; cannot masquerade as a cash refund |
| VERIFY_RECEIPT | Cash lot tied to payment; target UNAPPLIED; no purchase/installment/refund/source bucket | Increase V and U | VERIFY_RECEIPT_REVERSAL only after all dependent money/reservations are resolved |
| ALLOCATE | Lot, purchase, source UNAPPLIED or CREDIT; optional installment; no refund/target bucket/original-event | Decrease source bucket; increase A; reduce purchase and optional installment outstanding | ALLOCATION_REVERSAL restores exactly original source bucket; bounded partial reversals allowed |
| ALLOCATION_REVERSAL | Original ALLOCATE plus same lot/purchase/installment and restored target bucket; source bucket absent; optional refund context | Decrease A; restore original bucket; reopen receivable | Correct a mistaken reversal with a new explicit allocation; never mutate the reversal |
| CONVERT_TO_CREDIT | Lot; source UNAPPLIED, target CREDIT; no purchase/installment/refund | U decreases and C increases; V and Q unchanged | LINKED_CONVERSION_REVERSAL restores only unspent, unreserved remainder to UNAPPLIED |
| LINKED_CONVERSION_REVERSAL | Original conversion, same lot, source CREDIT, target UNAPPLIED; no purchase/installment/refund | C decreases and U increases | Bounded by original conversion remainder and available credit; no arbitrary credit issuance |
| CASH_REFUND | Approved refund and original lot, frozen source bucket; no target bucket/purchase/installment | Decrease bucket and increase R by proven actual payout; release matching reservation atomically | A real payout is never undone by an administrative “unrefund”; new incoming money is a new receipt |
| VERIFY_RECEIPT_REVERSAL | Original VERIFY_RECEIPT, same lot and source UNAPPLIED; no purchase/installment/refund/target bucket | Decrease V and U for a proven recording error, not returned cash | Default whole remaining origin only, after allocations/conversions undone and no refunds/reservations. Replacement receipt remains in root identity chain |

Refund-triggered allocation reversals may carry `refund_id` as context; they are not terminal cash postings. A refund can need several reversals, hence no unique refund constraint on every event—only on CASH_REFUND. A linked adjustment's original-event reference is same purchase/scope and valid kind; event self-reference is not a generic permission to reverse any kind. Freeze the complete per-kind SQL CHECK/reference rules and amount equations before migration, including fields that must be null. No finance endpoint accepts an arbitrary kind/references object.

No receipt can have posted cash refunds plus active reservations above its effective verified amount. A lot's spendable bucket is event balance minus reservations in that bucket. A purchase cannot be allocated more than its adjusted charge; installments cannot be overfunded. Verify all cumulative limits under the account lock. A reservation is represented once by the refund state/frozen amount, not an additional money event and not an extra account balance.

**Worked acceptance example.** Record/verify 120 against a 100 purchase with installments 60/40. Allocate 60 and 40: V=120, A=100, U=20, outstanding=0. Convert the excess to credit: U=0, C=20. For a 30 cash refund, Admin explicitly reverses 10 of the original installment allocation to U, reserves 10 U and 20 C as **two separate refund cases** because each case freezes one source bucket (same receipt), and posts 10 and 20 with evidence. Final V=120, R=30, A=90, U=C=0; purchase outstanding=10. A separate 10 purchase-decrease event targeting the originally 40 installment makes its effective obligation 30 without editing the original schedule row; this can forgive the reopened 10. The refund alone cannot. The membership remains historically activated and awaits explicit review. If multi-bucket refunds are later desired, add reservation lines deliberately; do not overload one ambiguous bucket field at launch.

The example's two refund cases also require cumulative receipt caps across cases. A full original-price refund is possible only to the extent of that receipt's remaining unreturned money; it does not imply the entitlement balance equals the money refunded.

## Transactions, constraints, and concurrency

Follow the [shared command transaction](business-rules.md#shared-command-transaction): READ COMMITTED, current actor/session FOR SHARE held through commit, canonical idempotency claim, policy lock, sorted account locks, then domain locks in documented order. Use current post-lock database time for expiry/acceptance checks, and fresh reads after waiting. Extend the order for the proposed receipt identity guard after FINANCE_ACCOUNT and before PAYMENT; all writers must use it. Package/version and purchase-request locks retain their existing place before payment/lot/purchase/installment/refund and membership locks. If necessary IDs change after discovery, retry with the correct lock set. Resolve a studio-wide identity uniqueness conflict with a scoped error, not another verified origin.

Never acquire a second account late in a command; allocation batches share one account, and any supported multi-account administrative reconciliation must discover and sort the full set first. Membership activation locks its finance account before membership, checks purchase/item ownership and evaluates all net eligible allocations. A cited allocation is an evidence anchor, not the funding total.

For every commercial write: domain mutation, posting keys, completed HTTP outcome and audit commit or roll back together. On a retry, recheck current authority and ownership before returning the old result. Normalized input includes command name, target IDs, amounts/currency and all allocation lines; a changed body is a conflict. Keep domain source/posting uniqueness after HTTP records expire. Financial commands must never invoke an external provider or wait for a human payout inside a transaction.

Use Prisma Decimal/database numeric arithmetic for money, not JavaScript floating-point arithmetic. Canonicalize equivalent decimal strings before digesting commands, validate the currency's input precision, and reject unrepresentable values. Decimal-string API responses preserve exact amounts.

Use scoped composite keys from the dictionary: account/currency; purchase/account/currency; installment/purchase/account/currency; payment/account/currency; lot/source-payment/account/currency for refunds; original-event/account/currency. Existence of a UUID is insufficient. Validate cross-FK source chains under lock, including membership → item → purchase → account/client and review → affected purchase. Add row-local checks, active-version/sequence partial uniqueness, one origin/activation/refund-posting constraints, and nonnegative/cumulative service validations as appropriate. Cross-row money sums require locking, not a CHECK pretending to read other rows.

Grant runtime SELECT/INSERT on append-only finance/history tables, no UPDATE/DELETE. Mutable projections receive only necessary column rights. PostgreSQL row locking still needs an UPDATE privilege on the locked table: plan a harmless guard column or tightly restricted existing mutable column where required, without granting updates to immutable money/terms. Review actual role behavior with negative DB tests. Keep non-runtime ownership and default privileges creator-specific. Do not add any private commission connection, grant or table to enable commercial finance. Reporting/worker roles remain denied private schema access.

## Proposed API inventory

All routes are relative to `/api/v1`; **none of the new routes is implemented by this review**. `A` = Admin, `S(action)` = Staff with exactly that independent named grant, `C-own` = owning Client. Coach has no M2 commercial access. Catalog is authenticated under the existing matrix; no anonymous listing is assumed. For grouped method/route rows, every listed route has the row's permission, validation, idempotency and audit requirements.

All reads use current authority and query-level scope, pagination, explicit allowlisted DTOs and no-store. Out-of-scope detail IDs return a consistent 404; denied actions return 403. No commission fields, identifiers, joins or aggregates appear. Every write marked Yes requires `Idempotency-Key` and produces one committed audit event per actual operation, not per replay. Audits below are proposed commercial action names, not current enum members. Exceptions, validation failures and denied requests do not create successful domain outcomes.

### Catalog

| Method / route | Permission and scope | Operation / important validation | Idempotency | Audit |
|---|---|---|---|---|
| GET `/packages`; GET `/packages/{id}/versions/{versionId}` | `catalog.read`: A, S(public published), C(public published + own eligible private) | Published view; exact package/version relationship, owner, enabled visibility and acceptance window; no draft leakage | No | No |
| GET `/packages/{id}/management` | A with `catalog.manage` for public / `catalog.private.manage` for private | Draft/history management projection. Staff management-read scope remains gated under O-06; do not broaden catalog.read | No | No |
| POST `/packages` | A/S(`catalog.manage`) public; A/S(`catalog.private.manage`) private, with no private Staff grants recommended at launch | Create draft identity/version; positive duration, kind/allowance consistency, currency, private owner and price authority | Yes | CATALOG_CREATED |
| POST `/packages/{id}/versions` | Same public/private manage split | Create draft successor or client quote; same package base-version relationship; never mutate published terms | Yes | CATALOG_VERSION_CREATED |
| PATCH `/packages/{id}/versions/{versionId}` | Same manage split | Edit draft only; expiry/list-price/discount evidence validation; expected current draft revision | Yes | CATALOG_DRAFT_CHANGED |
| POST `/packages/{id}/versions/{versionId}/publish` | Same manage split | Lock package; freeze owner/visibility/eligibility; supersede former version atomically; enforce private expiry policy | Yes | CATALOG_PUBLISHED |
| POST `/packages/{id}/archive` | Same manage split | Stop new acceptance without changing purchases or exposing historical private versions | Yes | CATALOG_ARCHIVED |
| GET `/session-types` | `catalog.read` eligible catalog view | Classification for published offers; omit archived unavailable types | No | No |
| POST `/session-types`; POST `/session-types/{id}/archive` | A with `catalog.manage` | Reference metadata only; unique code and valid mode; preserve historical eligibility | Yes | CATALOG_REFERENCE_CHANGED |

No private reassignment endpoint, no arbitrary price override and no separate publisher role. Price changes use a successor. Management-read behavior must be written into the API contract before Staff delegation; the launch restriction above is explicit.

### Purchases and installments

| Method / route | Permission and scope | Operation / important validation | Idempotency | Audit |
|---|---|---|---|---|
| POST `/purchase-requests` | C-own, `purchase.request` | Exact published eligible version; own private owner, acceptance expiry and current terms; no client-ID spoofing | Yes | PURCHASE_REQUESTED |
| GET `/purchase-requests`; GET `/purchase-requests/{id}` | A/S(`purchase.read`), C-own reads | Scope parent client; immutable requested version, safe price view | No | No |
| POST `/purchase-requests/{id}/withdraw` | C-own, `purchase.request` | REQUESTED only | Yes | PURCHASE_REQUEST_WITHDRAWN |
| POST `/purchase-requests/{id}/reject` | A/S(`purchase.review`) | REQUESTED only, reason, correct offer/client relationship | Yes | PURCHASE_REQUEST_REJECTED |
| POST `/purchase-requests/{id}/accept` | A, or S with **both** `purchase.review` and `purchase.record` | O-17 atomic acceptance/recording; recheck exact nonexpired version, pricing/owner, schedule total; one purchase per request | Yes | PURCHASE_ACCEPTED and PURCHASE_RECORDED |
| POST `/purchases` | A/S(`purchase.record`) | Assisted record; evidence of accepted exact terms, no arbitrary price; one-item launch rule and no zero price | Yes | PURCHASE_RECORDED |
| GET `/purchases`; GET `/purchases/{id}` | A/S(`purchase.read`), C-own reads | Contract and immutable snapshots. Full payment/balance history requires finance.read rather than inheriting it | No | No |
| POST `/purchases/{id}/adjustments` | A, `payment.reverse` | Reasoned charge correction referencing source; no negative obligation or Q<A; schedule agreement; does not refund cash or alter purchased terms | Yes | PURCHASE_ADJUSTED |
| POST `/purchases/{id}/cancel` | A, `payment.reverse`, plus `membership.manage`/`entitlement.adjust` if those effects requested | O-17 disposition; preserve payments/units; validate reversal/refund/credit dependencies; no silent cash return | Yes | PURCHASE_CANCELLED and individual financial/lifecycle events |
| GET `/purchases/{id}/installments` | A/S(`finance.read`), C-own reads | Dates, scheduled/settled/outstanding amounts in same currency; scope purchase | No | No |
| POST `/purchases/{id}/installment-schedules` | A/S(`installment.manage`) | Create schedule; positive sum, unique sequence, studio dates; reject existing purchase-level allocations unless explicitly handled | Yes | INSTALLMENT_SCHEDULE_CREATED |
| POST `/purchases/{id}/installment-schedules/replace` | A/S(`installment.manage`); additionally payment.allocate for any authorized reallocation | Replace unpaid portions with reason and replacement links; no editing funded history, sums match obligation | Yes | INSTALLMENT_SCHEDULE_REPLACED |

New read serializers must enforce independent grants: `purchase.read` is not `finance.read`; `purchase.review` is not `purchase.read` or `purchase.record`. A decision command can load its minimal target internally under its own action without granting a broad list/read permission. Foundation's `RequireAction` and `Sessions.authorize` treat a list of actions as OR. Commands requiring both actions must explicitly authorize each action inside the guarded transaction; passing both to the existing decorator/service is insufficient.

### Payments, allocations, credit, and financial reads

| Method / route | Permission and scope | Operation / important validation | Idempotency | Audit |
|---|---|---|---|---|
| POST `/payments` | A/S(`payment.record`) | Actual positive receipt; approved method/currency precision, normalized source identity, same client account; no verification or allocation fields | Yes | PAYMENT_RECORDED |
| GET `/payments`; GET `/payments/{id}` | A/S(`finance.read`), C-own | Scoped receipt and verification/correction history, redacted evidence references | No | No |
| POST `/payments/{id}/replace` | A/S(`payment.record`) | Unverified and unsuperseded only; linked replacement within same scope/identity chain; block original verification | Yes | PAYMENT_REPLACED |
| POST `/payments/{id}/verify` | A/S(`payment.verify`) | Identity uniqueness, evidence and independent verifier policy; one origin/lot; no automatic allocation or activation | Yes | PAYMENT_VERIFIED |
| POST `/payments/{id}/reverse` | A, `payment.reverse` | Verified error only; reason/evidence, full dependency and receipt-cap checks; linked event, no disguised cash payout | Yes | PAYMENT_VERIFICATION_REVERSED |
| POST `/allocations` | A/S(`payment.allocate`) | Explicit atomic lines, verified source, available unreserved bucket, same account/currency, purchase/installment ownership, cumulative target caps | Yes | PAYMENT_ALLOCATED |
| GET `/allocations` | A/S(`finance.read`), C-own | Filtered allocation/reversal finance events, cursor and scoped purchase/lot filters | No | No |
| POST `/allocations/{eventId}/reverse` | A, `payment.reverse` | Original allocation and unreversed amount; original bucket; review if funding change affects activation | Yes | ALLOCATION_REVERSED |
| POST `/credit/conversions` | A/S(`payment.allocate`) | Explicit cash-backed unapplied-to-credit conversion; policy enabled, available bucket, source lot; no issuance | Yes | CREDIT_CONVERTED |
| POST `/credit/conversions/{eventId}/reverse` | A, `payment.reverse` | Same lot, remaining original conversion amount and unspent/unreserved credit | Yes | CREDIT_CONVERSION_REVERSED |
| GET `/finance/accounts/{id}`; GET `/finance/accounts/{id}/events` | A/S(`finance.read`), C-own | Account totals/history: verified receipts, refunds/reservations, allocated/unapplied/credit and receivables; per-currency, no commission query | No | No |
| GET `/credit-lots` | A/S(`finance.read`), C-own | Source and remaining/reserved buckets, no mutable balance input | No | No |

Do not expose generic `credit.adjust` issuance/expiry/cash-out endpoints while O-04 leaves those paths disabled. If later approved, retain Admin-only authority. Ordinary operational exports and dashboard reports are Milestone 4; M2 provides safe scoped projections rather than building an export pipeline. Admin corrections use recorded-at plus effective-at and reason; routine APIs do not allow arbitrary historical backdating.

### Refunds

| Method / route | Permission and scope | Operation / important validation | Idempotency | Audit |
|---|---|---|---|---|
| POST `/refunds` | A on behalf / C-own, `refund.request` | Original verified receipt belongs to client, positive requested amount, source lot and reason; one bucket per case; request itself does not reserve | Yes | REFUND_REQUESTED |
| GET `/refunds`; GET `/refunds/{id}` | A/S(`finance.read`), C-own | Own/scoped financial status with safe evidence; no action authority inferred from read | No | No |
| POST `/refunds/{id}/approve` | A, `refund.decide` | Lock receipt/lot/account, cap total posted+reserved, freeze bucket/amount; explicit allocation reversals and affected membership reviews | Yes | REFUND_APPROVED_RESERVED plus reversal/review events |
| POST `/refunds/{id}/reject` | A, `refund.decide` | REQUESTED only; reason | Yes | REFUND_REJECTED |
| POST `/refunds/{id}/begin-execution` | A, `refund.execute` | APPROVED_RESERVED only; atomically claim once and return opaque claim reference; replay same claim, never another payout | Yes | REFUND_EXECUTION_CLAIMED |
| POST `/refunds/{id}/post` | A, `refund.post` | EXECUTING with matching claim; exact approved amount, method/time/evidence; one terminal cash event and reservation release | Yes | REFUND_POSTED |
| POST `/refunds/{id}/mark-uncertain` | A, `refund.reconcile` | Execution happened/acknowledgment uncertain; retain frozen reservation, evidence and claim; no cash event asserted | Yes | REFUND_RECONCILE_REQUIRED |
| POST `/refunds/{id}/reconcile` | A, `refund.reconcile` | Proven paid amount/nonpayment, evidence and claim history; post actual within cap or void/release proven unpaid remainder; discrepancies remain visible | Yes | REFUND_RECONCILED |
| POST `/refunds/{id}/void` | A, `refund.reconcile` | Before execution or proven nonpayment only; release reservation with reason, never void a real payout | Yes | REFUND_VOIDED |

No worker executes or retries cash movement. HTTP replay of begin-execution returns the same execution claim and is not permission to hand over money again. A new key cannot claim an EXECUTING refund. A stale browser after a process crash must inspect the stored claim/state and use reconciliation.

### Memberships and entitlement

| Method / route | Permission and scope | Operation / important validation | Idempotency | Audit |
|---|---|---|---|---|
| GET `/memberships`; GET `/memberships/{id}` | A / C-own, `membership.read`; Staff denied | Summary of lifecycle, effective eligibility, formal validity/grace and historical remaining units; no receipt/commission detail by inference | No | No |
| GET `/memberships/{id}/events` | A / C-own, `membership.read` | Safe history projection; redact internal funding evidence requiring finance.read and internal reasons as appropriate | No | No |
| GET `/memberships/{id}/entitlement-entries` | A / C-own, `entitlement.read`; Staff denied | Signed ledger with safe source summaries, ownership through purchase | No | No |
| POST `/memberships/{id}/activate` | **A only planned**, `membership.activate`, subject to O-15 contract reconciliation | Pending only; correct purchased terms, full net same-purchase verified funding if approved, starts/validity policy, one grant; reject exception/override fields | Yes | MEMBERSHIP_ACTIVATED |
| POST `/memberships/{id}/activate-exception` | A, `membership.activate_exception` | Separate reason/evidence, approved exception category; no funded-path override; disabled until exception policy approved | Yes | MEMBERSHIP_ACTIVATED_EXCEPTION |
| POST `/memberships/{id}/suspend`; POST `/memberships/{id}/reinstate` | A, `membership.manage` | Valid current lifecycle, reason/effective time, policy clock rule; reinstatement cannot rewrite expiry | Yes | MEMBERSHIP_SUSPENDED / MEMBERSHIP_REINSTATED |
| POST `/memberships/{id}/cancel` | A, `membership.manage` | Explicit terminal cancellation; preserve units and debt, no automatic cash effect | Yes | MEMBERSHIP_CANCELLED |
| POST `/memberships/{id}/extend` | A, `membership.manage` | New expiry strictly later, uncancelled membership, reason, old/new values; no second initial grant | Yes | MEMBERSHIP_EXTENDED |
| POST `/memberships/{id}/grace`; POST `/memberships/{id}/grace/{eventId}/revoke` | A, `membership.manage` | Explicit nonoverlapping interval or live grant reference; no cancellation/suspension override, no unit grant | Yes | MEMBERSHIP_GRACE_GRANTED / MEMBERSHIP_GRACE_REVOKED |
| GET `/entitlement-reviews` | A, `entitlement.adjust` | Operational correction queue only, affected membership/source joins; not broad Staff finance access | No | No |
| POST `/entitlement-reviews/{id}/resolve` | A, `entitlement.adjust`, additionally membership.manage for validity/lifecycle outcome | Pending source-specific review; reason and explicit no-change/validity/units outcome; same membership, one resolution | Yes | ENTITLEMENT_REVIEW_RESOLVED plus resulting events |
| POST `/memberships/{id}/entitlement-adjustments` | A, `entitlement.adjust` | Session membership only; nonzero integer delta/reason, authorized source event, nonnegative launch balance, no erasing use history | Yes | ENTITLEMENT_ADJUSTED |
| POST `/memberships/{id}/entitlement-entries/{entryId}/reverse` | A, `entitlement.adjust` | Same membership, full opposite units, one reversal, current balance constraints; reason | Yes | ENTITLEMENT_REVERSED |

Expiry is evaluated from database time in all eligibility paths; no required expire endpoint or scheduler. Summaries can distinguish formally expired from usable-in-grace. A worker outage must not keep an expired membership eligible. Entitlement adjustment and membership management remain distinct actions even though both are Admin-only.

The current dashboard relay supports only GET me and POST socket-ticket and its helper supports only GET/POST. Do not assume these new APIs are reachable from dashboard UI. When interfaces are scoped later, explicitly allowlist each commercial path/method, preserve precise error codes, forward idempotency keys and safe bodies, enforce Origin/CSRF and no-store; do not introduce a wildcard proxy. Generate/update reviewed OpenAPI as each backend slice is implemented; client generation can remain in its interface milestone.

## Future milestone interfaces

| Consumer | M2 contract to preserve | Deferred work |
|---|---|---|
| Booking approval | Internal eligibility query by client/membership/session type/service instant; returns lifecycle, stored formal boundary, grace and historical units; caller holds required policy/account/membership locks | Capacity, commitments/holds, selection rules, booking financial eligibility and cancellation effects under O-08 |
| Attendance verification | Source-authorized append-only entitlement posting, same membership, one source effect; later compute correction delta against last accepted charge | Actual attendance entities, served-coach attribution, deadlines/chargeability and insufficient-units policy under O-09 |
| Lifecycle changes after bookings exist | Identify affected memberships and expose safe change history; scheduling commands must coordinate under the shared lock order | Handling confirmed commitments on suspend/refund/extend/cancel; no speculative booking tables now |
| Delivery/reminders | Stable safe source IDs and due dates; no correctness dependency on Redis; when delivery is introduced, commit applicable outbox intents with domain changes | PostgreSQL outbox/leases, BullMQ worker, SMTP and notification preferences; no M2 email or socket notification promise |
| Reports/dashboard | Scoped immutable source history, money equations, effective and posted times, distinct receipts/allocations/refunds/adjustments | Full reports/exports UI and bounded generation; commission remains an entirely separate Admin-only surface |

## Implementation sequence after explicit authorization

1. **Close decisions and write contracts.** Owner resolves O-01/O-03–O-07/O-15–O-17 or explicitly disables optional paths. Record approved values and effective revision. Reconcile Admin-only activation wording/matrix/tests, private management reads and combined purchase-acceptance permissions. Review M2-T01–T04, receipt identity rules and B01–B03/B05 catalog closure criteria. No implementation can supply these approvals implicitly.
2. **Prepare common commercial persistence.** In the later implementation task, design/review migrations for accounts, catalog, purchase references, immutable event/history, identity guard, scoped constraints, audit vocabulary and runtime grants. Seed approved reference types/policy only, not fabricated business defaults. Write the finance effects/reconciliation oracle and transaction test fixtures first. No migrations are part of this review.
3. **Catalog slice.** Draft/publish/archive, exact-version/private ownership isolation, immutable eligibility and snapshots; publication races and old-offer conflicts. No price override endpoint.
4. **Purchase/schedule/issuance slice.** Requests/acceptance/assisted record, immutable item and charge, installments, pending memberships with no units. Verify atomic rollback and independent grants before enabling any acceptance path.
5. **Payments slice.** Receipt identity, immutable recording/replacement, verification/origin/lot, then allocation/batches, balances, optional approved cash-backed credit conversion, allocation/conversion reversal and verification-error reversal. Add source/effect/constraint tests before exposing money writes.
6. **Membership activation/lifecycle slice.** Funded Admin activation, optional approved exception, initial grant once, date policy, suspend/reinstate/cancel, extension/grace and manual adjustments. Test activation versus concurrent funding reversal under the same account lock. Finance corrections create pending reviews as needed.
7. **Refund and correction slice.** Reservation, explicit unallocation, claim, evidence posting, uncertain reconciliation/void, receivable adjustments and entitlement-review resolution. Run parallel reservation/claim/refund tests and the full money trace. A refund cannot silently decide service effects.
8. **Acceptance and handoff.** Run all Foundation and M2 regressions against a disposable database, builds, contract snapshot checks, scoped DTO/log/DB-role commission isolation probes and reconciliation fixtures. Document operational cash reconciliation and uncertain-refund recovery. Obtain milestone acceptance; production deployment and M3 work remain separately authorized.

## Testing strategy

### Before implementation

- Record approved decision examples with expected dates, funding amounts, receipt identities, private expiry, excess handling, refund/receivable effects and overlapping memberships. These are reviewed acceptance cases, not claims of executed commercial tests.
- Run existing database-free unit tests/builds and inspect Foundation integration/CI before changes. Preserve current revocation/idempotency/CSRF boundaries; capture O-15's explicit test expectation change for the later implementation task.
- Specify the event matrix, input/output invariants, scoped FKs and refund transitions as a reviewable contract. Build test scenarios that derive balances independently of production query helpers. Do not write tests that merely repeat implementation formulas line by line.
- Do not run this review's existing integration runner: its setup applies migrations, expressly prohibited for this task. During implementation, with separate authorization, its isolated DB pattern is appropriate.

### During implementation

| Area | Essential unit tests | Essential PostgreSQL/API integration tests |
|---|---|---|
| Catalog/private pricing | Draft/publication state validation, expiry and price/allowance rules | Freeze published fields, parent visibility/client and eligibility; successor leaves purchase unchanged; scoped list/detail/acceptance; unauthorized pricing/discount and expired/superseded acceptance denied |
| Purchases/installments | Request transition table, exact amount/precision, schedule arithmetic | Acceptance creates exactly one purchase/charge/item/pending membership; second key cannot accept twice; combined permissions; partial schedule replacement preserves funded history; no pending entitlement |
| Receipt verification | Identity normalization per method, supersession, independent verifier policy | Same real receipt with different keys/clients cannot verify twice; record does not verify/allocate/activate; duplicate verification creates one origin/lot; replacement old row denied; wrong-client/scope correction rejected |
| Allocation/partial payments | Allowed kinds/buckets, suggestions, cumulative target balances | Several receipts fund one installment; one lot funds several installments/purchases; overpayment remains unapplied; no double counting installment in purchase; conversion/reuse retains source receipt |
| Concurrent finance | Balance calculation oracle | Competing allocations on the same lot, different lots into one installment, allocation versus refund reservation, conversion versus refund, duplicate origin; exactly one safe outcome or serialized valid partial outcomes, never negative funds/overfunded target |
| Activation | Threshold and evidence rules, one-item attribution | Verified unrelated/unapplied payment cannot activate; payment.verify/allocate alone cannot activate; Staff all grants denied under approved Admin-only rule; activation versus reversal serialized; duplicate keys/new keys grant once; exception reason/evidence required |
| Refunds | Transition table, receipt caps, evidence/mismatch handling | Full/partial and multi-receipt/multi-bucket cases; parallel reservations cannot overrun receipt; duplicate execution claims; process restart after claim; uncertain payout stays reserved; post/reconcile race yields one cash event; proven partial/nonpayment releases only established unused amount |
| Corrections/history | Linked reversal remainder and source checks | Unverified replacement immutable; verified correction compensates; no reversal while allocated/refunded/reserved; purchase decrease cannot make Q<A; original payments and activation evidence survive; audit and balances reconcile after adjustment |
| Lifecycle/entitlements | Calendar days/DST/midnight boundary, derived expiry/exhaustion, grace precedence | Activate/expire time and session packages; no grant for time package; suspend clock/reinstate, explicit extension after expiry, no revival of cancellation; unused units stay in ledger; grace revoke/overlap; adjustment/reversal races cannot double grant or cross membership |
| Access and retry | Each named grant independently, strict DTOs | Cross-client IDs/lists/filters/reviews blocked; finance and purchase read scopes independent; partial grant batches denied atomically; current-role/session/grant revocation while waiting and on replay; same-key concurrent success once, changed digest conflict, rollback leaves no replay outcome |
| Database history protection | Kind/reference matrix validates required and forbidden fields | Runtime UPDATE/DELETE of payments' immutable facts, finance events, published versions, purchase snapshots, entitlement/history/audit denied; scoped composite FK violations fail; creator-specific default grants tested |
| Commission regression | Generic commercial DTOs contain no private fields | Staff with all grants, Coach and Client denied commission route; ordinary API/reporting/worker credentials denied private schema; seed distinctive private probe identifiers and check commercial reads/errors/logs/socket payloads for absence. No private connection usage, jobs, notifications or shared cache entries introduced |

Use independent transactions with explicit barriers and observed lock waits for race tests, following Foundation's revocation test pattern; do not rely on arbitrary sleeps. Reconcile all account/lot/purchase/installment totals after success and rejected operations. Test currency precision and DST with fixed fixtures rather than the execution machine timezone. No new performance infrastructure is needed for bounded M2 race and query tests.

### Before milestone acceptance

- Run the complete later `pnpm verify` and OpenAPI snapshot check in the pinned toolchain and CI. Both currently include only Foundation coverage; add commercial tests to the appropriate scripts in the implementation task so acceptance cannot accidentally skip them.
- Run full receipt → partial allocations → excess credit → activation → partial refund → reopened debt → explicit adjustment → review examples and compare database-derived totals to an independent oracle. Show original source rows still present.
- Prove no cash duplication on retry, new HTTP keys, expired HTTP retry records, process restart after execution claim and reconciliation. Prove financial balances cannot be overwritten through API or runtime DB role.
- Review policy approvals and disabled paths, Admin authority consistency, all data scopes and commission negative evidence. New exports, caches or delivery paths are outside M2; if added by later scope approval, they must receive the full commission leakage suite before exposure.
- Record review of the eventual migration SQL, runtime/default grants, scoped keys and reconciliation runbook; acceptance does not authorize production migration or deployment.

## Acceptance criteria

M2 may be accepted only when every enabled business path has an approved policy, its explicit action/resource binding and the tests above. Specifically:

1. Public/own-private catalog works; published terms/owners and purchased snapshots remain fixed after price changes.
2. Purchase acceptance records exact agreed terms once and issues only pending membership; independent grants remain independent.
3. Recorded/verified/applied money and activation are separate; original receipts and source identity cannot be duplicated or edited away.
4. Partial/multiple payments, installment balances, excess, approved credit and reversals reconcile without double counting under concurrency.
5. Admin-only activation policy is consistent across documents, code and tests; ordinary activation proves same-purchase verified funding; exception remains separately reasoned and gated.
6. Full/partial refunds reserve first, have one execution claim/cash posting, retain uncertain funds and preserve original receipts. Receivable/service effects are explicit.
7. Validity, expiry, suspension, cancellation, extension, grace and unit adjustments follow approved policy and preserve history; expired unused units are never silently deleted.
8. Cross-client reads/writes, unauthorized staff combinations and commission access remain denied across all introduced paths; logs are safe and responses no-store.
9. Every consequential command is transactionally audited and idempotent, with durable domain uniqueness beyond HTTP retries and no partial state after rollback.
10. Foundation regressions, new commercial unit/integration/race tests and contract CI pass. No M3/M4/production scope is implicitly enabled.
