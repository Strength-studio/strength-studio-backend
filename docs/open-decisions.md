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

See [business rules](business-rules.md) and [roadmap](implementation-roadmap.md).
