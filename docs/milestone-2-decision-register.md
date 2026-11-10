# Milestone 2 decision register

Updated 10 November 2026. Business approval comes from the project owner’s consolidation and final decision briefs. Repository baseline is `055a67d` on `main`, with Foundation implemented in `d8390ab`. This record supersedes conflicting recommendations in the 7 November review. The [decision index](open-decisions.md) preserves O-01–O-17. The [readiness review](milestone-2-readiness-review.md) distinguishes source evidence from future work. No production policy revision or feature is established by the brief.

## O-01

**Approved — business configuration.** Saudi Arabia, Saudi Riyal (SAR), Asia/Riyadh (UTC+3). Admin can add, edit, enable and disable any locally applicable manual payment method, with per-method instructions. Cash, bank transfer, Mada and STC Pay are examples. Payments retain the historical method. Evidence is shared outside the app. Record a reference when available. Admin may authorize a missing-reference exception with a reason. The exception concerns evidence, separate from membership activation authority. Membership validity uses Riyadh calendar dates and includes the entire final valid day.

**Implementation dependencies.** A versioned method/evidence contract, stable method history, method-specific receipt identity, currency input precision and local date conversion. Represent end-of-day validity as an exclusive next-midnight instant, using the applied timezone and policy. Foundation publishes timezone/default currency with empty commercial rules. The Egypt examples in Foundation are fixtures.

## O-02

**Approved in part — client onboarding and access.** Admin can create Client accounts. Clients may self-register when Admin enables public registration. Require email verification. Admin password recovery uses the verified email address. Staff start with no sensitive permissions. Admin grants each action individually. Staff cannot grant permissions to themselves or another Staff member. Audit sensitive actions. **Deferred:** mandatory Admin MFA.

**Owner question.** How should Admin-created clients receive setup access, and does verified email itself enable sign-in in each onboarding path? This determines when accounts become usable. For release, who can provision the initial production Admin and manage Admin account lifecycle? This determines initial access and prevents loss of the only Admin account. See O-14.

**Implementation dependencies.** Define verified/active state transitions, registration policy checks, purpose-bound single-use invite/verification/reset tokens, collision and abuse handling, session revocation and recovery audit. Foundation already checks current grants and verified active accounts and provides audited Admin grant changes. Registration, invitation, verification and recovery are still stubs.

## O-03

**Approved — payment authority.** Admin or individually authorized Staff may record payments. Specifically authorized Staff may perform initial verification, which always needs subsequent Admin review and authorization. The same Admin may record, verify and authorize a payment. Record, verify and authorize remain distinct events and statuses. Preserve recorder, verifier, reviewer and authorizer and their timestamps. Recording alone never means verification or authorization.

**Approved — purchase-specific funding.** Count only authorized payment amounts and client credit explicitly allocated to that purchase. Funding never moves implicitly. Reallocation requires an authorized, audited operation. Admin may separately activate a partially funded purchase. Keep remaining debt visible. Payment and credit operations never activate service.

**Owner questions.**

- What minimum allocation, if any, qualifies for partial-payment activation, and how should funding be attributed if one purchase contains several membership items? This prevents the same funds from qualifying unrelated items.
- May a Staff recorder also perform the initial verification? Same-Admin authority is approved. This determines the Staff workflow while preserving the final Admin checkpoint.
- Under what conditions and with what evidence may Admin activate without qualifying funding outside SAR 0 issuance? The separate activation exception stays gated.

**Implementation dependencies.** [M2-T01 and M2-T03](milestone-2-technical-contracts.md) cover receipt identity, authorization and reallocation effects, source evidence, and the eligibility snapshot. B01–B03 remain technical gates. Foundation has no commercial payment implementation.

## O-04

**Approved — allocation, installments, credit and corrections.** Admin explicitly selects purchases or installments. Payments can be split across targets, and a target can receive multiple full or partial payments. Automatic oldest-purchase allocation is prohibited. Keep original receipts and allocations traceable. Installments are overdue when the due date passes with a balance. Only Admin revises due dates, with a reason and audit record. Preserve original dates and amounts.

Overpayment may become non-expiring credit. Only Admin applies credit in full or in part to selected future purchases/installments, or increases/decreases it with a reason and separate ledger postings. Clients can see balances and transaction history. Admin may authorize a formal cash refund of all or part of credit, with a reason. Clients cannot independently cash out. Reduce credit through linked financial transactions and preserve its history. Decide membership consequences separately.

Staff with the named grant may request corrections. Admin initiates and authorizes linked reversals and corrections. Change balances only after authorization. Preserve and audit original records.

**Owner questions.**

- Does excess become credit automatically or only when Admin chooses to convert it? This determines when the balance becomes available as credit.
- What source should a credit refund reference when the credit was issued manually and there is no original payment? O-04 approves credit refunds and O-05 requires original-payment linkage. The answer determines whether and how this source can be supported without fabricating a receipt.

**Implementation dependencies.** [M2-T01 and M2-T04](milestone-2-technical-contracts.md) cover typed ledger effects, cash and manual credit provenance, refund holds, explicit allocation/reallocation, and due-date history. Cash-backed credit refund design can be reviewed while the original-payment rule for manual credit is clarified.

## O-05

**Approved — refunds, evidence and receivables.** Admin reviews full and partial refunds individually. Refund is a separate financial transaction. Preserve original payment and installment history. Admin independently decides membership and remaining-session consequences. Audit decisions and adjustments.

Record a reference to the actual payout, such as a bank transfer reference, cash receipt number or transaction ID. Actual proof is shared outside the application. Admin can approve a missing-reference exception with a reason. Link the evidence to the refund transaction and original payment. O-04 tracks the open linkage question for credit without an original payment.

Refunding cash does not automatically reduce what is owed on installments. Only a separate reasoned and audited Admin adjustment can reduce the receivable. Prevent double counting. When unallocating applied funds is necessary to fund a refund, record that as a separate posting that reduces settlement, distinct from a change to the contractual amount owed.

**Implementation dependencies.** [M2-T01 and M2-T04](milestone-2-technical-contracts.md) cover payout evidence and exceptions, reservation, execution, failure/reconciliation, source limits and separate receivable and service effects.

## O-06

**Approved — private offers.** Admin can create, modify and withdraw private offers. Staff manage private offers only with a dedicated permission granted by Admin. Clients see only private offers intended for their accounts. Admin/Staff access is permission-controlled. Expiration is optional and uses Asia/Riyadh. An offer without an expiry stays available until withdrawal or supersession. Expired or superseded versions cannot be accepted. Issue a new version for changes, preserve old versions for audit, and never overwrite accepted offers or purchases. Admin can withdraw an unaccepted offer and must give a reason.

**Remaining scope questions.** Does the Staff management grant include withdrawal? Admin withdrawal is approved and the proposed route stays Admin-only pending any explicit delegation. Can one private offer be reused for multiple purchases? The proposed acceptance constraint treats a private offer as a single agreement. Clarify that cardinality before fixing a unique constraint.

**Implementation dependencies.** [M2-T02 and the Riyadh date contract](milestone-2-technical-contracts.md#saudi-date-and-time-contract) cover owner predicates, immutable issued terms, exact-version locking, withdrawal and expiry boundaries, and separate permissions for management and acceptance. B05 still requires technical review.

## O-07

**Approved — membership and entitlement.** Only Admin activates. Validity starts on the Riyadh calendar date of Admin activation by default. Admin may choose a future effective start date at activation. Preserve activation timestamp and effective start date. Recording and verification do not start membership validity. Keep the entire final valid day.

Admin can suspend with a reason and start date. End-dated suspension reactivates automatically on its configured end date. Open-ended suspension requires manual Admin reactivation. Validity continues during suspension unless Admin separately extends it. Unused sessions expire with membership validity. There is no automatic grace. Admin can explicitly extend validity without a new purchase or payment, including as an exception after expiration. Require reason and audit history and preserve the original expiration date. Admin can terminate an active membership before expiry, separately from purchase cancellation. Review remaining sessions and financial consequences independently and preserve all lifecycle and adjustment history.

**Implementation dependencies.** [M2-T03 and M2-T04](milestone-2-technical-contracts.md) cover effective boundaries, dated transitions, original and revised expiry, source-linked service effects and once-only initial grants. Confirmed booking consequences remain under O-08.

## O-08

**Unresolved — scheduling.** Milestone 3. Waitlisting remains deferred pending scope and order.

**Owner question.** What hold duration, client limits, coach buffers, replacement holds and affected-booking rules should launch, and is a ranked waitlist in scope? These determine capacity and how existing commitments are handled after lifecycle changes.

## O-09

**Unresolved — attendance exceptions.** Attendance counts as held only after Coach completion submission and Admin verification. Entitlement deduction occurs only after Admin verification for the selected membership.

**Owner question.** What late submission deadline, no-show/late-cancellation charges, insufficient-entitlement behavior and correction recipients apply? These determine which verified outcomes consume sessions and how exceptions are handled. Milestone 3.

## O-10

**Unresolved — commission distribution.** Commission data remains strictly Admin-only, including when the Coach is the recipient. Automatic calculation is deferred.

**Owner question.** Who is eligible for manual commission and how may Admin distribute or reverse it? This determines the private recipient model and settlement constraints. Milestone 4.

## O-11

**Approved in part — notifications and email.** Initial channels are in-app and email, in Arabic and English. Push and SMS are deferred. Initial email provider is Hostinger SMTP behind a replaceable interface. The proposed sender is `notifications@yourdomain.com`, subject to actual domain configuration. Distinguish essential transactional notifications from optional categories. Admin controls categories and delivery configuration, including optional categories to manage costs. Automate membership-expiry and overdue-installment reminders. Admin controls schedules, frequency, channels and monthly reminder limits. Use Asia/Riyadh and prevent duplicate reminders.

Payment messages distinguish recording, verification/authorization, and rejection or return for correction. Delegated verification cannot send final approval before Admin authorization.

**Owner question.** Which categories are essential, and what initial reminder schedules, channels and monthly limits should Admin configure? This determines mandatory delivery and cost controls.

**Implementation dependencies.** Actual sender/domain and DNS/TLS, SMTP account and secret provisioning, hosting and registry access, designated alert ownership, and representative workload/acceptance targets. Define safe outbox events, timezone and dedup keys, limit scope, templates and retry behavior. Delivery remains a later milestone.

## O-12

**Approved in part — backup and recovery.** Automated daily encrypted PostgreSQL backups with at least one copy outside the VPS, documented restoration, periodic restore tests and monitored success/failure. Retain 30 daily, 12 weekly and 12 monthly copies. Maximum RPO 24 hours. Target RTO 8 hours. Alert Admin and the designated Technical Administrator on failure. Log execution results and failures. Restrict key custody and backup access.

**Owner question.** Who owns backup/key custody and monitoring, which off-VPS provider and restore-test cadence should be used, and will Hostinger backup supplement that policy? These inputs determine restore access and evidence of recoverability.

**Implementation dependencies.** Select storage, provision and restrict credentials, test key recovery and off-VPS restoration, verify retention and alert delivery, and measure RPO/RTO. Approval does not establish that any backup job or restore test exists.

## O-13

**Approved in part — warranty and technical maintenance.** Provide a 30-day post-launch warranty for in-scope bug fixes, with priority for critical production issues. Handle new features and scope changes separately. Agree hosting and ongoing maintenance costs separately. A designated Technical Administrator handles VPS, database, Redis, backups, security updates and diagnostics. The technical role is separate from business permissions and does not confer financial authorization, membership activation or confidential commission access.

The designated Technical Administrator can deploy directly to authorized production without separate Admin approval for each update. Log person, version, timestamp and outcome. Maintain rollback and recovery procedures. During a critical incident when the designee is unavailable, Admin may authorize an alternative technical person temporarily. Make access scoped, time-bound, revocable and audited.

**Owner question.** Who is the designated Technical Administrator, and what mobile launch targets, handover ownership and ongoing support commitments apply? Release needs an accountable operator and a defined handover and support boundary.

**Implementation dependencies.** Define separate infrastructure identities, access paths, credential custody and emergency approval, expiry and revocation workflow. Verify controls against direct database access and release tooling. See [deployment and security](architecture-review.md#deployment-and-security).

## O-14

**Approved in part — implementation and initial production authorization.** Foundation was authorized. Initial production go-live still requires separate authorization. O-13 covers subsequent production updates by the designated Technical Administrator.

**Owner question.** Who signs off initial go-live and how will the approval be recorded? This sets the initial cutover gate. Production Admin bootstrap is tracked under O-02. Milestone 2 implementation remains outside this documentation task.

## O-15

**Approved — Admin-only activation.** Both ordinary and exceptional membership activation require Admin. Payment permissions and persisted legacy Staff grants confer no activation authority under the approved policy.

**Implementation status.** At the Foundation baseline, the ordinary stub accepted the legacy Staff grant. The public catalog implementation denies it on both stubs and rejects new assignment. Stored rows remain for compatibility and history. The [evidence and reconciliation checklist](milestone-2-readiness-review.md#o-15-authorization-conflict) inventories the action mapping, route checks, persisted grant, tests and documentation. Reconcile before enablement. No further business approval is needed for the Admin-only rule.

## O-16

**Approved — concurrent memberships.** Multiple memberships or packages may be active concurrently for one client. Preserve independent validity, entitlement, payment, attendance and adjustment histories. Future bookings explicitly identify the membership covering the session, and entitlement usage remains attached to that membership.

**Implementation dependencies.** No one-active-membership-per-client constraint. Bind funding to the correct purchase/item and bind bookings, Coach submissions and Admin attendance verification to the selected membership. M2 preserves those relationships. Booking and attendance are later work.

## O-17

**Approved — acceptance and agreement evidence.** Admin may formally accept and record a purchase. Staff may do so only with an explicit dedicated permission. Client intent alone does not constitute formal acceptance. Every accepted purchase has client agreement evidence: explicit in-app confirmation, a reference to a signed agreement communicated separately, or a verbal agreement recorded by Admin or authorized Staff with a supporting note. Electronic signatures are unnecessary for the MVP. Preserve client, purchase, frozen terms, acceptance method, timestamp, responsible person and evidence reference or note as applicable. Membership activation remains Admin-only and separate.

**Approved — immutable terms, cancellation and SAR 0 issuance.** Freeze package, services, price/currency, sessions/duration, validity, installments, discounts and custom terms. Later catalog changes leave the purchase intact. Admin may cancel with reason and audit even after activation or partial use. Review membership consequences separately. Cancellation never automatically refunds or changes credit. Preserve financial and usage history. Admin may issue a SAR 0 purchase with a reason or purpose, normal membership and entitlement terms, and no artificial payment or revenue.

**Owner question.** Which price components and discount rules are allowed, and what should remain owed after cancellation absent a separate receivable adjustment? This determines validation of the frozen price and the cancellation accounting workflow.

**Implementation dependencies.** [M2-T02 and M2-T04](milestone-2-technical-contracts.md) cover exact-version evidence, dedicated acceptance authority, atomic acceptance and recording as a proposed design, cancellation review and immutable snapshots. Finance and zero-price activation also depend on M2-T01 and M2-T03.

## Technical closure

| ID | Unresolved contract | Dependency and gate |
|---|---|---|
| M2-T01 | Payment and finance state/effect matrix, including distinct verification and authorization, receipt identity and authorized evidence exception, mixed credit provenance, due-date history, refund reservation and execution reconciliation | O-01/O-03–O-05/O-17, audit B01–B02. Review before finance migrations. |
| M2-T02 | Catalog privacy invariant and exact-version acceptance under the package lock | O-06/O-17, catalog part of B05. Review before catalog and purchase writes. |
| M2-T03 | Funding attribution and immutable activation evidence, date/expiry boundaries, suspension transitions, zero-price activation and entitlement projections | O-01/O-03/O-07/O-15–O-17, audit B03. Review before enabling membership commands. No grace workflow. Review explicit extension after expiry and future-dated activation. |
| M2-T04 | Separate membership and session decisions for refund, funding correction, and purchase cancellation, with same-source and membership checks | O-04/O-05/O-07/O-17. Review before enabling consequences of financial changes. |

The [technical contract review](milestone-2-technical-contracts.md) classifies closure and sequencing. The [implementation plan](milestone-2-implementation-plan.md) maps those contracts to slices. Enabled paths require their applicable owner choices, a versioned effective policy and tested implementation.
