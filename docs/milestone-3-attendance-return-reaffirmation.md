# M3-S1: Admin return and Coach reaffirmation

## Baseline and discovery

On 23 November 2026, `git fetch origin` confirmed remote `main` at
`55e442bfe06a1efe6e7a421e4119a28108d9f442`, matching the supplied merged baseline.
Both existing worktrees were clean and preserved. Work uses branch
`codex/m3-s1-attendance-corrections` in the separate `Strength Studio M3-S1-PR2`
worktree. No commit, push, PR, merge, production migration or deployment is authorized.

Discovery inspected the merged Prisma schema/migration, attendance DTOs,
controller/service/tests, action map, audit writer/vocabulary, `Commands.run`,
identity/session locks, database clock, dashboard relay/authentication, Admin
review and Coach workspace, and the verification/OpenAPI scripts.

The existing submission accepts only `{ bookingId, expectedRevision,
outcome: "ATTENDED" }`. There are no editable attendance details. The original
write accepts revision zero only; another submission is rejected. Admin review
was read-only, and the roster exposed only the latest revision. Runtime attendance
tables permit SELECT/INSERT, with no UPDATE/DELETE authority. Booking cancellation
already preserves a submitted revision and leaves it pending; the baseline race
test explicitly asserts this. Normal Scheduling changes stop after session start.

Implementation paused at the missing correction contract. The owner then
explicitly authorized **reaffirming ATTENDED as sufficient resubmission for this
slice**, after the Coach reviews the mandatory Admin return reason. This is an
approved reaffirmation of the existing outcome, not full correction of attendance
details. No alternative outcome, attendance timestamp, Coach note or editable
attendance field has been introduced. Full correction remains O-09-F below.

## Implemented contract

Every route is under `/api/v1/attendance/sessions/{sessionId}`. The existing
submission route and its revision-zero-only contract remain intact.

| Method and suffix | Action / access | Contract |
|---|---|---|
| GET `/participants/{bookingId}` | `attendance.read`: Admin or assigned Coach | Immutable revision history, newest first; `limit` 1–100 (default 50), `after` a revision UUID from this participant. Returns `{ bookingId, items, nextCursor }`. |
| POST `/participants/{bookingId}/return` | `attendance.return`: Admin only | `{ expectedScheduleRevision, expectedRevision, reason }`. Trimmed nonblank reason, maximum 1,000 characters. Latest pending revision only. |
| POST `/participants/{bookingId}/reaffirm` | `attendance.reaffirm`: assigned Coach only | `{ expectedScheduleRevision, expectedRevision, reviewedReturnId, outcome: "ATTENDED" }`. Latest returned revision only; acknowledgment must identify that exact Admin decision. |

Both POST routes require JSON, no query parameters and an `Idempotency-Key`;
success is `204`. Unknown body fields and alternative outcomes are rejected.
Staff (including legacy attendance grants) and Clients have no attendance access.
An unrelated Coach receives 404, including for participant history. The existing
requirement to match both current assignment and frozen served-Coach attribution
is preserved; a reassignment cannot transfer historical attendance access.

The session roster derives `UNSUBMITTED`, `PENDING_REVIEW` or `RETURNED` from
the latest participant revision and its optional return decision. It also reports
`returnEnabled` for the Admin test instance. History distinguishes `ORIGINAL`
from `REAFFIRMATION`, includes the submitting Coach ID/time, and retains each
responsible Admin ID, decision time and return reason. There is no mutable review
status column and no ACCEPTED/VERIFIED decision.

The dashboard opens a participant record from the roster. Admin sees the revision
history and a mandatory reason form for the current pending submission. Coach sees
the return reason/history and must check “I have read the Admin’s return reason
and reaffirm Attended” before sending the exact `reviewedReturnId`. This records
explicit acknowledgment; software cannot prove that a person understood the text.
After reaffirmation, the new revision is Pending review, and both parties can see
the original submission, Admin return and Coach reaffirmation. Pending and
unsubmitted participants have no reaffirmation control. History pagination,
loading, empty, error, success and same-request retry states are provided.

The relay retains exact method/path/query allowlists, Origin/Host and session-bound
CSRF validation, server-side bearer forwarding, the 16 KiB JSON bound, response
projection, no-store responses and idempotency forwarding. No membership, financial,
commission or unrelated Client data is added. Admin reasons should concern
attendance only; the form makes that scope explicit.

## Storage, transactions and cancellation

Migration `20261123000100_attendance_return_reaffirmation` adds
`attendance_review_decision`: UUID primary key, unique restrictive revision FK,
restrictive Admin user FK, RETURNED-only enum, mandatory nonblank bounded reason,
and database decision timestamp. An Admin FK index complements the unique revision
index. `studio_api` receives only SELECT/INSERT; PUBLIC, reporting and worker roles
receive no table privileges. Existing attendance rows and permissions are unchanged.
New audit actions are `ATTENDANCE_RETURNED` and `ATTENDANCE_REAFFIRMED`, with an
`ATTENDANCE_REVIEW_DECISION` target for the return.

Writes use `Commands.run`: identity/session locks and idempotency claim precede
the scheduled-session lock. Scope/authorization is checked again after locking,
including on replay. The command re-reads schedule, Booking and latest revision,
then samples `clock_timestamp()` through `databaseTime`. No membership locks or
balance updates are needed. The existing Booking writer takes membership then
session locks; these attendance commands never acquire a membership lock after
the session lock. Unique revision/decision constraints complement serialized
session writes. The revision or decision, audit event and retry result commit
together. An audit failure rolls back all three. A reaffirmation appends revision
N+1 to the same participant; the prior revision and its decision are untouched.
The reaffirmation audit also identifies the prior revision and acknowledged return.

New transitions on cancelled Sessions or non-confirmed Bookings are safely blocked
with `SESSION_CANCELLED` or `BOOKING_NOT_CONFIRMED`. All evidence remains readable
under the existing scope checks. This is a conservative technical block pending
O-09-E, not a decision about chargeability, discarding evidence or automatically
changing existing pending/returned status. Session cancellation after submission
is not available through the normal Scheduling API; defensive tests cover an
externally cancelled historical record as well.

All new writes retain the `attendanceCaptureForTesting` gate. Normal production
configuration has no environment override. Pending attendance and reaffirmation
do not count as held, verify attendance or deduct entitlement. Future deduction
must use only the Membership selected on the Booking; concurrent memberships
remain independent. No notification, deadline policy, financial or commission
behavior is added.

## O-09 and unresolved decisions

These questions preserve the approved verification/deduction boundary in the
[owner register](milestone-2-decision-register.md#o-09). Recommendations are technical
defaults only and are not owner-approved business policy.

| ID | Exact owner question | Affected workflow | Implementation impact | Blocking point | Recommendation, if technically justified |
|---|---|---|---|---|---|
| O-09-A | What is the late attendance submission deadline, including reaffirmation? | Coach first submission and return cycle | A deadline and post-lock validation need an approved policy. | Production capture activation; not gated disposable tests | Keep the existing production gate closed until approved. |
| O-09-B | Which no-shows and late cancellations, if any, are chargeable, and when? | Future Admin verification and entitlement usage | Requires separately approved outcomes and charging rules; ATTENDED remains the only current outcome. | Later verification/deduction milestone | No chargeability rule inferred in this slice. |
| O-09-C | What should Admin do when a verified session lacks sufficient entitlement on the Booking’s selected Membership? | Future verification and exceptions | Requires an explicit insufficiency/exception contract without borrowing another Membership’s units. | Later verification/deduction milestone | Keep Membership histories independent; no automatic deduction here. |
| O-09-D | Who receives a correction/return notification, through which approved channel? | Return notifications | Recipient rules and delivery need a later implementation. | Later notification milestone, not this slice | No notification is sent by this slice. |
| O-09-E | After a Booking with submitted attendance is cancelled, may Admin return or verify it, and may Coach reaffirm it? How should externally cancelled Sessions be treated? | Cancellation after submission | Evidence/status already survive cancellation; review/reaffirmation policy is missing. New transitions are blocked while history remains readable. | Enabling transitions on cancelled records; does not block this slice’s safe block | Preserve all evidence and block new transitions until the owner decides. |
| O-09-F | For full attendance correction, what exact data may Coach edit, with what validation and permitted outcomes? | Future correction of attendance details | The owner authorized ATTENDED reaffirmation only. No fields exist for a substantive change. A future approved contract requires DTO, schema, UI and test changes. | Future full-correction enhancement, not this approved reaffirmation slice | Keep ATTENDED as the only outcome until a separate contract is approved. |
| O-09-G | What retention and archival/redaction requirements apply to attendance revisions and Admin return reasons? | Historical evidence and future retention operations | Current evidence is append-only with paginated reads; no TTL, archival, deletion or redaction workflow is introduced. | Later retention/archival capability; not this slice | Preserve history under existing permissions until an explicit retention workflow is approved. |

No new authorization policy or historical-attribution exception was needed.
Migration tests cover a fresh database and upgrade from the merged attendance
schema with original submissions present. Database owners remain able to administer
tables; append-only permissions apply to application/runtime roles, as in the
existing attendance design.

## Verification record

The final run used Node 20.19.5, the available pnpm 11.25.0 runner and an isolated
PostgreSQL 16.15 server on loopback port 55427. No existing database was reachable
at the previous worktree's configured port. PostgreSQL packages were extracted
into a task-owned temporary directory, without a system installation. A fresh
`strength_studio` template was created only on that disposable server; each suite
created/dropped its own temporary test databases. Neither existing worktree's
environment, dependencies or database was changed. The server was stopped after
verification.

Dependency installation first failed because three pinned tarballs were missing
from the offline cache; an online retry timed out. Independent copies of the
existing attendance worktree's installed dependencies were used instead. No
dependency manifest or lockfile changed. The environment's automatic dependency
reinstallation check was disabled for pnpm script execution with
`pnpm_config_verify_deps_before_run=false`; application checks and tests were not
disabled. The repository's declared pnpm 10.34.9 / Compose PostgreSQL 17 combination
was not rerun in this environment.

| Command | Exact final result |
|---|---|
| `pnpm_config_verify_deps_before_run=false pnpm db:migrate` | All 15 migrations applied successfully, only to the new disposable template. |
| `pnpm_config_verify_deps_before_run=false pnpm verify` | Prisma generation, backend build and dashboard build passed; 11/11 unit tests and 99/99 backend integration tests passed, zero skipped/failed. Includes fresh migration, upgrade from the attendance baseline, constraint/role permissions, cancellation races and concurrent/idempotent writes. |
| `node --env-file=.env --test apps/dashboard/test/catalog.integration.test.cjs` | 13 passed, 0 failed, 16 browser tests skipped because no browser executable was selected for this invocation. |
| `STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --env-file=.env --test --test-name-pattern='Attendance in Chrome' apps/dashboard/test/catalog.integration.test.cjs` | 2 passed, 0 failed, 27 other tests excluded by the pattern. Covers the existing submission/Admin read flow and new reason/acknowledgment/reaffirmation history flow. |
| `STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --env-file=.env --test --test-name-pattern='Client browser history' apps/dashboard/test/catalog.integration.test.cjs` | Final isolated rerun: 8 passed, 0 failed, 21 other tests excluded by the pattern. |
| `STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --env-file=.env --test --test-name-pattern='Purchase funding viewer\|Membership activation in Chrome' apps/dashboard/test/catalog.integration.test.cjs` | 3 passed, 0 failed, 26 other tests excluded by the pattern. |
| `STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --env-file=.env --test --test-name-pattern='Scheduling in Chrome\|Booking management in Chrome' apps/dashboard/test/catalog.integration.test.cjs` | 3 passed, 0 failed, 26 other tests excluded by the pattern. |
| `pnpm_config_verify_deps_before_run=false pnpm openapi` (twice), then `sha256sum -c /tmp/strength-pr2-openapi-first.sha` | Snapshot updated for the new paths, DTOs, RETURNED state and return gate. Second generation identical: `e754aa61ee7926a5d4f6a787de9601271c9759616c5e569a266bc01ef7a461bc`. |
| `git diff --check` | Passed. Both original worktrees remained clean. |

All 16 browser regressions passed across their separate groups. The first parallel
run of the existing Client-history group had one failure at its
`data-client-history` assertion after navigation; all eight passed unchanged when
the group ran alone. No existing assertion was weakened or deleted. The new relay
tests extend the helper to assert an explicit expected Allow header, preserving
its existing GET default while checking POST-only return/reaffirmation routes.

### Files changed

```text
README.md
apps/backend/prisma/schema.prisma
apps/backend/prisma/migrations/20261123000100_attendance_return_reaffirmation/migration.sql
apps/backend/src/attendance/attendance.controller.ts
apps/backend/src/attendance/attendance.dto.ts
apps/backend/src/attendance/attendance.service.ts
apps/backend/src/identity/permissions.ts
apps/backend/test/foundation.integration.test.cjs
apps/backend/test/security.unit.test.cjs
apps/dashboard/app/api/studio/v1/[...path]/route.ts
apps/dashboard/app/attendance/workspace.tsx
apps/dashboard/lib/attendance.ts
apps/dashboard/lib/catalog-relay.ts
apps/dashboard/test/catalog.integration.test.cjs
docs/api-contract.md
docs/business-rules.md
docs/milestone-2-decision-register.md
docs/milestone-3-attendance-return-reaffirmation.md
docs/open-decisions.md
docs/permission-matrix.md
packages/api-contract/openapi.json
```

### Delivery status and limits

| Category | Result |
|---|---|
| Implemented and tested | Participant-specific Admin return, mandatory reason, explicit Coach ATTENDED reaffirmation, immutable history, derived state, role/served-Coach scope, gated writes, transactional audit/idempotency, cancellation block, dashboard flow, migration and OpenAPI snapshot. |
| Implemented but not fully verified | The approved slice passed on the stack above. PostgreSQL 17 / pnpm 10.34.9 parity and production infrastructure were not exercised. An existing Client-history timing failure occurred during parallel execution, with a passing unchanged isolated rerun. |
| Not implemented | Full detail correction, alternative outcomes, Admin acceptance/verification, entitlement posting/deduction, deadline changes, notifications, commission/branch work, production migration/deployment. |
| Requires owner decision | O-09-A–G above. Reaffirmation itself was explicitly authorized and is no longer a missing-contract blocker. |
| Blocks production activation | O-09-A remains unresolved and `attendanceCaptureForTesting` remains the only capture enablement. Production activation/deployment is not authorized. Future cancelled-record transitions require O-09-E; future verification/deduction requires the relevant O-09-B/C policies. |

HEAD remains the baseline SHA above: **no commit was created, pushed or merged,
and no PR was opened. No production migration or deployment occurred.**
