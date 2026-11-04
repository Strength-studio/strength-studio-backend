const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient, Role, AccountState, TokenPurpose } = require('@prisma/client');
const { io } = require('socket.io-client');
const { startApp } = require('../dist/app.js');
const { loadConfig } = require('../dist/platform/config.js');
const { hashPassword } = require('../dist/identity/password.js');
const { digest } = require('../dist/identity/session.service.js');

const password = 'integration-only fixture passphrase';
const allowedOrigin = 'http://localhost:3001';
const databaseName = `studio_test_${randomBytes(8).toString('hex')}`;
let owner, migrator, runtime, app, base, users, sessions, created = false;

function disposableUrls() {
  assert.ok(['development', 'test'].includes(process.env.NODE_ENV), 'integration requires a development/test environment');
  const api = new URL(process.env.DATABASE_URL);
  const migration = new URL(process.env.MIGRATION_DATABASE_URL);
  for (const url of [api, migration]) {
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'integration only uses a loopback PostgreSQL server');
    assert.equal(url.pathname, '/strength_studio', 'use the documented local database URLs');
  }
  assert.equal(api.host, migration.host);
  assert.equal(api.username, 'studio_api');
  assert.notEqual(api.username, migration.username);
  api.pathname = migration.pathname = '/' + databaseName;
  return { api, migration };
}

before(async () => {
  const { api, migration } = disposableUrls();
  const control = new URL(migration);
  control.pathname = '/postgres';
  owner = new PrismaClient({ datasourceUrl: control.href });
  await owner.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  created = true;
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', resolve(__dirname, '../prisma/schema.prisma')], {
    env: { ...process.env, DATABASE_URL: api.href, MIGRATION_DATABASE_URL: migration.href }, timeout: 40_000,
  });
  migrator = new PrismaClient({ datasourceUrl: migration.href });
  runtime = new PrismaClient({ datasourceUrl: api.href });
  const passwordHash = await hashPassword(password);
  users = {};
  for (const [key, role, accountState, verified] of [
    ['admin', Role.ADMIN, AccountState.ACTIVE, true],
    ['raceAdmin', Role.ADMIN, AccountState.ACTIVE, true],
    ['staff', Role.STAFF, AccountState.ACTIVE, true],
    ['coach', Role.COACH, AccountState.ACTIVE, true],
    ['client', Role.CLIENT, AccountState.ACTIVE, true],
    ['other', Role.CLIENT, AccountState.ACTIVE, true],
    ['invited', Role.CLIENT, AccountState.INVITED, true],
    ['pending', Role.CLIENT, AccountState.PENDING_VERIFICATION, false],
    ['disabled', Role.CLIENT, AccountState.DISABLED, true],
    ['unverified', Role.CLIENT, AccountState.ACTIVE, false],
  ]) {
    users[key] = await migrator.user.create({ data: {
      normalizedEmail: `${key.toLowerCase()}@studio.example`, role, accountState, passwordHash,
      emailVerifiedAt: verified ? new Date() : null,
      ...(role === Role.CLIENT ? { client: { create: { displayName: key } } } : {}),
      ...(role === Role.COACH ? { coach: { create: { displayName: key } } } : {}),
    } });
  }
  app = await startApp({ ...loadConfig({ ...process.env, DATABASE_URL: api.href, DASHBOARD_ORIGIN: allowedOrigin }),
    host: '127.0.0.1', port: 0, socketRecheckMs: 200 });
  base = await app.getUrl();
  sessions = {};
  for (const key of ['admin', 'raceAdmin', 'staff', 'coach', 'client']) {
    sessions[key] = await expectStatus(200, '/auth/login', {
      method: 'POST', body: { email: users[key].normalizedEmail, password },
    });
  }
});

after(async () => {
  await app?.close();
  await Promise.all([migrator?.$disconnect(), runtime?.$disconnect()]);
  if (created) await owner.$executeRawUnsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await owner?.$disconnect();
});

async function request(path, { method = 'GET', body, access, key, ...rest } = {}) {
  return fetch(base + '/api/v1' + path, { method, headers: {
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(access ? { authorization: `Bearer ${access}` } : {}),
    ...(key ? { 'idempotency-key': key } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body), ...rest });
}

async function expectStatus(status, path, options) {
  const res = await request(path, options);
  const payload = res.status === 204 ? null : await res.json();
  assert.equal(res.status, status, `${path}: ${JSON.stringify(payload)}`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  return payload;
}

function grantOptions(enabled, key = randomUUID()) {
  return { method: 'PUT', access: sessions.admin.accessToken, key, body: { enabled } };
}

function socket(ticket, origin = allowedOrigin) {
  return io(base, { transports: ['websocket'], reconnection: false, auth: { ticket }, timeout: 2000,
    extraHeaders: { origin } });
}

test('process health, PostgreSQL readiness, authenticated self, and safe rejected login', async () => {
  assert.deepEqual(await expectStatus(200, '/health'), { status: 'ok' });
  assert.deepEqual(await expectStatus(200, '/health/ready'), { status: 'ready' });
  assert.equal((await expectStatus(200, '/me', { access: sessions.client.accessToken })).id, users.client.id);
  assert.equal((await expectStatus(401, '/me', { access: sessions.client.accessToken + 'x' })).code, 'UNAUTHENTICATED');
  for (const [email, inputPassword] of [[users.client.normalizedEmail, 'wrong'], ['missing@studio.example', password]]) {
    const denied = await expectStatus(401, '/auth/login', { method: 'POST', body: { email, password: inputPassword } });
    assert.equal(denied.code, 'UNAUTHENTICATED');
    assert(!JSON.stringify(denied).includes(email));
  }
});

test('invited, unverified, pending, and disabled accounts cannot log in', async () => {
  for (const name of ['invited', 'pending', 'disabled', 'unverified']) {
    await expectStatus(401, '/auth/login', { method: 'POST', body: { email: users[name].normalizedEmail, password } });
  }
});

test('client and coach cannot access another account; staff grants remain independent and invitations cannot set roles', async () => {
  for (const role of ['client', 'coach', 'staff']) {
    await expectStatus(403, `/users/${users.other.id}`, { access: sessions[role].accessToken });
  }
  await expectStatus(204, `/staff-grants/${users.staff.id}/client.manage`, grantOptions(true));
  const found = await expectStatus(200, `/users/${users.other.id}`, { access: sessions.staff.accessToken });
  assert.equal(found.id, users.other.id);
  assert(!('passwordHash' in found));
  await expectStatus(404, `/users/${users.coach.id}`, { access: sessions.staff.accessToken });
  await expectStatus(403, '/studio-settings', { access: sessions.staff.accessToken });
  await expectStatus(403, `/memberships/${randomUUID()}/activate`, { method: 'POST', access: sessions.staff.accessToken });
  await expectStatus(400, '/users/invite', { method: 'POST', access: sessions.staff.accessToken,
    body: { email: 'invite@studio.example', displayName: 'Invite', role: 'ADMIN', grants: ['payment.verify'] } });
  assert.equal((await expectStatus(409, '/users/invite', { method: 'POST', access: sessions.staff.accessToken,
    body: { email: 'invite@studio.example', displayName: 'Invite' } })).code, 'ONBOARDING_POLICY_PENDING');
  assert.equal(await migrator.user.count({ where: { normalizedEmail: 'invite@studio.example' } }), 0);
});

test('activation exception and commission routes stay Admin-only even with independent staff grants', async () => {
  await expectStatus(204, `/staff-grants/${users.staff.id}/membership.activate`, grantOptions(true));
  await expectStatus(400, `/staff-grants/${users.staff.id}/commission.read`, grantOptions(true));
  const membership = `/memberships/${randomUUID()}`;
  for (const role of ['staff', 'coach', 'client']) {
    await expectStatus(403, membership + '/activate-exception', { method: 'POST', access: sessions[role].accessToken,
      body: { reason: 'Test reason' } });
    await expectStatus(403, '/admin/commissions', { access: sessions[role].accessToken });
  }
  await expectStatus(409, membership + '/activate', { method: 'POST', access: sessions.staff.accessToken });
  await expectStatus(400, membership + '/activate-exception', { method: 'POST', access: sessions.admin.accessToken, body: { reason: ' ' } });
  await expectStatus(409, membership + '/activate-exception', { method: 'POST', access: sessions.admin.accessToken, body: { reason: 'Test reason' } });
  await expectStatus(409, '/admin/commissions', { access: sessions.admin.accessToken });
});

test('concurrent idempotent publication commits one revision, one result, and one audit record', async () => {
  const key = randomUUID();
  const options = { method: 'PUT', access: sessions.admin.accessToken, key, body: { timezone: 'Africa/Cairo', defaultCurrency: 'EGP' } };
  const [a, b] = await Promise.all([expectStatus(200, '/studio-settings', options), expectStatus(200, '/studio-settings', options)]);
  assert.deepEqual(a, b);
  assert.equal(a.version, 1);
  assert.equal(await migrator.policyRevision.count(), 1);
  const policyAudit = await migrator.auditLog.findFirstOrThrow({ where: { action: 'STUDIO_POLICY_PUBLISHED', targetId: a.id } });
  assert.equal(policyAudit.actorId, users.admin.id);
  assert(policyAudit.requestId);
  assert.equal(await migrator.auditLog.count({ where: { action: 'STUDIO_POLICY_PUBLISHED' } }), 1);
  const retry = await migrator.idempotencyKey.findFirstOrThrow({ where: { key } });
  assert.equal(retry.resultStatus, 200);
  assert.equal(retry.resultReference, a.id);
  assert.equal((await expectStatus(409, '/studio-settings', { ...options, body: { ...options.body, defaultCurrency: 'USD' } })).code,
    'IDEMPOTENCY_KEY_REUSED');
  await expectStatus(403, '/studio-settings', { ...options, access: sessions.staff.accessToken });
  assert.equal((await expectStatus(200, '/studio-settings', { access: sessions.admin.accessToken })).activePolicy.id, a.id);
  const rejected = grantOptions(true);
  await expectStatus(404, `/staff-grants/${users.coach.id}/client.manage`, rejected);
  assert.equal(await migrator.idempotencyKey.count({ where: { key: rejected.key } }), 0);
  assert.equal(await migrator.auditLog.count({ where: { action: 'STAFF_GRANT_CHANGED' } }), 2);
});

test('cross-owner token FK, immutable audit, and private schema privileges are enforced by PostgreSQL', async () => {
  const clientSession = await migrator.authSession.findFirstOrThrow({ where: { userId: users.client.id } });
  await assert.rejects(migrator.authToken.create({ data: {
    userId: users.other.id, sessionId: clientSession.id, purpose: TokenPurpose.SOCKET,
    digest: digest(randomUUID()), expiresAt: new Date(Date.now() + 1000),
  } }), { code: 'P2003' });
  await assert.rejects(migrator.authToken.create({ data: {
    userId: users.client.id, purpose: TokenPurpose.REFRESH, digest: digest(randomUUID()), expiresAt: new Date(Date.now() + 1000),
  } }));
  await assert.rejects(runtime.$executeRaw`DELETE FROM audit_log`);
  await migrator.$executeRaw`CREATE TABLE commission_private.access_probe (id integer)`;
  await migrator.$executeRaw`INSERT INTO commission_private.access_probe VALUES (1)`;
  await assert.rejects(runtime.$queryRaw`SELECT id FROM commission_private.access_probe`);
  for (const role of ['studio_worker', 'studio_reporting']) {
    await assert.rejects(migrator.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE "${role}"`);
      await tx.$queryRaw`SELECT id FROM commission_private.access_probe`;
    }));
  }
  assert.equal((await migrator.$queryRaw`SELECT id FROM commission_private.access_probe`)[0].id, 1);
});

test('single-use socket tickets, origin checks and immediate grant revocation', async () => {
  const ticket = (await expectStatus(200, '/auth/socket-ticket', { method: 'POST', access: sessions.staff.accessToken })).ticket;
  const wrongOrigin = await fetch(base + '/socket.io/?EIO=4&transport=polling', { headers: { origin: 'https://untrusted.example' } });
  assert.equal(wrongOrigin.status, 400);
  const connected = socket(ticket);
  try {
    await once(connected, 'connect', { signal: AbortSignal.timeout(3000) });
    const replay = socket(ticket);
    try {
      const [error] = await once(replay, 'connect_error', { signal: AbortSignal.timeout(3000) });
      assert.equal(error.message, 'UNAUTHENTICATED');
    } finally { replay.disconnect(); }
    const disconnected = once(connected, 'disconnect', { signal: AbortSignal.timeout(3000) });
    await expectStatus(204, `/staff-grants/${users.staff.id}/client.manage`, grantOptions(false));
    await disconnected;
    await expectStatus(403, `/users/${users.other.id}`, { access: sessions.staff.accessToken });
  } finally { connected.disconnect(); }
});

test('socket fallback closes a session when invalidation was missed', async () => {
  const ticket = (await expectStatus(200, '/auth/socket-ticket', { method: 'POST', access: sessions.coach.accessToken })).ticket;
  const connected = socket(ticket);
  try {
    await once(connected, 'connect', { signal: AbortSignal.timeout(3000) });
    const disconnected = once(connected, 'disconnect', { signal: AbortSignal.timeout(3000) });
    await migrator.authSession.updateMany({ where: { userId: users.coach.id }, data: { revokedAt: new Date() } });
    await disconnected;
    await expectStatus(401, '/me', { access: sessions.coach.accessToken });
  } finally { connected.disconnect(); }
});

test('refresh rotation stores only digests and replay commits revocation', async () => {
  const old = sessions.client.refreshToken;
  assert.equal(await migrator.authToken.count({ where: { digest: old } }), 0);
  const renewed = await expectStatus(200, '/auth/refresh', { method: 'POST', body: { refreshToken: old } });
  assert.notEqual(renewed.refreshToken, old);
  await expectStatus(200, '/me', { access: renewed.accessToken });
  await expectStatus(401, '/auth/refresh', { method: 'POST', body: { refreshToken: old } });
  await expectStatus(401, '/auth/refresh', { method: 'POST', body: { refreshToken: renewed.refreshToken } });
  await expectStatus(401, '/me', { access: renewed.accessToken });
  const original = await migrator.authToken.findUniqueOrThrow({ where: { digest: digest(old) } });
  assert(original.consumedAt);
  const revoked = await migrator.authSession.findUniqueOrThrow({ where: { id: original.sessionId } });
  assert(revoked.revokedAt);
  assert.equal(await migrator.auditLog.count({ where: { action: 'REFRESH_REPLAY', targetId: revoked.id } }), 1);
});

test('a write waiting on an actor lock observes revocation before it can commit', async () => {
  let signalLocked;
  const locked = new Promise(resolve => { signalLocked = resolve; });
  const key = randomUUID();
  const revocation = migrator.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM app_user WHERE id = ${users.raceAdmin.id}::uuid FOR UPDATE`;
    signalLocked();
    const deadline = Date.now() + 1500;
    let waiter = false;
    while (!waiter && Date.now() < deadline) {
      const [row] = await owner.$queryRaw`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname = ${databaseName}
        AND usename = 'studio_api' AND wait_event_type = 'Lock' AND query LIKE '%FOR SHARE%'
      ) AS waiting`;
      waiter = row.waiting;
      if (!waiter) await delay(15);
    }
    assert(waiter, 'the protected write should be waiting on the actor lock');
    await tx.user.update({ where: { id: users.raceAdmin.id }, data: { accountState: AccountState.DISABLED } });
  });
  await locked;
  const denied = expectStatus(401, '/studio-settings', { method: 'PUT', key, access: sessions.raceAdmin.accessToken,
    body: { timezone: 'UTC', defaultCurrency: 'USD' } });
  await Promise.all([denied, revocation]);
  assert.equal(await migrator.idempotencyKey.count({ where: { key } }), 0);
  assert.equal(await migrator.policyRevision.count(), 1);
});

test('account disable and logout revoke active sessions and audit the actions', async () => {
  const path = `/users/${users.staff.id}/disable`;
  const action = { method: 'POST', access: sessions.admin.accessToken, key: randomUUID() };
  await expectStatus(204, path, action);
  await expectStatus(204, path, action);
  await expectStatus(401, '/me', { access: sessions.staff.accessToken });
  assert.equal(await migrator.auditLog.count({ where: { action: 'ACCOUNT_DISABLED', targetId: users.staff.id } }), 1);
  await expectStatus(204, '/auth/logout', { method: 'POST', access: sessions.admin.accessToken });
  await expectStatus(401, '/me', { access: sessions.admin.accessToken });
  assert.equal(await migrator.auditLog.count({ where: { action: 'SESSION_REVOKED', actorId: users.admin.id } }), 1);
});

test('Next.js BFF keeps tokens server-side and enforces origin, CSRF, rotation and logout', async () => {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  const dashboard = `http://127.0.0.1:${port}`;
  const project = resolve(__dirname, '../../dashboard');
  const processHandle = spawn(process.execPath, [
    resolve(project, 'node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port),
  ], { cwd: project, env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    DASHBOARD_ORIGIN: dashboard, API_BASE_URL: base, DASHBOARD_CSRF_KEY: randomBytes(32).toString('hex') },
    stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  processHandle.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  const exited = once(processHandle, 'exit');
  const jar = new Map();
  async function browser(path, { method = 'GET', origin, csrf, body } = {}) {
    const response = await fetch(dashboard + path, { method, headers: {
      ...(origin ? { origin } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      cookie: [...jar].map(([key, value]) => `${key}=${value}`).join('; '),
    }, body: body ? JSON.stringify(body) : undefined });
    for (const cookie of response.headers.getSetCookie()) {
      const first = cookie.split(';', 1)[0];
      const index = first.indexOf('=');
      jar.set(first.slice(0, index), first.slice(index + 1));
    }
    return response;
  }
  try {
    const deadline = Date.now() + 8000;
    let ready = false;
    while (Date.now() < deadline && processHandle.exitCode === null && !ready) {
      ready = (await fetch(dashboard, { signal: AbortSignal.timeout(1000) }).catch(() => null))?.ok === true;
      if (!ready) await delay(100);
    }
    assert(ready, 'Next.js did not start: ' + stderr);
    const login = { method: 'POST', origin: dashboard, body: { email: users.other.normalizedEmail, password } };
    assert.equal((await browser('/api/session/login', { ...login, origin: 'https://untrusted.example' })).status, 403);
    const signedIn = await browser('/api/session/login', login);
    assert.equal(signedIn.status, 200);
    assert.deepEqual(await signedIn.json(), { ok: true });
    assert.equal(signedIn.headers.get('cache-control'), 'no-store');
    assert.equal(signedIn.headers.getSetCookie().length, 2);
    for (const cookie of signedIn.headers.getSetCookie()) {
      for (const attribute of ['Secure', 'HttpOnly', 'SameSite=lax', 'Path=/']) assert(cookie.toLowerCase().includes(attribute.toLowerCase()));
      assert(!/domain=/i.test(cookie));
    }
    const me = await browser('/api/studio/v1/me');
    assert.equal((await me.json()).id, users.other.id);
    assert.equal((await browser('/api/studio/v1/admin/commissions')).status, 404);
    const oldRefresh = jar.get('__Host-ss_refresh');
    const csrf = (await (await browser('/api/session/csrf')).json()).csrfToken;
    assert.equal((await browser('/api/session/refresh', { method: 'POST', origin: dashboard })).status, 403);
    assert.equal((await browser('/api/session/refresh', { method: 'POST', origin: dashboard, csrf })).status, 200);
    assert.notEqual(jar.get('__Host-ss_refresh'), oldRefresh);
    assert.equal((await browser('/api/session/logout', { method: 'POST', origin: dashboard, csrf })).status, 403);
    const newCsrf = (await (await browser('/api/session/csrf')).json()).csrfToken;
    const renewedRefresh = jar.get('__Host-ss_refresh');
    jar.delete('__Host-ss_access');
    assert.equal((await browser('/api/session/logout', { method: 'POST', origin: dashboard, csrf: newCsrf })).status, 200);
    assert.equal((await browser('/api/studio/v1/me')).status, 401);
    await expectStatus(401, '/auth/refresh', { method: 'POST', body: { refreshToken: renewedRefresh } });
  } finally {
    if (processHandle.exitCode === null) processHandle.kill('SIGTERM');
    await exited;
  }
});
