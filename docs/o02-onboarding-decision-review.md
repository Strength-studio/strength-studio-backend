# O-02 onboarding decision and contract review

**Later S2-A implementation:** [Current implementation and verification](s2a-onboarding-implementation.md) supersedes this document's earlier planning-only readiness for the bounded slice. Historical approvals/proposals below are preserved; broader S2 and production gates remain.

27 November 2026, Africa/Cairo. Discovery, decision documentation and contract
review only. **NOT READY — BUSINESS DECISIONS REQUIRED.** The owner explicitly
answered O-02-A/B/C during this review; those approvals are recorded below.
Other recommendations are not approval, enabled APIs, migrations or implementation authorization.
The existing [O-02 register](milestone-2-decision-register.md#o-02) remains the
authority for approved policy. Newly assigned O-02-A–L IDs organize its open parts.

## 1. Repository state and preservation

Review checkout: `/home/kraken/Programming/Projects/Strength Studio S1-B1`, branch
`codex/s1b1-client-profile-maintenance-20261127`, HEAD
`153690b6954df64ca99114a8bfec91285aad77b2`. Initial working tree: clean.
Local `main` and local `origin/main` both resolve to
`1fb9c220a4f234f3eb21d87019376b95b7635c7a`, the confirmed PR #5 merge baseline.
No fresh remote request was necessary for this source/contract review; current
remote parity beyond the preceding checkpoint is not independently asserted.

**Difference from the task's stated state:** The three checkpoint documents are
already committed in `153690b`, a direct child of reviewed feature `4630462…`.
That commit changes only `docs/implementation-roadmap.md`,
`docs/milestone-3-next-slices.md` and `docs/s1b1-post-merge-verification.md`.
This discrepancy was reported before proceeding. Their contents are preserved;
the scoped S2 pointer added to the existing slice plan is identified in section 9.
There was no uncommitted work to discard. All eight worktree HEADs/branches and
all refs were recorded for the final preservation check. Historical worktrees
remain on their existing checkouts.

## 2. Sources reviewed and requirement classification

Primary business sources:

- [Decision register, O-02](milestone-2-decision-register.md#o-02), O-07 account
  versus Membership terminology, O-11 delivery, and O-13/O-14 responsibilities.
- [Business rules, Identity and catalog](business-rules.md#identity-and-catalog)
  and [Shared command transaction](business-rules.md#shared-command-transaction).
- [Permission matrix, Resource scope](permission-matrix.md#resource-scope) and
  [Implemented S1-B1 boundary](permission-matrix.md#implemented-s1-b1-maintenance-boundary).
- [API contract, Routing and credentials](api-contract.md#routing-and-credentials),
  Authorization and revocation, Route families, Foundation boundary, Client reads,
  S1-A and S1-B1; [OpenAPI snapshot](../packages/api-contract/openapi.json).
- [Data dictionary, Identity/policy](data-dictionary.md#identity-policy-and-catalog),
  [proposed domain model](domain-model.md), [architecture decisions](architecture-decisions.md),
  [architecture review](architecture-review.md), [Milestone 0 audit A01/A02/B06](milestone-0-final-readiness-audit.md),
  and the dated [M2 readiness review](milestone-2-readiness-review.md).
- [Execution inventory and S2/S3](milestone-3-next-slices.md),
  [roadmap](implementation-roadmap.md), [decision index](open-decisions.md),
  [S1-B1 checkpoint](s1b1-post-merge-verification.md), root README and mobile README.

Implementation reviewed: Prisma `User`, `ClientProfile`, `AuthToken`,
`AuthSession`, `AuditLog`, `IdempotencyKey`, `StudioSettings`/`PolicyRevision`;
Foundation SQL constraints/grants and the S1-B1 migration; identity controller,
DTOs, permissions, access guard, session/password/access-event services;
`Commands`, database transaction/clock, audit, HTTP/config/app setup; studio
controller and local seed; Client controller/service/DTOs; purchase acceptance;
Dashboard home, Client directory/detail/editor, session routes, session helpers,
Client write relay and API allowlist; backend security/integration tests and
Dashboard Client/S1-B1 regressions. Paths are relative to `apps/backend/src`,
`apps/backend/prisma`, `apps/dashboard` and their `test` directories.

The dictionary/ERD describe a proposed broader schema. Current Prisma/SQL/source
determine what exists; historical readiness statements do not override later code.

| Requirement | Classification | Source and interpretation |
|---|---|---|
| Admin can create Client accounts | Approved business direction | O-02 and business rules. Delivery/setup/enablement contract remains open; no creation API implemented. |
| Client self-registration only when Admin enables it | Approved | O-02. Registration switch and its versioned runtime enforcement do not exist. |
| Email verification | Approved | O-02. A non-null timestamp is currently required for authenticated access; no email challenge consumer exists. |
| Admin recovery through verified email | Approved | O-02. Request/consume/delivery and lost-mailbox responsibility remain open. |
| Independent Staff grants, no Staff self-grant, sensitive audit | Approved and implemented in Foundation | Permission matrix and identity grant commands. Does not approve new onboarding authority. |
| Client-only invitation boundary under `client.manage` | Existing documented contract and gated behavior | API Route families and permission scope; Staff with that grant can reach the stub. Invitation delivery and usable-account policy remain unresolved. |
| Admin-only first invitation implementation | Approved on 27 November; runtime reconciliation pending | O-02-C owner response below explicitly narrows the future invitation binding. Existing Staff read authority is preserved. |
| Automatic access after email proof/password setup | Approved on 27 November for both paths | O-02-B owner response: automatic access after both prerequisites, with no Membership/payment requirement. |
| Phone verification, government ID, Admin replacing email proof | Out of scope / no approved requirement found | No phone field or verification contract. Admin data entry is not proof of mailbox ownership. |
| Account reactivation, manual enablement, email correction | Unresolved; outside current S1-B1 writes | S1-B1 excludes these; O-02-F defines the proposed deferral. |
| Membership activation/payment approval enables account | No such approved coupling; proposed explicit independence | Membership activation is a separate commercial command. Current sign-in reads no Membership/payment/attendance state. |
| Password setup/reset TTLs, resend policy, collision resolution | Proposed technical contracts / unresolved policy choices | Existing digest/token-purpose primitives do not settle these choices. |
| Mandatory Admin MFA | Out of scope for this slice; deferred | Explicit O-02 deferral retained. |
| Separate email-proof delivery and failure operations | Blocked by another decision | Initial link handoff approved in A; separate proof still needs O-11 sender/domain/access/category/operations and K. |
| Initial production Admin and Admin lifecycle | Unresolved; production gate | O-02/O-14. Local seed is deliberately development/loopback only. |

## 3. Business decision review and register

The owner answered the three presented questions on 27 November 2026:

- **O-02-A approved:** “Admin shares a single-use setup link outside the app;
  email proof remains separate.” This does not approve an emailed initial setup
  link or treating possession of the manually shared link as email verification.
- **O-02-B approved:** “Enable automatically for both paths; no membership/payment
  requirement.” The question expressly requires email ownership proof and password
  setup before sign-in becomes available; applies to Admin-created and enabled
  self-registration paths.
- **O-02-C approved:** “Admin only; retain Staff reads and document the invitation
  change explicitly.” This authorizes the future first-slice invitation boundary,
  not a permission-code change in this documentation task.

All other decisions remain at the status stated below. These business answers do
not authorize implementation, delivery, migrations or deployment.
Required business approver below is the **project owner**, not an assumption that
any authenticated application Admin can approve project policy.

### Entry points and responsibilities

| Path | Initiator / owner | Input currently specified or proposed | Usable immediately? | Approval / verification |
|---|---|---|---|---|
| Admin-created Client | Admin / studio operations | Existing invitation DTO: email and displayName. No role/grant/password fields. | No current implementation; proposed INVITED with no password. | A/B/C approved: Admin manually shares a single-use link; separate email proof and password required. Exact mechanics G/K remain proposed. |
| Self-registration | Person / studio under Admin-controlled switch | Proposed email and displayName at start; password only after emailed proof. | No; proposed PENDING_VERIFICATION with no password. | Switch enabled and Client email proof; O-02-B/I/K. |
| Invitation completion | Intended recipient / studio monitors failure | Proposed manually shared INVITE proof, then separate emailed VERIFY_EMAIL proof and chosen password | Only after separate email proof and password setup | Initial manual link alone cannot verify email or enable access. This is completion of the Admin-created path, not a third unrestricted signup path. |
| Staff/Coach/Admin provisioning | Separately authorized operator | No general role-selection DTO permitted | Not defined by S2 | S3 and O-02-D; no role escalation through Client invitation. |
| Standalone business contact without User identity | Not specified | Would require a separate business-record design | Not applicable | Out of the first S2 proposal; current ClientProfile requires User. |

Admin's approved creation responsibility does not imply choosing/knowing a Client's
password or manually setting `emailVerifiedAt`. Admin now owns initial manual-link
handoff; possession of that link is not mailbox proof. Admin already may edit the existing
Client display name and disable access. Invitation mechanics, manual enablement,
reactivation, identity merge, email correction and failed-setup resolution require
their respective decisions below. Admin must retain existing Client/User IDs and
commercial history when resolving an identity issue; none of those terms means
Membership activation, funded purchase or usable service entitlement.

### Decision register

Approved A/B/C answers are distinguished from proposed mechanics. Other
recommendations remain **Proposed**; options are review choices, not implemented capabilities.

| ID / topic | Current status and documented position | Options | Recommendation | Impact and dependencies | Required approver / blocking status |
|---|---|---|---|---|---|
| O-02-A — Initial setup channel | **Approved, 27 November owner response:** Admin shares a single-use setup link outside the app; email proof separate. | Considered email-first, manual handoff plus email proof, or temporary password; owner selected manual handoff. | Implement the selected manual handoff in a later authorized slice; proposed separate emailed proof followed by password setup. | Initial issuance needs a secure one-time link response/handoff and lost-response/reissue design. Separate email delivery still required; B/G/K. | Project owner approved channel only. Channel blocker closed; mechanics/delivery review remain. |
| O-02-B — Enablement after proof | **Approved, 27 November owner response:** automatic access for both paths after email proof and password setup, no Membership/payment condition. | Considered automatic, additional Admin approval, or path-specific rules; owner selected automatic for both. | Proposed persistence: transition to ACTIVE atomically after final proof+password; explicit sign-in afterward. No extra Admin approval state needed. | Fixes access criterion for both paths; implementation mechanics, sessions and proof remain reviewable; A/G/I. | Project owner approved access criterion. Business enablement blocker closed. |
| O-02-C — Invitation authority | **Approved, 27 November owner response:** first implementation Admin-only, Staff reads retained. Existing gated binding still admits `client.manage` Staff. | Considered current Staff binding, Admin-only, or distinct future grant; owner selected Admin-only first slice. | Later change invitation binding to Admin-only `user.manage`; preserve Staff directory/detail and own unrelated grants. | Explicitly reconcile API/permission docs, guard and tests in later implementation. No permission code changed here; A. | Project owner approved narrowing. Business authority blocker closed; runtime reconciliation pending. |
| O-02-D — Admin bootstrap/lifecycle | Unresolved. O-02/O-14 require production bootstrap and responsibility; only local development seed exists. | Named Technical Administrator performs one-time audited bootstrap; owner-supervised operator; another reviewed controlled process. | Name a bootstrap operator and accountable owner; one-time separately approved process, then verified-email recovery. No public Admin signup or repurposed local seed. | Production access continuity, last-Admin safeguards, recovery and custody; O-13/O-14, H/K. | Project owner names responsible people; technical review of runbook. Blocks production, not isolated Client-slice development once its gates close. |
| O-02-E — Duplicate identity / cross-path collision | Unresolved workflow; unique global email and one User role already exist. No merge/relink API. | Reject/suppress and use existing setup/recovery; verified claim of an existing invitation; manually reviewed merge workflow. | No automatic merge, reparent, role conversion or overwrite. Admin gets bounded conflict; public requests generic acknowledgement. An invited Client uses the existing setup/resend path after authorized proof. | Preserves identity and commercial FKs; A/G/H. Existing missing/wrong-role profiles require separate review. | Project owner approves operational resolution; technical reviewer approves collision/privacy semantics. Blocks registration/invitation collision implementation. |
| O-02-F — Reactivation / identity correction | Unresolved; S1-B1 permits displayName and disablement only, excludes reactivation/email changes. | Defer; separate Admin reasoned reactivate/correct workflow; recovery implicitly re-enables. | Defer reactivation/email/role/phone correction and merging. Recovery never re-enables DISABLED or marks a new address verified. | Avoids disabled-account bypass; future current-role/session checks and identity re-verification; H/J. | Project owner approves deferral or separate policy. Does not block first slice if exclusions are explicit. |
| O-02-G — Challenge/password/resend parameters | Proposed technical contract, not previously approved values. Existing opaque tokens are 32 random bytes; login password DTO accepts 1–256; local seed alone requires 12–256. | Review bounded TTL/cooldown/reissue parameters; unbounded links rejected as a recommendation. | Invite/verify 24h, reset 30min; proposed 12–256 character new passwords; resend cooldown 60s and at most 5 per recipient/purpose/hour, plus IP/global caps. Use database time, single use, supersede old challenge without extending its expiry. Values require review. | Abuse/load, user support, link expiry and delivery retries; A/K and technical capacity. No alias to refresh/socket purposes. | Project owner accepts user-facing expiry/retry policy; technical reviewer signs implementation parameters. Blocks frozen acceptance cases. |
| O-02-H — Recovery scope/lost mailbox | Approved Admin verified-email recovery; Unresolved wider role scope and mailbox-loss exception. No reset implementation. | Verified-email self-service for Admin/Client; Admin-only first recovery; manual support exception designed separately. | Separate reset-request and reset-consume flows for explicitly approved roles, starting with Admin/Client if approved. Revoke all sessions on reset; no auto-login; no lost-mailbox override in S2. | Actorless audit, token revocation, socket invalidation, delivery; D/F/G/K. Pending/invited accounts use setup rather than password reset. | Project owner. Blocks recovery portion only; can be excluded from first invited-Client slice. |
| O-02-I — Registration switch and rollout | Approved Admin-controlled self-registration; Unresolved default/disable-in-flight policy. No stored setting exists. | Default closed/open; disabling stops new starts only or also pending completions. | Default closed; versioned Admin switch stops self-registration starts and resends, not Admin-invited setup. Previously issued unexpired proof may complete unless explicitly revoked/disabled. Recheck policy under lock at start/resend. | Policy history, disclosure and race behavior; B/E/G/K. This is a proposed policy choice, not current runtime behavior. | Project owner and technical reviewer. Blocks self-registration implementation; exclude from first invited-only slice. |
| O-02-J — Access/service independence | **Approved for sign-in through owner B response:** no Membership/payment requirement. Current login also has no attendance/entitlement dependency; O-07 “reactivation” concerns Membership, not User. | Independent access selected; service/funding-gated sign-in not selected. | Preserve separate service eligibility and existing account-disable semantics; onboarding posts no commercial/service effect. | Avoids state conflation; B/F and S1-B1/S1-A boundaries remain. | Project owner confirmed Membership/payment independence through B. That business blocker is closed; no wider service-policy change. |
| O-02-K — Essential delivery and failure ownership | Unresolved operational parts. O-11 partly approves Hostinger SMTP, replaceable interface and bilingual messages; sender/domain/access and ownership open. Owner A requires separate email proof after manual setup handoff. | Durable email-proof delivery under approved operations; remain gated until configured. Initial link email is not the selected A path. | Separate verification/reset email through a narrowly reviewed durable delivery contract. Name sender/domain, credential/key custodian, failure monitor and escalation; optional categories must not fake successful proof delivery. | No outbox/SMTP worker exists. Failure never grants access; A/G/H/I and O-11–O-13. | Project owner plus designated operator. Blocks complete manual-link → separate-email-proof journey; production access also gates release. |
| O-02-L — Pending records and retention | No pending-account expiration/cleanup policy; restrictive business FKs and audit retention matter. | Keep pending account with expired challenges; bounded archive after approved period; delete only proven ephemeral records under reviewed policy. | Expire challenges, retain account/profile and history for review; no automatic deletion, release/reuse of email or cancellation of purchases. Obtain separate pending-record/secret/abuse-log retention durations. | Privacy/operations and immutable evidence; E/K, O-09-G for audit retention and O-12 for backups. No legal duration is inferred. | Project owner with appropriate retention review. Blocks automated cleanup; explicit retention/operations review required before production. |

**Contradictions and ambiguities:** There is no evidence that approved O-02 requires
phone/ID proof or payment-gated sign-in. C is a real mismatch between a proposed
Admin-only implementation and the existing invitation binding, now resolved at
business-policy level by owner C; implementation reconciliation remains pending.
S1-B1 alone did not remove Staff's gated invitation binding. The database state name ACTIVE alone is also
insufficient for login: current code additionally requires verified email and a
password. Historical “activation” terminology must identify **account** versus
**Membership** explicitly. Recommendations here do not rewrite approved policy.

## 4. Existing architecture and contract findings

| Finding | Evidence | Required later change / limit |
|---|---|---|
| O02-T01 — Identity and Client scope are distinct but linked | Prisma User owns access/email/role/password; ClientProfile has User UUID as PK and displayName. Restrictive FK; no phone, independent contact or standalone Client ID. | Create User+profile atomically. Preserve IDs through setup/recovery. Do not repurpose Staff/Coach Users or fabricate business contacts. |
| O02-T02 — State enums are vocabulary, not transitions | INVITED/PENDING_VERIFICATION/ACTIVE/DISABLED exist. `Sessions.active` requires ACTIVE plus verified timestamp; login additionally checks password hash. | Define allowed writes and concurrency; extra Admin approval cannot be inferred from PENDING_VERIFICATION. No User SUSPENDED state. |
| O02-T03 — Onboarding endpoints are deliberate stubs | Register/verify-email/reset-password return 409 ONBOARDING_POLICY_PENDING; public stubs have no request DTO. Invite has strict email/name DTO and `client.manage` guard. OpenAPI documents those stubs, not a working signup API. | Version/freeze strict DTOs, errors, auth and audit before replacing any stub. No reset-request, resend or invite-consume endpoint exists. |
| O02-T04 — Token storage supports sessionless purposes; helpers do not | SQL requires REFRESH/SOCKET iff session_id non-null; INVITE/VERIFY_EMAIL/PASSWORD_RESET must be sessionless. `tokenCandidate` requires sessionId; `issue` takes a session. | New purpose-specific consumers/issuers with target locking and post-lock expiry; never bypass `active()` to get a setup session. Existing socket/refresh semantics remain intact. |
| O02-T05 — Ordinary runtime cannot create identities or reset passwords | Foundation grants SELECT and UPDATE(account_state) on app_user, no INSERT/password_hash/email_verified_at UPDATE; S1-B1 adds only profile displayName UPDATE. | Reviewed narrow grants/entry points and migration required. No blanket identity/role/email/DELETE privilege. |
| O02-T06 — DB uniqueness is global email; normalization/role consistency need care | Unique text normalized_email, no database lowercase check; login/seed trim+lower. Profile FK alone does not enforce CLIENT role; tests deliberately include a Coach with ClientProfile and missing-profile Users. | Proposed writers normalize consistently and require Client role; never blindly retrofit constraints without a census/upgrade plan. Existing safe reads filter both role and profile. |
| O02-T07 — Command wrapper requires a signed-in active actor | `Commands.run` requires AccessContext/action; IdempotencyKey actor FK non-null. | Reuse for authenticated Admin initiation. Public starts and challenge consumers require separate reviewed transactional semantics, not a fake actor/session or broad Public decorator on account commands. |
| O02-T08 — Public audit needs explicit attribution | AuditLog.actorId nullable, helper requires actorId string; enum has no onboarding/reset events. | Separate anonymous request versus credential-proven subject versus Admin initiator. Add typed actions and a reviewed nullable-actor path; never invent an Admin actor. |
| O02-T09 — Registration policy can fit versioned settings but is absent | Studio settings controller accepts timezone/currency and publishes rules:{}; config has no registration switch. | Proposed versioned onboarding rules must survive unrelated settings publication; cannot add a field silently dropped by existing publisher. |
| O02-T10 — Delivery is missing | No SMTP/inbox/outbox/worker implementation. Future dictionary includes encrypted secret delivery intents only as a proposal. | Initial setup link uses owner-approved manual handoff. Separate email-proof token+intent commit atomically; provider call outside transaction; bounded dedup/retries and failure visibility. Does not require building the full S8 inbox. |
| O02-T11 — Dashboard supports login and existing Clients only | Session handler allowlists login/refresh/logout; CSRF requires refresh cookie. API relay sends `/users/*` to S1-B1 route allowlist, which rejects invite. No setup/register/verify/reset pages. | Authenticated issuance must securely reveal the owner-approved manually shared link once, in memory only, with lost-response/reissue behavior. Public setup needs a separate pre-authentication browser origin/nonce design. No blanket relay expansion. |
| O02-T12 — Revocation and retry foundations are useful but not complete onboarding | Current identity locks, ReadCommitted bounded retries, session rotation/replay, disablement, sockets and audit tests exist. | Reset/reissue versus disablement/verification must serialize on User, then sessions/tokens and retry records in shared order; no token consumption before acquiring User. |

Architecture is suitable for a bounded extension within the modular monolith.
No new microservice or generic role-management API is warranted. The missing
contracts are design gates, not instructions to repair runtime code in this task.
Membership/payment state is not read by login. Positive-price purchase acceptance
separately checks Client ACTIVE; that commercial rule is preserved, not broadened
or replaced by onboarding. Email proof establishes mailbox control, not legal
identity or physical attendance.

## 5. Lifecycle and verification model

### Existing states and approved boundaries

These persisted values exist today. Enum existence is not implementation evidence.
Owner A/B/C now fix the business boundary; exact proposed writes below are not implemented.

| State | Current meaning / entry evidence | Allowed current transition / actor | Verification / access | Audit |
|---|---|---|---|---|
| INVITED | Stored invited state; fixtures may already have verified email. No runtime invitation creator. | Admin may disable a non-Admin User. Setup transition not implemented; mechanics below are proposed. | No login regardless of stored password/verified timestamp. | Existing disable audit; future issuance audit proposed. |
| PENDING_VERIFICATION | Stored pending state; no runtime registration creator. | Admin may disable a non-Admin User. Verification completion not implemented. | No login. | Existing disable audit; future registration/proof audit proposed. |
| ACTIVE | Enabled access state; fixture/local seed can supply credentials and verification. | Existing non-Admin disablement by Admin; password login creates a session if eligible. | Verified email plus valid password required at login; current valid session required for protected access. | Existing sensitive transitions; onboarding enablement audit absent. |
| DISABLED | Access revoked while business records survive. Entered by existing Admin disable command for non-Admin User. | No implemented reactivation. | No login/refresh/protected access; reset must not bypass this under proposal. | ACCOUNT_DISABLED; applicable sessions revoked. |

“Client record created” means User+ClientProfile exist under the current model;
“account provisioned” is not a fifth persisted state. Account suspension,
Membership suspension, recovery in progress and expired links are separate concepts.
Recovery/link expiry should not become User states automatically. Admin User
disablement returns ADMIN_LIFECYCLE_POLICY_PENDING and is not approved by this review.

### Proposed transitions, conditional on decisions

| Transition / state | Entry conditions and responsible actor | Required evidence / access afterward | Audit and unresolved gate |
|---|---|---|---|
| No identity → INVITED | Admin creates Client User+profile+INVITE digest/issuance audit atomically; proposed email/name only, passwordHash null. Initial manual link revealed once to Admin, not emailed. | No access or mailbox proof; Admin owns manual handoff under A. | Proposed CLIENT_INVITED; A/C approved, E/G and secure disclosure mechanics pending. |
| No identity → PENDING_VERIFICATION | Person starts registration while Admin switch enabled; email/name, passwordHash null. | No access. Global email uniqueness prevents a second identity. | Proposed CLIENT_REGISTRATION_STARTED with anonymous actor; E/I/K. |
| INVITED → PENDING_VERIFICATION | Holder explicitly POSTs the manually shared unexpired INVITE proof. Proposed consume operation queues separate email proof atomically. | **No access, no emailVerifiedAt and no established password.** Manual link proves invitation possession only. | Proposed CLIENT_INVITATION_ACCEPTED and EMAIL_VERIFICATION_REQUESTED; implements approved A boundary only after G/K contract review. |
| PENDING_VERIFICATION → ACTIVE | Holder POSTs separately emailed VERIFY_EMAIL proof and sets password; applies to Admin-created and self-registration paths. | Same mailbox/purpose/target binding; no password established by an unverified initiator. Automatic enablement after both prerequisites is approved by B; no automatic login is proposed. | Proposed CLIENT_SETUP_COMPLETED / EMAIL_VERIFIED / ACCOUNT_ENABLED; G/E/K mechanics remain; I only for self-registration. |
| Verified but awaiting Admin approval | Not part of selected B policy. | No extra Admin approval required after proof+password. | No pending-approval state or approve/reject command proposed for S2. |
| INVITED or PENDING_VERIFICATION → same state on expiry/delivery failure | System expires challenge; authorized resend may supersede it. | No access; preserve User/profile/history. | Proposed challenge reissue/failure evidence, not fictitious verification; G/K/L. |
| ACTIVE → ACTIVE on password reset | Holder of approved PASSWORD_RESET proof for already verified eligible account sets new password; revoke sessions/reset challenges atomically. | Must sign in again. Reset does not verify a different address or enable pending/disabled identity. | Proposed PASSWORD_RESET_COMPLETED plus revocation; H/G. |
| Non-Admin state → DISABLED | Existing Admin command; lock/recheck current authority and target. | No access; all applicable sessions revoked; preserve business records. | Existing ACCOUNT_DISABLED. Future setup/reset must lose to disablement under target lock. |
| DISABLED → ACTIVE; email correction; identity merge | No proposed ordinary transition in first slice. | Remains blocked until separately approved. | F/D/E; not enabled by recovery or invitation. |

Invalid transitions include unauthenticated arbitrary UUID enablement; role/grant
fields on registration/invite; manual email-verified flags; cross-purpose challenge
use; GET consuming links; expired/consumed/revoked proof; setting credentials before
the challenge proves mailbox control under the proposed flow; DISABLED recovery
reactivation; payment → account enablement; and onboarding → Membership activation.

### Verification, credentials and failure behavior

| Mechanism | Purpose / initiator / responsible party | Evidence and proposed transition | Expiry, retries and enablement |
|---|---|---|---|
| Email proof | Required approved business boundary; recipient owns proof, studio owns delivery. | Purpose-bound unpredictable token delivered to exact User email; explicit POST proves possession. | Proposed TTL G; no access merely for delivery. B controls enablement. |
| Invitation acceptance | Recipient begins Admin-created setup using Admin's manually shared link. | INVITE token only; proposed PENDING_VERIFICATION and separate email proof request, no password/verification/access yet. | Single use; reissue supersedes old manual link; preserve identity after failure. A/B approved, G/K mechanics pending. |
| Password setup | Recipient establishes secret after proof. | Proposed 12–256 character password, stored only as Argon2id digest; Admin does not supply it. | No password in URL/audit/retry record; no auto-login. G. |
| Password reset | Recovery of existing verified access; Admin recovery approved, wider roles pending H. | PASSWORD_RESET token to verified email, same existing User; reset password/revoke sessions together. | Proposed 30min; generic public acknowledgement; consumed/invalid proof cannot mutate again. H/G. |
| Phone, manual ID, Admin verification | No approved onboarding mechanism found. | No phone/ID state/field or Admin substitution for email proof proposed. | Excluded; requires separate decision. |

## 6. Proposed contract changes — not implemented

### Database and runtime privilege review

| Existing model | Proposed change / purpose | Constraints / migration need / risks |
|---|---|---|
| User / ClientProfile | Reuse existing identity, states and displayName. Narrow atomic Client-only creation entry point; no second Client identity model. | Normalize email with existing trim+lower convention; global unique email; required compatible profile; no role/grant input. Initial manual INVITE creation does not require an email delivery intent. Migration required for reviewed runtime privileges. Prefer a narrowly reviewed database entry point forcing CLIENT and permitted initial state over broad INSERT/identity UPDATE grants; review ownership/search_path/EXECUTE restrictions if used. |
| User credentials/verification | Permit passwordHash/emailVerifiedAt writes only after separate email proof; preserve normalizedEmail/role. | Nullable until proof; no blanket identity UPDATE or automatic constraint invalidating historical data. No additional Admin approval state under approved B. |
| User onboarding origin (absent) | Proposed immutable nullable onboardingOrigin for ADMIN_INVITED versus SELF_REGISTRATION on newly created Client Users. | Required for new S2 writers, historical Users retain null until reviewed; no fabricated backfill. Identifies whether registration-disable policy affects resend/completion. Reviewed field/enum migration required if this representation is accepted; do not infer origin from current accountState alone. |
| AuthToken | Reuse purpose, digest, target and expiry. Proposed revokedAt (separate from consumedAt) for supersession/reset/disable evidence. | Sessionless INVITE/VERIFY_EMAIL/PASSWORD_RESET; existing purpose/session CHECK retained. At most one unsuperseded challenge per user/purpose via reviewed partial uniqueness; revoke even an expired predecessor before reissue. Predicate must not depend on current time. Migration required for new column/index; migrate existing rows after scoped census. |
| StudioSettings / PolicyRevision | Typed versioned onboarding rules: registrationEnabled and approved challenge policy/version. | Default registration closed under proposal; unrelated settings writes must preserve onboarding rules. Validate full rules shape and effective policy; migration only if dedicated fields/table chosen. Existing rules:{} publication is incompatible with silent JSON additions. |
| AuditLog | Add proposed setup/proof/enable/reset/reissue/policy actions; explicit anonymous/credential-proven/Admin attribution. | Schema permits null actor but helper must be extended later. Migration for action enum changes; append-only privileges retained. No raw tokens, passwords, emails or bodies in redacted metadata. |
| IdempotencyKey | Reuse existing actor/operation/key model for authenticated initiation and resend. | No fake actor for public requests. Public identity uniqueness and token consume provide domain at-most-once effects; any public request receipt model needs separate retention/privacy review. No schema change assumed solely to force wrapper reuse. |
| Delivery intent (absent) | Proposed minimal encrypted email outbox for separate VERIFY_EMAIL and approved PASSWORD_RESET proof, with user/challenge/purpose, locale, dedup key, expiry, claim/status/attempts and failure visibility. Initial INVITE is manually shared per A. | Restrictive recipient/challenge references; unique challenge/template intent; lease/retry safety; encrypted secret with key custody, never plaintext token in ordinary payload. Migration/new worker privileges required. Clear ciphertext on success/expiry, preserve safe status metadata. O-11/K. No full inbox/reporting system implied. |
| Client profile/contact/phone | No new phone, email-edit, standalone-contact or merge model in first slice. | Larger identity migration deferred; existing commercial references preserved. |

No migration SQL or schema edits are produced by this review. A later migration
plan must cover fresh and upgrade paths, ordinary-role denial, token/policy
compatibility, rollback and existing identity/profile anomalies before constraints.

### Proposed API DTOs and routes

All paths below are relative to `/api/v1`. They are candidate contracts, not
OpenAPI additions. A strict DTO rejects unlisted fields/query parameters; email
is 1–254 valid characters, normalized consistently, displayName trimmed 1–120 with
no controls, token is proposed existing-style 43-character base64url, new password
uses G. Never accept role, grants, membership/payment fields, userId as public
proof authority, emailVerifiedAt, or arbitrary accountState.

| Method / route | Request → success DTO | Authentication / authorization | Retry, audit and errors |
|---|---|---|---|
| POST `/users/invite` (replace stub after remaining contract closure) | `{email, displayName}` → 201 `{clientId, accountState:"INVITED", challengeId, expiresAt, linkDisclosure, setupLink?}`. Proposed linkDisclosure is AVAILABLE_ONCE on first acknowledged issuance, NOT_REPLAYABLE on replay; setupLink only on first execution. | Current runtime binding `client.manage`; owner C approves future Admin-only `user.manage` binding. Staff reads unchanged. | Required Idempotency-Key, operation `client.invite`; normalized email/name digest; replay stable issuance IDs, no duplicate identity or automatic new link. CLIENT_INVITED audit, never raw link. 409 CLIENT_IDENTITY_CONFLICT without other-role/owner details; ordinary 400/401/403/429/503. One-time disclosure semantics need technical sign-off. |
| POST `/users/{id}/resend-invitation` (new; reissue for manual handoff) | `{}` → 200 `{clientId, challengeId, expiresAt, linkDisclosure, setupLink?}` with same one-time disclosure proposal. No email-delivered status. | Admin-only per C; target must be INVITED Client, not PENDING_VERIFICATION/ACTIVE/DISABLED/other role. | Own operation/key; target lock, supersede old manual link; CLIENT_INVITATION_REISSUED. 404 CLIENT_NOT_FOUND; 409 CLIENT_SETUP_NOT_ELIGIBLE/RESEND_TOO_SOON; 429/503. Pending verification uses separate email resend. |
| POST `/auth/accept-invitation` (new) | `{token}` → 202 `{accepted:true}` only after separate VERIFY_EMAIL intent is durable; no password or session. | Public endpoint authenticated by purpose-bound INVITE challenge. | Consume INVITE and enter PENDING_VERIFICATION with emailed proof intent atomically; CLIENT_INVITATION_ACCEPTED/EMAIL_VERIFICATION_REQUESTED. Generic 400 CHALLENGE_INVALID_OR_EXPIRED for invalid/expired/used/wrong-purpose/disabled; 400 INVALID_INPUT; 429/503. No email proof or access granted here. |
| POST `/auth/register` (replace stub; later than invited-only slice) | `{email, displayName}` → generic 202 `{accepted:true}` | Public, only when versioned Admin switch permits. | Never changes existing User/profile/password; no account IDs in public response; unique email wins concurrency. Anonymous CLIENT_REGISTRATION_STARTED on real creation; 409 REGISTRATION_DISABLED independent of email existence; 400/429/503. Password collected only on verified completion to avoid pre-registration credential takeover. |
| POST `/auth/verify-email` (replace stub) | `{token, password}` → 204 for invited-Client or self-registration completion. | Separately emailed VERIFY_EMAIL proof for PENDING_VERIFICATION target; no arbitrary email change. | Consume once, set chosen password/email proof and enable per approved B; CLIENT_SETUP_COMPLETED/EMAIL_VERIFIED/ACCOUNT_ENABLED. Same generic challenge errors; no login response. INVITE token cannot be used here. |
| POST `/auth/resend-verification` (new) | `{email}` → generic 202 `{accepted:true}` | Public, rate/collision policy applies. Proposed stored origin distinguishes Admin-invited versus self-registration pending account so registration switch only applies to the latter. | Target/purpose eligible or silent no-op; cooldown does not reveal account state. New VERIFY_EMAIL intent only for eligible pending target, no identity overwrite; audit actual reissue. 400/429/503; no “user not found.” Origin persistence requires technical review. |
| POST `/auth/request-password-reset` (new) | `{email}` → generic 202 `{accepted:true}` | Public request; delivery only for approved H roles, verified eligible accounts. | No role/state/existence disclosure; bounded send policy. RESET_REQUESTED only with safe attribution when real action occurs; 400/429/503. Disabled/pending/invited targets do not gain access. |
| POST `/auth/reset-password` (replace stub) | `{token, password}` → 204 | PASSWORD_RESET proof, approved role and verified ACTIVE target checked under lock. | Password+token consume+all sessions revoked+audit in one transaction; after commit invalidate sockets. PASSWORD_RESET_COMPLETED; generic challenge errors. No new membership/account enablement. |
| PUT `/studio-settings/onboarding` (new proposed versioned command) | `{expectedPolicyId, registrationEnabled}` → 200 `{policyId, version, registrationEnabled}` | Current Admin `studio.configure`; full typed policy merge/copy required, not empty rules reset. | Required key, operation `studio.onboarding.configure`; expected revision conflict; STUDIO_ONBOARDING_POLICY_PUBLISHED. 409 ONBOARDING_POLICY_CHANGED; 400/401/403/429/503. Excluded from first invited-only implementation. |

Existing login/refresh/logout, Client reads, S1-B1 PATCH and disablement retain
their current contracts. No standalone enable endpoint is needed under approved B;
reactivation remains gated under F. Request/consume separation
avoids overloading password reset with initiation or invitation acceptance.

### Transaction, replay and error rules

Authenticated initiation/reissue uses `Commands` with current authority/resource
rechecked on replay; 24h actor/operation/key scope and existing
IDEMPOTENCY_KEY_REUSED/EXPIRED conflicts remain. Proposed resultReference identifies
the immutable issuance/challenge, not the User's latest challenge, retaining safe
issuance data through the retry window. Raw manually shared INVITE value appears
only in the first execution's private no-store response and ephemeral Admin UI;
DB stores its digest. Replays retain the same IDs/expiry and return
linkDisclosure:NOT_REPLAYABLE with no link. Thus result identity is stable but
secret disclosure is deliberately not replayed. A lost first response requires
explicit reissue under a new operation/key, invalidating the old link; it never
creates a second Client. This one-time disclosure proposal requires technical
sign-off and clear UI, not encrypted replay-secret retention by default.

Queued status applies only to actual separate email-proof intents; it does not
claim SMTP delivery or Admin's manual handoff. Current delivery status is a scoped
projection. Same email with a different creation key creates no second identity
or unrequested reissue.

Public starts do not use the active-session wrapper. A global unique normalized
email plus transactional profile/token/email-intent insertion prevents duplicates;
map concurrent uniqueness conflicts to the same non-enumerating public outcome.
Do not lock a nonexistent email row and assume it prevents races. If a collision
requires changing the locked aggregate, restart or reject; never discover and
acquire earlier-order identity locks after a policy/token lock.

Challenge consumption discovers target without mutation, then locks User, relevant
sessions, token, and any retry/policy records in shared order, sampling DB time
after waits. Re-read purpose, target, state, digest, consumed/revoked/expiry and
approved policy. Only then consume, store credentials/verification/state, revoke
affected tokens/sessions and append audit atomically. Hashing is bounded and must
not hold DB locks across uncontrolled work; the final transaction rechecks all
preconditions. Provider calls never run inside it. Audit failure rolls everything
back. After reset wins, old credentials/sockets fail; disablement winning first
blocks completion/reset. Reset and resend cannot race into two valid challenges.

Proposed public consume semantics are **one successful mutation**, not retained
secret-body HTTP replay: a repeated consumed token receives the generic invalid
challenge response and creates nothing. On a lost success response the UI explains
that completion may have succeeded and offers sign-in or a fresh approved recovery
request. It never changes password input and blindly retries a consumed token.
Any later requirement for success replay needs an approved secret-safe receipt
design; do not store password/token bodies or reusable credentials in retry data.

Error envelope remains `{code, requestId}` with no-store and redacted logs.
Authenticated writes use current 400 INVALID_INPUT, 401 UNAUTHENTICATED,
403 FORBIDDEN, 409 idempotency/business conflicts, 413 payload limit,
429 rate/busy and 503 RETRY_TRANSACTION/unavailability. Public email-based starts
must have equivalent responses and bounded work for existing/missing/different-role
targets, subject to global availability/rate outcomes; tests must check content,
status, timing class and send effects. A request requiring real delivery must not
claim “queued” unless intent is durable; configuration/queue unavailability gives
a generic service failure independent of email existence. Global/public edge abuse
controls and trusted proxy/IP handling need review; in-memory default throttling
alone is not a complete distributed abuse policy.

### Approved responsibility boundary and proposed audit mechanics

| Operation | Admin | Staff | Client | Unauthenticated / challenge holder |
|---|---|---|---|---|
| Client directory/detail | Existing allowed | Existing `client.manage` reads | Own profile only via own route | Denied |
| Invite/reissue Client manual link | Owner C approved Admin only for first implementation | Denied for first implementation per C; existing reads retained | Denied | Denied |
| Setup/verify | No manual email-proof bypass | No bypass | May complete own proof | Exact issued challenge only, never arbitrary target UUID |
| Configure registration | Existing Admin configuration authority; proposed new binding | Denied | Denied | Denied |
| Start self-registration | Same public contract, cannot choose role | Same public contract, cannot choose role | No authenticated privilege to overwrite identity | Only when enabled, server fixes CLIENT |
| Request/consume reset | Own eligible identity subject to H | Recovery role scope pending H | Recovery scope pending H | Verified-email proof only for approved eligible role |
| Profile edit / disable | Existing S1-B1 Admin boundary | Existing reads, no edit/disable | No added write | Denied |
| Reactivate/change email/merge/provision non-Client | Excluded/gated | Denied | Denied | Denied |

Coach receives no S2 administrative authority. Public recovery scope for Staff/Coach
remains H pending; no new Staff permissions are implied by reusing generic auth.

Proposed audit actions above require actor/target/request/time, applied onboarding
policy, transition kind and safe challenge/intent reference. Anonymous start uses
null actor with explicit source attribution; after valid challenge proof, subject
actor attribution is labeled credential-based, not an authenticated session.
Admin initiation remains attributed to current Admin. Passwords, raw tokens,
email/name, credential digests and full request bodies stay out of audit metadata,
HTTP errors, sockets and operational exports. Distinguish queued delivery,
delivery attempt/failure, verification and actual account enablement. Failure
observability must not invent a completed security transition.

### UI surfaces and duplicate/failure journeys

- **Admin Dashboard:** Proposed Client-only invite form alongside existing directory,
  with email/name review, identity conflict, private one-time link copy for manual
  handoff, expired/consumed state and explicit reissue. Clear the secret on navigation,
  refresh/account switch and do not put it in ordinary status lists or persistent
  storage. Lost-response replay explains why the original link is unavailable and
  requires explicit reissue, never another create. Separate emailed-proof delivery
  can later show queued/failed status. Preserve S1-B1 dirty drafts, actor revalidation, Origin/Host,
  CSRF, immutable retry and history/BFCache protection. Keep Profile edit/disable
  separate from setup; no role picker, arbitrary state dropdown or raw link display.
- **Public setup:** Separate allowlisted setup/register/verify/reset pages/handlers
  require a pre-authentication anti-CSRF/origin design; current refresh-bound CSRF
  cannot serve people with no refresh cookie. Use a short-lived same-origin browser
  nonce/challenge and exact Origin/Host checks for browser POSTs under proposal;
  API bearer/native clients follow separately reviewed transport policy. GET only
  renders and never consumes a link. Token via fragment/POST handoff is proposed
  to avoid server URL logs; strip fragment promptly, no third-party resources,
  no-referrer/no-store, never persistent browser storage. Freeze approved origins
  and return destinations; no arbitrary redirect supplied by caller.
- **Client setup/recovery flow:** For owner A's path, first explicitly submit the
  manually shared invitation proof to request separate email verification; this
  does not enable access or establish a password. The separate emailed proof page
  then collects the password, completes proof/setup and enables automatically under
  B, showing a sign-in link. Expired/used/superseded
  links show a neutral recovery/resend path; no login or role inference from token
  error. Never show “email sent” before durable queuing. Provider failure leaves
  invited/pending account inaccessible with an operational status for authorized staff.
- **Duplicate email:** Global unique normalized email; Admin conflict does not reveal
  other-role details. Public existing/missing/disabled/Staff/Coach collisions receive
  the same acknowledgement and do not overwrite credentials/profile, create a
  second profile, switch roles, enable access or send repeated unsolicited mail.
  Admin-created then self-registering Clients keep the original identity and use
  the approved existing setup/recovery path. Wrong/missing-profile records require
  a separately approved repair, not an onboarding “fix.”
- **Phone or conflicting names:** No phone field/normalization/dedup rule exists;
  no phone collection/verification proposed. Equal names are not identity equality.
  A changed name cannot merge Users. Email correction after a typo remains F;
  record an operational conflict rather than silently editing or recycling identity.
- **Repeated requests:** Authenticated same-key replay returns original issuance IDs
  without redisclosing the manual secret or creating another link; new-key reissue
  is explicit and rate-limited, old manual proof superseded. Separate verification
  email resend is independently bounded and supersedes its prior emailed proof.
  Delivery retries refer to the same still-live challenge, do not extend expiry,
  and never log token plaintext. Dedupe limits duplicate intents; SMTP may still
  deliver duplicate copies after an uncertain send, so copies must share the same
  single-use proof. No exactly-once external-email claim.
- **Flutter:** No implementation exists; reuse approved backend transitions in a
  later interface slice. Do not require a mobile build to review S2 contracts or
  invent Client booking/ledger UI while those policies remain gated.

## 7. Implementation readiness and acceptance review

**NOT READY — BUSINESS DECISIONS REQUIRED.** A/B/C are now closed at business level,
including Membership/payment independence through B. Remaining duplicate/support,
challenge/reissue and separate-email delivery choices and technical review prevent
freezing the full first journey's contract. Specifying candidate DTOs is not closure
of those remaining matters. No pending answer has been treated as consent.

| Readiness dimension | Assessment |
|---|---|
| Business decisions | A/B/C approved; J's Membership/payment independence confirmed by B. E/K unresolved for complete invited-Client journey; G needs parameter review. F/L remain explicit exclusions/release gates. |
| Lifecycle / verification | Separate email proof plus password required, automatic access for both paths approved. Two-stage manual INVITE → separate emailed VERIFY_EMAIL mechanics remain proposed. No phone/ID or extra approval state. |
| Permissions | Owner C approves Admin-only invitations and preserved Staff reads. Current stub binding still needs later explicit guard/contract/test reconciliation. |
| API / data / audit | Detailed proposals supplied; DTO, privilege, token, attribution and delivery changes need technical sign-off after owner choices. |
| Errors / retry / duplicate handling | Candidate one-use and conflict/privacy rules defined; E/G and abuse budget require review. |
| UI | Admin initiation and pre-authentication completion proposal defined; browser origin/nonce/link contract needs sign-off. |
| Dependencies | No delivery worker/outbox/sender setup; K/O-11 unresolved. D blocks production bootstrap; L/retention and operational evidence gate production. |
| Acceptance | Test matrix below proposed, not executed. No build/unit/integration/browser suite rerun for this documentation-only task. |

Future implementation acceptance must prove:

1. Manual issuance commits User+ClientProfile+INVITE digest+audit+authenticated retry
   reference together or not at all. Manual-link acceptance atomically consumes
   INVITE, enters PENDING_VERIFICATION and queues the separate VERIFY_EMAIL proof.
   Final proof/password/enablement/audit commit together. Revoked Admin cannot
   initiate/replay after waiting; raw manual secret is disclosed only as specified.
2. Email normalization/global uniqueness survive parallel Admin invite/public starts;
   no second identity, role conversion, profile reassignment or credential overwrite.
   Exercise existing Client, invited Client, disabled User, Staff/Coach and missing
   profile fixtures. Phone/name similarity never silently merges accounts.
3. Only the separate emailed live VERIFY_EMAIL proof for the exact target proves
   mailbox control; the manual INVITE alone never does. Wrong purpose,
   expiry equality, consumed/superseded token, target disablement and concurrent
   completions produce at most one transition. GET/link scanners cause no mutation.
4. New password is established after proof under proposal; malicious pre-registration
   cannot arrange a known password later activated by someone else's email click.
   No secret in logs, history URLs, audit, retry responses or local storage.
5. Competing setup/disable/reset/resend and policy-toggle races follow reviewed lock
   order and post-lock database time, with audit rollback and bounded transaction retries.
6. Current Staff reads/S1-B1 restrictions remain; invitation C change is explicit.
   Public DTOs reject role/grants/access/financial fields. Reset never activates
   disabled/pending accounts and revokes old REST/refresh/socket access atomically.
7. Delivery uses durable dedup/claim/retry behavior; worker crash, SMTP uncertainty,
   expiry and unavailable sender preserve correct account state and observable
   failure. Test secret encryption/key rotation/clearing and recipient isolation.
8. New browser surfaces enforce exact origin, nonce/CSRF and allowlists, handle
   account switches and ambiguous responses, and preserve existing Client history/
   draft regressions. Generic public responses resist enumeration and send abuse.
9. Fresh/upgrade migrations and ordinary-role negative tests enforce narrow identity,
   token and audit privileges; no commission schema/data path becomes accessible.
   Preserve all purchase/Membership/payment/booking/attendance histories.
10. If self-registration/recovery later enter scope, test disabled switch, in-flight
    completion policy, verified-email reset requests, recovery eligibility and
    lost-mailbox exclusion. Production still needs bootstrap, retention, delivery,
    backup/restore and go-live authorization separately.

Rollback review for any later implementation: disable new initiation/public
registration, stop secret-delivery workers safely, retain account/profile/audit and
existing business rows, invalidate only affected new challenges under an authorized
procedure, preserve migration history and ensure older readers tolerate enum/policy
additions. Do not roll back by deleting created Clients or replaying old invites.
Rehearse in a disposable environment and retain independent existing login/S1-B1
behavior. No rollback operation is authorized or performed now.

## 8. One recommended next task

**O-02 invited-Client contract closure workshop.** This is the smallest decision
task that can prepare a bounded implementation; do not start S2 code yet.

Objective/user value: close the remaining contract for an Admin to add one Client
through manual link handoff and separate email-backed proof, without waiting for self-registration, general
account administration or the attendance ledger.

Required output: preserve approved A/B/C and Membership/payment independence under
B/J; obtain explicit owner answers E and K's first-slice separate-email delivery/
operator choice, and approve or modify G's proposed user-facing parameters. Sign off
the corresponding narrow DTO/state/privilege/public-consumer/delivery contract,
negative cases and disposable-environment plan. Mark D and production-specific
K/L responsibilities as separate release blockers, never silently “closed.”

Keep self-registration/switch I, password recovery H, Staff/Coach provisioning,
reactivation/identity correction F, mobile, general inbox, finance, Membership and
attendance effects explicitly excluded from the candidate first slice. This is a
scope proposal, not withdrawal of already approved future features.

After those decisions and separate implementation authorization, a candidate
**S2-A — Admin-shared setup link → separate Client email proof/password setup** could implement
only the invited-Client routes/contracts (manual issue/reissue, accept invitation,
verify email, resend verification and existing sign-in), narrow
identity/token/origin/audit/delivery persistence, secure Admin/public
pages and the applicable tests above. It needs reviewed migration/rollback and
must leave registration/reset and other excluded workflows gated. Owner business
answers A/B/C are recorded, but no implementation authorization for S2-A is recorded.

Risk: Low for this decision task; material identity/delivery risk for implementation
until remaining duplicate/reissue policy, proof mechanics and delivery
responsibilities are settled. Authority and automatic-enable criteria are now approved;
that does not freeze the complete contract or warrant “ready with limited open decisions.”

## 9. Documentation changes

- This review: new scoped O-02 requirement classifications, decision register,
  implementation findings, approved A/B/C answers, proposed lifecycle mechanics/contracts/readiness and
  single next-task recommendation.
- `docs/milestone-2-decision-register.md`: add review/subdecision cross-reference
  under O-02; preserve historical text and append explicit dated owner answers,
  separating now-closed questions from the remaining unresolved parts.
- `docs/open-decisions.md`: link the review on the existing O-02 row; retain
  Approved in part, recognizing actual A/B/C answers while keeping other recommendations pending.
- `docs/milestone-3-next-slices.md`: add a dated S2 review/readiness pointer, retaining
  its checkpoint, original plan and business gates.

The implementation roadmap and original post-merge report remain byte-for-byte
unchanged from the incoming committed checkpoint. No competing execution tracker
or implemented API documentation/OpenAPI update is introduced.

## 10. Safety confirmation

No onboarding implementation, backend/frontend edit, schema/migration change,
migration execution, permission/authentication change, commit, push, merge, rebase,
reset, branch/worktree deletion, deployment, production configuration or production
operation occurred. No messages or emails were sent to others. No runtime tests
were needed or run for this documentation-only review. Verification is scoped
source/schema/SQL/test/OpenAPI inspection plus documentation links/diff and
file/ref/worktree integrity checks.

No existing uncommitted work was present; all incoming work is preserved.
All eight worktree HEADs and branches and all refs remain unchanged. Other
worktrees are untouched; only the four documentation paths above change locally,
unstaged and uncommitted. Stop here; implementation requires explicit authorization.

## 11. Subsequent remaining-decision checkpoint — 27 November 2026

The [O-02-B1–B5 closure report](o02-b-onboarding-decision-closure.md) records later
explicit owner answers on duplicates, 24-hour initial/email proofs, 60-second
resend cooldown and at most 5 per recipient/purpose/hour, separate committed email
proof then password setup, and the fake-transport-only delivery planning boundary.
These close the corresponding original E/G/K parts, without approving reset,
password-ticket/password/attempt parameters or production operations/bootstrap.

The above review remains the earlier record, including its NOT READY conclusion
and proposed DTOs. Its combined verify-email `{token,password}` proposal is now
superseded by the approved **separate proof/password direction**; a distinct
short-lived password-setup authorization and its details need the next plan review.
No implemented DTO changed. Latest readiness is **READY FOR S2-A IMPLEMENTATION
PLAN** for an isolated fake-transport scope; implementation and production remain
not ready/unauthorized. The later report is the current scoped decision/readiness
reference. All incoming text above is retained as historical evidence.


## S2-A implementation checkpoint — 27 November 2026

The owner subsequently authorized direct bounded S2-A implementation. See the
[implementation and verification report](s2a-onboarding-implementation.md) and
[current API](api-contract.md#implemented-s2-a-admin-client-onboarding). Manual
Admin disclosure, separate email proof/password commits, automatic account access,
no identity linking and Admin-only management are implemented locally. The earlier
planning verdicts/proposed DTOs remain historical; actual implemented contracts now
govern. Password authorization is 15 minutes and new-password length 12–256 as
documented technical decisions under implementation authority. Real email provider/
operations, recovery, self-registration and production bootstrap remain deferred.
No commit, push, PR, deployment or production operation is authorized/performed.
