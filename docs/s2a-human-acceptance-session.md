# S2-A human acceptance evidence

28 November 2026, Africa/Cairo. Reviewer: **Admin** (the human reviewer's supplied designation). Technical facilitator: Codex.

## Result and scope

| Item | Recorded result |
|---|---|
| Required human checks H01-H10 | **PASS** |
| Required security/negative checks S01-S11 | **PASS**, with the S11 qualification below |
| Acceptance evidence | **Completed** for the bounded checklist |
| Formal reviewer/product acceptance decision | **Pending / not recorded** |
| Production readiness | **NOT APPROVED / NOT ASSESSED** |

The reviewer completed the selected checks in an isolated, disposable loopback environment using `FakeVerificationTransport`. No real email provider, sender, external inbox ownership or production environment was tested. Finalization/commit/push authorization does not constitute a formal product acceptance decision.

Repository: `Strength-studio/strength-studio-backend`. Branch: `codex/s2a-client-onboarding-20261127`. Human execution used implementation checkpoint `8b4ebc221e3e7cfe1d3dcf1bc7356049e33696f2` plus the reviewed password-rejection audit correction and regression additions. The [engineering review](s2a-acceptance-review.md) describes that follow-up patch; the [implementation report](s2a-onboarding-implementation.md) and [API contract](api-contract.md#implemented-s2-a-admin-client-onboarding) define the feature.

## Required human results

The checklist IDs below refer to section 9 of the [engineering review](s2a-acceptance-review.md#9-human-acceptance-checklist). Expanded exploratory matrices are not additional required groups and are not silently marked fully passed.

| ID | Observed result and technical corroboration | Result |
|---|---|---|
| H01-H03 | Admin created the intended CLIENT/profile in INVITED state without credentials or commerce; initial setup link was disclosed once with a 24-hour lifetime. Ordinary profile did not redisclose it. | PASS |
| H04-H06 | Explicit setup acceptance left the Client pending and queued a distinct EMAIL proof. Explicit email verification consumed that proof and issued a separate 15-minute PASSWORD authorization; no account access yet. | PASS |
| H07 | Valid password completed onboarding and enabled only the intended Client, with Argon2id credentials and completion/enablement audit events. | PASS |
| H08-H10 | Client explicitly signed in as the correct identity; Client-management access was denied. Admin observed completed onboarding; no purchase, payment or Membership prerequisite/effect was created. | PASS |
| S01 | Duplicate normalized-email invitation rejected; original identity, name, credentials and explicit relogin remained intact. | PASS |
| S02 | Staff retained Client directory/profile reads but lacked invitation/onboarding controls; Client management access was denied. Coach API denials have separate automated coverage. | PASS |
| S03 | Consumed SETUP and EMAIL proof resubmissions produced generic denial without a second transition. A fresh fixture supplied the SETUP replay because the initial Client's manual link had not been retained. | PASS |
| S04 | Expired unused SETUP was denied; Client remained INVITED/unverified with no email intent or activation. | PASS |
| S05 | Expired unused EMAIL was denied; Client remained pending/unverified with no password authorization. | PASS |
| S06 | In one browser profile, A's password form was rejected after B verification replaced browser-wide authority. Neither Client received A's password; B's own form then activated only B. A remained pending without credentials. | PASS |
| S07 | Empty reissue reason was blocked, immediate cooldown was visible, and allowed reasoned replacement advanced revision. The previous still-live link failed and the newest link worked. Extended replacement ceiling/stale-revision cases remain automated evidence. | PASS |
| S08 | Reasoned Admin revocation invalidated the pending chain; subsequent valid-password submission was denied before expiry. Client stayed pending without credentials or sessions; sign-in was denied. Unrelated Admin/Staff identities remained unchanged. | PASS |
| S09 | Reviewer clarified that fewer than 12 characters was blocked and a valid 12-character password succeeded with live authorization. Maximum-length coverage is automated; the optional manual maximum test was not completed. | PASS |
| S10 | Suppressed resend showed the neutral acknowledgement while preserving SETUP, EMAIL and PASSWORD proofs/forms. Password draft remained filled and completion succeeded without retyping; no replacement or duplicate delivery was created. | PASS |
| S11 | Reviewer observed Admin draft retention through focus/visibility checks, then Staff identity and concealment of the original draft. Exact Admin logout/Staff login chronology was not technically correlated; see limitation below. | PASS, qualified |

### S06 and S08 final evidence

S06's original interrupted run established the negative half only. A fresh isolated run repeated A's rejection with both Clients still pending, then B's legitimate completion succeeded. Read-only checks confirmed A had no password/completion, B alone was ACTIVE, its PASSWORD authorization was consumed once, and neither Client had automatic sessions or commerce.

For S08, the reviewer reported completion and supplied the expected password-denial screenshot. Admin revocation was audited at **22:39:10.243 Cairo** with reason `S08 acceptance check`. The subsequent PASSWORD rejection was audited at **22:39:27.230**, before the original **22:45:57.220** expiry. Thus denial followed revocation while authorization would otherwise still be live. The case advanced to revoked revision 2; the PASSWORD proof remained unconsumed. The Client remained pending without credentials, sessions, purchases, payments, Memberships or bookings. A bounded technical sign-in probe returned HTTP 401.

## Automated verification and chronology

These are separate executions of the same targeted suites, not an additive unique-test total. Earlier 27 November engineering/correction runs, including wider Foundation and Client-history coverage, remain historical in their dated reports.

| Execution | Backend onboarding | Dashboard onboarding, real Chrome | Other checks |
|---|---|---|---|
| Human-session preparation, 28 November | 14 passed, 0 failed/skipped | 11 passed, 0 failed/skipped | Both app builds and isolated runner/environment checks passed |
| Finalization rerun, 28 November | 14 passed, 0 failed/skipped | 11 passed, 0 failed/skipped | Both app builds, both TypeScript programs, Prisma validation and byte-identical OpenAPI regeneration passed |

**25 targeted automated tests passed in session preparation; 25 passed again in finalization.** Neither run is described as 50 distinct tests. No test was skipped in either targeted execution. The earlier 12-check runner smoke is historical engineering evidence and is not added to the session's 25-test count.

Finalization commands used pinned Node 22.23.5 / pnpm 10.34.9 and the existing private disposable-test environment, never repository production configuration:

```sh
NEXT_TELEMETRY_DISABLED=1 pnpm build
node --env-file=<private-test.env> --test apps/backend/test/onboarding.integration.test.cjs
STUDIO_TEST_CHROME=<chrome-executable> node --experimental-websocket --env-file=<private-test.env> --test apps/dashboard/test/onboarding.integration.test.cjs
node --env-file=<private-test.env> apps/backend/node_modules/prisma/build/index.js validate --schema apps/backend/prisma/schema.prisma
node apps/backend/dist/openapi.js
git diff --check
```

The external static-check script constructed both configured TypeScript programs with `noEmit` and zero diagnostics, then regenerated OpenAPI and compared bytes. OpenAPI SHA-256 remained `ec57d8495f3d7157e8133879e56eab78eb124eae5e755650136d5b58cadf7973`. No schema, migration or OpenAPI change is part of this finalization. Full historical backend/Foundation, commercial, scheduling, attendance and Client-history suites were not rerun because the bounded runtime follow-up changes password-rejection auditing only; targeted onboarding/browser tests cover its affected flow and the preserved R01-R03 corrections.

## Known issue and limitations

**HA-UI-01 — Low, cosmetic, open:** after setup acceptance followed by suppressed resend, the same neutral acknowledgement can appear twice. Investigation confirmed one email proof and one delivery intent, with no duplicate email, security violation or business-rule failure. The issue is recorded without changing implementation or reopening the completed required checklist.

- Optional X01-X05 were not completed. Partial observations do not constitute complete manual PASS results for those extensions or the broader exploratory matrices.
- S11's UI result was observed, but the exact claimed Admin logout/Staff login sequence was not technically correlated. A live Staff identity and concealed draft were corroborated; prior automated R03 evidence remains separate.
- Fake delivery proves isolated application behavior only. Real provider delivery, sender/domain, operational ownership, retention/key custody, production bootstrap/recovery and production readiness remain unassessed or gated.
- Local runner/terminal interruptions required fresh isolated runs. Previous evidence/databases were preserved; interrupted attempts were not recorded as successful tests. Active human execution time was not continuously measured across pauses.
- A separate Low Git ancestry concern remains: S1-B1 was squash-merged, so a future three-dot PR diff includes already integrated ancestry. This finalization preserves history; PR preparation is outside the authorized push task.

## Evidence retention and formal decision

Raw screenshots, safe per-test JSON, private runner artifacts and full operator chronology remain outside Git. This document is the portable result summary; passwords, proof URLs, queue ciphertext, environment files, inboxes, credentials and raw test logs are not included in the commit.

Evidence index (external filenames): `test-a.json` through `test-f.json`; `test-n01.json`; `test-n09.json`; `test-s03-complete.json` plus replay rechecks; `test-s04.json`; `test-s05.json`; `test-s07-complete.json`; `test-s10-complete.json`; U01/S11 observations; `resume-s06-a-rejected.json`; `resume-s06-complete.json`; and `test-s08-complete.json`. Preparation logs contain the 14/11 counts. Finalization retains its separate build, backend, dashboard, schema and static/OpenAPI logs. The full pre-finalization session record is preserved in the external incoming-file snapshot.

| Decision field | Value |
|---|---|
| Human reviewer | Admin |
| Required human test results | PASS, with S11 qualification |
| Acceptance evidence | Completed |
| Formal reviewer/product acceptance | Pending / not recorded |
| Decision date/time | Not recorded |
| Production readiness | NOT APPROVED / NOT ASSESSED |

The owner's finalization task authorizes documentation, review, validation, commit and normal feature-branch push. It does not supply a formal acceptance decision or authorize a PR, merge, deployment or production change. Acceptance-session cleanup is deferred under that task's delivery priority; retained test resources and artifacts are not removed. The targeted test suites cleaned up only their own temporary databases/services.
