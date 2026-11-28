# S2-A Client onboarding implementation and verification

**Current delivery checkpoint — 28 November 2026:** implementation and R01-R03
corrections were preserved in `8b4ebc221e3e7cfe1d3dcf1bc7356049e33696f2` on
`codex/s2a-client-onboarding-20261127`. The reviewed follow-up includes the
password-rejection audit correction and regressions, an isolated operator harness,
and the [completed human acceptance evidence](s2a-human-acceptance-session.md).
Required H01-H10 and S01-S11 passed with the S11 qualification; finalization reran
14 backend and 11 Dashboard tests successfully. Formal product acceptance remains
pending, HA-UI-01 remains Low/cosmetic, and production readiness is not approved or
assessed. The owner authorized finalization, commit and normal feature-branch push;
PR creation, merge, real delivery and production changes remain excluded.

The dated Git/readiness descriptions below are historical checkpoints. See the
[engineering review](s2a-acceptance-review.md) for the audit follow-up and the
acceptance evidence for current status.

27 November 2026, Africa/Cairo. Bounded local implementation authorized by the
owner's S2-A task. No commit, remote operation or production authorization is
included. This report supersedes earlier planning-only readiness for this slice;
prior O-02 reviews remain historical evidence, with their approvals preserved.

**Review correction checkpoint:** The subsequent independent review returned
**CHANGES REQUIRED** for three Medium browser defects, R01–R03. Owner-authorized
corrections and regression evidence are recorded in section N. The original
verification below is historical evidence, not proof those defects were absent.

## A. Repository state

Repository: `Strength-studio/strength-studio-backend`.
Worktree: `/home/kraken/Programming/Projects/Strength Studio S1-B1`.
Branch: `codex/s1b1-client-profile-maintenance-20261127`.
Starting/final HEAD: `153690b6954df64ca99114a8bfec91285aad77b2` (no commit).
Local `main` remains `1fb9c220a4f234f3eb21d87019376b95b7635c7a`.
All eight worktree checkouts/branches and refs are preserved; the other seven
worktrees remain unchanged. Only this worktree contains S2-A implementation work.

Incoming uncommitted work comprised three modified tracker/decision documents and
two untracked O-02 review/closure documents. Their full contents were captured
before implementation and retained. New implementation notes are appended to those
historical documents; the current API/permission/README contract is updated for
actual implemented behavior. No reset, discard, staging or branch switch occurred.

## B. Implementation summary

- [Onboarding service](../apps/backend/src/onboarding/onboarding.service.ts) and
  [controller/DTOs](../apps/backend/src/onboarding/onboarding.controller.ts): Admin
  Client creation, one-time manual disclosure, scoped status, reasoned reissue/revoke,
  separate email proof, password authorization/setup and automatic access enablement.
- [Security helpers](../apps/backend/src/onboarding/security.ts): opaque random
  capabilities, authenticated encryption for temporary email delivery payloads.
- [Delivery service](../apps/backend/src/onboarding/delivery.service.ts): durable
  PostgreSQL intents, replaceable adapter, isolated fake transport, lease fencing,
  retry/expiry/failure handling. No provider/scheduled sender is enabled by default.
- Dashboard Admin invitation page and existing profile integration, secure Admin
  relay, public proof/password pages and pre-authentication CSRF/cookie handlers.
- Additive schema/migration, narrow identity database entry points, existing audit
  integration, OpenAPI, tests and synchronized scope/rollout documentation.

No self-registration, password recovery, email/role correction, merging,
reactivation, non-Client provisioning, commercial/service change, mobile or
production-bootstrap functionality is enabled.

## C. Implemented business flow

```text
Admin creates new CLIENT + profile, account INVITED
    → one-time initial link disclosed to Admin, manually shared
    → recipient explicitly accepts initial proof
    → PENDING_VERIFICATION + separate encrypted email-proof intent
    → emailed proof explicitly consumed
    → email verified; account still pending + 15-minute PASSWORD authorization
    → valid password setup consumes authorization and atomically makes ACTIVE
    → explicit existing sign-in
```

GET/page opening does not consume a credential or send email. No ordinary session
exists before completion. Password setup never overwrites existing credentials.
Membership, payment, purchase, package, booking, attendance and entitlements neither
control nor change account enablement. An existing email collision does not link,
merge, repair a profile or change a role.

## D. API and browser contracts

The [implemented API contract](api-contract.md#implemented-s2-a-admin-client-onboarding)
and [generated OpenAPI](../packages/api-contract/openapi.json) list exact DTOs.
All paths below are relative to `/api/v1`.

| Endpoint | Purpose / authority |
|---|---|
| POST `/users/invite` | Admin-only `user.manage`; email/name, Idempotency-Key; 201 stable IDs/expiry and first-execution manual link. |
| GET `/clients/{id}/onboarding` | Admin-only safe status, revision, expiry/cooldown/delivery projection. |
| POST `/users/{id}/onboarding/reissue` | Admin-only expectedRevision/reason/key; 200 replacement disclosure, current INVITED case only. |
| POST `/users/{id}/onboarding/revoke` | Admin-only expectedRevision/reason/key; 204 invalidates unfinished chain. |
| POST `/auth/accept-invitation` | Exact SETUP proof; 202 only after pending state and separate email intent commit. |
| POST `/auth/verify-email` | Exact EMAIL proof; 200 distinct PASSWORD authorization/expiry; no account session. |
| POST `/auth/setup-password` | Exact PASSWORD authorization and valid password; 204 atomic completion. |
| POST `/auth/resend-verification` | Generic public 202 for every valid email input; eligible pending cases only actually issue. |

The former Staff-accessible invitation **stub** binding is explicitly replaced by
Admin-only `user.manage`; Staff's existing Client reads/grants remain unchanged.
Strict body/query validation rejects role/grant/identity-state/financial fields.
Client IDs are scoped by CLIENT role plus profile, and onboarding case where needed.

Admin browser writes retain exact Origin/Host, refresh-bound CSRF, bounded JSON,
actor binding and immutable command retry body/key. Unknown first-write results
retain the original intent. Replay returns original issuance IDs/expiry but no
redisclosed secret; explicit replacement is required if a first response was lost.

Public `/api/onboarding/*` is a separate allowlist with exact Origin/Host, bounded
JSON and signed 15-minute nonce cookie/header. EMAIL verification places the
PASSWORD credential only in a Secure HttpOnly SameSite=Strict cookie; browser JSON
contains no password authorization. Fragments are stripped before API use. No
arbitrary redirect, generic auth passthrough or pre-ACTIVE login cookie is added.

## E. Database and migration safety

[Migration `20261127000200_client_onboarding`](../apps/backend/prisma/migrations/20261127000200_client_onboarding/migration.sql)
is additive and was reviewed before applying to the task's test cluster.
It adds:

- `client_onboarding`: existing User FK, initiating Admin FK, revision, revoked/
  completed instants; no new business account-state enum.
- `onboarding_challenge`: case FK, SETUP/EMAIL/PASSWORD purpose, digest, expiry,
  generation, replacement flag and consumed/revoked instants. Unique digest and
  partial unique current-purpose index; shape/state constraints and history retained.
- `onboarding_delivery`: unique challenge FK, encrypted payload, attempts, next
  availability, fenced lease and accepted/failed instants with shape constraints.
- Onboarding audit actions and ONBOARDING_REQUEST target using existing AuditLog.
- Narrow SECURITY DEFINER functions for Client-only creation, email proof recording
  and once-only password establishment. Qualified names/pinned search_path,
  PUBLIC EXECUTE revoked, ordinary API-only EXECUTE. No general identity/profile
  INSERT or password/email/role UPDATE privilege is granted to the runtime role.
  Proof functions recheck exact purpose/source/current case and target state.

Ordinary runtime cannot delete onboarding history or update immutable proof facts.
Only necessary progress/lease columns are writable; restrictive references retain
identities and history. No existing applied migration is edited. Existing Client
profiles or anomalies are not backfilled/repaired; new writers create correctly
associated CLIENT records. The incoming global email uniqueness remains authoritative.

**Verified test target:** newly initialized PostgreSQL 17.10 cluster at
`127.0.0.1:55439`, task-owned data directory
`/home/kraken/strength-studio-s2a-verification/pgdata`. SQL confirmed loopback address,
port, server version and database before migrations. The base `strength_studio`
is a newly created task-owned template, not the pre-existing development DB.
All 17 migrations deployed successfully; integration suites additionally migrated
fresh isolated databases and/or cloned this migrated template, dropping only their
own random test databases afterward. No production/unknown target was used.

### Rollback guidance — instructions only

Prefer application rollback while retaining this additive migration and all
created User/profile/audit/proof/history records. Disable new onboarding entry
points and stop/pause any explicitly configured dispatcher before rollback; the
current default has no provider or scheduled sender. Handle in-flight sends as
uncertain; do not assume they can be recalled. Any authorized invalidation must
revoke unfinished chains, never revive an old raw token or delete Clients.

Verify older audit readers tolerate the new enum values and remain scoped to
appropriate events. Existing account-state enum and existing login fields are
unchanged, so legitimately activated Clients retain their identities/credentials;
commercial/service history is untouched. Keep migration history, enum values and
append-only audit evidence. Do not drop tables, reset migration records or delete
accounts to imitate the previous schema.

If a separately authorized rollback requires privilege withdrawal, first drain
new callers, then review revoking only the new function EXECUTE/table privileges;
preserve existing identity/session/profile/audit grants. Restoring the application
later requires explicitly restoring any manually revoked privileges: an applied
Prisma migration will not automatically rerun. Real DB cleanup/down migration,
production invalidation and key rotation require separate review, backups and
isolated rehearsal. No rollback or production change was performed by this task.

## F. Security, concurrency and technical decisions

APPROVED business values are unchanged: SETUP/EMAIL expiry 24 hours; 60-second
replacement cooldown; at most five replacements per recipient/purpose/hour;
manual initial handoff; separate proof/password commits; automatic access with no
commercial prerequisite; no automatic identity linking; Admin-only management.

Technical choices under implementation authority:

| Area | Implemented decision |
|---|---|
| Password handoff | Separate single-use 15-minute PASSWORD capability, sessionless; browser Secure HttpOnly cookie. Lost handoff requires fresh email proof, not consumed-proof replay. |
| New password | 12–256 characters, no trimming/normalization, existing Argon2id helper; existing login policy unchanged. Hashing outside DB locks with two-operation bound and fresh proof/state recheck under lock. |
| Identity collisions | Current trim+lower email convention only; no dot/plus/phone/name equivalence. Duplicate creation conflicts, including other roles/missing profile; no repair. Client without User is prohibited by existing FK. |
| Rate accounting | Initial issuance excluded from replacement count; cooldown measured from latest same-purpose issuance; rolling hour uses DB time and counts actual replacement rows. Transport retry/HTTP replay do not mint credentials or extend expiry. |
| Transaction serialization | All onboarding and dispatch writers first lock exact User, then child proof/queue state. Existing Admin command wrapper already holds target User before its retry claim; no new case lock is silently acquired out of order. New identities are privately created in the creation transaction. |
| Deadline defense | Post-lock DB time; database credential functions recheck deadline/source too. Boundary-crossing DB denials map to the same generic proof error, not a secret-bearing internal error. |
| Revocation | Reissue/resend supersedes unfinished descendants and increments revision; case revoke blocks entire chain. DISABLED state independently blocks every consumer/dispatch; setup cannot reactivate or replace ACTIVE credentials. |
| Audit | Success mutation/proof/audit/retry/intent commit together. Separate bounded rejection audit after rollback; safe request targets, no invented authenticated actor. No passwords/raw tokens/codes/digests/addresses/request bodies in metadata. |
| Delivery | AES-256-GCM with independent key and challenge-ID AAD; 30s fenced leases, bounded batches, maximum eight attempts, exponential 30s–1h backoff until expiry. No provider errors logged. Acceptance is distinct from proof/inbox delivery. |
| Disclosure | SETUP link only in first authorized command response and ephemeral UI; absent from ordinary profiles/status/replays. Focus/account/visibility/navigation hide it. Public pages strip fragments, use no-store and conceal password fields on pagehide/BFCache restoration. |
| Enumeration/abuse | Generic resend body/status and suppressed recipient cooldown, global availability check before lookup; 80ms normal-response floor plus per-route 10/min IP throttle. This is best-effort timing reduction, not a distributed-abuse or constant-time guarantee. |

The subsequent independent review identified three Medium browser findings;
their bounded corrections and verification are recorded in section N.
Uncertain SMTP sends may duplicate copies of the same proof; exactly-once email
is not claimed. Paused/absent transport leaves intents queued, never verified.

## G. Dashboard and visual verification

Admin `/clients/new` and Invite Client navigation provide strict name/email entry,
bounded duplicate feedback, one-time disclosure/expiry, original-intent retry and
profile navigation. Existing Client detail adds safe onboarding status plus
reasoned, revision-checked reissue/revoke with cooldown. No raw proof appears in
ordinary profile/status HTML. Staff see existing reads without onboarding controls.

Public `/setup` requests separate email, `/verify-email` commits mailbox proof,
and `/setup-password` establishes credentials and enables access. Invalid/expired/
used proofs offer neutral resend/reissue guidance; explicit sign-in follows success.
No email-verification secret or general debug inbox is displayed in the Dashboard.
Fake transport is accessible only through the isolated programmatic test harness.

Headless Chrome screenshots were visually inspected. The initial Admin form lacked
scoped spacing; a scoped CSS correction produced a clean form without changing
other pages. Final screenshots (no raw tokens/passwords):
`/home/kraken/strength-studio-s2a-verification/admin-onboarding.png` and
`client-setup.png` in the same directory.

## H. Testing evidence

Toolchain: Node **22.23.5**, pnpm **10.34.9**, Prisma **6.19.3**, PostgreSQL
**17.10**, Chrome **158.0.8127.88**. Separate private test environment lives outside the
repository; no existing `.env` or production credential was changed. New suites
supply their own random encryption keys and also pass with the environment key
unset, so CI does not depend on a developer's onboarding secret.

| Check | Result / exact scope |
|---|---|
| Backend build, Prisma generate/validate | Passed. Schema validates; no dependency/version changes. |
| Dashboard production build | Passed, including all new routes; final scoped layout built and visually inspected. |
| Backend units + integration | **132 passed**, zero failed/skipped: 13 units, 107 existing Foundation integrations and 12 S2-A integrations. |
| S2-A Dashboard/Chrome | **5 passed**, zero failed/skipped; Admin relay, pre-auth CSRF/HttpOnly handoff, full recipient flow, disclosure/account switch, cooldown/reissue/revoke. Environment-key-unset run passed. |
| Existing Dashboard integration | **15 passed**, zero failed; 28 Chrome-only cases skipped in that non-browser run, not silently counted as passing. |
| Existing S1-B1 relay/Chrome | **7 passed**, zero failed/skipped in fresh selected process. |
| Existing Client browser history | **8 passed**, zero failed/skipped in fresh selected process. |
| Canonical pinned `pnpm verify` | **Passed**: generation, both builds, 13 unit tests and 119 integration tests, zero failures, including explicit HTTP/provider log and audit secret-leakage checks. The final relay guard is also covered by all five S2-A Dashboard/Chrome tests. |
| OpenAPI | Generated from compiled controllers; byte-for-byte regeneration passed, SHA-256 `ec57d8495f3d7157e8133879e56eab78eb124eae5e755650136d5b58cadf7973`. |
| Integrity | Diff whitespace, practical Markdown links/anchors, incoming-content preservation, known file inventory and worktree/ref/staging checks passed; verification manifest retained outside repository. |

Commands were run from this worktree, with pinned Node on PATH and
`--env-file=/home/kraken/strength-studio-s2a-verification/test.env` in place of `.env`:

```sh
pnpm verify
node --test --test-concurrency=1 apps/backend/test/*.unit.test.cjs apps/backend/test/*.integration.test.cjs
STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --test apps/dashboard/test/onboarding.integration.test.cjs
node --test apps/dashboard/test/catalog.integration.test.cjs
STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --test --test-name-pattern='S1-B1' apps/dashboard/test/catalog.integration.test.cjs
STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --test --test-name-pattern='Client browser history' apps/dashboard/test/catalog.integration.test.cjs
pnpm openapi
```

The harness validates loopback URLs and uses disposable test database names. Logs
are under `/home/kraken/strength-studio-s2a-verification/logs/`; the verification
manifest records exact filenames/counts and final source hashes.

Earlier failures and corrections: a Chrome test attempted revoke before reissue's
refresh became idle (now waits for actual aria-busy state); an old unsupported-route
assertion expected 404 for the newly enabled invite route (now explicitly asserts
403 for missing actor binding); and a profile-draft test's page-wide status check
matched the new independent onboarding status (now scoped to the profile editor,
preserving draft/precondition/conflict assertions). No assertion was removed to
hide a product/security failure. The initial form layout was fixed from visual QA. Final Origin/CSRF hardening rejects forged writes before any backend identity call, verified by a dedicated upstream-request assertion.
No unresolved failing test remains in the recorded final focused results.

Not run/established: real SMTP/provider delivery, distributed/multi-host load,
production migrations/bootstrap/restore/deployment and mobile. Other pre-existing
Chrome groups were not repeated: runtime changes are scoped to Client/onboarding,
and Foundation/backend, Dashboard integration, Client history and S1-B1 regressions
provide the applicable evidence. No GitHub CI/push result is claimed for uncommitted work.

## I. Documentation synchronization

Updated current API/OpenAPI, permission matrix, README/local template key and root
integration script. Added this implementation/rollback/evidence report. Appended
current implementation references to the existing implementation roadmap, S2 slice
tracker, O-02 decision register/index and both incoming O-02 review/closure records.
Historical approval/proposal text is preserved; current source/API contract and
this report distinguish implemented from deferred/production-gated behavior.

Documentation paths: `README.md`, `docs/api-contract.md`,
`docs/permission-matrix.md`, `docs/implementation-roadmap.md`,
`docs/milestone-3-next-slices.md`, `docs/milestone-2-decision-register.md`,
`docs/open-decisions.md`, `docs/o02-onboarding-decision-review.md`,
`docs/o02-b-onboarding-decision-closure.md` and this report. Structured contract
`packages/api-contract/openapi.json` and config template `.env.example` are also
synchronized; no actual `.env`/production credential file was edited.


## J. Remaining issues and boundaries

- No real provider adapter, SMTP credentials, sender/domain, scheduled dispatch or
  production operational ownership is enabled. The dispatch boundary and fake
  transport are implemented/tested; real email integration is an explicit later gate.
- User acceptance with real email and a production-like environment has not occurred.
  New flows have automated isolated fake-transport and Chrome evidence only.
- Identity repair/merge/email correction, case restart after revocation, self-signup,
  recovery, non-Client provisioning and production Admin bootstrap remain deferred.
- Pending/history retention, secret-key rotation, delivery budgets/alerting,
  distributed abuse controls and full backup/release evidence require production
  review. Existing retry checkpoints remain in memory; losing an initial link
  response requires reasoned explicit reissue under the documented policy.
- Review findings R01–R03 were corrected under subsequent owner authorization;
  section N records current evidence. These stated
  environment/rollout limitations are not a production-readiness claim.

## K. Readiness

| Level | Verdict |
|---|---|
| Implementation complete | **Yes**, bounded locally implemented S2-A with fake transport and no external provider. Uncommitted, ready for owner review. |
| Verification complete | **Yes for the bounded local scope**: builds, canonical backend/unit integration, new Dashboard/Chrome, applicable Client regressions, schema/OpenAPI and integrity checks passed. Production checks are excluded, not silently counted. |
| Usage Testing Ready | Automated isolated fake-transport journey verified. Full-platform or real-email Usage Testing Ready is **not established**. A human test session needs a separately reviewed isolated harness/environment. |
| Production Ready | **No.** Real email infrastructure/operations, bootstrap/recovery/retention/release approvals and evidence remain open. |

## L. Git and authorization status

All work remains unstaged/uncommitted on the existing branch. No commit, push,
PR creation/modification, merge, deployment, production migration, production
configuration or production operation occurred. No external email/message was sent.
Other worktrees/branches and all incoming work remain preserved. Only explicitly
verified task-owned local/test databases were migrated or modified.

## M. Recommended next action

Owner review of the uncommitted S2-A implementation, contracts, test evidence and
migration/rollback strategy. Review may request adjustments; committing/pushing/
PR/deployment remain separate authorization gates. No next feature starts here.

## N. Independent review corrections — R01, R02, R03

27 November 2026, Africa/Cairo. The owner authorized fixes for these three findings,
their tests and implementation/review documentation only. The independent review's
verdict was **CHANGES REQUIRED**, with three Medium acceptance blockers and no
Critical/High finding. No broader feature or production operation was authorized.

| Finding | Confirmed defect | Correction |
|---|---|---|
| R01 — password-flow association | Tab B overwrote the shared cookie, letting tab A's existing form establish B's password. | Verification creates a random non-secret 192-bit flow ID bound to the HttpOnly credential. The browser submits that ID; mismatches are rejected before the backend call and leave the other flow's cookie intact. The ID crosses a stripped fragment and is retained only in that tab's history entry for reload; no password/proof/authorization secret enters history. One browser-wide authorization remains: a superseded tab needs fresh email proof. |
| R02 — generic resend acknowledgement | A suppressed 202 cleared the cookie/proof and hid the active form, despite no replacement issuance. | Resend renders a neutral acknowledgement without clearing credentials, consuming proof, marking the step complete or resetting form input. Public responses remain generic. Actual issuance still supersedes old credentials in the backend; subsequent use is rejected authoritatively. |
| R03 — invitation draft loss | Focus/visibility revalidation unmounted uncontrolled name/email inputs and restored an empty form. | Controlled values remain in component memory through revalidation. Drafts stay concealed while authority is checked and are cleared on identity/access invalidation and successful invitation. Admin/actor/CSRF/retry checks are retained. |

### Regression evidence

Five new Chrome defect regressions were exercised against the original production
build before product fixes. The setup, verification and password resend tests and
the Admin draft test failed on the reported defects. Chrome initially blocked the
R01 test popup; a narrowly scoped optional CDP user-gesture argument enabled a real
second tab, after which the unchanged product demonstrably wrote B's credentials
from A's form. That R01 regression then failed on the wrong-Client assertion. This
harness adjustment did not weaken a product assertion.

The corrected suite additionally checks actual resend supersession, missing/
mismatched/malformed password-flow IDs being rejected without backend calls or
cookie loss, HttpOnly separation, password-flow reload, and completion of B's own
form after A's mismatch. Suppressed resends cover an ineligible INVITED recipient,
the same pending recipient within cooldown, and a nonexistent recipient. All
produce the same public 202 acknowledgement while preserving valid current state.
Admin focus and hidden/visible transitions preserve draft values; switching to
Staff conceals the draft and returning to the former identity cannot restore it.

Verification logs and the source/integrity manifest are retained outside the repo
at `/home/kraken/strength-studio-s2a-corrections/`. Tests use the existing task-owned
PostgreSQL 17.10 cluster at `127.0.0.1:55439`; server address, port, database, role,
data directory and all 17 existing migrations were verified before running tests.
Suites clone disposable randomly named databases and drop their own databases on
cleanup. No migration or schema change is part of these corrections.
The final database census found only the original `strength_studio` template;
the task-owned cluster was stopped again after verification.

| Check | Result |
|---|---|
| Dashboard production build, pinned Node 22.23.5 / pnpm 10.34.9 | Passed. |
| Backend and Dashboard TypeScript checks, no emit | Passed; zero diagnostics. |
| Dashboard onboarding, real Chrome | 11 passed, zero failed/skipped: five existing cases plus six added correction cases. |
| Backend units and existing onboarding integrations | 25 passed, zero failed/skipped: 13 units and 12 onboarding integrations. |
| Existing S1-B1 relay/Chrome | 7 passed, zero failed/skipped. |
| Existing Client browser history | 8 passed, zero failed/skipped. |

Commands use pinned Node and the private existing task test environment in place
of a repository `.env`:

```sh
pnpm --filter @strength-studio/dashboard build
node --experimental-websocket --env-file=/home/kraken/strength-studio-s2a-verification/test.env --test apps/dashboard/test/onboarding.integration.test.cjs
node --env-file=/home/kraken/strength-studio-s2a-verification/test.env --test --test-concurrency=1 apps/backend/test/*.unit.test.cjs apps/backend/test/onboarding.integration.test.cjs
node --experimental-websocket --env-file=/home/kraken/strength-studio-s2a-verification/test.env --test --test-name-pattern='S1-B1' apps/dashboard/test/catalog.integration.test.cjs
node --experimental-websocket --env-file=/home/kraken/strength-studio-s2a-verification/test.env --test --test-name-pattern='Client browser history' apps/dashboard/test/catalog.integration.test.cjs
```

Browser commands set `STUDIO_TEST_CHROME=/usr/bin/google-chrome`; the build disables
Next telemetry. TypeScript checks construct each configured program and collect
diagnostics without emitting files. Canonical `pnpm verify` and the full Foundation
integration group were not repeated: backend source, schema and migrations are
unchanged; the relevant existing backend/onboarding and Client regressions above
were rerun. The original section H evidence remains distinguishable from these
current checks.

Self-review is limited to the seven correction paths: three Dashboard runtime
files, the onboarding integration suite, the shared Chrome helper's optional
user-gesture argument, this report and the API contract. Incoming business/roadmap
documents and all other prior uncommitted source remain preserved. Branch/HEAD,
refs and other worktrees are unchanged; nothing is staged or committed.

**Correction status:** R01–R03 corrected and locally verified, ready for owner
review. This is not a new independent approval or a production-readiness claim.
Real provider/operations, delivery timeout/key-rotation/crash hardening and the
broader production gates from the review remain outside this authorization. No
remaining R01–R03 blocker was found in correction self-review. No commit, push,
PR, merge, deployment or production operation was performed. Stop for owner review.
