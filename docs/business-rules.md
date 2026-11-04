# Business rules and transaction boundaries

Confirmed requirements are marked **Confirmed**. Technical choices here are **Proposed** unless otherwise noted. Studio values and launch policies remain in [open decisions](open-decisions.md).

## Identity and catalog

**Confirmed.** Admin can create a client. Clients can self-register and verify email. Clients cannot self-assign elevated roles. Proposed flow: Admin-created accounts receive a time-limited setup link, while self-registered accounts remain pending verification. Store token digests, consume tokens once, and revoke sessions when disabling an account. Approval or enablement after verification remains a studio decision.

Publish the version and eligible session types in one transaction under the package lock. Published business fields are immutable. A private version belongs to its package's client. A request refers to the version the client saw. A purchase item copies the agreed price, currency, validity, and allowance. A changed offer requires a new version and explicit acceptance.

## Financial settlement

**Confirmed.** Manual receipt recording, verification, and activation are separate commands. Keep original payment and refund records. No balance is overwritten.

| Operation | Transition and effect |
|---|---|
| Record / correct | Store immutable reported payment facts. An unverified correction links a replacement and blocks verification of the superseded receipt. Verified corrections use compensating events. |
| Verify | Under the finance lock, create one verified origin event and one cash-backed lot. Funds start unapplied. |
| Allocate | Post from a lot bucket to a purchase and optional installment. Validate remaining lot funds and target balance. Installment allocation reduces the purchase receivable once. |
| Convert or spend credit | Conversion moves funds to the available-credit bucket within the same lot. Spending records the source bucket. Issuance, expiry, and cash-out remain gated pending studio policy. |
| Reverse | Reference the original event and enforce its unreversed remainder. Allocation reversal restores the original lot bucket and reopens the receivable. Verification reversal must account for dependent allocations, refunds, and reservations. |
| Request and approve refund | REQUESTED → REJECTED or APPROVED_RESERVED. Under the account lock, reserve funds and original receipt capacity. Link any necessary allocation reversals. |
| Execute and post | APPROVED_RESERVED → EXECUTING → POSTED. One Admin claims execution before outside payment. On ambiguity enter RECONCILE_REQUIRED and retain the reservation. Post only with evidence or void after establishing nonpayment. Jobs never execute or retry cash movement. |
| Review membership effect | A separate Admin review can record no change, a validity action, or an entitlement adjustment. A cash return alone changes neither membership nor consumed sessions. |

An example in one currency: verification of 120 can fund installment A with 60 and installment B with 40, leaving 20 unapplied. Another receipt can contribute to either installment. Returning 30 may require an explicit 10 allocation reversal. That reopens 10 of receivables unless a separately authorized purchase adjustment changes what is owed.

A durable posting key identifies each event. Reject key reuse with different input. All finance references share client/currency scope, and an installment must belong to its target purchase. Lock the finance account before validating aggregate balances. Posted refunds plus active reservations cannot exceed the verified receipt amount net of valid receipt reversals. A cash refund draws on its approved refundable bucket. Internal credit restoration does not return cash. Reconcile balances from typed events, source lots, and current reservations.

## Membership and entitlement

| Transition | Authority and effect |
|---|---|
| Issue PENDING_ACTIVATION | Authorized purchase recording. No usable entitlement. |
| Activate | Admin or explicit staff grant. Require net verified funding for that purchase at the approved threshold or a documented Admin exception. Staff cannot authorize the exception. Validate funding under the account lock. Store evidence, policy, actor, and reason where required. Set validity and append the initial session grant once. |
| ACTIVE → SUSPENDED → ACTIVE | Admin. Record reason and effective times. Whether time freezes is unresolved. Reinstatement cannot silently alter formal expiry. |
| Pending, active, or suspended → CANCELLED | Admin. Proposed terminal state. Preserve balances, booking history, and ledger. Existing booking effects require an explicit decision. |
| Extend or authorize grace | Admin. Extension changes formal validity through an event. Grace is a dated exception and preserves formal expiry. |
| Expire or exhaust | Derived from time or balance. Neither alters financial settlement. Unused sessions remain in history. |
| Adjust entitlement | An accepted verification, authorized grant/adjustment event, or explicit entitlement review authorizes a new signed entry. Reversals link to original entries. No edits to original entries. |

At approval, recheck active lifecycle, validity or explicit grace, allowed session type, units, and approved financial eligibility. Proposed checks cover approval and service time. Counting confirmed commitments against available units can prevent promising the last session twice without posting a debit. Commitment expiry and late exceptions require approval.

For ordinary activation, count only net applied funds traceable to verified payments for that purchase. Unapplied money and an unrelated verified receipt do not qualify. Capture the evaluated amount and currency with the activation evidence. A later refund or funding correction preserves that historical activation decision and opens a separate review when applicable.

## Scheduling and attendance

| Transition | Effect |
|---|---|
| Specific request → HELD | Under the slot lock, count confirmed seats and unexpired holds, then acquire a temporary seat. Alternative-time requests can remain AWAITING_SLOT with no seat. |
| Waitlist → HELD | If enabled, waitlisted entries hold no seat. Authorized promotion acquires an expiring hold through the same capacity path. Waitlisting is disabled pending approval. |
| HELD → CONFIRMED / REJECTED / WITHDRAWN / EXPIRED | Authorized approval rechecks expiry, eligibility, capacity, availability, and client overlap/limit. Terminal non-confirmation releases capacity. Effective expiry is based on database time. |
| Cancellation or move requested | The confirmed participant stays unchanged. Rejection or withdrawal changes only the request. Approved move locks both slots and commits the replacement and decision together. A failed move preserves the original seat. |
| Coach replacement | Release old reservation and insert replacement atomically. Preserve both records. Approved unavailability flags affected bookings for explicit action. Ordinary replacement stops after service starts. |
| Attendance submitted or returned | Assigned service coach submits a per-participant revision. Late submissions are flagged and still accepted for Admin review. A return requires a reason. Resubmission appends a revision. No debit. |
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
- Verify unrelated payment cannot activate membership, a staff grant cannot use an Admin exception, and verified funding never triggers automatic activation.
- Publish a successor after a private offer is purchased and verify unchanged purchased terms and ownership isolation.
- Exercise every denied commission surface in the [permission matrix](permission-matrix.md). Lose Redis after enqueue and restore from backup with delivery disabled.

Reference: [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html), [range exclusions](https://www.postgresql.org/docs/current/rangetypes.html).
