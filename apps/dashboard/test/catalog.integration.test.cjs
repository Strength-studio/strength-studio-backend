const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:net');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const { startApp } = require('../../backend/dist/app.js');
const { loadConfig } = require('../../backend/dist/platform/config.js');
const { hashPassword } = require('../../backend/dist/identity/password.js');

const fixturePassword = 'dashboard integration only passphrase';
const dbName = 'studio_dashboard_test_' + randomBytes(6).toString('hex');
const roles = {
  admin: ['ADMIN'], noGrant: ['STAFF'], reader: ['STAFF', 'CATALOG_READ'],
  manager: ['STAFF', 'CATALOG_MANAGE'], auditor: ['STAFF', 'CATALOG_MANAGE', 'AUDIT_READ'],
  auditOnly: ['STAFF', 'AUDIT_READ'], client: ['CLIENT'], coach: ['COACH'],
};
const userPrefix = 'catalog-test-' + randomBytes(5).toString('hex');
const email = name => userPrefix + '-' + name.toLowerCase() + '@example.invalid';
let control, fixture, api, dashboard, origin, created = false, exited;

function localUrls() {
  assert.ok(['test', 'development'].includes(process.env.NODE_ENV), 'Use a local test or development environment');
  const runtime = new URL(process.env.DATABASE_URL);
  const owner = new URL(process.env.MIGRATION_DATABASE_URL);
  for (const url of [runtime, owner]) {
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'Only loopback PostgreSQL is supported');
    assert.equal(url.pathname, '/strength_studio', 'Use the documented local database');
  }
  assert.equal(owner.host, runtime.host);
  assert.equal(runtime.username, 'studio_api');
  assert.notEqual(owner.username, runtime.username);
  return { runtime, owner };
}

before(async () => {
  const { runtime, owner } = localUrls();
  const template = new PrismaClient({ datasourceUrl: owner.href });
  try {
    const [row] = await template.$queryRaw`SELECT to_regclass('public.package_version') IS NOT NULL AS available`;
    assert.ok(row.available, 'The local template must already contain the catalog schema. This test does not migrate databases.');
  } finally { await template.$disconnect(); }
  const controlUrl = new URL(owner);
  controlUrl.pathname = '/postgres';
  control = new PrismaClient({ datasourceUrl: controlUrl.href });
  await control.$executeRawUnsafe(`CREATE DATABASE "${dbName}" TEMPLATE "strength_studio"`);
  created = true;
  owner.pathname = '/' + dbName;
  runtime.pathname = '/' + dbName;
  fixture = new PrismaClient({ datasourceUrl: owner.href });
  const passwordHash = await hashPassword(fixturePassword);
  let adminId;
  for (const [key, [role, ...grants]] of Object.entries(roles)) {
    const user = await fixture.user.create({ data: {
      normalizedEmail: email(key), role, accountState: 'ACTIVE', passwordHash, emailVerifiedAt: new Date(),
      ...(role === 'CLIENT' ? { client: { create: { displayName: key } } } : {}),
      ...(role === 'COACH' ? { coach: { create: { displayName: key } } } : {}),
    } });
    if (role === 'ADMIN') adminId = user.id;
    if (grants.length) await fixture.staffGrant.createMany({ data: grants.map(permission => ({
      permission, staffUserId: user.id, changedById: adminId,
    })) });
  }

  const socket = createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  origin = 'http://127.0.0.1:' + port;
  api = await startApp({ ...loadConfig({ ...process.env, DATABASE_URL: runtime.href, DASHBOARD_ORIGIN: origin }),
    host: '127.0.0.1', port: 0 });
  const project = resolve(__dirname, '..');
  dashboard = spawn(process.execPath, [resolve(project, 'node_modules/next/dist/bin/next'), 'start',
    '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: project, env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', DASHBOARD_ORIGIN: origin,
      API_BASE_URL: await api.getUrl(), DASHBOARD_CSRF_KEY: randomBytes(32).toString('hex') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  exited = once(dashboard, 'exit');
  let stderr = '';
  dashboard.stderr.on('data', chunk => { stderr += chunk; });
  const end = Date.now() + 8000;
  while (Date.now() < end && dashboard.exitCode === null) {
    if ((await fetch(origin, { signal: AbortSignal.timeout(1000) }).catch(() => null))?.ok) return;
    await delay(100);
  }
  assert.fail('Dashboard did not start: ' + stderr);
});

after(async () => {
  if (dashboard && dashboard.exitCode === null) dashboard.kill('SIGTERM');
  await exited;
  await api?.close();
  await fixture?.$disconnect();
  if (created) await control.$executeRawUnsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
  await control?.$disconnect();
});

async function signIn(name) {
  const result = await fetch(origin + '/api/session/login', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email(name), password: fixturePassword }),
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true });
  const cookies = result.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) assert.match(cookie, /httponly/i);
  const cookie = cookies.map(value => value.split(';', 1)[0]).join('; ');
  const csrf = await fetch(origin + '/api/session/csrf', { headers: { cookie } });
  assert.equal(csrf.status, 200);
  return { cookie, csrf: (await csrf.json()).csrfToken };
}

async function relay(actor, status, route, options = {}) {
  const { method = 'GET', payload, key = randomUUID(), csrf = actor.csrf, source = origin, headers = {} } = options;
  const response = await fetch(origin + '/api/studio/v1/' + route, {
    method,
    headers: { cookie: actor.cookie, ...(method !== 'GET' ? { origin: source, 'x-csrf-token': csrf, 'idempotency-key': key } : {}),
      ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const raw = await response.text();
  assert.equal(response.status, status, route + ': ' + raw);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('authorization'), null);
  assert(!/accessToken|refreshToken|__Host-ss_/.test(raw), 'Tokens must stay server-side');
  for (const part of actor.cookie.split('; ')) assert(!raw.includes(part.split('=')[1]));
  return raw ? JSON.parse(raw) : null;
}

test('catalog relay keeps origin, CSRF, route and input boundaries', async () => {
  await relay({ cookie: '' }, 401, 'packages');
  const admin = await signIn('admin');
  await relay(admin, 404, 'admin/commissions');
  await relay(admin, 404, 'auth/login', { method: 'POST', payload: {} });
  await relay(admin, 404, 'packages%2fmanagement');
  await relay(admin, 404, 'packages', { method: 'PATCH', payload: {} });
  await relay(admin, 400, 'packages?limit=2&limit=3');
  await relay(admin, 400, 'packages?upstream=http%3A%2F%2Flocalhost');
  const post = { method: 'POST', payload: {} };
  await relay(admin, 403, 'packages', { ...post, source: 'https://example.invalid' });
  await relay(admin, 403, 'packages', { ...post, csrf: '' });
  await relay(admin, 403, 'packages/' + randomUUID() + '/versions/' + randomUUID(), { ...post, method: 'PATCH', csrf: 'bad' });
  assert.equal((await relay(admin, 400, 'packages', { ...post, key: '' })).code, 'INVALID_IDEMPOTENCY_KEY');
  assert.equal((await relay(admin, 400, 'packages', { ...post, payload: [] })).code, 'INVALID_INPUT');
  await relay(admin, 413, 'packages', { ...post, payload: { description: 'x'.repeat(17_000) } });
});

test('real catalog commands preserve roles, history and conflict codes through the dashboard relay', async () => {
  const actors = [];
  for (const role of Object.keys(roles)) actors.push(await signIn(role));
  const [admin, staff, reader, manager, auditor, auditOnly, client, coach] = actors;
  const post = payload => ({ method: 'POST', payload });
  for (const actor of [staff, reader, auditOnly, client, coach]) await relay(actor, 403, 'packages/management');
  const adminAccess = admin.cookie.split('; ').find(cookie => cookie.startsWith('__Host-ss_access=')).split('=')[1];
  await relay(staff, 403, 'packages/management', { headers: { Authorization: 'Bearer ' + adminAccess } });
  await relay(reader, 200, 'packages?limit=1');
  await relay(manager, 403, 'packages');
  await relay(manager, 403, 'session-types');
  await relay(manager, 403, 'session-types', post({ code: 'STAFF-TYPE', name: 'Denied', mode: 'GROUP' }));
  const code = 'DASH-' + randomBytes(4).toString('hex').toUpperCase();
  const { sessionTypeId } = await relay(admin, 201, 'session-types', post({ code, name: 'Dashboard training', mode: 'INDIVIDUAL' }));
  await relay(manager, 403, 'session-types/' + sessionTypeId + '/archive', post({}));
  const terms = { code, name: 'Dashboard package', description: '', price: '159.50', kind: 'SESSION',
    validityDays: 30, sessionAllowance: 10, sessionTypeIds: [sessionTypeId] };
  await relay(staff, 403, 'packages', post(terms));
  await relay(manager, 403, 'packages', { ...post(terms), csrf: admin.csrf });
  await relay(client, 403, 'packages', post(terms));
  await relay(coach, 403, 'packages', post(terms));
  const create = { ...post(terms), key: randomUUID() };
  const { packageId } = await relay(admin, 201, 'packages', create);
  assert.deepEqual(await relay(admin, 201, 'packages', create), { packageId });
  const path = 'packages/' + packageId;
  const { items: [draft] } = await relay(manager, 200, path + '/management');
  const version = path + '/versions/' + draft.id;
  await relay(client, 404, version);
  await relay(auditOnly, 403, path + '/management/audit');
  await relay(manager, 403, path + '/management/audit');
  assert.equal((await relay(auditor, 200, path + '/management/audit')).items[0].action, 'CATALOG_CREATED');
  await relay(admin, 204, version, { method: 'PATCH', payload: { expectedDraftRevision: 1, price: '200.00' } });
  assert.equal((await relay(manager, 409, version, { method: 'PATCH', payload: { expectedDraftRevision: 1, name: 'Stale edit' } })).code,
    'CATALOG_DRAFT_CHANGED');
  assert.equal((await relay(manager, 200, path + '/management')).items[0].draftRevision, 2);
  await relay(manager, 204, version + '/publish', post({ expectedDraftRevision: 2, expectedCurrentVersionId: null }));
  await relay(client, 200, version);
  assert.equal((await relay(admin, 409, version, { method: 'PATCH', payload: { expectedDraftRevision: 2, name: 'Issued edit' } })).code,
    'CATALOG_VERSION_ISSUED');
  const { versionId } = await relay(manager, 201, path + '/versions', post({ expectedCurrentVersionId: draft.id, terms: null }));
  const successor = path + '/versions/' + versionId;
  await relay(manager, 204, successor, { method: 'PATCH', payload: { expectedDraftRevision: 1, price: '0.00' } });
  const publish = post({ expectedDraftRevision: 2, expectedCurrentVersionId: draft.id });
  await relay(manager, 403, successor + '/publish', publish);
  await relay(admin, 204, successor + '/publish', publish);
  await relay(admin, 204, path + '/archive', post({ expectedCurrentVersionId: versionId, reason: 'Dashboard integration test' }));
  assert.equal((await relay(admin, 409, path + '/versions', post({ expectedCurrentVersionId: versionId, terms: null }))).code,
    'CATALOG_PACKAGE_ARCHIVED');
  await relay(admin, 409, successor + '/publish', publish);
  assert.equal((await relay(admin, 409, successor, { method: 'PATCH', payload: {
    expectedDraftRevision: 2, name: 'Archived edit',
  } })).code, 'CATALOG_PACKAGE_ARCHIVED');
  await relay(client, 404, successor);
  const history = await relay(auditor, 200, path + '/management/audit');
  assert(history.items.some(event => event.reason === 'Dashboard integration test'));
  await relay(admin, 204, 'session-types/' + sessionTypeId + '/archive', post({}));
  assert(!(await relay(admin, 200, 'session-types')).items.some(type => type.id === sessionTypeId));
  assert((await relay(admin, 200, path + '/management')).items.some(item => item.sessionTypes.some(type => type.id === sessionTypeId)));
});

test('catalog relay returns a safe service unavailable response when the backend stops', async () => {
  const admin = await signIn('admin');
  await api.close();
  api = undefined;
  assert.equal((await relay(admin, 503, 'packages')).code, 'DASHBOARD_UNAVAILABLE');
});
