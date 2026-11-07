# Open studio decisions

A decision marked pending is not a launch rule. Optional workflows remain disabled until approved. Local tests can use clearly identified fixtures.

| ID | Decision requiring approval | Needed by |
|---|---|---|
| O-01 | Studio IANA timezone, launch currencies and methods, service-date and cutoff interpretation | Configuration and commercial acceptance |
| O-02 | Registration enablement after verification, Admin-created invitation workflow, Admin MFA and recovery, initial staff grant set | Identity acceptance |
| O-03 | Verified funding threshold and purchase versus item attribution, receipt identity by payment method, whether recorder may verify their own receipt, eligible Admin activation exceptions and evidence | Commercial acceptance |
| O-04 | Installment allocation order and targeting, overpayment-to-credit conversion, reuse, expiry, issuance and cash-out | Finance acceptance |
| O-05 | Refund effects on receivables and membership, cash execution evidence, correction authority | Refund and review acceptance |
| O-06 | Private offer expiry, superseded offer acceptance, staff authority for private pricing | Catalog acceptance |
| O-07 | Suspension freezes or continues validity, reinstatement and cancellation effects, grace eligibility, timing and precedence, and unused-session handling | Membership acceptance |
| O-08 | Hold duration, client limit and counting window, coach buffers, replacement holds, handling of affected bookings, waitlist launch scope and ordering | Scheduling acceptance |
| O-09 | Late attendance deadline, chargeable no-show/late-cancellation outcomes, insufficient entitlement handling, correction recipients | Attendance acceptance |
| O-10 | Manual commission recipient eligibility and distribution rules. Automatic calculation stays out of scope. | Commission acceptance |
| O-11 | SMTP settings and reminder cadence, actual domain/DNS, hosting and registry access, alert ownership, launch workload and acceptance targets | Release validation |
| O-12 | Backup provider, retention, key custody, RPO/RTO, restore drill cadence, optional Hostinger backup | Release validation |
| O-13 | Mobile launch targets and original delivery, ownership, support, and warranty commitments | Handover planning |
| O-14 | Foundation authorization was granted. Production deployment still requires separate authorization. | Before production |
| O-15 | Resolve activation-authority discrepancy: the 7 November 2026 review request specifies Admin-only ordinary activation, while the current matrix and Foundation grant/test contract allow explicitly granted Staff on the verified-funded path. The review plan follows the requested Admin-only direction; reconcile canonical sources before implementation. No Foundation behavior changed in this review. | Membership implementation |
| O-16 | Whether a client may have concurrent active memberships; independent balances/validity versus replacement or pooling. Recommendation only: permit independent memberships and require explicit membership selection in the later booking workflow. | Membership issuance and activation |
| O-17 | Purchase-request acceptance versus recording, required agreement evidence, purchase cancellation/adjustment lifecycle, final-price composition and zero-price issuance. Recommendation only: atomic acceptance/recording with both permissions, immutable recorded terms, explicit Admin corrections, no zero-price purchases initially. | Purchase implementation |

See [business rules](business-rules.md) and [roadmap](implementation-roadmap.md).

Review note — 7 November 2026: [Milestone 2 readiness review](milestone-2-readiness-review.md), [decision register](milestone-2-decision-register.md), and [implementation plan](milestone-2-implementation-plan.md) expand O-01 and O-03–O-07 and document O-15–O-17. All recommendations remain unapproved. O-01–O-14 are retained unchanged; receipt identity, allocation/credit details, refund corrections and membership timing remain refinements of their existing decisions rather than duplicate entries.
