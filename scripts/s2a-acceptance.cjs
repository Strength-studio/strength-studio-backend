// Operator-only disposable acceptance harness. Never imported by the application.
// No HTTP debug route, real transport, production fixture or provider is installed.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, writeFile, open } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { createServer } = require('node:net');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');
const root = resolve(__dirname, '..');
const { PrismaClient } = require('../apps/backend/node_modules/@prisma/client');
const { createApp } = require('../apps/backend/dist/app.js');
const { Realtime } = require('../apps/backend/dist/identity/realtime.js');
const { loadConfig } = require('../apps/backend/dist/platform/config.js');
const { hashPassword } = require('../apps/backend/dist/identity/password.js');
const { OnboardingDeliveryService, FakeVerificationTransport } = require('../apps/backend/dist/onboarding/delivery.service.js');

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--data-directory' || !args[1].startsWith('/')) {
  process.stderr.write('Usage: node --env-file=<private-test.env> scripts/s2a-acceptance.cjs --data-directory <absolute disposable PostgreSQL directory>\n');
  process.exit(1);
}
const name = 'studio_s2a_acceptance_' + randomBytes(6).toString('hex');
let owner, db, app, dashboard, log, input, runDirectory, origin, created = false, stopping = false;
let messages = [], commandQueue = Promise.resolve();
const password = randomBytes(18).toString('base64url');
const html = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
async function privateFile(file, text) {
  await writeFile(join(runDirectory, file), text, { mode: 0o600 });
}
async function unusedPort() {
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}
async function stop() {
  if (stopping) return;
  stopping = true;
  input?.close();
  if (dashboard && dashboard.exitCode === null && dashboard.signalCode === null) {
    const exited = once(dashboard, 'exit');
    dashboard.kill('SIGTERM');
    const timer = setTimeout(() => dashboard.kill('SIGKILL'), 5000);
    await exited; clearTimeout(timer);
  }
  await app?.close();
  await db?.$disconnect();
  if (created) {
    assert(/^studio_s2a_acceptance_[0-9a-f]{12}$/.test(name));
    // Only this live process's successfully created random database is removed.
    await owner.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
    created = false;
  }
  await owner?.$disconnect();
  await log?.close();
  if (runDirectory) {
    await privateFile('cleanup.json', JSON.stringify({ database: name, databaseDropped: true, servicesStopped: true }) + '\n');
    // Retain evidence only, removing capability-bearing fake messages/credentials.
    await privateFile('inbox.html', '<!doctype html><title>Closed acceptance run</title><p>Run closed; fake proofs removed.</p>');
    await privateFile('accounts.txt', 'Run closed; test credentials removed.\n');
  }
  console.log('Acceptance services stopped; only this run database was dropped.');
}
async function safeStatus(email) {
  const rows = await db.user.findMany({ where: { normalizedEmail: email ?? { endsWith: '@s2a-acceptance.example.invalid' } },
    select: { id: true, normalizedEmail: true, role: true, accountState: true, emailVerifiedAt: true,
      onboarding: { select: { revision: true, revokedAt: true, completedAt: true } } } });
  return rows;
}
async function command(line) {
  const [action, email, purpose, ...extra] = line.trim().split(/\s+/);
  if (!action) return;
  if (action === 'quit') { await stop(); return; }
  if (action === 'help') {
    console.log('deliver | status [email] | expire <test-email> SETUP|EMAIL|PASSWORD | age <test-email> SETUP|EMAIL | quit'); return;
  }
  if (action === 'deliver' && !email) {
    const fake = new FakeVerificationTransport();
    await app.get(OnboardingDeliveryService).dispatch(fake, 100);
    messages.push(...fake.messages);
    for (const m of messages) assert(new URL(m.url).origin === origin);
    await privateFile('inbox.html', '<!doctype html><html lang="en"><meta charset="utf-8"><title>S2-A fake inbox</title>'
      + '<h1>TEST ONLY - fake verification delivery</h1><p>No real email was sent. Latest messages appear last. An older link may be superseded.</p>'
      + messages.map((m, i) => `<section><h2>${i + 1}. ${html(m.to)}</h2><p>${html(m.subject)}</p><a href="${html(m.url)}">Open test verification link</a></section>`).join('') + '</html>');
    console.log(`Captured ${fake.messages.length} fake message(s). Open or reload ${join(runDirectory, 'inbox.html')}`); return;
  }
  if (action === 'status' && !purpose) { console.log(JSON.stringify(await safeStatus(email), null, 2)); return; }
  if (['expire', 'age'].includes(action)) {
    assert(!extra.length && /^[a-z0-9.+_-]+@s2a-acceptance\.example\.invalid$/.test(email ?? ''), 'Use a test Client email in the documented namespace');
    assert((action === 'expire' ? ['SETUP', 'EMAIL', 'PASSWORD'] : ['SETUP', 'EMAIL']).includes(purpose), 'Invalid purpose');
    const user = await db.user.findUniqueOrThrow({ where: { normalizedEmail: email }, include: { onboarding: true } });
    assert(user.role === 'CLIENT' && user.onboarding && !user.onboarding.completedAt, 'Requires unfinished test Client');
    const count = action === 'expire'
      ? await db.$executeRaw`UPDATE onboarding_challenge SET created_at=clock_timestamp()-interval '25 hours', expires_at=clock_timestamp()-interval '1 second' WHERE user_id=${user.id}::uuid AND purpose=${purpose}::onboarding_purpose AND consumed_at IS NULL AND revoked_at IS NULL`
      : await db.$executeRaw`UPDATE onboarding_challenge SET created_at=created_at-interval '61 seconds' WHERE user_id=${user.id}::uuid AND purpose=${purpose}::onboarding_purpose`;
    console.log(`Test-only clock fixture: ${action} ${purpose}; ${count} row(s). No application policy changed.`); return;
  }
  throw new Error('Unknown command; type help');
}
async function main() {
  assert(['development', 'test'].includes(process.env.NODE_ENV), 'Requires NODE_ENV=test or development');
  const api = new URL(process.env.DATABASE_URL), migration = new URL(process.env.MIGRATION_DATABASE_URL);
  for (const url of [api, migration]) {
    assert.equal(url.hostname, '127.0.0.1', 'Only explicit IPv4 loopback is permitted');
    assert(url.port && url.port !== '5432', 'Use a separate non-default test PostgreSQL port');
    assert.equal(url.pathname, '/strength_studio');
  }
  assert.equal(api.host, migration.host); assert.equal(api.username, 'studio_api'); assert.notEqual(api.username, migration.username);
  const control = new URL(migration); control.pathname = '/postgres';
  owner = new PrismaClient({ datasourceUrl: control.href });
  const [server] = await owner.$queryRaw`SELECT current_setting('data_directory') AS directory, inet_server_addr()::text AS address, inet_server_port() AS port`;
  assert.equal(server.directory, args[1], 'Actual PostgreSQL data directory does not match explicitly selected disposable cluster');
  assert.equal(server.address, '127.0.0.1/32'); assert.equal(server.port, Number(api.port));
  const template = new PrismaClient({ datasourceUrl: migration.href });
  try {
    assert.equal(await template.user.count(), 0, 'Requires an empty, migrated disposable template');
    const applied = await template.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert(applied.some(x => x.migration_name === '20261127000200_client_onboarding'), 'Onboarding migration is required');
  } finally { await template.$disconnect(); }
  runDirectory = await mkdtemp(join(tmpdir(), 'studio-s2a-acceptance-'));
  await owner.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "strength_studio"`); created = true;
  api.pathname = migration.pathname = '/' + name;
  db = new PrismaClient({ datasourceUrl: migration.href });
  const hash = await hashPassword(password);
  const admin = await db.user.create({ data: { normalizedEmail: 'admin@s2a-acceptance.example.invalid', role: 'ADMIN', accountState: 'ACTIVE', emailVerifiedAt: new Date(), passwordHash: hash } });
  const staff = await db.user.create({ data: { normalizedEmail: 'staff@s2a-acceptance.example.invalid', role: 'STAFF', accountState: 'ACTIVE', emailVerifiedAt: new Date(), passwordHash: hash } });
  await db.staffGrant.create({ data: { staffUserId: staff.id, permission: 'CLIENT_MANAGE', changedById: admin.id } });
  origin = 'http://127.0.0.1:' + await unusedPort();
  const env = { NODE_ENV: 'test', DATABASE_URL: api.href, AUTH_SIGNING_KEY: randomBytes(32).toString('hex'),
    ONBOARDING_DELIVERY_KEY: randomBytes(32).toString('hex'), DASHBOARD_ORIGIN: origin };
  // This process owns DB cleanup. Do not install startApp's signal handlers,
  // which re-emit the signal and could exit before the run database is dropped.
  app = await createApp({ ...loadConfig(env), host: '127.0.0.1', port: 0 });
  const httpServer = app.getHttpServer();
  httpServer.headersTimeout = 8000; httpServer.requestTimeout = 15_000;
  app.get(Realtime).attach(httpServer);
  await app.listen(0, '127.0.0.1');
  log = await open(join(runDirectory, 'dashboard.log'), 'wx', 0o600);
  dashboard = spawn(process.execPath, [join(root, 'apps/dashboard/node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', new URL(origin).port], {
    cwd: join(root, 'apps/dashboard'), env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
      DASHBOARD_ORIGIN: origin, API_BASE_URL: await app.getUrl(), DASHBOARD_CSRF_KEY: randomBytes(32).toString('hex') },
    stdio: ['ignore', log.fd, log.fd],
  });
  dashboard.on('error', () => { console.error('Dashboard failed to launch.'); process.exitCode = 1; void stop(); });
  let ready = false;
  for (let i=0;i<100;i++) {
    if (dashboard.exitCode !== null) break;
    if ((await fetch(origin, { signal: AbortSignal.timeout(1000) }).catch(() => null))?.ok) { ready = true; break; }
    await delay(100);
  }
  assert(ready, 'Dashboard failed to become ready; inspect the private dashboard.log');
  await privateFile('accounts.txt', `TEST ONLY\nAdmin: ${admin.normalizedEmail}\nStaff: ${staff.normalizedEmail}\nFixture password for both: ${password}\nUse separate Chrome profiles for Admin and Client.\n`);
  await privateFile('run.json', JSON.stringify({ database: name, dashboard: origin, api: await app.getUrl(), adminId: admin.id, runDirectory }, null, 2) + '\n');
  await privateFile('inbox.html', '<!doctype html><title>S2-A fake inbox</title><h1>TEST ONLY</h1><p>Type deliver in the harness after accepting a setup link.</p>');
  console.log(`S2-A ACCEPTANCE READY\nDashboard: ${origin}\nPrivate accounts: ${join(runDirectory, 'accounts.txt')}\nPrivate fake inbox: ${join(runDirectory, 'inbox.html')}\nManifest: ${join(runDirectory, 'run.json')}\nType help for commands; quit or Ctrl+C cleans up this run only.`);
  input = createInterface({ input: process.stdin });
  input.on('line', line => { commandQueue = commandQueue.then(() => command(line)).catch(() => console.error('Command refused or failed. Check syntax, target and fixture state; no secret details logged.')); });
  input.on('close', () => { commandQueue = commandQueue.then(stop); });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { commandQueue = commandQueue.then(stop); });
main().catch(async () => { console.error('Acceptance startup refused or failed. Check the disposable target, build and private logs.'); process.exitCode = 1; await stop(); });
