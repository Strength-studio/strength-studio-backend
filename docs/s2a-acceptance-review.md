# S2-A Admin Client onboarding acceptance/readiness review

**28 November delivery update:** [Required human acceptance evidence](s2a-human-acceptance-session.md) is complete: H01-H10 and S01-S11 PASS, with S11 qualified. Formal reviewer/product acceptance remains pending. HA-UI-01 is Low/cosmetic; optional X01-X05 were not completed. Production readiness is not approved or assessed. The owner's later finalization task authorizes a normal commit/push only; earlier prohibitions on those Git actions below describe the historical review scope.

27 November 2026, Africa/Cairo. Historical engineering review of the preserved S2-A checkpoint and the bounded corrections described below. The latest human results and finalization verification are recorded in the linked acceptance evidence.

## 1. Verdict and scope

**READY WITH CONDITIONS** for bounded human acceptance using the isolated local harness and fake delivery only.

No Critical, High or Medium acceptance blocker was identified in this review. One Low audit defect was reproduced and corrected. The setup/proof/password journey, R01-R03 and applicable regressions passed fresh automated checks. The acceptance runner was smoke-tested; services and test databases were cleaned up afterward. A human session must be started by the operator using section 8.

Conditions:

1. Use the disposable loopback environment, test identities and fake inbox below. There is no real sender, production environment or full Client application in this acceptance scope.
2. Review the follow-up audit correction, regression additions and acceptance package alongside the preserved implementation; inspecting only the original implementation commit omits those changes.
3. Before a later PR, explicitly resolve the branch/base presentation issue in section 2 under separate Git authorization. No history rewrite or PR action is performed here.

This is an engineering readiness assessment, not business acceptance, independent security certification, merge approval, real-email readiness or production readiness. Broader recovery, provisioning, mobile, commercial, attendance/ledger and release work is excluded.

## 2. Repository checkpoint and preservation

| Item | Observed state before modification |
|---|---|
| Repository | `Strength-studio/strength-studio-backend` |
| Actual review worktree | `/home/kraken/Programming/Projects/Strength Studio S1-B1` |
| Branch | `codex/s2a-client-onboarding-20261127` |
| HEAD / preserved implementation | `8b4ebc221e3e7cfe1d3dcf1bc7356049e33696f2` |
| Parent | `153690b6954df64ca99114a8bfec91285aad77b2` |
| Intended integration base | Local `main`, tracking `origin/main`, and live remote `main`: `1fb9c220a4f234f3eb21d87019376b95b7635c7a` |
| Live feature remote | `git ls-remote --heads origin ...` returned the exact expected feature SHA; local tracking ref also matched. No fetch/ref mutation needed. |
| PR | Read-only GitHub REST query for all PR states with this repository/head branch returned `[]`. No existing PR found. |
| Index | Empty; no staged changes. |
| Other worktrees | Seven other checkouts; their HEADs, branches, status and tracked/untracked source hashes captured before review. |

The five incoming files were three modified tracked documents (`docs/milestone-2-decision-register.md`, `docs/milestone-3-next-slices.md`, `docs/open-decisions.md`) and two untracked documents (`docs/o02-b-onboarding-decision-closure.md`, `docs/o02-onboarding-decision-review.md`). Their incoming bytes are protected; this review does not edit them. The original `Strength Studio` checkout is a preserved historical booking-fix branch and was not used as the current application baseline.

**Base comparison:** the feature has three commits absent by identity from `main`: the original S1-B1 feature, its post-merge documentation checkpoint and S2-A. S1-B1 was squash-merged; `main` and `4630462f807a9e729e66c0d338d752eb9b1c56ee` have identical trees. Thus the merge-base is older, `8d2803155b1ead4b9063efa412e04b2c331c4a05`. At preserved HEAD, `git diff main...HEAD` shows 47 files (+4,025/-139), including already integrated S1-B1 work. The endpoint-tree comparison `git diff main HEAD` shows 41 files (+3,134/-107): S2-A plus inherited post-merge documentation. The S2-A commit itself has 40 files (+2,886/-94).

This is a Low PR-presentation concern, not a missing S1-B1 implementation or a human-test blocker. Recommend a later explicitly authorized integration preparation from current `main` that preserves the S2-A commit, follow-up changes and five incoming documents, then verifies the intended PR diff. Do not automatically rebase, reset, cherry-pick, commit or open a PR during this task.

## 3. Source authority and chronology

Reviewed directly: README; implementation roadmap; current application inventory/next slices; open-decision index; O-02 in the decision register; O-02-B closure; S2-A implementation/verification/rollback report including section N; implemented API and permission contracts; Prisma schema and migration; onboarding backend, identity/action/command/audit helpers; Dashboard Admin/public routes, UI and browser tests. The 27 November Business Review PDF was cross-checked with its underlying project evidence.

Authority order for this bounded scope:

1. Explicit owner business answers in O-02-A/B/C and O-02-B1-B4 establish manual initial handoff, independent email proof, no identity linking, automatic enablement after proof/password, Admin-only management and numeric issuance rules.
2. The later explicit implementation authorization and implementation checkpoint supersede earlier planning-only restrictions for S2-A. The 15-minute password authorization and 12-256 password range are recorded implementation choices, not newly approved broader recovery policy.
3. Section N and its regression logs supersede the original implementation's claim of no known browser defect. The later Git preservation record supersedes its historical unstaged/uncommitted branch descriptions.
4. Earlier recommendations and broader S2/S3/production questions remain historical or open where not superseded. No wider decision is inferred from the S2-A delivery.

Several older paragraphs still describe onboarding stubs or an uncommitted implementation. They conflict with later factual checkpoints, not with the approved business journey. This report and narrow pointers in README/roadmap/implementation report clarify current status. The five incoming decision documents are retained verbatim. No material unresolved business-policy conflict blocks this isolated acceptance journey.

## 4. Business-contract compliance

| Requirement | Implementation and review evidence | Assessment |
|---|---|---|
| Admin-only invite/status/reissue/revoke | `user.manage` action, Admin-only map; current session checks in guard and command transaction; Admin/actor/CSRF relay | Compliant; denied Staff plus additional Client/Coach checks passed |
| New Client without commerce | Narrow Client-only DB creation, profile and case in one transaction; initial `INVITED`, null credentials | Compliant; no purchase required or created |
| Initial manual, once-disclosed link | First command response only; same-key replay returns stable IDs/expiry without secret | Compliant; uncertain disclosure uses explicit reissue |
| Accept setup without activation | SETUP consumption, pending state and encrypted EMAIL intent commit together | Compliant; no GET transition or pre-ACTIVE session |
| Separate email ownership proof | EMAIL purpose and explicit consumption; email timestamp plus separate password capability | Compliant; remains pending, password still null |
| Password setup and explicit login | Exact PASSWORD purpose; once-only credential DB function; completion/ACTIVE/audit in one transaction | Compliant; credentials cannot overwrite ACTIVE account; login remains separate |
| No identity linking or role change | Global normalized-email uniqueness; conflict on all existing identities, including missing profile | Compliant; expanded collision matrix passed |
| SETUP and EMAIL expiry | `PROOF_MS = 24 * 60 * 60 * 1000`; issued from DB time; post-lock and defensive DB checks | Compliant; expired/reused proofs rejected |
| Password expiry / input | `PASSWORD_MS = 15 * 60 * 1000`; DTO 12-256 characters; no trimming; Argon2id | Compliant; invalid password does not consume authorization |
| Replacement cooldown and ceiling | Latest same-purpose issuance + 60 seconds; fewer than five replacement rows within rolling hour | Compliant; initial issue excluded, suppressed requests do not count |
| Reason and revision | Strict DTO `{expectedRevision, reason}`, transactional current revision and state checks | Compliant; stale/invalid transitions rejected |
| Generic public resend | Same 202 acknowledgement for eligible, absent, ineligible and suppressed cases; 80ms normal-response floor | Compliant for stated disclosure boundary; not constant-time or distributed-abuse assurance |
| Atomic consume / replay / revoke | Exact User lock, reread lifecycle state and DB time; single-use fields, case revision; invalidate descendants | Compliant; concurrency, replay, disable and revocation tests passed |
| Audit | Success mutations and events share transaction; separate rejection transaction after denial | Low early-password rejection gap corrected in this review |
| Queue and transport | Application-owned PostgreSQL intent, authenticated encryption, explicit replaceable transport and fake implementation | Compliant for isolated scope; no real provider or scheduled sender |

## 5. Security review and R01-R03

**Authorization:** signed-in writes recheck live role/session/grants under the existing shared identity/session lock order. Revoked, expired or disabled sessions do not gain authority through command replay. The invitation stub's old Staff binding is explicitly replaced by Admin `user.manage`; Staff Client reads remain. Strict DTOs reject role/state/financial extras. Dashboard relays validate Origin/Host, current Admin, actor, CSRF, payload size and immutable retry intent. Foundation revocation/authorization regressions passed; every possible new onboarding-specific interleaving was not separately enumerated.

**Capabilities:** 32 cryptographically random bytes per secret (256 bits), strict 43-character base64url transport, SHA-256 digest-only challenge persistence. SETUP/EMAIL/PASSWORD purposes are separate; User/case/revision, eligibility, password-null state and authoritative DB time are rechecked after locking. Credential functions perform defensive purpose/expiry/target checks. The expired, consumed, revoked, superseded and wrong-purpose paths fail generically. Concurrent setup/verification/password requests commit once.

**R01:** the relay cookie binds a random non-secret 192-bit flow ID to the HttpOnly password capability. Forms send that ID; a mismatch is rejected before forwarding credentials or clearing the newer flow's cookie. The browser test actually verifies Client A, verifies Client B in a second tab, submits A, checks B still has no password, then completes B and confirms A remains pending. Cookie reuse alone cannot substitute another Client's authority. One browser-wide capability remains an intentional constraint; the superseded tab needs fresh email proof.

**R02:** generic resend only displays a neutral notice; it does not clear proof, form or password cookie. Browser regressions assert retained inputs and successful use of the existing SETUP, EMAIL and PASSWORD authorizations after suppression. Separate assertions prove actual replacement still invalidates older backend capabilities. Public responses never reveal whether issuance occurred.

**R03:** controlled name/email drafts stay in memory through focus/visibility checks; sensitive forms are concealed while authority is checked. The test asserts exact values survive both transitions, then switches to Staff and confirms controls/draft disappear and cannot return merely by restoring the previous cookies. Current Admin checks and retry semantics remain intact.

**Audit:** invitation, email issuance, setup consumption, verification, password completion, account enablement, reissue and revoke have safe events. Audit-failure tests prove creation, verification and activation roll back rather than partially committing. HTTP logs omit bodies/paths/credentials; audit metadata omits raw tokens, passwords, addresses and digests. Input/schema rejection and throttling remain HTTP security outcomes rather than invented domain success events.

**Delivery:** AES-256-GCM uses independent random nonces and challenge-ID authenticated data; wrong key/ID/tampering fail. Key is supplied through validated configuration, never a UI field. Explicit dispatch claims have 30-second fenced leases, bounded batches, eight-attempt ceiling and expiry/invalidation checks. Accepted/invalidated payloads are cleared; untrusted transport errors are discarded. Competing dispatch and retry tests passed. Fake transport is programmatic, with no application debug route or verification-token UI. The new acceptance inbox is an operator-created private file outside the application.

Real transport timeout/cancellation, crash/uncertain-send handling, key rotation, distributed abuse protection, retention and monitoring are production review items. A claimed send may become in-flight before revocation; external recall and exactly-once inbox delivery are not guaranteed. No real adapter exists here, so these do not block this bounded fake-transport run. Production configuration was not inspected.

## 6. Findings, corrections and migration assessment

| Severity / ID | Finding | Disposition |
|---|---|---|
| Critical | None identified in reviewed scope | No claim of exhaustive security certification |
| High | None identified | No known acceptance blocker |
| Medium | None identified | R01-R03 remain corrected and freshly tested |
| Low / AR-01 | Password preflight rejected absent, consumed, revoked, expired or wrong-purpose capabilities before entering `consume`, bypassing `ONBOARDING_REJECTED` audit | Fixed in `OnboardingService.password`; rejection is audited without secret/target invention or expensive hashing. New absent/expired-capability regression failed before fix and passed after. No denial, role or lifecycle policy changed. |
| Low / AR-02 | Older current-facing documentation still said S2-A was uncommitted or only a stub | Added current review pointers and corrected narrow README/roadmap status; retained historical reports and incoming decision bytes |
| Low / AR-03 | Branch has already squash-merged S1-B1 ancestry and a wider three-dot PR diff | Open PR-preparation concern; no Git history action authorized/performed |
| No issue | Core approved journey, flow binding, suppressed resend, draft preservation and identity collision behavior | Source review plus fresh checks support bounded acceptance |

Two backend tests were added: the eight-case collision matrix plus denied Client/Coach management, and the early-password audit regression. The existing R01-R03 browser assertions were inspected, not merely counted.

**Migration:** `20261127000200_client_onboarding` is additive: one purpose enum, audit enum additions, three tables, restrictive references, uniqueness and shape constraints, purpose-current partial index, narrow update privileges and three qualified SECURITY DEFINER identity functions with pinned search path and PUBLIC execution revoked. No existing applied migration was edited. Runtime cannot generally insert identities, change passwords or rewrite challenge facts; negative privilege tests passed. New schema and migration ordering validated on PostgreSQL 17.10.

Fresh Foundation databases successfully applied all 17 migrations. A separate disposable upgrade check applied the 16 migrations/schema from merged `main`, inserted an existing identity/profile, applied S2-A, proved the existing record/profile unchanged and no onboarding backfill, then repeated deploy with no pending migration. Its database was dropped. This establishes the rehearsed local upgrade path, not a production data census or authorization.

Rollback remains application-first: stop initiation/dispatch, preserve new identities, legitimate credentials, history, audit and additive schema; review old audit-reader compatibility and any explicit privilege withdrawal. Do not delete accounts, drop history, reset migration records or resurrect revoked capabilities. No destructive rollback or production migration was executed.

## 7. Engineering verification — 27 November 2026

Pinned Node 22.23.5, pnpm 10.34.9, Prisma 6.19.3, PostgreSQL 17.10 and Chrome 158.0.8127.88. The owner URL and runtime URL were checked before DB operations: `127.0.0.1:55439`, template `strength_studio`, runtime `studio_api`; SQL verified data directory `/home/kraken/strength-studio-s2a-verification/pgdata`, port/version, 17 finished migrations and zero template users. Suites use random disposable databases; no existing development/production DB was migrated.

Logs and manifests: `/home/kraken/strength-studio-s2a-acceptance-review-20261127/`.

| Executed in the 27 November engineering review | Pass | Fail | Skip | Evidence / distinction |
|---|---:|---:|---:|---|
| Initial complete backend run at preserved implementation | 132 | 0 | 0 | `logs/backend.log`; 13 unit + 107 Foundation + 12 onboarding |
| New audit regression before runtime fix | 0 | 1 | 0 | `logs/audit-before.log`; expected reproduction, missing event (`0 !== 1`) |
| Corrected backend unit + onboarding run | 27 | 0 | 0 | `logs/backend-onboarding-after.log`; 13 unit + 14 onboarding |
| Final complete backend run after fix | 134 | 0 | 0 | `logs/backend-final.log`; 13 unit + 107 Foundation + 14 onboarding |
| Dashboard onboarding / real Chrome | 11 | 0 | 0 | `logs/dashboard-onboarding.log`; includes R01-R03 |
| Client maintenance / relay / Chrome | 7 | 0 | 0 | `logs/client-maintenance.log`; fresh selected process |
| Client-history Chrome | 8 | 0 | 0 | `logs/client-history.log`; fresh selected process |
| Both app builds; final backend rebuild | Passed | 0 | n/a | `logs/build.log`, `logs/backend-build-after.log` |
| Both TypeScript programs, no emit | Passed | 0 | n/a | No diagnostics; final `logs/static-final.log` |
| Prisma generate / validate; OpenAPI regeneration | Passed | 0 | n/a | Snapshot byte-identical; SHA-256 `ec57d8495f3d7157e8133879e56eab78eb124eae5e755650136d5b58cadf7973` |
| Main-schema upgrade and repeat deployment | Passed | 0 | n/a | `logs/migration-upgrade.log`; own database cleaned |
| Acceptance runner smoke | 12 checks | 0 | 0 | `runner-smoke.json`; target refusal, permissions, journey, fake inbox, login, expiry fixture, quit and SIGINT/SIGTERM cleanup |
| Diff whitespace and preservation | Passed | 0 | n/a | `git diff --check`; final integrity manifest |

Overlapping runs are not a unique-test total. The final automated suites comprise 134 backend plus 26 selected Dashboard tests. No skipped test is counted as passing. `pnpm verify` was not invoked as an umbrella command because its integration script loads repository `.env`; its generation/build/unit/backend-integration components were explicitly executed with the private test environment. No current S2-A GitHub CI run is claimed; historical merged S1-B1 CI remains separate evidence.

Commands, from the S1-B1 worktree with the pinned toolchain on PATH:

```sh
pnpm db:generate
NEXT_TELEMETRY_DISABLED=1 pnpm build
node --env-file=/home/kraken/strength-studio-s2a-verification/test.env --test --test-concurrency=1 apps/backend/test/*.unit.test.cjs apps/backend/test/*.integration.test.cjs
pnpm --filter @strength-studio/backend build
node --env-file=/home/kraken/strength-studio-s2a-verification/test.env --test --test-concurrency=1 apps/backend/test/*.unit.test.cjs apps/backend/test/onboarding.integration.test.cjs
STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --env-file=/home/kraken/strength-studio-s2a-verification/test.env --test apps/dashboard/test/onboarding.integration.test.cjs
STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --env-file=/home/kraken/strength-studio-s2a-verification/test.env --test --test-name-pattern='S1-B1' apps/dashboard/test/catalog.integration.test.cjs
STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --env-file=/home/kraken/strength-studio-s2a-verification/test.env --test --test-name-pattern='Client browser history' apps/dashboard/test/catalog.integration.test.cjs
node --env-file=/home/kraken/strength-studio-s2a-verification/test.env apps/backend/node_modules/prisma/build/index.js validate --schema apps/backend/prisma/schema.prisma
node apps/backend/dist/openapi.js
git diff --check
```

Additional operator scripts under the evidence directory: `check-upgrade.cjs`, `smoke-runner.cjs` and `static-checks.cjs`. The last creates both configured TypeScript programs with `noEmit` and compares regenerated OpenAPI bytes. Schema tooling may say it loaded `.env`, but explicitly supplied process DB URLs take precedence; target SQL and command assertions established the disposable destination.

Not executed: real SMTP, provider operations, human business acceptance, mobile, distributed load, production migration/bootstrap/deployment, backup/restore and destructive rollback. Unrelated Dashboard commercial/scheduling/attendance browser groups and the full non-browser Dashboard integration run were not repeated. Their previous evidence is historical only; changed runtime is restricted to password-rejection audit.

## 8. Human acceptance environment

### Operator setup

The harness is [scripts/s2a-acceptance.cjs](../scripts/s2a-acceptance.cjs), outside application runtime. It requires a built backend and Dashboard, pinned Node/pnpm, Chrome, and an empty migrated disposable PostgreSQL template. It creates its own random `studio_s2a_acceptance_*` database, test-only Admin/Staff, fresh keys, loopback API, production-built local Dashboard and manual fake dispatcher. There is no Redis, SMTP service or provider to configure.

For this machine, use the previously verified test environment and cluster only. Start the stopped task-owned cluster and build/start the runner:

```sh
cd '/home/kraken/Programming/Projects/Strength Studio S1-B1'
export PATH=/home/kraken/strength-studio-acceptance/pr3-20261124-acceptance/toolchain/node-v22.23.5-linux-x64/bin:/home/kraken/strength-studio-acceptance/pr3-20261124-acceptance/toolchain/bin:$PATH
/home/kraken/strength-studio-acceptance/pr3-20261124-acceptance/toolchain/postgres/usr/lib/postgresql/17/bin/pg_ctl -D /home/kraken/strength-studio-s2a-verification/pgdata -l /home/kraken/strength-studio-s2a-acceptance-review-20261127/logs/human-postgres.log -o '-h 127.0.0.1 -p 55439 -k /home/kraken/strength-studio-s2a-verification/socket -c jit=off' -w start
NEXT_TELEMETRY_DISABLED=1 pnpm build
node --env-file=/home/kraken/strength-studio-s2a-verification/test.env scripts/s2a-acceptance.cjs --data-directory /home/kraken/strength-studio-s2a-verification/pgdata
```

If that selected cluster is already running, verify the same target rather than start another copy. The runner rejects another data directory, non-loopback/default-port targets, wrong template/runtime role and nonempty template. Do not substitute a production or ordinary development environment. On another machine, an operator must provision and verify an equivalent empty disposable template with project roles and migrations, then explicitly select its physical data directory. The runner itself performs no migration on the template.

The console prints a random Dashboard URL and private run folder. Open `accounts.txt` locally for the generated Admin and Staff password; do not copy it into the review report. Both emails end in `@s2a-acceptance.example.invalid`; Staff have `client.manage` reads. Admin and Client use separate Chrome profiles (or normal/incognito sessions); use two tabs in one Client profile only for R01. Keep the runner terminal open.

Use test Client emails `client-a`, `client-b`, `expired-setup`, `expired-email`, `expired-password`, `quota`, `revoked` and `duplicate`, each at `@s2a-acceptance.example.invalid`. Create them through the Admin UI when needed. They are fixtures, not real inboxes or production identities. The reviewer chooses a test Client password of 12-256 characters.

### Safe fake delivery and operator controls

After accepting a setup link, type `deliver` in the runner terminal. It explicitly dispatches through `FakeVerificationTransport`, then writes `inbox.html` in the private run folder (directory 0700; files 0600). Open/reload that local file and choose the matching test email's latest link in the Client browser profile. It captures test capabilities intentionally; do not publish, screenshot or attach its raw links. Provider acceptance in this test means fake capture only, never real delivery or ownership proof.

Other commands:

```text
status
status client-a@s2a-acceptance.example.invalid
expire expired-setup@s2a-acceptance.example.invalid SETUP
expire expired-email@s2a-acceptance.example.invalid EMAIL
expire expired-password@s2a-acceptance.example.invalid PASSWORD
age quota@s2a-acceptance.example.invalid SETUP
age client-b@s2a-acceptance.example.invalid EMAIL
quit
```

`status` prints only test identity/state/revision/completion evidence, not passwords/proofs. `expire` ages only a live proof for the named unfinished test Client; `age` moves its issuance timestamps back 61 seconds to exercise cooldown/replacement tests promptly. These are explicitly simulated test clocks, not a change to application policy. Use an untouched fixture for each edge case. A successful resend cannot be inferred from its public acknowledgement; inspect new fake capture and final authorization behavior instead.

### Cleanup and restart

Type `quit` or Ctrl+C and wait for the cleanup message. The runner stops its Dashboard/API, disconnects, drops only the database it successfully created in this process, and replaces the fake inbox/account files with closed-run notices. A fresh runner invocation creates a new independent test run; do not reset the shared template or delete existing identities to retry a scenario. The empty template and its original migrations are retained.

After all runners/tests have stopped, the operator may stop this same task-owned cluster with `pg_ctl -D /home/kraken/strength-studio-s2a-verification/pgdata -m fast -w stop` using the same full binary path above. Do not stop another cluster. If the runner is forcibly killed or the machine crashes, preserve `run.json` and ask the operator to verify and remove only that exact random run database; no broad wildcard cleanup or credential reuse. Temporary run folders contain test artifacts only; normal shutdown clears capabilities and credentials, and the remaining evidence may be removed after reviewer sign-off.

## 9. Human acceptance checklist

Allow approximately 10-15 minutes for operator setup, 20-30 minutes for the essential journey, and 20-30 minutes for critical negatives. Optional extended checks add 15-25 minutes. Estimates exclude environment repair; they are not delivery commitments. Record actual results and safe evidence per case.

### Essential acceptance: one new Client

| ID / actor | Action | Expected result and observable pass criterion |
|---|---|---|
| H01 Admin | Sign in, open Clients, choose Invite Client; enter `client-a` test name/email | Invitation succeeds once; profile/runner status is INVITED, no credentials or commerce prerequisite |
| H02 Admin | Copy the manual setup link before leaving or changing focus; hand it to the Client reviewer privately | A single initial disclosure with expiry; ordinary profile/status never rediscloses it. Capture only a redacted screenshot if needed |
| H03 Client | Open the link in separate Client profile | Page opens without sending; URL fragment disappears; explicit Send verification email remains necessary |
| H04 Client | Click Send verification email | Generic queued notice; Admin refresh/runner status shows PENDING_VERIFICATION; account is not enabled |
| H05 Operator / Client | Type `deliver`; open/reload private fake inbox, choose this Client's newest email link | Separate email proof is available; no real mail sent. Merely opening it does not verify |
| H06 Client | Click Verify email | Password page opens; Admin shows email verified/password pending; runner shows verified timestamp and still PENDING_VERIFICATION |
| H07 Client | Enter valid new test password; Complete setup | Success says account active; runner shows ACTIVE/completed. No automatic sign-in; no payment/Membership created |
| H08 Client | Choose Sign in; submit this email/password explicitly | Signed-in landing identifies the correct Client role/email; no Admin workspace appears |
| H09 Client | Reload the signed-in landing; try opening `/clients/new` | Own signed-in landing remains usable; Admin invitation is denied. This is the bounded Client page; a Client profile/mobile application is not delivered |
| H10 Admin | Open this Client profile; Refresh onboarding, compare runner `status` | Onboarding completed and matching identity. Record case IDs, observed state and reviewer result without secrets |

### Security-critical acceptance

| ID | Reviewer action / operator fixture | Pass criterion |
|---|---|---|
| S01 Duplicate collision | Admin attempts `client-a` again with email case changed and surrounding spaces | Bounded identity conflict; original Client/name/credentials remain; original login works. Other-role/disabled/unverified collisions have automated matrix coverage |
| S02 Unauthorized management | Sign in as fixture Staff; browse Clients and attempt `/clients/new` / onboarding controls. Use the signed-in Client to attempt the same page | Staff reads retained; neither Staff nor Client can create/reissue/revoke. API denials for Staff/Client/Coach are automated evidence |
| S03 Reuse setup/email | Retain the private original links; open each in a fresh tab after its successful consumption and explicitly submit | Invalid/used/expired denial; no second transition or password authorization |
| S04 Expired setup | Create `expired-setup`; operator expires SETUP before first use, then Client submits saved link | Generic denial; Client remains INVITED; no email intent/account activation |
| S05 Expired email | Create/accept `expired-email`, deliver and retain link; operator expires EMAIL, then Client verifies | Generic denial; remains pending, unverified; no password access |
| S06 Wrong-flow password / R01 | Create fresh `flow-a` and `flow-b` test Clients. In one Client profile, leave A's pending password form in tab A, verify B in tab B, then submit A | A reports invalid authorization; neither A nor B receives A's password. Complete B using B's form, then confirm only B activated. Use these fresh Clients rather than the completed H01 fixture |
| S07 Reissue cooldown | Create `quota`; inspect immediate disabled reissue; after 60 real seconds or one operator `age ... SETUP`, reissue with reason | Replacement succeeds only after cooldown; revision advances; old link fails and new link works. Empty reason prevented; stale revision rejection is automated |
| S08 Revoke | Create `revoked`, accept/deliver/verify to password pending; Admin revokes with reason; Client submits password | Revoked status; password fails, account remains pending and cannot sign in. No restart/reactivation inferred |
| S09 Password validation | At a fresh password stage try fewer than 12 characters; then submit a valid password | Short input prevented/rejected; current live authorization remains usable. Existing 12-256 server validation is also automated |
| S10 Suppressed resend / R02 | Immediately request another verification email while proof is within cooldown; repeat during password stage with password entered, and on unused setup page | Same neutral notice; no eligibility claim. Form/password values and current proof remain usable; no replacement fake message. Do not wait past cooldown for the suppression case |
| S11 Admin draft / R03 | Enter unsaved invitation name/email; switch focus away/back and hide/show tab, then change authenticated identity to Staff and refresh/focus | Draft retained for same Admin; concealed during access check; no draft or invitation control exposed after identity change |

For S06 the operator/reviewer must prepare two fresh password-pending Clients; the H01 Client is already completed. A mismatched old tab cannot recover its authorization by reload; it needs a fresh eligible email proof. For S10 at unused setup, resend is ineligible until setup is accepted; the original setup must still work.

### Optional extended acceptance

| ID | Test | Pass criterion |
|---|---|---|
| X01 Replacement ceiling | Create a fresh `quota-limit` fixture; issue five replacements, aging SETUP or waiting 60 seconds before each; try a sixth after cooldown within same hour | Sixth blocked without new disclosure/revision. Initial issuance excluded. Backend independently covers EMAIL replacement ceiling |
| X02 Expired password | Operator expires PASSWORD after verifying `expired-password`; Client submits valid password | Generic denial; pending account/password unchanged; obtain fresh email proof to continue |
| X03 Actual resend supersession | After email cooldown, request resend, type `deliver`, attempt old email/password authorization, then use newest proof | Old authority fails; new proof can complete; generic acknowledgement still does not identify issuance |
| X04 Password maximum | Paste more than 256 characters into a fresh password input; optionally test 256-character valid password | UI caps/prevents excessive length; server rejects invalid direct payload. Do not capture the password in evidence |
| X05 Disclosure/history | Hide link, navigate away/back; reload public password page; inspect ordinary profile and browser-readable storage | Initial link stays hidden; reload retains only non-secret flow association; no raw proof/password authorization in ordinary HTML/storage/history |

### Acceptance criteria and record

All H01-H10 and S01-S11 must pass with named reviewer/date and observed evidence. X cases are optional for the bounded meeting; their relevant server/browser guarantees have automated evidence and should not be silently marked manually passed. Any wrong identity, unauthorized write, premature activation, reusable proof, credential overwrite or secret exposure fails acceptance and stops that scenario. Record the defect and preserve safe evidence; do not compensate with manual identity edits.

Use this meeting record (blank until a human runs it):

| Field | Reviewer entry |
|---|---|
| Reviewer / operator / date | Not yet assigned / executed |
| Feature SHA and uncommitted review patch used | Record exact checkout and diff |
| Run manifest / test origin | Record private `run.json` location; no passwords/tokens |
| Essential H01-H10 | Not executed by human |
| Critical S01-S11 | Not executed by human |
| Optional X01-X05 | Not executed by human; select or defer explicitly |
| Defects / evidence | Record safe case IDs, request IDs and redacted screenshots |
| Business result | Pending: accepted, changes requested or retest required |
| Cleanup confirmed | Pending operator confirmation |

## 10. Next action and retained boundaries

Run the above bounded human session with the responsible business reviewer and technical operator. If accepted, obtain separate authorization to preserve the follow-up changes and prepare a main-based PR with the intended diff. PR review, merge and eventual delivery/release work remain separate stages. No unrelated feature should start automatically.

Real-email delivery, production Admin bootstrap/recovery, retention/key custody, operational ownership, backup/restore/release evidence and initial go-live remain open. No full-platform Usage Testing Ready or Production Ready claim is made.

This review creates the acceptance report and local-only harness, corrects AR-01, expands regression coverage, and adds narrow current-status references. No commit, push, PR creation, merge, rebase, deployment, production migration/configuration/account or real email occurred. Incoming document bytes and other worktrees remain preserved; final verification evidence is retained outside the repository.
