# Role and permission matrix

This is the canonical action and resource map for the [API contract](api-contract.md). Deny unlisted actions. NestJS services check the current role, grant, and resource on reads and commands. Frontend visibility is presentation only. Each Staff grant is independent, starts disabled, and enables only its named action. The Staff column shows the target grantable actions. Proposed action names and deferred workflow bindings require implementation. See the [Foundation authorization differences](#foundation-authorization-differences).

## Resource scope

- **Admin** can act on studio records for listed actions. Admin still follows command state, policy, and integrity checks.
- **Staff** can act only through the listed grant on eligible records in the single studio. Validate the full target relationship, including the parent purchase, booking, or attendance record. If an approved restriction cannot be enforced, deny the action. There is no implicit grant through another action or role.
- **Coach** can read their own availability and assigned schedule. Participant and attendance access requires the coach's assignment to that session. Historical attendance uses the served reservation. Return only the client information needed for that assignment.
- **Client** can read or act on their own records. Resolve ownership through the client profile and the related purchase, finance account, membership, or booking. Published public offers and eligible slot listings use dedicated views. Private offers require the matching client. Apply the same scope to lists, details, exports, and notification reads.
- **Invitations** through Admin-only `user.manage` in S2-A create only Client accounts. Staff `client.manage` retains existing reads and confers no onboarding write. The server sets the role. Reject role and grant fields in the request. Coach or Staff account management is a separate Admin action. Email verification and Admin-controlled self-registration are approved. S2-A account enablement is implemented for Admin-invited Clients. Self-registration and initial Admin bootstrap remain gated by [O-02/O-14](open-decisions.md).

| Action | Admin | Staff grant | Coach | Client |
|---|---|---|---|---|
| `account.self`, `notification.read` | Own | Own | Own | Own |
| `client.manage` | Yes | `client.manage`, Client accounts only | No | No |
| `user.manage`, `staff.grant.manage`, `studio.configure` | Yes | No | No | No |
| `catalog.read` | Yes | `catalog.read`, published public offers | No | Published public and own private offers |
| `catalog.manage`, `catalog.private.manage` | Yes | Independent named grants. Dedicated private management covers scoped private terms and management reads, independent of payment verification | No | No |
| `catalog.private.withdraw` (proposed) | Reasoned withdrawal of unaccepted private offer | No pending explicit withdrawal delegation | No | No |
| `purchase.request` | No | No | No | Own eligible offer |
| `purchase.read`, `purchase.review`, `purchase.record` | Yes | Independent scoped reads, intent review and any separately bound preparatory recording. No formal acceptance | No | Own reads only |
| `purchase.funding.read` | **Admin only** | No | No | No |
| `purchase.accept_record` (proposed dedicated action) | Formal acceptance and recording, including SAR 0 with purpose | Same named grant, excluding SAR 0. No membership activation | No | No |
| `finance.read`, `installment.manage` | Yes | Same named grants, independently. No due-date revision through installment management | No | Own financial reads only, including credit and transaction history |
| `payment.record` | Yes | Named grant | No | No |
| `payment.verify` | **Admin only** | **Denied with all grants**, including legacy `payment.verify` | No | No |
| `payment.allocate` | **Admin only** | **Denied with all grants**, including legacy `payment.allocate` | No | No |
| `payment.authorize` (proposed) | Final authorization/rejection/return | No | No | No |
| `payment.correction.request` (proposed) | Yes | Same named grant, request only | No | No |
| `credit.apply`, `purchase.cancel`, `installment.revise_due_date` (proposed) | Yes | No | No | No |
| `payment.reverse`, `credit.adjust` | Yes | No | No | No |
| `refund.request` | On behalf of client. Credit cash-out initiation is Admin-only | No | No | Own eligible payment; no independent credit cash-out |
| `refund.decide`, `refund.execute`, `refund.post`, `refund.reconcile` | Yes | No | No | No |
| `membership.read`, `entitlement.read` | Yes | No | No | Own summary and own ledger, respectively |
| `membership.activate` | **Admin only**, eligible partial funding or SAR 0 purchase basis | **Denied with all grants** | No | No |
| `membership.activate_exception` | **Admin only**, documented exception subject to approved criteria | No | No | No |
| `membership.manage`, `entitlement.adjust` | Lifecycle actions including explicit extension, and unit adjustments respectively | No | No | No |
| `schedule.read`, `schedule.manage` | Yes | Same named grants, independently | Own assigned schedule reads only | Eligible slot listing only |
| `availability.request`, `availability.decide` | Decide | `availability.decide` if approved | Submit and read own requests | No |
| `booking.read`, `booking.request`, `booking.assist` | Read and assist | `booking.read`, `booking.assist` independently | Assigned booking reads only | Own reads and requests |
| `booking.approve`, `booking.cancel.decide`, `booking.reschedule.decide` | Yes | Same named grants, independently | No | No |
| `booking.waitlist.promote` | If enabled | Same named grant if enabled | No | No |
| `attendance.submit` | No | No | Explicit confirmed participants in an assigned session, subject to the submission gate | No |
| `attendance.read` | Roster and immutable participant/review history | No | Assigned roster and own served history only | No |
| `attendance.return` | Return latest pending participant revision with a mandatory reason; gated | No | No | No |
| `attendance.reaffirm` | No | No | Reaffirm ATTENDED after acknowledging the latest returned revision’s reason; gated | No |
| `attendance.verify`, `attendance.correct` (deferred) | Admin only when implemented | No | No | No |
| `report.read`, `report.export`, `audit.read` | Yes | Same named grants, independently | Own permitted operational report reads only | Own permitted report reads only |
| `commission.read`, `commission.record`, `commission.distribute`, `commission.export`, `commission.audit` | **Admin only** | **Denied with all grants** | **Denied** | **Denied** |

Booking Management Slice 1 enables `booking.read`, `booking.assist`, `booking.approve`, and `booking.cancel.decide` for Admin only. Approval and rejection share `booking.approve`. Staff booking grants remain dormant, including existing stored grants. The booking rows above describe the broader role design for future slices.

Attendance Slice 1 retains the legacy `ATTENDANCE_READ` enum for stored grants. Those grants confer no access and the Staff grant writer rejects new assignments.

The return/reaffirmation slice preserves those exclusions and frozen served-Coach scope. See the [implemented contract](milestone-3-attendance-return-reaffirmation.md#implemented-contract).

Booking requests include cancellation and reschedule requests, not their approval. Waitlist join and withdrawal use the same own-request scope if enabled. Operational exports require both the relevant read and export permissions. Operational audit access never includes private commission audit.

## Foundation authorization differences

The table is the approved activation policy and target commercial map. The public catalog API implements `catalog.read` and `catalog.manage` as independent Staff grants. Only Admin can publish zero-priced offers or manage session-type records. Package audit history requires both `catalog.manage` and `audit.read`. Private offer permissions remain inactive. The API rejects Staff grants for activation, payment verification, and payment allocation, and ignores stored legacy rows for those actions. Legacy purchase review/record values do not confer the dedicated acceptance action. See the [O-15 reconciliation](milestone-2-readiness-review.md#o-15-authorization-conflict).

The Technical Administrator is an infrastructure identity. Technical and emergency credentials confer no business actions, including commission access. See [deployment and security](architecture-review.md#deployment-and-security).

## Commission isolation

- **Database.** A non-runtime owner owns the private schema, tables, and audit. Migrations establish existing and default grants. Revoke access from PUBLIC and ordinary API, reporting, and worker roles. Those roles neither own private objects nor inherit or assume the private role. Give the existing API's private connection only the access needed for authorized commission operations.
- **API and reports.** Check current Admin authorization before using the private connection. Use dedicated commission DTOs and report queries. Generic profiles, reports, serializers, and operational audit expose no commission records, fields, aggregates, or identifiers. Manual distributions are recorded by Admin. Automatic calculation remains out of scope.
- **Exports and caches.** Generate bounded private exports in the existing Admin request path. Hold the authorization guard while producing the private result and check Admin again on any later download. Use no-store through NestJS, Next.js, and the CDN. Do not store private results in shared application caches or publish reusable public links. No private export jobs run on the ordinary worker.
- **Logs and delivery.** Shared API, proxy, SQL, error, and worker logs exclude commission payloads, sensitive route parameters, and bound values. Record private audit only in the restricted schema. Commission data and events never enter notifications, sockets, or the operational outbox.

The Foundation test plan must exercise role and grant denial and negative DB privileges. Before enabling commissions, test Client, Coach, and Staff with all grants against private API and direct DB access, profile and report serializers, export access after revocation, caches, logs, notifications, sockets, and worker credentials. Verify the authorized Admin path separately. These are required tests, not executed results.


## Implemented S1-B1 maintenance boundary

| Operation | Admin | Staff | Coach | Client |
|---|---|---|---|---|
| Existing Client directory/detail | Yes | Existing `client.manage` grant | No | No |
| Existing own-Client profile | No | No | No | Own profile only |
| Edit existing Client displayName | `user.manage`, Admin only | No, including `client.manage` grantees | No | No |
| Disable existing Client account access | Existing `user.manage`, Admin only | No | No | No |

New display-name writes use independent operation `client.profile.update` within the existing transactional command/idempotency system. They do not extend Staff grants or expose commission/financial data. Existing Admin account-disable semantics remain unchanged. Creation, setup, verification, reactivation and delegated Staff mutations are outside S1-B1; O-02 remains unresolved for onboarding.


## Implemented S2-A onboarding boundary

Admin-only `user.manage` now binds invitation creation, reissue, revoke and the
secret-free onboarding status projection. This explicitly replaces the former
`client.manage` invitation stub binding under owner approval; existing Staff
directory/detail reads and grant rows are unchanged. Neither Staff, Coach nor
Client can manage invitations or obtain an Admin disclosure. Public endpoints
consume only exact-stage onboarding capabilities and never grant arbitrary role,
identity linking, account reactivation or pre-ACTIVE sessions. S1-B1 display-name
and disablement behavior remains independent. See [implemented contracts](api-contract.md#implemented-s2-a-admin-client-onboarding).
