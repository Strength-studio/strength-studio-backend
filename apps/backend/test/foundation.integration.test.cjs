const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient, Role, AccountState, TokenPurpose } = require('@prisma/client');
const { io } = require('socket.io-client');
const { startApp } = require('../dist/app.js');
const { CONFIG, loadConfig } = require('../dist/platform/config.js');
const { hashPassword } = require('../dist/identity/password.js');
const { digest, Sessions } = require('../dist/identity/session.service.js');
const { dateOnly, riyadhDate } = require('../dist/platform/riyadh-calendar.js');
const databaseClock = require('../dist/platform/database.js');

const password = 'integration-only fixture passphrase';
const allowedOrigin = 'http://localhost:3001';
const databaseName = `studio_test_${randomBytes(8).toString('hex')}`;
const prismaDirectory = resolve(__dirname, '../prisma');
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

function deployMigrations(api, migration, schema = join(prismaDirectory, 'schema.prisma')) {
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], {
    env: { ...process.env, DATABASE_URL: api.href, MIGRATION_DATABASE_URL: migration.href }, timeout: 40_000,
  });
}

before(async () => {
  const { api, migration } = disposableUrls();
  const control = new URL(migration);
  control.pathname = '/postgres';
  owner = new PrismaClient({ datasourceUrl: control.href });
  await owner.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
  created = true;
  deployMigrations(api, migration);
  migrator = new PrismaClient({ datasourceUrl: migration.href });
  runtime = new PrismaClient({ datasourceUrl: api.href });
  const passwordHash = await hashPassword(password);
  users = {};
  for (const [key, role, accountState, verified] of [
    ['admin', Role.ADMIN, AccountState.ACTIVE, true],
    ['raceAdmin', Role.ADMIN, AccountState.ACTIVE, true],
    ['staff', Role.STAFF, AccountState.ACTIVE, true],
    ['clientManager', Role.STAFF, AccountState.ACTIVE, true],
    ['coach', Role.COACH, AccountState.ACTIVE, true],
    ['client', Role.CLIENT, AccountState.ACTIVE, true],
    ['other', Role.CLIENT, AccountState.ACTIVE, true],
    ['invited', Role.CLIENT, AccountState.INVITED, true],
    ['pending', Role.CLIENT, AccountState.PENDING_VERIFICATION, false],
    ['disabled', Role.CLIENT, AccountState.DISABLED, true],
    ['unverified', Role.CLIENT, AccountState.ACTIVE, false],
    ['missingProfile', Role.CLIENT, AccountState.ACTIVE, true],
  ]) {
    users[key] = await migrator.user.create({ data: {
      normalizedEmail: `${key.toLowerCase()}@studio.example`, role, accountState, passwordHash,
      emailVerifiedAt: verified ? new Date() : null,
      ...((role === Role.CLIENT && key !== 'missingProfile') || role === Role.COACH
        ? { client: { create: { displayName: key, createdAt: new Date('2026-11-01T00:00:00Z') } } } : {}),
      ...(role === Role.COACH ? { coach: { create: { displayName: key } } } : {}),
    } });
  }
  app = await startApp({ ...loadConfig({ ...process.env, DATABASE_URL: api.href, DASHBOARD_ORIGIN: allowedOrigin }),
    host: '127.0.0.1', port: 0, socketRecheckMs: 200, attendanceCaptureForTesting: true });
  base = await app.getUrl();
  sessions = {};
  for (const key of ['admin', 'raceAdmin', 'staff', 'coach', 'client']) {
    sessions[key] = await expectStatus(200, '/auth/login', {
      method: 'POST', body: { email: users[key].normalizedEmail, password },
    });
  }
  // Reserve the HTTP login limit for tests of the login endpoint and dashboard session route.
  for (const key of ['clientManager', 'missingProfile']) {
    sessions[key] = await app.get(Sessions).login(users[key].normalizedEmail, password);
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

test('Client reads require explicit management access or the authenticated Client owner', async () => {
  const as = key => ({ access: sessions[key].accessToken });
  const path = '/clients/' + users.client.id;
  const self = { id: users.client.id, email: users.client.normalizedEmail, displayName: 'client' };
  const summary = { ...self, accountState: 'ACTIVE', emailVerified: true, createdAt: '2026-11-01T00:00:00.000Z' };
  const detail = { ...summary, emailVerifiedAt: users.client.emailVerifiedAt.toISOString() };
  await expectStatus(401, '/clients');
  for (const key of ['staff', 'coach', 'client']) {
    await expectStatus(403, '/clients', as(key));
    await expectStatus(403, path, as(key));
  }
  await expectStatus(403, '/clients/' + users.other.id, as('client'));
  for (const key of ['admin', 'staff', 'coach']) await expectStatus(403, '/me/client-profile', as(key));
  assert.deepEqual(await expectStatus(200, '/me/client-profile', as('client')), self);
  await expectStatus(400, '/me/client-profile?id=' + users.other.id, as('client'));
  await expectStatus(404, '/me/client-profile', as('missingProfile'));

  await expectStatus(204, `/staff-grants/${users.clientManager.id}/client.manage`, grantOptions(true));
  for (const key of ['admin', 'clientManager']) {
    assert.deepEqual(await expectStatus(200, '/clients?q=CLIENT', as(key)), { items: [summary], nextCursor: null });
    assert.deepEqual(await expectStatus(200, path, as(key)), detail);
    for (const target of ['admin', 'coach', 'missingProfile']) {
      const denied = await expectStatus(404, '/clients/' + users[target].id, as(key));
      assert.equal(denied.code, 'CLIENT_NOT_FOUND');
    }
  }
  await expectStatus(204, `/staff-grants/${users.clientManager.id}/client.manage`, grantOptions(false));
  await expectStatus(403, '/clients', as('clientManager'));
  await expectStatus(400, '/clients/not-an-id', as('admin'));
  await expectStatus(400, path + '?q=client', as('admin'));
});

test('Client directory uses scoped cursors and literal prefix search with strict filters', async () => {
  const admin = { access: sessions.admin.accessToken };
  const expected = ['client', 'other', 'invited', 'pending', 'disabled', 'unverified'].map(key => users[key].id).sort().reverse();
  const seen = [];
  let after;
  do {
    const query = new URLSearchParams({ limit: '2', ...(after ? { after } : {}) });
    const page = await expectStatus(200, '/clients?' + query, admin);
    assert.deepEqual(Object.keys(page).sort(), ['items', 'nextCursor']);
    assert.equal(page.items.length, 2);
    seen.push(...page.items.map(item => item.id));
    if (page.nextCursor) assert.match(page.nextCursor, /^[A-Za-z0-9_-]{48}$/);
    assert.ok(seen.length <= expected.length);
    after = page.nextCursor;
  } while (after);
  assert.deepEqual(seen, expected);
  const { items } = await expectStatus(200, '/clients?q=%20OtHeR%40%20&accountState=ACTIVE&emailVerified=true', admin);
  assert.deepEqual(items.map(item => item.id), [users.other.id]);
  const pending = await expectStatus(200, '/clients?q=PEN&accountState=PENDING_VERIFICATION&emailVerified=false', admin);
  assert.deepEqual(pending.items.map(item => item.id), [users.pending.id]);
  for (const q of ['tHer', 'other_', '%', '\\', 'coach', 'missingprofile', 'admin']) {
    assert.deepEqual(await expectStatus(200, '/clients?' + new URLSearchParams({ q }), admin), { items: [], nextCursor: null });
  }
  for (const query of ['limit=0', 'limit=101', 'limit=1.0', 'limit=1&limit=2', 'limit=1e1', 'after=bogus',
    'q=', 'q=%00', 'q=' + 'x'.repeat(121), 'q=x&q=y', 'accountState=active', 'emailVerified=1', 'emailVerified=FALSE',
    'emailVerified=true&emailVerified=false', 'role=ADMIN']) {
    assert.equal((await expectStatus(400, '/clients?' + query, admin)).code, 'INVALID_INPUT');
  }
  const cursorFor = id => Buffer.from(id).toString('base64url');
  for (const id of [users.coach.id, users.missingProfile.id, randomUUID(), 'x'.repeat(36)]) {
    assert.equal((await expectStatus(400, '/clients?after=' + cursorFor(id), admin)).code, 'INVALID_CLIENT_CURSOR');
  }
  assert.equal((await expectStatus(400, '/clients?accountState=DISABLED&after=' + cursorFor(users.client.id), admin)).code,
    'INVALID_CLIENT_CURSOR');
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
  await expectStatus(400, '/users/invite', { method: 'POST', access: sessions.admin.accessToken,
    body: { email: 'invite@studio.example', displayName: 'Invite', role: 'ADMIN', grants: ['payment.verify'] } });
  assert.equal((await expectStatus(403, '/users/invite', { method: 'POST', access: sessions.staff.accessToken,
    body: { email: 'invite@studio.example', displayName: 'Invite' } })).code, 'FORBIDDEN');
  assert.equal(await migrator.user.count({ where: { normalizedEmail: 'invite@studio.example' } }), 0);
});

test('both activation routes and commission reads stay Admin-only even with a stored legacy grant', async () => {
  await expectStatus(400, `/staff-grants/${users.staff.id}/membership.activate`, grantOptions(true));
  await migrator.staffGrant.create({ data: {
    staffUserId: users.staff.id, permission: 'MEMBERSHIP_ACTIVATE', changedById: users.admin.id,
  } });
  await expectStatus(400, `/staff-grants/${users.staff.id}/commission.read`, grantOptions(true));
  const membership = `/memberships/${randomUUID()}`;
  for (const role of ['staff', 'coach', 'client']) {
    await expectStatus(403, membership + '/activate', { method: 'POST', access: sessions[role].accessToken });
    await expectStatus(403, membership + '/activate-exception', { method: 'POST', access: sessions[role].accessToken,
      body: { reason: 'Test reason' } });
    await expectStatus(403, '/admin/commissions', { access: sessions[role].accessToken });
  }
  await expectStatus(409, membership + '/activate', { method: 'POST', access: sessions.admin.accessToken });
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
  const grantAuditCount = await migrator.auditLog.count({ where: { action: 'STAFF_GRANT_CHANGED' } });
  await expectStatus(404, `/staff-grants/${users.coach.id}/client.manage`, rejected);
  assert.equal(await migrator.idempotencyKey.count({ where: { key: rejected.key } }), 0);
  assert.equal(await migrator.auditLog.count({ where: { action: 'STAFF_GRANT_CHANGED' } }), grantAuditCount);
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

test('public catalog keeps draft, issued, superseded, and archived versions in their proper scopes', async () => {
  const admin = { access: sessions.admin.accessToken };
  const staff = { access: sessions.staff.accessToken };
  const client = { access: sessions.client.accessToken };
  const write = (actor, body, method = 'POST') => ({ ...actor, method, key: randomUUID(), body });

  await expectStatus(401, '/packages');
  await expectStatus(403, '/packages', { access: sessions.coach.accessToken });
  await expectStatus(403, '/packages', staff);
  await expectStatus(204, `/staff-grants/${users.staff.id}/catalog.manage`, grantOptions(true));
  await expectStatus(403, '/packages', staff);
  await expectStatus(403, '/packages/management', client);

  const typeInput = { code: 'individual-training', name: 'Individual training', mode: 'INDIVIDUAL' };
  await expectStatus(403, '/session-types', write(staff, typeInput));
  const { sessionTypeId } = await expectStatus(201, '/session-types', write(admin, typeInput));
  const { sessionTypeId: secondType } = await expectStatus(201, '/session-types',
    write(admin, { code: 'GROUP-TRAINING', name: 'Group training', mode: 'GROUP' }));

  const terms = {
    name: 'Ten sessions', description: 'Public session package', price: '150', kind: 'SESSION',
    validityDays: 30, sessionAllowance: 10, sessionTypeIds: [sessionTypeId],
  };
  await expectStatus(400, '/packages', write(staff, { code: 'BAD-PRICE', ...terms, price: '10.001' }));
  await expectStatus(400, '/packages', write(staff, { code: 'BAD-TERMS', ...terms, sessionAllowance: null }));
  await expectStatus(400, '/packages', write(staff, { code: 'BAD-TYPE', ...terms, sessionTypeIds: [randomUUID()] }));
  assert.equal(await migrator.package.count({ where: { code: 'BAD-TYPE' } }), 0);
  const creation = write(staff, { code: 'ten-sessions', ...terms });
  const { packageId } = await expectStatus(201, '/packages', creation);
  assert.deepEqual(await expectStatus(201, '/packages', { ...creation, body: { ...creation.body, price: '150.00' } }),
    { packageId });
  assert.equal(await migrator.auditLog.count({ where: { targetId: packageId, action: 'CATALOG_CREATED' } }), 1);

  const offer = '/packages/' + packageId;
  const { items: [draft] } = await expectStatus(200, offer + '/management', staff);
  const firstPath = offer + '/versions/' + draft.id;
  assert.equal(draft.draftRevision, 1);
  assert.deepEqual((await expectStatus(200, '/packages', client)).items, []);
  await expectStatus(404, firstPath, client);
  await expectStatus(403, offer + '/management/audit', staff);
  await expectStatus(204, `/staff-grants/${users.staff.id}/audit.read`, grantOptions(true));

  await expectStatus(400, firstPath, write(staff, { expectedDraftRevision: 1, name: null }, 'PATCH'));
  await expectStatus(204, firstPath,
    write(staff, { expectedDraftRevision: 1, price: '160.5', sessionTypeIds: [secondType] }, 'PATCH'));
  await expectStatus(409, firstPath + '/publish', write(staff, { expectedDraftRevision: 1, expectedCurrentVersionId: null }));
  const initialPublish = write(staff, { expectedDraftRevision: 2, expectedCurrentVersionId: null });
  await expectStatus(204, firstPath + '/publish', initialPublish);
  await expectStatus(204, firstPath + '/publish', initialPublish);
  const published = await expectStatus(200, firstPath, client);
  assert.equal(published.price, '160.50');
  assert.equal(published.currency, 'SAR');
  assert.deepEqual(published.sessionTypes.map(type => type.id), [secondType]);
  assert(!('draftRevision' in published));
  await expectStatus(409, firstPath, write(staff, { expectedDraftRevision: 2, price: '1.00' }, 'PATCH'));

  for (const query of [
    runtime.$executeRaw`UPDATE package_version SET price = 1 WHERE id = ${draft.id}::uuid`,
    runtime.$executeRaw`UPDATE package_version SET published_at = NULL WHERE id = ${draft.id}::uuid`,
    runtime.$executeRaw`DELETE FROM package_version_session_type WHERE package_version_id = ${draft.id}::uuid`,
    runtime.$executeRaw`INSERT INTO package_version_session_type VALUES (${draft.id}::uuid, ${sessionTypeId}::uuid)`,
  ]) {
    await assert.rejects(query, error => error.code === 'P2010' && error.meta?.code === '23514');
  }

  const successor = { expectedCurrentVersionId: draft.id, terms: null };
  const { versionId: next } = await expectStatus(201, offer + '/versions', write(staff, successor));
  const { versionId: competing } = await expectStatus(201, offer + '/versions', write(staff, successor));
  await assert.rejects(runtime.$executeRaw`UPDATE package_version SET published_at = clock_timestamp() WHERE id = ${competing}::uuid`,
    error => error.code === 'P2010' && error.meta?.code === '23505');
  const body = { expectedCurrentVersionId: draft.id, expectedDraftRevision: 1 };
  const responses = await Promise.all([next, competing].map(id => request(offer + '/versions/' + id + '/publish', write(staff, body))));
  assert.deepEqual(responses.map(response => response.status).sort(), [204, 409]);
  const winner = responses[0].status === 204 ? next : competing;
  await expectStatus(404, firstPath, client);
  assert.equal((await expectStatus(200, '/packages', client)).items[0].id, winner);
  assert.equal((await expectStatus(200, offer + '/management', staff)).items.length, 3);
  const auditPage = await expectStatus(200, offer + '/management/audit?limit=1', staff);
  assert.equal(auditPage.items.length, 1);
  assert(auditPage.nextCursor);
  const history = await expectStatus(200, offer + '/management/audit?after=' + auditPage.nextCursor, staff);
  const actions = [auditPage.items[0], ...history.items];
  assert.equal(actions.filter(event => event.action === 'CATALOG_PUBLISHED').length, 2);
  assert.equal(actions.find(event => event.details.previousVersionId === draft.id).details.versionId, winner);
  await expectStatus(204, `/staff-grants/${users.staff.id}/catalog.read`, grantOptions(true));
  assert.equal((await expectStatus(200, '/packages', staff)).items[0].id, winner);

  const archive = write(staff, { expectedCurrentVersionId: winner, reason: 'Offer retired' });
  await expectStatus(204, offer + '/archive', archive);
  await expectStatus(404, offer + '/versions/' + winner, client);
  assert.deepEqual((await expectStatus(200, '/packages', client)).items, []);
  const archived = await expectStatus(200, offer + '/management', staff);
  assert(archived.archivedAt);
  assert.equal(archived.items.length, 3);
  assert.equal(archived.items.find(version => version.id === draft.id).price, '160.50');
  assert.equal((await migrator.auditLog.findFirstOrThrow({ where: { targetId: packageId, action: 'CATALOG_ARCHIVED' } })).reason,
    'Offer retired');
  await expectStatus(204, `/staff-grants/${users.staff.id}/catalog.manage`, grantOptions(false));
  await expectStatus(403, offer + '/archive', archive);
  await expectStatus(403, offer + '/management/audit', staff);
});

test('zero-price publication and session-type retirement enforce catalog authority and eligibility', async () => {
  const admin = { access: sessions.admin.accessToken };
  const staff = { access: sessions.staff.accessToken };
  const client = { access: sessions.client.accessToken };
  const write = (actor, body) => ({ ...actor, method: 'POST', key: randomUUID(), body });
  await expectStatus(204, `/staff-grants/${users.staff.id}/catalog.manage`, grantOptions(true));
  const { sessionTypeId } = await expectStatus(201, '/session-types',
    write(admin, { code: 'INTRO', name: 'Intro session', mode: 'GROUP' }));
  const terms = { name: 'Intro offer', description: '', price: '0.00', kind: 'TIME', validityDays: 7, sessionTypeIds: [sessionTypeId] };
  const { packageId } = await expectStatus(201, '/packages', write(staff, { code: 'INTRO-OFFER', ...terms }));
  const offer = '/packages/' + packageId;
  const { items: [draft] } = await expectStatus(200, offer + '/management', staff);
  const version = offer + '/versions/' + draft.id;
  const firstPublish = { expectedCurrentVersionId: null, expectedDraftRevision: 1 };
  await expectStatus(403, version + '/publish', write(staff, firstPublish));
  await expectStatus(204, version + '/publish', write(admin, firstPublish));
  const { versionId } = await expectStatus(201, offer + '/versions', write(staff, { expectedCurrentVersionId: draft.id, terms: null }));
  const archiveType = '/session-types/' + sessionTypeId + '/archive';
  await expectStatus(403, archiveType, write(staff, {}));
  await expectStatus(204, archiveType, write(admin, {}));
  assert(!(await expectStatus(200, '/session-types', client)).items.some(type => type.id === sessionTypeId));
  assert.deepEqual((await expectStatus(200, version, client)).sessionTypes.map(type => type.id), [sessionTypeId]);
  await expectStatus(409, offer + '/versions/' + versionId + '/publish',
    write(admin, { expectedCurrentVersionId: draft.id, expectedDraftRevision: 1 }));
  assert.equal((await expectStatus(200, version, client)).price, '0.00');
});

const complimentaryPath = '/purchases/complimentary';
const complimentaryOperation = 'purchase.accept-complimentary';
const positivePricePath = '/purchases/positive-price';
const positivePriceOperation = 'purchase.accept-positive-price';
const acceptanceAction = 'PURCHASE_ACCEPTED_RECORDED';

function adminWrite(body) {
  return { method: 'POST', key: randomUUID(), access: sessions.admin.accessToken, body };
}

async function acceptanceOffer(price = '0.00') {
  const suffix = randomBytes(5).toString('hex');
  const { sessionTypeId } = await expectStatus(201, '/session-types', adminWrite({
    code: 'ACCEPT-TYPE-' + suffix, name: 'Complimentary introduction', mode: 'INDIVIDUAL',
  }));
  const terms = {
    name: 'Complimentary package', description: 'The accepted terms', price, kind: 'SESSION',
    validityDays: 14, sessionAllowance: 2, sessionTypeIds: [sessionTypeId],
  };
  const { packageId } = await expectStatus(201, '/packages', adminWrite({ code: 'ACCEPT-' + suffix, ...terms }));
  const path = '/packages/' + packageId;
  const { items: [draft] } = await expectStatus(200, path + '/management', { access: sessions.admin.accessToken });
  await expectStatus(204, path + '/versions/' + draft.id + '/publish',
    adminWrite({ expectedDraftRevision: 1, expectedCurrentVersionId: null }));
  return { packageId, packageVersionId: draft.id, path, terms, sessionTypeId };
}

function acceptanceRequest(offer, overrides = {}) {
  return adminWrite({
    clientId: users.client.id, packageId: offer.packageId, packageVersionId: offer.packageVersionId,
    agreementMethod: 'SIGNED_AGREEMENT', agreementEvidence: 'Agreement reference: acceptance fixture 1',
    purpose: 'Private purpose: welcome appointment', ...overrides,
  });
}

async function acceptanceCounts(operation = complimentaryOperation) {
  return Promise.all([
    migrator.purchase.count(),
    migrator.purchaseAcceptance.count(),
    migrator.membership.count(),
    migrator.auditLog.count({ where: { action: acceptanceAction } }),
    migrator.idempotencyKey.count({ where: { operation } }),
  ]);
}

test('Admin records one complimentary Purchase with frozen terms, evidence and a pending membership', async () => {
  const offer = await acceptanceOffer();
  const write = acceptanceRequest(offer);
  const versionPath = offer.path + '/versions/' + offer.packageVersionId;
  const publicReader = { access: sessions.client.accessToken };
  const originalPublicVersion = await expectStatus(200, versionPath, publicReader);
  const before = await acceptanceCounts();
  const paymentsBefore = await migrator.payment.count();
  const allocationsBefore = await migrator.paymentAllocation.count();
  const issued = await expectStatus(201, complimentaryPath, write);
  assert.deepEqual(await expectStatus(201, complimentaryPath, write), issued);
  assert.equal((await expectStatus(409, complimentaryPath, { ...write, key: randomUUID() })).code,
    'COMPLIMENTARY_ACCEPTANCE_EXISTS');
  assert.equal((await expectStatus(409, complimentaryPath, { ...write, body: { ...write.body, purpose: 'Changed' } })).code,
    'IDEMPOTENCY_KEY_REUSED');
  assert.deepEqual(await acceptanceCounts(), before.map(count => count + 1));

  const acceptance = await migrator.purchaseAcceptance.findUniqueOrThrow({
    where: { id: issued.acceptanceId },
    include: { purchase: { include: { membership: true, packageVersion: { include: { eligibility: true } } } } },
  });
  const { purchase } = acceptance;
  const { packageVersion, membership } = purchase;
  assert.deepEqual(issued, { acceptanceId: acceptance.id, membershipId: membership.id, status: 'PENDING_ACTIVATION' });
  assert.equal(acceptance.purchaseId, purchase.id);
  assert.equal(membership.purchaseId, purchase.id);
  assert.equal((await expectStatus(409, '/memberships/' + membership.id + '/activate', adminWrite())).code, 'WORKFLOW_NOT_ENABLED');
  assert.equal(purchase.type, 'COMPLIMENTARY');
  assert.equal(purchase.clientId, users.client.id);
  assert.equal(purchase.packageVersionId, offer.packageVersionId);
  assert.equal(purchase.acceptedById, users.admin.id);
  await assert.rejects(runtime.$executeRaw`
    INSERT INTO purchase (client_id, package_version_id, type, accepted_by, accepted_at, terms)
    SELECT client_id, package_version_id, type, accepted_by, accepted_at, terms
    FROM purchase WHERE id = ${purchase.id}::uuid`, error => error.meta?.code === '23505');
  assert.deepEqual(purchase.acceptedAt, membership.createdAt);
  assert.deepEqual(purchase.createdAt, purchase.acceptedAt);
  assert.equal(acceptance.agreementMethod, write.body.agreementMethod);
  assert.equal(acceptance.agreementEvidence, write.body.agreementEvidence);
  assert.equal(acceptance.purpose, write.body.purpose);
  assert.equal(packageVersion.id, offer.packageVersionId);
  assert.equal(packageVersion.packageId, offer.packageId);
  assert.equal(packageVersion.currency, 'SAR');
  assert.deepEqual({
    name: packageVersion.name, description: packageVersion.description, price: packageVersion.price.toFixed(2),
    kind: packageVersion.kind, validityDays: packageVersion.validityDays, sessionAllowance: packageVersion.sessionAllowance,
    sessionTypeIds: packageVersion.eligibility.map(link => link.sessionTypeId),
  }, offer.terms);
  const { id, packageId, publishedAt, ...terms } = originalPublicVersion;
  assert.deepEqual(purchase.terms, terms);
  const audit = await migrator.auditLog.findFirstOrThrow({ where: { action: acceptanceAction, targetId: acceptance.id } });
  assert.equal(audit.targetType, 'COMPLIMENTARY_ACCEPTANCE');
  assert.equal(audit.actorId, users.admin.id);
  assert(audit.requestId);
  assert.deepEqual(audit.redactedDetails, {
    purchaseId: purchase.id, agreementMethod: write.body.agreementMethod, packageVersionId: offer.packageVersionId,
  });
  const retry = await migrator.idempotencyKey.findFirstOrThrow({ where: { key: write.key, operation: complimentaryOperation } });
  assert.equal(retry.resultStatus, 201);
  assert.equal(retry.resultReference, acceptance.id);
  assert.deepEqual(await migrator.$queryRaw`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
      AND table_name IN ('finance_account', 'allocation', 'receivable',
        'finance_event', 'revenue', 'credit_lot', 'refund', 'entitlement_entry')`, []);
  await assert.rejects(runtime.$executeRaw`UPDATE complimentary_acceptance SET purpose = 'Changed' WHERE id = ${acceptance.id}::uuid`,
    error => error.meta?.code === '42501');
  await assert.rejects(runtime.$executeRaw`UPDATE purchase SET terms = '{}' WHERE id = ${purchase.id}::uuid`,
    error => error.meta?.code === '42501');
  await assert.rejects(runtime.$executeRaw`DELETE FROM purchase WHERE id = ${purchase.id}::uuid`,
    error => error.meta?.code === '42501');
  await assert.rejects(runtime.$executeRaw`DELETE FROM membership WHERE id = ${membership.id}::uuid`,
    error => error.meta?.code === '42501');

  const publicVersion = await expectStatus(200, versionPath, publicReader);
  assert.deepEqual(publicVersion, originalPublicVersion);
  for (const privateValue of [purchase.id, acceptance.id, membership.id, purchase.clientId, acceptance.agreementEvidence, acceptance.purpose]) {
    assert(!JSON.stringify(publicVersion).includes(privateValue));
  }
  const { versionId: successor } = await expectStatus(201, offer.path + '/versions', adminWrite({
    expectedCurrentVersionId: offer.packageVersionId, terms: { ...offer.terms, name: 'Successor', validityDays: 30 },
  }));
  await expectStatus(204, offer.path + '/versions/' + successor + '/publish', adminWrite({
    expectedCurrentVersionId: offer.packageVersionId, expectedDraftRevision: 1,
  }));
  await expectStatus(204, offer.path + '/archive', adminWrite({ expectedCurrentVersionId: successor }));
  assert.deepEqual(await expectStatus(201, complimentaryPath, write), issued);
  const historical = await migrator.purchase.findUniqueOrThrow({ where: { id: purchase.id } });
  assert.equal(historical.packageVersionId, offer.packageVersionId);
  assert.deepEqual(historical.terms, terms);
  assert.deepEqual(await acceptanceCounts(), before.map(count => count + 1));
  assert.equal(await migrator.payment.count(), paymentsBefore);
  assert.equal(await migrator.paymentAllocation.count(), allocationsBefore);
});

test('complimentary acceptance rejects unauthorized actors and invalid agreement or catalog input', async () => {
  const offer = await acceptanceOffer();
  const paid = await acceptanceOffer('1.00');
  const { versionId: successor } = await expectStatus(201, offer.path + '/versions', adminWrite({
    expectedCurrentVersionId: offer.packageVersionId, terms: null,
  }));
  const write = acceptanceRequest(offer);
  const before = await acceptanceCounts();
  await expectStatus(204, `/staff-grants/${users.staff.id}/purchase.record`, grantOptions(true));
  for (const role of ['staff', 'coach', 'client']) {
    await expectStatus(403, complimentaryPath, { ...write, access: sessions[role].accessToken });
  }
  await expectStatus(401, complimentaryPath, { ...write, access: undefined });
  await expectStatus(400, complimentaryPath, { ...write, key: undefined });

  for (const [status, code, overrides] of [
    [404, 'CLIENT_NOT_FOUND', { clientId: randomUUID() }],
    [404, 'CLIENT_NOT_FOUND', { clientId: users.missingProfile.id }],
    [404, 'CLIENT_NOT_FOUND', { clientId: users.coach.id }],
    [404, 'CATALOG_VERSION_NOT_FOUND', { packageVersionId: randomUUID() }],
    [404, 'CATALOG_VERSION_NOT_FOUND', { packageId: randomUUID() }],
    [404, 'CATALOG_VERSION_NOT_FOUND', { packageVersionId: paid.packageVersionId }],
    [409, 'CATALOG_VERSION_NOT_ELIGIBLE', { packageId: paid.packageId, packageVersionId: paid.packageVersionId }],
    [409, 'CATALOG_VERSION_NOT_ELIGIBLE', { packageVersionId: successor }],
    [400, 'INVALID_INPUT', { agreementEvidence: undefined }],
    [400, 'INVALID_INPUT', { agreementEvidence: '  ' }],
    [400, 'INVALID_INPUT', { agreementEvidence: true }],
    [400, 'INVALID_INPUT', { agreementMethod: 'IN_APP_CONFIRMATION' }],
    [400, 'INVALID_INPUT', { purpose: undefined }],
    [400, 'INVALID_INPUT', { purpose: '  ' }],
  ]) {
    assert.equal((await expectStatus(status, complimentaryPath, acceptanceRequest(offer, overrides))).code, code);
  }
  await expectStatus(204, offer.path + '/versions/' + successor + '/publish', adminWrite({
    expectedDraftRevision: 1, expectedCurrentVersionId: offer.packageVersionId,
  }));
  assert.equal((await expectStatus(409, complimentaryPath, write)).code, 'CATALOG_VERSION_NOT_ELIGIBLE');
  await expectStatus(204, offer.path + '/archive', adminWrite({ expectedCurrentVersionId: successor }));
  assert.equal((await expectStatus(409, complimentaryPath, acceptanceRequest(offer, { packageVersionId: successor }))).code,
    'CATALOG_VERSION_NOT_ELIGIBLE');
  assert.deepEqual(await acceptanceCounts(), before);
});

test('concurrent complimentary acceptance is unique under both identical and distinct keys', async () => {
  const offer = await acceptanceOffer();
  const before = await acceptanceCounts();
  const write = acceptanceRequest(offer);
  const replay = await Promise.all([
    expectStatus(201, complimentaryPath, write), expectStatus(201, complimentaryPath, write),
  ]);
  assert.deepEqual(replay[0], replay[1]);
  const responses = await Promise.all([0, 1].map(() =>
    request(complimentaryPath, acceptanceRequest(offer, { clientId: users.other.id }))));
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  assert.equal((await responses.find(response => response.status === 409).json()).code, 'COMPLIMENTARY_ACCEPTANCE_EXISTS');
  assert.deepEqual(await acceptanceCounts(), before.map(count => count + 2));
});

test('complimentary acceptance waiting behind Catalog archive rechecks eligibility', async () => {
  const offer = await acceptanceOffer();
  const before = await acceptanceCounts();
  let archive, acceptance;
  async function waitForLock(query) {
    const deadline = Date.now() + 800;
    while (Date.now() < deadline) {
      const [row] = await owner.$queryRaw`SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname = ${databaseName} AND usename = 'studio_api'
          AND wait_event_type = 'Lock' AND query LIKE ${query}
      ) AS waiting`;
      if (row.waiting) return;
      await delay(15);
    }
    assert.fail('Expected a waiting Catalog row lock for ' + query);
  }
  await migrator.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM package WHERE id = ${offer.packageId}::uuid FOR NO KEY UPDATE`;
    archive = request(offer.path + '/archive', adminWrite({ expectedCurrentVersionId: offer.packageVersionId }));
    await waitForLock('%SELECT archived_at FROM package WHERE%FOR NO KEY UPDATE%');
    acceptance = request(complimentaryPath, acceptanceRequest(offer));
    await waitForLock('%SELECT archived_at FROM package WHERE%FOR SHARE%');
  });
  const [archived, denied] = await Promise.all([archive, acceptance]);
  assert.equal(archived.status, 204);
  assert.equal(denied.status, 409);
  assert.equal((await denied.json()).code, 'CATALOG_VERSION_NOT_ELIGIBLE');
  assert.deepEqual(await acceptanceCounts(), before);
});

test('a failed acceptance audit rolls back issuance and leaves its idempotency key reusable', async () => {
  const offer = await acceptanceOffer();
  const write = acceptanceRequest(offer, {
    agreementMethod: 'VERBAL_AGREEMENT', agreementEvidence: 'Client agreed verbally to the selected terms.',
  });
  const before = await acceptanceCounts();
  await migrator.$executeRaw`ALTER TABLE audit_log ADD CONSTRAINT test_reject_acceptance_audit
    CHECK (action <> 'PURCHASE_ACCEPTED_RECORDED') NOT VALID`;
  try {
    assert.equal((await expectStatus(500, complimentaryPath, write)).code, 'INTERNAL_ERROR');
    assert.deepEqual(await acceptanceCounts(), before);
  } finally {
    await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT test_reject_acceptance_audit`;
  }
  const issued = await expectStatus(201, complimentaryPath, write);
  const acceptance = await migrator.purchaseAcceptance.findUniqueOrThrow({ where: { id: issued.acceptanceId } });
  assert.equal(acceptance.agreementMethod, write.body.agreementMethod);
  assert.equal(acceptance.agreementEvidence, write.body.agreementEvidence);
  assert.deepEqual(await acceptanceCounts(), before.map(count => count + 1));
});

test('payment, membership and scheduling migrations preserve historical records and replay across upgrades', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'studio-purchase-upgrade-'));
  const legacySchema = join(scratch, 'schema.prisma');
  const { api, migration } = disposableUrls();
  const upgradeName = databaseName + '_purchase_upgrade';
  api.pathname = migration.pathname = '/' + upgradeName;
  let upgradeDb, upgradeApp, upgradeCreated = false;
  try {
    cpSync(join(prismaDirectory, 'schema.prisma'), legacySchema);
    mkdirSync(join(scratch, 'migrations'));
    // Apply the exact migration history shipped at 2b496c8.
    for (const name of ['migration_lock.toml', '20261104000100_foundation', '20261110000100_public_catalog',
      '20261112000100_complimentary_acceptance']) {
      cpSync(join(prismaDirectory, 'migrations', name), join(scratch, 'migrations', name), { recursive: true });
    }
    await owner.$executeRawUnsafe(`CREATE DATABASE "${upgradeName}"`);
    upgradeCreated = true;
    deployMigrations(api, migration, legacySchema);
    upgradeDb = new PrismaClient({ datasourceUrl: migration.href });
    const admin = await upgradeDb.user.create({ data: {
      normalizedEmail: 'upgrade-admin@studio.example', role: Role.ADMIN, accountState: AccountState.ACTIVE,
      passwordHash: await hashPassword(password), emailVerifiedAt: new Date(),
    } });
    const client = await upgradeDb.user.create({ data: {
      normalizedEmail: 'upgrade-client@studio.example', role: Role.CLIENT, accountState: AccountState.ACTIVE,
      client: { create: { displayName: 'Upgrade fixture' } },
    } });
    const type = await upgradeDb.sessionType.create({ data: { code: 'UPGRADE-SESSION', name: 'Original session', mode: 'GROUP' } });
    const offer = await upgradeDb.package.create({ data: { code: 'UPGRADE-PACKAGE' } });
    const version = await upgradeDb.packageVersion.create({ data: {
      packageId: offer.id, version: 1, name: 'Original package', description: 'Original description', kind: 'SESSION',
      price: '0.00', validityDays: 7, sessionAllowance: 1, eligibility: { create: { sessionTypeId: type.id } },
    } });
    await upgradeDb.packageVersion.update({
      where: { id: version.id }, data: { publishedAt: new Date('2026-11-10T09:00:00.000Z') },
    });
    const acceptanceId = randomUUID();
    const membershipId = randomUUID();
    const acceptedAt = new Date('2026-11-11T09:00:00.123Z');
    const body = { clientId: client.id, packageId: offer.id, packageVersionId: version.id, agreementMethod: 'VERBAL_AGREEMENT',
      agreementEvidence: 'Historical verbal agreement note', purpose: 'Historical complimentary purpose' };
    await upgradeDb.$executeRaw`
      INSERT INTO complimentary_acceptance
        (id, client_id, package_version_id, accepted_by, accepted_at, agreement_method, agreement_evidence, purpose)
      VALUES (${acceptanceId}::uuid, ${client.id}::uuid, ${version.id}::uuid, ${admin.id}::uuid, ${acceptedAt},
        ${body.agreementMethod}::agreement_method, ${body.agreementEvidence}, ${body.purpose})`;
    await upgradeDb.$executeRaw`
      INSERT INTO membership (id, created_at, acceptance_id) VALUES (${membershipId}::uuid, ${acceptedAt}, ${acceptanceId}::uuid)`;
    await upgradeDb.package.update({
      where: { id: offer.id }, data: { archivedAt: new Date('2026-11-11T10:00:00.000Z') },
    });
    const audit = await upgradeDb.auditLog.create({ data: {
      actorId: admin.id, action: acceptanceAction, targetType: 'COMPLIMENTARY_ACCEPTANCE', targetId: acceptanceId,
      requestId: randomUUID(), redactedDetails: { packageVersionId: version.id, agreementMethod: body.agreementMethod },
    } });
    const retry = await upgradeDb.idempotencyKey.create({ data: {
      actorId: admin.id, operation: complimentaryOperation, key: randomUUID(), expiresAt: new Date(Date.now() + 60_000),
      requestDigest: digest(JSON.stringify([client.id, offer.id, version.id, body.agreementMethod, body.agreementEvidence, body.purpose])),
      resultStatus: 201, resultReference: acceptanceId,
    } });

    // Finish the accepted d3fcc3d baseline before applying the payment migration.
    for (const name of ['20261112000200_purchase_records', '20261112000300_complimentary_purchase_uniqueness',
      '20261112000400_positive_price_purchase_type', '20261112000500_positive_price_purchase_uniqueness']) {
      cpSync(join(prismaDirectory, 'migrations', name), join(scratch, 'migrations', name), { recursive: true });
    }
    deployMigrations(api, migration, legacySchema);
    const originalPurchase = await upgradeDb.purchase.findFirstOrThrow();
    const paidOffer = await upgradeDb.package.create({ data: { code: 'UPGRADE-POSITIVE' } });
    const paidVersion = await upgradeDb.packageVersion.create({ data: {
      packageId: paidOffer.id, version: 1, name: 'Historical positive-price offer', description: '',
      kind: 'TIME', price: '75.00', validityDays: 7, eligibility: { create: { sessionTypeId: type.id } },
    } });
    await upgradeDb.packageVersion.update({ where: { id: paidVersion.id }, data: { publishedAt: acceptedAt } });
    const paidBody = { ...body, packageId: paidOffer.id, packageVersionId: paidVersion.id };
    const paidKey = randomUUID();
    async function upgradeRequester() {
      upgradeApp = await startApp({ ...loadConfig({ ...process.env, DATABASE_URL: api.href, DASHBOARD_ORIGIN: allowedOrigin }),
        host: '127.0.0.1', port: 0 });
      const { accessToken } = await upgradeApp.get(Sessions).login(admin.normalizedEmail, password);
      const origin = await upgradeApp.getUrl();
      return (path, payload, key) => fetch(origin + '/api/v1' + path, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + accessToken, 'Idempotency-Key': key },
        body: JSON.stringify(payload),
      });
    }
    const legacyPost = await upgradeRequester();
    const paidAcceptance = await legacyPost(positivePricePath, paidBody, paidKey);
    assert.equal(paidAcceptance.status, 201);
    const { purchaseId: paidId } = await paidAcceptance.json();
    const paidPurchase = () => upgradeDb.purchase.findUniqueOrThrow({
      where: { id: paidId }, include: { acceptance: true, membership: { select: { id: true } } },
    });
    const paidBefore = await paidPurchase();
    const paidAudit = await upgradeDb.auditLog.findFirstOrThrow({ where: { targetType: 'PURCHASE', targetId: paidId } });
    const paidRetry = await upgradeDb.idempotencyKey.findFirstOrThrow({ where: { operation: positivePriceOperation, key: paidKey } });
    await upgradeApp.close();
    upgradeApp = undefined;

    const recordingMigration = '20261112000600_payment_recording';
    cpSync(join(prismaDirectory, 'migrations', recordingMigration), join(scratch, 'migrations', recordingMigration), { recursive: true });
    deployMigrations(api, migration, legacySchema);
    // The current Prisma client expects verification columns that are absent at the recording baseline.
    const legacyPaymentId = randomUUID();
    const [legacyPayment] = await upgradeDb.$queryRaw`
      INSERT INTO payment (id, intake_id, client_id, recorded_by, amount, currency, method, received_at, reference, evidence)
      VALUES (${legacyPaymentId}::uuid, ${randomUUID()}::uuid, ${client.id}::uuid, ${admin.id}::uuid,
        75.00, 'SAR', 'BANK_TRANSFER', ${acceptedAt}, 'original reference', 'original evidence')
      RETURNING to_jsonb(payment) AS receipt`;

    const verificationMigration = '20261113000100_payment_verification';
    cpSync(join(prismaDirectory, 'migrations', verificationMigration), join(scratch, 'migrations', verificationMigration), { recursive: true });
    deployMigrations(api, migration, legacySchema);
    const [unverifiedPayment] = await upgradeDb.$queryRaw`
      SELECT to_jsonb(payment) AS receipt FROM payment WHERE id = ${legacyPaymentId}::uuid`;
    assert.deepEqual(unverifiedPayment.receipt, { ...legacyPayment.receipt, verified_by: null, verified_at: null });
    const verificationKey = randomUUID();
    const verifyPath = `/payments/${legacyPaymentId}/verify`;
    const preAllocationPost = await upgradeRequester();
    const verification = await preAllocationPost(verifyPath, {}, verificationKey);
    assert.equal(verification.status, 200);
    const verifiedResponse = await verification.json();
    assert.deepEqual(verifiedResponse, { paymentId: legacyPaymentId, status: 'VERIFIED' });
    const verifiedPayment = await upgradeDb.payment.findUniqueOrThrow({ where: { id: legacyPaymentId } });
    const verificationAudit = await upgradeDb.auditLog.findFirstOrThrow({
      where: { action: 'PAYMENT_VERIFIED', targetId: legacyPaymentId },
    });
    await upgradeApp.close();
    upgradeApp = undefined;

    const allocationMigration = '20261113000200_payment_allocation';
    cpSync(join(prismaDirectory, 'migrations', allocationMigration), join(scratch, 'migrations', allocationMigration), { recursive: true });
    deployMigrations(api, migration, legacySchema);
    const [pendingBefore] = await upgradeDb.$queryRaw`
      SELECT to_jsonb(membership) AS record FROM membership WHERE id = ${membershipId}::uuid`;
    const [historicalAllocation] = await upgradeDb.$queryRaw`
      INSERT INTO payment_allocation (payment_id, purchase_id, amount, allocated_by)
      VALUES (${legacyPaymentId}::uuid, ${paidId}::uuid, 25.00, ${admin.id}::uuid)
      RETURNING to_jsonb(payment_allocation) AS record`;
    const activationMigration = '20261114000100_membership_activation';
    cpSync(join(prismaDirectory, 'migrations', activationMigration), join(scratch, 'migrations', activationMigration), { recursive: true });
    deployMigrations(api, migration, legacySchema);
    const { created_at: originalMembershipCreated, ...pendingRecord } = pendingBefore.record;
    assert.deepEqual(new Date(originalMembershipCreated), acceptedAt);
    assert.deepEqual(pendingRecord, { id: membershipId, purchase_id: originalPurchase.id,
      status: 'PENDING_ACTIVATION' });
    const [upgradedPayment] = await upgradeDb.$queryRaw`
      SELECT to_jsonb(payment) AS receipt FROM payment WHERE id = ${legacyPaymentId}::uuid`;
    assert.deepEqual(upgradedPayment.receipt, {
      ...legacyPayment.receipt, status: 'VERIFIED', verified_by: admin.id, verified_at: upgradedPayment.receipt.verified_at,
    });
    assert(upgradedPayment.receipt.verified_at);
    assert.deepEqual(await upgradeDb.payment.findUniqueOrThrow({ where: { id: legacyPaymentId } }), verifiedPayment);
    assert.deepEqual(await upgradeDb.auditLog.findUniqueOrThrow({ where: { id: verificationAudit.id } }), verificationAudit);
    const historicalAllocations = await upgradeDb.$queryRaw`
      SELECT to_jsonb(payment_allocation) AS record FROM payment_allocation`;
    assert.deepEqual(historicalAllocations, [historicalAllocation]);
    const purchase = await upgradeDb.purchase.findUniqueOrThrow({
      where: { id: originalPurchase.id }, include: { acceptance: true, membership: true },
    });
    const { acceptance, membership, ...purchaseFields } = purchase;
    assert.deepEqual(purchaseFields, originalPurchase);
    assert.equal(purchase.clientId, client.id);
    assert.equal(purchase.packageVersionId, version.id);
    assert.equal(purchase.type, 'COMPLIMENTARY');
    assert.equal(purchase.acceptedById, admin.id);
    assert.deepEqual(purchase.acceptedAt, acceptedAt);
    assert.deepEqual(purchase.createdAt, acceptedAt);
    assert.deepEqual(purchase.terms, {
      code: offer.code, version: 1, name: version.name, description: version.description,
      price: '0.00', currency: 'SAR', kind: 'SESSION', validityDays: 7, sessionAllowance: 1,
      sessionTypes: [{ id: type.id, code: type.code, name: type.name, mode: type.mode }],
    });
    assert.deepEqual(purchase.acceptance, { id: acceptanceId, purchaseId: purchase.id, agreementMethod: body.agreementMethod,
      agreementEvidence: body.agreementEvidence, purpose: body.purpose });
    assert.deepEqual(purchase.membership, { id: membershipId, purchaseId: purchase.id, createdAt: acceptedAt, status: 'PENDING_ACTIVATION',
      activatedAt: null, validFrom: null, validThrough: null, initialSessionAllowance: null });
    assert.deepEqual(await upgradeDb.auditLog.findUniqueOrThrow({ where: { id: audit.id } }), audit);
    assert.deepEqual(await upgradeDb.idempotencyKey.findUniqueOrThrow({ where: { id: retry.id } }), retry);
    assert.deepEqual(await paidPurchase(), paidBefore);
    assert.deepEqual(await upgradeDb.auditLog.findUniqueOrThrow({ where: { id: paidAudit.id } }), paidAudit);
    assert.deepEqual(await upgradeDb.idempotencyKey.findUniqueOrThrow({ where: { id: paidRetry.id } }), paidRetry);

    const upgradedPost = await upgradeRequester();
    const response = await upgradedPost(complimentaryPath, body, retry.key);
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { acceptanceId, membershipId, status: 'PENDING_ACTIVATION' });
    const paidReplay = await upgradedPost(positivePricePath, paidBody, paidKey);
    assert.equal(paidReplay.status, 201);
    assert.deepEqual(await paidReplay.json(), { purchaseId: paidId });
    assert.deepEqual(await Promise.all([
      upgradeDb.purchase.count(), upgradeDb.purchaseAcceptance.count(), upgradeDb.membership.count(),
      upgradeDb.auditLog.count(), upgradeDb.idempotencyKey.count(), upgradeDb.payment.count(),
    ]), [2, 2, 1, 3, 3, 1]);
    const verifiedReplay = await upgradedPost(verifyPath, {}, verificationKey);
    assert.equal(verifiedReplay.status, 200);
    assert.deepEqual(await verifiedReplay.json(), verifiedResponse);
    const allocation = await upgradedPost(`/payments/${legacyPaymentId}/allocations`, { purchaseId: paidId, amount: '50.00' }, randomUUID());
    assert.equal(allocation.status, 201);
    assert.equal(await upgradeDb.paymentAllocation.count(), 2);
    const activation = await upgradedPost(`/purchases/${purchase.id}/activate-membership`, {}, randomUUID());
    assert.equal(activation.status, 200);
    assert.equal((await activation.json()).membership.id, membershipId);
    const acceptanceReplay = await upgradedPost(complimentaryPath, body, retry.key);
    assert.equal(acceptanceReplay.status, 201);
    assert.deepEqual(await acceptanceReplay.json(), { acceptanceId, membershipId, status: 'PENDING_ACTIVATION' });

    const snapshot = () => Promise.all([
      upgradeDb.purchase.findMany({ orderBy: { id: 'asc' } }),
      upgradeDb.purchaseAcceptance.findMany({ orderBy: { id: 'asc' } }),
      upgradeDb.membership.findMany({ orderBy: { id: 'asc' } }),
      upgradeDb.payment.findMany({ orderBy: { id: 'asc' } }),
      upgradeDb.paymentAllocation.findMany({ orderBy: { id: 'asc' } }),
      upgradeDb.auditLog.findMany({ orderBy: { id: 'asc' } }),
      upgradeDb.idempotencyKey.findMany({ orderBy: { id: 'asc' } }),
      upgradeDb.sessionType.findMany({ orderBy: { id: 'asc' } }),
    ]);
    const beforeScheduling = await snapshot();
    await upgradeApp.close();
    upgradeApp = undefined;
    deployMigrations(api, migration);
    deployMigrations(api, migration);
    assert.deepEqual(await snapshot(), beforeScheduling);
    assert.equal(await upgradeDb.scheduledSession.count(), 0);
    assert.equal(await upgradeDb.schedulingSettings.count(), 0);

    // Model a future type only in this disposable database.
    await upgradeDb.$executeRaw`ALTER TYPE purchase_type ADD VALUE 'TEST_REPEATABLE'`;
    const repeated = await upgradeDb.$executeRaw`
      INSERT INTO purchase (client_id, package_version_id, type, accepted_by, accepted_at, terms)
      SELECT client_id, package_version_id, 'TEST_REPEATABLE', accepted_by, accepted_at, terms
      FROM purchase CROSS JOIN generate_series(1, 2) WHERE id = ${purchase.id}::uuid`;
    assert.equal(repeated, 2);
  } finally {
    await upgradeApp?.close();
    await upgradeDb?.$disconnect();
    if (upgradeCreated) await owner.$executeRawUnsafe(`DROP DATABASE "${upgradeName}" WITH (FORCE)`);
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('Admin accepts a positive-price agreement with frozen terms and no membership', async () => {
  const offer = await acceptanceOffer('123.45');
  const write = acceptanceRequest(offer);
  const versionPath = offer.path + '/versions/' + offer.packageVersionId;
  const reader = { access: sessions.client.accessToken };
  const publicVersion = await expectStatus(200, versionPath, reader);
  const [purchases, acceptances, memberships, audits, keys] = await acceptanceCounts(positivePriceOperation);
  const paymentsBefore = await migrator.payment.count();
  const issued = await expectStatus(201, positivePricePath, write);
  assert.deepEqual(await expectStatus(201, positivePricePath, write), issued);
  assert.equal((await expectStatus(409, positivePricePath, { ...write, key: randomUUID() })).code,
    'POSITIVE_PRICE_ACCEPTANCE_EXISTS');
  assert.equal((await expectStatus(409, positivePricePath, { ...write, body: { ...write.body, purpose: 'Changed' } })).code,
    'IDEMPOTENCY_KEY_REUSED');

  const purchase = await migrator.purchase.findUniqueOrThrow({
    where: { id: issued.purchaseId }, include: { acceptance: true, membership: true },
  });
  assert.deepEqual(issued, { purchaseId: purchase.id });
  assert.equal(purchase.clientId, users.client.id);
  assert.equal(purchase.packageVersionId, offer.packageVersionId);
  assert.equal(purchase.type, 'POSITIVE_PRICE');
  assert.equal(purchase.acceptedById, users.admin.id);
  assert.deepEqual(purchase.createdAt, purchase.acceptedAt);
  assert.equal(purchase.membership, null);
  const { id, packageId, publishedAt, ...terms } = publicVersion;
  assert.deepEqual(purchase.terms, terms);
  assert.deepEqual(purchase.acceptance, {
    id: purchase.acceptance.id, purchaseId: purchase.id, agreementMethod: write.body.agreementMethod,
    agreementEvidence: write.body.agreementEvidence, purpose: write.body.purpose,
  });
  const audit = await migrator.auditLog.findFirstOrThrow({ where: { action: acceptanceAction, targetType: 'PURCHASE', targetId: purchase.id } });
  assert.equal(audit.actorId, users.admin.id);
  assert(audit.requestId);
  assert.deepEqual(audit.redactedDetails, {
    acceptanceId: purchase.acceptance.id, agreementMethod: write.body.agreementMethod, packageVersionId: offer.packageVersionId,
  });
  const retry = await migrator.idempotencyKey.findFirstOrThrow({ where: { key: write.key, operation: positivePriceOperation } });
  assert.equal(retry.resultStatus, 201);
  assert.equal(retry.resultReference, purchase.id);
  assert.deepEqual(await expectStatus(200, versionPath, reader), publicVersion);

  const { versionId: successor } = await expectStatus(201, offer.path + '/versions', adminWrite({
    expectedCurrentVersionId: offer.packageVersionId, terms: { ...offer.terms, price: '200.00' },
  }));
  await expectStatus(204, offer.path + '/versions/' + successor + '/publish', adminWrite({
    expectedCurrentVersionId: offer.packageVersionId, expectedDraftRevision: 1,
  }));
  await expectStatus(204, offer.path + '/archive', adminWrite({ expectedCurrentVersionId: successor }));
  assert.deepEqual(await expectStatus(201, positivePricePath, write), issued);
  assert.deepEqual((await migrator.purchase.findUniqueOrThrow({ where: { id: purchase.id } })).terms, terms);
  assert.deepEqual(await acceptanceCounts(positivePriceOperation), [purchases + 1, acceptances + 1, memberships, audits + 1, keys + 1]);
  assert.equal(await migrator.payment.count(), paymentsBefore);
});

test('positive-price acceptance rejects unauthorized actors and ineligible versions without writing records', async () => {
  const offer = await acceptanceOffer('49.99');
  const free = await acceptanceOffer();
  const { versionId: draft } = await expectStatus(201, offer.path + '/versions', adminWrite({
    expectedCurrentVersionId: offer.packageVersionId, terms: null,
  }));
  const before = await acceptanceCounts(positivePriceOperation);
  const write = acceptanceRequest(offer);
  for (const role of ['staff', 'coach', 'client']) {
    await expectStatus(403, positivePricePath, { ...write, access: sessions[role].accessToken });
  }
  await expectStatus(401, positivePricePath, { ...write, access: undefined });
  assert.equal((await expectStatus(400, positivePricePath, { ...write, key: undefined })).code, 'INVALID_IDEMPOTENCY_KEY');

  for (const [status, code, overrides] of [
    [404, 'CLIENT_NOT_FOUND', { clientId: randomUUID() }],
    [404, 'CLIENT_NOT_FOUND', { clientId: users.missingProfile.id }],
    [404, 'CATALOG_VERSION_NOT_FOUND', { packageId: randomUUID() }],
    [404, 'CATALOG_VERSION_NOT_FOUND', { packageVersionId: randomUUID() }],
    [404, 'CATALOG_VERSION_NOT_FOUND', { packageVersionId: free.packageVersionId }],
    [409, 'CATALOG_VERSION_NOT_ELIGIBLE', { packageId: free.packageId, packageVersionId: free.packageVersionId }],
    [409, 'CATALOG_VERSION_NOT_ELIGIBLE', { packageVersionId: draft }],
    [400, 'INVALID_INPUT', { agreementMethod: 'IN_APP_CONFIRMATION' }],
    [400, 'INVALID_INPUT', { agreementEvidence: undefined }],
    [400, 'INVALID_INPUT', { agreementEvidence: '  ' }],
    [400, 'INVALID_INPUT', { purpose: '  ' }],
    [400, 'INVALID_INPUT', { price: '1.00' }],
  ]) {
    assert.equal((await expectStatus(status, positivePricePath, acceptanceRequest(offer, overrides))).code, code);
  }
  await expectStatus(204, offer.path + '/versions/' + draft + '/publish', adminWrite({
    expectedCurrentVersionId: offer.packageVersionId, expectedDraftRevision: 1,
  }));
  assert.equal((await expectStatus(409, positivePricePath, write)).code, 'CATALOG_VERSION_NOT_ELIGIBLE');
  await expectStatus(204, offer.path + '/archive', adminWrite({ expectedCurrentVersionId: draft }));
  assert.equal((await expectStatus(409, positivePricePath, acceptanceRequest(offer, { packageVersionId: draft }))).code,
    'CATALOG_VERSION_NOT_ELIGIBLE');
  assert.deepEqual(await acceptanceCounts(positivePriceOperation), before);
});

test('concurrent positive-price acceptance with different keys creates one agreement', async () => {
  const offer = await acceptanceOffer('12.50');
  const [purchases, acceptances, memberships, audits, keys] = await acceptanceCounts(positivePriceOperation);
  const responses = await Promise.all([
    request(positivePricePath, acceptanceRequest(offer)),
    request(positivePricePath, { ...acceptanceRequest(offer), access: sessions.raceAdmin.accessToken }),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  assert.equal((await responses.find(response => response.status === 409).json()).code, 'POSITIVE_PRICE_ACCEPTANCE_EXISTS');
  assert.deepEqual(await acceptanceCounts(positivePriceOperation), [purchases + 1, acceptances + 1, memberships, audits + 1, keys + 1]);
});

test('positive-price audit failure rolls back the agreement and leaves the key reusable', async () => {
  const offer = await acceptanceOffer('10.00');
  const write = acceptanceRequest(offer, { agreementMethod: 'VERBAL_AGREEMENT', agreementEvidence: 'Client agreed to the terms.' });
  const before = await acceptanceCounts(positivePriceOperation);
  await migrator.$executeRaw`ALTER TABLE audit_log ADD CONSTRAINT test_reject_positive_purchase_audit
    CHECK (target_type <> 'PURCHASE') NOT VALID`;
  try {
    assert.equal((await expectStatus(500, positivePricePath, write)).code, 'INTERNAL_ERROR');
    assert.deepEqual(await acceptanceCounts(positivePriceOperation), before);
  } finally {
    await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT test_reject_positive_purchase_audit`;
  }
  const { purchaseId } = await expectStatus(201, positivePricePath, write);
  const acceptance = await migrator.purchaseAcceptance.findUniqueOrThrow({ where: { purchaseId } });
  assert.equal(acceptance.agreementMethod, write.body.agreementMethod);
  assert.equal(acceptance.agreementEvidence, write.body.agreementEvidence);
});

const paymentPath = '/payments';
const paymentAction = 'payment.record';

function paymentRequest(overrides = {}) {
  return adminWrite({
    clientId: users.client.id, intakeId: randomUUID(), amount: '123.4', currency: 'SAR', method: 'BANK_TRANSFER',
    receivedAt: '2025-01-10T15:04:05.678+03:00', reference: ' 001-X ', evidence: ' Outside evidence note. ', ...overrides,
  });
}

async function paymentCounts() {
  return Promise.all([
    migrator.payment.count(),
    migrator.auditLog.count({ where: { action: 'PAYMENT_RECORDED' } }),
    migrator.idempotencyKey.count({ where: { operation: paymentAction } }),
  ]);
}

test('Admin records an immutable unverified payment with no purchase or membership effects', async () => {
  const offer = await acceptanceOffer('123.40');
  await expectStatus(201, positivePricePath, acceptanceRequest(offer));
  const complimentary = await acceptanceOffer();
  await expectStatus(201, complimentaryPath, acceptanceRequest(complimentary));
  const purchases = () => migrator.purchase.findMany({
    where: { clientId: users.client.id }, orderBy: { id: 'asc' }, include: { membership: true, acceptance: true },
  });
  const beforePurchases = await purchases();
  assert(beforePurchases.some(purchase => purchase.membership?.status === 'PENDING_ACTIVATION'));
  const before = await paymentCounts();
  const allocationsBefore = await migrator.paymentAllocation.count();
  const write = paymentRequest();
  const result = await expectStatus(201, paymentPath, write);
  assert.deepEqual(await expectStatus(201, paymentPath, { ...write, body: {
    ...write.body, amount: '123.40', receivedAt: '2025-01-10T12:04:05.678Z',
    reference: '001-X', evidence: 'Outside evidence note.',
  } }), result);
  assert.equal((await expectStatus(409, paymentPath, { ...write, key: randomUUID() })).code, 'PAYMENT_INTAKE_EXISTS');
  assert.equal((await expectStatus(409, paymentPath, { ...write, body: { ...write.body, amount: '123.41' } })).code,
    'IDEMPOTENCY_KEY_REUSED');
  assert.deepEqual(await paymentCounts(), before.map(count => count + 1));

  const payment = await migrator.payment.findUniqueOrThrow({ where: { id: result.paymentId } });
  assert.deepEqual(result, { paymentId: payment.id, status: 'UNVERIFIED' });
  assert.equal(payment.status, 'UNVERIFIED');
  assert.equal(payment.verifiedById, null);
  assert.equal(payment.verifiedAt, null);
  assert.equal(payment.intakeId, write.body.intakeId);
  assert.equal(payment.clientId, users.client.id);
  assert.equal(payment.recordedById, users.admin.id);
  assert.equal(payment.amount.toFixed(2), '123.40');
  assert.equal(payment.currency, 'SAR');
  assert.equal(payment.method, 'BANK_TRANSFER');
  assert.equal(payment.receivedAt.toISOString(), '2025-01-10T12:04:05.678Z');
  assert(payment.createdAt >= payment.receivedAt);
  assert.equal(payment.reference, '001-X');
  assert.equal(payment.evidence, 'Outside evidence note.');
  const audit = await migrator.auditLog.findFirstOrThrow({
    where: { action: 'PAYMENT_RECORDED', targetType: 'PAYMENT', targetId: payment.id },
  });
  assert.equal(audit.actorId, users.admin.id);
  assert(audit.requestId);
  assert.deepEqual(audit.redactedDetails, {});
  const retry = await migrator.idempotencyKey.findFirstOrThrow({ where: { operation: paymentAction, key: write.key } });
  assert.equal(retry.resultStatus, 201);
  assert.equal(retry.resultReference, payment.id);
  assert.deepEqual(await purchases(), beforePurchases);
  assert.deepEqual(await migrator.$queryRaw`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
      AND table_name IN ('finance_account', 'allocation', 'receivable', 'installment',
        'finance_event', 'revenue', 'credit_lot', 'refund', 'entitlement_entry')`, []);
  assert.deepEqual(await migrator.$queryRaw`
    SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payment'
      AND column_name IN ('purchase_id', 'allocated_at')`, []);
  assert.equal(await migrator.paymentAllocation.count(), allocationsBefore);
  await assert.rejects(runtime.$executeRaw`UPDATE payment SET amount = 1 WHERE id = ${payment.id}::uuid`,
    error => error.meta?.code === '42501');
  await assert.rejects(runtime.$executeRaw`DELETE FROM payment WHERE id = ${payment.id}::uuid`,
    error => error.meta?.code === '42501');
  assert.deepEqual(await migrator.$queryRaw`
    SELECT has_table_privilege('studio_reporting', 'public.payment', 'INSERT,UPDATE,DELETE') AS reporting,
           has_table_privilege('studio_worker', 'public.payment', 'INSERT,UPDATE,DELETE') AS worker`,
  [{ reporting: false, worker: false }]);
});

test('only Admin and Staff with the current payment.record grant may record payments', async () => {
  const before = await paymentCounts();
  const write = { ...paymentRequest({ method: 'CASH', reference: undefined, evidence: undefined }), access: sessions.staff.accessToken };
  for (const role of ['staff', 'clientManager', 'coach', 'client']) {
    await expectStatus(403, paymentPath, { ...write, access: sessions[role].accessToken });
  }
  await expectStatus(401, paymentPath, { ...write, access: undefined });
  assert.deepEqual(await paymentCounts(), before);
  await expectStatus(204, `/staff-grants/${users.staff.id}/payment.record`, grantOptions(true));
  const recorded = await expectStatus(201, paymentPath, write);
  const payment = await migrator.payment.findUniqueOrThrow({ where: { id: recorded.paymentId } });
  assert.equal(payment.recordedById, users.staff.id);
  assert.equal(payment.status, 'UNVERIFIED');
  assert.equal(payment.reference, null);
  assert.equal(payment.evidence, null);
  await expectStatus(404, `${paymentPath}/${payment.id}/allocate`, { ...write, body: {} });
  await expectStatus(204, `/staff-grants/${users.staff.id}/payment.record`, grantOptions(false));
  await expectStatus(403, paymentPath, write);
  assert.deepEqual(await paymentCounts(), before.map(count => count + 1));
});

test('invalid payment requests leave no payment, audit or idempotency outcome', async () => {
  const before = await paymentCounts();
  assert.equal((await expectStatus(400, paymentPath, { ...paymentRequest(), key: undefined })).code, 'INVALID_IDEMPOTENCY_KEY');
  for (const [status, code, overrides] of [
    [400, 'INVALID_INPUT', { clientId: undefined }],
    [400, 'INVALID_INPUT', { clientId: 'bad-id' }],
    [404, 'CLIENT_NOT_FOUND', { clientId: randomUUID() }],
    [404, 'CLIENT_NOT_FOUND', { clientId: users.missingProfile.id }],
    [404, 'CLIENT_NOT_FOUND', { clientId: users.coach.id }],
    [400, 'INVALID_INPUT', { intakeId: undefined }],
    [400, 'INVALID_INPUT', { intakeId: 'bad-id' }],
    [400, 'INVALID_INPUT', { amount: '0.00' }],
    [400, 'INVALID_INPUT', { amount: '-1.00' }],
    [400, 'INVALID_INPUT', { amount: '0.001' }],
    [400, 'INVALID_INPUT', { amount: '1e2' }],
    [400, 'INVALID_INPUT', { amount: 12 }],
    [400, 'INVALID_INPUT', { amount: '1000000000000000.00' }],
    [400, 'INVALID_INPUT', { currency: 'USD' }],
    [400, 'INVALID_INPUT', { method: 'CARD' }],
    [400, 'INVALID_INPUT', { receivedAt: '2025-02-29T12:00:00Z' }],
    [400, 'INVALID_INPUT', { receivedAt: '2025-01-10T12:00:00' }],
    [400, 'INVALID_INPUT', { receivedAt: '2025-01-10T24:00:00Z' }],
    [400, 'INVALID_INPUT', { receivedAt: '2025-01-10T12:00:00.0001Z' }],
    [400, 'INVALID_INPUT', { receivedAt: new Date(Date.now() + 3600_000).toISOString() }],
    [400, 'INVALID_INPUT', { reference: 'ABC\nDEF' }],
    [400, 'INVALID_INPUT', { reference: ' ' }],
    [400, 'INVALID_INPUT', { evidence: true }],
    [400, 'INVALID_INPUT', { evidence: 'abc\u0000def' }],
    [400, 'INVALID_INPUT', { purchaseId: randomUUID() }],
  ]) {
    assert.equal((await expectStatus(status, paymentPath, paymentRequest(overrides))).code, code);
  }
  assert.deepEqual(await paymentCounts(), before);
});

test('concurrent payment retries deduplicate by intake across actors and Clients', async () => {
  const before = await paymentCounts();
  const write = paymentRequest({ method: 'MADA' });
  const replays = await Promise.all([expectStatus(201, paymentPath, write), expectStatus(201, paymentPath, write)]);
  assert.deepEqual(replays[0], replays[1]);
  const differentIntake = paymentRequest({ method: 'STC_PAY' });
  const responses = await Promise.all([
    request(paymentPath, differentIntake),
    request(paymentPath, { ...differentIntake, key: randomUUID(), access: sessions.raceAdmin.accessToken,
      body: { ...differentIntake.body, clientId: users.other.id } }),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  const conflict = await responses.find(response => response.status === 409).json();
  assert.equal(conflict.code, 'PAYMENT_INTAKE_EXISTS');
  assert.deepEqual(Object.keys(conflict).sort(), ['code', 'requestId']);
  const separate = await expectStatus(201, paymentPath, { ...write, key: randomUUID(), body: { ...write.body, intakeId: randomUUID() } });
  assert.notEqual(separate.paymentId, replays[0].paymentId);
  assert.deepEqual(await paymentCounts(), before.map(count => count + 3));
});

test('payment audit failure rolls back the record and leaves its idempotency key reusable', async () => {
  const before = await paymentCounts();
  const write = paymentRequest();
  await migrator.$executeRaw`ALTER TABLE audit_log ADD CONSTRAINT test_reject_payment_audit
    CHECK (action <> 'PAYMENT_RECORDED') NOT VALID`;
  try {
    assert.equal((await expectStatus(500, paymentPath, write)).code, 'INTERNAL_ERROR');
    assert.deepEqual(await paymentCounts(), before);
  } finally {
    await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT test_reject_payment_audit`;
  }
  await expectStatus(201, paymentPath, write);
  assert.deepEqual(await paymentCounts(), before.map(count => count + 1));
});

const verifyPaymentAction = 'payment.verify';
const verifyPaymentPath = id => `${paymentPath}/${id}/verify`;

async function recordPaymentForVerification() {
  const { paymentId } = await expectStatus(201, paymentPath, paymentRequest());
  return migrator.payment.findUniqueOrThrow({ where: { id: paymentId } });
}

function verificationAudits(id) {
  return migrator.auditLog.findMany({ where: { action: 'PAYMENT_VERIFIED', targetType: 'PAYMENT', targetId: id } });
}

function verificationKeys() {
  return migrator.idempotencyKey.count({ where: { operation: verifyPaymentAction } });
}

test('Admin verifies an existing payment and writes one audit without changing receipt or purchase state', async () => {
  const recording = paymentRequest();
  const receipt = await expectStatus(201, paymentPath, recording);
  const original = await migrator.payment.findUniqueOrThrow({ where: { id: receipt.paymentId } });
  const path = verifyPaymentPath(original.id);
  await expectStatus(201, positivePricePath, acceptanceRequest(await acceptanceOffer('123.40')));
  await expectStatus(201, complimentaryPath, acceptanceRequest(await acceptanceOffer()));
  const purchases = () => migrator.purchase.findMany({
    orderBy: { id: 'asc' }, include: { acceptance: true, membership: true },
  });
  const purchaseSnapshot = await purchases();
  assert(purchaseSnapshot.some(purchase => purchase.type === 'POSITIVE_PRICE'));
  assert(purchaseSnapshot.some(purchase => purchase.membership?.status === 'PENDING_ACTIVATION'));
  const paymentsBefore = await paymentCounts();
  const allocationsBefore = await migrator.paymentAllocation.count();
  const [{ now: before }] = await migrator.$queryRaw`SELECT clock_timestamp() AS now`;
  const write = { ...adminWrite(), access: sessions.raceAdmin.accessToken };
  const result = await expectStatus(200, path, write);
  const [{ now: after }] = await migrator.$queryRaw`SELECT clock_timestamp() AS now`;
  const payment = await migrator.payment.findUniqueOrThrow({ where: { id: original.id } });
  assert.deepEqual(result, { paymentId: original.id, status: 'VERIFIED' });
  assert.deepEqual(payment, { ...original, status: 'VERIFIED', verifiedById: users.raceAdmin.id, verifiedAt: payment.verifiedAt });
  assert(payment.verifiedAt instanceof Date && payment.verifiedAt >= before && payment.verifiedAt <= after);
  const audits = await verificationAudits(original.id);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].actorId, users.raceAdmin.id);
  assert(audits[0].requestId);
  assert(audits[0].createdAt >= before && audits[0].createdAt <= after);
  assert.deepEqual(audits[0].redactedDetails, {});
  assert.deepEqual(await expectStatus(201, paymentPath, recording), receipt);
  assert.deepEqual(await purchases(), purchaseSnapshot);
  assert.deepEqual(await paymentCounts(), paymentsBefore);
  assert.deepEqual(await migrator.$queryRaw`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
      AND table_name IN ('finance_account', 'allocation', 'receivable',
        'finance_event', 'credit_lot', 'refund', 'entitlement_entry')`, []);
  assert.equal(await migrator.paymentAllocation.count(), allocationsBefore);

  await assert.rejects(runtime.$executeRaw`
    UPDATE payment SET verified_by = ${users.admin.id}::uuid WHERE id = ${original.id}::uuid`,
    error => error.meta?.code === '23514');
  await assert.rejects(runtime.$executeRaw`
    UPDATE payment SET status = 'UNVERIFIED', verified_at = NULL, verified_by = NULL WHERE id = ${original.id}::uuid`,
    error => error.meta?.code === '23514');
  await assert.rejects(runtime.$executeRaw`
    INSERT INTO payment (intake_id, client_id, recorded_by, amount, currency, method, received_at, status)
    VALUES (${randomUUID()}::uuid, ${original.clientId}::uuid, ${users.admin.id}::uuid, 1, 'SAR', 'CASH',
      ${original.receivedAt}, 'VERIFIED')`,
    error => error.meta?.code === '23514' && error.meta.message.includes('payment_verification_check'));
  await assert.rejects(runtime.$executeRaw`
    INSERT INTO payment (intake_id, client_id, recorded_by, amount, currency, method, received_at, status, verified_by, verified_at)
    VALUES (${randomUUID()}::uuid, ${original.clientId}::uuid, ${users.admin.id}::uuid, 1, 'SAR', 'CASH',
      clock_timestamp(), 'VERIFIED', ${users.admin.id}::uuid, clock_timestamp())`, error => error.meta?.code === '42501');
  assert.deepEqual(await migrator.$queryRaw`
    SELECT role, has_any_column_privilege(role, 'public.payment', 'UPDATE') AS can_update
    FROM (VALUES ('studio_reporting'), ('studio_worker')) AS roles(role)`,
  [{ role: 'studio_reporting', can_update: false }, { role: 'studio_worker', can_update: false }]);
});

test('verification denies unauthenticated users and all non-Admin roles including Staff with legacy grants', async () => {
  const original = await recordPaymentForVerification();
  const path = verifyPaymentPath(original.id);
  const grantPath = `/staff-grants/${users.staff.id}`;
  assert.equal((await expectStatus(400, grantPath + '/payment.verify', grantOptions(true))).code, 'INVALID_STAFF_PERMISSION');
  await expectStatus(204, grantPath + '/payment.record', grantOptions(true));
  const legacyGrant = await migrator.staffGrant.create({ data: {
    staffUserId: users.staff.id, permission: 'PAYMENT_VERIFY', changedById: users.admin.id,
  } });
  try {
    const keys = await verificationKeys();
    const write = adminWrite({});
    assert.equal((await expectStatus(401, path, { ...write, access: undefined })).code, 'UNAUTHENTICATED');
    for (const role of ['staff', 'coach', 'client']) {
      assert.equal((await expectStatus(403, path, { ...write, access: sessions[role].accessToken })).code, 'FORBIDDEN');
    }
    assert.deepEqual(await migrator.payment.findUniqueOrThrow({ where: { id: original.id } }), original);
    assert.deepEqual(await verificationAudits(original.id), []);
    assert.equal(await verificationKeys(), keys);
  } finally {
    await migrator.staffGrant.delete({ where: { id: legacyGrant.id } });
    await expectStatus(204, grantPath + '/payment.record', grantOptions(false));
  }
});

test('invalid verification requests leave the payment, audit and idempotency state untouched', async () => {
  const original = await recordPaymentForVerification();
  const path = verifyPaymentPath(original.id);
  const keys = await verificationKeys();
  const write = adminWrite({});
  assert.equal((await expectStatus(404, verifyPaymentPath(randomUUID()), write)).code, 'PAYMENT_NOT_FOUND');
  assert.equal((await expectStatus(400, verifyPaymentPath('invalid-id'), write)).code, 'INVALID_INPUT');
  assert.equal((await expectStatus(400, path, { ...write, key: undefined })).code, 'INVALID_IDEMPOTENCY_KEY');
  for (const body of [{ verifiedBy: users.raceAdmin.id }, { verifiedAt: new Date().toISOString() }, []]) {
    assert.equal((await expectStatus(400, path, { ...write, body })).code, 'INVALID_INPUT');
  }
  assert.deepEqual(await migrator.payment.findUniqueOrThrow({ where: { id: original.id } }), original);
  assert.deepEqual(await verificationAudits(original.id), []);
  assert.equal(await verificationKeys(), keys);
});

test('verification replays the same command and conflicts on a changed payment ID or new key', async () => {
  const original = await recordPaymentForVerification();
  const other = await recordPaymentForVerification();
  const path = verifyPaymentPath(original.id);
  const write = adminWrite({});
  const keys = await verificationKeys();
  const [result, replay] = await Promise.all([expectStatus(200, path, write), expectStatus(200, path, write)]);
  assert.deepEqual(replay, result);
  assert.deepEqual(await expectStatus(200, verifyPaymentPath(original.id.toUpperCase()), write), result);
  assert.equal((await expectStatus(409, verifyPaymentPath(other.id), write)).code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal((await expectStatus(409, path, adminWrite({}))).code, 'PAYMENT_NOT_UNVERIFIED');
  assert.deepEqual(await migrator.payment.findUniqueOrThrow({ where: { id: other.id } }), other);
  assert.deepEqual(await verificationAudits(other.id), []);
  assert.equal((await verificationAudits(original.id)).length, 1);
  assert.equal(await verificationKeys(), keys + 1);
});

test('concurrent verification by different Admins commits only the winning transition and audit', async () => {
  const original = await recordPaymentForVerification();
  const path = verifyPaymentPath(original.id);
  const keys = await verificationKeys();
  const responses = await Promise.all([
    request(path, adminWrite({})),
    request(path, { ...adminWrite({}), access: sessions.raceAdmin.accessToken }),
  ]);
  assert.deepEqual(responses.map(res => res.status).sort(), [200, 409]);
  const winner = responses[0].status === 200 ? users.admin : users.raceAdmin;
  for (const res of responses) {
    const body = await res.json();
    if (res.status === 200) assert.deepEqual(body, { paymentId: original.id, status: 'VERIFIED' });
    else assert.equal(body.code, 'PAYMENT_NOT_UNVERIFIED');
  }
  const payment = await migrator.payment.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(payment.verifiedById, winner.id);
  assert.deepEqual((await verificationAudits(original.id)).map(row => row.actorId), [winner.id]);
  assert.equal(await verificationKeys(), keys + 1);
});

test('a failed verification audit rolls back the transition and allows retry with the same key', async () => {
  const original = await recordPaymentForVerification();
  const path = verifyPaymentPath(original.id);
  const keys = await verificationKeys();
  const write = adminWrite({});
  await migrator.$executeRaw`ALTER TABLE audit_log ADD CONSTRAINT test_reject_verification_audit
    CHECK (action <> 'PAYMENT_VERIFIED') NOT VALID`;
  try {
    assert.equal((await expectStatus(500, path, write)).code, 'INTERNAL_ERROR');
    assert.deepEqual(await migrator.payment.findUniqueOrThrow({ where: { id: original.id } }), original);
    assert.deepEqual(await verificationAudits(original.id), []);
    assert.equal(await verificationKeys(), keys);
  } finally {
    await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT test_reject_verification_audit`;
  }
  await expectStatus(200, path, write);
  assert.equal((await verificationAudits(original.id)).length, 1);
  assert.equal(await verificationKeys(), keys + 1);
});

const allocationAction = 'payment.allocate';
const allocationPath = paymentId => `${paymentPath}/${paymentId}/allocations`;
const allocationRequest = (purchaseId, amount) => adminWrite({ purchaseId, amount });

async function verifiedPayment() {
  const { id } = await recordPaymentForVerification();
  await expectStatus(200, verifyPaymentPath(id), adminWrite());
  return migrator.payment.findUniqueOrThrow({ where: { id } });
}

async function allocationPurchase(overrides, price = '25.00') {
  const offer = await acceptanceOffer(price);
  return expectStatus(201, positivePricePath, acceptanceRequest(offer, overrides));
}

async function allocationCounts() {
  return Promise.all([
    migrator.paymentAllocation.count(),
    migrator.auditLog.count({ where: { action: 'PAYMENT_ALLOCATED' } }),
    migrator.idempotencyKey.count({ where: { operation: allocationAction } }),
  ]);
}

async function assertAllocationAudits(allocations) {
  for (const allocation of allocations) {
    const audits = await migrator.auditLog.findMany({
      where: { action: 'PAYMENT_ALLOCATED', targetType: 'PAYMENT_ALLOCATION', targetId: allocation.id },
    });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorId, allocation.allocatedById);
    assert(audits[0].requestId);
    assert(audits[0].createdAt instanceof Date);
    assert.deepEqual(audits[0].redactedDetails, { paymentId: allocation.paymentId, purchaseId: allocation.purchaseId });
  }
}

test('Admin records partial allocations across purchases and spends the exact remainder without financial side effects', async () => {
  const payment = await verifiedPayment();
  const { purchaseId } = await allocationPurchase(undefined, '500.00');
  const complimentary = await expectStatus(201, complimentaryPath, acceptanceRequest(await acceptanceOffer()));
  const second = await migrator.purchaseAcceptance.findUniqueOrThrow({ where: { id: complimentary.acceptanceId } });
  const purchases = () => migrator.purchase.findMany({
    orderBy: { id: 'asc' }, include: { acceptance: true, membership: true },
  });
  const beforePurchases = await purchases();
  const counts = await allocationCounts();
  const [{ now: before }] = await migrator.$queryRaw`SELECT clock_timestamp() AS now`;
  const path = allocationPath(payment.id);
  const first = await expectStatus(201, path, allocationRequest(purchaseId, '31.2'));
  const next = await expectStatus(201, path, allocationRequest(second.purchaseId, '20'));
  const last = await expectStatus(201, path, allocationRequest(purchaseId, '72.20'));
  for (const [result, target, amount] of [[first, purchaseId, '31.20'], [next, second.purchaseId, '20.00'], [last, purchaseId, '72.20']]) {
    assert.deepEqual(result, { allocationId: result.allocationId, paymentId: payment.id, purchaseId: target, amount, currency: 'SAR' });
    const row = await runtime.paymentAllocation.findUniqueOrThrow({ where: { id: result.allocationId } });
    assert.equal(row.purchaseId, target);
    assert.equal(row.amount.toFixed(2), amount);
    assert.equal(row.currency, 'SAR');
    assert.equal(row.allocatedById, users.admin.id);
    const [{ now: after }] = await migrator.$queryRaw`SELECT clock_timestamp() AS now`;
    assert(row.createdAt >= before && row.createdAt <= after);
  }
  assert.equal((await expectStatus(409, path, allocationRequest(purchaseId, '0.01'))).code, 'PAYMENT_ALLOCATION_EXCEEDS_AVAILABLE');
  const persisted = await migrator.paymentAllocation.findMany({ where: { paymentId: payment.id } });
  assert.equal(persisted.length, 3);
  const total = await migrator.paymentAllocation.aggregate({ where: { paymentId: payment.id }, _sum: { amount: true } });
  assert(total._sum.amount.eq(payment.amount));
  await assertAllocationAudits(persisted);
  assert.deepEqual(await allocationCounts(), counts.map(count => count + 3));
  assert.deepEqual(await migrator.payment.findUniqueOrThrow({ where: { id: payment.id } }), payment);
  assert.deepEqual(await purchases(), beforePurchases);
  assert.deepEqual(await migrator.$queryRaw`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'
      AND table_name IN ('finance_account', 'installment', 'receivable', 'finance_event',
        'revenue', 'credit_lot', 'refund', 'entitlement_entry')`, []);
  await assert.rejects(runtime.$executeRaw`UPDATE payment_allocation SET amount = 1 WHERE id = ${first.allocationId}::uuid`,
    error => error.meta?.code === '42501');
  await assert.rejects(runtime.$executeRaw`DELETE FROM payment_allocation WHERE id = ${first.allocationId}::uuid`,
    error => error.meta?.code === '42501');
});

test('allocation is denied to non-Admins even with recording and legacy allocation grants', async () => {
  const payment = await verifiedPayment();
  const { purchaseId } = await allocationPurchase();
  const path = allocationPath(payment.id);
  const grantPath = `/staff-grants/${users.staff.id}`;
  assert.equal((await expectStatus(400, grantPath + '/payment.allocate', grantOptions(true))).code, 'INVALID_STAFF_PERMISSION');
  await expectStatus(204, grantPath + '/payment.record', grantOptions(true));
  const legacy = await migrator.staffGrant.create({ data: {
    staffUserId: users.staff.id, permission: 'PAYMENT_ALLOCATE', changedById: users.admin.id,
  } });
  try {
    const counts = await allocationCounts();
    const write = allocationRequest(purchaseId, '10');
    assert.equal((await expectStatus(401, path, { ...write, access: undefined })).code, 'UNAUTHENTICATED');
    for (const role of ['staff', 'coach', 'client']) {
      assert.equal((await expectStatus(403, path, { ...write, access: sessions[role].accessToken })).code, 'FORBIDDEN');
    }
    assert.deepEqual(await allocationCounts(), counts);
  } finally {
    await migrator.staffGrant.delete({ where: { id: legacy.id } });
    await expectStatus(204, grantPath + '/payment.record', grantOptions(false));
  }
});

test('allocation rejects invalid input, missing records, unverified payments and different Client purchases', async () => {
  const payment = await verifiedPayment();
  const unverified = await recordPaymentForVerification();
  const { purchaseId } = await allocationPurchase();
  const { purchaseId: otherPurchase } = await allocationPurchase({ clientId: users.other.id });
  const offer = await acceptanceOffer('10.00');
  const path = allocationPath(payment.id);
  const write = allocationRequest(purchaseId, '10');
  const counts = await allocationCounts();
  const purchaseCount = await migrator.purchase.count();
  for (const [status, route, options, code] of [
    [400, allocationPath('invalid'), write, 'INVALID_INPUT'],
    [400, path, { ...write, key: undefined }, 'INVALID_IDEMPOTENCY_KEY'],
    [404, allocationPath(randomUUID()), write, 'PAYMENT_NOT_FOUND'],
    [404, path, allocationRequest(randomUUID(), '10'), 'PURCHASE_NOT_FOUND'],
    [404, path, allocationRequest(offer.packageId, '10'), 'PURCHASE_NOT_FOUND'],
    [404, path, allocationRequest(offer.packageVersionId, '10'), 'PURCHASE_NOT_FOUND'],
    [409, allocationPath(unverified.id), write, 'PAYMENT_NOT_VERIFIED'],
    [409, path, allocationRequest(otherPurchase, '10'), 'PAYMENT_PURCHASE_CLIENT_MISMATCH'],
    [409, path, allocationRequest(purchaseId, '123.41'), 'PAYMENT_ALLOCATION_EXCEEDS_AVAILABLE'],
  ]) {
    const error = await expectStatus(status, route, options);
    assert.deepEqual(Object.keys(error).sort(), ['code', 'requestId']);
    assert.equal(error.code, code);
  }
  for (const body of [
    undefined, {}, { ...write.body, purchaseId: 'invalid' },
    ...['0', '-1', '1.001', '1e1', 10].map(amount => ({ purchaseId, amount })),
    ...Object.entries({ currency: 'SAR', clientId: users.client.id, allocatedById: users.admin.id, createdAt: new Date().toISOString() })
      .map(([name, value]) => ({ ...write.body, [name]: value })),
  ]) {
    assert.equal((await expectStatus(400, path, { ...write, body })).code, 'INVALID_INPUT');
  }
  assert.deepEqual(await allocationCounts(), counts);
  assert.equal(await migrator.purchase.count(), purchaseCount);
});

test('allocation replays normalized requests and conflicts on changed payment, purchase or amount', async () => {
  const payment = await verifiedPayment();
  const otherPayment = await verifiedPayment();
  const { purchaseId } = await allocationPurchase(undefined, '500.00');
  const { purchaseId: otherPurchase } = await allocationPurchase(undefined, '500.00');
  const path = allocationPath(payment.id);
  const write = allocationRequest(purchaseId, '100');
  const counts = await allocationCounts();
  const [first, replay] = await Promise.all([
    expectStatus(201, path, write),
    expectStatus(201, allocationPath(payment.id.toUpperCase()), { ...write, body: { purchaseId: purchaseId.toUpperCase(), amount: '100.00' } }),
  ]);
  assert.deepEqual(replay, first);
  for (const [route, body] of [
    [allocationPath(otherPayment.id), write.body], [path, { ...write.body, purchaseId: otherPurchase }],
    [path, { ...write.body, amount: '100.01' }],
  ]) {
    assert.equal((await expectStatus(409, route, { ...write, body })).code, 'IDEMPOTENCY_KEY_REUSED');
  }
  assert.deepEqual(await allocationCounts(), counts.map(count => count + 1));
});

test('concurrent Admin allocations wait on the payment row and the losing request sees the committed total', async () => {
  const payment = await verifiedPayment();
  const { purchaseId } = await allocationPurchase(undefined, '500.00');
  const { purchaseId: otherPurchase } = await allocationPurchase(undefined, '500.00');
  const path = allocationPath(payment.id);
  const counts = await allocationCounts();
  let attempts;
  try {
    await migrator.$transaction(async tx => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM payment WHERE id = ${payment.id}::uuid FOR NO KEY UPDATE`;
      attempts = Promise.allSettled([
        request(path, allocationRequest(purchaseId, '80.00')),
        request(path, { ...allocationRequest(otherPurchase, '80.00'), access: sessions.raceAdmin.accessToken }),
      ]);
      const deadline = Date.now() + 1200;
      while (Date.now() < deadline) {
        const [{ waiting, behindPaymentLock }] = await owner.$queryRaw`
          SELECT count(*)::int AS waiting, bool_or(${pid} = ANY(pg_blocking_pids(pid))) AS "behindPaymentLock"
          FROM pg_stat_activity
          WHERE datname = ${databaseName} AND usename = 'studio_api'
            AND wait_event_type = 'Lock' AND query LIKE '%FROM payment WHERE id%'`;
        if (waiting === 2 && behindPaymentLock) return;
        await delay(15);
      }
      assert.fail('Both allocation commands must wait for the payment row');
    });
  } finally {
    await attempts;
  }
  const responses = (await attempts).map(attempt => {
    assert.equal(attempt.status, 'fulfilled');
    return attempt.value;
  });
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  const success = await responses.find(response => response.status === 201).json();
  assert.equal((await responses.find(response => response.status === 409).json()).code, 'PAYMENT_ALLOCATION_EXCEEDS_AVAILABLE');
  const allocations = await migrator.paymentAllocation.findMany({ where: { paymentId: payment.id } });
  assert.equal(allocations.length, 1);
  assert.equal(allocations[0].id, success.allocationId);
  assert.equal(allocations[0].allocatedById, responses[0].status === 201 ? users.admin.id : users.raceAdmin.id);
  const total = await migrator.paymentAllocation.aggregate({ where: { paymentId: payment.id }, _sum: { amount: true } });
  assert.equal(total._sum.amount.toFixed(2), '80.00');
  await assertAllocationAudits(allocations);
  assert.deepEqual(await allocationCounts(), counts.map(count => count + 1));
});

test('allocation database constraints also enforce eligibility and the aggregate limit on runtime inserts', async () => {
  const payment = await verifiedPayment();
  const unverified = await recordPaymentForVerification();
  const { purchaseId } = await allocationPurchase(undefined, '500.00');
  const { purchaseId: otherPurchase } = await allocationPurchase({ clientId: users.other.id });
  const path = allocationPath(payment.id);
  await expectStatus(201, path, allocationRequest(purchaseId, '100'));
  const counts = await allocationCounts();
  const insert = (tx, id, target, amount) => tx.$executeRaw`
    INSERT INTO payment_allocation (payment_id, purchase_id, amount, allocated_by)
    VALUES (${id}::uuid, ${target}::uuid, ${amount}::numeric, ${users.admin.id}::uuid)`;
  for (const [id, target, amount, code] of [
    [payment.id, purchaseId, '23.41', 'SS005'],
    [payment.id, otherPurchase, '1', 'SS004'],
    [unverified.id, purchaseId, '1', 'SS003'],
    [payment.id, purchaseId, '1.001', '23514'],
    [payment.id, purchaseId, '0', '23514'],
  ]) {
    await assert.rejects(insert(runtime, id, target, amount), error => error.meta?.code === code);
  }
  await assert.rejects(runtime.$executeRaw`
    INSERT INTO payment_allocation (payment_id, purchase_id, amount, allocated_by)
    SELECT ${payment.id}::uuid, ${purchaseId}::uuid, 12, ${users.admin.id}::uuid
    FROM generate_series(1, 2)`, error => error.meta?.code === 'SS005');
  await assert.rejects(runtime.$transaction(tx => insert(tx, payment.id, purchaseId, '1'), { isolationLevel: 'RepeatableRead' }),
    error => error.meta?.code === '0A000');
  assert.deepEqual(await allocationCounts(), counts);
});

test('allocation rolls back on audit failure and the original key can retry', async () => {
  const payment = await verifiedPayment();
  const { purchaseId } = await allocationPurchase(undefined, '500.00');
  const path = allocationPath(payment.id);
  const write = allocationRequest(purchaseId, '123.40');
  const counts = await allocationCounts();
  await migrator.$executeRaw`ALTER TABLE audit_log ADD CONSTRAINT test_reject_allocation_audit
    CHECK (action <> 'PAYMENT_ALLOCATED') NOT VALID`;
  try {
    assert.equal((await expectStatus(500, path, write)).code, 'INTERNAL_ERROR');
    assert.deepEqual(await allocationCounts(), counts);
  } finally {
    await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT test_reject_allocation_audit`;
  }
  await expectStatus(201, path, write);
  assert.deepEqual(await allocationCounts(), counts.map(count => count + 1));
});

const fundingPath = purchaseId => `/purchases/${purchaseId}/funding`;

test('purchase funding uses frozen terms and exactly sums allocations across verified payments', async () => {
  const offer = await acceptanceOffer('0.30');
  const { purchaseId } = await expectStatus(201, positivePricePath, acceptanceRequest(offer));
  const first = await verifiedPayment();
  const second = await verifiedPayment();

  const { versionId: successor } = await expectStatus(201, offer.path + '/versions', adminWrite({
    expectedCurrentVersionId: offer.packageVersionId, terms: { ...offer.terms, price: '500.00' },
  }));
  await expectStatus(204, offer.path + '/versions/' + successor + '/publish',
    adminWrite({ expectedCurrentVersionId: offer.packageVersionId, expectedDraftRevision: 1 }));

  const path = fundingPath(purchaseId.toUpperCase());
  const admin = { access: sessions.admin.accessToken };
  const summary = { purchaseId, currency: 'SAR', purchasePrice: '0.30' };
  assert.deepEqual(await expectStatus(200, path, admin), {
    ...summary, allocatedAmount: '0.00', remainingAmount: '0.30', fundingStatus: 'UNFUNDED',
  });
  await expectStatus(201, allocationPath(first.id), allocationRequest(purchaseId, '0.10'));
  assert.deepEqual(await expectStatus(200, path, admin), {
    ...summary, allocatedAmount: '0.10', remainingAmount: '0.20', fundingStatus: 'PARTIALLY_FUNDED',
  });
  await expectStatus(201, allocationPath(second.id), allocationRequest(purchaseId, '0.20'));
  assert.deepEqual(await expectStatus(200, path, admin), {
    ...summary, allocatedAmount: '0.30', remainingAmount: '0.00', fundingStatus: 'FULLY_FUNDED',
  });
  assert.equal((await expectStatus(409, allocationPath(second.id), allocationRequest(purchaseId, '0.01'))).code, 'PAYMENT_ALLOCATION_EXCEEDS_PURCHASE_PRICE');
  // Preserve the defensive read regression for legacy/direct-DB overfunded records.
  await migrator.$executeRaw`INSERT INTO payment_allocation (payment_id, purchase_id, amount, allocated_by)
    VALUES (${second.id}::uuid, ${purchaseId}::uuid, 0.01, ${users.admin.id}::uuid)`;
  const error = await expectStatus(409, path, admin);
  assert.equal(error.code, 'PURCHASE_OVERFUNDED');
  assert.deepEqual(Object.keys(error).sort(), ['code', 'requestId']);
});

test('complimentary purchase funding has zero due and funding reads leave records untouched', async () => {
  const offer = await acceptanceOffer();
  const { acceptanceId, membershipId } = await expectStatus(201, complimentaryPath, acceptanceRequest(offer));
  const { purchaseId } = await migrator.purchaseAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } });
  const payment = await verifiedPayment();
  const { purchaseId: fundedPurchaseId } = await allocationPurchase();
  await expectStatus(201, allocationPath(payment.id), allocationRequest(fundedPurchaseId, '0.01'));
  const snapshot = () => Promise.all([
    migrator.purchase.findMany({ orderBy: { id: 'asc' } }),
    migrator.payment.findMany({ orderBy: { id: 'asc' } }),
    migrator.paymentAllocation.findMany({ orderBy: { id: 'asc' } }),
    migrator.membership.findMany({ orderBy: { id: 'asc' } }),
    migrator.auditLog.findMany({ orderBy: { id: 'asc' } }),
  ]);
  const before = await snapshot();
  const admin = { access: sessions.admin.accessToken };
  assert.deepEqual(await expectStatus(200, fundingPath(purchaseId), admin), {
    purchaseId, currency: 'SAR', purchasePrice: '0.00', allocatedAmount: '0.00', remainingAmount: '0.00',
    fundingStatus: 'FULLY_FUNDED',
  });
  await expectStatus(200, fundingPath(fundedPurchaseId), admin);
  assert.equal((await migrator.membership.findUniqueOrThrow({ where: { id: membershipId } })).status, 'PENDING_ACTIVATION');
  assert.deepEqual(await snapshot(), before);
});

test('purchase funding validates IDs and denies non-Admins including Staff with existing read grants', async () => {
  const { purchaseId } = await allocationPurchase();
  const path = fundingPath(purchaseId);
  const admin = { access: sessions.admin.accessToken };
  assert.equal((await expectStatus(400, fundingPath('invalid'), admin)).code, 'INVALID_INPUT');
  assert.equal((await expectStatus(404, fundingPath(randomUUID()), admin)).code, 'PURCHASE_NOT_FOUND');
  assert.equal((await expectStatus(401, path)).code, 'UNAUTHENTICATED');
  for (const role of ['staff', 'coach', 'client']) {
    assert.equal((await expectStatus(403, path, { access: sessions[role].accessToken })).code, 'FORBIDDEN');
  }

  const grants = ['purchase.read', 'finance.read'];
  try {
    for (const grant of grants) await expectStatus(204, `/staff-grants/${users.staff.id}/${grant}`, grantOptions(true));
    const staff = { access: sessions.staff.accessToken };
    assert.equal((await expectStatus(403, path, staff)).code, 'FORBIDDEN');
    assert.equal((await expectStatus(403, fundingPath(randomUUID()), staff)).code, 'FORBIDDEN');
  } finally {
    for (const grant of grants) await expectStatus(204, `/staff-grants/${users.staff.id}/${grant}`, grantOptions(false));
  }
});

test('purchase funding returns a generic integrity error for malformed frozen terms', async () => {
  const { purchaseId } = await allocationPurchase();
  // The schema requires a JSON object, but the stored price must be a decimal string.
  await migrator.$executeRaw`UPDATE purchase SET terms = jsonb_set(terms, '{price}', '25'::jsonb) WHERE id = ${purchaseId}::uuid`;
  const error = await expectStatus(500, fundingPath(purchaseId), { access: sessions.admin.accessToken });
  assert.equal(error.code, 'INTERNAL_ERROR');
  assert.deepEqual(Object.keys(error).sort(), ['code', 'requestId']);
});

test('purchase funding rejects frozen prices that contradict the purchase type', async () => {
  const { purchaseId: paidId } = await allocationPurchase();
  const { acceptanceId } = await expectStatus(201, complimentaryPath, acceptanceRequest(await acceptanceOffer()));
  const { purchaseId: complimentaryId } = await migrator.purchaseAcceptance.findUniqueOrThrow({ where: { id: acceptanceId } });
  const admin = { access: sessions.admin.accessToken };
  for (const [purchaseId, price] of [[paidId, '0.00'], [complimentaryId, '25.00']]) {
    await migrator.$executeRaw`
      UPDATE purchase SET terms = jsonb_set(terms, '{price}', to_jsonb(${price}::text)) WHERE id = ${purchaseId}::uuid`;
    const error = await expectStatus(500, fundingPath(purchaseId), admin);
    assert.equal(error.code, 'INTERNAL_ERROR');
    assert.deepEqual(Object.keys(error).sort(), ['code', 'requestId']);
  }
});

const activationPath = id => `/purchases/${id}/activate-membership`;
const membershipStatePath = id => `/purchases/${id}/membership`;
const activateWithOverride = { override: true, overrideReason: '  Approved for the client to begin this week.  ' };

test('Admin activates a fully funded membership using frozen validity and session terms', async () => {
  const offer = await acceptanceOffer('25.00');
  const { purchaseId } = await expectStatus(201, positivePricePath, acceptanceRequest(offer));
  const payment = await verifiedPayment();
  await expectStatus(201, allocationPath(payment.id), allocationRequest(purchaseId, '25.00'));
  const admin = { access: sessions.admin.accessToken };
  assert.deepEqual(await expectStatus(200, membershipStatePath(purchaseId), admin), {
    membershipId: null, status: 'NOT_CREATED',
  });
  assert.equal(await migrator.membership.count({ where: { purchaseId } }), 0);
  const { versionId } = await expectStatus(201, offer.path + '/versions', adminWrite({
    expectedCurrentVersionId: offer.packageVersionId, terms: { ...offer.terms, validityDays: 4, sessionAllowance: 10, price: '50.00' },
  }));
  await expectStatus(204, offer.path + '/versions/' + versionId + '/publish',
    adminWrite({ expectedCurrentVersionId: offer.packageVersionId, expectedDraftRevision: 1 }));

  const before = await migrator.$queryRaw`SELECT clock_timestamp() AS now`;
  const write = adminWrite({});
  const result = await expectStatus(200, activationPath(purchaseId), write);
  const after = await migrator.$queryRaw`SELECT clock_timestamp() AS now`;
  const { membership } = result;
  const timestamp = new Date(membership.activatedAt);
  assert(timestamp >= before[0].now && timestamp <= after[0].now);
  const firstDay = new Date(timestamp.valueOf() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const finalDay = new Date(Date.parse(firstDay) + 13 * 86_400_000).toISOString().slice(0, 10);
  assert.deepEqual(result, {
    purchaseType: 'POSITIVE_PRICE', fundingStatus: 'FULLY_FUNDED', overrideUsed: false,
    membership: { id: membership.id, purchaseId, status: 'ACTIVE', activatedAt: timestamp.toISOString(),
      validFrom: firstDay, validThrough: finalDay, initialSessionAllowance: 2 },
  });
  assert.deepEqual(await expectStatus(200, membershipStatePath(purchaseId), admin), {
    membershipId: membership.id, status: 'ACTIVE',
  });
  assert.deepEqual(await expectStatus(200, activationPath(purchaseId), write), result);
  assert.equal((await expectStatus(409, activationPath(purchaseId), { ...write, body: activateWithOverride })).code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal((await expectStatus(409, activationPath(purchaseId), adminWrite({}))).code, 'MEMBERSHIP_ALREADY_ACTIVATED');
  const events = await migrator.auditLog.findMany({ where: { action: 'MEMBERSHIP_ACTIVATED', targetId: membership.id } });
  assert.equal(events.length, 1);
  assert.equal(events[0].targetType, 'MEMBERSHIP');
  assert.equal(events[0].actorId, users.admin.id);
  assert.equal(events[0].reason, null);
  assert.deepEqual(events[0].redactedDetails, {
    purchaseId, membershipId: membership.id, purchaseType: 'POSITIVE_PRICE', activatedAt: membership.activatedAt,
    validFrom: firstDay, validThrough: finalDay, initialSessionAllowance: 2, fundingStatus: 'FULLY_FUNDED',
    allocatedAmount: '25.00', remainingAmount: '0.00', overrideUsed: false,
  });
  assert.equal(await migrator.membership.count({ where: { purchaseId } }), 1);
  await assert.rejects(runtime.membership.create({ data: { purchaseId } }), { code: 'P2002' });
});

for (const [status, amount, remaining] of [['PARTIALLY_FUNDED', '8.00', '17.00'], ['UNFUNDED', null, '25.00']]) {
  test(`Admin activation of a ${status} purchase requires an explicit override with a reason`, async () => {
    const { purchaseId } = await allocationPurchase();
    const path = activationPath(purchaseId);
    const payment = await verifiedPayment();
    if (amount) await expectStatus(201, allocationPath(payment.id), allocationRequest(purchaseId, amount));
    assert.equal((await expectStatus(409, path, adminWrite({}))).code, 'ACTIVATION_OVERRIDE_REQUIRED');
    assert.equal((await expectStatus(409, path, adminWrite({ overrideReason: 'Please approve' }))).code, 'ACTIVATION_OVERRIDE_REQUIRED');
    for (const body of [{ override: true }, { override: true, overrideReason: ' ' }, { override: true, overrideReason: '…' }]) {
      assert.equal((await expectStatus(400, path, adminWrite(body))).code, 'ACTIVATION_OVERRIDE_REASON_REQUIRED');
    }
    for (const body of [undefined, [], { override: 'true' },
      ...[null, 4, 'a'.repeat(501), 'a\u0000b'].map(overrideReason => ({ override: true, overrideReason }))]) {
      assert.equal((await expectStatus(400, path, adminWrite(body))).code, 'INVALID_INPUT');
    }
    assert.equal(await migrator.membership.count({ where: { purchaseId } }), 0);
    const write = adminWrite(activateWithOverride);
    const result = await expectStatus(200, path, write);
    const reason = activateWithOverride.overrideReason.trim();
    assert.equal(result.fundingStatus, status);
    assert.equal(result.overrideUsed, true);
    assert.equal(result.overrideReason, reason);
    const event = await migrator.auditLog.findFirstOrThrow({ where: { action: 'MEMBERSHIP_ACTIVATED', targetId: result.membership.id } });
    assert.equal(event.reason, reason);
    assert.equal(event.redactedDetails.remainingAmount, remaining);
    await expectStatus(201, allocationPath(payment.id), allocationRequest(purchaseId, remaining));
    assert.deepEqual(await expectStatus(200, path, write), result);
  });
}

test('complimentary activation reuses the pending membership and creates no financial records', async () => {
  const writeAcceptance = acceptanceRequest(await acceptanceOffer());
  const accepted = await expectStatus(201, complimentaryPath, writeAcceptance);
  const { purchaseId } = await migrator.purchaseAcceptance.findUniqueOrThrow({ where: { id: accepted.acceptanceId } });
  const counts = () => Promise.all([migrator.payment.count(), migrator.paymentAllocation.count(), migrator.membership.count()]);
  const before = await counts();
  const path = activationPath(purchaseId);
  const admin = { access: sessions.admin.accessToken };
  assert.deepEqual(await expectStatus(200, membershipStatePath(purchaseId), admin), {
    membershipId: accepted.membershipId, status: 'PENDING_ACTIVATION',
  });
  const write = adminWrite({});
  const result = await expectStatus(200, path, write);
  assert.equal(result.membership.id, accepted.membershipId);
  assert.equal(result.purchaseType, 'COMPLIMENTARY');
  assert.equal(result.fundingStatus, 'FULLY_FUNDED');
  assert.equal(result.overrideUsed, false);
  assert.equal(result.overrideReason, undefined);
  assert.deepEqual(await counts(), before);
  assert.deepEqual(await expectStatus(201, complimentaryPath, writeAcceptance), accepted);
  await migrator.membership.update({ where: { id: accepted.membershipId }, data: {
    activatedAt: new Date('2026-01-01T09:00:00Z'), validFrom: new Date('2026-01-01'), validThrough: new Date('2026-01-14'),
  } });
  assert.deepEqual(await expectStatus(200, membershipStatePath(purchaseId), admin), {
    membershipId: accepted.membershipId, status: 'EXPIRED',
  });
  assert.equal((await expectStatus(409, path, adminWrite({}))).code, 'MEMBERSHIP_ALREADY_ACTIVATED');
  assert.deepEqual(await expectStatus(200, path, write), result);
});

test('membership activation denies unauthenticated, Staff with grants, Coach, and Client requests', async () => {
  const { purchaseId } = await allocationPurchase();
  const path = activationPath(purchaseId);
  const assigned = ['payment.record', 'purchase.read', 'finance.read'];
  for (const grant of assigned) await expectStatus(204, `/staff-grants/${users.staff.id}/${grant}`, grantOptions(true));
  const legacy = await migrator.staffGrant.findUniqueOrThrow({
    where: { staffUserId_permission: { staffUserId: users.staff.id, permission: 'MEMBERSHIP_ACTIVATE' } },
  });
  assert.equal(legacy.revokedAt, null);
  try {
    assert.equal((await expectStatus(401, path, { ...adminWrite({}), access: undefined })).code, 'UNAUTHENTICATED');
    for (const role of ['staff', 'coach', 'client']) {
      const access = sessions[role].accessToken;
      assert.equal((await expectStatus(403, path, { ...adminWrite(activateWithOverride), access })).code, 'FORBIDDEN');
      assert.equal((await expectStatus(403, membershipStatePath(purchaseId), { access })).code, 'FORBIDDEN');
    }
    assert.equal((await expectStatus(400, path, { ...adminWrite({}), key: undefined })).code, 'INVALID_IDEMPOTENCY_KEY');
    assert.equal((await expectStatus(404, activationPath(randomUUID()), adminWrite({}))).code, 'PURCHASE_NOT_FOUND');
    assert.equal(await migrator.membership.count({ where: { purchaseId } }), 0);
  } finally {
    for (const grant of assigned) await expectStatus(204, `/staff-grants/${users.staff.id}/${grant}`, grantOptions(false));
  }
});

test('concurrent activation commands create one membership and concurrent idempotent retries share the outcome', async () => {
  const { purchaseId } = await allocationPurchase();
  const path = activationPath(purchaseId);
  const first = adminWrite(activateWithOverride);
  const second = { ...adminWrite(activateWithOverride), access: sessions.raceAdmin.accessToken };
  const [a, b, c] = await Promise.all([request(path, first), request(path, first), request(path, second)]);
  assert.equal(a.status, b.status);
  const [aBody, bBody, cBody] = await Promise.all([a.json(), b.json(), c.json()]);
  assert.deepEqual([a.status, c.status].sort(), [200, 409], JSON.stringify({ aBody, bBody, cBody }));
  if (a.status === 200) assert.deepEqual(aBody, bBody);
  assert.equal((a.status === 409 ? aBody : cBody).code, 'MEMBERSHIP_ALREADY_ACTIVATED');
  const member = await migrator.membership.findUniqueOrThrow({ where: { purchaseId } });
  assert.equal(await migrator.auditLog.count({ where: { action: 'MEMBERSHIP_ACTIVATED', targetId: member.id } }), 1);
  const winner = a.status === 200 ? first : second;
  const winningBody = a.status === 200 ? aBody : cBody;
  assert.deepEqual(await Promise.all([expectStatus(200, path, winner), expectStatus(200, path, winner)]), [winningBody, winningBody]);
});

test('activation and its idempotency claim roll back if membership audit persistence fails', async () => {
  const alternatives = [await allocationPurchase()];
  const complimentary = await expectStatus(201, complimentaryPath, acceptanceRequest(await acceptanceOffer()));
  alternatives.push(await migrator.purchaseAcceptance.findUniqueOrThrow({ where: { id: complimentary.acceptanceId } }));
  await migrator.$executeRaw`ALTER TABLE audit_log ADD CONSTRAINT test_reject_activation_audit
    CHECK (action <> 'MEMBERSHIP_ACTIVATED') NOT VALID`;
  const attempts = [];
  try {
    for (const { purchaseId } of alternatives) {
      const path = activationPath(purchaseId);
      const before = await migrator.membership.findUnique({ where: { purchaseId } });
      const write = adminWrite(before ? {} : activateWithOverride);
      attempts.push([path, write]);
      assert.equal((await expectStatus(500, path, write)).code, 'INTERNAL_ERROR');
      assert.deepEqual(await migrator.membership.findUnique({ where: { purchaseId } }), before);
      assert.equal(await migrator.idempotencyKey.count({ where: { key: write.key } }), 0);
    }
  } finally {
    await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT test_reject_activation_audit`;
  }
  for (const [path, write] of attempts) await expectStatus(200, path, write);
});

test('activation waits for a committing allocation and uses its post-lock funding status', async () => {
  const { purchaseId } = await allocationPurchase();
  const payment = await verifiedPayment();
  const path = activationPath(purchaseId);
  assert.equal((await expectStatus(200, fundingPath(purchaseId), { access: sessions.admin.accessToken })).fundingStatus, 'UNFUNDED');
  let attempt;
  try {
    await runtime.$transaction(async tx => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await tx.$executeRaw`INSERT INTO payment_allocation (payment_id, purchase_id, amount, allocated_by)
        VALUES (${payment.id}::uuid, ${purchaseId}::uuid, 25.00, ${users.admin.id}::uuid)`;
      attempt = request(path, adminWrite(activateWithOverride));
      const deadline = Date.now() + 1200;
      while (Date.now() < deadline) {
        const [{ waiting }] = await owner.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE datname = ${databaseName} AND usename = 'studio_api'
            AND ${pid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%lock_purchase_for_activation%') AS waiting`;
        if (waiting) return;
        await delay(15);
      }
      assert.fail('Activation did not wait for the allocation transaction');
    });
  } finally {
    await attempt;
  }
  const response = await attempt;
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.fundingStatus, 'FULLY_FUNDED');
  assert.equal(result.overrideUsed, false);
  assert.equal(result.overrideReason, undefined);
  const event = await migrator.auditLog.findFirstOrThrow({ where: { action: 'MEMBERSHIP_ACTIVATED', targetId: result.membership.id } });
  assert.equal(event.reason, null);
});

test('activation rejects overfunding, malformed snapshots and purchases without acceptance evidence', async () => {
  const { purchaseId } = await allocationPurchase();
  const path = activationPath(purchaseId);
  const payment = await verifiedPayment();
  assert.equal((await expectStatus(409, allocationPath(payment.id), allocationRequest(purchaseId, '25.01'))).code, 'PAYMENT_ALLOCATION_EXCEEDS_PURCHASE_PRICE');
  // A historical overfunded fixture must still be refused by activation.
  await migrator.$executeRaw`INSERT INTO payment_allocation (payment_id, purchase_id, amount, allocated_by)
    VALUES (${payment.id}::uuid, ${purchaseId}::uuid, 25.01, ${users.admin.id}::uuid)`;
  assert.equal((await expectStatus(409, path, adminWrite(activateWithOverride))).code, 'PURCHASE_OVERFUNDED');
  await migrator.$executeRaw`UPDATE purchase SET terms = jsonb_set(terms, '{price}', '25'::jsonb) WHERE id = ${purchaseId}::uuid`;
  assert.equal((await expectStatus(500, path, adminWrite({}))).code, 'INTERNAL_ERROR');
  await migrator.purchaseAcceptance.delete({ where: { purchaseId } });
  assert.equal((await expectStatus(409, path, adminWrite({}))).code, 'MEMBERSHIP_NOT_ELIGIBLE');
  assert.equal(await migrator.membership.count({ where: { purchaseId } }), 0);
});

const schedulePath = '/scheduling/sessions';
const scheduleDate = (minutes = 0) => new Date(Date.now() + 48 * 3600_000 + minutes * 60_000).toISOString();
const scheduleQuery = () => '?from=' + encodeURIComponent(scheduleDate(-1440)) + '&until=' + encodeURIComponent(scheduleDate(1440));
const scheduleWrite = (body, method = 'POST') => ({ ...adminWrite(body), method });
const scheduleDefaults = { durationMinutes: 60, bufferMinutes: 10, groupCapacity: 6 };
const adminRead = () => ({ access: sessions.admin.accessToken });

async function schedulingFixture({ mode = 'GROUP', configure = true } = {}) {
  const { sessionTypeId } = await expectStatus(201, '/session-types', adminWrite({
    name: 'Schedule fixture', code: 'SCHED-' + randomBytes(5).toString('hex'), mode,
  }));
  const settingsPath = '/scheduling/settings/' + sessionTypeId;
  if (configure) await expectStatus(204, settingsPath, scheduleWrite({
    ...scheduleDefaults, groupCapacity: mode === 'GROUP' ? 6 : null,
  }, 'PATCH'));
  return { sessionTypeId, settingsPath };
}

async function additionalCoach() {
  return migrator.user.create({ data: {
    role: 'COACH', normalizedEmail: randomUUID() + '@coach.example', accountState: 'ACTIVE',
    emailVerifiedAt: new Date(), coach: { create: { displayName: 'Other coach' } },
  } });
}

test('scheduling authorization scopes Coaches to themselves and denies Staff even with scheduling grants', async () => {
  const { sessionTypeId, settingsPath } = await schedulingFixture();
  const other = await additionalCoach();
  const start = scheduleDate();
  const body = { sessionTypeId, coachId: users.coach.id, startsAt: start };
  const { sessionId } = await expectStatus(201, schedulePath, adminWrite(body));
  const another = await expectStatus(201, schedulePath, adminWrite({ ...body, coachId: other.id }));
  const q = scheduleQuery();
  const self = '/scheduling/my-sessions' + q;
  await expectStatus(401, self);
  const coach = { access: sessions.coach.accessToken };
  const listing = await expectStatus(200, self, coach);
  assert.deepEqual(listing.items.map(row => row.id), [sessionId]);
  assert.deepEqual(Object.keys(listing.items[0].coach).sort(), ['displayName', 'id']);
  await expectStatus(400, self + '&coachId=' + other.id, coach);
  await expectStatus(400, self + '&after=' + another.sessionId, coach);
  const adminList = await expectStatus(200, schedulePath + q + '&coachId=' + other.id, adminRead());
  assert.deepEqual(adminList.items.map(row => row.id), [another.sessionId]);
  const page = await expectStatus(200, schedulePath + q + '&limit=1', adminRead());
  assert.equal(page.items.length, 1);
  const next = await expectStatus(200, schedulePath + q + '&limit=1&after=' + page.nextCursor, adminRead());
  assert.equal(next.items.length, 1);
  assert.notEqual(page.items[0].id, next.items[0].id);
  const coaches = await expectStatus(200, '/scheduling/coaches', adminRead());
  assert(coaches.some(row => row.id === other.id));
  assert(!coaches.some(row => row.id === users.client.id));

  for (const permission of ['schedule.read', 'schedule.manage']) {
    await expectStatus(204, '/staff-grants/' + users.staff.id + '/' + permission, grantOptions(true));
  }
  for (const role of ['coach', 'staff', 'client']) {
    const access = sessions[role].accessToken;
    for (const path of [schedulePath + q, '/scheduling/coaches', '/scheduling/settings']) await expectStatus(403, path, { access });
    await expectStatus(403, schedulePath, { ...adminWrite(body), access });
    await expectStatus(403, settingsPath, { ...scheduleWrite(scheduleDefaults, 'PATCH'), access });
    await expectStatus(403, schedulePath + '/' + sessionId, { ...scheduleWrite(body, 'PATCH'), access });
    await expectStatus(403, schedulePath + '/' + sessionId + '/cancel', { ...adminWrite({ reason: 'Test' }), access });
    if (role !== 'coach') await expectStatus(403, self, { access });
  }
  for (const permission of ['schedule.read', 'schedule.manage']) {
    await expectStatus(204, '/staff-grants/' + users.staff.id + '/' + permission, grantOptions(false));
  }
  for (const id of [sessionId, another.sessionId]) {
    await expectStatus(204, schedulePath + '/' + id + '/cancel', adminWrite({ expectedRevision: 1, reason: 'Fixture complete' }));
  }
});

test('scheduling validates defaults, references, timestamps and revision and replays idempotent writes', async () => {
  const { sessionTypeId, settingsPath } = await schedulingFixture({ mode: 'INDIVIDUAL', configure: false });
  const body = { sessionTypeId, coachId: users.coach.id, startsAt: scheduleDate(200) };
  for (const invalid of [
    { durationMinutes: 0, bufferMinutes: 0 }, { durationMinutes: 30, bufferMinutes: -1 },
    { durationMinutes: 30, bufferMinutes: 1, groupCapacity: 2 }, { durationMinutes: '30', bufferMinutes: 1 },
  ]) await expectStatus(400, settingsPath, scheduleWrite(invalid, 'PATCH'));
  const group = await schedulingFixture({ configure: false });
  await expectStatus(400, group.settingsPath, scheduleWrite({ durationMinutes: 60, bufferMinutes: 10 }, 'PATCH'));
  assert.equal((await expectStatus(409, schedulePath, adminWrite(body))).code, 'SCHEDULING_SETTINGS_REQUIRED');
  const config = scheduleWrite({ durationMinutes: 30, bufferMinutes: 5 }, 'PATCH');
  await expectStatus(204, settingsPath, config);
  await expectStatus(204, settingsPath, config);
  assert.equal(await migrator.auditLog.count({ where: { targetId: sessionTypeId, action: 'SCHEDULING_SETTINGS_CHANGED' } }), 1);
  assert.equal((await expectStatus(409, schedulePath, adminWrite({ ...body, coachId: users.client.id }))).code, 'COACH_NOT_ELIGIBLE');
  await expectStatus(404, schedulePath, adminWrite({ ...body, sessionTypeId: randomUUID() }));
  const disabled = await additionalCoach();
  await migrator.user.update({ where: { id: disabled.id }, data: { accountState: 'DISABLED' } });
  await expectStatus(409, schedulePath, adminWrite({ ...body, coachId: disabled.id }));
  await expectStatus(409, schedulePath, adminWrite({ ...body, startsAt: '2025-01-01T09:00:00+03:00' }));
  for (const startsAt of ['2028-02-30T09:00:00+03:00', '2030-03-15T09:00:00']) {
    await expectStatus(400, schedulePath, adminWrite({ ...body, startsAt }));
  }
  await expectStatus(400, schedulePath, { ...adminWrite(body), key: undefined });
  const intent = adminWrite(body);
  const result = await expectStatus(201, schedulePath, intent);
  assert.deepEqual(await expectStatus(201, schedulePath, intent), result);
  assert.equal((await expectStatus(409, schedulePath, { ...intent, body: { ...body, startsAt: scheduleDate(260) } })).code, 'IDEMPOTENCY_KEY_REUSED');
  const row = await migrator.scheduledSession.findUniqueOrThrow({ where: { id: result.sessionId } });
  assert.equal(row.capacity, 1);
  assert.equal(row.endsAt - row.startsAt, 30 * 60_000);
  assert.equal(row.bufferMinutes, 5);
  assert.equal(await migrator.auditLog.count({ where: { targetId: row.id, action: 'SCHEDULED_SESSION_CREATED' } }), 1);
  await expectStatus(204, schedulePath + '/' + row.id + '/cancel', adminWrite({ expectedRevision: 1, reason: 'Fixture complete' }));
  await expectStatus(204, '/session-types/' + sessionTypeId + '/archive', adminWrite({ reason: 'Fixture done' }));
  assert.equal((await expectStatus(409, schedulePath, adminWrite(body))).code, 'SESSION_TYPE_ARCHIVED');
});

test('buffer snapshots, half-open boundary, editing, reassignment and cancellation use the PostgreSQL constraint', async () => {
  const { sessionTypeId, settingsPath } = await schedulingFixture();
  const other = await additionalCoach();
  const start = Date.parse(scheduleDate(400));
  const schedule = (minute, coachId = users.coach.id) => ({ sessionTypeId, coachId, startsAt: new Date(start + minute * 60_000).toISOString() });
  const first = await expectStatus(201, schedulePath, adminWrite(schedule(0)));
  const firstPath = schedulePath + '/' + first.sessionId;
  await expectStatus(204, settingsPath, scheduleWrite({ durationMinutes: 30, bufferMinutes: 0, groupCapacity: 9 }, 'PATCH'));
  for (const minute of [30, 60, 69]) {
    assert.equal((await expectStatus(409, schedulePath, adminWrite(schedule(minute)))).code, 'COACH_SCHEDULE_CONFLICT');
  }
  const second = await expectStatus(201, schedulePath, adminWrite(schedule(70)));
  const [old, fresh] = await Promise.all([first, second].map(({ sessionId }) => migrator.scheduledSession.findUniqueOrThrow({ where: { id: sessionId } })));
  assert.deepEqual([old.bufferMinutes, old.capacity, old.endsAt - old.startsAt], [10, 6, 60 * 60_000]);
  assert.deepEqual([fresh.bufferMinutes, fresh.capacity, fresh.endsAt - fresh.startsAt], [0, 9, 30 * 60_000]);
  const secondPath = schedulePath + '/' + second.sessionId;
  const edit = (minute, coachId, expectedRevision = 1) => scheduleWrite({ coachId, expectedRevision, startsAt: schedule(minute).startsAt }, 'PATCH');
  assert.equal((await expectStatus(409, secondPath, edit(65, users.coach.id))).code, 'COACH_SCHEDULE_CONFLICT');
  const move = edit(10, other.id);
  await expectStatus(204, secondPath, move);
  await expectStatus(204, secondPath, move);
  assert.equal((await expectStatus(409, secondPath, edit(10, other.id))).code, 'SCHEDULED_SESSION_CHANGED');
  assert.equal((await expectStatus(409, firstPath, edit(0, other.id))).code, 'COACH_SCHEDULE_CONFLICT');
  const editAudit = await migrator.auditLog.findFirstOrThrow({ where: { targetId: fresh.id, action: 'SCHEDULED_SESSION_EDITED' } });
  assert.equal(editAudit.redactedDetails.previousCoachId, users.coach.id);
  assert.equal(editAudit.redactedDetails.coachId, other.id);
  const moved = await migrator.scheduledSession.findUniqueOrThrow({ where: { id: fresh.id } });
  assert.equal(moved.revision, 2);
  assert.equal(moved.endsAt - moved.startsAt, 30 * 60_000);
  await expectStatus(400, firstPath + '/cancel', adminWrite({ expectedRevision: 1, reason: '  ' }));
  const cancel = adminWrite({ expectedRevision: 1, reason: ' Coach unavailable ' });
  await expectStatus(204, firstPath + '/cancel', cancel);
  await expectStatus(204, firstPath + '/cancel', cancel);
  await expectStatus(409, firstPath, edit(0, other.id, 2));
  const event = await migrator.auditLog.findFirstOrThrow({ where: { targetId: old.id, action: 'SCHEDULED_SESSION_CANCELLED' } });
  assert.equal(event.reason, 'Coach unavailable');
  assert.equal(event.actorId, users.admin.id);
  await expectStatus(201, schedulePath, adminWrite(schedule(0)));
  await assert.rejects(runtime.$executeRaw`INSERT INTO scheduled_session
    (session_type_id, coach_id, starts_at, ends_at, buffer_minutes, capacity)
    VALUES (${sessionTypeId}::uuid, ${users.coach.id}::uuid, ${old.startsAt}, ${old.endsAt}, 0, 1)`,
  error => error.code === 'P2010' && error.meta?.code === '23P01' && /scheduled_session_coach_overlap/.test(error.meta.message));
});

test('concurrent Admin scheduling allows one conflicting write and audit failure rolls back the session and key', async () => {
  const { sessionTypeId } = await schedulingFixture();
  const coach = await additionalCoach();
  const body = { sessionTypeId, coachId: coach.id, startsAt: scheduleDate(600) };
  const writes = await Promise.all([
    request(schedulePath, adminWrite(body)),
    request(schedulePath, { ...adminWrite(body), access: sessions.raceAdmin.accessToken }),
  ]);
  assert.deepEqual(writes.map(response => response.status).sort(), [201, 409]);
  assert.equal((await writes.find(response => response.status === 409).json()).code, 'COACH_SCHEDULE_CONFLICT');
  assert.equal(await migrator.scheduledSession.count({ where: { coachId: coach.id } }), 1);
  await migrator.$executeRaw`ALTER TABLE audit_log ADD CONSTRAINT test_reject_scheduling_audit
    CHECK (action <> 'SCHEDULED_SESSION_CREATED') NOT VALID`;
  const retry = adminWrite({ ...body, startsAt: scheduleDate(800) });
  try {
    assert.equal((await expectStatus(500, schedulePath, retry)).code, 'INTERNAL_ERROR');
    assert.equal(await migrator.scheduledSession.count({ where: { coachId: coach.id } }), 1);
    assert.equal(await migrator.idempotencyKey.count({ where: { key: retry.key } }), 0);
  } finally {
    await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT test_reject_scheduling_audit`;
  }
  await expectStatus(201, schedulePath, retry);

  // Exercise the exclusion constraint concurrently without the command's coach lock.
  const startsAt = new Date(scheduleDate(1000));
  const endsAt = new Date(startsAt.valueOf() + 60 * 60_000);
  const insert = tx => tx.$executeRaw`INSERT INTO scheduled_session
    (session_type_id, coach_id, starts_at, ends_at, buffer_minutes, capacity)
    VALUES (${sessionTypeId}::uuid, ${coach.id}::uuid, ${startsAt}, ${endsAt}, 10, 6)`;
  let competing;
  try {
    await runtime.$transaction(async tx => {
      const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`;
      await insert(tx);
      competing = insert(runtime).then(() => null, error => error);
      const deadline = Date.now() + 1200;
      while (Date.now() < deadline) {
        const [{ waiting }] = await owner.$queryRaw`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
          WHERE datname = ${databaseName} AND usename = 'studio_api'
            AND ${pid} = ANY(pg_blocking_pids(pid)) AND query LIKE '%INSERT INTO scheduled_session%') AS waiting`;
        if (waiting) return;
        await delay(15);
      }
      assert.fail('The concurrent insert must wait for the exclusion constraint');
    });
  } finally {
    await competing;
  }
  const rejected = await competing;
  assert.equal(rejected?.meta?.code, '23P01');
  const session = await migrator.scheduledSession.findFirstOrThrow({ where: { coachId: coach.id, startsAt } });
  await assert.rejects(runtime.scheduledSession.update({ where: { id: session.id }, data: { bufferMinutes: 0 } }));
  await assert.rejects(runtime.scheduledSession.delete({ where: { id: session.id } }));
});

const bookingMigration = '20261116000100_booking_management';
const bookingPath = '/bookings';
const bookingQuery = id => '?scheduledSessionId=' + id;
const bookingDecision = (id, action) => bookingPath + '/' + id + '/' + action;
const bookingChoices = (clientId, sessionId) => '/clients/' + clientId + '/booking-memberships' + bookingQuery(sessionId);
const calendarAt = (date, days) => riyadhDate(new Date(date.valueOf() + days * 86400_000));
const dateColumn = value => new Date(value + 'T00:00:00Z');

async function bookingMembership(db, actorId, clientId, sessionTypeId, {
  kind = 'SESSION', allowance = kind === 'SESSION' ? 2 : null, activatedAt = new Date(),
  through = calendarAt(activatedAt, 5), active = true,
} = {}) {
  const offer = await db.package.create({ data: { code: 'BOOK-' + randomUUID().slice(0, 8).toUpperCase() } });
  const version = await db.packageVersion.create({ data: {
    packageId: offer.id, version: 1, name: kind + ' booking package', description: 'Fixture terms',
    kind, price: '0.00', validityDays: 6, sessionAllowance: allowance,
    eligibility: { create: { sessionTypeId } },
  } });
  await db.packageVersion.update({ where: { id: version.id }, data: { publishedAt: activatedAt } });
  const [{ terms }] = await db.$queryRaw`SELECT purchase_terms_for_version(${version.id}::uuid) AS terms`;
  const { membership } = await db.purchase.create({
    data: {
      clientId, packageVersionId: version.id, type: 'COMPLIMENTARY', acceptedById: actorId, acceptedAt: activatedAt, terms,
      acceptance: { create: { agreementMethod: 'VERBAL_AGREEMENT', agreementEvidence: 'Fixture', purpose: 'Booking fixture' } },
      membership: { create: active ? {
        status: 'ACTIVE', activatedAt, validFrom: dateColumn(riyadhDate(activatedAt)), validThrough: dateColumn(through),
        initialSessionAllowance: allowance,
      } : {} },
    },
    select: { membership: true },
  });
  return membership;
}

async function bookingFixture({ capacity = 3 } = {}) {
  const { sessionTypeId } = await schedulingFixture({ configure: false });
  const { id: coachId } = await additionalCoach();
  const membership = (client = 'client', options) =>
    bookingMembership(migrator, users.admin.id, users[client].id, sessionTypeId, options);
  const session = async ({ startsAt = new Date(scheduleDate()), endsAt = new Date(+startsAt + 3600_000), ...overrides } = {}) =>
    migrator.scheduledSession.create({ data: { coachId, sessionTypeId, startsAt, endsAt, bufferMinutes: 0, capacity, ...overrides } });
  return { sessionTypeId, coachId, membership, session };
}

function bookingInput(session, membership, client = 'client') {
  return { clientId: users[client].id, scheduledSessionId: session.id, membershipId: membership.id };
}

async function createBooking(session, membership, client) {
  return (await expectStatus(201, bookingPath, adminWrite(bookingInput(session, membership, client)))).bookingId;
}

test('booking creation requires a scheduled start strictly after the database time', async t => {
  const fixture = await bookingFixture();
  const now = await databaseClock.databaseTime(migrator);
  const membership = await fixture.membership('client', { activatedAt: new Date(+now - 86400_000) });
  const past = await fixture.session({ startsAt: new Date(+now - 3 * 3600_000) });
  const boundary = await fixture.session({ startsAt: now });
  const future = await fixture.session({ startsAt: new Date(+now + 2 * 3600_000) });
  t.mock.method(databaseClock, 'databaseTime', async () => now);

  for (const session of [past, boundary]) {
    const response = await expectStatus(409, bookingPath, adminWrite(bookingInput(session, membership)));
    assert.equal(response.code, 'SCHEDULE_START_IN_PAST');
    assert.equal(await migrator.booking.count({ where: { scheduledSessionId: session.id } }), 0);
  }
  const bookingId = await createBooking(future, membership);
  const booking = await migrator.booking.findUniqueOrThrow({ where: { id: bookingId } });
  assert.equal(booking.status, 'PENDING');
  assert.deepEqual(booking.createdAt, now);
});

test('booking routes require Admin even with stored Staff grants and validate explicit Client and membership references', async () => {
  const fixture = await bookingFixture();
  const session = await fixture.session();
  const membership = await fixture.membership();
  const other = await fixture.membership('other');
  const data = bookingInput(session, membership);
  const permissions = ['BOOKING_READ', 'BOOKING_ASSIST', 'BOOKING_APPROVE', 'BOOKING_CANCEL_DECIDE'];
  for (const permission of permissions) {
    const name = permission.toLowerCase().replaceAll('_', '.');
    assert.equal((await expectStatus(400, '/staff-grants/' + users.staff.id + '/' + name, grantOptions(true))).code,
      'INVALID_STAFF_PERMISSION');
  }
  await migrator.staffGrant.createMany({ data: permissions.map(permission => ({
    staffUserId: users.staff.id, changedById: users.admin.id, permission,
  })) });
  try {
    const id = randomUUID();
    for (const role of [undefined, 'staff', 'coach', 'client']) {
      const access = role && sessions[role].accessToken;
      const status = role ? 403 : 401;
      await expectStatus(status, bookingPath + bookingQuery(session.id), { access });
      await expectStatus(status, bookingChoices(data.clientId, session.id), { access });
      await expectStatus(status, bookingPath, { ...adminWrite(data), access });
      for (const action of ['approve', 'reject', 'cancel']) {
        await expectStatus(status, bookingDecision(id, action), { ...adminWrite({ reason: 'Fixture' }), access });
      }
    }
  } finally {
    await migrator.staffGrant.deleteMany({ where: {
      staffUserId: users.staff.id, permission: { in: permissions },
    } });
  }
  await expectStatus(400, bookingPath, { ...adminWrite(data), key: undefined });
  await expectStatus(400, bookingPath, adminWrite({ ...data, membershipId: undefined }));
  await expectStatus(400, bookingPath, adminWrite({ ...data, status: 'CONFIRMED' }));
  for (const client of ['missingProfile', 'coach']) {
    assert.equal((await expectStatus(404, bookingPath, adminWrite({ ...data, clientId: users[client].id }))).code, 'CLIENT_NOT_FOUND');
  }
  await expectStatus(404, bookingPath, adminWrite({ ...data, scheduledSessionId: randomUUID() }));
  for (const membershipId of [other.id, randomUUID()]) {
    assert.equal((await expectStatus(409, bookingPath, adminWrite({ ...data, membershipId }))).code, 'MEMBERSHIP_NOT_ELIGIBLE');
  }
  const time = await fixture.membership('client', { kind: 'TIME' });
  const choices = await expectStatus(200, bookingChoices(data.clientId, session.id), adminRead());
  assert(choices.find(choice => choice.membershipId === membership.id).eligible);
  assert.deepEqual(choices.find(choice => choice.membershipId === time.id), {
    membershipId: time.id, packageLabel: 'TIME booking package', packageKind: 'TIME',
    validFrom: dateOnly(time.validFrom), validThrough: dateOnly(time.validThrough),
    eligible: true, reason: null, initialSessionAllowance: null, confirmedCommitments: null, remainingCommitments: null,
  });
  assert(!choices.some(choice => choice.membershipId === other.id));
  assert.doesNotMatch(JSON.stringify(choices), /price|currency|payment|allocation|terms|purchaseId/i);
  const bookingId = await createBooking(session, time);
  assert.equal((await migrator.booking.findUniqueOrThrow({ where: { id: bookingId } })).membershipId, time.id);
  await expectStatus(204, bookingDecision(bookingId, 'approve'), adminWrite());
  const anotherSession = await fixture.session({ startsAt: new Date(+session.startsAt + 2 * 3600_000) });
  const anotherBooking = await createBooking(anotherSession, time);
  await expectStatus(204, bookingDecision(anotherBooking, 'approve'), adminWrite());
});

test('booking eligibility uses frozen session types and the full Riyadh validity interval', async () => {
  const fixture = await bookingFixture();
  const day = calendarAt(new Date(), 1);
  const start = new Date(day + 'T00:00:00+03:00');
  const end = new Date(+start + 86400_000);
  const membership = await fixture.membership('client', { activatedAt: start, through: day });
  const inactive = await fixture.membership('client', { active: false });
  const expired = await fixture.membership('client', { activatedAt: new Date(+start - 3 * 86400_000),
    through: riyadhDate(new Date(+start - 2 * 86400_000)) });
  const { sessionTypeId: otherType } = await schedulingFixture({ configure: false });
  const sameDay = await fixture.session({ startsAt: start, endsAt: new Date(+start + 3600_000) });
  const atMidnight = await fixture.session({ startsAt: new Date(+end - 3600_000), endsAt: end });
  const { id: additionalCoachId } = await additionalCoach();
  const overMidnight = await fixture.session({ coachId: additionalCoachId, startsAt: new Date(+end - 3600_000), endsAt: new Date(+end + 1) });
  const before = await fixture.session({ coachId: additionalCoachId, startsAt: new Date(+start - 1), endsAt: new Date(+start + 3600_000) });
  const wrongType = await fixture.session({ startsAt: new Date(+start + 2 * 3600_000), sessionTypeId: otherType });
  const otherOffer = await migrator.purchase.findUniqueOrThrow({ where: { id: membership.purchaseId } });
  await migrator.package.update({ where: { id: (await migrator.packageVersion.findUniqueOrThrow({
    where: { id: otherOffer.packageVersionId },
  })).packageId }, data: { archivedAt: new Date() } });
  for (const [session, reason] of [[sameDay, null], [atMidnight, null], [overMidnight, 'OUTSIDE_VALIDITY'],
    [before, 'OUTSIDE_VALIDITY'], [wrongType, 'SESSION_TYPE_NOT_ALLOWED']]) {
    const choices = await expectStatus(200, bookingChoices(users.client.id, session.id), adminRead());
    assert.equal(choices.find(item => item.membershipId === membership.id).reason, reason);
    assert.equal(choices.find(item => item.membershipId === inactive.id).reason, 'MEMBERSHIP_INACTIVE');
    assert.equal(choices.find(item => item.membershipId === expired.id).reason, 'MEMBERSHIP_EXPIRED');
    if (reason) assert.equal((await expectStatus(409, bookingPath, adminWrite(bookingInput(session, membership)))).code,
      'MEMBERSHIP_NOT_ELIGIBLE');
  }
  for (const ineligible of [inactive, expired]) {
    assert.equal((await expectStatus(409, bookingPath, adminWrite(bookingInput(sameDay, ineligible)))).code,
      'MEMBERSHIP_NOT_ELIGIBLE');
  }
  const id = await createBooking(atMidnight, membership);
  await expectStatus(204, bookingDecision(id, 'approve'), adminWrite());
});

test('booking lifecycle, history pagination, normalized replay and audit preserve booking identity and reasons', async () => {
  const fixture = await bookingFixture({ capacity: 1 });
  const session = await fixture.session();
  const membership = await fixture.membership();
  const data = bookingInput(session, membership);
  const body = adminWrite(data);
  const monetaryState = () => Promise.all([
    migrator.membership.findUniqueOrThrow({ where: { id: membership.id } }),
    migrator.purchase.findUniqueOrThrow({ where: { id: membership.purchaseId } }),
    migrator.payment.count(), migrator.paymentAllocation.count(),
  ]);
  const before = await monetaryState();
  const first = await expectStatus(201, bookingPath, body);
  const reject = bookingDecision(first.bookingId, 'reject');
  const approve = bookingDecision(first.bookingId, 'approve');
  const cancel = bookingDecision(first.bookingId, 'cancel');
  assert.equal(first.status, 'PENDING');
  assert.equal((await expectStatus(409, bookingPath, adminWrite(data))).code, 'BOOKING_ALREADY_EXISTS');
  assert.equal((await expectStatus(409, bookingPath, { ...body, body: { ...data, membershipId: randomUUID() } })).code, 'IDEMPOTENCY_KEY_REUSED');
  await expectStatus(400, approve, adminWrite({ unexpected: true }));
  await expectStatus(400, reject, adminWrite({ reason: '  ' }));
  await expectStatus(400, cancel, adminWrite({ reason: '  ' }));
  const rejection = adminWrite({ reason: '  Client declined  ' });
  await expectStatus(204, reject, rejection);
  await expectStatus(204, reject, { ...rejection, body: { reason: 'Client declined' } });
  assert.equal((await expectStatus(409, reject, { ...rejection, body: { reason: 'Different reason' } })).code, 'IDEMPOTENCY_KEY_REUSED');
  for (const transition of [approve, cancel, reject]) {
    assert.equal((await expectStatus(409, transition, adminWrite(transition === approve ? {} : { reason: 'Later' }))).code,
      'BOOKING_STATE_CONFLICT');
  }
  const pending = await createBooking(session, membership);
  await expectStatus(204, bookingDecision(pending, 'cancel'), adminWrite({ reason: 'Pending cancelled' }));
  const id = await createBooking(session, membership);
  const approval = adminWrite();
  await expectStatus(204, bookingDecision(id, 'approve'), approval);
  const path = bookingPath + bookingQuery(session.id);
  const full = await expectStatus(200, path + '&limit=1', adminRead());
  assert.equal(full.session.confirmedBookingCount, 1);
  assert.equal(full.nextCursor, full.items[0].id);
  assert.equal(full.items[0].id, id);
  const rest = await expectStatus(200, path + '&after=' + full.nextCursor, adminRead());
  assert.deepEqual(rest.items.map(item => item.status), ['CANCELLED', 'REJECTED']);
  assert.equal(rest.nextCursor, null);
  const foreign = await fixture.session({ startsAt: new Date(+session.startsAt + 2 * 3600_000) });
  await expectStatus(400, bookingPath + bookingQuery(foreign.id) + '&after=' + id, adminRead());
  const other = await fixture.membership('other');
  assert.equal((await expectStatus(409, bookingPath, adminWrite(bookingInput(session, other, 'other')))).code, 'SLOT_FULL');
  assert.equal((await expectStatus(409, bookingDecision(id, 'reject'), adminWrite({ reason: 'Too late' }))).code, 'BOOKING_STATE_CONFLICT');
  await expectStatus(204, bookingDecision(id, 'cancel'), adminWrite({ reason: 'Changed plans' }));
  await expectStatus(204, bookingDecision(id, 'approve'), approval);
  assert.deepEqual(await expectStatus(201, bookingPath, body), first);
  assert.equal((await expectStatus(200, path, adminRead())).session.confirmedBookingCount, 0);
  assert.deepEqual(await monetaryState(), before);
  const events = await migrator.auditLog.findMany({
    where: { targetType: 'BOOKING', targetId: { in: [first.bookingId, pending, id] } }, orderBy: { createdAt: 'asc' },
  });
  assert.deepEqual(events.map(event => [event.action, event.redactedDetails.previousStatus, event.redactedDetails.status, event.reason]), [
    ['BOOKING_CREATED', null, 'PENDING', null], ['BOOKING_REJECTED', 'PENDING', 'REJECTED', 'Client declined'],
    ['BOOKING_CREATED', null, 'PENDING', null], ['BOOKING_CANCELLED', 'PENDING', 'CANCELLED', 'Pending cancelled'],
    ['BOOKING_CREATED', null, 'PENDING', null], ['BOOKING_APPROVED', 'PENDING', 'CONFIRMED', null],
    ['BOOKING_CANCELLED', 'CONFIRMED', 'CANCELLED', 'Changed plans'],
  ]);
  for (const event of events) {
    assert.equal(event.actorId, users.admin.id);
    assert(event.requestId && event.createdAt instanceof Date);
  }
});

test('booking approvals recheck expiry and count past confirmations until the session or booking is cancelled', async () => {
  const fixture = await bookingFixture();
  const active = await fixture.membership('client', { allowance: 1, activatedAt: new Date(Date.now() - 5 * 86400_000),
    through: calendarAt(new Date(), 5) });
  const expired = await fixture.membership('other', { activatedAt: new Date(Date.now() - 5 * 86400_000),
    through: calendarAt(new Date(), 5) });
  const past = await fixture.session({ startsAt: new Date(Date.now() - 48 * 3600_000) });
  const future = await fixture.session();
  const next = await createBooking(future, active);
  const willExpire = await createBooking(future, expired, 'other');
  const historical = await migrator.booking.create({ data: {
    ...bookingInput(past, active), status: 'CONFIRMED',
    createdAt: new Date(+past.startsAt - 2 * 3600_000), updatedAt: new Date(+past.startsAt - 3600_000),
  } });
  await migrator.membership.update({ where: { id: expired.id }, data: { validThrough: dateColumn(calendarAt(new Date(), -1)) } });
  for (const id of [next, willExpire]) {
    assert.equal((await expectStatus(409, bookingDecision(id, 'approve'), adminWrite())).code, 'MEMBERSHIP_NOT_ELIGIBLE');
    assert.equal((await migrator.booking.findUniqueOrThrow({ where: { id } })).status, 'PENDING');
  }
  assert.deepEqual(await migrator.booking.findUniqueOrThrow({ where: { id: historical.id } }), historical);
  const pastPage = await expectStatus(200, bookingPath + bookingQuery(past.id), adminRead());
  assert.equal(pastPage.session.confirmedBookingCount, 1);
  assert.deepEqual(pastPage.items.map(({ id, status }) => ({ id, status })), [{ id: historical.id, status: 'CONFIRMED' }]);
  const choices = () => expectStatus(200, bookingChoices(users.client.id, future.id), adminRead());
  assert.equal((await choices()).find(row => row.membershipId === active.id).remainingCommitments, 0);
  const future2 = await fixture.session({ startsAt: new Date(+future.startsAt + 7200_000) });
  assert.equal((await expectStatus(409, bookingPath, adminWrite(bookingInput(future2, active)))).code, 'MEMBERSHIP_NOT_ELIGIBLE');
  await expectStatus(204, bookingDecision(historical.id, 'cancel'), adminWrite({ reason: 'Release the commitment' }));
  const cancelledHistory = await expectStatus(200, bookingPath + bookingQuery(past.id), adminRead());
  assert.equal(cancelledHistory.session.confirmedBookingCount, 0);
  assert.equal(cancelledHistory.items[0].status, 'CANCELLED');
  assert.equal((await choices()).find(row => row.membershipId === active.id).remainingCommitments, 1);
  await expectStatus(204, bookingDecision(next, 'approve'), adminWrite());
  await expectStatus(204, schedulePath + '/' + future.id + '/cancel', adminWrite({ expectedRevision: 1, reason: 'Coach unavailable' }));
  const page = await expectStatus(200, bookingPath + bookingQuery(future.id), adminRead());
  assert.equal(page.session.status, 'CANCELLED');
  assert.equal(page.session.confirmedBookingCount, 0);
  assert.deepEqual(new Set(page.items.map(row => row.status)), new Set(['CONFIRMED', 'PENDING']));
  assert.equal((await expectStatus(409, bookingDecision(willExpire, 'approve'), adminWrite())).code, 'SESSION_CANCELLED');
  const released = await expectStatus(200, bookingChoices(users.client.id, future2.id), adminRead());
  assert.equal(released.find(row => row.membershipId === active.id).remainingCommitments, 1);
  const replacement = await createBooking(future2, active);
  await expectStatus(204, bookingDecision(replacement, 'approve'), adminWrite());
});

test('booking writes and their idempotency claims roll back when audit insertion fails', async () => {
  const fixture = await bookingFixture();
  const session = await fixture.session();
  const membership = await fixture.membership();
  const create = adminWrite(bookingInput(session, membership));
  await migrator.$executeRaw`ALTER TABLE audit_log ADD CONSTRAINT test_reject_booking_audit
    CHECK (target_type <> 'BOOKING') NOT VALID`;
  try {
    await expectStatus(500, bookingPath, create);
    assert.equal(await migrator.booking.count({ where: { scheduledSessionId: session.id } }), 0);
    assert.equal(await migrator.idempotencyKey.count({ where: { key: create.key } }), 0);
  } finally {
    await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT test_reject_booking_audit`;
  }
  const { bookingId } = await expectStatus(201, bookingPath, create);
  const approve = adminWrite();
  await migrator.$executeRaw`ALTER TABLE audit_log ADD CONSTRAINT test_reject_booking_audit
    CHECK (action <> 'BOOKING_APPROVED') NOT VALID`;
  try {
    await expectStatus(500, bookingDecision(bookingId, 'approve'), approve);
    assert.equal((await migrator.booking.findUniqueOrThrow({ where: { id: bookingId } })).status, 'PENDING');
    assert.equal(await migrator.idempotencyKey.count({ where: { key: approve.key } }), 0);
  } finally {
    await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT test_reject_booking_audit`;
  }
  await expectStatus(204, bookingDecision(bookingId, 'approve'), approve);
});

test('PostgreSQL enforces active booking uniqueness, restrictive references and runtime privileges', async () => {
  const fixture = await bookingFixture();
  const session = await fixture.session();
  const membership = await fixture.membership();
  const id = await createBooking(session, membership);
  const insert = (db, clientId, sessionId, membershipId) => db.$queryRaw`
    INSERT INTO booking (client_id, scheduled_session_id, membership_id)
    VALUES (${clientId}::uuid, ${sessionId}::uuid, ${membershipId}::uuid) RETURNING id`;
  const indexes = await migrator.$queryRaw`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'booking'`;
  assert.deepEqual(indexes.map(index => index.indexname).sort(), [
    'booking_active_client_session_key', 'booking_client_id_idx', 'booking_id_scheduled_session_id_key', 'booking_membership_id_status_idx', 'booking_pkey',
    'booking_scheduled_session_id_created_at_id_idx', 'booking_scheduled_session_id_status_idx',
  ]);
  assert.match(indexes.find(index => index.indexname === 'booking_active_client_session_key').indexdef,
    /UNIQUE.*\(client_id, scheduled_session_id\).*WHERE.*PENDING.*CONFIRMED/);
  await assert.rejects(insert(runtime, users.client.id, session.id, membership.id), error => error.meta?.code === '23505');
  for (const values of [[randomUUID(), session.id, membership.id], [users.other.id, randomUUID(), membership.id],
    [users.other.id, session.id, randomUUID()]]) {
    await assert.rejects(insert(runtime, ...values), error => error.meta?.code === '23503');
  }
  await assert.rejects(migrator.$executeRaw`DELETE FROM scheduled_session WHERE id = ${session.id}::uuid`,
    error => error.meta?.code === '23503');
  await assert.rejects(runtime.$executeRaw`DELETE FROM booking WHERE id = ${id}::uuid`, error => error.meta?.code === '42501');
  for (const column of ['id', 'client_id', 'scheduled_session_id', 'membership_id', 'created_at']) {
    await assert.rejects(runtime.$executeRawUnsafe(`UPDATE booking SET ${column} = ${column}`),
      error => error.meta?.code === '42501');
  }
  await assert.rejects(runtime.$executeRaw`INSERT INTO booking (status) VALUES ('CONFIRMED')`, error => error.meta?.code === '42501');
  await expectStatus(204, bookingDecision(id, 'reject'), adminWrite({ reason: 'Try again' }));
  let duplicate;
  try {
    await runtime.$transaction(async tx => {
      assert.equal((await insert(tx, users.client.id, session.id, membership.id)).length, 1);
      duplicate = insert(runtime, users.client.id, session.id, membership.id).then(() => null, error => error);
      await waitForBookingLock('INSERT INTO booking', 1);
    });
  } finally { await duplicate; }
  assert.equal((await duplicate)?.meta?.code, '23505');
  assert.equal(await migrator.booking.count({ where: { scheduledSessionId: session.id } }), 2);
});

async function waitForBookingLock(fragment, count) {
  const deadline = Date.now() + 1200;
  while (Date.now() < deadline) {
    const [{ waiting }] = await owner.$queryRaw`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = ${databaseName} AND usename = 'studio_api' AND wait_event_type = 'Lock'
        AND query LIKE ${'%' + fragment + '%'}`;
    if (waiting === count) return;
    await delay(10);
  }
  assert.fail(count + ' booking transactions should wait on ' + fragment);
}

const secondAdmin = body => ({ ...adminWrite(body), access: sessions.raceAdmin.accessToken });

test('booking approval checks the start after acquiring the session lock', async t => {
  const fixture = await bookingFixture({ capacity: 1 });
  let now = await databaseClock.databaseTime(migrator);
  const membership = await fixture.membership('client', { allowance: 1, activatedAt: new Date(+now - 86400_000) });
  const session = await fixture.session({ startsAt: new Date(+now + 10_000), endsAt: new Date(+now + 20_000) });
  const future = await fixture.session({ startsAt: new Date(+now + 30_000) });
  t.mock.method(databaseClock, 'databaseTime', async () => now);
  const id = await createBooking(session, membership);
  const pending = await migrator.booking.findUniqueOrThrow({ where: { id } });
  const approve = adminWrite();
  const path = bookingDecision(id, 'approve');
  let approval;
  try {
    await migrator.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM scheduled_session WHERE id = ${session.id}::uuid FOR UPDATE`;
      approval = expectStatus(409, path, approve);
      await waitForBookingLock('FROM scheduled_session WHERE id', 1);
      now = session.startsAt;
    });
  } finally { await approval; }
  assert.equal((await approval).code, 'SCHEDULE_START_IN_PAST');
  now = new Date(+session.endsAt + 1);
  assert.equal((await expectStatus(409, path, approve)).code, 'SCHEDULE_START_IN_PAST');
  assert.deepEqual(await migrator.booking.findUniqueOrThrow({ where: { id } }), pending);
  assert.equal(await migrator.idempotencyKey.count({ where: { key: approve.key } }), 0);
  assert.equal(await migrator.auditLog.count({ where: { targetType: 'BOOKING', targetId: id } }), 1);
  const history = await expectStatus(200, bookingPath + bookingQuery(session.id), adminRead());
  assert.equal(history.session.confirmedBookingCount, 0);
  const choices = await expectStatus(200, bookingChoices(users.client.id, future.id), adminRead());
  assert.equal(choices.find(choice => choice.membershipId === membership.id).remainingCommitments, 1);

  const futureCreate = adminWrite(bookingInput(future, membership));
  const created = await expectStatus(201, bookingPath, futureCreate);
  const futureApproval = adminWrite();
  await expectStatus(204, bookingDecision(created.bookingId, 'approve'), futureApproval);
  now = new Date(+future.startsAt + 1);
  assert.deepEqual(await expectStatus(201, bookingPath, futureCreate), created);
  await expectStatus(204, bookingDecision(created.bookingId, 'approve'), futureApproval);
});

for (const shared of ['session', 'membership']) {
  test('concurrent booking approvals serialize on the final ' + shared + ' unit in PostgreSQL', async () => {
    const fixture = await bookingFixture({ capacity: shared === 'session' ? 1 : 2 });
    const firstSession = await fixture.session();
    const firstMembership = await fixture.membership('client', { allowance: 1 });
    const session = shared === 'session' ? firstSession : await fixture.session({ startsAt: new Date(+firstSession.startsAt + 7200_000) });
    const membership = shared === 'membership' ? firstMembership : await fixture.membership('other', { allowance: 1 });
    const first = await createBooking(firstSession, firstMembership);
    const second = await createBooking(session, membership, shared === 'session' ? 'other' : 'client');
    let approvals;
    try {
      await migrator.$transaction(async tx => {
        if (shared === 'session') {
          await tx.$queryRaw`SELECT id FROM scheduled_session WHERE id = ${session.id}::uuid FOR UPDATE`;
        } else {
          await tx.$queryRaw`SELECT id FROM membership WHERE id = ${membership.id}::uuid FOR UPDATE`;
        }
        approvals = Promise.all([
          request(bookingDecision(first, 'approve'), adminWrite()),
          request(bookingDecision(second, 'approve'), secondAdmin()),
        ]);
        await waitForBookingLock(shared === 'session' ? 'FROM scheduled_session WHERE id' : 'FROM membership WHERE id', 2);
      });
    } finally { await approvals; }
    const responses = await approvals;
    assert.deepEqual(responses.map(response => response.status).sort(), [204, 409]);
    assert.equal((await responses.find(response => response.status === 409).json()).code,
      shared === 'session' ? 'SLOT_FULL' : 'MEMBERSHIP_NOT_ELIGIBLE');
    const rows = await migrator.booking.findMany({ where: { id: { in: [first, second] } } });
    assert.deepEqual(rows.map(row => row.status).sort(), ['CONFIRMED', 'PENDING']);
  });
}

for (const change of ['cancel', 'move']) {
  for (const approveFirst of [false, true]) {
    test('booking approval races session ' + change + ' in PostgreSQL with ' + (approveFirst ? 'approval' : 'scheduling') + ' first', async () => {
      const fixture = await bookingFixture({ capacity: 1 });
      const session = await fixture.session();
      const membership = await fixture.membership();
      const id = await createBooking(session, membership);
      const approve = () => request(bookingDecision(id, 'approve'), secondAdmin());
      const schedule = () => change === 'cancel'
        ? request(schedulePath + '/' + session.id + '/cancel', adminWrite({ expectedRevision: 1, reason: 'Coach away' }))
        : request(schedulePath + '/' + session.id, scheduleWrite({
          expectedRevision: 1, startsAt: new Date(+session.startsAt + 10 * 86400_000).toISOString(), coachId: session.coachId,
        }, 'PATCH'));
      const pending = [];
      try {
        await migrator.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM scheduled_session WHERE id = ${session.id}::uuid FOR UPDATE`;
          pending.push((approveFirst ? approve : schedule)());
          await waitForBookingLock('FROM scheduled_session WHERE id', 1);
          pending.push((approveFirst ? schedule : approve)());
          await waitForBookingLock('FROM scheduled_session WHERE id', 2);
        });
      } finally { await Promise.all(pending); }
      const [first, second] = await Promise.all(pending);
      const approval = approveFirst ? first : second;
      assert.equal((approveFirst ? second : first).status, 204);
      assert.equal(approval.status, approveFirst ? 204 : 409);
      if (!approveFirst) assert.equal((await approval.json()).code, change === 'move' ? 'MEMBERSHIP_NOT_ELIGIBLE' : 'SESSION_CANCELLED');
      const page = await expectStatus(200, bookingPath + bookingQuery(session.id), adminRead());
      assert.equal(page.items[0].status, approveFirst ? 'CONFIRMED' : 'PENDING');
      assert.equal(page.items[0].requiresReview, approveFirst && change === 'move');
      assert.equal(page.session.confirmedBookingCount, approveFirst && change === 'move' ? 1 : 0);
      if (approveFirst && change === 'move') {
        assert.equal((await expectStatus(200, bookingChoices(users.client.id, session.id), adminRead()))
          .find(row => row.membershipId === membership.id).confirmedCommitments, 1);
        await expectStatus(204, bookingDecision(id, 'cancel'), adminWrite({ reason: 'Membership no longer covers session' }));
        assert.equal((await expectStatus(200, bookingPath + bookingQuery(session.id), adminRead())).items[0].requiresReview, false);
      }
    });
  }
}

test('booking migration upgrades the accepted scheduling baseline and preserves historical records', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'studio-booking-upgrade-'));
  const upgradeName = 'studio_booking_upgrade_' + randomBytes(6).toString('hex');
  const { api, migration } = disposableUrls();
  api.pathname = migration.pathname = '/' + upgradeName;
  const schema = join(scratch, 'schema.prisma');
  const migrations = join(prismaDirectory, 'migrations');
  const copy = name => cpSync(join(migrations, name), join(scratch, 'migrations', name), { recursive: true });
  let db, upgradedApp, databaseCreated = false;
  try {
    cpSync(join(prismaDirectory, 'schema.prisma'), schema);
    mkdirSync(join(scratch, 'migrations'));
    for (const name of readdirSync(migrations)) {
      if (name <= '20261114000200_scheduling_foundation' || name === 'migration_lock.toml') copy(name);
    }
    await owner.$executeRawUnsafe(`CREATE DATABASE "${upgradeName}"`);
    databaseCreated = true;
    deployMigrations(api, migration, schema);
    db = new PrismaClient({ datasourceUrl: migration.href });
    const [baseline] = await db.$queryRaw`SELECT to_regclass('public.booking')::text AS booking,
      (SELECT count(*)::int FROM _prisma_migrations WHERE finished_at IS NOT NULL) AS migrations`;
    assert.deepEqual(baseline, { booking: null, migrations: 12 });
    const admin = await db.user.create({ data: {
      normalizedEmail: 'upgrade-booking-admin@studio.example', role: 'ADMIN', accountState: 'ACTIVE',
      emailVerifiedAt: new Date(), passwordHash: await hashPassword(password),
    } });
    const client = await db.clientProfile.create({ data: {
      displayName: 'Upgrade Client', user: { create: { normalizedEmail: 'upgrade-booking-client@studio.example',
        role: 'CLIENT', accountState: 'ACTIVE' } },
    } });
    const coach = await db.coachProfile.create({ data: {
      displayName: 'Upgrade Coach', user: { create: { normalizedEmail: 'upgrade-booking-coach@studio.example',
        role: 'COACH', accountState: 'ACTIVE' } },
    } });
    const type = await db.sessionType.create({ data: { code: 'UPGRADE-BOOKING', name: 'Historical session type', mode: 'GROUP' } });
    const membership = await bookingMembership(db, admin.id, client.userId, type.id);
    const startsAt = new Date(scheduleDate());
    const session = await db.scheduledSession.create({ data: {
      sessionTypeId: type.id, coachId: coach.userId, startsAt, endsAt: new Date(+startsAt + 3600_000), bufferMinutes: 0, capacity: 2,
    } });
    const audit = await db.auditLog.create({ data: { actorId: admin.id, requestId: randomUUID(), action: 'SCHEDULED_SESSION_CREATED',
      targetType: 'SCHEDULED_SESSION', targetId: session.id, redactedDetails: {} } });
    const readPurchase = () => db.purchase.findUniqueOrThrow({ where: { id: membership.purchaseId }, include: { acceptance: true } });
    const purchase = await readPurchase();
    copy(bookingMigration);
    deployMigrations(api, migration, schema);
    assert.deepEqual(await db.scheduledSession.findUniqueOrThrow({ where: { id: session.id } }), session);
    assert.deepEqual(await db.membership.findUniqueOrThrow({ where: { id: membership.id } }), membership);
    assert.deepEqual(await db.auditLog.findUniqueOrThrow({ where: { id: audit.id } }), audit);
    assert.deepEqual(await readPurchase(), purchase);
    assert.equal(await db.booking.count(), 0);
    upgradedApp = await startApp({ ...loadConfig({ ...process.env, DATABASE_URL: api.href }), host: '127.0.0.1', port: 0 });
    const { accessToken } = await upgradedApp.get(Sessions).login(admin.normalizedEmail, password);
    const response = await fetch(await upgradedApp.getUrl() + '/api/v1/bookings', {
      method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ clientId: client.userId, membershipId: membership.id, scheduledSessionId: session.id }),
    });
    const result = await response.json();
    assert.equal(response.status, 201, JSON.stringify(result));
    assert.equal((await db.booking.findUniqueOrThrow({ where: { id: result.bookingId } })).status, 'PENDING');
  } finally {
    await upgradedApp?.close();
    await db?.$disconnect();
    if (databaseCreated) await owner.$executeRawUnsafe(`DROP DATABASE "${upgradeName}" WITH (FORCE)`);
    rmSync(scratch, { recursive: true, force: true });
  }
});

const attendancePath = session => '/attendance/sessions/' + session.id;
const attended = (booking, expectedRevision = 0) => ({ bookingId: booking.id, expectedRevision, outcome: 'ATTENDED' });

async function attendanceLogin(id) {
  const coach = await migrator.user.update({ where: { id }, data: { passwordHash: users.coach.passwordHash } });
  return app.get(Sessions).login(coach.normalizedEmail, password);
}

async function attendanceFixture(startsAt) {
  const source = await bookingFixture();
  const assigned = await additionalCoach();
  const actor = await attendanceLogin(assigned.id);
  const session = await source.session({
    coachId: assigned.id,
    startsAt: startsAt ?? new Date(+await databaseClock.databaseTime(migrator) - 30 * 60_000),
  });
  const membership = await source.membership();
  const book = async (status, client = 'client', target = session) =>
    migrator.booking.create({ data: {
      ...bookingInput(target, client === 'client' ? membership : await source.membership(client), client), status,
    } });
  const confirmed = await book('CONFIRMED');
  const detail = actor => expectStatus(200, attendancePath(session), { access: actor.accessToken });
  const submit = (entries = [attended(confirmed)], options = {}) => ({
    access: actor.accessToken, method: 'POST', key: randomUUID(),
    body: { expectedScheduleRevision: session.revision, entries }, ...options,
  });
  return { ...source, actor, assigned, session, confirmed, membership, book, detail, submit, path: attendancePath(session) + '/submit' };
}

test('attendance reads only the scoped roster and refuses Admin, Staff, Client and cross-Coach submissions', async () => {
  const f = await attendanceFixture();
  const state = await f.detail(f.actor);
  assert.equal(state.submissionEnabled, true);
  assert.equal(state.session.served, null);
  assert.deepEqual(state.items, [{ bookingId: f.confirmed.id, clientDisplayName: 'client', bookingStatus: 'CONFIRMED',
    revision: 0, outcome: null, reviewStatus: 'UNSUBMITTED', submittedAt: null }]);
  assert.equal((await f.detail(sessions.admin)).submissionEnabled, false);
  assert(!JSON.stringify(state).includes(f.membership.id));
  await migrator.staffGrant.upsert({
    where: { staffUserId_permission: { staffUserId: users.staff.id, permission: 'ATTENDANCE_READ' } },
    create: { staffUserId: users.staff.id, permission: 'ATTENDANCE_READ', changedById: users.admin.id },
    update: { revokedAt: null },
  });
  assert.equal((await expectStatus(400, '/staff-grants/' + users.staff.id + '/attendance.read', grantOptions(true))).code,
    'INVALID_STAFF_PERMISSION');
  for (const actor of [sessions.admin, sessions.staff, sessions.client]) {
    await expectStatus(403, f.path, f.submit(undefined, { access: actor.accessToken }));
    if (actor !== sessions.admin) await expectStatus(403, attendancePath(f.session), { access: actor.accessToken });
  }
  const otherCoach = await attendanceLogin(f.coachId);
  await expectStatus(404, attendancePath(f.session), { access: otherCoach.accessToken });
  await expectStatus(404, f.path, f.submit(undefined, { access: otherCoach.accessToken }));
  assert.equal(await migrator.sessionAttendance.count({ where: { scheduledSessionId: f.session.id } }), 0);
});

test('attendance checks the database start boundary, audits the actor and freezes attribution', async t => {
  const now = await databaseClock.databaseTime(migrator);
  const f = await attendanceFixture(now);
  let clock = new Date(+now - 1);
  t.mock.method(databaseClock, 'databaseTime', async () => clock);
  const submission = f.submit();
  assert.equal((await expectStatus(409, f.path, submission)).code, 'SESSION_NOT_STARTED');
  assert.equal(await migrator.idempotencyKey.count({ where: { key: submission.key } }), 0);
  clock = now;
  const response = await request(f.path, submission);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const revision = await migrator.attendanceRevision.findFirstOrThrow({ where: { bookingId: f.confirmed.id } });
  assert.equal(revision.revision, 1);
  assert.equal(revision.submittedById, f.assigned.id);
  assert.deepEqual(revision.submittedAt, now);
  const audit = await migrator.auditLog.findFirstOrThrow({ where: { targetType: 'ATTENDANCE_REVISION', targetId: revision.id } });
  assert.equal(audit.action, 'ATTENDANCE_SUBMITTED');
  assert.equal(audit.actorId, f.assigned.id);
  assert.equal(audit.requestId, response.headers.get('x-request-id'));
  assert.equal((await f.detail(f.actor)).items[0].reviewStatus, 'PENDING_REVIEW');

  // Normal scheduling cannot change past sessions. A fixture change proves the read still uses frozen facts.
  await migrator.scheduledSession.update({ where: { id: f.session.id }, data: {
    coachId: f.coachId, startsAt: new Date(+now - 3600_000),
  } });
  assert.deepEqual((await f.detail(sessions.admin)).session.served, {
    coachId: f.assigned.id, coachDisplayName: 'Other coach', startsAt: now.toISOString(),
    sessionTypeId: f.session.sessionTypeId,
    sessionTypeName: (await migrator.sessionType.findUniqueOrThrow({ where: { id: f.session.sessionTypeId } })).name,
  });
  await expectStatus(404, f.path, submission);
  const otherCoach = await attendanceLogin(f.coachId);
  await expectStatus(404, attendancePath(f.session), { access: otherCoach.accessToken });
});

test('attendance rejects an invalid roster atomically and records only explicitly selected confirmed bookings', async () => {
  const f = await attendanceFixture();
  const pending = await f.book('PENDING', 'other');
  const rejected = await f.book('REJECTED', 'other');
  const cancelled = await f.book('CANCELLED', 'other');
  const foreignSession = await migrator.scheduledSession.create({ data: {
    coachId: f.coachId, sessionTypeId: f.session.sessionTypeId, startsAt: f.session.startsAt, endsAt: f.session.endsAt,
    capacity: 2, bufferMinutes: 0,
  } });
  const foreign = await f.book('CONFIRMED', 'client', foreignSession);
  assert.deepEqual((await f.detail(f.actor)).items.map(item => item.bookingId), [f.confirmed.id]);
  for (const invalid of [pending, rejected, cancelled, foreign]) {
    const options = f.submit([attended(f.confirmed), attended(invalid)]);
    assert.equal((await expectStatus(invalid === foreign ? 404 : 409, f.path, options)).code,
      invalid === foreign ? 'BOOKING_NOT_FOUND' : 'BOOKING_NOT_CONFIRMED');
    assert.equal(await migrator.sessionAttendance.count({ where: { scheduledSessionId: f.session.id } }), 0);
    assert.equal(await migrator.idempotencyKey.count({ where: { key: options.key } }), 0);
  }
  for (const entries of [
    [], [[attended(f.confirmed)]], [attended(f.confirmed), attended({ id: f.confirmed.id.toUpperCase() })],
    [{ ...attended(f.confirmed), expectedRevision: '0' }], [{ ...attended(f.confirmed), outcome: 'NO_SHOW' }],
    [{ ...attended(f.confirmed), membershipId: f.membership.id }],
  ]) await expectStatus(400, f.path, f.submit(entries));

  await migrator.booking.update({ where: { id: pending.id }, data: { status: 'CONFIRMED' } });
  const submission = f.submit();
  await expectStatus(204, f.path, submission);
  await expectStatus(204, f.path, f.submit([attended({ id: f.confirmed.id.toUpperCase() })], { key: submission.key }));
  assert.equal((await expectStatus(409, f.path, f.submit([attended(pending)], { key: submission.key }))).code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal((await expectStatus(409, f.path, f.submit())).code, 'ATTENDANCE_REVISION_STALE');
  assert.equal((await expectStatus(409, f.path, f.submit([attended(f.confirmed, 1)]))).code, 'ATTENDANCE_STATE_CONFLICT');
  assert.equal((await expectStatus(409, f.path, f.submit([], { body: { ...submission.body, expectedScheduleRevision: 2 } }))).code,
    'SCHEDULED_SESSION_CHANGED');
  const admin = await f.detail(sessions.admin);
  assert.equal(admin.items.find(row => row.bookingId === f.confirmed.id).reviewStatus, 'PENDING_REVIEW');
  assert.equal(admin.items.find(row => row.bookingId === pending.id).reviewStatus, 'UNSUBMITTED');
  const first = await expectStatus(200, attendancePath(f.session) + '?limit=1', adminRead());
  const next = await expectStatus(200, attendancePath(f.session) + '?after=' + first.nextCursor, adminRead());
  assert.deepEqual([...first.items, ...next.items], admin.items);
  assert.equal(await migrator.attendanceRevision.count({ where: { bookingId: f.confirmed.id } }), 1);
  assert.equal(await migrator.attendanceRevision.count({ where: { bookingId: pending.id } }), 0);
  assert.deepEqual(await migrator.membership.findUniqueOrThrow({ where: { id: f.membership.id } }), f.membership);
});

test('attendance starts disabled without an explicit test harness and audit failure rolls back the whole command', async () => {
  const f = await attendanceFixture();
  const config = app.get(CONFIG);
  const submit = f.submit();
  delete config.attendanceCaptureForTesting;
  try {
    assert.equal((await f.detail(f.actor)).submissionEnabled, false);
    assert.equal((await expectStatus(409, f.path, submit)).code, 'WORKFLOW_NOT_ENABLED');
  } finally { config.attendanceCaptureForTesting = true; }
  await migrator.$executeRaw`ALTER TABLE audit_log ADD CONSTRAINT test_reject_attendance CHECK (action <> 'ATTENDANCE_SUBMITTED') NOT VALID`;
  try {
    await expectStatus(500, f.path, submit);
    assert.equal(await migrator.sessionAttendance.count({ where: { scheduledSessionId: f.session.id } }), 0);
    assert.equal(await migrator.attendanceParticipant.count({ where: { bookingId: f.confirmed.id } }), 0);
    assert.equal(await migrator.attendanceRevision.count({ where: { bookingId: f.confirmed.id } }), 0);
    assert.equal(await migrator.idempotencyKey.count({ where: { key: submit.key } }), 0);
  } finally { await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT test_reject_attendance`; }
  await expectStatus(204, f.path, submit);
  const revision = await migrator.attendanceRevision.findFirstOrThrow({ where: { bookingId: f.confirmed.id } });
  await assert.rejects(runtime.sessionAttendance.update({ where: { scheduledSessionId: f.session.id }, data: { servedStartsAt: new Date() } }));
  await assert.rejects(runtime.sessionAttendance.delete({ where: { scheduledSessionId: f.session.id } }));
  await assert.rejects(runtime.attendanceParticipant.update({ where: { bookingId: f.confirmed.id }, data: { scheduledSessionId: f.session.id } }));
  await assert.rejects(runtime.attendanceParticipant.delete({ where: { bookingId: f.confirmed.id } }));
  await assert.rejects(runtime.attendanceRevision.update({ where: { id: revision.id }, data: { revision: 2 } }));
  await assert.rejects(runtime.attendanceRevision.delete({ where: { id: revision.id } }));
  const other = await attendanceFixture(new Date(+f.session.startsAt - 7200_000));
  await assert.rejects(runtime.attendanceParticipant.create({ data: {
    bookingId: other.confirmed.id, scheduledSessionId: f.session.id,
  } }), { code: 'P2003' });
  await assert.rejects(runtime.attendanceRevision.create({ data: {
    bookingId: f.confirmed.id, revision: 1, outcome: 'ATTENDED', submittedById: f.assigned.id, submittedAt: new Date(),
  } }), { code: 'P2002' });
});

for (const action of ['reassignment', 'session cancellation', 'booking cancellation']) {
  test('attendance observes a winning ' + action + ' after waiting on the session lock', async t => {
    const now = await databaseClock.databaseTime(migrator);
    const f = await attendanceFixture(new Date(+now + 60_000));
    const scheduled = '/scheduling/sessions/' + f.session.id;
    const cancel = adminWrite({ expectedRevision: f.session.revision, reason: 'Fixture cancelled' });
    const competing = () => action === 'reassignment'
      ? expectStatus(204, scheduled, { ...adminWrite({
        coachId: f.coachId, startsAt: f.session.startsAt.toISOString(), expectedRevision: f.session.revision,
      }), method: 'PATCH' })
      : action === 'session cancellation' ? expectStatus(204, scheduled + '/cancel', cancel)
        : expectStatus(204, bookingDecision(f.confirmed.id, 'cancel'), adminWrite({ reason: 'Booking cancelled' }));
    let admin, coach;
    // Booking cancellation is tested at its past-session boundary by sampling time after both commands are queued.
    let clock = now;
    t.mock.method(databaseClock, 'databaseTime', async () => clock);
    try {
      await migrator.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM scheduled_session WHERE id = ${f.session.id}::uuid FOR UPDATE`;
        admin = competing();
        await waitForBookingLock('FROM scheduled_session WHERE id', 1);
        coach = expectStatus(action === 'reassignment' ? 404 : 409, f.path, f.submit());
        await waitForBookingLock('FROM scheduled_session WHERE id', 2);
        if (action === 'booking cancellation') clock = f.session.startsAt;
      });
    } finally { await Promise.all([admin, coach]); }
    assert.equal((await coach).code, {
      reassignment: 'SCHEDULED_SESSION_NOT_FOUND', 'session cancellation': 'SESSION_CANCELLED',
      'booking cancellation': 'BOOKING_NOT_CONFIRMED',
    }[action]);
    assert.equal(await migrator.sessionAttendance.count({ where: { scheduledSessionId: f.session.id } }), 0);
  });
}

test('attendance survives a waiting booking cancellation and samples the start after acquiring the lock', async t => {
  const now = await databaseClock.databaseTime(migrator);
  const f = await attendanceFixture(new Date(+now + 60_000));
  let clock = now;
  t.mock.method(databaseClock, 'databaseTime', async () => clock);
  let coach, admin;
  try {
    await migrator.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM scheduled_session WHERE id = ${f.session.id}::uuid FOR UPDATE`;
      coach = expectStatus(204, f.path, f.submit());
      await waitForBookingLock('FROM scheduled_session WHERE id', 1);
      admin = expectStatus(204, bookingDecision(f.confirmed.id, 'cancel'), adminWrite({ reason: 'Cancelled later' }));
      await waitForBookingLock('FROM scheduled_session WHERE id', 2);
      clock = f.session.startsAt;
    });
  } finally { await Promise.all([coach, admin]); }
  const record = (await f.detail(f.actor)).items[0];
  assert.equal(record.bookingStatus, 'CANCELLED');
  assert.equal(record.reviewStatus, 'PENDING_REVIEW');
  assert.equal(record.submittedAt, f.session.startsAt.toISOString());
});


const participantPath = f => attendancePath(f.session) + '/participants/' + f.confirmed.id;
const returnRequest = (f, overrides = {}) => adminWrite({ expectedScheduleRevision: f.session.revision,
  expectedRevision: 1, reason: 'Please review the completion with this participant.', ...overrides });
const historyRead = (f, actor = sessions.admin, query = '') => expectStatus(200, participantPath(f) + query, { access: actor.accessToken });
async function returnedAttendance() {
  const f = await attendanceFixture();
  await expectStatus(204, f.path, f.submit());
  await expectStatus(204, participantPath(f) + '/return', returnRequest(f));
  const decision = (await historyRead(f)).items[0].reviewDecision;
  const reaffirmRequest = (overrides = {}) => ({ access: f.actor.accessToken, method: 'POST', key: randomUUID(), body: {
    expectedScheduleRevision: f.session.revision, expectedRevision: 1, reviewedReturnId: decision.id, outcome: 'ATTENDED', ...overrides,
  } });
  return { ...f, decision, reaffirmRequest };
}

test('Admin return is participant-specific and Coach reaffirmation preserves immutable history and memberships', async () => {
  const f = await attendanceFixture();
  const second = await f.book('CONFIRMED', 'other');
  await expectStatus(204, f.path, f.submit([attended(f.confirmed), attended(second)]));
  const before = await migrator.attendanceRevision.findMany({ where: { bookingId: { in: [f.confirmed.id, second.id] } }, orderBy: { id: 'asc' } });
  const memberships = await migrator.membership.findMany({ where: { bookings: { some: { scheduledSessionId: f.session.id } } }, orderBy: { id: 'asc' } });
  const request = returnRequest(f, { reason: '  Review participant completion.  ' });
  const response = await requestWithId(participantPath(f) + '/return', request);
  const history = await historyRead(f, f.actor);
  const decision = history.items[0].reviewDecision;
  assert.equal(history.items[0].submissionKind, 'ORIGINAL');
  assert.equal(decision.reason, 'Review participant completion.');
  assert.equal(decision.adminId, users.admin.id);
  const audit = await migrator.auditLog.findFirstOrThrow({ where: { targetId: decision.id, action: 'ATTENDANCE_RETURNED' } });
  assert.equal(audit.actorId, users.admin.id);
  assert.equal(audit.requestId, response);
  const items = (await f.detail(f.actor)).items;
  assert.equal(items.find(row => row.bookingId === f.confirmed.id).reviewStatus, 'RETURNED');
  assert.equal(items.find(row => row.bookingId === second.id).reviewStatus, 'PENDING_REVIEW');
  await expectStatus(204, participantPath(f) + '/return', request);
  const reaffirm = { access: f.actor.accessToken, method: 'POST', key: randomUUID(), body: {
    expectedScheduleRevision: f.session.revision, expectedRevision: 1, reviewedReturnId: decision.id, outcome: 'ATTENDED',
  } };
  await expectStatus(204, participantPath(f) + '/reaffirm', reaffirm);
  await expectStatus(204, participantPath(f) + '/reaffirm', { ...reaffirm, body: { ...reaffirm.body, reviewedReturnId: decision.id.toUpperCase() } });
  const final = await historyRead(f);
  assert.equal(final.items.length, 2);
  assert.equal(final.items[0].revision, 2);
  assert.equal(final.items[0].submissionKind, 'REAFFIRMATION');
  assert.equal(final.items[0].outcome, 'ATTENDED');
  assert.equal(final.items[0].submittedById, f.assigned.id);
  assert.equal(final.items[0].reviewDecision, null);
  assert.deepEqual(final.items[1], history.items[0]);
  assert.deepEqual(await migrator.attendanceRevision.findMany({ where: { id: { in: before.map(row => row.id) } }, orderBy: { id: 'asc' } }), before);
  assert.deepEqual(await migrator.membership.findMany({ where: { id: { in: memberships.map(row => row.id) } }, orderBy: { id: 'asc' } }), memberships);
  assert.equal((await f.detail(f.actor)).items.find(row => row.bookingId === f.confirmed.id).reviewStatus, 'PENDING_REVIEW');
  assert.equal(await migrator.attendanceReviewDecision.count({ where: { revisionId: final.items[1].id } }), 1);
  assert.equal(await migrator.auditLog.count({ where: { action: 'ATTENDANCE_REAFFIRMED', targetId: final.items[0].id } }), 1);
  const page = await historyRead(f, f.actor, '?limit=1');
  assert.deepEqual(page.items, [final.items[0]]);
  assert.equal(page.nextCursor, final.items[0].id);
  assert.deepEqual((await historyRead(f, f.actor, '?after=' + page.nextCursor)).items, [final.items[1]]);
  await expectStatus(400, participantPath(f) + '?after=' + before.find(row => row.bookingId === second.id).id, adminRead());
});

async function requestWithId(path, options) {
  const response = await request(path, options);
  assert.equal(response.status, 204, await response.text());
  return response.headers.get('x-request-id');
}

test('return validates mandatory reason, exact JSON contract, schedule, revision and idempotency key', async () => {
  const f = await attendanceFixture();
  await expectStatus(204, f.path, f.submit());
  const path = participantPath(f) + '/return';
  for (const reason of [undefined, null, '', ' \n\t ', '\u00a0', 12, [], {}, 'x'.repeat(1001)]) {
    await expectStatus(400, path, returnRequest(f, { reason }));
  }
  for (const fields of [{ expectedRevision: '1' }, { expectedRevision: 0 }, { expectedScheduleRevision: 0 }, { note: 'not supported' }]) {
    await expectStatus(400, path, returnRequest(f, fields));
  }
  await expectStatus(400, path + '?extra=yes', returnRequest(f));
  await expectStatus(400, path, { ...returnRequest(f), key: undefined });
  assert.equal((await expectStatus(409, path, returnRequest(f, { expectedRevision: 2 }))).code, 'ATTENDANCE_REVISION_STALE');
  assert.equal((await expectStatus(409, path, returnRequest(f, { expectedScheduleRevision: 2 }))).code, 'SCHEDULED_SESSION_CHANGED');
  assert.equal(await migrator.attendanceReviewDecision.count({ where: { revision: { bookingId: f.confirmed.id } } }), 0);
});

test('history, return and reaffirmation enforce assigned Coach and Admin roles including legacy grants', async () => {
  const f = await returnedAttendance();
  const outsider = await attendanceLogin(f.coachId);
  for (const actor of [sessions.staff, sessions.client]) {
    await expectStatus(403, participantPath(f), { access: actor.accessToken });
    await expectStatus(403, participantPath(f) + '/return', { ...returnRequest(f), access: actor.accessToken });
    await expectStatus(403, participantPath(f) + '/reaffirm', { ...f.reaffirmRequest(), access: actor.accessToken });
  }
  for (const actor of [f.actor, outsider]) {
    await expectStatus(403, participantPath(f) + '/return', { ...returnRequest(f), access: actor.accessToken });
  }
  await expectStatus(403, participantPath(f) + '/reaffirm', { ...f.reaffirmRequest(), access: sessions.admin.accessToken });
  await expectStatus(404, participantPath(f), { access: outsider.accessToken });
  await expectStatus(404, participantPath(f) + '/reaffirm', { ...f.reaffirmRequest(), access: outsider.accessToken });
  await expectStatus(404, attendancePath(f.session) + '/participants/' + randomUUID(), adminRead());
  assert.equal((await historyRead(f, f.actor)).items[0].reviewDecision.reason, f.decision.reason);
  await migrator.scheduledSession.update({ where: { id: f.session.id }, data: { coachId: f.coachId } });
  for (const actor of [f.actor, outsider]) {
    await expectStatus(404, participantPath(f), { access: actor.accessToken });
    await expectStatus(404, participantPath(f) + '/reaffirm', { ...f.reaffirmRequest(), access: actor.accessToken });
  }
  assert.equal((await historyRead(f)).items.length, 1);
});

test('reaffirmation requires the latest returned revision and acknowledgment of its exact reason', async () => {
  const f = await returnedAttendance();
  const path = participantPath(f) + '/reaffirm';
  assert.equal((await expectStatus(409, participantPath(f) + '/return', returnRequest(f))).code, 'ATTENDANCE_STATE_CONFLICT');
  for (const fields of [{ outcome: 'NO_SHOW' }, { outcome: 'LATE_CANCELLED' }, { reviewedReturnId: undefined }, { note: 'no fields' }]) {
    await expectStatus(400, path, f.reaffirmRequest(fields));
  }
  assert.equal((await expectStatus(409, path, f.reaffirmRequest({ reviewedReturnId: randomUUID() }))).code, 'ATTENDANCE_RETURN_STALE');
  assert.equal((await expectStatus(409, path, f.reaffirmRequest({ expectedRevision: 2 }))).code, 'ATTENDANCE_REVISION_STALE');
  const reaffirm = f.reaffirmRequest();
  await expectStatus(204, path, reaffirm);
  assert.equal((await expectStatus(409, path, { ...reaffirm, body: { ...reaffirm.body, expectedRevision: 2 } })).code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal((await expectStatus(409, path, f.reaffirmRequest())).code, 'ATTENDANCE_REVISION_STALE');
  assert.equal((await expectStatus(409, path, f.reaffirmRequest({ expectedRevision: 2 }))).code, 'ATTENDANCE_STATE_CONFLICT');
  assert.equal((await expectStatus(409, participantPath(f) + '/return', returnRequest(f))).code, 'ATTENDANCE_REVISION_STALE');
  await expectStatus(204, participantPath(f) + '/return', returnRequest(f, { expectedRevision: 2, reason: 'Review again.' }));
  assert.equal((await expectStatus(409, path, f.reaffirmRequest({ expectedRevision: 2 }))).code, 'ATTENDANCE_RETURN_STALE');
  const latest = (await historyRead(f)).items[0];
  await expectStatus(204, path, f.reaffirmRequest({ expectedRevision: 2, reviewedReturnId: latest.reviewDecision.id }));
  assert.deepEqual((await historyRead(f)).items.map(row => [row.revision, row.submissionKind]), [[3, 'REAFFIRMATION'], [2, 'REAFFIRMATION'], [1, 'ORIGINAL']]);
  const fresh = await attendanceFixture();
  await expectStatus(409, participantPath(fresh) + '/reaffirm', { ...f.reaffirmRequest(), access: fresh.actor.accessToken,
    body: { ...f.reaffirmRequest().body, expectedScheduleRevision: fresh.session.revision } });
  await expectStatus(204, fresh.path, fresh.submit());
  assert.equal((await expectStatus(409, participantPath(fresh) + '/reaffirm', { ...f.reaffirmRequest(), access: fresh.actor.accessToken })).code,
    'ATTENDANCE_STATE_CONFLICT');
});

test('return and reaffirmation remain production-gated and audit failure rolls back evidence and retries', async () => {
  const f = await attendanceFixture();
  await expectStatus(204, f.path, f.submit());
  const config = app.get(CONFIG);
  const path = participantPath(f);
  delete config.attendanceCaptureForTesting;
  try {
    assert.equal((await f.detail(sessions.admin)).returnEnabled, false);
    assert.equal((await expectStatus(409, path + '/return', returnRequest(f))).code, 'WORKFLOW_NOT_ENABLED');
  } finally { config.attendanceCaptureForTesting = true; }
  const returnIntent = returnRequest(f);
  await migrator.$executeRaw`ALTER TABLE audit_log ADD CONSTRAINT test_reject_return CHECK (action <> 'ATTENDANCE_RETURNED') NOT VALID`;
  try {
    await expectStatus(500, path + '/return', returnIntent);
    assert.equal(await migrator.attendanceReviewDecision.count({ where: { revision: { bookingId: f.confirmed.id } } }), 0);
    assert.equal(await migrator.idempotencyKey.count({ where: { key: returnIntent.key } }), 0);
  } finally { await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT test_reject_return`; }
  await expectStatus(204, path + '/return', returnIntent);
  const decision = (await historyRead(f)).items[0].reviewDecision;
  const reaffirm = { ...f.submit(), body: { expectedScheduleRevision: f.session.revision, expectedRevision: 1,
    reviewedReturnId: decision.id, outcome: 'ATTENDED' } };
  delete config.attendanceCaptureForTesting;
  try {
    assert.equal((await expectStatus(409, path + '/reaffirm', reaffirm)).code, 'WORKFLOW_NOT_ENABLED');
  } finally { config.attendanceCaptureForTesting = true; }
  await migrator.$executeRaw`ALTER TABLE audit_log ADD CONSTRAINT test_reject_reaffirm CHECK (action <> 'ATTENDANCE_REAFFIRMED') NOT VALID`;
  try {
    await expectStatus(500, path + '/reaffirm', reaffirm);
    assert.equal(await migrator.attendanceRevision.count({ where: { bookingId: f.confirmed.id } }), 1);
    assert.equal(await migrator.idempotencyKey.count({ where: { key: reaffirm.key } }), 0);
  } finally { await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT test_reject_reaffirm`; }
  await expectStatus(204, path + '/reaffirm', reaffirm);
});

test('concurrent returns, reaffirmations and retries serialize without duplicate evidence', async t => {
  for (const winner of ['shared', 'competing']) {
    const f = await attendanceFixture();
    await expectStatus(204, f.path, f.submit());
    const path = participantPath(f);
    const returns = await Promise.all([request(path + '/return', returnRequest(f)),
      request(path + '/return', { ...returnRequest(f), access: sessions.raceAdmin.accessToken })]);
    assert.deepEqual(returns.map(row => row.status).sort(), [204, 409]);
    const revision = (await historyRead(f)).items[0];
    const reaffirm = { ...f.submit(), body: { expectedScheduleRevision: f.session.revision,
      expectedRevision: 1, reviewedReturnId: revision.reviewDecision.id, outcome: 'ATTENDED' } };
    const competing = { ...reaffirm, key: randomUUID() };
    const intents = [reaffirm, reaffirm, competing, returnRequest(f)];
    const paths = [path + '/reaffirm', path + '/reaffirm', path + '/reaffirm', path + '/return'];
    const pending = [];
    try {
      await migrator.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM scheduled_session WHERE id = ${f.session.id}::uuid FOR UPDATE`;
        const first = winner === 'shared' ? 0 : 2;
        pending[first] = request(paths[first], intents[first]);
        await waitForBookingLock('FROM scheduled_session WHERE id', 1);
        for (let i = 0; i < intents.length; i++) {
          if (i !== first) pending[i] = request(paths[i], intents[i]);
        }
        // Promise.all launch order does not determine which distinct key wins.
        // Queue each winner explicitly; its identical-key retry waits on the key claim.
        await waitForBookingLock('FROM scheduled_session WHERE id', 3);
      });
    } finally { await Promise.all(pending); }
    const attempts = await Promise.all(pending);
    const expected = winner === 'shared' ? [204, 204, 409, 409] : [409, 409, 204, 409];
    assert.deepEqual(attempts.map(row => row.status), expected, winner + ' key wins');
    for (const response of attempts) {
      if (response.status === 409) assert.equal((await response.json()).code, 'ATTENDANCE_REVISION_STALE');
    }
    const winningIntent = winner === 'shared' ? reaffirm : competing;
    const replays = await Promise.all([request(path + '/reaffirm', winningIntent), request(path + '/reaffirm', winningIntent)]);
    assert.deepEqual(replays.map(row => row.status), [204, 204], 'concurrent retries replay the committed winner');
    assert.deepEqual(await migrator.idempotencyKey.findMany({
      where: { actorId: f.assigned.id, operation: 'attendance.reaffirm', key: { in: [reaffirm.key, competing.key] } },
      select: { key: true, resultStatus: true },
    }), [{ key: winningIntent.key, resultStatus: 204 }], 'losing commands leave no successful idempotency claim');
    assert.equal(await migrator.attendanceRevision.count({ where: { bookingId: f.confirmed.id } }), 2);
    assert.equal(await migrator.attendanceReviewDecision.count({ where: { revisionId: revision.id } }), 1);
    const latest = (await historyRead(f)).items[0];
    assert.equal(latest.revision, 2);
    assert.equal(latest.reviewDecision, null);
    assert.equal(await migrator.auditLog.count({ where: { action: 'ATTENDANCE_REAFFIRMED', targetId: latest.id } }), 1);
    t.diagnostic(winner + ' key wins: ' + JSON.stringify(expected) + '; winning-key retries: [204,204]');
  }
});

for (const cancelled of ['booking', 'session']) {
  for (const transition of ['return', 'reaffirm']) {
    test('a cancelled ' + cancelled + ' blocks ' + transition + ' and preserves all evidence', async () => {
      const f = transition === 'reaffirm' ? await returnedAttendance() : await attendanceFixture();
      if (transition === 'return') await expectStatus(204, f.path, f.submit());
      const before = await historyRead(f);
      if (cancelled === 'booking') {
        await expectStatus(204, bookingDecision(f.confirmed.id, 'cancel'), adminWrite({ reason: 'Cancelled after submission.' }));
      } else {
        // The Scheduling API already denies cancellation after start. Simulate an externally cancelled historical session.
        await migrator.scheduledSession.update({ where: { id: f.session.id }, data: {
          cancelledAt: new Date(), cancellationReason: 'Historical cancellation fixture.',
        } });
      }
      const result = await expectStatus(409, participantPath(f) + '/' + transition,
        transition === 'return' ? returnRequest(f) : f.reaffirmRequest());
      assert.equal(result.code, cancelled === 'booking' ? 'BOOKING_NOT_CONFIRMED' : 'SESSION_CANCELLED');
      assert.deepEqual(await historyRead(f, f.actor), before);
    });
  }
}

for (const transition of ['return', 'reaffirm']) {
  test(transition + ' re-reads a winning Booking cancellation after acquiring the session lock', async () => {
    const f = transition === 'reaffirm' ? await returnedAttendance() : await attendanceFixture();
    if (transition === 'return') await expectStatus(204, f.path, f.submit());
    const before = await historyRead(f);
    let cancellation, review;
    try {
      await migrator.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM scheduled_session WHERE id = ${f.session.id}::uuid FOR UPDATE`;
        cancellation = expectStatus(204, bookingDecision(f.confirmed.id, 'cancel'), adminWrite({ reason: 'Cancellation won.' }));
        await waitForBookingLock('FROM scheduled_session WHERE id', 1);
        review = expectStatus(409, participantPath(f) + '/' + transition, transition === 'return' ? returnRequest(f) : f.reaffirmRequest());
        await waitForBookingLock('FROM scheduled_session WHERE id', 2);
      });
    } finally { await Promise.all([cancellation, review]); }
    assert.equal((await review).code, 'BOOKING_NOT_CONFIRMED');
    assert.deepEqual(await historyRead(f), before);
  });
}

test('review decisions enforce append-only runtime permissions, uniqueness, reason and restrictive references', async () => {
  const f = await returnedAttendance();
  const decision = await migrator.attendanceReviewDecision.findUniqueOrThrow({ where: { id: f.decision.id } });
  await assert.rejects(runtime.attendanceReviewDecision.update({ where: { id: decision.id }, data: { reason: 'Rewrite' } }));
  await assert.rejects(runtime.attendanceReviewDecision.delete({ where: { id: decision.id } }));
  const { id, ...data } = decision;
  await assert.rejects(runtime.attendanceReviewDecision.create({ data }), { code: 'P2002' });
  await assert.rejects(runtime.attendanceReviewDecision.create({ data: { ...data, revisionId: randomUUID() } }), { code: 'P2003' });
  const other = await attendanceFixture();
  await expectStatus(204, other.path, other.submit());
  const otherRevision = (await historyRead(other)).items[0];
  await assert.rejects(runtime.attendanceReviewDecision.create({ data: { ...data, revisionId: otherRevision.id, adminId: randomUUID() } }), { code: 'P2003' });
  for (const reason of ['', ' \n\t ', 'x'.repeat(1001)]) {
    await assert.rejects(runtime.attendanceReviewDecision.create({ data: { ...data, revisionId: otherRevision.id, reason } }));
  }
  await assert.rejects(migrator.attendanceRevision.delete({ where: { id: decision.revisionId } }), { code: 'P2003' });
  for (const role of ['studio_reporting', 'studio_worker']) {
    await assert.rejects(migrator.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE ' + role);
      await tx.$queryRaw`SELECT id FROM attendance_review_decision`;
    }));
  }
  assert.deepEqual(await migrator.attendanceReviewDecision.findUniqueOrThrow({ where: { id } }), decision);
});

test('return migration upgrades the merged attendance baseline without changing original submissions', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'studio-attendance-return-upgrade-'));
  const upgradeName = 'studio_attendance_upgrade_' + randomBytes(6).toString('hex');
  const { api, migration } = disposableUrls();
  api.pathname = migration.pathname = '/' + upgradeName;
  const schema = join(scratch, 'schema.prisma');
  const migrations = join(prismaDirectory, 'migrations');
  const copy = name => cpSync(join(migrations, name), join(scratch, 'migrations', name), { recursive: true });
  let db, databaseCreated = false;
  try {
    cpSync(join(prismaDirectory, 'schema.prisma'), schema);
    mkdirSync(join(scratch, 'migrations'));
    for (const name of readdirSync(migrations)) {
      if (name <= '20261117000100_attendance_submission' || name === 'migration_lock.toml') copy(name);
    }
    await owner.$executeRawUnsafe(`CREATE DATABASE "${upgradeName}"`);
    databaseCreated = true;
    deployMigrations(api, migration, schema);
    db = new PrismaClient({ datasourceUrl: migration.href });
    const admin = await db.user.create({ data: { normalizedEmail: 'attendance-upgrade-admin@example.invalid', role: 'ADMIN', accountState: 'ACTIVE' } });
    const client = await db.clientProfile.create({ data: { displayName: 'Upgrade participant', user: { create: {
      normalizedEmail: 'attendance-upgrade-client@example.invalid', role: 'CLIENT', accountState: 'ACTIVE',
    } } } });
    const coach = await db.coachProfile.create({ data: { displayName: 'Upgrade coach', user: { create: {
      normalizedEmail: 'attendance-upgrade-coach@example.invalid', role: 'COACH', accountState: 'ACTIVE',
    } } } });
    const type = await db.sessionType.create({ data: { code: 'ATTENDANCE-UPGRADE', name: 'Upgrade attendance', mode: 'GROUP' } });
    const membership = await bookingMembership(db, admin.id, client.userId, type.id);
    const startsAt = new Date(Date.now() - 3600_000);
    const session = await db.scheduledSession.create({ data: {
      sessionTypeId: type.id, coachId: coach.userId, startsAt, endsAt: new Date(+startsAt + 1800_000), bufferMinutes: 0, capacity: 2,
    } });
    const booking = await db.booking.create({ data: {
      clientId: client.userId, membershipId: membership.id, scheduledSessionId: session.id, status: 'CONFIRMED',
    } });
    const attendance = await db.sessionAttendance.create({ data: {
      scheduledSessionId: session.id, servedCoachId: coach.userId, servedStartsAt: startsAt, servedSessionTypeId: type.id,
    } });
    const participant = await db.attendanceParticipant.create({ data: { bookingId: booking.id, scheduledSessionId: session.id } });
    const revision = await db.attendanceRevision.create({ data: {
      bookingId: booking.id, revision: 1, outcome: 'ATTENDED', submittedById: coach.userId, submittedAt: startsAt,
    } });
    const [baseline] = await db.$queryRaw`SELECT to_regclass('public.attendance_review_decision')::text AS review`;
    assert.equal(baseline.review, null);
    copy('20261123000100_attendance_return_reaffirmation');
    deployMigrations(api, migration, schema);
    deployMigrations(api, migration, schema);
    assert.deepEqual(await db.attendanceRevision.findUniqueOrThrow({ where: { id: revision.id } }), revision);
    assert.deepEqual(await db.attendanceParticipant.findUniqueOrThrow({ where: { bookingId: booking.id } }), participant);
    assert.deepEqual(await db.sessionAttendance.findUniqueOrThrow({ where: { scheduledSessionId: session.id } }), attendance);
    assert.deepEqual(await db.membership.findUniqueOrThrow({ where: { id: membership.id } }), membership);
    assert.deepEqual(await db.booking.findUniqueOrThrow({ where: { id: booking.id } }), booking);
    assert.equal(await db.attendanceReviewDecision.count(), 0);
    const [{ canInsert, canUpdate, canDelete }] = await db.$queryRaw`SELECT
      has_table_privilege('studio_api', 'attendance_review_decision', 'INSERT') AS "canInsert",
      has_table_privilege('studio_api', 'attendance_review_decision', 'UPDATE') AS "canUpdate",
      has_table_privilege('studio_api', 'attendance_review_decision', 'DELETE') AS "canDelete"`;
    assert.deepEqual({ canInsert, canUpdate, canDelete }, { canInsert: true, canUpdate: false, canDelete: false });
  } finally {
    await db?.$disconnect();
    if (databaseCreated) await owner.$executeRawUnsafe(`DROP DATABASE "${upgradeName}" WITH (FORCE)`);
    rmSync(scratch, { recursive: true, force: true });
  }
});


test('S1-A retries every audited stage after rollback and response loss without duplicates or implicit activation', async () => {
  const offer = await acceptanceOffer('20.00');
  const acceptance = acceptanceRequest(offer);
  const recording = paymentRequest({ amount: '20.00' });
  let purchaseId, paymentId;
  const stages = [
    ['PURCHASE_ACCEPTED_RECORDED', () => [positivePricePath, acceptance], result => { purchaseId = result.purchaseId; }],
    ['PAYMENT_RECORDED', () => [paymentPath, recording], result => { paymentId = result.paymentId; }],
    ['PAYMENT_VERIFIED', () => [verifyPaymentPath(paymentId), adminWrite()], () => {}],
    ['PAYMENT_ALLOCATED', () => [allocationPath(paymentId), allocationRequest(purchaseId, '20.00')], () => {}],
    ['MEMBERSHIP_ACTIVATED', () => [activationPath(purchaseId), adminWrite({})], () => {}],
  ];
  for (const [action, args, receive] of stages) {
    const [path, options] = args();
    const status = ['PAYMENT_VERIFIED', 'MEMBERSHIP_ACTIVATED'].includes(action) ? 200 : 201;
    const before = await Promise.all([migrator.purchase.count(), migrator.payment.count(), migrator.paymentAllocation.count(), migrator.membership.count(), migrator.idempotencyKey.count()]);
    await migrator.$executeRawUnsafe(`ALTER TABLE audit_log ADD CONSTRAINT s1a_reject_stage CHECK (action <> '${action}') NOT VALID`);
    try {
      await expectStatus(500, path, options);
      assert.deepEqual(await Promise.all([migrator.purchase.count(), migrator.payment.count(), migrator.paymentAllocation.count(), migrator.membership.count(), migrator.idempotencyKey.count()]), before);
    } finally { await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT s1a_reject_stage`; }
    const result = await expectStatus(status, path, options); receive(result);
    // An acknowledged command may have lost its HTTP response: replay its exact original intent.
    assert.deepEqual(await expectStatus(status, path, options), result);
    if (action !== 'MEMBERSHIP_ACTIVATED') assert.equal(await migrator.membership.count({ where: { purchaseId } }), 0);
  }
  const events = await expectStatus(200, `/purchases/${purchaseId}/audit`, adminRead());
  assert.deepEqual(events.items.map(x => x.action).sort(), stages.map(x => x[0]).sort());
  assert.equal(await migrator.payment.count({ where: { intakeId: recording.body.intakeId } }), 1);
  assert.equal(await migrator.paymentAllocation.count({ where: { purchaseId } }), 1);
  assert.equal((await migrator.membership.findUniqueOrThrow({ where: { purchaseId } })).status, 'ACTIVE');
});

test('S1-A freezes terms, rejects inactive Clients and serializes different receipts against the final purchase amount', async () => {
  const offer = await acceptanceOffer('25.00');
  assert.equal((await expectStatus(409, positivePricePath, acceptanceRequest(offer, { clientId: users.disabled.id }))).code, 'CLIENT_NOT_ACTIVE');
  const { purchaseId } = await expectStatus(201, positivePricePath, acceptanceRequest(offer));
  const [one, two] = await Promise.all([verifiedPayment(), verifiedPayment()]);
  const results = await Promise.all([request(allocationPath(one.id), allocationRequest(purchaseId, '20.00')),
    request(allocationPath(two.id), { ...allocationRequest(purchaseId, '20.00'), access: sessions.raceAdmin.accessToken })]);
  assert.deepEqual(results.map(x => x.status).sort(), [201,409]);
  assert.equal((await results.find(x => x.status === 409).json()).code, 'PAYMENT_ALLOCATION_EXCEEDS_PURCHASE_PRICE');
  assert.equal((await migrator.paymentAllocation.aggregate({ where: { purchaseId }, _sum: { amount: true } }))._sum.amount.toFixed(2), '20.00');
  assert.equal((await expectStatus(200, fundingPath(purchaseId), adminRead())).remainingAmount, '5.00');
  const { versionId } = await expectStatus(201, offer.path + '/versions', adminWrite({ expectedCurrentVersionId: offer.packageVersionId, terms: { ...offer.terms, price: '100.00' } }));
  await expectStatus(204, `${offer.path}/versions/${versionId}/publish`, adminWrite({ expectedCurrentVersionId: offer.packageVersionId, expectedDraftRevision: 1 }));
  await expectStatus(409, allocationPath(one.id), allocationRequest(purchaseId, '5.01'));
  assert.equal((await expectStatus(200, fundingPath(purchaseId), adminRead())).purchasePrice, '25.00');
});

test('S1-A audit requires both permissions, scopes shared receipts and preserves exact cursor ordering', async t => {
  const { purchaseId } = await allocationPurchase();
  const { purchaseId: other } = await allocationPurchase();
  const receipt = await verifiedPayment();
  const { allocationId } = await expectStatus(201, allocationPath(receipt.id), allocationRequest(purchaseId, '5.00'));
  const unrelated = await expectStatus(201, allocationPath(receipt.id), allocationRequest(other, '5.00'));
  const path = `/purchases/${purchaseId}/audit`;
  await expectStatus(401, path);
  for (const actor of ['staff','coach','client','clientManager']) await expectStatus(403, path, { access: sessions[actor].accessToken });
  await expectStatus(404, `/purchases/${randomUUID()}/audit`, adminRead());
  for (const query of ['?limit=0','?limit=51','?unexpected=1',`?after=${randomUUID()}`]) await expectStatus(400, path+query, adminRead());
  // Identical millisecond timestamps with distinct microseconds exercise lossless cursor comparisons.
  await migrator.$executeRaw`UPDATE audit_log SET created_at = '2026-01-01 00:00:00.000123+00' WHERE target_id = ${receipt.id}::uuid`;
  const expected = await expectStatus(200, path, adminRead());
  const collected = []; let after;
  do {
    const page = await expectStatus(200, path+'?limit=1'+(after ? '&after='+after : ''), adminRead());
    collected.push(...page.items); after = page.nextCursor;
  } while (after);
  assert.deepEqual(collected, expected.items);
  assert.equal(new Set(collected.map(x=>x.id)).size, collected.length);
  assert(collected.some(x=>x.targetId === allocationId));
  assert(!collected.some(x=>x.targetId === other || x.targetId === unrelated.allocationId));
  assert(collected.every(x=>!('details' in x) && !('redactedDetails' in x)));
  const security = app.get(Sessions), original = security.authorize.bind(security);
  t.mock.method(security, 'authorize', async (tx, access, actions) => {
    if (actions.length === 1 && actions[0] === 'audit.read') throw require('../dist/platform/http').failure(403,'FORBIDDEN');
    return original(tx, access, actions);
  });
  await expectStatus(403, path, adminRead());
});



async function maintenanceClient(displayName = 'Maintenance Client') {
  return migrator.user.create({ data: {
    normalizedEmail: randomUUID() + '@maintenance.example', role: 'CLIENT', accountState: 'ACTIVE',
    passwordHash: await hashPassword(password), emailVerifiedAt: new Date(), client: { create: { displayName } },
  } });
}
function profileWrite(displayName, expectedDisplayName, overrides = {}) {
  return { method: 'PATCH', access: sessions.admin.accessToken, key: randomUUID(),
    body: { displayName, expectedDisplayName }, ...overrides };
}
const profileAudits = id => migrator.auditLog.findMany({ where: { action: 'CLIENT_PROFILE_UPDATED', targetId: id } });

test('S1-B1 Admin edits only displayName, preserves identity, and replays the original audited outcome', async () => {
  const client = await maintenanceClient();
  const path = '/clients/' + client.id;
  const initial = await migrator.clientProfile.findUniqueOrThrow({ where: { userId: client.id } });
  const options = profileWrite('  اسم العميل  ', initial.displayName);
  const first = await request(path, options);
  assert.equal(first.status, 204);
  const events = await profileAudits(client.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].actorId, users.admin.id);
  assert.equal(events[0].targetType, 'USER');
  assert.equal(events[0].requestId, first.headers.get('x-request-id'));
  assert.deepEqual(events[0].redactedDetails, { fields: ['displayName'] });
  assert(events[0].createdAt instanceof Date);
  assert.deepEqual(await migrator.user.findUniqueOrThrow({ where: { id: client.id } }), client);
  assert.deepEqual(await migrator.clientProfile.findUniqueOrThrow({ where: { userId: client.id } }), { ...initial, displayName: 'اسم العميل' });
  const detail = await expectStatus(200, path, { access: sessions.admin.accessToken });
  assert.equal(detail.displayName, 'اسم العميل');
  assert.equal((await expectStatus(200, '/clients?' + new URLSearchParams({ q: 'اسم العميل' }), { access: sessions.admin.accessToken })).items[0].id, client.id);
  await expectStatus(204, path, options);
  await expectStatus(204, path, profileWrite('Later name', 'اسم العميل'));
  // Successful retries return the original outcome even after another authorized edit.
  await expectStatus(204, path, options);
  assert.equal((await migrator.clientProfile.findUniqueOrThrow({ where: { userId: client.id } })).displayName, 'Later name');
  assert.equal((await profileAudits(client.id)).length, 2);
  await expectStatus(409, path, { ...options, body: { ...options.body, displayName: 'Changed payload' } });
  await migrator.idempotencyKey.updateMany({ where: { actorId: users.admin.id, operation: 'client.profile.update', key: options.key }, data: { expiresAt: new Date(0) } });
  assert.equal((await expectStatus(409, path, options)).code, 'IDEMPOTENCY_KEY_EXPIRED');
  await assert.rejects(runtime.$executeRaw`UPDATE audit_log SET request_id = 'overwrite' WHERE target_id = ${client.id}::uuid`);
});

test('S1-B1 denies non-Admin writes, invalid inputs and non-Client targets without successful retry records', async () => {
  const client = await maintenanceClient();
  const path = '/clients/' + client.id;
  const keys = await migrator.idempotencyKey.count({ where: { operation: 'client.profile.update' } });
  await expectStatus(401, path, profileWrite('New', 'Maintenance Client', { access: undefined }));
  await expectStatus(204, `/staff-grants/${users.clientManager.id}/client.manage`, grantOptions(true));
  for (const actor of ['clientManager', 'staff', 'coach', 'client']) {
    await expectStatus(403, path, profileWrite('New', 'Maintenance Client', { access: sessions[actor].accessToken }));
  }
  await expectStatus(200, path, { access: sessions.clientManager.accessToken });
  await expectStatus(204, `/staff-grants/${users.clientManager.id}/client.manage`, grantOptions(false));
  const valid = { displayName: 'New', expectedDisplayName: 'Maintenance Client' };
  for (const body of [{}, { ...valid, displayName: '' }, { ...valid, displayName: '  ' }, { ...valid, displayName: 'x'.repeat(121) },
    { ...valid, displayName: 'control' + String.fromCharCode(0) }, { ...valid, expectedDisplayName: null },
    { ...valid, email: 'different@example.invalid' }, { ...valid, role: 'ADMIN' }, { ...valid, accountState: 'ACTIVE' }]) {
    await expectStatus(400, path, { ...profileWrite('New', 'Maintenance Client'), body });
  }
  await expectStatus(400, path + '?unexpected=1', profileWrite('New', 'Maintenance Client'));
  await expectStatus(400, path, profileWrite('New', 'Maintenance Client', { key: undefined }));
  for (const id of [users.admin.id, users.coach.id, users.missingProfile.id, randomUUID()]) {
    assert.equal((await expectStatus(404, '/clients/' + id, profileWrite('New', 'Any'))).code, 'CLIENT_NOT_FOUND');
  }
  assert.equal(await migrator.idempotencyKey.count({ where: { operation: 'client.profile.update' } }), keys);
  assert.equal((await profileAudits(client.id)).length, 0);
  assert.equal((await migrator.clientProfile.findUniqueOrThrow({ where: { userId: client.id } })).displayName, 'Maintenance Client');
  // Narrow runtime privileges cannot insert/delete profiles, reassign their User or change credentials.
  for (const sql of [
    `INSERT INTO client_profile (user_id, display_name) VALUES ('${users.missingProfile.id}', 'Forbidden')`,
    `DELETE FROM client_profile WHERE user_id = '${client.id}'`,
    `UPDATE client_profile SET user_id = '${randomUUID()}' WHERE user_id = '${client.id}'`,
    `UPDATE client_profile SET created_at = now() WHERE user_id = '${client.id}'`,
    `UPDATE app_user SET normalized_email = 'forbidden@example.invalid' WHERE id = '${client.id}'`,
    `UPDATE app_user SET password_hash = 'forbidden' WHERE id = '${client.id}'`,
  ]) await assert.rejects(runtime.$executeRawUnsafe(sql), /permission denied/);
});

test('S1-B1 serializes competing edits and concurrent retries without duplicate evidence', async () => {
  const client = await maintenanceClient();
  const path = '/clients/' + client.id;
  const attempts = [profileWrite('Winner A', 'Maintenance Client'), profileWrite('Winner B', 'Maintenance Client', { access: sessions.raceAdmin.accessToken })];
  const responses = await Promise.all(attempts.map(options => request(path, options)));
  assert.deepEqual(responses.map(res => res.status).sort(), [204, 409]);
  assert.equal((await responses.find(res => res.status === 409).json()).code, 'CLIENT_PROFILE_CHANGED');
  assert.equal((await profileAudits(client.id)).length, 1);
  const row = await migrator.clientProfile.findUniqueOrThrow({ where: { userId: client.id } });
  const retry = profileWrite('Same request', row.displayName);
  assert.deepEqual((await Promise.all([request(path, retry), request(path, retry)])).map(res => res.status), [204, 204]);
  assert.equal((await profileAudits(client.id)).length, 2);
  // An exact-value precondition preserves legacy whitespace, and a no-op has no extra change event.
  await migrator.clientProfile.update({ where: { userId: client.id }, data: { displayName: ' legacy ' } });
  await expectStatus(409, path, profileWrite('Repaired', 'legacy'));
  await expectStatus(204, path, profileWrite('Repaired', ' legacy '));
  await expectStatus(204, path, profileWrite('Repaired', 'Repaired'));
  assert.equal((await profileAudits(client.id)).length, 3);
});

test('S1-B1 rolls back name and idempotency on audit failure and rechecks current authority on replay', async () => {
  const client = await maintenanceClient();
  const path = '/clients/' + client.id, options = profileWrite('Updated', 'Maintenance Client');
  await migrator.$executeRaw`ALTER TABLE audit_log ADD CONSTRAINT s1b1_reject_profile_audit CHECK (action <> 'CLIENT_PROFILE_UPDATED') NOT VALID`;
  try {
    await expectStatus(500, path, options);
    assert.equal((await migrator.clientProfile.findUniqueOrThrow({ where: { userId: client.id } })).displayName, 'Maintenance Client');
    assert.equal((await profileAudits(client.id)).length, 0);
    assert.equal(await migrator.idempotencyKey.count({ where: { operation: 'client.profile.update', key: options.key } }), 0);
  } finally { await migrator.$executeRaw`ALTER TABLE audit_log DROP CONSTRAINT s1b1_reject_profile_audit`; }
  await expectStatus(204, path, options);
  const admin = await migrator.user.create({ data: { normalizedEmail: randomUUID() + '@maintenance.example',
    role: 'ADMIN', accountState: 'ACTIVE', passwordHash: await hashPassword(password), emailVerifiedAt: new Date() } });
  const session = await app.get(Sessions).login(admin.normalizedEmail, password);
  const other = profileWrite('Another update', 'Updated', { access: session.accessToken });
  await expectStatus(204, path, other);
  await migrator.user.update({ where: { id: admin.id }, data: { role: 'STAFF' } });
  await expectStatus(403, path, other);
  await migrator.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
  await migrator.authSession.updateMany({ where: { userId: admin.id }, data: { revokedAt: new Date() } });
  await expectStatus(401, path, other);
});

test('S1-B1 keeps an edited Client eligible for S1-A and disablement preserves all commercial records', async () => {
  const client = await maintenanceClient();
  await expectStatus(204, '/clients/' + client.id, profileWrite('Commercial client', 'Maintenance Client'));
  const offer = await acceptanceOffer('20.00');
  const { purchaseId } = await expectStatus(201, positivePricePath, acceptanceRequest(offer, { clientId: client.id }));
  const { paymentId } = await expectStatus(201, paymentPath, paymentRequest({ clientId: client.id, amount: '20.00' }));
  await expectStatus(200, verifyPaymentPath(paymentId), adminWrite());
  await expectStatus(201, allocationPath(paymentId), allocationRequest(purchaseId, '20.00'));
  assert.equal(await migrator.membership.count({ where: { purchaseId } }), 0);
  await expectStatus(200, activationPath(purchaseId), adminWrite({}));
  const before = await Promise.all([migrator.purchase.findUniqueOrThrow({ where: { id: purchaseId } }), migrator.payment.findUniqueOrThrow({ where: { id: paymentId } }),
    migrator.paymentAllocation.findMany({ where: { purchaseId } }), migrator.membership.findUniqueOrThrow({ where: { purchaseId } })]);
  const session = await app.get(Sessions).login(client.normalizedEmail, password);
  const disable = adminWrite();
  await expectStatus(204, '/users/' + client.id + '/disable', disable);
  await expectStatus(204, '/users/' + client.id + '/disable', disable);
  await expectStatus(401, '/me', { access: session.accessToken });
  assert.deepEqual(await Promise.all([migrator.purchase.findUniqueOrThrow({ where: { id: purchaseId } }), migrator.payment.findUniqueOrThrow({ where: { id: paymentId } }),
    migrator.paymentAllocation.findMany({ where: { purchaseId } }), migrator.membership.findUniqueOrThrow({ where: { purchaseId } })]), before);
  assert.equal(await migrator.auditLog.count({ where: { targetId: client.id, action: 'ACCOUNT_DISABLED' } }), 1);
  assert.equal((await migrator.clientProfile.findUniqueOrThrow({ where: { userId: client.id } })).displayName, 'Commercial client');
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
