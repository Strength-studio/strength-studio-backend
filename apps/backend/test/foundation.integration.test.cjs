const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { randomBytes, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { cpSync, mkdirSync, mkdtempSync, rmSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient, Role, AccountState, TokenPurpose } = require('@prisma/client');
const { io } = require('socket.io-client');
const { startApp } = require('../dist/app.js');
const { loadConfig } = require('../dist/platform/config.js');
const { hashPassword } = require('../dist/identity/password.js');
const { digest, Sessions } = require('../dist/identity/session.service.js');

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
    host: '127.0.0.1', port: 0, socketRecheckMs: 200 });
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
  await expectStatus(400, '/users/invite', { method: 'POST', access: sessions.staff.accessToken,
    body: { email: 'invite@studio.example', displayName: 'Invite', role: 'ADMIN', grants: ['payment.verify'] } });
  assert.equal((await expectStatus(409, '/users/invite', { method: 'POST', access: sessions.staff.accessToken,
    body: { email: 'invite@studio.example', displayName: 'Invite' } })).code, 'ONBOARDING_POLICY_PENDING');
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
      AND table_name IN ('finance_account', 'allocation', 'payment_allocation', 'receivable',
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

test('payment migration preserves historical purchase records and replay from the accepted baseline', async () => {
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
      where: { id: paidId }, include: { acceptance: true, membership: true },
    });
    const paidBefore = await paidPurchase();
    const paidAudit = await upgradeDb.auditLog.findFirstOrThrow({ where: { targetType: 'PURCHASE', targetId: paidId } });
    const paidRetry = await upgradeDb.idempotencyKey.findFirstOrThrow({ where: { operation: positivePriceOperation, key: paidKey } });
    await upgradeApp.close();
    upgradeApp = undefined;

    deployMigrations(api, migration);
    deployMigrations(api, migration);
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
    assert.deepEqual(purchase.membership, { id: membershipId, purchaseId: purchase.id, createdAt: acceptedAt, status: 'PENDING_ACTIVATION' });
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
    ]), [2, 2, 1, 2, 2, 0]);

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
      AND table_name IN ('finance_account', 'allocation', 'payment_allocation', 'receivable', 'installment',
        'finance_event', 'revenue', 'credit_lot', 'refund', 'entitlement_entry')`, []);
  assert.deepEqual(await migrator.$queryRaw`
    SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'payment'
      AND column_name IN ('purchase_id', 'allocated_at', 'verified_at')`, []);
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
  for (const suffix of ['verify', 'allocate']) {
    await expectStatus(404, `${paymentPath}/${payment.id}/${suffix}`, { ...write, body: {} });
  }
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
