# O-09 owner decision brief

Prepared 23 November 2026 against published baseline
`62f8043433bcda4789efc879f4da9d8f94aafac5`. **All recommendations below are pending
owner approval.** They change no current behavior and authorize no implementation,
deployment or production capture. Approved policy remains in the
[owner register](milestone-2-decision-register.md#o-09); this brief provides options
for the unresolved questions in the [O-09 issue register](milestone-3-attendance-return-reaffirmation.md#o-09-and-unresolved-decisions).
Record an explicit answer by ID and any modifications; review the implementation
plan for the selected slice separately before development begins.

## Current approved boundary

Assigned Coach can submit ATTENDED at or after scheduled start only in the test
configuration. Admin can return one participant revision with a mandatory reason.
Coach reads that reason and explicitly reaffirms ATTENDED in another immutable
revision. Cancellation blocks new attendance transitions but preserves readable
evidence. Production capture stays closed. No verification, unit ledger, deduction,
alternative outcome, detail correction or notification delivery exists.

## O-09-A — Submission and reaffirmation deadlines

**Current:** Earliest submission is scheduled start; no approved latest deadline
exists. The test gate is not approval for unlimited production submissions.

**Approve or modify:** Use scheduled start as the earliest initial submission;
allow the first submission until **24 elapsed hours after scheduled end**, inclusive;
allow reaffirmation until **48 elapsed hours after the exact Admin return decision**,
inclusive, even when the initial window has since closed. No Admin deadline override
in the first release. An expired window remains blocked, with a later exception
workflow requiring separate approval.

**Recommended mechanics:** Use the last approved scheduled interval at service
start as the deadline reference, not a browser clock or an invented actual-service
timestamp. Rescheduling before start moves the reference; ordinary changes after
start remain disallowed. Persist the applied reference/deadline and policy version
in the future implementation so later edits cannot move historical deadlines.
Evaluate UTC instants with database time after locking; display Asia/Riyadh.
Elapsed-hour arithmetic crosses midnight and any timezone-rule transition without
resetting at a local date boundary. A delayed session that is not formally
rescheduled does not silently receive a later deadline.

**Alternatives:** Earliest submission at scheduled end instead of start (changes
the current lower bound and prevents early completion reporting); initial end
+48/+72 hours; reaffirmation against a fixed session
deadline; or an explicit Admin extension command with a bounded new deadline,
mandatory reason, actor, policy and audit. A fixed session deadline can make a late
Admin return impossible to answer; extensions add operational flexibility and a
new sensitive workflow.

**Consequences:** The recommended windows are simple and allow a Coach to answer a
late return, but may exclude legitimate long delays. These numbers are proposals,
not existing policy. This blocks **production capture activation**. Backend/DB
need versioned deadline evidence and post-lock validation; API needs explicit
expired-window results; dashboard/mobile need deadline and blocked states;
reporting needs policy/reference timestamps. **Status: Pending.**

## O-09-B — No-show and late-cancellation chargeability

**Current:** ATTENDED is the sole outcome; no-show/late-cancellation classifications
and charges do not exist. Booking cancellation already has its own audited status.

**Approve or modify:** For the first verified-attendance release, charge only an
undisputed ATTENDED outcome after Admin verification; **do not consume units for
absence or cancellation**. Keep new attendance outcomes deferred. For a later
classification feature, proposed definitions are: no-show = a confirmed,
uncancelled participant never attends the scheduled session; late cancellation =
a cancellation in the **24 elapsed hours before scheduled start or later**.
These definitions and the cutoff also require explicit approval before being used.

Coach could report a future absence outcome; Admin would make the charge/waiver
decision, with reason and immutable evidence. Admin retains authority over Booking
cancellation. Disputed attendance stays unverified with no debit; do not use an
ATTENDED reaffirmation to stand in for an unresolved dispute or an unsupported
correction. Cancellation timestamps and service evidence must support any future
classification; the current aggregate fields alone are not a complete timing policy.

**Alternatives:** Charge a defined no-show or late cancellation only after Admin
review, with a reasoned waiver; different cancellation cutoffs; or defer all
absence classifications while approving only the ATTENDED verification path.
Charging discourages lost appointments but creates evidence, dispute and waiver
obligations. Non-charging preserves the current outcome contract but may create
uncompensated reserved capacity.

**Impact/gate:** Future backend/DB outcome and decision models, API validation,
Coach/Admin/mobile controls, cancellation evidence and charge/waiver reports.
Blocks enabling new outcomes or charging them, not the existing reaffirmation
slice. Exact Membership isolation remains mandatory. **Status: Pending.**

## O-09-C — Insufficient or ineligible entitlement

**Current:** Activation stores `initialSessionAllowance` and validity dates;
confirmed Bookings consume commitment headroom, not ledger units. No verification
or deduction exists. A time-based Membership has no numeric session allowance.

**Approve or modify:** Verification with insufficient units must fail atomically
without accepting attendance or posting a debit. No negative balance, automatic
Membership change, borrowing, payment request or Admin bypass. Admin may resolve a
case only through a separately approved grant/adjustment or correction workflow,
then retry verification. Preserve the original Booking Membership reference.

Recommended eligibility matrix for the future design:

| Case | Proposed behavior |
|---|---|
| Session package has zero available units | Block verification; no mutation or automatic financial action. |
| Membership expired before or during the served interval | Block; unused units cannot fund service outside validity. |
| Expired now, but eligible for the complete served interval | Permit late verification only when immutable grant/eligibility evidence proves service was covered; record a historical usage debit, not newly spendable units. |
| Inactive or suspended during service | Block. If historical status cannot be established, hold for review rather than infer eligibility. |
| Membership changed after Booking | Never switch the Booking to another Membership. Evaluate preserved service-time evidence and explicit later service decisions. |
| Two verifications compete for the last unit | Lock the exact Membership, re-read canonical ledger and commitments, and allow only one valid posting. |
| Time-based Membership | Check eligible served interval; no numerical session-unit debit. |

**Alternatives:** Block all verification after current expiry (simpler, but can
reject valid late evidence); a reasoned Admin exception designed separately; or
allow debt/negative units, which is **not recommended** and requires new explicit
policy. Service-time eligibility is more faithful to when service happened but
requires lifecycle history that is not yet implemented. Successful decisions and
adjustments require immutable actor/reason/policy evidence; blocked cases need safe
operational reporting without changing balances.

**Impact/gate:** Backend/DB canonical ledger, once-only grants, lifecycle evidence
and membership locks; API conflict contract; Admin exception queue; Client/mobile
balance views and expiry/usage reports. Blocks verification/deduction until this
policy **and the ledger design** are approved. **Status: Pending.**

## O-09-D — Return notifications

**Current:** Coach finds returns and reasons in the attendance workspace. No inbox,
delivery worker or attendance notifications exist.

**Approve or modify:** When notification infrastructure is separately approved,
notify only the frozen served/authorized Coach through an authenticated in-app
inbox. No automatic Admin, Client or Staff notification; no email, push, reminder
or escalation initially. Persist the inbox/outbox event atomically with the return;
external delivery failure must not roll back or change the return decision.
External transport is best-effort, deduplicated and observable, with bounded
retries/dead-letter review. The authenticated workspace remains authoritative.

**Alternatives:** Add essential email via the O-11 provider, notify the reviewing
Admin, or add an escalation/reminder schedule. Email improves reach but needs
approved recipients, secure minimal content, sender infrastructure and failure
operations. Push remains outside approved initial delivery channels.

**Impact/gate:** Backend/DB inbox/outbox and worker, scoped read/mark API, dashboard
and mobile inbox, delivery-failure reports; no sensitive attendance reasons in
unapproved external messages. Blocks notification delivery, not return/reaffirmation.
O-11 infrastructure/category approval remains separate. **Status: Pending.**

## O-09-E — Cancellation after submission

**Current:** Before submission, cancelled Bookings cannot be submitted. After
submission, cancellation leaves immutable history and the pending/returned state
visible, but blocks new return/reaffirmation transitions. Normal Scheduling cannot
cancel an already-started session through its current API.

**Approve or modify:** Keep this conservative block at every cancellation stage:
before submission; pending review; returned; reaffirmed; or eventually verified.
Preserve all evidence, responsible actors and original Membership attribution.
After cancellation, Admin cannot return or verify and Coach cannot reaffirm through
ordinary commands. For a previously verified item, cancellation must not silently
reverse the decision or ledger entry; a separate reasoned Admin service review and
linked adjustment would require a future approved design.

**Alternatives:** Permit Admin-only adjudication of pre-cancellation service
evidence, potentially followed by a bounded Coach reaffirmation; or prevent Booking
cancellation once attendance exists. Adjudication can settle genuinely served
sessions but needs a complete state/effect matrix. Preventing cancellation changes
an existing Booking behavior and can obstruct legitimate operations.

**Impact/gate:** Future backend state matrix, DB service-review evidence, explicit
API conflicts/commands, dashboard/mobile cancelled-record states and reconciliation
reports. Blocks enabling transitions on cancelled records and future automatic
cancellation consequences; the current block can remain in place. **Status: Pending.**

## O-09-F — Full correction of attendance details

**Current:** Only explicit ATTENDED reaffirmation is approved. No alternative
outcome, actual served time, Coach note or participant-specific detail can be edited.

**Approve or modify:** Defer full correction and preserve the existing contract.
If later enabled, approve a field matrix first; do not implicitly approve all
potential fields together:

| Candidate field | Owner choices still required |
|---|---|
| Outcome | Exact allowed values, Coach/Admin authority, evidence, validation and B chargeability effects. |
| Actual served start/end | Who supplies them, positive interval, allowed deviation, attribution and validity effects; no schedule-history rewrite. |
| Coach note | Purpose, mandatory/optional status, size/content constraints, visibility and retention. |
| Participant-specific detail / other evidence | Name each exact field, purpose, type, validation, access and retention; no generic unbounded payload. |

For any approved field, recommend assigned-Coach proposal in a new immutable
revision, exact predecessor linkage, repeated Admin return allowed, Admin approval
before any consequential change, and actor/reason/policy audit. A returned or pending
correction must not change a previously accepted effective charge. An eventual
accepted correction uses a same-Membership linked delta under the approved ledger
design; it never overwrites past entries or charges the full session twice.

**Alternatives:** Notes-only correction, an explicit outcome subset, or Admin-only
correction. Smaller contracts are easier to validate but may not resolve disputes.
**Impact/gate:** Backend/DB revision-kind/data contracts, API versioning, dashboard
and both mobile workflows, reports and privacy/retention. Blocks full correction
only; current reaffirmation remains approved. **Status: Pending.**

## O-09-G — Retention, archival and redaction

**Current:** Revisions and return decisions are append-only to runtime roles;
audit is also preserved. No retention duration, archival or redaction workflow
is implemented. Backup retention under O-12 is not an attendance-data retention rule.

**Approve or specify:** Keep automated deletion/redaction disabled while the owner
and qualified privacy/legal reviewers specify **three explicit durations and their
start events**: attendance revisions, return decisions, and audit records. Also
specify legal/operational holds, archival access roles and redaction authority.
No statutory duration or legal conclusion is asserted here.

Recommended technical direction, subject to approval: archive without changing
evidence identity; retain source/sequence/decision integrity and a non-identifying
audit trail of every authorized redaction; default archived attendance access to
Admin, with Coach access only to permitted assigned/served evidence if approved;
no Staff/Client archive access by legacy grants. Separate identifying metadata from
immutable operational facts only through a reviewed migration/redaction design.
Do not rewrite existing append-only records as an ad hoc redaction mechanism.

**Alternatives:** One shared retention schedule or separate periods; restricted
online archives or encrypted offline archives. Longer retention supports disputes
but increases data exposure/storage; shorter retention reduces retained data but
can conflict with evidence/hold needs. Operational and legal review must settle
that tradeoff; indefinite identifiable retention is not silently approved.

**Impact/gate:** Backend/DB archival and controlled redaction, API access checks,
dashboard/mobile history visibility, backups and reporting retention. Blocks those
capabilities; production readiness must include an explicit retention review.
**Status: Pending — durations and hold/role rules must be supplied, not inferred.**

## Approval record

| Decision | Owner response | Status |
|---|---|---|
| O-09-A | Not yet received | Pending |
| O-09-B | Not yet received | Pending |
| O-09-C | Not yet received | Pending |
| O-09-D | Not yet received | Pending |
| O-09-E | Not yet received | Pending |
| O-09-F | Not yet received | Pending |
| O-09-G | Not yet received | Pending |

Approval of a recommendation must be recorded in the owner register and linked
here before dependent implementation. An answer that only approves deferral does
not authorize future fields, outcomes, charges, retention periods or delivery.
