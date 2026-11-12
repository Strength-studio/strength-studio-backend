# API contract strategy

This is the documentation contract. The [OpenAPI snapshot](../packages/api-contract/openapi.json) lists implemented API routes. Generated clients and later route families are deferred. The [permission matrix](permission-matrix.md) is the source of truth for action and resource scope. A listed route does not enable a pending workflow.

## Routing and credentials

Next.js pages and browser session/API handlers use the approved dashboard hostname. Use same-origin `/api/session/*` for browser session actions and `/api/studio/v1/*` for an allowlisted relay. The relay forwards over certificate-validated HTTPS to `/api/v1/*` on the approved API hostname with a NestJS-issued user bearer credential. Flutter calls the API host directly. Browser and Flutter sockets connect directly to `/socket.io/`. Actual hostnames and DNS targets are unconfirmed.

Browser access and refresh credentials use separate host-only Secure, HttpOnly, SameSite=Lax cookies with Path=/ and no Domain attribute. The VPS does not accept dashboard cookies. Personalized responses use no-store. Cookie-authenticated writes require exact Origin and a session-bound CSRF header. Check Origin on login. Consume account-link challenges by POST. Browser REST needs no broad credentialed CORS. Keep Vercel previews isolated from production data.

Flutter keeps the access token in memory and the refresh token in OS-backed secure storage. Use single-flight refresh, including coordination across dashboard tabs. A lost successful refresh response can require sign-in.

## Authorization and revocation

Every protected REST request checks the current user, active session, action, and resource scope. Bearer role claims are not permission grants. Reads check current scope before loading the result. Writes recheck under the [transaction guard](business-rules.md#shared-command-transaction) and keep it through commit. Recheck expiry against current database time after waiting for locks. Role and staff grant changes acquire an exclusive lock on the affected user. Session revocation and refresh acquire an exclusive lock on the affected session. If revocation wins, deny the write. If the authorized write commits first, revocation applies to subsequent requests.

Rotate refresh credentials atomically. Store digests. Consumed-token replay revokes the session and commits that revocation **before** returning the replay error. Logout accepts a bearer or a refresh credential and revokes its own session without rotation. Disablement revokes the applicable sessions. Password reset will revoke sessions when recovery is enabled. O-02 approves Admin-created accounts, Admin-controlled self-registration, verified email and Admin recovery through verified email. Invitation and post-verification enablement still need policy and implementation.

Sockets use short-lived, single-use tickets minted through authenticated REST. Bind each digest to session and purpose, consume it atomically, and check the exact allowed browser origin at handshake and upgrade. A native client still needs a ticket. The server assigns subscriptions. After revocation or a role or grant change, invalidate affected connections after commit. For missed invalidation, revalidate protected connections within 30 seconds or earlier at session expiry. Close protected subscriptions when authorization cannot be checked. Socket messages are invalidation hints, never business writes or commission events. Reconnect with a fresh ticket and refetch through REST.

## Route families

All paths below are relative to `/api/v1`. The named actions are the permission-matrix actions. The public catalog and complimentary acceptance routes below are implemented. Other commercial bindings are proposals. No unlisted route inherits access from a parent route.

| Family | Endpoint and action |
|---|---|
| Identity | Public, rate-limited: registration, login, email verification, and reset. Refresh and logout use their respective session credentials. `GET /me` and socket-ticket issuance use `account.self` and require an active session. `POST /users/invite` uses `client.manage` and creates Client only. Reject role and grant fields. Other account administration uses `user.manage`, and `/staff-grants` uses `staff.grant.manage`. |
| Studio and catalog | Studio settings writes use `studio.configure`. Package and version reads use `catalog.read`. Public management uses `catalog.manage`. Private issuance and management use dedicated `catalog.private.manage` and exact client/version scope. Admin withdrawal of an unaccepted offer requires a reason and a proposed separate action. |
| Purchases and installments | Client intent uses `purchase.request` and does not accept a purchase. Own in-app terms confirmation records agreement evidence separately. `purchase.read` and `purchase.review` cover scoped reads and intent review. Formal acceptance and recording use proposed dedicated `purchase.accept_record`, requiring evidence, exact eligible version and immutable snapshot. Installments use `finance.read` or `installment.manage`. Admin-only purchase cancellation and installment due-date revisions use separate proposed actions. |
| Payments and credit | Record and verify are separate `payment.record` and `payment.verify` actions. The same Admin may record, verify and authorize via distinct operations. Delegated Staff verification awaits Admin review and authorization. The proposed `payment.authorize` action is Admin-only and separate from verification. Explicit allocation/reallocation, credit application and adjustment, and correction initiation/authorization are Admin-only. Individually authorized Staff may request correction. Read with scoped `finance.read`. See the [proposed routes](milestone-2-implementation-plan.md#payments-allocations-credit-and-financial-reads). |
| Refunds | `POST /refunds` uses `refund.request` and checks original receipt ownership. Admin-only credit cash-out uses the same formal workflow. Record actual payout reference or reasoned Admin exception. Keep receivable adjustments separate. Reads use `finance.read`. Approve or reject uses `refund.decide`. Begin execution, post, and reconcile use `refund.execute`, `refund.post`, and `refund.reconcile`, respectively. All four decision/execution actions are Admin-only. |
| Membership and entitlement | `GET /memberships/{id}` uses `membership.read` and returns a summary. `GET /memberships/{id}/entitlement-entries` uses `entitlement.read`. `POST /memberships/{id}/activate` uses Admin-only `membership.activate` in the target contract and checks explicitly allocated payment and credit for the purchase, or the SAR 0 basis. Record the activation instant and optional future Riyadh start date. Reject exception and funding override fields. `POST /memberships/{id}/activate-exception` uses Admin-only `membership.activate_exception` and requires a reason. Suspend, manually reinstate, terminate, and extend use Admin-only `membership.manage`. Scheduled reactivation is a system transition. Use explicit Admin extension for any exception after expiry. Entitlement review and adjustment use `entitlement.adjust`. |
| Scheduling | Slot reads and writes use `schedule.read` and `schedule.manage`. Own unavailability requests use `availability.request`. Decisions use `availability.decide`. Booking reads and client requests use `booking.read` and `booking.request`. Assisted requests use `booking.assist`. Approve or reject a booking with `booking.approve`. Resolve a cancellation or reschedule with its own `booking.cancel.decide` or `booking.reschedule.decide` action, determined by the stored change kind. Promotion uses `booking.waitlist.promote` only if enabled. |
| Attendance | Submission uses `attendance.submit` for the served coach. Reads use `attendance.read`. Verify and return use `attendance.verify`. Admin correction uses `attendance.correct`. |
| Reports and delivery | Inbox reads use `notification.read`. Operational reports, exports, and audit use `report.read`, `report.export`, and `audit.read`. Export also requires the relevant read scope. Private commission routes use the corresponding `commission.*` action, including an Admin check on generation and download. Private responses and exports are no-store and never go through the ordinary worker. |

Use strict DTOs, decimal strings with currency, UTC instants and separate business dates, cursor pagination, request IDs, and stable errors. Examples include 409 SLOT_FULL, HOLD_EXPIRED, BOOKING_LIMIT_REACHED, and INSUFFICIENT_LOT_FUNDS. Use a consistent 403/404 policy for private resources. Generate TypeScript and Dart clients from reviewed OpenAPI and check breaking changes in CI.

## Implemented public catalog

| Method and route | Access |
|---|---|
| GET `/packages`, `/packages/{packageId}/versions/{versionId}`, `/session-types` | `catalog.read`. Signed-in Clients can read current public offers and active session types. Staff need the named grant. |
| GET `/packages/management`, `/packages/{packageId}/management` | `catalog.manage`. Staff need the named grant for drafts and historical versions. |
| GET `/packages/{packageId}/management/audit` | Both `catalog.manage` and `audit.read`. History is scoped to that package. |
| POST `/packages`, `/packages/{packageId}/versions`; PATCH `/packages/{packageId}/versions/{versionId}` | `catalog.manage`. For a successor send `terms: null` to clone the expected current version, or supply full terms. Edits require `expectedDraftRevision`. |
| POST `/packages/{packageId}/versions/{versionId}/publish`, `/packages/{packageId}/archive` | `catalog.manage`. Only Admin can publish a SAR 0 version. Publish requires the expected draft revision and current version ID. Archive requires the expected current version ID. Use explicit null when no version is issued. |
| POST `/session-types`, `/session-types/{sessionTypeId}/archive` | Admin only. Archived types remain in issued history and cannot be used for new publication. |

Use `Idempotency-Key` for all catalog writes. List responses use `items` and `nextCursor`. Pass `nextCursor` as `after` for the next page. The dashboard relays the listed methods and routes with the session bearer credential. Catalog writes require trusted Origin and session-bound CSRF, and the relay forwards bounded JSON and the idempotency key.

## Implemented Client reads

| Method and route | Access and response |
|---|---|
| GET `/clients` | Admin or Staff with `client.manage`. Returns `{ items, nextCursor }`. Items contain `id`, `displayName`, `email`, `accountState`, `emailVerified`, and `createdAt`. |
| GET `/clients/{id}` | Same management authority. Returns the directory item plus nullable `emailVerifiedAt`. |
| GET `/me/client-profile` | Authenticated Client only. Returns `id`, `displayName`, and `email` for the session owner. |

All three require both a Client-role user and a matching Client profile. Missing authority returns `403`. A missing or out-of-scope profile returns `404 CLIENT_NOT_FOUND`. The profile's creation timestamp is returned as `createdAt`.

The directory accepts integer `limit` (default 20, maximum 100), opaque `after`, optional `q` (trimmed, 1–120 characters, case-insensitive literal name or email prefix), `accountState`, and `emailVerified` (`true` or `false`). Results are newest profile first, with descending ID as the tie-breaker. Use the returned `nextCursor` with the same filters. Restart from the first page if the cursor is no longer in scope. Both detail routes accept no query parameters.

The dashboard relays these three GET routes with the current session bearer and sends no-store responses. The directory and detail pages require successful API authorization. Slice 1 covers reads. Onboarding remains gated by O-02.

## Implemented complimentary acceptance

`POST /purchases/complimentary` requires Admin, a bearer credential, and `Idempotency-Key`. Send `clientId`, `packageId`, `packageVersionId`, `agreementMethod`, `agreementEvidence`, and `purpose`. Use `SIGNED_AGREEMENT` with the signed agreement reference or `VERBAL_AGREEMENT` with a supporting note. Evidence and purpose must be nonblank and are limited to 2,000 and 240 characters respectively.

The exact version must belong to the selected package and be published, current, unarchived, and priced at SAR 0. A successful request returns `201` with `acceptanceId`, `membershipId`, and `status: "PENDING_ACTIVATION"`. The Purchase retains the exact Catalog version and a snapshot of its accepted terms and eligible session types. The agreement and pending membership both link to the Purchase. No financial postings or usable entitlement are issued.

An authorized same-key replay returns the original IDs. A new key cannot repeat acceptance for the same Client and version. Missing Clients or package/version pairs return `404`. Ineligible versions and duplicate acceptances return `409`. Agreement evidence and purpose are stored on the acceptance and excluded from Catalog responses.

## Write retries

A retryable command accepts an idempotency key. Scope it to actor and canonical operation, with a digest of normalized command input including target IDs. A successful command commits its replay outcome, state, audit, and outbox together. Recheck current authorization and resource scope before returning a recorded outcome. Same key and digest replays the committed success. A changed digest yields 409 IDEMPOTENCY_KEY_REUSED. A rollback stores no successful outcome. For a timeout or documented transient lock failure, retry with the same key and input. Do not retry a business conflict blindly. Domain posting keys outlive HTTP retry records. See [shared command transaction](business-rules.md#shared-command-transaction).

References: [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [Socket.IO origin controls](https://socket.io/docs/v4/handling-cors).

## Foundation boundary

The API exposes liveness and PostgreSQL readiness, sign-in and token operations, scoped account reads, non-Admin disablement, staff grant changes, and studio settings. The dashboard relay allows `GET /me`, `POST /auth/socket-ticket` and the catalog routes above. It keeps tokens in host-only cookies and binds its CSRF header to the current refresh credential. Foundation technical defaults are five-minute access tokens, a seven-day absolute refresh session, and 30-second single-use socket tickets.

The invitation, registration, verification, and recovery routes return `ONBOARDING_POLICY_PENDING` for permitted requests. Ordinary activation, the separate Admin exception, and commission reads return `WORKFLOW_NOT_ENABLED` after authorization and input checks. The API rejects new Staff activation grants and denies both stubs to Staff even when a legacy row exists. See [O-15](milestone-2-readiness-review.md#o-15-authorization-conflict). No membership or commission records are loaded or mutated. See [local setup](../README.md).
