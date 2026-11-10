# Business rules and transaction boundaries

Confirmed requirements are marked **Confirmed**. Technical choices here are **Proposed** unless otherwise noted. The [studio decision index](open-decisions.md) tracks policy status. The [readiness review](milestone-2-readiness-review.md) tracks implementation.

## Identity and catalog

**Confirmed.** Admin can create Client accounts. Clients may self-register when Admin enables it. Require email verification. Admin recovery uses verified email. Mandatory Admin MFA is deferred. Staff start without sensitive permissions. Only Admin grants each action and sensitive actions are audited. Invitation and post-verification enablement remain open under O-02.

**Confirmed.** Accepted purchases retain immutable package, services, price/currency, session/duration, validity, installment, discount and custom terms. Admin may cancel with a reason even after activation or partial use. Review membership consequences separately. Preserve usage and finance history. Cancellation never automatically refunds or changes credit. Admin can issue SAR 0 purchases with a recorded purpose, normal service terms and no artificial payment or revenue.

**Confirmed.** Private offers are client-specific. Staff need the dedicated private management grant. Issued terms are immutable and changes issue a new version. Expired or superseded versions cannot be accepted. Expiration is optional and uses Riyadh time. Admin can withdraw an unaccepted offer with reason. Preserve prior versions and accepted purchases. The proposed locking and scoped reads are in the [private catalog contract](milestone-2-technical-contracts.md#private-catalog-and-offer-privacy).

**Confirmed.** Admin or Staff with dedicated authority formally accepts and records the purchase. Client intent alone is insufficient. Record agreement via explicit in-app confirmation, a signed agreement reference, or a supported verbal note. Preserve method, client, purchase, agreed terms, timestamp and responsible person. Electronic signatures are unnecessary for MVP.

## Financial settlement

**Confirmed.** Use Saudi Riyal (SAR) and configurable manual methods with historical method values and per-method instructions. Share evidence separately and record a reference when available. Only Admin can authorize a missing-reference exception with a reason. Keep recording, verification, final authorization, allocation and membership activation separate.

| Operation | Approved boundary and proposed posting effect |
|---|---|
| Record | Admin or independently authorized Staff records original facts. No balance effect. |
| Verify | Admin or specifically delegated Staff records verification. Admin may verify their own recording. Staff verification awaits Admin review and authorization. |
| Authorize | Admin records final decision, including review of delegated verification. Preserve recorder, verifier, reviewer and authorizer with separate timestamps, even when one Admin handles all steps. Proposed posting creates one cash-backed lot and origin under the finance lock only at authorization. |
| Allocate | Admin manually selects one or more purchases/installments and amounts. Several payments can fund one target. No automatic oldest-purchase allocation. Only payments and credit explicitly allocated to the purchase count toward funding. Audit explicit reallocation. Installment allocations reduce outstanding once. |
| Service installments | Preserve original due date and amount. Admin date revisions require reason and audit. Derive overdue after the due date while a balance remains. |
| Convert or spend credit | Excess can become non-expiring credit. Admin applies all or part to selected future purchases/installments. Clients see their balance and history. Admin increases or decreases credit through reasoned separate ledger transactions. Only Admin can authorize credit cash-out through the formal refund workflow with a reason and linked ledger effects. The conversion trigger and source linkage for manual credit remain open. |
| Correct | Staff with the designated grant can request a correction. Admin initiates and authorizes linked reversal and correcting transactions. Change balances only upon authorization. Keep original facts and history. |
| Refund | Admin reviews full or partial refund individually. Post confirmed cash return separately and link original payment and actual payout reference or reasoned Admin exception. Approval alone moves no cash. An Admin may separately authorize a reasoned receivable adjustment. Refund never automatically reduces installment obligations. |
| Review service effects | Admin separately decides membership and remaining-session consequences. Refund alone does not cancel or change units. Audit decisions and adjustments. |

Use a durable posting key per event, scoped client/currency references and an account lock for aggregate validations. The [finance contract](milestone-2-implementation-plan.md#finance-event-contract-proposed) proposes origin, credit, reversal and refund controls. No balance is overwritten. Keep external payout outside the database transaction. A source-linked refund or correction preserves historical activation evidence.

## Membership and entitlement

| Transition | Approved authority and effect |
|---|---|
| Issue PENDING_ACTIVATION | Dedicated formal acceptance and recording with agreement evidence. No usable entitlement. SAR 0 issuance requires Admin and a purpose. |
| Activate | **Admin only.** Admin may activate with partial funding. Count only authorized payments and credit explicitly allocated to the purchase, with funding attribution verified under lock. Outstanding balances remain due. Preserve actual approval timestamp and default to the activation date in Riyadh, or record a future effective start. A reasoned SAR 0 purchase uses its own basis. Payment verification/authorization never activates service. The separate general Admin exception remains gated. Store the evidence and issue initial units once. See [O-15](milestone-2-readiness-review.md#o-15-authorization-conflict). |
| Suspend and resume | Admin records reason, start and optional end date. End-dated suspension reactivates automatically on the configured date. Open-ended suspension requires Admin action. Validity continues unless Admin separately extends it. Reactivation cannot make an expired or terminated membership usable. |
| Extend | Admin may extend validity without a new purchase or payment. Preserve original expiry, reason and audited revision. Admin may explicitly extend after expiry as an exception. There is no automatic grace. |
| Terminate | Admin can terminate an active membership before expiry. This is separate from purchase cancellation. Independently review remaining units and financial effects. |
| Expire or exhaust | Riyadh calendar dates govern validity. The entire final valid day is included. Unused units become unusable at expiry unless validity is explicitly extended. Preserve historical units and financial history. |
| Adjust entitlement | An accepted Admin verification, authorized grant/adjustment or explicit review can authorize a signed entry. Link reversals to originals. Preserve all history. |

Clients may hold several active memberships with independent validity, units, funding, attendance and adjustments. Future booking identifies the exact membership. Use that membership for eligibility and any attendance deduction. At approval, recheck its lifecycle, validity, allowed session type, units and approved financial eligibility. Proposed checks cover approval and service time. Counting confirmed commitments against available units can prevent promising the last session twice without posting a debit. O-08 governs commitment expiry, late exceptions and confirmed-booking consequences of lifecycle changes.

## Scheduling and attendance

| Transition | Effect |
|---|---|
| Specific request → HELD | Under the slot lock, count confirmed seats and unexpired holds, then acquire a temporary seat. Alternative-time requests can remain AWAITING_SLOT with no seat. |
| Waitlist → HELD | If enabled, waitlisted entries hold no seat. Authorized promotion acquires an expiring hold through the same capacity path. Waitlisting is disabled pending approval. |
| HELD → CONFIRMED / REJECTED / WITHDRAWN / EXPIRED | Authorized approval rechecks expiry, eligibility, capacity, availability, and client overlap/limit. Terminal non-confirmation releases capacity. Effective expiry is based on database time. |
| Cancellation or move requested | The confirmed participant stays unchanged. Rejection or withdrawal changes only the request. Approved move locks both slots and commits the replacement and decision together. A failed move preserves the original seat. |
| Coach replacement | Release old reservation and insert replacement atomically. Preserve both records. Approved unavailability flags affected bookings for explicit action. Ordinary replacement stops after service starts. |
| Attendance submitted or returned | Assigned service coach submits a per-participant revision. Attendance counts as held only after Coach completion submission and Admin verification. Late submissions are flagged and still accepted for Admin review. A return requires a reason. Resubmission appends a revision. No debit. |
| Admin verifies or corrects | Verification records the accepted charge and policy. For a chargeable session package, post the debit in the same transaction. A correction keeps the last accepted result until accepted and then appends only the delta. Time-based or nonchargeable results have zero charge. |

### Hold expiry and seat locks

Lock the slot before counting confirmed seats and unexpired holds. Lock the client before counting their upcoming or overlapping confirmations across slots. A GiST exclusion constraint independently prevents overlapping buffered active reservations for a coach. Rescheduling locks both slots before moving the participant. A rejected change leaves the original booking untouched.

After acquiring the affected locks, sample PostgreSQL `clock_timestamp()` once for the decision. Transaction-start time can be stale after waiting on a lock. Treat a hold at or past its deadline as expired for both capacity and approval. If the same client's stale hold would block an insert under the active slot/client unique index, transition it to EXPIRED under those locks before inserting. Cleanup uses the same command rules.

## Shared command transaction

1. Use short READ COMMITTED transactions. Discover the affected IDs first. Re-read ownership, assignments, policy, and counts in separate statements after locking. If the required lock set changed, roll back and retry with the corrected set. Admin, staff, client, and system writers follow the same order.
2. Acquire only needed rows in this order, sorting IDs within each entity: USER → AUTH_SESSION → AUTH_TOKEN → IDEMPOTENCY_KEY → STUDIO_SETTINGS → FINANCE_ACCOUNT → PACKAGE/version → PURCHASE_REQUEST → PAYMENT → CREDIT_LOT → PURCHASE → INSTALLMENT → REFUND → COACH_PROFILE → CLIENT_PROFILE → MEMBERSHIP → SESSION_SLOT → COACH_AVAILABILITY → COACH_RESERVATION → BOOKING_PARTICIPANT → BOOKING_CHANGE → ATTENDANCE → ATTENDANCE_REVISION. Lock the source aggregate before appending its history. A system command without a user session skips the actor guards.
3. For protected writes, hold FOR SHARE on the current actor and session through commit and recheck the action and resource. Use FOR UPDATE on any user whose role, grant, or account status changes and on any session being revoked or rotated. Choose lock strength before acquiring the rows, including when the actor is also the target. Staff grant writers lock the affected USER before changing the grant. Lock STUDIO_SETTINGS FOR SHARE when applying policy and FOR UPDATE before switching its active revision.
4. For retryable commands, claim the actor/action/key in the same transaction as the command. A concurrent insert on the unique key waits, then reads the committed record or acquires the claim if the first transaction rolled back. Validate current authorization and resource scope before returning an existing outcome. A matching digest replays the committed success. A changed digest fails. A claim that has no committed success is never a replay result.
5. Commit the domain mutation, completed retry outcome, audit, and applicable inbox and outbox together. Rollback publishes no successful result. For a command that writes multiple financial events, use stable per-event keys. Keep domain posting keys and uniqueness constraints beyond HTTP-key retention. Bound automatic retries for transient deadlocks or lock failures and preserve the original key. Do not retry a business conflict blindly. No provider call or manual payout occurs in the transaction.

Use the [scoped FK and ownership map](data-dictionary.md#scoped-foreign-keys-and-ownership) for authoritative relationship checks. The [API contract](api-contract.md#authorization-and-revocation) defines session and socket revocation.

## Required acceptance tests

- Race last-seat requests, duplicate client requests, conflicting coach assignments, availability approval against booking approval, and client limit checks across slots.
- Race reschedules for one replacement and a move against cancellation. Assert rejected changes preserve the original and successful moves commit only one seat change.
- Submit late group attendance for different participants. Return, resubmit, verify concurrently, and correct. Assert historical attribution, effective result, and exactly one applicable unit delta.
- Race allocations against a lot and installment, refund reservations against one receipt, and two execution claims. Reject mismatched clients, currencies, and installments. Reconcile an uncertain refund without paying twice.
- Verify unrelated or unauthorized payment cannot fund activation, all Staff grants deny both activation paths, and verification/authorization never triggers automatic activation.
- Publish a successor after a private offer is purchased and verify unchanged purchased terms and ownership isolation.
- Exercise every denied commission surface in the [permission matrix](permission-matrix.md). Lose Redis after enqueue and restore from backup with delivery disabled.

Reference: [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html), [range exclusions](https://www.postgresql.org/docs/current/rangetypes.html).
