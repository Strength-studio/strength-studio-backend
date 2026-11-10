# Milestone 2 implementation plan

Updated 10 November 2026. This plan proposes implementation contracts for the owner-approved policies in the [decision register](milestone-2-decision-register.md). Open business choices and technical design reviews gate the affected slices. Use the [technical contract review](milestone-2-technical-contracts.md) for the proposed invariants and closure evidence. See the [readiness review](milestone-2-readiness-review.md) for Foundation evidence and the O-15 reconciliation.

## Scope and modules

Keep the approved Flutter client, Next.js dashboard on Vercel, NestJS modular monolith REST API, Socket.IO, PostgreSQL/Prisma, Redis/BullMQ, Hostinger KVM1, Nginx and TLS. M2 is primarily backend/API work. Full mobile/dashboard workflow screens, reports/exports UI and delivery remain Milestone 4. No online payment gateway, booking, attendance, commissions or branches are added.

Foundation currently wires controllers/providers in one Nest application (`src/app.ts`), rather than separate implemented commercial Nest modules. Add ordinary in-process feature modules; do not introduce service decomposition or a generic workflow engine.

| Proposed module | Responsibility | Dependencies |
|---|---|---|
| Catalog | Packages, drafts, immutable publication, public/client-private views, minimal session-type reference catalog | Current identity, settings/policy, audit and command transaction |
| Purchases | Requests, exact-version acceptance, assisted recording, immutable item snapshots and installment schedules | Catalog, finance account/posting service, membership issuance |
| Finance | Accounts, method history, receipt identity, recording/verification/authorization, lots, allocations, credit ledger and corrections | Current identity, policy, audit/idempotency; purchase references |
| Refunds | Request, reservation, execution claim, post/reconcile and review creation | Finance's shared lock/effect rules; membership review API inside the monolith |
| Memberships | Pending issuance, activation, lifecycle and validity events, entitlement entries and reviews | Purchase items, locked finance funding query, policy |
| Existing platform/identity | Extend the action map, command inputs and audit vocabulary only as authorized during implementation | Retain current credentials, revocation, guards, request IDs, no-store and logging architecture |

Use a small shared finance posting service within Finance; Purchases and Refunds call it inside the caller's transaction. Membership issuance is an internal function invoked by purchase recording. Avoid bidirectional module orchestration: a purchase application command coordinates snapshot, charge and issuance; a refund command coordinates finance and review creation. No independent second ledger or allocation table.

Policy integration is necessary: Foundation's settings DTO currently accepts only timezone/default currency and stores empty rules. Later implementation must validate the approved commercial policy schema, reject missing values and attach its immutable revision to decisions. It must not interpret empty rules as approved defaults. Real client onboarding still requires the remaining O-02 decisions and identity implementation; existing development fixtures can support isolated commercial development after implementation is authorized.

## Proposed domain entities

This is a design delta to the **proposed dictionary**, not a claim that these entities exist. Reuse the existing ten Foundation models. All domain FKs restrict deletion; UUIDs and creation instants follow the dictionary. Add necessary leading FK indexes, not speculative reporting indexes. Every consequential state transition commits operational audit in the same transaction, with actor/session, request ID, reason where required, safe old/new values and policy reference. Domain history is separate from an HTTP replay record.

### Catalog and agreement

| Entity / responsibility | Important fields and relationships | Lifecycle, integrity and indexes | Audit requirements |
|---|---|---|---|
| PACKAGE — offer identity | Code, visibility, optional client FK, archive timestamp; owns versions | Public iff client is null; private iff client exists. Unique code; index owner/visibility/archive. Freeze client/visibility after publication; archive rather than delete | Creation, draft ownership changes before publication, archive; never transfer published private history |
| PACKAGE_VERSION — published terms | Package FK, sequential version, based-on FK within package, kind, name/description, price/currency, validity days, session allowance, publication/supersession, optional private acceptance-expiry date with applied Riyadh cutoff; optional list price and discount reason | Draft → issued/published → superseded or withdrawn/archived for new acceptance. Keep issued terms immutable. Unique package/version and one current published version; nonnegative price, positive validity and session allowance for session kind; allowance null for time kind. Admin-issued SAR 0 purchases require a purpose under O-17. All published business fields and eligibility immutable | Draft change, publication, successor and retirement; accepted content preserved |
| SESSION_TYPE — eligibility reference only | Code, name, individual/group mode, archive timestamp | Unique code; preserve referenced mode/history. Minimal classification in M2; no slots, capacity, coaches or attendance | Admin reference create/archive under catalog management |
| PACKAGE_VERSION_SESSION_TYPE — eligibility join | Version and session-type FKs | Composite PK; reverse type index; cannot change published links; require a valid explicit allowed set at publication | Covered by package publication audit, with version reference |
| PURCHASE_REQUEST — client intent | Client FK, exact version FK, state, decision actor/time/reason; exact-version evidence link when available. Intent alone is insufficient | SUBMITTED → ACCEPTED_RECORDED/REJECTED/WITHDRAWN. Client/state/created index and version FK index. At acceptance recheck owner, exact version, price and approved O-06 expiry/supersession rules; no version substitution | Submission, withdrawal, rejection and acceptance, including actor and exact version |
| PURCHASE — contract/receivable source | Finance account/currency, optional request FK, acceptance method, actor/time, immutable agreed total, linked agreement evidence and cancellation history | RECORDED → CANCELLED. Unique request; account/time index and unique scoped keys. One or more items structurally, item and funding attribution gated by O-03. Atomic charge/item/membership issuance. Monetary settlement derived | Recording and explicit cancellation/adjustment; retain original amount and all evidence |
| AGREEMENT_EVIDENCE — explicit client agreement | Client and exact terms/version, in-app confirmation event or signed reference or verbal note, responsible person and timestamp | Required and immutable for an accepted purchase. Validate method-specific fields, owner and frozen terms. Restrict evidence reads | Preserve client confirmation or assisted recorder and safe evidence |
| PURCHASE_ITEM — agreed snapshot | Purchase/version FKs, line number, description/price/currency/validity/allowance snapshots; optional agreed discount evidence | Unique purchase/line. Currency matches purchase. Sum equals total, including SAR 0. Snapshot package, services, price/currency, sessions/duration, validity, installments, discounts and custom terms through immutable data or immutable historical references. Reject updates/deletes after recording | Created with purchase; historical terms readable even after catalog archive |
| INSTALLMENT — receivable schedule | Scoped purchase FK, sequence, due date, amount, replaces FK, retirement | Positive portions; active purchase/sequence unique, replacement unique and same scoped purchase. Initial sum equals total; effective obligation includes targeted immutable charge adjustments. Index active due dates and purchase. Due-date revisions preserve original dates, amounts and allocation relationships; schedule replacement beyond date revision remains gated | Original schedule, linked replacements and targeted adjustment events, reason, policy and any reallocation events |

### Money and refunds

| Entity / responsibility | Important fields and relationships | Lifecycle, integrity and indexes | Audit requirements |
|---|---|---|---|
| FINANCE_ACCOUNT — serialization scope | Client FK and currency | Unique client/currency and id/currency. Created on first commercial operation. No overwritten balance. Lock before all aggregate validations | Creation through first purchase/receipt; subsequent money changes audited at source |
| RECEIPT_IDENTITY — proposed B01 guard | Issuer-scoped strong identity claims and provisional intake root; correction-chain root and effective authorized-payment pointer | Require method-specific validation. Claim a reliable key at recording. Allow provisional recording when needed, with reasoned Admin evidence exception and duplicate review before final authorization. Uniqueness is independent of client, amount and HTTP key | Identity claim, evidence exception, correction links and authorization history |
| PAYMENT — immutable reported receipt | Account/currency, identity, amount, received-at, method version or immutable snapshot, safe evidence reference, recorder and correction links | Keep recording, verification and final Admin authorization distinct. Preserve verifier, reviewer, authorizer, timestamps and reasons in history. Rejection or return for correction has no balance effect. Exactly one effective authorized origin/lot per root. Original facts remain immutable | Append the actors and decisions for each transition |
| CREDIT_LOT — funding provenance | Scope, origin kind and original payment for cash-backed lots | One cash-backed lot per authorized payment. Track reasoned manual credit increases separately with their own source. Available balances are derived. No automatic credit expiry | Preserve source through allocation, reversal and refund. Record separate Admin adjustment events |
| FINANCE_EVENT — append-only money movement AND allocation | Scope, kind, positive amount, effective-at, posted-at/created-at, actor, durable posting key/digest; lot/purchase/installment/refund/original-event FKs and bucket fields | Candidate effects below, exact kind/reference matrix pending; scoped FKs; unique account/posting key, lot origin and refund terminal cash posting; indexes account/lot/purchase/installment + effective time, refund and reversal. Runtime cannot UPDATE/DELETE postings. Cumulative reversal limits enforced under lock | Posting command reason/evidence and immutable event; distinguish service effective date from actual posting date |
| REFUND — manual cash return case and reservation | Scope and original payment/lot FKs, requested/approved amounts, kind/state, decision actor/time, proposed frozen bucket, reserved amount, execution token/actor/time, evidence ref, actual paid/released amounts | REQUESTED → REJECTED or APPROVED_RESERVED → EXECUTION_CLAIMED → POSTED or RECONCILIATION_REQUIRED, with proven partial, failed or voided resolution. Unique execution token; one terminal cash event. Payment/state and lot/state indexes. Approval fixes source/bucket/amount; reservation remains until proven post/void/reconciliation. Payment and cash-backed lot must match. Manual credit payout source remains gated | Append transition/evidence audit; preserve approved versus actual. Never erase an execution attempt or overwrite the original receipt |

Use a receipt identity guard for B01 because HTTP keys only deduplicate retries of a command. Method configuration also needs stable identities and immutable historical values. Payment and correction workflow history needs actor and status metadata separate from posted money effects. Preserve scoped correction FKs: cross-client/currency correction/reassignment is not an ordinary command; reject it rather than silently moving financial history. A later explicitly authorized cross-account reconciliation would need its own sorted account lock set and evidence.

The current refund projection may hold its latest state, but its approved source terms freeze on reservation. Existing append-only operational audit records each state/evidence revision, including reconciliation observations, while immutable finance events record actual monetary effects. This avoids an extra refund-history table. Store a stable evidence reference and safe metadata, not uploaded files or secrets.

### Membership and entitlements

| Entity / responsibility | Important fields and relationships | Lifecycle, integrity and indexes | Audit requirements |
|---|---|---|---|
| MEMBERSHIP — current lifecycle/validity projection | Unique purchase-item FK, client, state, activation instant, effective local start date/instant, inclusive final date and proposed exclusive valid-until | PENDING_ACTIVATION → SCHEDULED_START or ACTIVE, with reasoned suspensions, reactivation and terminal early termination. Derive expiry from stored validity and database time. Preserve independently active memberships and their history | Every transition has an event, including system attribution for scheduled reactivation |
| MEMBERSHIP_EVENT — immutable authorization and lifecycle history | Membership, actor or system attribution, policy, effective-at, reason, funding evidence and evaluated amount, original and revised validity, suspension dates, review reference | One activation per membership. Funded path captures eligible same-purchase evidence. SAR 0 issuance uses its recorded purpose as a separate funding basis with no receipt. General activation exception stays gated. Explicit extension replaces any grace workflow. Preserve start/end and reason for scheduled/open-ended suspension | Append activation, suspension, reactivation, extension and termination events |
| ENTITLEMENT_REVIEW — separate service consequences | Membership and exactly one applicable refund, funding correction or cancelled purchase, decision actor/time and reason | Validate source and membership scope. Record explicit no-change or separate lifecycle and session decisions, which can coexist. Apply each approved effect once. Financial changes do not apply service consequences | Record decisions and resulting membership/entitlement history with their source |
| ENTITLEMENT_ENTRY — immutable signed session-unit ledger | Membership, signed integer delta, kind, source membership-event or review; linked reversal | Nonzero; exactly one valid source. Unique source and full-reversal link; reverse original membership once by exact opposite units. Under membership lock, prevent negative launch balance for discretionary adjustments. Initial grant once on activation, usable only from the effective start. Index membership/time and source FKs | Append adjustment/reversal and authority/reason; time packages have no unit rows |

Do not create ATTENDANCE or ATTENDANCE_VERIFICATION tables in M2 solely to satisfy a nullable future FK. M2 supports only membership-event and review sources. The dictionary's third authorized source is introduced with its actual FK and exactly-one-source check in Milestone 3. Provide a narrow internal posting interface requiring source type/ID, membership, units and posting uniqueness; future accepted attendance supplies its real source. Do not accept arbitrary external entitlement sources from API callers.

Existing POLICY_REVISION, AUDIT_LOG and IDEMPOTENCY_KEY are reused. Later implementation needs approved typed policy rules, commercial audit action/target values, safe reason support, and canonical command identifiers for different operations sharing one permission. Preserve Foundation replay identity for existing routes; add operation names for new commands without changing authentication or revocation semantics. M2 preserves stable payment and membership transition sources for later notification delivery. The O-11 outbox, provider and reminder controls belong to the delivery milestone.

## Finance event contract (proposed)

The [effect matrix and balance invariants](milestone-2-technical-contracts.md#financial-ledger-and-event-effects) specify source, authority, posting, compensation, idempotency and audit for each operation. Keep recorded and verified payment facts nonspendable until final Admin authorization. Credit, allocation and refunds retain source provenance. Approved credit cash refunds use the same [reserve, claim and reconcile contract](milestone-2-technical-contracts.md#refund-execution-and-reconciliation). Manual credit without an original payment remains an O-04 source-linkage gate. Refund cash, unallocation, receivable adjustment, purchase cancellation and service effects remain distinct.

## Transactions, constraints, and concurrency

Follow the [shared command transaction](business-rules.md#shared-command-transaction): READ COMMITTED, current actor/session FOR SHARE held through commit, canonical idempotency claim, policy lock, sorted account locks, then domain locks in documented order. Use current post-lock database time for expiry/acceptance checks, and fresh reads after waiting. Put receipt identity/root locks after FINANCE_ACCOUNT and before PAYMENT, with a reviewed placement relative to catalog locks; all writers must use it. Package/version and purchase-request locks retain their existing place before payment/lot/purchase/installment/refund and membership locks. If necessary IDs change after discovery, retry with the correct lock set. Resolve a strong identity conflict at recording with a scoped error. Keep ambiguous provisional records nonspendable pending review.

Never acquire a second account late in a command; allocation batches share one account, and any supported multi-account administrative reconciliation must discover and sort the full set first. Membership activation locks its finance account before membership, checks purchase/item ownership and evaluates all net eligible allocations. A cited allocation is an evidence anchor, not the funding total.

For every commercial write: domain mutation, posting keys, completed HTTP outcome and audit commit or roll back together. On a retry, recheck current authority and ownership before returning the old result. Normalized input includes command name, target IDs, amounts/currency and all allocation lines; a changed body is a conflict. Keep domain source/posting uniqueness after HTTP records expire. Financial commands must never invoke an external provider or wait for a human payout inside a transaction.

Use Prisma Decimal/database numeric arithmetic for money, not JavaScript floating-point arithmetic. Canonicalize equivalent decimal strings before digesting commands, validate the currency's input precision, and reject unrepresentable values. Decimal-string API responses preserve exact amounts.

Use scoped composite keys from the dictionary: account/currency; purchase/account/currency; installment/purchase/account/currency; payment/account/currency; lot/source-payment/account/currency for refunds; original-event/account/currency. Existence of a UUID is insufficient. Validate cross-FK source chains under lock, including membership → item → purchase → account/client and review → affected purchase. Add row-local checks, active-version/sequence partial uniqueness, one origin/activation/refund-posting constraints, and nonnegative/cumulative service validations as appropriate. Cross-row money sums require locking, not a CHECK pretending to read other rows.

Grant runtime SELECT/INSERT on append-only finance/history tables, no UPDATE/DELETE. Mutable projections receive only necessary column rights. PostgreSQL row locking still needs an UPDATE privilege on the locked table: plan a harmless guard column or tightly restricted existing mutable column where required, without granting updates to immutable money/terms. Review actual role behavior with negative DB tests. Keep non-runtime ownership and default privileges creator-specific. Do not add any private commission connection, grant or table to enable commercial finance. Reporting/worker roles remain denied private schema access.

## Proposed API inventory

All routes are relative to `/api/v1`. See the [implemented public catalog](api-contract.md#implemented-public-catalog) for the current route contract. Private and later commercial routes remain proposals. `A` = Admin, `S(action)` = Staff with exactly that independent named grant, `C-own` = owning Client. Coach has no M2 commercial access. Catalog is authenticated under the existing matrix; no anonymous listing is assumed. For grouped method/route rows, every listed route has the row's permission, validation, idempotency and audit requirements.

All reads use current authority and query-level scope, pagination, explicit allowlisted DTOs and no-store. Out-of-scope detail IDs return a consistent 404; denied actions return 403. No commission fields, identifiers, joins or aggregates appear. Every write marked Yes requires `Idempotency-Key` and produces one committed audit event per actual operation, not per replay. Audit names for later slices are proposed. Exceptions, validation failures and denied requests do not create successful domain outcomes.

### Catalog

| Method / route | Permission and scope | Operation / important validation | Idempotency | Audit |
|---|---|---|---|---|
| GET `/packages`; GET `/packages/{id}/versions/{versionId}` | `catalog.read`: A, S(public published), C(public published + own eligible private) | Published view; exact package/version relationship, owner, enabled visibility and acceptance window; no draft leakage | No | No |
| GET `/packages/{id}/management` | A/S with the public or dedicated private management action for the corresponding offer | Scoped draft/history projection. Ordinary catalog.read grants only the appropriate published view | No | No |
| POST `/packages` | A/S(`catalog.manage`) for public, A/S(`catalog.private.manage`) for private | Create draft identity/version. Validate private owner, terms and optional Riyadh expiry date | Yes | CATALOG_CREATED |
| POST `/packages/{id}/versions` | Same public/private manage split | Create draft successor or client quote; same package base-version relationship; never mutate published terms | Yes | CATALOG_VERSION_CREATED |
| PATCH `/packages/{id}/versions/{versionId}` | Same manage split | Edit draft only; expiry/list-price/discount evidence validation; expected current draft revision | Yes | CATALOG_DRAFT_CHANGED |
| POST `/packages/{id}/versions/{versionId}/publish` | Same manage split | Lock package; freeze owner/visibility/eligibility; supersede former version atomically; apply optional Riyadh expiry and supersede old issued terms for acceptance | Yes | CATALOG_PUBLISHED |
| POST `/packages/{id}/archive`; POST `/packages/{id}/withdraw` | Public archive A/S(`catalog.manage`). Private withdrawal A only, proposed `catalog.private.withdraw` | Withdraw unaccepted private offer with a reason. Preserve versions and accepted records. Review separate private offer reuse/cardinality | Yes | CATALOG_ARCHIVED / PRIVATE_OFFER_WITHDRAWN |
| GET `/session-types` | `catalog.read` eligible catalog view | Classification for published offers; omit archived unavailable types | No | No |
| POST `/session-types`; POST `/session-types/{id}/archive` | A with `catalog.manage` | Reference metadata only; unique code and valid mode; preserve historical eligibility | Yes | CATALOG_REFERENCE_CHANGED |

No private reassignment endpoint, no arbitrary price override and no separate publisher role. Price changes use a successor. Private management has a dedicated permission. Withdrawal of an unaccepted offer has a separate Admin binding pending any confirmed Staff delegation.

### Purchases and installments

| Method / route | Permission and scope | Operation / important validation | Idempotency | Audit |
|---|---|---|---|---|
| POST `/purchase-requests` | C-own, `purchase.request` | Exact published eligible version; own private owner, acceptance expiry and current terms; no client-ID spoofing | Yes | PURCHASE_REQUESTED |
| GET `/purchase-requests`; GET `/purchase-requests/{id}` | A/S(`purchase.read`), C-own reads | Scope parent client; immutable requested version, safe price view | No | No |
| POST `/purchase-requests/{id}/withdraw` | C-own, `purchase.request` | SUBMITTED only | Yes | PURCHASE_REQUEST_WITHDRAWN |
| POST `/purchase-requests/{id}/confirm-terms` | C-own, proposed agreement confirmation action | Append explicit agreement to exact eligible terms/version. Distinct from submitting intent and operator acceptance | Yes | PURCHASE_TERMS_CONFIRMED |
| POST `/purchase-requests/{id}/reject` | A/S(`purchase.review`) | SUBMITTED only, reason, correct offer/client relationship | Yes | PURCHASE_REQUEST_REJECTED |
| POST `/purchase-requests/{id}/accept` | A/S with dedicated proposed `purchase.accept_record` | Atomically formally accept and record. Validate exact eligible version and client agreement evidence. Freeze terms, actor, timestamp and method. One purchase per intent | Yes | PURCHASE_ACCEPTED_RECORDED |
| POST `/purchases` | A/S with dedicated proposed `purchase.accept_record`; SAR 0 Admin-only | Assisted formal acceptance requires the same evidence, exact terms and provenance. SAR 0 needs a purpose and creates a pending membership without artificial receipt or revenue | Yes | PURCHASE_ACCEPTED_RECORDED |
| GET `/purchases`; GET `/purchases/{id}` | A/S(`purchase.read`), C-own reads | Contract and immutable snapshots. Full payment/balance history requires finance.read rather than inheriting it | No | No |
| POST `/purchases/{id}/adjustments` | A, `payment.reverse` | Reasoned charge correction referencing source; no negative obligation or Q<A; schedule agreement; does not refund cash or alter purchased terms | Yes | PURCHASE_ADJUSTED |
| POST `/purchases/{id}/cancel` | A, proposed `purchase.cancel` | Reasoned cancellation even after activation/use. Preserve history. Any receivable adjustment, refund, credit or membership/session decision is separate | Yes | PURCHASE_CANCELLED |
| GET `/purchases/{id}/installments` | A/S(`finance.read`), C-own reads | Dates, scheduled/settled/outstanding amounts in same currency; scope purchase | No | No |
| POST `/purchases/{id}/installment-schedules` | A/S(`installment.manage`) | Create schedule; positive sum, unique sequence, studio dates; reject existing purchase-level allocations unless explicitly handled | Yes | INSTALLMENT_SCHEDULE_CREATED |
| POST `/purchases/{id}/installments/{installmentId}/due-date-revisions` | A, proposed `installment.revise_due_date` | Append reasoned date revision. Preserve original schedule amount/date and allocation history | Yes | INSTALLMENT_DUE_DATE_REVISED |

New read serializers must enforce independent grants: `purchase.read` is not `finance.read`; `purchase.review` is not `purchase.read` or `purchase.record`. A decision command can load its minimal target internally under its own action without granting a broad list/read permission. Foundation's `RequireAction` and `Sessions.authorize` treat a list of actions as OR. Commands requiring both actions must explicitly authorize each action inside the guarded transaction; passing both to the existing decorator/service is insufficient.

### Payments, allocations, credit, and financial reads

Proposed action names are aligned with the [permission matrix](permission-matrix.md). Draft methods, routes and audit names require design review.

| Method / route | Permission and scope | Operation / important validation | Idempotency | Audit |
|---|---|---|---|---|
| POST `/payment-methods`; PATCH `/payment-methods/{id}` | A, `studio.configure` | Add, edit, enable, disable and configure instructions. Preserve historical method values on recorded payments | Yes | PAYMENT_METHOD_CHANGED |
| POST `/payments` | A/S(`payment.record`) | Actual positive receipt, method version, evidence reference when available, client/currency scope. No balance effect | Yes | PAYMENT_RECORDED |
| POST `/payments/{id}/verify` | A/S(`payment.verify`) | Append verification and evidence. The same Admin may record, verify and authorize. Staff result awaits Admin review and authorization | Yes | PAYMENT_VERIFIED |
| POST `/payments/{id}/authorize`; POST `/payments/{id}/return`; POST `/payments/{id}/reject` | A, proposed `payment.authorize` | Separate review and decision with reviewer/authorizer history. Final authorization posts one lot. Record reason for missing-reference exception or rejection/return | Yes | PAYMENT_AUTHORIZED / PAYMENT_RETURNED / PAYMENT_REJECTED |
| POST `/payments/{id}/correction-requests` | A/S(proposed `payment.correction.request`) | Link original and reason; no financial effect | Yes | PAYMENT_CORRECTION_REQUESTED |
| POST `/payments/{id}/corrections` and authorization of the correction | A, `payment.reverse` | Admin initiates and authorizes linked reversals and corrections. Recheck locked dependencies; only authorization posts effects | Yes | PAYMENT_CORRECTION_INITIATED / PAYMENT_CORRECTION_AUTHORIZED |
| POST `/allocations` | A, `payment.allocate` | Explicit purchase/installment lines using authorized funds. Audited reallocation reverses original lines and applies new ones atomically | Yes | PAYMENT_ALLOCATED |
| POST `/allocations/{eventId}/reverse` | A, `payment.reverse` | Return funds to original bucket, bound by unreversed amount; preserve source and open service review when applicable | Yes | ALLOCATION_REVERSED |
| POST `/credit/conversions` | Proposed Admin-only if manual conversion selected | Convert eligible excess to credit, preserving cash source. Enable after trigger policy is confirmed | Yes | CREDIT_CONVERTED |
| POST `/credit/applications` | A, proposed `credit.apply` | Explicit purchase/installment and full/partial amount with spendable balance and scope checks | Yes | CREDIT_APPLIED |
| POST `/credit/adjustments` | A, `credit.adjust` | Reasoned increase/decrease, separate ledger effect and explicit source | Yes | CREDIT_ADJUSTED |
| GET `/payments`; GET `/allocations`; GET `/finance/accounts/{id}`; GET `/credit` and related history | A/S(`finance.read`), C-own | Safe scoped receipts, debt/installments, payment decisions and credit history. Distinguish cash, credit and amounts held for refund. No commission data | No | No |

Candidate payment states are RECORDED → VERIFIED_AWAITING_AUTHORIZATION → AUTHORIZED, with explicit RETURNED_FOR_CORRECTION and REJECTED outcomes. The authorization command records Admin review and the final decision as distinct audit facts. Rejected or returned receipts remain visible in history. Review the exact transition/retry table, including correction of recorded or authorized receipts, before designing persistence. Admin credit-to-cash refunds use the formal refund workflow. Payouts from manual credit without original payment linkage remain gated. Method evidence and financial read DTOs expose only safe references and authorized fields.

### Refunds

| Method / route | Permission and scope | Operation / important validation | Idempotency | Audit |
|---|---|---|---|---|
| POST `/refunds` | A on behalf / C-own, `refund.request` for receipt refunds. Admin-only initiation for credit cash-out | Scope to original authorized payment and lot/bucket. Credit refund requires reason and explicit source. Request itself does not reserve | Yes | REFUND_REQUESTED |
| GET `/refunds`; GET `/refunds/{id}` | A/S(`finance.read`), C-own | Own/scoped financial status with safe evidence; no action authority inferred from read | No | No |
| POST `/refunds/{id}/approve` | A, `refund.decide` | Lock receipt/lot/account, cap total posted+reserved and freeze bucket/amount. Any necessary unallocation is separately authorized. Track affected service reviews without applying consequences | Yes | REFUND_APPROVED_RESERVED |
| POST `/refunds/{id}/reject` | A, `refund.decide` | REQUESTED only; reason | Yes | REFUND_REJECTED |
| POST `/refunds/{id}/begin-execution` | A, `refund.execute` | APPROVED_RESERVED only; atomically claim once and return opaque claim reference; replay same claim, never another payout | Yes | REFUND_EXECUTION_CLAIMED |
| POST `/refunds/{id}/post` | A, `refund.post` | EXECUTION_CLAIMED with matching claim. Record proven amount/method/time, payout reference or reasoned Admin exception. One resolved cash posting and hold release | Yes | REFUND_POSTED |
| POST `/refunds/{id}/mark-uncertain` | A, `refund.reconcile` | Execution happened/acknowledgment uncertain; retain frozen reservation, evidence and claim; no cash event asserted | Yes | REFUND_RECONCILE_REQUIRED |
| POST `/refunds/{id}/reconcile` | A, `refund.reconcile` | Proven paid amount/nonpayment, evidence and claim history; post a fully resolved actual amount within cap or void proven nonpayment. Retain unresolved hold and evidence | Yes | REFUND_RECONCILED |
| POST `/refunds/{id}/void` | A, `refund.reconcile` | Before execution or proven nonpayment only; release reservation with reason, never void a real payout | Yes | REFUND_VOIDED |

A proven external return needs a separate linked compensating posting under Admin reconciliation. No worker executes or retries cash movement. HTTP replay of begin-execution returns the same execution claim and is not permission to hand over money again. A new key cannot claim an already claimed or unresolved refund. A stale browser after a process crash must inspect the stored claim/state and use reconciliation.

### Memberships and entitlement

| Method / route | Permission and scope | Operation / important validation | Idempotency | Audit |
|---|---|---|---|---|
| GET `/memberships`; GET `/memberships/{id}` | A / C-own, `membership.read`; Staff denied | Summary of lifecycle, effective eligibility, scheduled start, formal validity and historical remaining units; no receipt/commission detail by inference | No | No |
| GET `/memberships/{id}/events` | A / C-own, `membership.read` | Safe history projection; redact internal funding evidence requiring finance.read and internal reasons as appropriate | No | No |
| GET `/memberships/{id}/entitlement-entries` | A / C-own, `entitlement.read`; Staff denied | Signed ledger with safe source summaries, ownership through purchase | No | No |
| POST `/memberships/{id}/activate` | A only, `membership.activate`; O-15 runtime reconciliation first | Pending only. Evaluate authorized payments and credit allocated to this purchase under lock, allowing partial funding. Apply the cancelled-purchase service guard from M2-T04. For an Admin-issued SAR 0 purchase, use its recorded purpose as the basis. Record approval and immediate or future Riyadh start. Grant units once, usable only when effective. Reject unfunded override fields | Yes | MEMBERSHIP_ACTIVATED |
| POST `/memberships/{id}/activate-exception` | A, `membership.activate_exception` | Separate reason/evidence, approved exception category; no funded-path override; disabled until exception policy approved | Yes | MEMBERSHIP_ACTIVATED_EXCEPTION |
| POST `/memberships/{id}/suspend`; POST `/memberships/{id}/reinstate` | A, `membership.manage`; system for scheduled end | Require reason and start date. End-date suspension resumes automatically at the agreed Riyadh boundary. Open-ended suspension resumes only by Admin. Resume never changes validity or restores eligibility past expiry | Yes | MEMBERSHIP_SUSPENDED / MEMBERSHIP_REINSTATED |
| POST `/memberships/{id}/terminate` | A, `membership.manage` | Early termination of active membership. Preserve history and separately review remaining units and financial consequences | Yes | MEMBERSHIP_TERMINATED |
| POST `/memberships/{id}/extend` | A, `membership.manage` | Explicit reason, original and revised expiry. Support post-expiry extension with prospective eligibility. No second grant | Yes | MEMBERSHIP_EXTENDED |
| GET `/entitlement-reviews` | A, `entitlement.adjust` | Operational correction queue only, affected membership/source joins; not broad Staff finance access | No | No |
| POST `/entitlement-reviews/{id}/resolve` | A, `entitlement.adjust`, additionally membership.manage for validity/lifecycle outcome | Pending source-specific review; reason and explicit membership and remaining-unit decisions; same membership, apply each decision once | Yes | ENTITLEMENT_REVIEW_RESOLVED plus resulting events |
| POST `/memberships/{id}/entitlement-adjustments` | A, `entitlement.adjust` | Session membership only; nonzero integer delta/reason, authorized source event, nonnegative launch balance, no erasing use history | Yes | ENTITLEMENT_ADJUSTED |
| POST `/memberships/{id}/entitlement-entries/{entryId}/reverse` | A, `entitlement.adjust` | Same membership, full opposite units, one reversal, current balance constraints; reason | Yes | ENTITLEMENT_REVERSED |

Use database time for effective expiry and scheduled suspension boundaries. An expired or terminated membership cannot become usable when a scheduled suspension ends. Define idempotent system transition and audit behavior without letting worker delay extend validity or suspension eligibility. O-07 has no automatic grace or separate grace workflow. The [Riyadh contract](milestone-2-technical-contracts.md#saudi-date-and-time-contract) proposes how to represent each boundary. Entitlement adjustment and membership management remain distinct actions even though both are Admin-only.

The current dashboard relay supports only GET me and POST socket-ticket and its helper supports only GET/POST. Do not assume these new APIs are reachable from dashboard UI. When interfaces are scoped later, explicitly allowlist each commercial path/method, preserve precise error codes, forward idempotency keys and safe bodies, enforce Origin/CSRF and no-store; do not introduce a wildcard proxy. Generate/update reviewed OpenAPI as each backend slice is implemented; client generation can remain in its interface milestone.

## Future milestone interfaces

| Consumer | M2 contract to preserve | Deferred work |
|---|---|---|
| Booking approval | Internal eligibility query by client/membership/session type/service instant; returns lifecycle, stored effective boundaries and historical units; caller identifies the selected membership and holds required policy/account/membership locks | Capacity, commitments/holds, selection rules, booking financial eligibility and cancellation effects under O-08 |
| Attendance verification | Source-authorized append-only entitlement posting, same membership, one source effect; later compute correction delta against last accepted charge | Actual attendance entities, served-coach attribution, deadlines/chargeability and insufficient-units policy under O-09 |
| Lifecycle changes after bookings exist | Identify affected memberships and expose safe change history; scheduling commands must coordinate under the shared lock order | Handling confirmed commitments on suspend/refund/extend/cancel; no speculative booking tables now |
| Delivery/reminders | Stable safe source IDs and due dates; no correctness dependency on Redis; when delivery is introduced, commit applicable outbox intents with domain changes | O-11 in-app and bilingual email, replaceable Hostinger SMTP, outbox deduplication, category and monthly limits, and Riyadh expiry/overdue schedules. Only final Admin authorization can source final payment approval |
| Reports/dashboard | Scoped immutable source history, money equations, effective and posted times, distinct receipts/allocations/refunds/adjustments | Full reports/exports UI and bounded generation; commission remains an entirely separate Admin-only surface |

## Implementation sequence after explicit authorization

1. **Close design before migrations.** Review receipt identity, ledger/refund effects, scoped keys, lock order and the O-15 rollout first. Obtain affected owner decisions by ID. Review exact-version acceptance, lifecycle and Riyadh date representation. Use the [prioritized closure table](milestone-2-technical-contracts.md#closure-and-implementation-order).
2. **Reconcile authorization and review shared persistence.** Retire legacy Staff activation and allocation authority, preserve grant history, define compatible rollout, and review runtime privileges and durable replay keys. Real onboarding has its own O-02 gate.
3. **Catalog, purchase and installments.** Implement exact-version privacy and formal acceptance with evidence and the dedicated permission. Freeze terms, issue pending memberships, and preserve due-date history and reasoned SAR 0 issuance.
4. **Payment and ledger.** Claim receipt identity at recording, then verify and authorize distinctly. Add explicit allocation/reallocation, credit applications, adjustments and corrections. Gate unresolved conversion and Staff self-verification branches.
5. **Activation and lifecycle.** Enable Admin-only activation after O-15 proof and funding eligibility review. Apply effective Riyadh start/expiry, suspensions, explicit extensions and termination with once-only grants. Keep the general exception disabled until its criteria are approved.
6. **Refund and independent decisions.** Add cash-backed credit refunds, reservation and execution reconciliation, then separate receivable and service decisions. Gate manual-credit payouts until O-04 source linkage is confirmed.
7. **Acceptance.** Run Foundation and commercial regressions, PostgreSQL races, permission/private-schema probes, and OpenAPI checks. Delivery, later milestones and production release have separate gates.

## Testing strategy

### Before implementation

- Record approved decision examples with expected dates, funding amounts, receipt identities, private expiry, excess handling, refund/receivable effects and overlapping memberships. These are reviewed acceptance cases, not claims of executed commercial tests.
- Use the existing database-free suite and inspect Foundation integration/CI before runtime changes. Preserve current revocation/idempotency/CSRF boundaries; capture O-15's explicit test expectation change for the later implementation task.
- Specify the event matrix, input/output invariants, scoped FKs and refund transitions as a reviewable contract. Build test scenarios that derive balances independently of production query helpers. Do not write tests that merely repeat implementation formulas line by line.
- During authorized implementation, use Foundation’s isolated database pattern for migration and concurrency tests.

### During implementation

| Area | Essential unit tests | Essential PostgreSQL/API integration tests |
|---|---|---|
| Catalog/private pricing | Draft/publication state validation, expiry and price/allowance rules | Freeze published fields, parent visibility/client and eligibility; successor leaves purchase unchanged; scoped list/detail/acceptance; unauthorized pricing/discount and expired/superseded acceptance denied |
| Purchases/installments | Request transition table, exact amount/precision, schedule arithmetic | Acceptance creates exactly one purchase/charge/item/pending membership; second key cannot accept twice; dedicated permission and all three agreement methods; due-date revisions preserve amounts and funded history; no pending entitlement |
| Receipt verification | Identity normalization, evidence exception, actor checks and state transitions | Strong receipt identity blocks a second recording across keys/clients; provisional candidates cannot authorize while unresolved. Recording and verification post no lot. Staff verification awaits Admin. Test exactly one origin, missing-reference exception, correction and no approval message before authorization |
| Allocation/partial payments | Allowed kinds/buckets, explicit lines, cumulative target balances | Several receipts fund one installment; one lot funds several installments/purchases; overpayment conversion follows policy; installment counted once; credit application preserves source; manual credit reconciles independently; due-date revision preserves original |
| Concurrent finance | Balance calculation oracle | Competing allocations on the same lot, different lots into one installment, allocation versus refund reservation, conversion versus refund, duplicate origin; exactly one safe outcome or serialized valid partial outcomes, never negative funds/overfunded target |
| Activation | Partial funding, SAR 0 basis, attribution and evidence rules | Unrelated/unapplied payment and Staff-verified receipts awaiting authorization cannot fund activation; payment permissions never confer activation; Staff all grants denied under approved Admin-only rule; activation versus reversal serialized; duplicate keys/new keys grant once; exception reason/evidence required |
| Refunds | Transition table, receipt caps, evidence/mismatch handling | Full/partial receipt and cash-backed credit refunds; linked cases for multiple sources; parallel reservations cannot overrun receipt; duplicate execution claims; process restart after claim; uncertain payout stays reserved; post/reconcile race yields one cash event; proven partial/nonpayment releases only established unused amount |
| Corrections/history | Linked reversal remainder and source checks | Unverified replacement immutable; verified correction compensates; no reversal while allocated/refunded/reserved; purchase decrease cannot make Q<A; original payments and activation evidence survive; audit and balances reconcile after adjustment |
| Lifecycle/entitlements | Riyadh midnight and final valid date, scheduled/open-ended suspension and lifecycle precedence | Activate/expire time and session packages; no grant for time package; scheduled and open-ended suspension, extension with original expiry preserved, no revival of termination; unused units stay in ledger; no grace and explicit prospective post-expiry extension; adjustment/reversal races cannot double grant or cross membership |
| Access and retry | Each named grant independently, strict DTOs | Cross-client IDs/lists/filters/reviews blocked; finance and purchase read scopes independent; partial grant batches denied atomically; current-role/session/grant revocation while waiting and on replay; same-key concurrent success once, changed digest conflict, rollback leaves no replay outcome |
| Database history protection | Kind/reference matrix validates required and forbidden fields | Runtime UPDATE/DELETE of payments' immutable facts, finance events, published versions, purchase snapshots, entitlement/history/audit denied; scoped composite FK violations fail; creator-specific default grants tested |
| Commission regression | Generic commercial DTOs contain no private fields | Staff with all grants, Coach and Client denied commission route; ordinary API/reporting/worker credentials denied private schema; seed distinctive private probe identifiers and check commercial reads/errors/logs/socket payloads for absence. No private connection usage, jobs, notifications or shared cache entries introduced |

Use independent transactions with explicit barriers and observed lock waits for race tests, following Foundation's revocation test pattern; do not rely on arbitrary sleeps. Reconcile all account/lot/purchase/installment totals after success and rejected operations. Test currency precision and Riyadh boundaries with fixed fixtures independent of the execution machine timezone. No new performance infrastructure is needed for bounded M2 race and query tests.

### Before milestone acceptance

- Run the complete later `pnpm verify` and OpenAPI snapshot check in the pinned toolchain and CI. Both currently include only Foundation coverage; add commercial tests to the appropriate scripts in the implementation task so acceptance cannot accidentally skip them.
- Run full receipt → verification → Admin authorization → partial allocations → excess credit → activation → partial refund → reopened debt → explicit adjustment → review examples and compare database-derived totals to an independent oracle. Show original source rows still present.
- Prove no cash duplication on retry, new HTTP keys, expired HTTP retry records, process restart after execution claim and reconciliation. Prove financial balances cannot be overwritten through API or runtime DB role.
- Review policy approvals and disabled paths, Admin authority consistency, all data scopes and commission negative evidence. New exports, caches or delivery paths are outside M2; if added by later scope approval, they must receive the full commission leakage suite before exposure.
- Record review of the eventual migration SQL, runtime/default grants, scoped keys and reconciliation runbook; acceptance does not authorize production migration or deployment.

## Acceptance criteria

M2 may be accepted only when every enabled business path has an approved policy, its explicit action/resource binding and the tests above. Specifically:

1. Public/own-private catalog enforces owner and management scope. Issued terms, expired/superseded decisions and accepted snapshots remain auditable after catalog changes.
2. Dedicated formal acceptance records evidence and exact agreed terms once and issues only pending membership. Other grants never substitute.
3. Recording, verification, Admin authorization, allocation and activation are separate; original receipts and source identity cannot be duplicated or edited away.
4. Partial/multiple payments, installment balances, excess, approved credit and reversals reconcile without double counting under concurrency.
5. Admin-only activation policy is consistent across documents, code and tests; ordinary activation proves eligible allocated payment or credit for this purchase, or the SAR 0 purchase basis. The separately reasoned exception remains gated.
6. Full/partial refunds reserve first, have one execution claim/cash posting, retain uncertain funds and preserve original receipts. Receivable/service effects are explicit.
7. Immediate/future validity, expiry, suspension, termination, explicit extension and unit adjustments follow approved policy and preserve history; expired unused units are never silently deleted.
8. Cross-client reads/writes, unauthorized staff combinations and commission access remain denied across all introduced paths; logs are safe and responses no-store.
9. Every consequential command is transactionally audited and idempotent, with durable domain uniqueness beyond HTTP retries and no partial state after rollback.
10. Foundation regressions, new commercial unit/integration/race tests and contract CI pass. No M3/M4/production scope is implicitly enabled.
