# Milestone 2 decision register

Review date: 7 November 2026. Baseline: `d8390ab` (Foundation). **Review only; no Milestone 2 implementation is authorized.**

“Recommended” means an option for approval, not an approved policy. Existing O-IDs retain their history in [open decisions](open-decisions.md). This register expands only commercial decisions. See the [readiness review](milestone-2-readiness-review.md) for evidence and the [implementation plan](milestone-2-implementation-plan.md) for proposed entities, APIs, finance effects, and tests.

## Decision index

| ID | Decision | Current status | Recommended default | Owner approval required | Implementation gate |
|---|---|---|---|---|---|
| O-01 | Currency, receipt methods, studio date semantics | Pending; Foundation only stores timezone/default currency | One currency, EGP if confirmed; Africa/Cairo if confirmed; cash and bank transfer if confirmed; local business dates and exclusive validity end | Yes: values and customer-facing date rule | Policy validation, money and date handling |
| O-03 | Funding threshold, receipt identity, verification controls | Pending; separation of recording/verification/activation is confirmed | Full purchase funding; one item per purchase at launch; globally deduplicated receipts; independent verifier | Yes | Payment verification and activation |
| O-04 | Allocation, excess funds, credit | Pending policies; many-to-many allocation is already documented | Explicit allocations with oldest-due suggestion; excess remains unapplied; explicit cash-backed credit conversion/reuse; no promotional issuance, expiry, or cash-out | Yes | Allocation, balances, credit |
| O-05 | Refund consequences, evidence, correction authority | Pending policies; preservation and compensating history are confirmed | Admin-only reserved cash refunds; receivable changes and membership decisions remain explicit; correction by compensation | Yes | Refunds, receipt reversals, purchase adjustments |
| O-06 | Private offers, version acceptance, pricing authority | Pending policies; exact-version snapshots already documented | Admin handles private pricing at launch; immutable published ownership; explicit private expiry; reject superseded requests; versioned final prices | Yes | Catalog publication and purchase review |
| O-07 | Validity, suspension, cancellation, grace, remaining units | Pending; Admin lifecycle control and historical units are documented | Start on activation; suspension clock continues; no automatic grace or rollover; explicit extensions and bounded grace; terminal cancellation | Yes | Membership lifecycle and eligibility |
| O-15 | Conflict over ordinary activation authority | Newly identified discrepancy | Plan ordinary activation as Admin-only, as requested in this review; reconcile canonical documents/tests before implementation | Explicit review instruction supplies direction; owner must resolve the conflicting sources before enablement | Activation permission contract |
| O-16 | Concurrent memberships and later selection | Newly identified policy gap | Allow several active memberships; keep validity and units separate; later booking names one membership | Yes | Membership issuance/activation |
| O-17 | Purchase acceptance, cancellation, and price composition | Newly identified policy gap | Atomic acceptance/recording; no direct editing after recording; explicit cancellation; one final price, no tax engine; no free purchases initially | Yes | Purchase and installment lifecycle |
| M2-T01 | Finance event effects and refund reservation/execution semantics (audit B02) | Technical contract incomplete | Closed event matrix, receipt identity guard, frozen reservation bucket, one execution claim and terminal posting | Technical review; owner approves O-03–O-05 business choices, not SQL details | Finance design review |
| M2-T02 | Catalog privacy invariants (catalog part of audit B05) | Technical safeguard missing from schema contract | Freeze published package visibility/client; new identity for reassignment | No new business approval; preserves existing ownership boundary | Catalog design review |
| M2-T03 | Grace history, activation evidence, and membership projections (audit B03) | Technical contract incomplete | Explicit grace interval/revocation; one initial grant; derived expiry; versioned policy | Owner approves O-03/O-07 values; technical details need design review | Entitlement design review |
| M2-T04 | Review after funding correction | Existing rule has no complete proposed relationship | Extend existing entitlement review to reference either a refund or a funding-reversal event | No new financial authority; owner approves O-05 effects | Correction design review |

O-15–O-17 are the only new business entries. Receipt uniqueness belongs to O-03, multiple payments/allocations and schedules to O-04, correction authority to O-05, and activation timing to O-07; those do not need duplicate O-IDs.

## O-01 — Currency, payment methods, and service dates

**Current position.** [Open decisions](open-decisions.md) leaves timezone, currencies, methods, dates and cutoffs pending. The [dictionary](data-dictionary.md#conventions) already specifies UTC instants, separate business dates, `numeric(19,4)`, decimal-string serialization and currency validation. Foundation's settings controller accepts only timezone/default currency and publishes `rules: {}`. Tests using Africa/Cairo and EGP do not approve them. Scheduling cutoffs remain O-08/O-09 and are outside this review.

**Why it matters.** The same due date or “30 days” can mean different things near midnight and daylight-saving changes. A currency code alone does not specify accepted receipt methods or permitted precision.

| Option | Advantages | Disadvantages |
|---|---|---|
| One launch currency and a short method list | Simple reconciliation, no FX, fewer receipt-identity rules | Cannot serve other currency receipts without a later decision |
| Multiple independently settled currencies | Existing account-per-currency model can support it | Requires price lists, per-currency precision and separated reporting; no implicit conversion |
| Validity as elapsed 24-hour periods | Straightforward instant arithmetic | Local expiry can shift with DST and may conflict with advertised calendar days |
| Validity as studio calendar days | Customer-readable dates and stable local midnight boundary | Requires explicit timezone conversion and boundary tests |

**Recommendation for approval.** Confirm Africa/Cairo and EGP rather than inferring either from fixtures or the reviewer's locale. Enable cash and bank transfer only if the studio confirms both; add any other actual method with its identity rules before accepting it. Permit two decimal places for EGP input while retaining the dictionary's storage precision; reject excess precision instead of rounding silently. No FX. Treat installment `due_on` as a studio-local date; overdue begins at the next local midnight. For a duration of N calendar days, the activation's studio-local date is day one and `valid_until` is midnight at the beginning of date + N, exclusive. Activation starts immediately; this can make the first day shorter than 24 hours. Capture that customer-facing rule explicitly. Future service dates use the approved studio timezone, not a phone/browser timezone.

**Impact.** Database: validate currency/methods/precision in policy; store applied start/end instants and policy ID, due dates as `date`. Permissions: `studio.configure` stays Admin-only. API: decimal strings plus currency; validate timestamps and date-only fields separately; reject disabled methods/currencies. Reporting: report by receipt time and selected studio business date, separately per currency; no summing currencies. Future workflows: booking service-time eligibility uses the stored validity boundary; later studio timezone changes must not rewrite earlier deadlines. **Owner approval: yes.**

## O-03 — Funding, verification, and receipt identity

**Current position.** [Financial settlement](business-rules.md#financial-settlement) confirms separate record, verify, allocate and activate commands. [Membership rules](business-rules.md#membership-and-entitlement) exclude unrelated/unapplied receipts from activation, require purchase-matched verified funding, and preserve activation evidence. O-03 leaves threshold, purchase/item attribution, receipt identity, self-verification and exception evidence open. Audit B01 identifies duplicate real-world receipts despite HTTP idempotency; B03 identifies reuse of partial purchase funding across several items. Activation roles are separately reconciled in O-15.

| Option | Advantages | Disadvantages |
|---|---|---|
| Full net verified funding of one purchase | Clear and hard to misattribute | Installment clients need an approved exception before full funding |
| First installment, fixed deposit, or percentage | Supports service before full settlement | Must define amount, rounding, arrears behavior and purchase/item attribution |
| Per-item funding within multi-item purchases | Flexible bundles and staged activation | Requires item allocation, thresholds and refund attribution absent from the current model |
| Recorder may verify own receipt | Works with one operator | Removes a useful second-person check |
| Different recorder and verifier | Separates evidence entry and confirmation | Requires two authorized operators; Admin can record and Staff can verify only with the named grant |

**Recommendation for approval.** One membership-bearing item per purchase at launch, with full net cash-backed allocations to that purchase before ordinary activation. Installment schedules still track collection; partially funded activation uses only an approved, reasoned Admin exception. Do not quietly substitute “first installment paid” as the threshold. Require a different verifier from recorder; verify the actual method/reference/amount evidence, not just a checkbox. Preserve the separate exception path; default exceptions to disabled until the studio states eligible reasons and evidence. An exception does not mark debt paid or create a receipt.

For cash, issue a unique controlled studio receipt number. For bank transfer, require a normalized bank/account namespace plus the external transaction identity. Deduplicate studio-wide, across clients, currencies and new HTTP keys; amount and client are not identity components. Preserve a root receipt identity across replacements, with only one effective verified chain member. An uncertain identity cannot be verified. These are proposed B01 safeguards, not capabilities of the existing optional `external_ref` field.

**Impact.** Database: unique receipt-root identity and set-once origin/verification references; one-item launch validation without removing the future one-to-many item relationship; activation stores policy, evaluated funding, currency and an evidence anchor. Permissions: `payment.record` and `payment.verify` remain independent, with a policy check for different actors; `payment.allocate` confers neither. API: verification rejects duplicate/uncertain identity and superseded receipts; activation computes funding under account lock and rejects override fields. Reporting: show collected, applied, outstanding and exception-activated memberships separately; full funding is not inferred from recorded payments. Future workflows: late installments do not auto-suspend until separately approved; future item-specific funding needs a reviewed extension. **Owner approval: yes, including threshold, self-verification and exception categories.**

## O-04 — Installments, allocation, overpayments, and credit

**Current position.** [Domain relationship corrections](domain-model.md#relationship-corrections) already allow one lot to fund many installments and many lots to fund one installment. Typed `FINANCE_EVENT` rows are the allocation relation; no duplicate allocation table is needed. O-04 leaves allocation priority, targeting, conversion, reuse, issuance, expiry and cash-out pending. Verified funds initially remain unapplied. Reversal restores the original source bucket.

| Option | Advantages | Disadvantages |
|---|---|---|
| Operator explicitly selects targets | Predictable, reviewable, supports several purchases | More manual input; mistakes need linked reversals |
| Automatic oldest due first | Fast and consistent for routine collections | May fund an unintended purchase; needs tie-breaks and explicit client agreement |
| Reject any receipt above a purchase balance | Avoids credit handling | Cannot faithfully record cash already received; payment is account-scoped rather than purchase-scoped |
| Automatically convert excess into reusable credit | Convenient customer balance | Implies a policy choice at verification and can hide unapplied cash |
| Preserve unapplied funds, with explicit conversion/reuse | Records reality and keeps operator intent visible | Requires separate unapplied/credit balances in the UI and reports |

**Recommendation for approval.** Record the actual receipt amount, including excess. Suggest targets by due date, purchase creation time and installment sequence, but require the operator to submit explicit allocation lines. Allow one verified payment/lot to cover multiple installments and purchases belonging to the same client/currency; allow each installment to receive multiple receipts. Apply a batch atomically. Never allocate beyond a target balance or spend a reserved bucket. Excess stays unapplied. Permit explicit conversion of cash-backed unapplied funds to reusable credit, and explicit spending through `payment.allocate`; no automatic conversion, promotional/noncash issuance, credit expiry or cash-out at launch. A cash-backed credit refund still follows the original receipt refund path under O-05, not an unrecorded credit withdrawal.

Where a purchase has a schedule, allocations must target an installment; without a schedule, they may target the purchase. Installing a schedule after purchase-level allocations requires an explicit atomic reversal/reallocation, not counting the same funding twice. Initial installments are positive and sum to the agreed purchase total. Installments have due dates without automatic penalties or membership suspension. Reject edits or retirement of funded installments; replace only unpaid future portions with linked replacements preserving the current scheduled obligation. A purchase adjustment on a scheduled purchase targets an installment through an immutable finance event, changing its effective obligation without rewriting its original scheduled amount; each adjusted portion must still cover its net allocations. The aggregate schedule and purchase obligation must agree. Reallocation needs `payment.allocate`, in addition to `installment.manage` when changing the schedule. Automatic rescheduling is excluded.

**Impact.** Database: lot/bucket/source traces, optional installment target and scoped FKs; no stored mutable balance. Permissions: `finance.read`, `installment.manage`, `payment.allocate` stay independent; explicit credit conversion uses `payment.allocate`, while exceptional issuance/forfeiture would require Admin-only `credit.adjust` and stays disabled. API: batch lines share an account/currency; allocation planning is advisory; each line has a durable posting key; schedule replacement rejects funded lines. Reporting: derive receipt cash once, purchase settlement once, installment arrears, unapplied and available-credit buckets separately. Future workflows: activation counts net cash-backed credit spending to the purchase; later reminders use due dates, never grant themselves financial authority. **Owner approval: yes.**

## O-05 — Refunds, reversals, and administrative corrections

**Current position.** [Settlement rules](business-rules.md#financial-settlement) preserve receipts and refunds, require compensating verified corrections, reserve before manual execution, retain uncertain payouts, and separate membership review from cash return. The [matrix](permission-matrix.md) fixes refund decision/execution/post/reconciliation, payment reversal, credit adjustment, membership management and entitlement correction to Admin. These authorities are not reopened. O-05 still needs receivable effects, execution evidence and permitted correction procedures. Audit B02 needs a closed effect matrix.

| Option | Advantages | Disadvantages |
|---|---|---|
| Cash refund automatically cancels purchase/membership and restores sessions | Few operator steps | Conflates cash, debt and service; can restore consumed units or cancel partially retained service incorrectly |
| Explicit finance adjustment and separate membership review | Traceable intent; fits the existing contract | Requires Admin to resolve the service consequence deliberately |
| Edit/delete a verified receipt | Superficially simple | Breaks history and reconciliation; incompatible with the confirmed preservation rule, so unavailable |
| Compensate original postings and append corrected evidence | Maintains accountability and balances | Must resolve dependent allocations, reservations and prior refunds first |

**Recommendation for approval.** Offer full and partial **cash** refunds of verified, receipt-backed funds. A full refund means the full remaining refundable amount on that original receipt; a purchase paid through several receipts requires separate receipt-scoped refund cases. Reversal of a purchase allocation reopens its receivable; a refund does not forgive that debt. If the studio is cancelling or reducing the sale, Admin separately posts a reasoned receivable adjustment and resolves the membership review. No tax, accounting journal or automatic clawback policy is introduced.

Approval freezes amount, currency, lot and bucket, reserves receipt capacity and any necessary freed allocations atomically. One Admin claims execution before handing over cash/sending a transfer. Require method, executed-at, external payout/controlled voucher reference and a reason; a safe reference is sufficient for this milestone, with no new file-storage infrastructure. Normal posting requires the approved amount and evidence. On ambiguity keep the reservation and prohibit another payout claim. Reconciliation can post a proven smaller payout and release a proven unpaid remainder; store approved, actual and released amounts distinctly. If actual payout exceeds the reservation, retain observed evidence and reconciliation state, do not pay again or silently cap the record; resolve extra capacity within receipt limits or leave a visible discrepancy for Admin resolution. The normal path never breaks the original receipt cap.

An unverified correction appends a replacement and permanently supersedes the old facts. A verified error uses Admin-only linked reversal events; no in-place amount/method/reference edits. Resolve dependent allocations and keep funds reserved for uncertain refunds. Default to whole remaining verification reversal only after dependencies are clear; then append a replacement receipt under the same identity chain. A real cash return is a refund, not a verification reversal. Erroneous refund evidence is corrected by additional audited reconciliation information, never deletion of a true cash movement. Historical activation evidence remains unchanged; a funding reversal opens an Admin review, not automatic deactivation.

**Impact.** Database: frozen reservation bucket and immutable transition/evidence history, one execution token, at most one terminal cash event, linked reversals with bounded remainder, review per affected membership, reasoned purchase adjustment events. Permissions: preserve existing Admin boundaries; requests remain Client-own/Admin-on-behalf, Staff denied. API: decide/claim/post/reconcile are separate commands; no generic “set paid” or refund DELETE/PATCH. Reporting: refund cash, reopened debt, forgiven debt, reserved funds and unresolved payout discrepancies are distinct measures; no editing prior-period source records. Future workflows: booking consequences wait for scheduling policy; consumed sessions are never restored merely because money was refunded. **Owner approval: yes for receivable policy, evidence and correction procedure; existing role restrictions stand.**

## O-06 — Catalog, private offers, and pricing

**Current position.** Published versions and agreed purchase-item snapshots are immutable in the [domain model](domain-model.md); changed terms need explicit acceptance. Public packages have no owner; private packages have exactly one client. O-06 leaves expiry, superseded acceptance and Staff private pricing open. Audit B05 observes that changing parent visibility/owner could expose historical private terms. `catalog.manage` and `catalog.private.manage` are independently grantable; `catalog.read` lets Staff read only published public offers. “Public” does not currently mean anonymous or Coach access.

| Option | Advantages | Disadvantages |
|---|---|---|
| Accept old versions indefinitely | Clients retain quoted terms | Old prices remain actionable without a clear commercial cutoff |
| Reject superseded/expired offers at acceptance | Small, predictable launch rule | Clients must explicitly accept the replacement version |
| Offer acceptance window/grandfathering | Supports time-limited quotes | Requires persisted deadline and more acceptance policy |
| Admin-only private/custom pricing | Small authority surface | Admin performs all special offers |
| Explicit Staff private-pricing grant | Fits the canonical matrix and delegates work | Requires approved delegation and clarified private management-read scope |
| Arbitrary price override while recording a purchase | Fast discounts | Can bypass private pricing authority and obscure accepted terms |
| Final agreed price in a client-specific published version | One pricing source and clear acceptance | More catalog versions for bespoke offers |

**Recommendation for approval.** Keep public catalog management grantable as documented, with grants initially disabled until assigned; no separate publish approval role. The same authorized public manager may create/edit drafts, publish a version and archive it. At launch assign no `catalog.private.manage` Staff grants: Admin creates, prices and publishes client-only offers. This is a grant configuration recommendation, not removal of the documented grant. Freeze visibility/client once any version is published; reassignment creates a new package. Store an explicit acceptance expiry on private versions. Require the Admin to choose it; do not invent a seven/thirty-day default. Reject superseded, expired or archived offers at request acceptance as well as new request creation. Requote a new version and obtain new client acceptance. Existing purchases remain untouched.

Represent discounts as the final agreed version price, with optional original/list price snapshot and mandatory discount reason when applicable; do not add a separate discount engine. Reject arbitrary purchase price overrides; create a private version instead. Snapshot agreed price and discount evidence. Staff private management reads are a contract ambiguity: do not use `catalog.read` to expose private offers. Document a dedicated management projection under `catalog.private.manage` before delegating private management; Admin-only at launch avoids granting broad private reads by inference.

**Impact.** Database: acceptance expiry, immutable owner/visibility and eligibility; optional list-price/discount-reason snapshot fields only where discounts are offered. Permissions: public/private managers independent, client private owner check on every list/detail/acceptance; no implicit private access via `purchase.record`. API: strict draft/publication transitions and exact version IDs; conflict requires requote, not substitution. Reporting: agreed price and discount are from the purchase, never today's catalog. Future workflows: eligible session types remain version-linked; private quote expiry stops acceptance, not a purchased membership. **Owner approval: yes for expiry choice, old-version acceptance and pricing delegation; immutability/privacy safeguards preserve existing contracts.**

## O-07 — Membership validity, suspension, grace, and unused sessions

**Current position.** [Membership rules](business-rules.md#membership-and-entitlement) issue pending memberships without usable entitlement, authorize Admin suspension/cancellation/extensions/grace, derive expiry/exhaustion and preserve unit history. O-07 leaves time freezing, reinstatement/cancellation effects, grace precedence and unused sessions open. Audit B03 requires explicit grace start/revocation, not just `grace_until`.

| Option | Advantages | Disadvantages |
|---|---|---|
| Suspension continues the validity clock | Simple and matches fixed purchased dates | Client may lose service time during a pause |
| Suspension freezes the clock | Protects paused time | Needs overlap-safe pause accounting and clear retrospective rules |
| Automatic grace or unused-unit rollover | Customer-friendly | Creates obligations and eligibility ambiguity without a defined policy |
| Explicit dated Admin extension/grace; no rollover | Visible exception and stable formal expiry | Requires manual review for exceptions |
| Activation-now versus scheduled first-service start | Immediate start is easy to evidence; delayed start avoids lost days | Delayed start requires scheduling rules and future eligibility states |

**Recommendation for approval.** Activation starts now using O-01 calendar-day validity. No future/backdated start in ordinary activation. Suspension immediately blocks eligibility while the clock continues; reinstatement preserves formal expiry and cannot make an already expired membership eligible. Cancellation is terminal, preserving money and ledger history. No automatic grace, renewal, rollover, unit forfeiture posting or transfer between memberships. Expired unused units stay visible as historical remaining units but are unusable. Admin may extend formal expiry with reason, including an expired but uncancelled membership; this makes existing remaining units usable again without another grant. Do not silently revive a suspended/cancelled membership. Time packages have no session-unit balance.

Allow explicit Admin grace only as a bounded `[starts_at, ends_at)` interval for an otherwise ACTIVE membership; it extends eligibility without changing formal expiry or adding units. Cancellation/suspension override grace; exhaustion blocks session use even during grace. Permit at most one effective grace interval per membership at a time; reject overlaps and revoke through a linked event. No automatic maximum duration is assumed: record the explicit approved interval and reason. Extensions must strictly increase the current expiry; shortening is a separate reviewed correction, not a negative extension. Discretionary unit reductions must not make remaining units negative at launch; consumed service history is never rewritten. Version the policy applied to each action. Future confirmed-booking effects are out of scope; once bookings exist, lifecycle commands must use their approved dependency protocol rather than silently orphan commitments.

**Impact.** Database: event-based lifecycle, explicit old/new expiry, grace interval and revocation reference, one initial session grant; preserve purchased versus extended validity. Permissions: `membership.manage` and `entitlement.adjust` stay Admin-only and independent of verification/allocation. API: expose lifecycle, effective eligibility, formal expiry, grace and historical units separately; reject invalid/repeated transitions; no balance replacement endpoint. Reporting: distinguish suspended, expired, exhausted and cancelled, with reasons and adjustment deltas. Future workflows: service-time eligibility and commitment checks reuse this projection; attendance later debits only through accepted verification. **Owner approval: yes.**

## O-15 — Ordinary activation authority conflict

**Current position.** This review request expressly calls for “Admin-only membership activation.” The current [permission matrix](permission-matrix.md), [business rules](business-rules.md), `permissions.ts`, the persisted Staff grant enum, and unit/integration test expectations permit specifically granted Staff to invoke ordinary verified-funded activation. Only the exception is unambiguously Admin-only today. Both activation routes remain disabled workflow stubs.

| Option | Advantages | Disadvantages |
|---|---|---|
| Admin-only ordinary and exception activation | Follows the explicit review request and centralizes authority | Requires a deliberate correction to the current matrix, route contract and test expectations |
| Preserve explicitly granted Staff ordinary activation | Matches Foundation's tested permission contract | Conflicts with the review request's stated activation requirement |

**Review direction.** Plan Admin-only ordinary activation, as requested. Do not alter Foundation during this review. Before implementation, record the owner's resolution and reconcile the canonical matrix, business/API wording and affected tests. Keep the exception as its own reasoned Admin command even if both paths have the same role. Do not extend `payment.verify` into activation authority. A dormant legacy Staff grant must not confer activation after the Admin-only policy is adopted; deny it in the action mapping and define its administrative retirement deliberately rather than casually altering the Foundation migration.

**Impact.** No new commercial entity; policy/permission mapping and existing grant handling need consistency. API activation rows in the plan are Admin-only pending reconciliation. Reports preserve activation actor and funding basis. Future workflows cannot auto-activate upon payment. **Owner resolution required before activation implementation; the preferred direction comes from this explicit request, not a newly inferred business rule.**

## O-16 — Concurrent memberships

**Current position.** The ERD permits many memberships per client and one per purchase item, but does not say whether simultaneous ACTIVE memberships are commercially allowed. A schema cardinality is not launch approval.

| Option | Advantages | Disadvantages |
|---|---|---|
| One active membership per client | Simple future selection | Blocks early renewals and parallel session/time products; requires a cross-row rule and replacement policy |
| Multiple independently tracked active memberships | Fits the model and avoids automatic replacement | Later bookings must select and validate one membership |

**Recommendation for approval.** Permit several independently active memberships, including overlapping dates, with no pooling, priority spending or automatic cancellation of the previous one. Future booking explicitly names one membership. **Impact:** database retains client/state/validity index without active-client uniqueness; permissions remain client-own/Admin; API list returns distinct eligibility and units and activation does not overwrite another membership; reports aggregate counts carefully without merging entitlements; future booking/attendance attaches to exactly one membership. **Owner approval: yes.**

## O-17 — Purchase contract and lifecycle

**Current position.** Requests refer to exact versions; recording creates one or more items and pending memberships; positive receivables post atomically. The dictionary says zero-price issuance needs approved policy. Request states, atomic approval versus recording, cancellation and charge/discount composition are not fully specified. Existing permissions distinguish `purchase.review` from `purchase.record`.

| Option | Advantages | Disadvantages |
|---|---|---|
| Approval and recording are separate pending steps | Each independent grant can perform its stage | Approved requests can drift before recording; needs an extra state and expiry rule |
| Acceptance atomically records purchase | No approved-but-unrecorded contract gap | Accepting caller needs both review and record actions |
| Editable purchases or silent cancellation | Superficially convenient | Invalidates snapshots or hides debt and received cash; incompatible with preservation requirements |
| Immutable recorded terms with explicit cancellation/adjustments | Traceable contract, money and entitlement | More explicit Admin commands |

**Recommendation for approval.** Client submits/withdraws an own pending request. `purchase.review` can reject; acceptance also requires `purchase.record` and atomically creates exactly one purchase, its charge, item, schedule if supplied and PENDING_ACTIVATION membership. Direct assisted recording uses `purchase.record`, exact eligible terms, and an acceptance-evidence reference/reason; it cannot pretend the Admin is a Client calling `purchase.request`. Persist explicit client agreement for a private quote. Avoid an APPROVED state awaiting another operator. Preserve one purchase per request.

Request states: REQUESTED → ACCEPTED, REJECTED or WITHDRAWN. Expired/superseded offers cannot be accepted; rejection/requote remains explicit. Purchase lifecycle: RECORDED → CANCELLED through Admin-only reasoned financial correction under `payment.reverse`; cancellation requires `membership.manage`/`entitlement.adjust` too when their effects are requested. Recorded amounts/items are immutable. Unfunded cancellation can offset the charge and cancel the pending membership atomically. Funded cancellation requires explicit unallocation plus refund/retained-credit disposition; do not label cash refunded until posted. Active-service cancellation requires an explicit membership review. Settlement status (unpaid/part-paid/paid, with unapplied funds separate) is derived, not a writable lifecycle flag. Reject zero-price purchases at launch; gifts require later approval. Agree the final total in the offer; no independent taxes, fees, stacking discounts or tax-invoice engine in M2. The studio must confirm whether advertised prices already include any applicable charges; implementation does not invent a tax treatment.

**Impact.** Database: request/purchase state and transition audit, unique request link, final-price snapshot and acceptance evidence; no redundant mutable paid total. Permissions: acceptance checks both independent actions; Admin-only financial corrections reuse existing authority rather than granting Staff a new cancellation power. API: explicit accept/reject/withdraw/record/cancel commands, no mutable recorded-item endpoint. Reporting: cancelled contract, charge adjustments, retained funds and refunds remain separate. Future workflows: pending purchases grant no service; cancellation cannot erase consumed history. **Owner approval: yes.**

## Technical closure and approval record

M2-T01–T04 do not add services or a general ledger. Their concrete proposal is in the [implementation plan](milestone-2-implementation-plan.md#finance-event-contract-proposed). Before migrations, review the complete event/reference matrix, composite keys, posting uniqueness, permissions and source-linked histories. Before affected workflows, close B01–B03 and the catalog portion of B05 with tests; this review does not mark them closed.

The approval record should list each O-ID, selected option/deviation, approving owner, date, policy version/effective date, and any disabled optional path. Approval of this report alone must not be interpreted as approval of every recommendation or authorization to implement. O-02 continues to gate real onboarding; O-08–O-13 remain outside this milestone except for their explicitly identified future dependencies.
