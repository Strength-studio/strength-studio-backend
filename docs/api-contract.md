# API contract strategy

This is the documentation contract. The [Foundation OpenAPI snapshot](../packages/api-contract/openapi.json) lists implemented API routes. Generated clients and later route families are deferred. The [permission matrix](permission-matrix.md) is the source of truth for action and resource scope. A listed route does not enable a pending workflow.

## Routing and credentials

Next.js pages and browser session/API handlers use the approved dashboard hostname. Use same-origin `/api/session/*` for browser session actions and `/api/studio/v1/*` for an allowlisted relay. The relay forwards over certificate-validated HTTPS to `/api/v1/*` on the approved API hostname with a NestJS-issued user bearer credential. Flutter calls the API host directly. Browser and Flutter sockets connect directly to `/socket.io/`. Actual hostnames and DNS targets are unconfirmed.

Browser access and refresh credentials use separate host-only Secure, HttpOnly, SameSite=Lax cookies with Path=/ and no Domain attribute. The VPS does not accept dashboard cookies. Personalized responses use no-store. Cookie-authenticated writes require exact Origin and a session-bound CSRF header. Check Origin on login. Consume account-link challenges by POST. Browser REST needs no broad credentialed CORS. Keep Vercel previews isolated from production data.

Flutter keeps the access token in memory and the refresh token in OS-backed secure storage. Use single-flight refresh, including coordination across dashboard tabs. A lost successful refresh response can require sign-in.

## Authorization and revocation

Every protected REST request checks the current user, active session, action, and resource scope. Bearer role claims are not permission grants. Reads check current scope before loading the result. Writes recheck under the [transaction guard](business-rules.md#shared-command-transaction) and keep it through commit. Recheck expiry against current database time after waiting for locks. Role and staff grant changes acquire an exclusive lock on the affected user. Session revocation and refresh acquire an exclusive lock on the affected session. If revocation wins, deny the write. If the authorized write commits first, revocation applies to subsequent requests.

Rotate refresh credentials atomically. Store digests. Consumed-token replay revokes the session and commits that revocation **before** returning the replay error. Logout accepts a bearer or a refresh credential and revokes its own session without rotation. Disablement revokes the applicable sessions. Password reset will revoke sessions when recovery is enabled. Invitation, verification, and account enablement policies remain gated by O-02.

Sockets use short-lived, single-use tickets minted through authenticated REST. Bind each digest to session and purpose, consume it atomically, and check the exact allowed browser origin at handshake and upgrade. A native client still needs a ticket. The server assigns subscriptions. After revocation or a role or grant change, invalidate affected connections after commit. For missed invalidation, revalidate protected connections within 30 seconds or earlier at session expiry. Close protected subscriptions when authorization cannot be checked. Socket messages are invalidation hints, never business writes or commission events. Reconnect with a fresh ticket and refetch through REST.

## Route families

All paths below are relative to `/api/v1`. The named actions are the permission-matrix actions. No unlisted route inherits access from a parent route.

| Family | Endpoint and action |
|---|---|
| Identity | Public, rate-limited: registration, login, email verification, and reset. Refresh and logout use their respective session credentials. `GET /me` and socket-ticket issuance use `account.self` and require an active session. `POST /users/invite` uses `client.manage` and creates Client only. Reject role and grant fields. Other account administration uses `user.manage`, and `/staff-grants` uses `staff.grant.manage`. |
| Studio and catalog | Studio settings writes use `studio.configure`. Package and version reads use `catalog.read`. Publishing or archiving a public or private version uses `catalog.manage` or `catalog.private.manage` respectively. |
| Purchases and installments | `/purchase-requests` uses `purchase.request` for submission, `purchase.read` for reads, and `purchase.review` for decisions. `/purchases` uses `purchase.read` or `purchase.record`. Installments use `finance.read` or `installment.manage`. |
| Payments and credit | `POST /payments` uses `payment.record`. `POST /payments/{id}/verify` uses `payment.verify`. `POST /allocations` uses `payment.allocate`. Reversals use `payment.reverse`. Credit adjustments use `credit.adjust`. Payment, allocation, and credit reads use `finance.read`. Allocation IDs are finance event IDs. |
| Refunds | `POST /refunds` uses `refund.request` and checks original receipt ownership. Reads use `finance.read`. Approve or reject uses `refund.decide`. Begin execution, post, and reconcile use `refund.execute`, `refund.post`, and `refund.reconcile`, respectively. All four decision/execution actions are Admin-only. |
| Membership and entitlement | `GET /memberships/{id}` uses `membership.read` and returns a summary. `GET /memberships/{id}/entitlement-entries` uses `entitlement.read`. `POST /memberships/{id}/activate` uses `membership.activate` and validates verified funding. Reject override and exception fields. `POST /memberships/{id}/activate-exception` uses Admin-only `membership.activate_exception` and requires a reason. Suspend, reinstate, cancel, extend, and grace use `membership.manage`. Entitlement review and adjustment use `entitlement.adjust`. |
| Scheduling | Slot reads and writes use `schedule.read` and `schedule.manage`. Own unavailability requests use `availability.request`. Decisions use `availability.decide`. Booking reads and client requests use `booking.read` and `booking.request`. Assisted requests use `booking.assist`. Approve or reject a booking with `booking.approve`. Resolve a cancellation or reschedule with its own `booking.cancel.decide` or `booking.reschedule.decide` action, determined by the stored change kind. Promotion uses `booking.waitlist.promote` only if enabled. |
| Attendance | Submission uses `attendance.submit` for the served coach. Reads use `attendance.read`. Verify and return use `attendance.verify`. Admin correction uses `attendance.correct`. |
| Reports and delivery | Inbox reads use `notification.read`. Operational reports, exports, and audit use `report.read`, `report.export`, and `audit.read`. Export also requires the relevant read scope. Private commission routes use the corresponding `commission.*` action, including an Admin check on generation and download. Private responses and exports are no-store and never go through the ordinary worker. |

Use strict DTOs, decimal strings with currency, UTC instants and separate business dates, cursor pagination, request IDs, and stable errors. Examples include 409 SLOT_FULL, HOLD_EXPIRED, BOOKING_LIMIT_REACHED, and INSUFFICIENT_LOT_FUNDS. Use a consistent 403/404 policy for private resources. Generate TypeScript and Dart clients from reviewed OpenAPI and check breaking changes in CI.

## Write retries

A retryable command accepts an idempotency key. Scope it to actor and canonical operation, with a digest of normalized command input including target IDs. A successful command commits its replay outcome, state, audit, and outbox together. Recheck current authorization and resource scope before returning a recorded outcome. Same key and digest replays the committed success. A changed digest yields 409 IDEMPOTENCY_KEY_REUSED. A rollback stores no successful outcome. For a timeout or documented transient lock failure, retry with the same key and input. Do not retry a business conflict blindly. Domain posting keys outlive HTTP retry records. See [shared command transaction](business-rules.md#shared-command-transaction).

References: [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [Socket.IO origin controls](https://socket.io/docs/v4/handling-cors).

## Foundation boundary

The API exposes liveness and PostgreSQL readiness, sign-in and token operations, scoped account reads, non-Admin disablement, staff grant changes, and studio settings. The local dashboard relay allows only `GET /me` and `POST /auth/socket-ticket` upstream. It keeps tokens in host-only cookies and binds its CSRF header to the current refresh credential. Foundation technical defaults are five-minute access tokens, a seven-day absolute refresh session, and 30-second single-use socket tickets.

The invitation, registration, verification, and recovery routes return `ONBOARDING_POLICY_PENDING` for permitted requests. Ordinary activation, the separate Admin exception, and commission reads return `WORKFLOW_NOT_ENABLED` after the relevant authorization checks. No membership or commission records are loaded or mutated. See [local setup](../README.md).
