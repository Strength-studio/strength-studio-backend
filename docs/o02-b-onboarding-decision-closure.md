# O-02-B remaining onboarding decision closure

**Later S2-A implementation:** [Current implementation and verification](s2a-onboarding-implementation.md) supersedes this document's earlier planning-only readiness for the bounded slice. Historical approvals/proposals below are preserved; broader S2 and production gates remain.

27 November 2026, Africa/Cairo. Documentation/decision checkpoint only.
**S2-A planning: READY FOR S2-A IMPLEMENTATION PLAN**, limited to an isolated,
fake-transport development scope. Implementation and production are not ready or
authorized. This document records new owner answers and the remaining technical/
release gates; it does not start the next planning task or implement any flow.

Naming: this task's O-02-B1–B5 IDs are follow-up work packages. They do not rename
the earlier **O-02-B** approval of automatic enablement. The
[original review](o02-onboarding-decision-review.md) and
[canonical O-02 register](milestone-2-decision-register.md#o-02) retain their history.
This checkpoint updates readiness and refines proposals; only explicitly recorded
owner answers are APPROVED. All future routes/models below are NOT IMPLEMENTED.

## 1. Repository state before and after

Repository: `Strength-studio/strength-studio-backend`; review worktree:
`/home/kraken/Programming/Projects/Strength Studio S1-B1`.
Branch: `codex/s1b1-client-profile-maintenance-20261127`.
HEAD before and after: `153690b6954df64ca99114a8bfec91285aad77b2`.
Local `main` and local `origin/main`: `1fb9c220a4f234f3eb21d87019376b95b7635c7a`.
No fetch or remote mutation was needed; live GitHub state was not reverified here.

Incoming state exactly matched the previous checkpoint: three modified tracked
documents (`milestone-2-decision-register.md`, `open-decisions.md`,
`milestone-3-next-slices.md`) plus untracked `o02-onboarding-decision-review.md`.
All are under `docs/`. Their full incoming contents, all tracked/untracked file
hashes, refs and eight worktree states were captured before editing. Incoming
content is retained; this task adds dated cross-references and this focused report.
No ownership/state ambiguity or unexpected implementation change was discovered.
Final state adds this untracked report; nothing is staged or committed.

## 2. Approved direction and newly recorded answers

The task expressly reconfirms these APPROVED boundaries: Admin manually shares
the initial single-use link; the app need not deliver it; separate email proof is
mandatory; email proof plus password setup automatically enables access without
Membership/payment/package prerequisites; first invitation/onboarding management
is Admin-only and existing Staff reads remain.

The owner supplied these additional answers during this checkpoint:

| Evidence / ID | Status | Exact selected policy or direction | What it does not approve |
|---|---|---|---|
| B1 duplicate question | APPROVED | No automatic merge/link or credential overwrite; duplicate Admin creation receives a bounded conflict; an existing invited Client uses explicit reissue; public requests reveal no account state. | No identity repair, role conversion, email change or reactivation authority. |
| B2/B3 numeric question | APPROVED | Setup link 24 hours; email-proof link 24 hours; resend cooldown 60 seconds and at most 5 per recipient/purpose/hour. | No password-setup ticket TTL, new-password policy, network/global cap, SMTP retry schedule or reset policy was approved by this answer. |
| B3 step-boundary question | APPROVED direction | Commit email proof separately, then password setup, using a short-lived single-use password-setup authorization; neither step alone allows login. Owner explicitly leaves ticket details for later review. | Does not approve a normal login session before ACTIVE, a reusable proof, or the old combined proof+password DTO. |
| B4 planning-boundary question | APPROVED | A later S2-A plan may specify an app-owned durable email-proof queue and replaceable adapter, using fake transport in isolated tests; real sender/secrets/provider activation and named operations remain production gates. Retain existing O-11 provider direction. | No provider selection/configuration, real mail sending, implementation or production approval. |
| B5 production Admin bootstrap | UNRESOLVED | No bootstrap operator/process was newly approved; existing verified-email Admin recovery direction remains. | No reuse of development seed in production. |

The existing O-11 target is Hostinger SMTP behind a replaceable interface. This
review does not select another provider or assert that Hostinger is configured.
Names and access credentials for real operations are not inferred from an app role.

## 3. Evidence reviewed: implementation versus proposals

| Evidence | Actual finding / classification |
|---|---|
| [Prisma schema](../apps/backend/prisma/schema.prisma), User/ClientProfile/AuthToken/AuthSession | IMPLEMENTED persistence: globally unique normalizedEmail text, single User role, ClientProfile PK/FK to User; no phone or standalone Client entity; INVITED/PENDING_VERIFICATION/ACTIVE/DISABLED; token digest/purpose/expiry/consumedAt. No onboarding-case/version, token revocation field or PASSWORD_SETUP purpose. |
| [Foundation SQL](../apps/backend/prisma/migrations/20261104000100_foundation/migration.sql) and [S1-B1 SQL](../apps/backend/prisma/migrations/20261127000100_client_profile_maintenance/migration.sql) | IMPLEMENTED constraints/grants: restrictive User/profile FK; unique email; sessionless INVITE/VERIFY_EMAIL/PASSWORD_RESET; session-bound REFRESH/SOCKET. Ordinary API lacks identity INSERT/password/verification UPDATE; S1-B1 adds only displayName privilege. No SQL executed here. |
| [Identity controller](../apps/backend/src/identity/identity.controller.ts), [DTOs](../apps/backend/src/identity/identity.dto.ts), [permissions](../apps/backend/src/identity/permissions.ts), [OpenAPI](../packages/api-contract/openapi.json) | IMPLEMENTED stubs: register/verify-email/reset-password return ONBOARDING_POLICY_PENDING. Invite validates email/name but uses client.manage, so granted Staff reach the stub; no account created. Owner's Admin-only target must explicitly replace that binding later. No setup-password/reissue/revoke consumer is implemented. |
| [Sessions](../apps/backend/src/identity/session.service.ts) and [password hashing](../apps/backend/src/identity/password.ts) | IMPLEMENTED active+verified access checks, password verification, trim/lower email lookup, identity/session locks, refresh rotation/replay and socket tickets. Existing token helpers require a session and cannot directly handle onboarding proof. Argon2id already used; no new algorithm proposed. |
| [Commands](../apps/backend/src/platform/commands.ts), [database](../apps/backend/src/platform/database.ts), [audit](../apps/backend/src/platform/audit.ts) | IMPLEMENTED signed-in actor retry scope, transactional audit/reference, bounded DB retry and clock. Public onboarding cannot fabricate an active actor. Audit schema allows null actor, helper does not; onboarding action enums/failure attribution need later review. |
| [Client service](../apps/backend/src/clients/client.service.ts), [controller](../apps/backend/src/clients/client.controller.ts), [profile editor](../apps/dashboard/app/clients/profile-editor.tsx) | IMPLEMENTED reads, Admin displayName write and explicit existing disablement. No creation/linking/email correction; queries require CLIENT role plus profile. No implied phone or orphan repair. |
| [Dashboard session handler](../apps/dashboard/app/api/session/[action]/route.ts), [session helpers](../apps/dashboard/lib/session.ts), [Client write relay](../apps/dashboard/lib/client-write-relay.ts), [API relay](../apps/dashboard/app/api/studio/v1/[...path]/route.ts), Client pages | IMPLEMENTED login/refresh/logout and bounded allowlists; current CSRF assumes refresh cookie. No public onboarding surface or setup browser authorization. Current /users allowlist does not forward invitations. |
| [Backend package](../apps/backend/package.json), source inventory, [.env.example](../.env.example), [Compose](../compose.dev.yml), [local roles](../infra/postgres/01-local-roles.sh) | No committed SMTP/mail adapter/outbox/queue worker or Redis/BullMQ dependency/service found. studio_worker is a NOLOGIN placeholder. Socket access invalidation is not email delivery. Private env/secrets and external dashboards were not inspected; external configuration is UNKNOWN, not proven absent. |
| [Local seed](../apps/backend/src/local-seed.ts), [README local setup](../README.md#local-setup) | IMPLEMENTED development-only loopback Admin fixture, supplied email/password, verified/ACTIVE at creation. No production bootstrap command, approval workflow or runbook exists. Local fixture verification timestamp is not a production email-proof process. |
| [Architecture deployment/security](architecture-review.md#deployment-and-security), [architecture decisions](architecture-decisions.md), [O-11–O-14](milestone-2-decision-register.md#o-11) | DOCUMENTED future queue/outbox/lease, encrypted temporary mail secrets, replaceable Hostinger adapter, monitoring and release direction. These are not running infrastructure. Provider credentials, sender/domain, custody and operators remain gates. |
| [Backend integration tests](../apps/backend/test/foundation.integration.test.cjs), [security units](../apps/backend/test/security.unit.test.cjs), [Dashboard tests](../apps/dashboard/test/catalog.integration.test.cjs) | Existing denied-login, scoped reads, Staff stub binding, revocation, audit rollback, S1-B1 retry/draft/account-switch cases inspected. These do not prove new onboarding behavior; no suite executed here. |
| [Business rules](business-rules.md#shared-command-transaction), [permission matrix](permission-matrix.md#resource-scope), [API contract](api-contract.md#routing-and-credentials), [decision index](open-decisions.md), [S2 plan](milestone-3-next-slices.md#s2--client-account-setup-and-recovery), prior review | EXISTING POLICY and dated proposals distinguished. No approved boundary is reopened. |

## 4. O-02-B1 — duplicate and identity resolution

The no-automatic-linking rule is APPROVED. The following matrix specifies its
proposed application to each scenario; individual error/audit mechanics are not
claimed implemented. Same email identifies a collision, not proof authorizing a
merge. Successful proof authorizes only its already-bound target, never another User.

| Scenario | Classification | Allowed/rejected; intervention/linking | Retry / disclosure / audit contract |
|---|---|---|---|
| Existing CLIENT User+profile, same normalized email | APPROVED rule; PROPOSED response | Reject another creation. No overwrite or implicit invitation. Existing INVITED record can use explicit Admin reissue; ACTIVE uses existing login, not setup. | Same valid creation key replays original issuance reference; different key gets bounded conflict. No other-role/credential details. Actual creation/reissue audited separately; rejected attempt uses bounded security outcome below. |
| Existing User of another role, same email | APPROVED no-link rule | Reject; never add ClientProfile or change role. No invitation grants Staff/Coach/Admin conversion. | Bounded conflict without role/target IDs in creation response; public generic acknowledgement. No success audit/idempotency claim for rejected creation. |
| Client without User | EXISTING POLICY: impossible through current FK | No supported local record shape; external/imported business contact is outside S2-A. Do not claim such an orphan exists. | Report externally discovered anomaly through separate review, never fabricate a User link. No DB census performed here. |
| CLIENT User without ClientProfile | EXISTING schema permits it; PROPOSED safe handling | Reject onboarding creation/claim as conflict; no automatic profile repair. Admin/technical support review separately. | Do not expose anomaly to public caller or treat it as a normal fresh Client. Redacted intervention/conflict evidence. |
| Multiple emails differing only in case/outer spaces | EXISTING login convention; PROPOSED writer enforcement | Apply current trim+lower normalization before lookup/unique insertion. DB unique text itself is case-sensitive; new writers must not assume DB normalization. | Concurrent same normalized email: unique constraint permits one creation, other gets replay/conflict. Future upgrade census required before strengthening DB checks. |
| Provider aliases, plus addressing, dots, similar names | PROPOSED | No provider-specific email rewriting or name-based identity matching. Existing explicit normalized string convention only. | No merge based on similarity. Further internationalized-email/alias support requires contract review. |
| Same phone number | EXISTING model: no phone field | No phone lookup/dedup/proof/linking in S2-A. | No invented phone validation, uniqueness or audit payload. |
| Admin accidental double submission | APPROVED duplicate rule; EXISTING retry pattern | Same immutable key/body returns original issuance. Different key cannot create duplicate User/profile. | Recheck current Admin authority even on replay; changed body/key conflict. Exactly one creation audit; no extra link/email automatically. |
| Explicit manual-link reissue while INVITED | APPROVED reissue direction; PROPOSED mechanics | Same User/case only; atomically replace proof and invalidate predecessor. No second identity. | New reissue operation/key; current authority, revision and rate checks. Replays do not reissue again. Audit old/new safe challenge IDs and reason. |
| Client has several copies of links | APPROVED single use; PROPOSED generation invariant | Copies of current link refer to one credential. After replacement, only current generation valid. | Old links fail generic challenge error. Copying/opening is not consumption. |
| Different onboarding path after Admin creation | APPROVED no automatic linking; PROPOSED compatibility | Future public registration must not overwrite or claim by email match; same generic acknowledgement, existing approved setup/recovery flow. | No new role/profile/password and no unrequested repeated email. Self-registration remains a stub in S2-A. |
| Existing DISABLED or already ACTIVE account | EXISTING access policy; APPROVED no-link rule | No setup-driven reactivation or password replacement. ACTIVE logs in; DISABLED needs separately approved lifecycle review. | Generic public error/ack; no token issuance granting access; preserve identity/business records. |

Successful command audits are transactional. A rejected duplicate must not append
a fictitious creation event or lose required rejection evidence because an exception
rolled back its transaction. PROPOSED planning requirement: bounded, redacted
security outcome after the rejected domain transaction (or a separately modeled
denied outcome), keyed by request/correlation ID and actor. Unknown/unvalidated
targets must not be assigned arbitrary User/audit target IDs. No email/password/
token body in rejection telemetry; retention and flood limits need review.

## 5. O-02-B2 — manual setup-link lifecycle

APPROVED: initial link is manually shared, single use, 24-hour expiry; explicit
reissue uses the existing invited Client; 60-second cooldown and at most 5 per
recipient/purpose/hour. PROPOSED timing interpretation: expiry measured from durable
issuance, not handoff/open; expiresAt <= post-lock database time is invalid.
New issuance never extends a predecessor. Numeric HTTP retry/abuse/provider limits
must not be inferred from this resend approval.

The approved resend limits concern replacement proof issuance, not same-key HTTP
replay or retrying delivery of the same live email credential. Whether initial
issuance also counts toward the same budget and exact rolling-window semantics
are technical policy details to freeze in the next plan, not additional approvals
invented here. Password authorization has no independent public resend endpoint;
recovery of an interrupted handoff requires fresh email proof under the reviewed rules.

| Case | Proposed result and invariants |
|---|---|
| 1. Admin creates invitation | Admin-only command atomically creates CLIENT User+profile in INVITED, onboarding case/issuance, INVITE digest, audit and retry reference. No email of initial link. Raw link only in authorized first-execution response; no credentials established. |
| 2. Admin shares link | Manual responsibility outside app. UI copy/handoff is not proof of delivery or email ownership; app does not claim an external handoff succeeded. No automatic third-party message sent by this task or proposed API. |
| 3. Client opens link | GET renders only; no consumption/state change/provider send. Explicit POST proves possession and atomically enters PENDING_VERIFICATION, consumes INVITE and creates separate emailed-proof intent. |
| 4. Repeated opens | No change until explicit consume. Subsequent consumed-token POST is generic invalid/used response with no second proof/send; safe UI recovery below. |
| 5. Expired initial link | Reject without transition, credentials, email or access. Admin explicitly reissues current INVITED case after reviewed checks. No account deletion or fresh identity. |
| 6–7. Replacement and use of predecessor | Under target/case lock, revoke old INVITE and issue a new current generation. Predecessor is invalid even before original expiry. Only one unsuperseded INVITE per case/stage. |
| 8–9. Successful final setup / repeated setup | Final password transaction consumes its separate authorization, marks case complete and User ACTIVE, revokes outstanding onboarding credentials. Old setup/verification/password tickets cannot reset credentials. Explicit login is separate. |
| 10. Revoked invitation | Proposed Admin reasoned case-revocation command invalidates the whole unfinished chain, including already-issued VERIFY_EMAIL/password authorization. Revoking only a consumed INVITE would be insufficient. No auto-disable of an already ACTIVE account; existing disable command handles that separately. |
| 11. Interrupted process | Before INVITE consume: retry still-live link. After it: use separate email proof/resend. After email proof: resume only with live password authorization, otherwise request fresh email proof. No recovery from email match alone. |
| 12. Concurrent consume/reissue/revoke | Serialize on exact User/case, then tokens in shared order, re-read current generation/state/expiry. One consume or replacement wins; losers cannot queue extra proof, enable or resurrect old tokens. |

PROPOSED credential properties: use current 32-random-byte/base64url style with
unique digest; opaque token carries no email, role or permissions. Store digest
and safe issuance metadata; no plaintext manual secret in persistent database,
logs, audit, analytics, browser history URL query or persistent browser storage.
Use a reviewed fragment/POST browser handoff, no-referrer/no-store and no third-party
resources. Authenticated reveal obeys current Origin/Host/CSRF/actor controls.

The previous one-time disclosure proposal remains for plan review: first executed
issuance can reveal the raw link to current Admin; same-key replay returns stable
issuance IDs/expiry but **no secret redisclosure**. Lost first response requires
explicit replacement, not another Client creation. This is a documented response
variation, not a claim of byte-identical response replay. Keep issuance references
at least through the retry window. No actual disclosure/reissue API exists now.

PROPOSED case-revocation semantics: terminal for that unfinished case; preserve
User/profile, proof history and business references. A restart of a revoked case,
email correction or support repair remains excluded pending separate policy;
ordinary reissue cannot undo revocation. Do not overload DISABLED or invent a
User REVOKED state solely for an invitation. A reviewed case status/generation can
represent revocation independently of User access.

## 6. O-02-B3 — separate email proof, then password setup

APPROVED: emailed proof is separate from initial manual link; email-proof TTL
24 hours; selected resend cooldown/rate; **email proof and password setup commit
as separate steps**, using a short-lived single-use password-setup authorization.

This supersedes the prior review's PROPOSED combined
`POST /auth/verify-email {token,password}` contract. It changes no implemented API
and does not reopen automatic enablement: access remains unavailable until both
separate requirements are completed.

### Mechanism boundaries and relationship

1. INVITE proves possession of Admin's manually shared invitation only. After its
   successful POST, issue a different VERIFY_EMAIL credential to the stored exact
   address through the durable email intent. No password or verified timestamp yet.
2. VERIFY_EMAIL proves the mailbox for that already-bound User/case/generation.
   Explicit POST consumes it, records immutable proof/email snapshot and verifies
   the address, while User remains PENDING_VERIFICATION. Issue a new distinct
   PASSWORD_SETUP authorization; no ordinary AuthSession, bearer or refresh token.
3. PASSWORD_SETUP authorizes only establishing the password for that verified,
   unfinished case. Valid password submission atomically consumes it, stores the
   hash, enables ACTIVE, completes the case, appends audit and revokes sibling
   onboarding credentials. No Membership/payment checks or mutations.
4. The initial link's later expiry is irrelevant once legitimately consumed into
   the next stage. Likewise a consumed email challenge does not need to remain
   unexpired during an independently valid password-authorization window. A
   revoked/superseded/disabled case always blocks descendants. Exact lifetime
   relationships and bounded handoff TTL must be frozen in the next reviewed plan.

PROPOSED password authorization details, explicitly NOT APPROVED: sessionless,
digest-only, single-purpose token; target User/case/email-proof source and generation
bound; 5/15/30-minute TTL options (recommend 15 minutes for review); secure HttpOnly
same-origin short-lived browser cookie via relay, with pre-auth CSRF/origin proof.
API service DTO may carry the secret relay-to-API; no browser persistent storage or
ordinary-session reuse. A dedicated token purpose/constraint and narrow privileges
need migration review. Owner approved the direction, not these storage/TTL details.

New-password policy also remains PROPOSED: previous candidate 12–256 characters,
no normalization of the password, existing Argon2id hashing and bounded hashing
concurrency. Login's 1–256 DTO and local seed's 12–256 rule are existing behavior,
not approval of a production setup policy. Freeze password/transport/attempt
controls through plan/security review before implementation.

### Verification and exception matrix

| Case | Proposed behavior / audit / retry |
|---|---|
| Generation and uniqueness | Random independent proof per issuance; digest unique; one current unsuperseded VERIFY_EMAIL per unfinished case/generation. Bind destination to stored normalized email and proof snapshot; caller cannot supply another email/userId. |
| Resend | Actual new email-proof issuance is atomic with predecessor invalidation and one new intent; approved 60s/5-per-recipient-purpose-hour. Plan must define rolling-window/time source and uniform public response. Same delivery-job retry resends same live proof, not a new challenge. |
| New challenge after older challenge or password ticket | Supersede previous unconsumed proof and any dependent password authorization under the case lock. Preserve earlier verification evidence; no automatic login. Current generation is authoritative. |
| Success | Consume exact live proof once, append EMAIL_VERIFIED/proof source and PASSWORD_SETUP_AUTHORIZATION_ISSUED, stay pending; no extra email or Membership grant. |
| Repeat success / lost response | Do not replay the consumed email secret into a fresh password ticket. Neutral used/invalid response; existing live browser authorization may continue. If lost/unavailable, initiate fresh email proof under resend limits; no email-match credential issuance. |
| Expired proof | No verified timestamp/password ticket/access; preserve account. New email challenge through approved resend; old expiry never extended. |
| Expired/lost password authorization after valid proof | Stay PENDING_VERIFICATION even if emailVerifiedAt non-null; require fresh email proof to get a new authorization under proposal. Keep proof history, do not pretend no proof ever occurred. |
| Invalid password | Validate policy without consuming password authorization or enabling; allow correction while same authorization remains live, subject to abuse limits. Never log submitted password. |
| Invalid/wrong-purpose/revoked challenge | Generic CHALLENGE_INVALID_OR_EXPIRED without disclosing state, email or target. No success audit or account lockout based on arbitrary token guesses. |
| Failed attempts / brute force | Bounded public IP/global/request and hashing budgets; count/observe failures without unbounded per-guess audit rows or user-triggerable account lockout. Maximum failed attempts and network/global numeric limits remain for technical review; resend approval is not a guessed-code attempt limit. |
| Email edit during onboarding | No in-slice email correction. Proof must match immutable bound address; if a separately authorized future identity change wins, invalidate all related credentials. No “verify supplied new email” shortcut. |
| Parallel verify, resend, password, revoke or disable | User/case/token order and current generation decide one valid result. Recheck state/policy/current DB time after waits. No two password authorizations become independently spendable and no losing path enables access. |
| Email delivery failure | Remain pending; no proof/credential issued to public response and no verification/access inferred from SMTP acceptance. Operator-visible delivery outcome distinct from proof outcome. |

No automatic deletion, account reuse, full recovery or password reset is introduced
to solve interrupted onboarding. Post-ACTIVE reset/recovery remains a separate,
currently gated O-02-H workflow.

## 7. O-02-B4 — email delivery responsibility

Repository evidence shows **no implemented email infrastructure** to reuse.
Existing documented outbox/adapter direction can be reused as design; it cannot
be described as a working service. Private environment/provider state is UNKNOWN.

| Option | Security / reliability | Operations / cost | Retries, failures and monitoring | Testing / readiness |
|---|---|---|---|---|
| A — Reuse an existing service | Possible only if an authorized, independently evidenced service/adapter is found. No such implementation discovered. Recipient/secret/data boundary review still needed. | Potentially less new runtime work, but ownership/access/SLA unknown; no cost estimate justified. | Need durable intent/idempotency contract, attempt/failure ownership and observed queue/provider semantics; cannot assume them. | Not currently evidenced; not the S2-A baseline. No account connection or external discovery performed. |
| B — Future dedicated integration behind existing direction | App-owned proof generation/digest and durable encrypted delivery copy; replaceable adapter, least-privilege worker; sender/proof boundaries explicit. At-least-once provider calls, not exactly-once inbox delivery. | Adds worker/secret/monitoring maintenance and provider send cost. No prices or capacity claims; production budget/limits need approval. | Transactional intent; leases/fencing/dedup; bounded retry until proof expiry; classify transient/permanent/uncertain sends; failures visible. | Fake transport in isolated tests is owner-approved planning scope. Real transport/sender requires later gates and authorized verification. |
| C — Provider-agnostic application contract, defer activation | Define same durable dispatch/acceptance/failure interface without selecting another provider. Preserve O-11 Hostinger SMTP direction. | Allows isolated plan/test work; does not eliminate later integration/custody/support cost. | Contract must define accepted versus delivered, retry/expiry and failure projection now; deployment details can remain gated. | Useful together with B: plan fake adapter now, keep real mail disabled until approved. Does not establish production readiness. |

Recommendation: **B through C's replaceable contract**, with only fake transport
for isolated verification in the later authorized development scope. This follows
the newly APPROVED planning boundary, not permission to build a general inbox or
select/configure a provider now. Redis/BullMQ is documented architecture direction;
its actual queue/outbox/worker footprint, recovery and privilege plan must be
reviewed rather than silently adding an alternative infrastructure stack.

| Responsibility | Proposed assignment / pending approvals |
|---|---|
| Application | Correct recipient/challenge source; unique intent; encrypted temporary delivery secret with key outside DB; template/locale contract; claim/retry/status/expiry; no provider call inside domain transaction; redacted diagnostics and support projection. |
| Provider | Authenticated transport acceptance and any available delivery/bounce signals. Provider acceptance is not mailbox ownership or guaranteed inbox delivery. Actual provider terms/capacity not assessed. |
| Admin / organization | Initial manual handoff, support escalation and accountable owner for real email verification. Essential-proof category handling and operational send budget require O-11 sign-off. No staff write authority inferred. |
| Designated technical/operations owner | Real sender/domain/TLS/DNS, credentials and encryption-key custody/rotation, worker access/alerts and incident response. These roles/duties must be assigned before real deployment; no names invented. |

Future dispatch contract: queue contains only safe intent ID; decrypted secret is
used only in worker memory, never logs. Recheck case/challenge eligibility before
claim/send; cancellation cannot unsend a message already in flight, so the token
must still fail when presented afterward. SMTP uncertain success may yield duplicate
copies of the **same** proof; do not mint a fresh challenge on transport retry.
Clear encrypted delivery copy on accepted send or expiry under reviewed policy;
retain safe result metadata. Delay never extends challenge TTL. Monitor oldest
pending intent, expired/failed/uncertain attempts and worker progress without
recipient/secret leakage. Retry intervals/attempt caps/alert thresholds remain
technical/operational review items, not approved numeric values.

## 8. O-02-B5 — production Admin bootstrap

**UNRESOLVED.** Existing local seed is explicitly development/loopback only and
sets verified/ACTIVE using privileged creation. No production bootstrap or named
operator is evidenced. Database role initialization creates database identities,
not an application Admin or an email-verification process.

| Option | Assessment |
|---|---|
| One-time operator-run, owner-approved bootstrap | Recommended direction for later review. Named technical operator with bounded elevated access creates only intended initial Admin under explicit approval; verified mailbox/credential setup and immutable operational/application evidence must be defined; one-time guard and handover prevent repeat arbitrary Admin creation. No default/hard-coded password or public endpoint. |
| Controlled owner-supervised commissioning process | Viable if identity verification, privilege custody, evidence and safe recovery are documented. More coordination; no assumption that an existing Admin exists to approve its own first creation. |
| Reuse local seed or public Admin registration | Not recommended; conflicts with deliberate local-only seed boundary or uncontrolled production role issuance. No widening NODE_ENV/hostname guards proposed. |

Required decisions: accountable business owner, designated operator, exact one-time
authorization/evidence, verified-email setup and custody, last-Admin loss/recovery
procedure, emergency access limits and initial go-live approver. Recovery through
verified email is existing approved direction; a functioning recovery command is
not implemented and lost-mailbox exceptions remain unresolved. Bootstrap must not
depend on a development fixture, public role input or assumed pre-existing Admin.
These are production blockers, isolated from fake-environment S2-A planning by the
owner's delivery/rollout boundary. No bootstrap or DB operation occurred.

## 9. Cross-cutting security, audit and transaction requirements

APPROVED authorization target: Admin-only invitation/onboarding management; Staff
keep current reads only. Challenge holders receive only exact-stage proof authority,
not account.self, role grants, ordinary sessions or a way to act on another Client.
Public DTOs reject role, grants, accountState, verification flags, replacement
email/userId and commercial/service fields. Existing runtime invitation binding
is still gated client.manage; future explicit reconciliation and denied-Staff tests
are required, with no global redefinition of the read grant.

PROPOSED disclosure rules: public email-based requests use equivalent generic
acknowledgements for unknown/existing/disabled/wrong-role targets; errors/timing/
send effects must not expose state. Admin creation conflict does not return another
role/UUID or secrets. Existing authorized management reads remain independently
scoped. Apply no-store, exact browser Origin/Host and reviewed pre-authentication
nonce/CSRF protection; current refresh-bound CSRF is unsuitable before login.
Recipient cooldown/rate suppression must not yield a distinct response only for
existing accounts: use uniform generic acknowledgement or equally applied request
budgets for every normalized input. IP/global limits may return 429 independently
of whether an account exists. Service/configuration-unavailable responses must
also be independent of target existence; the plan must review timing and send effects.
Do not put links/passwords in URLs sent to server logging, telemetry or persistent
browser storage. Only explicit POST consumes proofs; email scanners/GET do nothing.

### Audit/event matrix (proposed actions, NOT IMPLEMENTED)

All success domain events carry actor attribution, exact validated target/case,
DB timestamp, outcome, request/correlation ID, command operation and safe issuance/
proof/intent/generation/policy references as applicable. No raw secret, password,
code, credential digest, recipient email or whole request body in audit metadata.

| Event | Actor / target / outcome and useful safe metadata |
|---|---|
| CLIENT_INVITED + SETUP_LINK_ISSUED | Current Admin → Client/case; creation and manual issuance committed, not evidence of external handoff. Initial state and issuance ID. |
| SETUP_LINK_REISSUED / ONBOARDING_REVOKED | Current Admin → same case; expected revision, old/new safe IDs, reason, outcome; separate from account disablement. |
| SETUP_LINK_CONSUMED + EMAIL_CHALLENGE_ISSUED | Purpose-proven holder → existing case; credential attribution, not fabricated authenticated session; email destination snapshot reference, no address/secret. |
| EMAIL_CHALLENGE_REISSUED | Validated pending case → new proof/intent; distinguish anonymous request from authorized challenge issuance; superseded generation and rate-policy version. |
| EMAIL_VERIFIED + PASSWORD_SETUP_AUTHORIZATION_ISSUED | Verified-email proof holder → exact User/case/proof; successful mailbox proof, case still pending. |
| PASSWORD_SETUP_COMPLETED + ACCOUNT_ENABLED | Password-setup authorization holder → exact User/case; both commit with password hash/state; no password or role/service data. |
| Duplicate/conflict / bounded verification failure | Current Admin or anonymous requester; redacted rejected outcome and correlation only; validated target only when safe/known. Separate bounded failure path avoids rollback loss and attack-driven unlimited audit inserts. |
| Administrative intervention / delivery status | Named authorized operator → supported case/intent; reason and safe action/status, preserving original evidence. No implicit identity repair permission or fake verification event. |

Success audit/mutation/consumption/retry completion and applicable email intent
must share a transaction. A provider failure after commit changes only delivery
status, not account verification/access. Audit failure rolls domain writes back.
Protected initiation/reissue/revoke rechecks current Admin and target before replay.
Existing actor/operation/key retry scope is reused only where a real active actor
exists; public proofs use once-only domain consumption or a separately reviewed
secret-safe receipt, never a fake User/session to fit Commands.

Concurrency requirements: unique normalized email handles absent-row creation;
do not rely on a nonexistent-row lock. Discover immutable target IDs first, then
User/affected sessions/onboarding-case-and-proof/token/retry locks in a reviewed
extension of shared order, sorting peers. Case locks belong before their child
tokens in the reviewed order. Re-read reference/purpose/current generation/state
and sample DB time after waits. Never append a new earlier-order lock after
discovering a different target; rollback/restart or reject. Bound DB retries with
unchanged intent. Final password+consumption+ACTIVE+audit+case completion are atomic;
parallel outcomes cannot enable twice or replace an existing ACTIVE password.

Integration detail requiring plan review: current Commands claims its idempotency
row before calling scope. If the reviewed new case/token order precedes that row,
the existing scope callback cannot simply acquire those locks afterward. The plan
must extend/restructure transaction helpers or justify one consistent compatible
order across all new writers; do not silently declare unchanged wrapper reuse safe.

Case/generation constraints and unique per-source events outlive HTTP retry
records. A role/profile FK does not prove logical identity ownership. All new
ordinary-role grants, token-purpose/session constraints and audit attributes need
fresh/upgrade and negative-privilege review. No commission data/path or financial
permission is introduced by this proposal.

## 10. Consolidated onboarding contract

### Approved business flow

```text
Admin creates Client
        │
        ▼
Admin manually shares initial setup link
        │
        ▼
Client opens setup link
        │
        ▼
Separate email verification challenge
        │
        ▼
Client verifies email
        │
        ▼
Client sets password
        │
        ▼
Account automatically becomes ACTIVE
```

Opening is read-only; a deliberate consume POST connects the displayed business
steps. Email proof and password setup are separate committed stages per new owner
answer. Automatic enablement requires both; no additional Admin approval follows.

### State and transition table — proposed representation

The existing User model can retain `INVITED → PENDING_VERIFICATION → ACTIVE`.
PENDING_VERIFICATION can include verified-email/password-pending substage because
current login requires ACTIVE. Represent proof stage and revocation with explicit
case/proof data, not ordinary auth access. A UI projection should say “Email verified;
password setup pending” rather than imply an already verified address is unverified.
No new User enum is approved or required merely to display that substage.

| Transition | Trigger/actor and preconditions/evidence | Security/audit/failure | Retry, idempotency and resulting access |
|---|---|---|---|
| Absent → INVITED | Current Admin submits strict email/name; no colliding identity; Client-only creation. | User+profile+case+digest+audit+retry reference atomic; failure leaves none. | Same-key replay IDs without secret redisclosure under proposal; changed/new-key collision denied. No account access. |
| INVITED → PENDING_VERIFICATION, waiting email proof | Exact live current INVITE holder explicitly accepts. | Consume initial proof and queue separate VERIFY_EMAIL atomically; 24h/case/generation/role/disabled checks; rollback if intent cannot be durable. | One consume; no double send/transition; lost response uses separate proof/resend, not a second identity. No login/password. |
| Pending, email unverified → Pending, email verified | Exact live emailed VERIFY_EMAIL holder POSTs proof. | Bind stored address; consume proof, timestamp/event and single-use password authorization atomic; no ordinary session. | One proof acceptance; replay cannot mint another ticket. Live returned setup authorization may continue; lost one requires fresh email proof. No login. |
| Pending, verified → ACTIVE | Holder submits valid password with exact live password authorization; same case/email proof, no revoke/disable/supersession. | Consume authorization, hash/state/complete/revoke siblings and audit atomic. Invalid password leaves same live authorization; expired/invalid proof leaves state unchanged. | One final mutation, subsequent attempts cannot reset ACTIVE credentials; explicit sign-in afterward. Ordinary account access now eligible, own role/resource checks still apply. |
| Same unfinished state → current proof reissued | Admin explicitly replaces INVITED link, or eligible pending user requests fresh email proof. | Approved issuance rate/cooldown; supersede stage/descendant proofs and update generation under lock, audit/intent as applicable. | Same command key no new issuance; generic public email response. No new identity/access. |
| Unfinished case → revoked case | Proposed current Admin reasoned revocation; exact case/revision. | All descendants invalid; User/profile/history retained. ACTIVE case is not revoked through onboarding to bypass account-disable semantics. | Idempotent reasoned operation; no in-scope un-revoke/restart. No access. |
| Non-Admin User → DISABLED | Existing authorized account-disable command. | Existing session revocation plus later onboarding-chain invalidation must be reviewed together; preserve business records. | Setup cannot reactivate. Existing account-disable semantics preserved. |

Exceptional flows are specified in sections 4–6: expired/reissued/revoked setup,
expired/reissued proof, duplicate/existing identities, delivery failure, invalid
password/proof, interrupted/parallel requests and repeated ACTIVE setup attempts.
Admin correction and Client email change remain excluded; separately authorize
resolution instead of silently linking or editing the proof destination.

Contract boundaries: **invitation** authorizes starting setup; **email proof**
demonstrates control of the exact mailbox; **password authorization** permits one
credential establishment; **enablement** sets ACTIVE after both prerequisites;
**authentication** remains explicit login/session creation. Membership, manual
payment, package/Membership activation, booking eligibility, attendance and
entitlements retain their own independent policies. No onboarding transition
posts funds, activates service, consumes units or grants booking authority.

## 11. Decision register and remaining approval boundaries

This register maps follow-up IDs to the original open items and records all fields
needed for review. Current status applies to the stated scope, not an entire module.

| ID / topic | Current status / evidence | Problem, options and recommendation | Rationale / risks / dependencies | Required approver / blocking |
|---|---|---|---|---|
| O-02-B1 — Duplicates (original E) | APPROVED no-auto-link/reject/reissue/non-enumeration rule; global email uniqueness is EXISTING POLICY. | Apply section 4 matrix; support repair remains excluded. Alternatives of automatic linking were not chosen. Exact error/denial-logging design is PROPOSED. | Preserves IDs/history and prevents takeover; risk of account-existence disclosure or implicit role/profile repair. Depends on strict normalization, locked commands and audit. | Owner rule received. Technical review of matrix/upgrade/error behavior in S2-A plan; no remaining first-slice business collision blocker. |
| O-02-B2 — Manual setup links (original G/A) | APPROVED single use, manual handoff, 24h, 60s/5-hour issuance limits. Implementation absent. | PROPOSED section 5 generation/revocation and one-time disclosure contract; alternatives: secret-safe repeat disclosure or separate issue/delivery designs require review. | No silent duplicate Client or reusable secret; risks lost first response, stale-link races and incomplete descendant revocation. Depends B1/B3. | Business values received; technical/security owner reviews disclosure, case revoke/reissue API and counters in plan. No coding until approved plan. |
| O-02-B3 — Email proof/password handoff (original G/B) | APPROVED separate committed proof/password direction and selected email TTL/resend values; ticket details explicitly deferred. | PROPOSED distinct PASSWORD_SETUP purpose/cookie, no pre-ACTIVE session. 5/15/30min ticket options, recommend 15 for review; new-password candidate 12–256 remains unapproved. Old combined DTO superseded proposal only. | Prevents manual-link proof conflation, credential takeover and verify-replay ticket minting; risks interrupted handoff/lost response/invalid-attempt abuse. Depends B2/B4 and current auth boundaries. | Owner approved direction, not ticket details/password parameters. Technical/security plan must settle transport/TTL/recovery/attempt limits and obtain required policy approval before implementation; does not block authorized planning. |
| O-02-B4 — Delivery responsibility (original K/O-11) | APPROVED bounded plan with durable app-owned proof queue, replaceable adapter and isolated fake transport; existing O-11 provider direction retained. | B behind C recommended; A has no evidenced implementation. PROPOSED intent/attempt/monitor contract; real sender/secrets/operator not supplied. | Keeps correctness with app; external delivery at least once. Risks secrets, failed/uncertain sends, costs and unowned alerts. Depends O-11/O-12/O-13 and B3. | Owner planning boundary received. Technical plan reviews fake transport/recovery; operations approves real sender/custody/send budget/alerts before real integration/deployment. Production blocker; no blocker to isolated planning. |
| O-02-B5 — Production Admin bootstrap (original D/O-14) | UNRESOLVED. Local seed only; verified-email Admin recovery direction approved but no workflow. | Named, owner-approved one-time operator process recommended; controlled commissioning alternative; no local seed reuse/public Admin signup. | Privilege custody, first/last Admin continuity and audit; risks default credentials, role escalation and unrecoverable access. Depends O-02-H/O-13/O-14. | Owner names accountable operator/go-live approver; security reviews process and recovery. Production blocker, isolated planning can defer. |

No new approval for password recovery, reactivation, email/role correction,
self-registration rollout, standalone contacts, automatic cleanup or retention
durations is inferred. Original F/H/I/L retain their open/deferred scope. No numeric
provider retry budget or failed-attempt cap is invented as approved.

## 12. Readiness levels and one recommended next task

| Level | Verdict | Basis and exact boundary |
|---|---|---|
| S2-A implementation planning | **READY FOR S2-A IMPLEMENTATION PLAN** | Critical business direction, duplicates, core TTL/resend policy and fake-transport planning boundary now have explicit answers. A bounded future plan can resolve the expressly deferred password-authorization details and technical contracts. This is readiness for a separately authorized planning task only. |
| S2-A implementation | **NOT READY — BUSINESS DECISIONS REQUIRED** | Password-setup authorization/password/abuse/revocation details need plan/security and any affected owner sign-off; no reviewed implementation/migration/rollback plan or coding authorization exists. The label covers remaining user-facing security-policy choices, not a claim that B1–B4 approvals are missing. |
| Production | **NOT READY — BUSINESS DECISIONS REQUIRED** | B5 bootstrap, actual sender/domain/secrets/custody/operator/alerts/budget, recovery/retention and O-11–O-14 release/restore/go-live evidence remain. Fake-transport success is not real delivery/readiness evidence. |

**Recommended next task: S2-A — Manual Setup Link → Separate Email Proof →
Password Setup: bounded implementation-plan review (planning only).** This task
does not start it automatically; owner review and explicit next-task authorization
remain required. The following is its review charter, not an implementation prompt.

| Required planning output | Bounded scope / acceptance expectation |
|---|---|
| Objective/value | One new Client can progress from Admin manual handoff through separate email proof and password setup to independently usable account access. No commercial prerequisite. |
| Scope | Admin issue/reissue/revoke unfinished onboarding, recipient proof/password stages, pending-case resend, existing explicit login, minimum durable proof-delivery contract and isolated fake transport. |
| Exclusions | Self-registration enablement, reset/recovery, Staff/Coach/Admin provisioning, email/role correction/merge/reactivation, mobile, general inbox/reminders, real emails, provider activation, production bootstrap/deploy and financial/service changes. |
| Dependencies/assumptions | Existing identity/commands/audit/session foundations; no running queue/SMTP assumed. Apply owner B1–B4 answers; keep production operations gated. Any wider dependency must be identified before plan approval. |
| Required approval | Owner reviews exact bounded plan and user-facing security choices; technical/security reviewer signs token/browser/DB/retry/worker design. Separate future coding/migration/deployment authorization. No approval implied by this report. |
| Proposed architecture | Existing monolith, typed Client-only commands and purpose-specific public consumers; short-lived password authorization; minimal transactional outbox/worker/replaceable adapter within reviewed documented architecture. |
| Proposed APIs/DTOs | Freeze strict POST invite `{email,displayName}`, reissue/revoke `{expectedRevision,reason}`, accept-invitation `{token}`, verify-email `{token}`, setup-password `{setupToken,password}` API-service DTO, resend-verification `{email}` and scoped status projection. Browser cookie relay may omit setupToken from browser JSON. Final route names/status/response/error/replay shapes must be reviewed, not added to OpenAPI now. |
| Data/state | Review User+profile atomic creation, immutable origin/case/generation/proof sources, token revocation/new purpose, narrow identity privileges, audit/receipt and encrypted delivery persistence. Retain User state sequence with verified/password-pending substage. No schema SQL in this task. |
| Authorization/audit | Explicit Admin-only binding and denied Staff writes, current authority on replay, no email-match linking; matrix in section 9; bounded rejected-command telemetry without secrets. |
| Retry/concurrency | Unique normalized email, current-case generation/source uniqueness, atomic each-stage consume, safe lost-response flow, no secret replay or double ticket/enablement; reviewed global lock order and post-lock time. |
| Email responsibility | Initial link manual; separate proof intent app-owned. Fake adapter captures only in authorized isolated tests; never claim SMTP/inbox success. Actual sender/credential/operator/alerts remain release gates. |
| Security controls | Freeze password-ticket TTL/cookie/nonce/lost-response policy, new-password/attempt/rate controls, destination/origin restrictions, proof snapshots, redaction, ordinary-role privilege and commission isolation. |
| Test plan | Fixed-clock TTL boundaries; duplicate/normalization/role/profile collisions; Staff denial; consumed/superseded/wrong-purpose/revoked tokens; parallel verify/reissue/revoke/disable/password; interrupted/lost response and invalid password; no GET side effects; queue crash/expiry/uncertainty; audit rollback; browser secret/CSRF/account-switch; unchanged S1-A/S1-B1/commission boundaries. |
| Acceptance criteria | Every transition/error/replay maps to a source and test; approved versus proposed parameters explicit; generic public disclosure holds; no ACTIVE before both requirements; no service effect; fresh/upgrade and negative DB privilege plan; no production claim from fake transport. |
| Migration considerations | Enumerate reviewed additive models/enums/grants, historical identity/profile anomalies and data census needed later, backward reader compatibility and deployment order. Existing applied migrations untouched. |
| Rollback considerations | Disable new initiation, pause dispatch, invalidate affected onboarding proofs safely, preserve created Client/User/history and migration evidence; retain existing login/service records; no deletion/recycling of identities or restoration of revoked secrets. Rehearse later in disposable environment. |
| Risks | Remaining password handoff/lost-response ambiguity, secret disclosure, stale generation races, partial email integration and operational readiness. Plan must resolve/control these before coding; do not expand into full account administration. |

No executable implementation prompt, code, dependency installation or migration
is included. No additional business decision is made by presenting this charter.

## 13. Documentation changes, verification and safety

Files changed in this task:

- New `docs/o02-b-onboarding-decision-closure.md`: focused B1–B5 analysis, owner
  answers, scenario/event/state matrices, evidence, readiness and next-task charter.
- `docs/o02-onboarding-decision-review.md`: append dated follow-up pointer, preserving
  its full incoming content and earlier combined-DTO proposal as historical evidence.
- `docs/milestone-2-decision-register.md`: append new explicit answers and remaining
  gates under O-02; preserve incoming approved text and historical review verdict.
- `docs/open-decisions.md`: append latest closure/readiness pointer on existing O-02
  entry, keeping prior approved decisions and broader Approved in part status.
- `docs/milestone-3-next-slices.md`: append current S2 planning-readiness checkpoint
  without removing incoming S2 preparation content or changing milestone scope.

Verification: Markdown whitespace/fence/table and practical local-link checks;
decision-ID/approval mapping and old-versus-new contract review; incoming-content
preservation; all non-document file hashes, refs, worktree HEADs/branches/statuses
and staged state checked. Runtime tests are not required/run. No production or
database/environment inspection was performed beyond committed source/templates.

No backend/frontend/API/auth/permission implementation or schema/config/environment
file changed. No package installed. No migration created/modified/executed, DB
operation, commit, push, PR operation, merge, rebase/reset/clean, branch/worktree
change, email/message to others, provider configuration, deployment or production
operation occurred. Existing uncommitted work is preserved. Other seven worktrees
and every branch/ref remain unchanged. Five documentation paths remain unstaged/
uncommitted. Stop here for owner review and explicit next-task authorization.


## Subsequent authorized S2-A implementation — 27 November 2026

The owner's direct implementation task superseded the coding/planning gate for
the bounded fake-transport slice only. [S2-A report](s2a-onboarding-implementation.md)
records implemented behavior, final test evidence and additive migration/rollback.
The approved manual-link, duplicate, expiry/resend and separate-stage decisions
are preserved. User-based serialization, digest-only proofs, 15-minute password
authorization, 12–256 password length and narrow credential database functions
are documented technical decisions. Earlier proposals here are historical, not
claims that every option was built. No real provider/scheduled sender, bootstrap,
self-registration, recovery or production operation was enabled.
