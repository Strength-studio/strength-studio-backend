# Strength Studio

Single-studio management platform with a NestJS API and Next.js operations dashboard. Implemented slices include identity, public catalog, Client reads, purchases/payments and explicit Membership activation, scheduling, booking, and production-gated attendance submission/return/reaffirmation. The Flutter directory is a documented placeholder, not a delivered mobile application.

The [consolidation inventory](docs/consolidation/worktree-inventory.md) records source provenance and historical branches. The [consolidation report](docs/consolidation/final-consolidation-report.md) distinguishes integrated, verified, future and production-enabled capabilities. The [application roadmap](docs/milestone-3-next-slices.md) and [pending O-09 owner brief](docs/milestone-3-o09-owner-decision-brief.md) describe proposed work without enabling it.

## Local setup

Use Node.js 20.19 or newer, pnpm 10.34.9, and Docker Compose v2. The development PostgreSQL port is bound to loopback. The sample database passwords are for local use. Install pnpm through your existing tooling, or use `npm exec --yes --package=pnpm@10.34.9 -- pnpm` in place of `pnpm`.

```sh
cp .env.example .env
sed -i "s/^AUTH_SIGNING_KEY=.*/AUTH_SIGNING_KEY=$(openssl rand -hex 32)/" .env
sed -i "s/^DASHBOARD_CSRF_KEY=.*/DASHBOARD_CSRF_KEY=$(openssl rand -hex 32)/" .env
chmod 600 .env

pnpm install --frozen-lockfile
docker compose -f compose.dev.yml up -d --wait
pnpm db:generate
pnpm db:migrate
pnpm build
```

Compose initializes `studio_api`, `studio_reporting`, and `studio_worker` before the first migration. Only `studio_api` logs in during Foundation. The migrator uses separate credentials. When using an existing disposable loopback PostgreSQL 17 instance, create the `strength_studio` database and provision the roles in [the local role script](infra/postgres/01-local-roles.sh) before running migrations. The Compose init script runs only on a fresh volume.

Start the API with:

```sh
pnpm dev:api
curl -fsS http://127.0.0.1:3000/api/v1/health
curl -fsS http://127.0.0.1:3000/api/v1/health/ready
```

For local sign-in, create an explicit Admin fixture. The command only runs in development against the loopback `strength_studio` database. It does not overwrite an existing account.

```sh
export LOCAL_ADMIN_EMAIL=admin@studio.example
read -rsp 'Local Admin password (at least 12 characters): ' LOCAL_ADMIN_PASSWORD
printf '\n'
export LOCAL_ADMIN_PASSWORD
pnpm seed:local
unset LOCAL_ADMIN_PASSWORD LOCAL_ADMIN_EMAIL
```

With the API running against a database that already has the catalog schema, start the dashboard with `pnpm dev:dashboard`. Open [the local dashboard](http://localhost:3001), matching `DASHBOARD_ORIGIN` in `.env`. Set `API_BASE_URL` to the API origin and configure `DASHBOARD_CSRF_KEY`. Sign in as Admin to manage packages and session types. Staff need explicit catalog grants. A manager also needs `catalog.read` to choose active session types, and `audit.read` to see package audit events.

Admin and Staff with `client.manage` can open the Client directory at `/clients` and view individual profiles. Authenticated Clients can read their own profile through the API. These features use existing Client records and require no schema changes. See the [Client read contract](docs/api-contract.md#implemented-client-reads). Registration, invitation, and account setup remain gated by O-02.

## Verification

```sh
pnpm verify
pnpm openapi
```

The unit suite needs no database. The integration suite uses the documented loopback connection strings to create and migrate an isolated temporary PostgreSQL database. It drops only that database on exit. It exercises real NestJS routes, Socket.IO, DB-role denial, and the built Next.js session routes. The migrator needs permission to create and drop the disposable test database. Both application builds are prerequisites. A GitHub Actions workflow is available if the repository is hosted there.

To test the catalog and Client dashboard without applying migrations, build both apps with `pnpm build`, stop services connected to the local `strength_studio` database, then run:

```sh
node --env-file=.env --test apps/dashboard/test/catalog.integration.test.cjs
```

The dashboard tests require an already-migrated loopback database. They clone it into a disposable database, seed role fixtures in that copy, and start the built dashboard and backend on loopback. The local database owner needs permission to clone and drop the disposable copy.

Run the Client history regressions separately with a local Chrome or Chromium executable.

```sh
STUDIO_TEST_CHROME="$(command -v google-chrome)" node --experimental-websocket --env-file=.env --test \
  --test-name-pattern='Client browser history' apps/dashboard/test/catalog.integration.test.cjs
```

Run the Purchase Funding and Membership Activation browser regressions in a separate process so the shared login throttle has a fresh window.

```sh
STUDIO_TEST_CHROME="$(command -v google-chrome)" node --experimental-websocket --env-file=.env --test \
  --test-name-pattern='Purchase funding viewer|Membership activation in Chrome' apps/dashboard/test/catalog.integration.test.cjs
```

Run the Scheduling and Booking Management browser regressions in a fresh process.

```sh
STUDIO_TEST_CHROME="$(command -v google-chrome)" node --experimental-websocket --env-file=.env --test \
  --test-name-pattern='Scheduling in Chrome|Booking management in Chrome' apps/dashboard/test/catalog.integration.test.cjs
```

Run attendance submission, participant return and Coach reaffirmation browser regressions in a fresh process.

```sh
STUDIO_TEST_CHROME="$(command -v google-chrome)" node --experimental-websocket --env-file=.env --test \
  --test-name-pattern='Attendance in Chrome' apps/dashboard/test/catalog.integration.test.cjs
```

## Implemented scope

- Argon2id sign-in for active, verified accounts, short-lived bearer tokens, refresh rotation and replay revocation, logout, and single-use socket tickets. Current roles and staff grants are checked server-side. Existing sockets disconnect on invalidation or failed revalidation.
- Scoped account reads, non-Admin account disablement, independent staff grants, versioned studio timezone and currency settings, append-only audit, and transactional retry outcomes for administrative writes.
- Public package and session-type API with versioned drafts, Admin-only zero-price publication, and scoped catalog history. See [public catalog routes](docs/api-contract.md#implemented-public-catalog).
- Process health and PostgreSQL readiness, validated configuration, request IDs, redacted request logs, and the [OpenAPI snapshot](packages/api-contract/openapi.json).

- Purchase acceptance, payment recording, verification and allocation, and the Admin Purchase Funding viewer with explicit membership activation. See [membership activation](docs/api-contract.md#implemented-membership-activation).

- Admin positive-price purchase operations at `/commercial`, including existing active Client/package selection, agreement evidence, receipt recording, verification, allocation, explicit activation and scoped audit history. See [the S1-A contract](docs/api-contract.md#s1-a-admin-commercial-operations).

- Admin Scheduling and Booking Management at `/scheduling` and `/bookings`. Open a session's booking history from Scheduling or select a session in Booking Management, then search the Client directory and choose a membership. [Booking API contract](docs/api-contract.md#implemented-booking-management-slice-1).

- Production-gated attendance submission, Admin participant return and Coach ATTENDED reaffirmation at `/attendance`, with immutable submission/review history. [Attendance contract and O-09 register](docs/milestone-3-attendance-return-reaffirmation.md).

Real registration, invitation delivery and completion, password recovery, and production Admin bootstrap remain gated by O-02. The legacy membership activation stubs and commission reads remain Admin-only and return `WORKFLOW_NOT_ENABLED`. Production attendance capture remains gated by O-09; Admin attendance verification, full correction and entitlement deduction remain deferred. Private offers, refunds, Redis/BullMQ delivery, SMTP, and production deployment remain deferred.

See [the implementation roadmap](docs/implementation-roadmap.md), [API contract](docs/api-contract.md), and [open studio decisions](docs/open-decisions.md).
