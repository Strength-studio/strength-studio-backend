# Strength Studio consolidation report

Prepared 23 November 2026. Canonical repository:
`Strength-studio/strength-studio-backend`; remote `origin`; integration target
`main`. This is a **reviewable consolidated candidate**, not a claim that every
planned application feature exists or is production-enabled. Main is not directly
updated and the integration PR must remain unmerged until owner approval.

## Discovery and authoritative structure

The [worktree inventory](worktree-inventory.md) contains absolute paths, Git roots,
common Git directory, branch/upstream/HEAD/ahead-behind data, all 135 source paths
and variants, ignored artifacts, missing work and the reconciliation plan. It was
produced before creating or changing the integration branch.

All four original directories are linked worktrees of the **same** repository,
sharing `/home/kraken/Programming/Projects/Strength Studio/.git`. They are not four
independent repositories. All were clean: no staged/unstaged/untracked files,
no stashes, no extra reflog-only commits, no tags or nested Git submodules.
Local ignored `.env`, dependencies and generated builds were present; they were
not read into source inventory or copied into integration. The final candidate
adds a fifth worktree without deleting or repurposing the existing four.

| Original worktree / branch | HEAD | Relationship to discovery main |
|---|---|---|
| Strength Studio / `fix/booking-future-session-validation` | `487872d3287116c4ab5b7430cfab0b0573b0e292` | 1 ahead / 3 behind by commit identity; exact tree/patch already squash-integrated |
| Strength Studio M3-S1 / `codex/m3-s1-coach-attendance` | `c189b9c0314dbea7202524ca2be5399307a3e29c` | 1 ahead / 2 behind by identity; exact tree/patch already squash-integrated |
| Strength Studio M3-S1-PR2 / `codex/m3-s1-attendance-corrections` | `62f8043433bcda4789efc879f4da9d8f94aafac5` | Same as main |
| Strength Studio Next Milestone / `codex/m3-technical-readiness` | `d1c45d999a2b1c93d3c94f52061efdb1f5835d91` | 1 ahead / 0 behind; published but missing from main |

Each original branch matched its configured upstream at discovery. Historical
worktree HEADs are intentionally retained, not force-synchronized to a newer
implementation. The authoritative structure remains the approved monorepo:

* `apps/backend`: NestJS application, controllers/services/DTOs, identity/action
  guards, Prisma data access, validation, `Commands.run`, database clock,
  transactional audit/idempotency, HTTP error handling and realtime access control.
* `apps/backend/prisma`: canonical schema and all 15 ordered SQL migrations,
  scoped constraints/indexes/runtime-role permissions and migration tests.
  `src/local-seed.ts` provides the explicitly local Admin seed boundary.
* `apps/dashboard`: Next.js pages/workspaces, components/styles, authenticated
  same-origin relay, scoped response projection and integration/Chrome tests.
* `apps/mobile`: README placeholder only. No Flutter/Dart, pubspec, Android/iOS,
  mobile assets, client, screens or tests were discovered in these worktrees.
  There is no external mobile source import or mobile-delivery claim. Keep the
  planned monorepo structure; any separately discovered repository requires owner
  review before import, not an automatic copy.
* `packages/api-contract`: committed OpenAPI snapshot; no duplicate API definition
  or generated client package was discovered.
* `infra`, `.github`, root manifests/lockfile/config templates, and `docs` remain
  their existing canonical sources. No background delivery worker is invented
  from the existing Socket.IO access-invalidation implementation.

## Integration provenance and reconciliation

Fresh fetch confirmed base
`62f8043433bcda4789efc879f4da9d8f94aafac5`. New branch:
**`integration/strength-studio-consolidation`**, new worktree
`/home/kraken/Programming/Projects/Strength Studio Consolidation`.

| Source commit | Evidence and treatment |
|---|---|
| `487872d` | Tree `fad98a7b3cb7a0eefb7de012cd90e781bb8ec071` equals `ef4ef65` from [merged PR #1](https://github.com/Strength-studio/strength-studio-backend/pull/1); stable patch IDs also equal. Already integrated; no replay or replacement. |
| `c189b9c` | Tree `0fa15da4539ecbdb6dd0e0149f41c9c8c65b0256` equals `55e442b` from [merged PR #2](https://github.com/Strength-studio/strength-studio-backend/pull/2); stable patch IDs equal. Already integrated, subsequently extended by `62f8043`; no replay. |
| `d1c45d999a2b1c93d3c94f52061efdb1f5835d91` | Direct child of base; imported **without rewriting its identity** using `git merge --ff-only origin/codex/m3-technical-readiness`. Ten intended test/documentation paths, no runtime/schema/contract changes. [Its Foundation CI](https://github.com/Strength-studio/strength-studio-backend/actions/runs/45243957593) also passed. Consolidated verification is separate below. |

Only three commit identities from the original branch refs were unreachable from
main. The first two are squash-history differences, not missing features. There
were no additional local-only dirty/stashed sources to import. No conflicting
business implementations or migration sequences required choosing a new policy.

The ten original paths imported with `d1c45d9` are:

```text
apps/dashboard/test/catalog.integration.test.cjs
docs/api-contract.md
docs/business-rules.md
docs/implementation-roadmap.md
docs/milestone-2-decision-register.md
docs/milestone-3-attendance-return-reaffirmation.md
docs/milestone-3-next-slices.md
docs/milestone-3-o09-owner-decision-brief.md
docs/milestone-3-technical-readiness.md
docs/open-decisions.md
```

The browser change preserves the existing Client-history assertion, waits for the
actual history-boundary hydration marker before exercising SPA navigation, and adds
document-identity diagnostics/assertion. It does not change runtime privacy guards,
add arbitrary delays/retries or remove unhydrated/account-switch/revocation tests.
The imported technical report retains original pre/post-fix stress evidence.

Manual consolidation changes are limited to:

* `.gitignore`: local logs/OS metadata and root-scoped temporary/cache/private/
  database directories; existing env/build/dependency exclusions stay intact.
  Legitimate source, `.env.example`, SQL migrations and mobile README remain
  trackable. No source or ignored local files were deleted.
* `README.md`: accurate current implemented scope, mobile-placeholder distinction
  and entry points to provenance/current application planning.
* `docs/milestone-3-technical-readiness.md`: distinguish its original uncommitted
  delivery from the later published `d1c45d9` and actual CI. Historical test
  evidence is preserved; no approval/deployment is inferred from publication.
* This report and the inventory: new consolidation provenance/review records.

The expected integration diff from base is **14 distinct intended paths**; the
manual consolidation commit touches five paths, one overlapping the imported
technical report. There are **137 tracked paths** after adding the two inventory/
report files. No old file variant overwrites a newer implementation.

## Feature completeness matrix

Integrated/tested is not the same as fully implemented, business-approved or
production-enabled. The [source-inspected roadmap](../milestone-3-next-slices.md)
contains the detailed layer-by-layer status and proposed future journeys.

| Application area | Source discovered | Integrated | Verification | Outstanding work |
|---|---|---|---|---|
| Backend foundation/security | All worktrees | Yes: identity, action guards, audit, commands, errors, revocation | Unit, security/backend integration and relay/browser regressions | Onboarding/recovery/Admin lifecycle policies and operational provisioning |
| Client management | All; Client APIs/dashboard | Yes: directory/detail/own reads | Backend/dashboard/Client-history tests | Creation/setup/profile writes; O-02 |
| Public packages/Memberships | All; catalog/version/terms schema and UI | Yes: versioned catalog and concurrent Memberships | Catalog/activation/booking tests | Private offers, full lifecycle and renewal cardinality |
| Purchases/payments/activation | Shared commercial commits | Yes: acceptance, manual record/Admin verify/allocate, funding and explicit activation | Backend plus funding/activation UI/browser tests | Entry UI journey, installments, credit/refunds and wider finance contracts |
| Coach management/manual assignment | Scheduling implementation | Yes: existing profiles, active picker and manual session assignment | Scheduling scope/conflict/race tests | Operational provisioning, availability requests and mobile |
| Scheduling/booking | Historical W1 already integrated | Yes: Admin booking decisions, capacity and exact-Membership commitments | Backend/database/dashboard/Chrome | Client requests, holds/waitlists/rescheduling policies; O-08 |
| Attendance | W2 squash, W3 return/reaffirmation | Yes: assigned ATTENDED submission and explicit reaffirmation, Admin return, immutable history | Role/concurrency/migration/relay/Chrome | Verification/deduction, new outcomes/full correction; O-09 |
| Entitlement ledger | Initial allowance/validity and commitment projections only | Existing representations preserved; **no usage ledger implemented** | Existing activation/commitment tests only | Approved canonical grants/ledger/reconciliation design before any debit |
| Admin reporting | Existing operational pages/scoped audit | Present implemented scope only | Existing page/API tests | Consolidated queues/reconciliation/export and authorization contracts |
| Notifications/background delivery | Realtime access invalidation only | Existing access-control hints preserved | Socket/invalidation tests | No inbox/outbox/SMTP/worker/reminder delivery; O-09-D/O-11 |
| Staff accounts/permissions | Foundation/current action map | Yes: Admin grant/disable primitives | Independent grant, legacy-denial and revocation tests | Provisioning/management UI; no authority from dormant enums |
| Audit/traceability | Shared writer/events/revision history | Yes: append-only runtime evidence and replay safeguards | Audit rollback/permissions/history tests | General viewer, retention/archival/redaction and future posting sources |
| Client/Coach mobile | README in every worktree | Placeholder preserved | Mobile analysis/tests **not applicable; no source exists** | Entire authorized Flutter interface milestone and prerequisites |

All original schema and 15 migration directories are present, in their original
order and byte-identical to base. No new migration, seed behavior, API route/DTO,
OpenAPI field, dashboard runtime component or mobile source is introduced by
consolidation. Dashboard change relative to base is only the imported test fix;
current workspaces/relay/security remain authoritative.

## Business boundaries and exclusions

O-09-A–G all remain unresolved. The [owner brief](../milestone-3-o09-owner-decision-brief.md)
is recommendations/Pending responses, not approval. Production attendance capture
remains gated by O-09-A and the unchanged `attendanceCaptureForTesting` mechanism.
Attendance is held only after Coach submission and eventual Admin verification;
this candidate contains no verification or entitlement deduction. Future use must
affect only the original Booking Membership, never another Membership.

Pending Bookings reserve no seat/commitment; confirmed Bookings do. Preserve
original Booking/cancellation/audit and served-Coach history. Manual payments,
purchase allocations, Admin activation and entitlement are separate operations.
Commission is Admin-only. New outcomes, full correction, delivery, branch
operations and online gateways are not consolidation features.

M3-T01–T04 are retained in the technical report with their verification evidence,
not silently removed. M3-L01 ledger/design/reconciliation, M3-N01 next-slice
authorization, M3-N02 repeat-purchase cardinality and broader O-02/O-08/O-11–O-14
gates remain. No dependent implementation starts by importing a planning document.

Intentionally excluded: actual `.env`/credentials; node_modules; `.next`/dist/
TypeScript caches; temporary logs/toolchains/native database files; unrelated
projects; and replaying squash-equivalent historical commits. These are either
local artifacts, outside the discovered canonical source, or already integrated.
No legitimate source from the four inventoried worktrees is left unaccounted for.
Older variants remain in original branches/worktrees/history rather than becoming
duplicate modules. No removal of source or historical work is proposed/performed.

## Consolidated verification

Fresh verification uses Node **22.23.5**, pnpm **10.34.9**, Prisma **6.19.3** and
PostgreSQL **17.10**, matching declared versions and the resolved Node version of
published CI. Node and native PostgreSQL packages were downloaded from official
sources and hash-checked. No dependency/lockfile or CI/Compose settings were changed.
Docker is unavailable locally: native Ubuntu PG17.10 is used, not claimed to be an
identical Debian Bookworm OS/locale/performance environment. The unchanged CI runs
the declared `postgres:17.10-bookworm` image separately.

Disposable cluster: task-owned temporary directory, loopback **127.0.0.1:55429**,
fresh `strength_studio` template, freshly generated local test signing/CSRF keys,
and random per-suite databases. No original worktree environment or database is
modified. The template contains only freshly applied migrations; each suite seeds
and cleans its own disposable copy. No production connection is used.

All commands below ran on this consolidated candidate, with the exact-version
toolchain prepended to PATH. No previous report's pass count is substituted for
these runs.

| Command / check | Actual result |
|---|---|
| `pnpm install --frozen-lockfile --offline` | Passed with pnpm 10.34.9; all 216 pinned packages reused; no lockfile change. Default dependency lifecycle warnings were handled by explicit Prisma generation, not blanket script approval. |
| `pnpm db:generate` | Prisma Client 6.19.3 generated successfully. |
| `pnpm db:migrate` | All **15 migrations** applied to the fresh disposable PostgreSQL 17.10 template. |
| `pnpm verify` | Backend and dashboard production builds and TypeScript checks passed; **11 unit / 99 backend integration passed**, zero skipped/failed. Includes security, schema upgrades, role denials, audit rollback, idempotency and concurrency tests. |
| `node --env-file=.env --test apps/dashboard/test/catalog.integration.test.cjs` | **13 passed, 0 failed, 16 browser cases skipped** because this invocation did not select Chrome. Those browser cases passed separately below. |
| Chrome Client-history group | **8 passed**, zero failed/skipped. |
| Chrome purchase-funding/activation group | **3 passed**, zero failed/skipped. |
| Chrome scheduling/booking group | **3 passed**, zero failed/skipped. |
| Chrome attendance group | **2 passed**, zero failed/skipped. All four groups ran concurrently; total **16 browser tests passed**. |
| `pnpm openapi` then `git diff --exit-code origin/main -- packages/api-contract/openapi.json` | Passed; unchanged snapshot SHA-256 `e754aa61ee7926a5d4f6a787de9601271c9759616c5e569a266bc01ef7a461bc`. |
| Prisma `validate` and `migrate diff --from-url` (disposable owner URL) `--to-schema-datamodel apps/backend/prisma/schema.prisma --exit-code` | Schema valid; exit 0, “No difference detected.” This compares Prisma-supported schema objects; custom constraints/roles are exercised by integration tests. |
| Mobile analysis/tests | **Not applicable**, no mobile implementation/pubspec/SDK contract discovered; not counted as passed. |
| `git diff --check`, conflict-marker/case-path/credential-pattern checks and Markdown local-target/fragment checks | Passed; no conflict markers, case collisions or credential-pattern findings; **106** local Markdown references checked before final publication text update. |

Each browser command used Chrome **158.0.8127.36** and the common prefix
`STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --env-file=.env --test`,
followed by `--test-name-pattern='<pattern>' apps/dashboard/test/catalog.integration.test.cjs`.
The exact patterns were `Client browser history`,
`Purchase funding viewer|Membership activation in Chrome`,
`Scheduling in Chrome|Booking management in Chrome`, and `Attendance in Chrome`.
These are the documented separate-process regression groups; no assertion or
timeout was weakened and no failed execution was omitted.

The full local logs are task-local under `/tmp/strength-consolidation-toolchain`;
durable counts/commands/provenance are this report and the PR summary. The
disposable database is stopped after suite cleanup. GitHub Actions status for the
published integration tip is checked separately through the PR; no local result
is mislabeled as a new remote CI run.

## Hygiene/security review

Review covers tracked/new source inventory, secrets/key/token patterns without
printing values, env/generated-data exclusions, migration uniqueness/content,
case-fold path collisions, local imports/assets through builds/type checking,
Markdown targets/fragments, whitespace/conflict markers and intended diff scope.
Local filesystem paths in historical reports/inventory are evidence, not runtime
configuration; application/packages/infra/CI contain no machine-specific home/tmp
path dependency. No actual env/secret, dependency directory or generated output
is included in the reviewed integration diff. `.env.example` remains the existing
development template and is not populated from a local env file.

## Publication and final identity

Final branch: `integration/strength-studio-consolidation`. Imported source commit:
`d1c45d999a2b1c93d3c94f52061efdb1f5835d91`. Discovery/review base:
`62f8043433bcda4789efc879f4da9d8f94aafac5`.

The consolidation commit containing this report cannot embed its own hash. Its
exact immutable SHA is recorded in the PR verification summary/final delivery,
and is resolved by `git rev-parse integration/strength-studio-consolidation`.
The PR's head commit is the publication authority; the report is part of that
same reviewed commit. Publication is to the integration branch only, with a PR
targeting main; **no force push, direct main update or PR merge is authorized**.

Remote main is fetched again before publication; any advance is reconciled
without rewriting published history and reverified as needed. The integration
branch must match its remote after push; original branches/worktrees remain
unchanged. This candidate is published for review, not silently merged into main.

**No production migration, deployment, production configuration change or
attendance-capture activation occurs in this work.** Production readiness is not
declared; feature/business/infrastructure gates above remain explicit.
