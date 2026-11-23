# M3 technical readiness increment

Date: 23 November 2026. Scope: M3-T04 synchronization, M3-T03 closeout evidence,
M3-T01 version parity, M3-T02 Client-history reliability, O-09 decision facilitation,
and whole-application planning. No new business capability or production activation
is authorized by this report.

## Baseline, branch and preservation

Fresh `git fetch --prune origin` confirmed the expected canonical baseline:
`62f8043433bcda4789efc879f4da9d8f94aafac5`. All three existing worktrees were clean,
including untracked-file checks. Local `main` was
`27cb12ad80c27c2180fd6862301dd9256a65ec21`; its upstream was `origin/main` and the
remote was a direct three-commit descendant. `git merge-base --is-ancestor main
origin/main` succeeded. `git fetch origin main:main` performed only that safe
fast-forward; local `main` and `origin/main` now resolve to the canonical SHA.

A new worktree `Strength Studio Next Milestone`, branch
`codex/m3-technical-readiness`, was created from that SHA. It contains this
increment's uncommitted changes. The existing worktrees/branches remain intact:

| Worktree | Branch | Preserved HEAD |
|---|---|---|
| Strength Studio | `fix/booking-future-session-validation` | `487872d3287116c4ab5b7430cfab0b0573b0e292` |
| Strength Studio M3-S1 | `codex/m3-s1-coach-attendance` | `c189b9c0314dbea7202524ca2be5399307a3e29c` |
| Strength Studio M3-S1-PR2 | `codex/m3-s1-attendance-corrections` | `62f8043433bcda4789efc879f4da9d8f94aafac5` |

No reset, rebase, branch deletion, historical-worktree modification, commit, push,
merge or PR creation was performed by this increment.

## M3-T03 — Published closeout evidence

The [attendance implementation report](milestone-3-attendance-return-reaffirmation.md)
now distinguishes original uncommitted local delivery at parent `55e442b`, the
subsequent published `62f8043` commit, actual CI, and this later technical work.
Historical PostgreSQL 16/pnpm 11 results remain labeled as the earlier local run.
Commit metadata is not presented as a PR, review or deployment record.

Verified with GitHub's API and downloaded job log:

```sh
gh api 'repos/Strength-studio/strength-studio-backend/actions/runs?head_sha=62f8043433bcda4789efc879f4da9d8f94aafac5&per_page=20'
gh api repos/Strength-studio/strength-studio-backend/actions/runs/45219323033/jobs
gh run view 45219323033 --repo Strength-studio/strength-studio-backend --log
```

[Foundation run 45219323033](https://github.com/Strength-studio/strength-studio-backend/actions/runs/45219323033),
attempt 1, event `push`, branch `main`, exact canonical SHA: **completed/success**.
The [verify job](https://github.com/Strength-studio/strength-studio-backend/actions/runs/45219323033/job/137848960225)
ran 18:41:28–18:42:24 Africa/Cairo on 23 November 2026. It records Node 22.23.5,
pnpm 10.34.9 and pull/start of `postgres:17.10-bookworm`. Frozen installation,
disposable migration setup, `pnpm verify` (11 unit / 99 backend integration tests,
zero failures), OpenAPI comparison and database cleanup passed. This workflow does
not run dashboard integration/browser tests, deploy, or activate capture. No PR or
human-review claim is inferred from CI success.

## M3-T01 — Declared and tested environment

| Component | Repository declaration | Verified local execution |
|---|---|---|
| Node | `package.json` >=20.19.0; Actions `node-version: 22`, no patch pin | **22.23.5**, matching the published CI resolution |
| pnpm | `packageManager: pnpm@10.34.9` | **10.34.9**, no dependency-check override |
| PostgreSQL | Compose `postgres:17.10-bookworm` | **17.10**, official PGDG Ubuntu native package in a disposable cluster |
| Prisma | Client/CLI **6.19.3** | Generated Client/validated schema and migration comparison with 6.19.3 |
| Dependencies | `pnpm-lock.yaml` format 9.0 and exact workspace versions/overrides | `pnpm install --frozen-lockfile --offline` passed: 216 packages reused; no lockfile/manifest change |
| Browser | Local Chrome required by documented browser suite, no repository version pin | Chrome **158.0.8127.36** |

Node's archive was downloaded from the official v22 distribution and checked
against its SHA-256 list. pnpm's package was checked against its registry SHA-512
integrity. The PostgreSQL 17.10 server/client packages were downloaded from PGDG
and checked against that repository's package SHA-256 metadata. Tools were extracted
under `/tmp/strength-next-toolchain`; no system installation or declaration change
was needed. Native PostgreSQL bound only to 127.0.0.1:55428, in a new task-owned
cluster with disposable roles/template/test databases and no production connection.

Actual setup/run used a PATH prefix containing Node 22.23.5 and pnpm 10.34.9,
fresh local `.env` test values/random auth/CSRF keys, an isolated `strength_studio`
template, and the existing suites' random disposable databases. The pre-existing
worktree `.env` files/databases were not used or modified. Explicit Prisma
generation follows pnpm's default ignored dependency lifecycle-script warning;
scripts were not globally permitted or dependency versions altered to bypass it.

**Parity conclusion:** Node/pnpm/PostgreSQL/Prisma runtime versions are evidenced,
and the declared Docker-image backend/OpenAPI path is additionally evidenced by
the actual published CI run. The local native server is Ubuntu, not an identical
Debian Bookworm container: OS/locale/performance equivalence is not claimed.
Native local tests use a C-locale isolated cluster and disabled JIT. This is not
production load, infrastructure, backup or release-readiness verification.

The repository's prescribed Docker setup is the reproducible container alternative:
use Node 22.23.5, the declared pnpm 10.34.9, a fresh local `.env` per README, then
`pnpm install --frozen-lockfile`,
`POSTGRES_PORT=55428 docker compose --project-name strength-m3-parity -f compose.dev.yml up -d --wait`,
`pnpm db:generate`, `pnpm db:migrate` and `pnpm verify`. Use only the disposable
Compose project/volume and match the local connection URLs to its port; remove
only that isolated test project when finished. Docker was unavailable on this
machine, so this container path is existing-CI evidence/reproduction guidance,
not an additional locally executed container run. Local native
verification commands/results are below; no new Compose or dependency config was
introduced to accommodate the machine.

## M3-T02 — Reproduction, cause and bounded fix

Affected scenario:
`Client browser history preserves authorized Catalog, directory, and detail navigation`
in `apps/dashboard/test/catalog.integration.test.cjs`, originally the marker
assertion at line 442 of the published baseline. Related setup is
`test/chrome.cjs`, `app/clients/history-boundary.tsx`, `history-guard.tsx`, and the
root layout. Each test process clones a separate random database, uses distinct
actor prefixes/ephemeral ports, and drops its copy in cleanup. Tests within the
file run in their established order. No shared table mutation or failed database
cleanup was observed as the cause of this assertion.

Investigation retained the exact marker assertion and added navigation context to
its failure output. First, the four documented browser groups passed together
(8 + 3 + 3 + 2), showing one passing parallel group is insufficient proof of a fix.
Then the affected scenario was run **12 independent times with four concurrent
workers**: **4 passed / 8 failed**. Every failed execution showed:

* Client document readyState `complete`, server-rendered workspace present, but
  `data-client-history` false before the Catalog link click.
* After the click, Catalog had a different `performance.timeOrigin`: a full
  document navigation, not a Next.js same-document route transition.
* The new Catalog document correctly lacked the previous document's marker, so
  the test's assumption that retained Client route data existed was false.

Example captured failure: Client document ID `1795453560073.8`, marker false,
workspace true; Catalog document ID `1795453560652.5`, marker false. All eight
failures had this same before-hydration/full-navigation signature. The production
history guard already tests both the marker **or** server-rendered workspace on
pagehide, including before hydration, conceals BFCache snapshots and revalidates
on restoration. No runtime privacy defect was established by this failure.

**Conclusion:** A reproducible test timing/race defect: visible restored HTML was
treated as proof that React's client-side navigation handler/history boundary had
hydrated. Under load the click can use the ordinary document-navigation fallback.
The scenario is specifically intended to exercise retained Next.js route data.

**Change:** Before that one SPA-specific link click, wait for the existing
boundary layout-effect marker using the existing bounded condition helper. Keep
the original marker assertion and add an explicit same-document assertion;
capture before/after document context if it fails. No arbitrary sleep, blind
retry, conditional assertion removal, timeout increase, runtime guard change or
test skip was added. Existing unhydrated, logout, account-switch, revocation,
BFCache concealment and forced fresh-response assertions remain intact.

After the change, the same **12-run/four-worker** experiment passed **12/12**,
with no discarded failure or retry-until-success behavior. Broader post-fix
regressions and repeated isolated results are recorded below.

To reproduce the stress method on a built local test checkout, with Node/pnpm/DB
configured as above (logs are deliberately retained, all executions count):

```sh
STUDIO_TEST_CHROME=/usr/bin/google-chrome python3 - <<'PY'
import concurrent.futures, json, os, pathlib, subprocess, tempfile
logs = pathlib.Path(tempfile.mkdtemp(prefix='studio-history-stress-'))
command = ['node', '--experimental-websocket', '--env-file=.env', '--test',
  '--test-name-pattern=Client browser history preserves authorized Catalog, directory, and detail navigation',
  'apps/dashboard/test/catalog.integration.test.cjs']
def run(number):
    path = logs / f'{number}.log'
    with path.open('w') as output:
        code = subprocess.run(command, env=os.environ.copy(), stdout=output,
          stderr=subprocess.STDOUT).returncode
    return {'run': number, 'exit': code, 'log': str(path)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results = list(pool.map(run, range(1, 13)))
(logs / 'results.json').write_text(json.dumps(results, indent=2))
print(json.dumps(results, indent=2))
raise SystemExit(any(result['exit'] for result in results))
PY
```

## Verification commands and results

Every local Node/pnpm command below used
`PATH=/tmp/strength-next-toolchain/bin:$PATH` and the isolated loopback `.env`.
Tool downloads, logs and stress summaries were retained in that temporary
directory; application secrets are excluded from repository/report output.

| Command / experiment | Result |
|---|---|
| `node --version`, `pnpm --version`, SQL `SHOW server_version` | 22.23.5 / 10.34.9 / 17.10 |
| `pnpm install --frozen-lockfile --offline` | Passed; 216 packages; unchanged lockfile/manifests |
| `pnpm db:generate` | Prisma Client 6.19.3 generated successfully |
| `pnpm db:migrate` | All 15 migrations applied successfully to the fresh isolated PostgreSQL 17.10 template |
| `node --env-file=.env apps/backend/node_modules/prisma/build/index.js validate --schema apps/backend/prisma/schema.prisma` | Schema valid |
| `prisma migrate diff --from-url "$MIGRATION_DATABASE_URL" --to-schema-datamodel apps/backend/prisma/schema.prisma --exit-code` via env-loaded Node child | Exit 0, “No difference detected”; compared migrated disposable DB to Prisma-supported schema objects, not all custom SQL/grants |
| Initial `pnpm verify` | Builds/generation passed; 11/11 unit and 99/99 backend integration tests, zero skipped/failed |
| Initial full dashboard integration command | 13 passed / 0 failed / 16 browser tests skipped because that invocation did not select Chrome; all browser groups were executed separately |
| Initial four concurrent browser groups | Client history 8, purchase/activation 3, scheduling/booking 3, attendance 2; all passed |
| Pre-fix affected scenario, 12 runs / 4 workers | 4 passed / 8 failed; all eight failures carried the same hydration/full-navigation evidence |
| Post-fix affected scenario, 12 runs / 4 workers | 12 passed / 0 failed |
| Final `pnpm verify` after the test fix | Generation/backend/dashboard builds passed; **11 unit / 99 backend integration passed**, zero skipped/failed; includes migration/DB/security/concurrency tests |
| Final `node --env-file=.env --test apps/dashboard/test/catalog.integration.test.cjs` | **13 passed / 0 failed / 16 browser tests skipped** in this non-Chrome invocation; browser cases executed separately below |
| Final four concurrent Chrome groups using the commands below | **8 + 3 + 3 + 2 = 16 passed**, zero failed/skipped in each selected group |
| Three further isolated executions of the affected scenario | **3/3 passed**, no discarded failures/retry loop |
| Final `pnpm openapi` twice, each followed by `git diff --exit-code -- packages/api-contract/openapi.json`, plus hash comparison | Both identical to committed snapshot, SHA-256 `e754aa61ee7926a5d4f6a787de9601271c9759616c5e569a266bc01ef7a461bc` |
| `git diff --check` and local Markdown target/fragment checks | Passed at delivery |

Each final browser group used this command with the following exact pattern in a
separate process, all four processes executing concurrently:

```sh
STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --env-file=.env --test \
  --test-name-pattern='Client browser history' apps/dashboard/test/catalog.integration.test.cjs
STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --env-file=.env --test \
  --test-name-pattern='Purchase funding viewer|Membership activation in Chrome' apps/dashboard/test/catalog.integration.test.cjs
STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --env-file=.env --test \
  --test-name-pattern='Scheduling in Chrome|Booking management in Chrome' apps/dashboard/test/catalog.integration.test.cjs
STUDIO_TEST_CHROME=/usr/bin/google-chrome node --experimental-websocket --env-file=.env --test \
  --test-name-pattern='Attendance in Chrome' apps/dashboard/test/catalog.integration.test.cjs
```

The isolated three-run check invoked the exact affected-scenario command from the
stress example three times sequentially, retaining every exit code; all were zero.
The final `verify` log records 11/99 tests; the individual browser group logs record
8/3/3/2; `dashboard-final.log` records 13 plus the deliberate non-Chrome skips.

The normal backend integration suite exercises fresh/upgrade migrations, runtime
DB roles, audit rollback, authorization including legacy grants, idempotent and
concurrent Booking/attendance writes. Application/runtime source, schema,
migrations, API DTOs and OpenAPI were not changed by this increment.

## Business decisions and next implementation boundary

The [O-09 owner brief](milestone-3-o09-owner-decision-brief.md) covers A–G with
current behavior, exact approval questions, recommendations, alternatives, edge
cases, affected layers, feature/production gates and explicit Pending statuses.
Owner approval was requested. No pending recommendation has been promoted to an
approved rule. Existing decision index/register/business/API documentation link
the brief without duplicating conflicting effective policies.

The [whole-application inventory/roadmap](milestone-3-next-slices.md) evaluates all
13 requested areas, proposes complete vertical journeys and a design-first
entitlement/reconciliation plan. Its key accounting risk is confirmed commitments
already counting past Bookings: subtracting a new usage debit while still counting
that Booking as an outstanding commitment would consume headroom twice. Proposed
canonical grants, exact-Membership posting sources, accepted-charge differences,
lock/idempotency order and reviewed backfill must precede implementation.

Recommended next product review: **S1, the existing-Client purchase → funding →
explicit activation dashboard journey**, reusing already implemented APIs and
permissions without adding O-09 policy. It is a proposal, not work started here.
Onboarding, lifecycle, verification/ledger, notifications and mobile slices retain
their specific owner/design/implementation gates. No automatic move to a next
slice is authorized by completing this technical increment.

## Issue register and delivery status

| ID | Status in this increment | Remaining gate / follow-up |
|---|---|---|
| M3-T04 | Closed: local main safely fast-forwarded, historical worktrees preserved | Keep this increment uncommitted until specific authorization. |
| M3-T03 | Closed: historical delivery, actual publication/CI and subsequent work distinguished | No invented PR/review/deployment evidence. |
| M3-T01 | Closed for runtime-version verification: exact toolchain, fresh/upgrade migrations, schema comparison and final suites passed | Native-vs-container OS distinction and untested production infrastructure remain explicit; no production-readiness claim. |
| M3-T02 | Closed: reproduced/fixed test readiness race; 8/12 failures before, 12/12 concurrent and 3/3 isolated passes after; full post-fix regressions passed | Maintain SPA and unhydrated/privacy scenario distinctions; do not replace assertions with delays/retries. |
| O-09-A | Pending owner approval | Production capture deadline and implementation; gate stays closed. |
| O-09-B | Pending owner approval | New outcomes/chargeability and future verified-use scope. |
| O-09-C | Pending owner approval | Insufficiency/lifecycle policy plus canonical ledger design. |
| O-09-D | Pending owner approval | Recipient/delivery policy and separately approved O-11 infrastructure. |
| O-09-E | Pending owner approval | Cancelled-record transitions; current block/evidence preservation remains. |
| O-09-F | Pending owner approval | Full correction field/authority/effect contract; reaffirmation remains the sole approved response. |
| O-09-G | Pending owner input/review | Explicit retention/start events, holds, archive/redaction roles and design. |
| M3-L01 | Ledger design proposed, not approved or implemented | Owner/design review, historical reconciliation plan and S5 implementation authorization. |
| M3-N01 | Whole-application next slices proposed | Review this increment, select and authorize exactly one next slice. |
| M3-N02 | Future renewal/repeat-purchase cardinality unresolved | Current API/partial unique indexes forbid repeating the same Client/package version/type; preserve until a specific renewal contract is approved. Does not block S1's existing first-acceptance journey. |

## Files affected and final review

* `apps/dashboard/test/catalog.integration.test.cjs`: one SPA scenario's hydration
  readiness, before/after diagnostics and stronger document-identity assertion.
* `docs/milestone-3-attendance-return-reaffirmation.md`: corrected publication/CI
  closeout and explicitly historical earlier verification, links to pending work.
* `docs/open-decisions.md`, `docs/milestone-2-decision-register.md`,
  `docs/business-rules.md`, `docs/api-contract.md`, `docs/implementation-roadmap.md`:
  traceable links/status distinctions; no new effective business policy or API.
* New `docs/milestone-3-technical-readiness.md` (this report),
  `docs/milestone-3-o09-owner-decision-brief.md` and
  `docs/milestone-3-next-slices.md`: verification evidence, pending owner decisions,
  source-inspected inventory, proposed slices and ledger design gate.

Final scope review checks that only these ten files change; all other existing
worktrees are clean. Dependency manifests/lockfile, runtime source, schema,
migrations, OpenAPI and deployment configuration have no changes. The disposable
server is stopped after verifying only its template/normal system databases
remain; no suite-created database is retained. Temporary tool/evidence files and
ignored local dependency/build artifacts are not committed.

Database/API impact: **no new migration, schema, endpoint, DTO, outcome or runtime
business-rule change**. Only the browser regression's readiness/diagnostic
assertions and documentation change. The already-published 15 migrations were
applied only to newly created disposable databases.

This increment creates **no commit, push, merge, PR, production migration,
deployment or production attendance-capture activation**. Production readiness is
not declared. Production infrastructure/access/restore/load evidence and outstanding
owner decisions remain separate gates.
