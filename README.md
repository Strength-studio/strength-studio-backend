# Strength Studio

Foundation, public package catalog, and read-only Client Management for the single-studio management platform. The workspace contains a NestJS API and a Next.js operations dashboard. The Flutter directory records the mobile contract for its later interface milestone.

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

## Implemented scope

- Argon2id sign-in for active, verified accounts, short-lived bearer tokens, refresh rotation and replay revocation, logout, and single-use socket tickets. Current roles and staff grants are checked server-side. Existing sockets disconnect on invalidation or failed revalidation.
- Scoped account reads, non-Admin account disablement, independent staff grants, versioned studio timezone and currency settings, append-only audit, and transactional retry outcomes for administrative writes.
- Public package and session-type API with versioned drafts, Admin-only zero-price publication, and scoped catalog history. See [public catalog routes](docs/api-contract.md#implemented-public-catalog).
- Process health and PostgreSQL readiness, validated configuration, request IDs, redacted request logs, and the [OpenAPI snapshot](packages/api-contract/openapi.json).

Real registration, invitation delivery and completion, password recovery, and production Admin bootstrap remain gated by O-02. Both membership activation stubs and commission reads are Admin-only and return `WORKFLOW_NOT_ENABLED` for authorized calls. Private offers, purchases, payments, refunds, scheduling and attendance remain deferred. Redis/BullMQ delivery, SMTP, and production deployment are later milestones. There are no finance, booking, commission, or outbox tables in this migration.

See [the implementation roadmap](docs/implementation-roadmap.md), [API contract](docs/api-contract.md), and [open studio decisions](docs/open-decisions.md).
