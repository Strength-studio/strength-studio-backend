# Worktree inventory and reconciliation plan

Discovery snapshot: 23 November 2026, before any source/branch changes. Canonical repository: `Strength-studio/strength-studio-backend`, remote `origin`, target `main`.

Freshly fetched remote baseline: `62f8043433bcda4789efc879f4da9d8f94aafac5`. All four directories are linked worktrees, not independent repositories. Shared Git directory: `/home/kraken/Programming/Projects/Strength Studio/.git`. Local main also points to this baseline. No stashes exist.

## Worktrees

| ID | Absolute path / Git root | Branch | HEAD | Upstream | Ahead/behind main | Ahead/behind upstream | Tracked paths |
|---|---|---|---|---|---|---|---|
| W1 | `/home/kraken/Programming/Projects/Strength Studio` | `fix/booking-future-session-validation` | `487872d3287116c4ab5b7430cfab0b0573b0e292` | `origin/fix/booking-future-session-validation` | 1 / 3 | 0 / 0 | 123 |
| W2 | `/home/kraken/Programming/Projects/Strength Studio M3-S1` | `codex/m3-s1-coach-attendance` | `c189b9c0314dbea7202524ca2be5399307a3e29c` | `origin/codex/m3-s1-coach-attendance` | 1 / 2 | 0 / 0 | 130 |
| W3 | `/home/kraken/Programming/Projects/Strength Studio M3-S1-PR2` | `codex/m3-s1-attendance-corrections` | `62f8043433bcda4789efc879f4da9d8f94aafac5` | `origin/main` | 0 / 0 | 0 / 0 | 132 |
| W4 | `/home/kraken/Programming/Projects/Strength Studio Next Milestone` | `codex/m3-technical-readiness` | `d1c45d999a2b1c93d3c94f52061efdb1f5835d91` | `origin/codex/m3-technical-readiness` | 1 / 0 | 0 / 0 | 135 |

All four worktrees have empty staged, unstaged and untracked-file lists. Each has a local ignored `.env`; no values were read into this inventory. Local `.env` mode is `0600` in each. Their generated/dependency directories remain local and are not import candidates.

## Ignored development artifacts

**W1:** `.env`, `apps/backend/dist/`, `apps/backend/node_modules/`, `apps/dashboard/.next/`, `apps/dashboard/next-env.d.ts`, `apps/dashboard/node_modules/`, `apps/dashboard/tsconfig.tsbuildinfo`, `node_modules/`.

**W2:** `.env`, `apps/backend/dist/`, `apps/backend/node_modules/`, `apps/dashboard/.next/`, `apps/dashboard/next-env.d.ts`, `apps/dashboard/node_modules/`, `node_modules/`.

**W3:** `.env`, `apps/backend/dist/`, `apps/backend/node_modules/`, `apps/dashboard/.next/`, `apps/dashboard/next-env.d.ts`, `apps/dashboard/node_modules/`, `node_modules/`.

**W4:** `.env`, `apps/backend/dist/`, `apps/backend/node_modules/`, `apps/dashboard/.next/`, `apps/dashboard/next-env.d.ts`, `apps/dashboard/node_modules/`, `node_modules/`.

## Remotes and refs

All worktrees share this remote configuration:

```text
origin	https://github.com/Strength-studio/strength-studio-backend.git (fetch)
origin	https://github.com/Strength-studio/strength-studio-backend.git (push)
```

All local/remote branch refs at discovery:

```text
refs/heads/codex/m3-s1-attendance-corrections 62f8043433bcda4789efc879f4da9d8f94aafac5
refs/heads/codex/m3-s1-coach-attendance c189b9c0314dbea7202524ca2be5399307a3e29c
refs/heads/codex/m3-technical-readiness d1c45d999a2b1c93d3c94f52061efdb1f5835d91
refs/heads/fix/booking-future-session-validation 487872d3287116c4ab5b7430cfab0b0573b0e292
refs/heads/main 62f8043433bcda4789efc879f4da9d8f94aafac5
refs/remotes/origin/codex/m3-s1-coach-attendance c189b9c0314dbea7202524ca2be5399307a3e29c
refs/remotes/origin/codex/m3-technical-readiness d1c45d999a2b1c93d3c94f52061efdb1f5835d91
refs/remotes/origin/fix/booking-future-session-validation 487872d3287116c4ab5b7430cfab0b0573b0e292
refs/remotes/origin/main 62f8043433bcda4789efc879f4da9d8f94aafac5
```

## Commits not reachable from canonical main

Three commit identities are not reachable from main. Reachability alone does not establish missing functionality.

| Commit | Evidence | Classification / action |
|---|---|---|
| `487872d3287116c4ab5b7430cfab0b0573b0e292` | Entire tree equals merged `ef4ef65c81ed77b98efffce7e82b586fd3422db3`; stable patch ID `5bb24feae69b9943fcc14bd6d55c86cfc74c768d`. PR #1 is merged. | Already integrated by squash; preserve historical branch, do not replay. |
| `c189b9c0314dbea7202524ca2be5399307a3e29c` | Entire tree equals merged `55e442bfe06a1efe6e7a421e4119a28108d9f442`; stable patch ID `c2b16b814c569dfe4831ecaacc3d87b4149012ba`. PR #2 is merged. | Already integrated by squash, with later return/reaffirmation work on main; preserve branch, do not replay. |
| `d1c45d999a2b1c93d3c94f52061efdb1f5835d91` | Direct child of canonical `62f8043`, published on `origin/codex/m3-technical-readiness`; ten files changed. | Needs integration: preserve exact commit via fast-forward into a new integration branch, then add consolidation records/hygiene. |

## Missing paths and changed-file reconciliation

Main has **132** tracked paths; the union of all four worktrees has **135**. There are no additional Git-visible untracked source files. Three paths exist only in W4 and are absent from main:

* `docs/milestone-3-next-slices.md`
* `docs/milestone-3-o09-owner-decision-brief.md`
* `docs/milestone-3-technical-readiness.md`

All ten changes missing from main are precisely the published technical-readiness commit:

```text
M	apps/dashboard/test/catalog.integration.test.cjs
M	docs/api-contract.md
M	docs/business-rules.md
M	docs/implementation-roadmap.md
M	docs/milestone-2-decision-register.md
M	docs/milestone-3-attendance-return-reaffirmation.md
A	docs/milestone-3-next-slices.md
A	docs/milestone-3-o09-owner-decision-brief.md
A	docs/milestone-3-technical-readiness.md
M	docs/open-decisions.md
```

The sole test change waits for the existing hydration marker in an SPA-specific scenario, keeps the original marker assertion and adds a same-document assertion. Documents distinguish historical/published verification, retain O-09-A–G as Pending, propose future journeys/ledger review, and introduce no runtime business behavior.

## Feature reconciliation matrix

| Feature | Source | Main implementation | Missing changes | Dependencies | Proposed action / classification |
|---|---|---|---|---|---|
| Booking management / past-start validation | W1, shared history | Management in `27cb12a`, validation squash `ef4ef65`; included in `62f8043` | None | Booking migration; Membership then session locks; dashboard and tests | Already integrated; W1 remains historical reference. |
| Scheduling foundation / manual Coach assignment | All worktrees, `e1ab14d` | Included; Admin workspace, overlap/capacity constraints and API | None | Scheduling migration/settings; identity and session locks | Already integrated; no automatic assignment or new hold rules. |
| Membership activation | All worktrees, `29b7e88` | Explicit Admin activation, dates/initial allowance, audited override | None | Activation migration, frozen purchase/funding evidence | Already integrated; future lifecycle/ledger requires development/decisions. |
| Purchase funding / payment record, verify, allocate | All worktrees, shared commercial commits | Included API, funding/activation UI, scope/amount checks | None | Payment/allocation migrations and independent authorization | Already integrated; installments/credit/refunds not invented. |
| Coach attendance submission | W2 `c189b9c`, squash `55e442b` | Included; per-participant append-only revisions, served attribution | None | Attendance migration, own-session scope, gate, relay/tests | Already integrated; do not replace later service with W2. |
| Admin return / Coach ATTENDED reaffirmation | W3 `62f8043` | Included RETURNED-only decisions, immutable history, explicit acknowledgment | None | Return migration, `Commands.run`, unique decisions, role checks | Already integrated; verification/deduction remains out of scope. |
| Client-history reliability | W4 `d1c45d9` | Application guard present; SPA test has the previously reproduced readiness race | One test-only readiness/diagnostic change | Existing boundary layout effect and browser harness; no runtime change | Needs integration and consolidated stress/regression verification. |
| Identity, permissions, audit, idempotency, secure relay | All worktrees | Included current implementation; no authority inferred from dormant enums | None | Foundation and later scoped grants; backend guards and relay controls | Already integrated; preserve exact implementation and all negative tests. |
| OpenAPI / Prisma / configuration | All worktrees | Snapshot and all 15 migrations present | None | Pinned workspace, Prisma 6.19.3, Compose PG17.10 | Already integrated; regenerate/compare, no migration renumbering. |
| O-09 brief, actual CI closeout and whole-app roadmap | W4 `d1c45d9` | Earlier attendance docs present | Nine documentation changes, three new documents | Preserve Pending owner statuses and original verification provenance | Needs integration; proposals are not implementation approvals. |
| Mobile | All worktrees | `apps/mobile/README.md` only | No Flutter/Dart/platform source discovered in these worktrees | Future interface milestone; scoped backend contracts | Requires further development; retain monorepo placeholder, import no external project. |
| Verification, deduction, new outcomes, full correction, notifications | Documented future work | Not implemented; production attendance gate closed | No authorized implementation discovered | O-09 policy, ledger design, notification infrastructure | Requires business decision/further development; not consolidation scope. |

## Conflicts, exclusions and plan

No conflicting uncommitted implementations, migration numbering collisions, external source directory or mixed-repository import was found. Older file variants are preserved by Git history; they must not overwrite their descendants. No branch, worktree, test or source removal is proposed.

The approved architecture is the existing NestJS/Next.js/Flutter-placeholder monorepo with API contracts, infra and docs. No independent mobile repository is imported or claimed to exist. Discovery is limited to the four known canonical worktrees; unrelated projects were not treated as application source.

After producing this inventory: (1) create `integration/strength-studio-consolidation` from fresh `origin/main` in a separate worktree; (2) fast-forward that branch to exact `d1c45d9` after rechecking its ancestry; (3) add this inventory, final report and minimal justified ignore/documentation hygiene; (4) verify with declared versions and disposable data; (5) commit only the reviewed consolidation changes, push the integration branch, open a PR to main; (6) leave the PR unmerged and all historical worktrees/branches intact.

## Complete path/variant inventory

`=` means byte-identical tracked blob to canonical main; `older/different` is a historical or W4 variant to reconcile by history; `new` is absent from main; `—` is absent from that worktree. The final column identifies the most recent canonical change, or the missing source commit for new documents. No ignored artifact is counted as source.

| Path | W1 | W2 | W3 | W4 | Main/source last change |
|---|---|---|---|---|---|
| `.env.example` | = | = | = | = | `d8390ab` |
| `.github/workflows/foundation.yml` | = | = | = | = | `d8390ab` |
| `.gitignore` | = | = | = | = | `d8390ab` |
| `README.md` | older/different | older/different | = | = | `62f8043` |
| `apps/backend/package.json` | = | = | = | = | `d8390ab` |
| `apps/backend/prisma/migrations/20261104000100_foundation/migration.sql` | = | = | = | = | `d8390ab` |
| `apps/backend/prisma/migrations/20261110000100_public_catalog/migration.sql` | = | = | = | = | `ee5cf7c` |
| `apps/backend/prisma/migrations/20261112000100_complimentary_acceptance/migration.sql` | = | = | = | = | `2b496c8` |
| `apps/backend/prisma/migrations/20261112000200_purchase_records/migration.sql` | = | = | = | = | `6b5fa0f` |
| `apps/backend/prisma/migrations/20261112000300_complimentary_purchase_uniqueness/migration.sql` | = | = | = | = | `2de650d` |
| `apps/backend/prisma/migrations/20261112000400_positive_price_purchase_type/migration.sql` | = | = | = | = | `d3fcc3d` |
| `apps/backend/prisma/migrations/20261112000500_positive_price_purchase_uniqueness/migration.sql` | = | = | = | = | `d3fcc3d` |
| `apps/backend/prisma/migrations/20261112000600_payment_recording/migration.sql` | = | = | = | = | `4b055bf` |
| `apps/backend/prisma/migrations/20261113000100_payment_verification/migration.sql` | = | = | = | = | `57afc8c` |
| `apps/backend/prisma/migrations/20261113000200_payment_allocation/migration.sql` | = | = | = | = | `c58b64f` |
| `apps/backend/prisma/migrations/20261114000100_membership_activation/migration.sql` | = | = | = | = | `29b7e88` |
| `apps/backend/prisma/migrations/20261114000200_scheduling_foundation/migration.sql` | = | = | = | = | `e1ab14d` |
| `apps/backend/prisma/migrations/20261116000100_booking_management/migration.sql` | = | = | = | = | `27cb12a` |
| `apps/backend/prisma/migrations/20261117000100_attendance_submission/migration.sql` | — | = | = | = | `55e442b` |
| `apps/backend/prisma/migrations/20261123000100_attendance_return_reaffirmation/migration.sql` | — | — | = | = | `62f8043` |
| `apps/backend/prisma/migrations/migration_lock.toml` | = | = | = | = | `d8390ab` |
| `apps/backend/prisma/schema.prisma` | older/different | older/different | = | = | `62f8043` |
| `apps/backend/src/app.ts` | older/different | = | = | = | `55e442b` |
| `apps/backend/src/attendance/attendance.controller.ts` | — | older/different | = | = | `62f8043` |
| `apps/backend/src/attendance/attendance.dto.ts` | — | older/different | = | = | `62f8043` |
| `apps/backend/src/attendance/attendance.service.ts` | — | older/different | = | = | `62f8043` |
| `apps/backend/src/bookings/booking.controller.ts` | = | = | = | = | `ef4ef65` |
| `apps/backend/src/bookings/booking.dto.ts` | = | = | = | = | `27cb12a` |
| `apps/backend/src/bookings/booking.service.ts` | = | = | = | = | `ef4ef65` |
| `apps/backend/src/catalog/catalog.controller.ts` | = | = | = | = | `ee5cf7c` |
| `apps/backend/src/catalog/catalog.dto.ts` | = | = | = | = | `ee5cf7c` |
| `apps/backend/src/catalog/catalog.service.ts` | = | = | = | = | `ee5cf7c` |
| `apps/backend/src/clients/client.controller.ts` | = | = | = | = | `67abed3` |
| `apps/backend/src/clients/client.dto.ts` | = | = | = | = | `67abed3` |
| `apps/backend/src/clients/client.service.ts` | = | = | = | = | `67abed3` |
| `apps/backend/src/identity/access-events.ts` | = | = | = | = | `d8390ab` |
| `apps/backend/src/identity/access.guard.ts` | = | = | = | = | `d8390ab` |
| `apps/backend/src/identity/identity.controller.ts` | = | = | = | = | `ee5cf7c` |
| `apps/backend/src/identity/identity.dto.ts` | = | = | = | = | `d8390ab` |
| `apps/backend/src/identity/password.ts` | = | = | = | = | `d8390ab` |
| `apps/backend/src/identity/permissions.ts` | older/different | older/different | = | = | `62f8043` |
| `apps/backend/src/identity/realtime.ts` | = | = | = | = | `d8390ab` |
| `apps/backend/src/identity/session.service.ts` | = | = | = | = | `d8390ab` |
| `apps/backend/src/local-seed.ts` | = | = | = | = | `d8390ab` |
| `apps/backend/src/main.ts` | = | = | = | = | `d8390ab` |
| `apps/backend/src/openapi.ts` | = | = | = | = | `67abed3` |
| `apps/backend/src/payments/payment.controller.ts` | = | = | = | = | `c58b64f` |
| `apps/backend/src/payments/payment.dto.ts` | = | = | = | = | `c58b64f` |
| `apps/backend/src/payments/payment.service.ts` | = | = | = | = | `c58b64f` |
| `apps/backend/src/platform/audit.ts` | = | = | = | = | `29b7e88` |
| `apps/backend/src/platform/commands.ts` | = | = | = | = | `ee5cf7c` |
| `apps/backend/src/platform/config.ts` | older/different | = | = | = | `55e442b` |
| `apps/backend/src/platform/database.ts` | = | = | = | = | `d8390ab` |
| `apps/backend/src/platform/health.controller.ts` | = | = | = | = | `d8390ab` |
| `apps/backend/src/platform/http.ts` | = | = | = | = | `d8390ab` |
| `apps/backend/src/platform/riyadh-calendar.ts` | = | = | = | = | `27cb12a` |
| `apps/backend/src/purchases/complimentary.controller.ts` | = | = | = | = | `d3fcc3d` |
| `apps/backend/src/purchases/membership-activation.dto.ts` | = | = | = | = | `29b7e88` |
| `apps/backend/src/purchases/membership-activation.service.ts` | = | = | = | = | `27cb12a` |
| `apps/backend/src/purchases/positive-price.controller.ts` | = | = | = | = | `d3fcc3d` |
| `apps/backend/src/purchases/purchase-acceptance.dto.ts` | = | = | = | = | `29b7e88` |
| `apps/backend/src/purchases/purchase-acceptance.service.ts` | = | = | = | = | `29b7e88` |
| `apps/backend/src/purchases/purchase-funding.controller.ts` | = | = | = | = | `29b7e88` |
| `apps/backend/src/purchases/purchase-funding.dto.ts` | = | = | = | = | `29b7e88` |
| `apps/backend/src/purchases/purchase-funding.service.ts` | = | = | = | = | `29b7e88` |
| `apps/backend/src/scheduling/scheduling.controller.ts` | = | = | = | = | `e1ab14d` |
| `apps/backend/src/scheduling/scheduling.dto.ts` | = | = | = | = | `e1ab14d` |
| `apps/backend/src/scheduling/scheduling.service.ts` | = | = | = | = | `e1ab14d` |
| `apps/backend/src/studio/studio.controller.ts` | = | = | = | = | `d8390ab` |
| `apps/backend/test/foundation.integration.test.cjs` | older/different | older/different | = | = | `62f8043` |
| `apps/backend/test/membership-activation.unit.test.cjs` | = | = | = | = | `29b7e88` |
| `apps/backend/test/security.unit.test.cjs` | older/different | older/different | = | = | `62f8043` |
| `apps/backend/tsconfig.json` | = | = | = | = | `d8390ab` |
| `apps/dashboard/app/api/session/[action]/route.ts` | = | = | = | = | `d8390ab` |
| `apps/dashboard/app/api/studio/v1/[...path]/route.ts` | older/different | older/different | = | = | `62f8043` |
| `apps/dashboard/app/attendance/page.tsx` | — | = | = | = | `55e442b` |
| `apps/dashboard/app/attendance/workspace.tsx` | — | older/different | = | = | `62f8043` |
| `apps/dashboard/app/bookings/page.tsx` | = | = | = | = | `27cb12a` |
| `apps/dashboard/app/bookings/workspace.tsx` | = | = | = | = | `ef4ef65` |
| `apps/dashboard/app/catalog/actions.tsx` | = | = | = | = | `bfe79e2` |
| `apps/dashboard/app/catalog/dashboard.tsx` | = | = | = | = | `27cb12a` |
| `apps/dashboard/app/catalog/ui.tsx` | = | = | = | = | `67abed3` |
| `apps/dashboard/app/clients/[id]/page.tsx` | = | = | = | = | `67abed3` |
| `apps/dashboard/app/clients/history-boundary.tsx` | = | = | = | = | `b51f789` |
| `apps/dashboard/app/clients/history-guard.tsx` | = | = | = | = | `b51f789` |
| `apps/dashboard/app/clients/loading.tsx` | = | = | = | = | `67abed3` |
| `apps/dashboard/app/clients/page.tsx` | = | = | = | = | `67abed3` |
| `apps/dashboard/app/clients/ui.tsx` | = | = | = | = | `f5071b7` |
| `apps/dashboard/app/globals.css` | = | = | = | = | `e1ab14d` |
| `apps/dashboard/app/layout.tsx` | = | = | = | = | `b51f789` |
| `apps/dashboard/app/page.tsx` | older/different | = | = | = | `55e442b` |
| `apps/dashboard/app/purchase-funding/activation.tsx` | = | = | = | = | `29b7e88` |
| `apps/dashboard/app/purchase-funding/page.tsx` | = | = | = | = | `5ccdd06` |
| `apps/dashboard/app/purchase-funding/viewer.tsx` | = | = | = | = | `29b7e88` |
| `apps/dashboard/app/scheduling/page.tsx` | = | = | = | = | `27cb12a` |
| `apps/dashboard/app/scheduling/workspace.tsx` | older/different | = | = | = | `55e442b` |
| `apps/dashboard/lib/attendance.ts` | — | older/different | = | = | `62f8043` |
| `apps/dashboard/lib/bookings.ts` | = | = | = | = | `27cb12a` |
| `apps/dashboard/lib/catalog-relay.ts` | older/different | older/different | = | = | `62f8043` |
| `apps/dashboard/lib/catalog.ts` | = | = | = | = | `29b7e88` |
| `apps/dashboard/lib/client-relay.ts` | = | = | = | = | `f5071b7` |
| `apps/dashboard/lib/purchase-funding-relay.ts` | = | = | = | = | `29b7e88` |
| `apps/dashboard/lib/purchase-funding.ts` | = | = | = | = | `29b7e88` |
| `apps/dashboard/lib/scheduling.ts` | older/different | = | = | = | `55e442b` |
| `apps/dashboard/lib/session.ts` | = | = | = | = | `bfe79e2` |
| `apps/dashboard/local-dev.cjs` | = | = | = | = | `d8390ab` |
| `apps/dashboard/package.json` | = | = | = | = | `d8390ab` |
| `apps/dashboard/test/catalog.integration.test.cjs` | older/different | older/different | = | older/different | `62f8043` |
| `apps/dashboard/test/chrome.cjs` | = | = | = | = | `e2595cc` |
| `apps/dashboard/tsconfig.json` | = | = | = | = | `d8390ab` |
| `apps/mobile/README.md` | = | = | = | = | `d8390ab` |
| `compose.dev.yml` | = | = | = | = | `d8390ab` |
| `docs/api-contract.md` | older/different | older/different | = | older/different | `62f8043` |
| `docs/architecture-decisions.md` | = | = | = | = | `ee5cf7c` |
| `docs/architecture-review.md` | = | = | = | = | `ee5cf7c` |
| `docs/business-rules.md` | older/different | older/different | = | older/different | `62f8043` |
| `docs/data-dictionary.md` | = | = | = | = | `ee5cf7c` |
| `docs/domain-model.md` | = | = | = | = | `ee5cf7c` |
| `docs/implementation-roadmap.md` | = | = | = | older/different | `27cb12a` |
| `docs/milestone-0-final-readiness-audit.md` | = | = | = | = | `d8390ab` |
| `docs/milestone-2-decision-register.md` | older/different | older/different | = | older/different | `62f8043` |
| `docs/milestone-2-implementation-plan.md` | = | = | = | = | `ee5cf7c` |
| `docs/milestone-2-readiness-review.md` | = | = | = | = | `ee5cf7c` |
| `docs/milestone-2-technical-contracts.md` | = | = | = | = | `ee5cf7c` |
| `docs/milestone-3-attendance-return-reaffirmation.md` | — | — | = | older/different | `62f8043` |
| `docs/milestone-3-next-slices.md` | — | — | — | new | `d1c45d9` |
| `docs/milestone-3-o09-owner-decision-brief.md` | — | — | — | new | `d1c45d9` |
| `docs/milestone-3-technical-readiness.md` | — | — | — | new | `d1c45d9` |
| `docs/open-decisions.md` | older/different | older/different | = | older/different | `62f8043` |
| `docs/permission-matrix.md` | older/different | older/different | = | = | `62f8043` |
| `infra/postgres/01-local-roles.sh` | = | = | = | = | `d8390ab` |
| `package.json` | = | = | = | = | `d8390ab` |
| `packages/api-contract/openapi.json` | older/different | older/different | = | = | `62f8043` |
| `pnpm-lock.yaml` | = | = | = | = | `d8390ab` |
| `pnpm-workspace.yaml` | = | = | = | = | `d8390ab` |
