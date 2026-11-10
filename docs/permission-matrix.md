# Role and permission matrix

This is the canonical action and resource map for the [API contract](api-contract.md). Deny unlisted actions. NestJS services check the current role, grant, and resource on reads and commands. Frontend visibility is presentation only. Each Staff grant is independent, starts disabled, and enables only its named action. The Staff column shows the target grantable actions. Proposed action names and deferred workflow bindings require implementation. See the [Foundation authorization differences](#foundation-authorization-differences).

## Resource scope

- **Admin** can act on studio records for listed actions. Admin still follows command state, policy, and integrity checks.
- **Staff** can act only through the listed grant on eligible records in the single studio. Validate the full target relationship, including the parent purchase, booking, or attendance record. If an approved restriction cannot be enforced, deny the action. There is no implicit grant through another action or role.
- **Coach** can read their own availability and assigned schedule. Participant and attendance access requires the coach's assignment to that session. Historical attendance uses the served reservation. Return only the client information needed for that assignment.
- **Client** can read or act on their own records. Resolve ownership through the client profile and the related purchase, finance account, membership, or booking. Published public offers and eligible slot listings use dedicated views. Private offers require the matching client. Apply the same scope to lists, details, exports, and notification reads.
- **Invitations** through the client invitation action create only Client accounts. The server sets the role. Reject role and grant fields in the request. Coach or Staff account management is a separate Admin action. Email verification and Admin-controlled self-registration are approved. Account enablement and initial Admin bootstrap remain gated by [O-02/O-14](open-decisions.md).

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
| `purchase.accept_record` (proposed dedicated action) | Formal acceptance and recording, including SAR 0 with purpose | Same named grant, excluding SAR 0. No membership activation | No | No |
| `finance.read`, `installment.manage` | Yes | Same named grants, independently. No due-date revision through installment management | No | Own financial reads only, including credit and transaction history |
| `payment.record`, `payment.verify` | Yes | Independent grants. Verification is initial only and awaits Admin review/authorization | No | No |
| `payment.authorize` (proposed), `payment.allocate` | Final authorization/rejection/return and manual allocation, respectively | No | No | No |
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
| `attendance.submit` | Use correction path | No | Served participants only | No |
| `attendance.read` | Yes | `attendance.read` | Served participants only | Own permitted outcomes |
| `attendance.verify`, `attendance.correct` | Yes | No | No | No |
| `report.read`, `report.export`, `audit.read` | Yes | Same named grants, independently | Own permitted operational report reads only | Own permitted report reads only |
| `commission.read`, `commission.record`, `commission.distribute`, `commission.export`, `commission.audit` | **Admin only** | **Denied with all grants** | **Denied** | **Denied** |

Booking requests include cancellation and reschedule requests, not their approval. Waitlist join and withdrawal use the same own-request scope if enabled. Operational exports require both the relevant read and export permissions. Operational audit access never includes private commission audit.

## Foundation authorization differences

The table is the approved activation policy and target commercial map. The public catalog API implements `catalog.read` and `catalog.manage` as independent Staff grants. Only Admin can publish zero-priced offers or manage session-type records. Package audit history requires both `catalog.manage` and `audit.read`. Private offer permissions remain inactive. The API rejects new Staff activation grants and ignores stored legacy rows for authorization. The stored `payment.allocate` value confers no runtime authority. Legacy purchase review/record values do not confer the dedicated acceptance action. See the [O-15 reconciliation](milestone-2-readiness-review.md#o-15-authorization-conflict).

The Technical Administrator is an infrastructure identity. Technical and emergency credentials confer no business actions, including commission access. See [deployment and security](architecture-review.md#deployment-and-security).

## Commission isolation

- **Database.** A non-runtime owner owns the private schema, tables, and audit. Migrations establish existing and default grants. Revoke access from PUBLIC and ordinary API, reporting, and worker roles. Those roles neither own private objects nor inherit or assume the private role. Give the existing API's private connection only the access needed for authorized commission operations.
- **API and reports.** Check current Admin authorization before using the private connection. Use dedicated commission DTOs and report queries. Generic profiles, reports, serializers, and operational audit expose no commission records, fields, aggregates, or identifiers. Manual distributions are recorded by Admin. Automatic calculation remains out of scope.
- **Exports and caches.** Generate bounded private exports in the existing Admin request path. Hold the authorization guard while producing the private result and check Admin again on any later download. Use no-store through NestJS, Next.js, and the CDN. Do not store private results in shared application caches or publish reusable public links. No private export jobs run on the ordinary worker.
- **Logs and delivery.** Shared API, proxy, SQL, error, and worker logs exclude commission payloads, sensitive route parameters, and bound values. Record private audit only in the restricted schema. Commission data and events never enter notifications, sockets, or the operational outbox.

The Foundation test plan must exercise role and grant denial and negative DB privileges. Before enabling commissions, test Client, Coach, and Staff with all grants against private API and direct DB access, profile and report serializers, export access after revocation, caches, logs, notifications, sockets, and worker credentials. Verify the authorized Admin path separately. These are required tests, not executed results.
