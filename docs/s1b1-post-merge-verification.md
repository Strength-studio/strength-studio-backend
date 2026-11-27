# S1-B1 post-merge verification and MVP checkpoint

27 November 2026, Africa/Cairo. Scope: finish the interrupted post-merge
verification, update existing roadmap status and recommend one next task.
This report supports the [existing execution tracker](milestone-3-next-slices.md);
it is not a new tracker or implementation authorization.

## 1. Post-merge verification

| Check | Verified result |
|---|---|
| Repository | `Strength-studio/strength-studio-backend` |
| PR | [#5 — feat: Admin Client profile maintenance (S1-B1)](https://github.com/Strength-studio/strength-studio-backend/pull/5), closed and merged |
| Merge date | 27 November 2026, 02:42:08 Africa/Cairo (`2026-11-27T00:42:08Z`) |
| Squash merge | `1fb9c220a4f234f3eb21d87019376b95b7635c7a` |
| Reviewed feature | `4630462f807a9e729e66c0d338d752eb9b1c56ee` |
| Expected parent | `8d2803155b1ead4b9063efa412e04b2c331c4a05`, verified as the merge's sole parent |
| Remote baseline | GitHub `main` and local `origin/main` both resolve to the squash merge |
| Local baseline | Local `main` also resolves to the squash merge; already synchronized by the interrupted checkpoint, so no further ref update was needed |
| Content parity | Feature and squash merge Git tree objects match exactly; 16 changed files, +888/−29 |
| Active verification checkout | `Strength Studio S1-B1`, branch `codex/s1b1-client-profile-maintenance-20261127`, HEAD at the reviewed feature SHA |
| Initial working state | All eight linked worktrees clean; historical feature checkouts preserved |
| Discrepancies | None in expected merge, scope or baseline; stale roadmap statements corrected below |

The original `Strength Studio` checkout remains on
`fix/booking-future-session-validation` at `487872d…`. That historical checkout is
not the current application baseline. Its preservation is intentional; local
`main` parity does not mean every worktree should be switched or updated.

Verification used read-only GitHub PR/ref/workflow APIs, Git parent/tree/diff and
worktree checks, merged source review, original local test logs and source hashes,
and the focused unit suite. No production database/configuration was inspected.

## 2. S1-B1 status and evidence

**COMPLETED — MERGED INTO MAIN.** Source review confirms:

- Admin-only `PATCH /api/v1/clients/{id}` for display name, strict DTO/query
  validation, exact stored-name stale-edit precondition and locked Client scoping.
- Shared command authorization/idempotency, transactional redacted
  `CLIENT_PROFILE_UPDATED` audit and atomic rollback behavior.
- Same-origin Dashboard write relay with Origin/Host, refresh-bound CSRF,
  bounded JSON, actor binding and immutable retry-key protections.
- Dirty draft/precondition preservation across automatic refresh, explicit
  discard confirmation, save-baseline reset and account-switch invalidation.
- Existing account disablement with explicit confirmation; no new reactivation
  or Membership/service/financial consequence.
- Regression tests, OpenAPI/API and permission contracts, and the narrow migration
  adding one audit enum value and `UPDATE(display_name)` runtime privilege.

The merge introduces no Client creation, self-registration, invitations, email
delivery, reactivation, Membership/attendance/entitlement/financial/commission
workflow or Staff permission expansion. Branch operations remain outside product scope.

| Evidence class | Result and limits |
|---|---|
| Directly rerun in this resumed checkpoint | `node --test apps/backend/test/*.unit.test.cjs`: 11 passed, zero failed/skipped, Node 20.19.5. Tree/parent parity and original follow-up source/OpenAPI hashes also checked. |
| GitHub CI on exact merge SHA | [Foundation run 45918264569](https://github.com/Strength-studio/strength-studio-backend/actions/runs/45918264569), push event, completed/success. Job steps confirm frozen install, disposable DB setup, `pnpm verify` and OpenAPI snapshot check passed. The workflow builds both apps and runs unit/backend integration tests; it does not run Dashboard integration/Chrome tests. |
| Previous pre-commit full verification | Original `verify-final.log`: 11 unit and 107 backend integration passed, zero failures. Builds and OpenAPI evidence recorded in the previous verification artifacts. |
| Previous final follow-up | Original logs: 5 targeted backend, 15 Dashboard integration, 7 S1-B1 relay/Chrome and 8 Client-history Chrome tests passed. The 7 include both new draft tests. Selected suites skipped unrelated cases; these are not full-suite counts. |
| Draft regression reproduction | Both new tests failed against the previous editor, then both passed after the fix. Final editor/test/API-document hashes match `followup-verification.json`; tracked OpenAPI matches its recorded SHA-256. |
| Not rerun here | Builds, database integration/Chrome suites, migrations and OpenAPI generation. Exact merge-tree parity, successful merge CI and final local evidence provide proportionate confidence without repeating expensive mutable suites. |

Original evidence is local under
`/home/kraken/strength-studio-s1b1-verification/verification.json`,
`followup-verification.json` and `logs/`. These describe earlier executions; their
historical `committed: false` values are not the current Git state.

Limitations remain: retry checkpoints are in memory; exact-name stale-edit
checks cannot detect an intervening edit restored to the same name; Dashboard
Chrome tests remain outside Foundation CI. No new defect was identified.
The production migration remains unapplied according to the recorded task history;
this is not an independently inspected production-schema assertion. Deployment
remains unauthorized and was not performed.

## 3. MVP tracker changes

Only three documentation paths change in the existing S1-B1 worktree:

- `docs/implementation-roadmap.md`: link the current merge checkpoint, recognize
  completed S1-A/S1-B1 scope and remove the obsolete claim that all profile writes
  remain future work.
- `docs/milestone-3-next-slices.md`: update the existing inventory/sequence with
  S1-A/S1-B1 merged statuses, identities, date, verification and rollout boundaries;
  retain the broader milestones and outstanding work. Positive-price completion
  does not claim SAR 0 entry UI completion.
- This report: record verification and the single recommended next task.

Development completion, Usage Testing Ready and Production Ready remain distinct.
Full-platform Usage Testing Ready has not been established by this checkpoint.
A bounded usage test needs an explicitly reviewed journey, approved test scope,
isolated environment/fixtures and acceptance evidence. Production Ready is not
established while business, ledger, delivery, retention and release gates remain.
Historical evidence and owner approvals were not rewritten. No unrelated
documentation or implementation changes are included.

## 4. Current MVP status

Completed development includes Foundation/security, public catalog and Client
reads, purchase/funding/activation primitives, Admin scheduling/booking, test-gated
Coach submission/return/reaffirmation, S1-A positive-price Admin operations and
S1-B1 Client profile maintenance. These bounded deliveries do not complete all
commercial or interface milestones. No next implementation is in progress here.

Remaining work and gates, checked against the current decision index/register:

| Work | Dependency or decision still open |
|---|---|
| Client onboarding/recovery and Staff/Coach provisioning (S2/S3) | O-02 setup channel, post-verification sign-in/enablement, production Admin bootstrap/lifecycle and setup contracts; O-11 delivery dependencies. O-02 is approved in part, not wholly unapproved. |
| Membership lifecycle and affected bookings (S4) | Approved O-07 core needs exact transitions/history; O-08 confirmed-booking consequences and relevant O-09 interactions remain. |
| Admin attendance verification and entitlement usage (S5) | O-09-A/B/C/E, approved canonical ledger/once-only grants, commitment-versus-usage accounting, migration/backfill reconciliation and explicit implementation authority. No canonical usage ledger exists or is approved by the proposal. |
| Installments, credit, corrections/refunds and private offers (S6/S7 and remaining M2) | Exact contracts and unresolved portions of O-01/O-03/O-04/O-05/O-06/O-07/O-17; one bounded financial path at a time. |
| Delivery/inbox (S8) | O-11 is partly approved; category defaults, sender/domain, access and operations remain. O-09-D gates attendance recipients/delivery. |
| Client/Coach mobile and reports (S9–S11) | Flutter source absent; scoped API/policy/source contracts, security and retention evidence required. |
| Commission | O-10 distribution choices unresolved; strictly Admin-only; automation deferred. |
| Backup/release | O-12 partly approved: provider, key custody, alerts and restore cadence remain; restore/load/rollback evidence and O-13/O-14 responsibilities/go-live approval remain. |

O-09-F full corrections and O-09-G retention also remain pending. Current
submission/return/reaffirmation is a limited approved development slice with the
production capture gate closed. No verification/debit or cancellation-based
restoration may be inferred. Branch operations and online gateways remain excluded.
The existing SAR 0 API versus missing SAR 0 entry UI is recorded as residual S1
scope, rather than silently declaring the whole original proposal complete.

## 5. Recommended next slice

**S2 preparation — O-02 Client onboarding decision closure and contract review.**

**Objective and value:** Resolve how new Clients obtain verified, usable access
and how Admin access is safely established/recovered. Existing-client commerce and
maintenance are delivered; closing this next roadmap gate prepares a complete new
Client journey without guessing security or activation policy.

**Scope:** Review the existing approved O-02 rules/stubs; present specific owner
choices for Admin-created setup delivery, enablement after verification in each
onboarding path, and production Admin bootstrap/lifecycle responsibility. Define
the proposed account-state transition table, token purposes/expiry/single-use
contract, collision/abuse/revocation behavior, API error/response boundaries and
delivery dependencies. Record only explicit owner answers, then prepare one bounded
implementation plan for review. This is a decision/design task, not a workaround
for unanswered policy.

**Explicit exclusions:** Runtime code, schema migrations, real accounts, emails,
production bootstrap, new Staff/Coach authority, mobile implementation,
attendance/ledger/finance/commission changes and deployment. Future S2
implementation needs its own authorization.

**Dependencies:** Current identity/action/command/audit infrastructure and O-02
register; O-11 approved setup-delivery channel and operational ownership. Existing
active/verified sign-in behavior is the current boundary, not approval of future
onboarding transitions.

**Unresolved business decisions:** Setup delivery method for Admin-created Clients;
whether email verification enables sign-in or requires a further enablement step
for each path; initial production Admin provisioning and Admin lifecycle/recovery
responsibility. Delivery sender/transport and failure handling must be resolved or
explicitly left blocking the affected implementation.

**Acceptance criteria:** Each O-02 question has an explicit approved answer or is
marked blocked; one reviewed state/actor matrix covers Admin-created and optional
self-registration journeys, verification, recovery and revocation; token and
delivery contracts cover expiry/replay/collision/failure; negative access and
abuse cases have expected outcomes; approvals and remaining blockers link back
to the existing decision register. The final plan names a single authorized
implementation boundary and does not imply that this checkpoint enables it.

**Verification strategy:** Documentation/source-contract cross-check, owner review
of normal/failure journeys, and a planned test matrix for single-use races,
expired/replayed tokens, disabled registration, enumeration, account collision,
revocation, audit rollback and failed delivery. No new runtime tests are needed
for this decision-only task.

**Risk:** Low for decision/design work; onboarding implementation has material
identity/delivery dependencies until choices are settled. Starting S5 now would
also be premature because policy and ledger/reconciliation approval are missing.

**Why next:** S2 follows the delivered existing-Client operations in the roadmap,
unblocks new-Client access and reduces a shared S3/mobile dependency. It can proceed
as structured decision closure while O-09 remains pending. No parallel
implementation project is recommended by this checkpoint.

## 6. Safety confirmation

No next-slice implementation, commit, push, merge, migration, deployment or
production operation occurred during this resumed checkpoint. No branch/ref,
worktree checkout or unrelated file was changed. All eight worktree HEADs and
branches remain preserved; the seven other worktrees remain clean. Only the three
documentation paths above are left unstaged/uncommitted in the S1-B1 worktree.
The interrupted earlier checkpoint had already safely fast-forwarded the
unoccupied local `main`; this continuation required no synchronization operation.

Stop at this checkpoint. New implementation requires explicit authorization.
