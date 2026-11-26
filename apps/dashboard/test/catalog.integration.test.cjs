const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { request: httpRequest } = require('node:http');
const { createServer } = require('node:net');
const { resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const { startApp } = require('../../backend/dist/app.js');
const { loadConfig } = require('../../backend/dist/platform/config.js');
const { hashPassword } = require('../../backend/dist/identity/password.js');
const { withChrome } = require('./chrome.cjs');

const fixturePassword = 'dashboard integration only passphrase';
const dbName = 'studio_dashboard_test_' + randomBytes(6).toString('hex');
const roles = {
  admin: ['ADMIN'], noGrant: ['STAFF'], reader: ['STAFF', 'CATALOG_READ'],
  manager: ['STAFF', 'CATALOG_MANAGE'], auditor: ['STAFF', 'CATALOG_MANAGE', 'AUDIT_READ'],
  auditOnly: ['STAFF', 'AUDIT_READ'], client: ['CLIENT'], coach: ['COACH'],
  clientManager: ['STAFF', 'CLIENT_MANAGE'], clientSecond: ['CLIENT'], clientPending: ['CLIENT'],
};
const userPrefix = 'catalog-test-' + randomBytes(5).toString('hex');
const email = name => userPrefix + '-' + name.toLowerCase() + '@example.invalid';
const clientName = key => userPrefix + ' ' + key;
let control, fixture, api, dashboard, origin, created = false, exited;
let upstreamRequests = 0;
const signedIn = new Map();

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
    const pending = key === 'clientPending';
    const user = await fixture.user.create({ data: {
      normalizedEmail: email(key), role, accountState: pending ? 'PENDING_VERIFICATION' : 'ACTIVE',
      passwordHash, emailVerifiedAt: pending ? null : new Date(),
      ...(role === 'CLIENT' ? { client: { create: { displayName: clientName(key) } } } : {}),
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
    host: '127.0.0.1', port: 0, attendanceCaptureForTesting: true });
  api.getHttpServer().on('request', () => { upstreamRequests++; });
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

function signIn(name) {
  if (!signedIn.has(name)) signedIn.set(name, login(name));
  return signedIn.get(name);
}

async function login(name) {
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
  const { method = 'GET', payload, key = randomUUID(), csrf = actor.csrf, source = origin, headers = {}, allow = 'GET' } = options;
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
  if (status === 405) assert.equal(response.headers.get('allow'), allow);
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

test('authorized dashboard pages render Client directory filters, pagination, and detail', async () => {
  const admin = await signIn('admin');
  const manager = await signIn('clientManager');
  const list = 'clients?limit=1&q=' + userPrefix.toUpperCase() + '&accountState=ACTIVE&emailVerified=true';
  const first = await relay(admin, 200, list);
  assert.equal(first.items.length, 1);
  const { id, displayName, email: clientEmail } = first.items[0];
  assert.deepEqual(Object.keys(first.items[0]).sort(), ['accountState', 'createdAt', 'displayName', 'email', 'emailVerified', 'id']);
  assert.match(first.nextCursor, /^[A-Za-z0-9_-]{48}$/);

  async function page(path, actor = manager) {
    const response = await fetch(origin + path, { headers: { cookie: actor.cookie } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const html = await response.text();
    for (const part of actor.cookie.split('; ')) assert(!html.includes(part.split('=')[1]));
    return html;
  }

  const directory = await page('/' + list);
  assert.match(directory, /Client directory/);
  assert.match(directory, /name="q"/);
  assert.match(directory, /name="accountState"/);
  assert.match(directory, /name="emailVerified"/);
  assert.match(directory, new RegExp('/clients/' + id));
  assert.match(directory, /Next page/);
  assert.match(directory, new RegExp('href="/clients\\?[^"]*after=' + first.nextCursor));
  const next = await relay(manager, 200, list + '&after=' + first.nextCursor);
  assert.equal(next.items.length, 1);
  assert.notEqual(next.items[0].id, id);
  assert.equal(next.nextCursor, null);
  const nextPage = await page('/' + list + '&after=' + first.nextCursor);
  assert.match(nextPage, new RegExp('/clients/' + next.items[0].id));
  assert(!nextPage.includes('/clients/' + id));
  assert.match(nextPage, /First page/);
  const pending = await page('/clients?q=' + userPrefix + '&accountState=PENDING_VERIFICATION&emailVerified=false');
  assert(pending.includes(email('clientPending')));
  assert(!pending.includes(clientEmail));
  assert.match(await page('/clients?q=missing-client'), /No matching clients/);

  const details = await page('/clients/' + id);
  assert(details.includes(displayName));
  assert(details.includes(clientEmail));
  assert.match(details, /Account details/);
  assert.match(details, /Back to clients/);
  const detail = await relay(manager, 200, 'clients/' + id);
  assert.deepEqual(Object.keys(detail).sort(), [...Object.keys(first.items[0]), 'emailVerifiedAt'].sort());
  const client = await signIn('client');
  assert.deepEqual(await relay(client, 200, 'me/client-profile'), {
    id: (await relay(client, 200, 'me')).id, email: email('client'), displayName: clientName('client'),
  });
});

test('Client pages and relay reject unauthorized navigation and keep Client routes read-only', async () => {
  const admin = await signIn('admin');
  const { items: [client] } = await relay(admin, 200, 'clients?limit=1');
  await relay({ cookie: '' }, 401, 'clients');
  for (const role of ['client', 'coach', 'noGrant', 'reader', 'auditOnly']) {
    const actor = await signIn(role);
    await relay(actor, 403, 'clients');
    await relay(actor, 403, 'clients/' + client.id);
    for (const path of ['/clients', '/clients/' + client.id]) {
      const response = await fetch(origin + path, { headers: { cookie: actor.cookie } });
      const html = await response.text();
      assert.match(html, /Your account does not have access to Client Management/);
      assert(!html.includes(client.email));
      assert.doesNotMatch(html, /<table|href="\/clients/);
    }
  }
  const anonymous = await fetch(origin + '/clients');
  assert.match(await anonymous.text(), /Sign in to continue/);
  await relay(admin, 404, 'clients/' + (await relay(admin, 200, 'me')).id);
  await relay(admin, 403, 'me/client-profile');
  await relay(admin, 400, 'me/client-profile?id=' + client.id);
  await relay(admin, 400, 'clients?limit=2&limit=3');
  await relay(admin, 400, 'clients?emailVerified=1');
  await relay(admin, 400, 'clients?q=' + 'a'.repeat(121));
  await relay(admin, 404, 'clients/' + client.id + '/audit');
  for (const method of ['POST', 'PATCH']) {
    await relay(admin, 405, 'clients/' + client.id, { method, csrf: '' });
    await relay(admin, 405, 'clients/' + client.id, { method });
  }
  await relay(admin, 200, 'clients', { source: 'https://example.invalid', csrf: '', headers: { origin: 'https://example.invalid' } });
});

test('Client relay enforces the method and path matrix before sending upstream requests', async () => {
  const admin = await signIn('admin');
  const client = await signIn('client');
  const { id } = await relay(client, 200, 'me/client-profile');
  const routes = [
    { path: 'clients', actor: admin, supported: true },
    { path: 'clients/' + id, actor: admin, supported: true },
    { path: 'clients/' + id + '/audit', actor: admin, supported: false },
    { path: 'me/client-profile', actor: client, supported: true },
  ];
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH', 'PUT', 'DELETE']) {
    for (const { path, actor, supported } of routes) {
      const forwards = method === 'GET' && supported;
      const status = forwards ? 200 : supported ? 405 : 404;
      const before = upstreamRequests;
      const body = await relay(actor, status, path, { method });
      assert.equal(upstreamRequests - before, forwards ? 1 : 0, method + ' ' + path);
      if (!forwards && method !== 'HEAD') assert.deepEqual(body, {
        code: supported ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND',
      });
    }
  }
  for (const path of ['packages', 'me']) {
    const before = upstreamRequests;
    assert.equal(await relay(admin, 200, path, { method: 'HEAD' }), null);
    assert.equal(upstreamRequests - before, 1);
    const options = await fetch(origin + '/api/studio/v1/' + path, { method: 'OPTIONS' });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('allow'), 'GET, HEAD, OPTIONS, PATCH, POST');
    assert.equal(upstreamRequests - before, 1);
  }
});

const browserTest = { skip: !process.env.STUDIO_TEST_CHROME, timeout: 30_000 };

async function browserSignIn(browser, name) {
  // The form is rendered before hydration. Wait for its React handler to accept the submit and reset it.
  await browser.until(`(() => {
    const form = document.querySelector('form');
    if (!form?.elements.email) return false;
    form.elements.email.value = ${JSON.stringify(email(name))};
    form.elements.password.value = ${JSON.stringify(fixturePassword)};
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    return form.elements.password.value === '';
  })()`, 'handled sign-in form');
  await browser.until(`document.querySelector('[aria-label="Sign out"]') &&
    document.querySelector('.account').textContent.includes(${JSON.stringify(email(name))})`, 'signed-in dashboard');
}

const signedOut = 'document.querySelector("form [name=email]")';
const signOutButton = `document.querySelector('[aria-label="Sign out"]')`;
const clientVisible = `document.querySelector('.workspace-content')?.innerText.includes(${JSON.stringify(email('client'))})`;

async function browserSignOut(browser) {
  const documentId = await browser.evaluate('performance.timeOrigin');
  await browser.until(signOutButton, 'sign-out button');
  await browser.evaluate(`${signOutButton}.click(); true`);
  await browser.until(`performance.timeOrigin !== ${documentId} && ${signedOut}`, 'signed-out dashboard reload');
  assert.equal(await browser.evaluate(`fetch('/api/studio/v1/me').then(response => response.status)`), 401);
}

async function openClientPage(browser, { detail, linked, unhydrated } = {}) {
  await browser.go('/');
  await browserSignIn(browser, 'clientManager');
  const path = detail
    ? '/clients/' + (await relay(await signIn('client'), 200, 'me/client-profile')).id
    : '/clients';
  if (unhydrated) await browser.blockResources(['*/_next/static/chunks/*.js']);
  try {
    if (linked) {
      await browser.until(`document.querySelector('nav a[href="/clients"]')`, 'Client navigation');
      await browser.evaluate(`document.querySelector('nav a[href="/clients"]').click(); true`);
    } else {
      await browser.go(path);
    }
    await browser.until(`location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete'
      && (${clientVisible})`, 'authorized Client page');
  } finally {
    if (unhydrated) await browser.blockResources([]);
  }
  return path;
}

function historyObservation(browser) {
  const lifecycle = browser.lifecycle.length;
  const responses = browser.responses.length;
  const cacheMisses = browser.cacheMisses.length;
  return () => ({
    lifecycle: browser.lifecycle.slice(lifecycle),
    responses: browser.responses.slice(responses),
    cacheMisses: browser.cacheMisses.slice(cacheMisses),
  });
}

async function traverseHistory(t, browser, direction, path, outcome, { denied = false, fresh = false } = {}) {
  const observe = historyObservation(browser);
  const documentId = await browser.evaluate('String(performance.timeOrigin)');
  await browser.traverse(direction === 'Back' ? -1 : 1);
  try {
    await browser.until(`location.pathname === ${JSON.stringify(path)} && document.readyState === 'complete'
      && getComputedStyle(document.documentElement).visibility === 'visible' && (${outcome})`, direction + ' to ' + path);
  } catch (error) {
    t.diagnostic(JSON.stringify(observe()));
    throw error;
  }
  // Give the document an opportunity to paint and deliver its pageshow and CDP response events.
  await browser.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
  const evidence = observe();
  const destinationEvents = evidence.lifecycle.filter(event => new URL(event.url).pathname === path);
  const pageshows = destinationEvents.filter(event => event.event === 'pageshow');
  const persisted = pageshows.some(event => event.persisted);
  const sameDocument = (await browser.evaluate('String(performance.timeOrigin)')) === documentId;
  const freshResponses = evidence.responses.filter(response =>
    new URL(response.url).pathname === path && response.status === 200 && !response.cached).map(response => response.type);
  const clientWasVisible = evidence.lifecycle.some(event => event.event !== 'pagehide' && event.visible);
  t.diagnostic(JSON.stringify({
    direction, path, kind: persisted ? 'BFCache' : sameDocument ? 'same-document' : 'document navigation',
    pageshows, freshResponses, cacheMisses: evidence.cacheMisses, clientWasVisible,
  }));
  if (!sameDocument) assert(pageshows.length, 'Expected a real pageshow on the destination document');
  if (denied) {
    assert(!clientWasVisible, 'Client fixture data became visible during history traversal');
    assert.equal(await browser.evaluate(`Boolean(${clientVisible})`), false);
  }
  if (path.startsWith('/clients') && persisted) {
    assert(pageshows.filter(event => event.persisted).every(event => !event.visible),
      'The protected snapshot must already be concealed on pageshow');
    assert(freshResponses.includes('Document'), 'A restored Client document must revalidate with the server');
  }
  if (fresh) assert(freshResponses.length, 'Expected a fresh server response');
  return { persisted, freshResponses };
}

const signInRequired = 'Sign in to continue.';
const forbidden = 'Your account does not have access to Client Management.';
const alertIs = message => `document.querySelector('[role="alert"]')?.textContent === ${JSON.stringify(message)}`;

for (const { title, detail, switchAccount, linked } of [
  { title: 'directory after logout' },
  { title: 'directory after an account switch', switchAccount: true },
  { title: 'directly loaded detail after logout', detail: true },
  { title: 'linked directory after logout', linked: true },
  { title: 'linked directory after an account switch', linked: true, switchAccount: true },
]) {
  test('Client browser history protects the ' + title, browserTest, async t => {
    await withChrome(origin, userPrefix, async browser => {
      const path = await openClientPage(browser, { detail, linked });
      if (linked) {
        await browser.evaluate(`document.querySelector('nav a[href="/"]').click(); true`);
      } else {
        await browser.go('/');
      }
      await browserSignOut(browser);
      if (switchAccount) await browserSignIn(browser, 'noGrant');
      const outcome = alertIs(switchAccount ? forbidden : signInRequired);
      const landing = switchAccount
        ? `document.querySelector('.account')?.textContent.includes(${JSON.stringify(email('noGrant'))})`
        : signedOut;
      await traverseHistory(t, browser, 'Back', path, outcome, { denied: true, fresh: true });
      await traverseHistory(t, browser, 'Forward', '/', landing, { denied: true });
    });
  });
}

test('Client browser history preserves authorized Catalog, directory, and detail navigation', browserTest, async t => {
  await withChrome(origin, userPrefix, async browser => {
    await browser.go('/');
    await browserSignIn(browser, 'clientManager');
    await browser.until(`document.querySelector('nav a[href="/clients"]')`, 'Client navigation');
    const documentId = await browser.evaluate('performance.timeOrigin');
    await browser.evaluate(`document.querySelector('nav a[href="/clients"]').click(); true`);
    await browser.until(clientVisible, 'linked Client directory');
    assert.equal(await browser.evaluate('performance.timeOrigin'), documentId, 'Expected a Next.js route transition');
    const detailPath = await browser.evaluate(`[...document.querySelectorAll('tbody a')].find(
      link => link.textContent.trim() === ${JSON.stringify(clientName('client'))}).pathname`);
    await browser.evaluate(`document.querySelector('a[href="' + ${JSON.stringify(detailPath)} + '"]').click(); true`);
    await browser.until(`location.pathname === ${JSON.stringify(detailPath)} && (${clientVisible})`, 'linked Client detail');
    assert.equal(await browser.evaluate('performance.timeOrigin'), documentId, 'Expected a Next.js route transition');
    await traverseHistory(t, browser, 'Back', '/clients', clientVisible);
    await traverseHistory(t, browser, 'Forward', detailPath, clientVisible);

    await browser.go('/');
    await browser.until(signOutButton, 'authorized Catalog document');
    await traverseHistory(t, browser, 'Back', detailPath, clientVisible);
    await traverseHistory(t, browser, 'Forward', '/', signOutButton);

    await traverseHistory(t, browser, 'Back', detailPath, clientVisible);
    // BFCache revalidation renders Client HTML before hydration. This scenario
    // exercises Next.js navigation with retained route data, so wait for the
    // boundary's layout effect before clicking the client-side link.
    await browser.until("document.documentElement.hasAttribute('data-client-history')", 'hydrated Client history boundary');
    const leavingClient = await browser.evaluate(`(() => {
      const state = { documentId: performance.timeOrigin, path: location.pathname, ready: document.readyState,
        marked: document.documentElement.hasAttribute('data-client-history'),
        workspace: !!document.querySelector('[data-client-workspace]') };
      document.querySelector('nav a[href="/"]').click();
      return state;
    })()`);
    await browser.until(signOutButton, 'Catalog after leaving the Client workspace');
    const catalogState = await browser.evaluate(`({ documentId: performance.timeOrigin, path: location.pathname,
      marked: document.documentElement.hasAttribute('data-client-history') })`);
    assert.equal(catalogState.documentId, leavingClient.documentId, 'Expected a Next.js route transition after Client revalidation');
    assert.equal(catalogState.marked, true, JSON.stringify({ leavingClient, catalogState }));
    await browser.go('/clients');
    await browser.until(`location.pathname === '/clients' && document.readyState === 'complete'
      && (${clientVisible})`, 'separate Client directory document');
    const { persisted, freshResponses } = await traverseHistory(t, browser, 'Back', '/', signOutButton);
    if (persisted) assert(freshResponses.includes('Document'), 'Catalog must discard restored Client route data');
  });
});

for (const direction of ['Back', 'Forward']) {
  const detail = direction === 'Back';
  test(`Client browser history revalidates the ${detail ? 'detail' : 'directory'} on ${direction} after grant revocation`, browserTest, async t => {
    await withChrome(origin, userPrefix, async browser => {
      const path = await openClientPage(browser, { detail, unhydrated: true });
      assert.equal(await browser.evaluate("document.documentElement.hasAttribute('data-client-history')"), false,
        'The protected document must still be unhydrated');
      if (detail) {
        await browser.go('/');
        await browser.until(signOutButton, 'authorized Catalog document');
      } else {
        await traverseHistory(t, browser, 'Back', '/', signOutButton);
      }
      // Leave browser cookies intact so Chrome can restore the protected document from BFCache.
      const { id } = await relay(await signIn('clientManager'), 200, 'me');
      const key = { staffUserId_permission: { staffUserId: id, permission: 'CLIENT_MANAGE' } };
      const grant = await fixture.staffGrant.delete({ where: key });
      try {
        await traverseHistory(t, browser, direction, path, alertIs(forbidden), { denied: true, fresh: true });
        await traverseHistory(t, browser, detail ? 'Forward' : 'Back', '/', signOutButton, { denied: true });
      } finally {
        await fixture.staffGrant.create({ data: grant });
      }
    });
  });
}

test('real catalog commands preserve roles, history and conflict codes through the dashboard relay', async () => {
  const actors = [];
  for (const role of ['admin', 'noGrant', 'reader', 'manager', 'auditor', 'auditOnly', 'client', 'coach']) {
    actors.push(await signIn(role));
  }
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

const fundingPage = '/purchase-funding';
const fundingRoute = id => 'purchases/' + id + '/funding';
const activationRoute = id => 'purchases/' + id + '/activate-membership';
const membershipRoute = id => 'purchases/' + id + '/membership';

async function fundingFixtures() {
  const [admin, client] = await Promise.all([
    fixture.user.findUniqueOrThrow({ where: { normalizedEmail: email('admin') } }),
    fixture.user.findUniqueOrThrow({ where: { normalizedEmail: email('client') } }),
  ]);
  const purchases = {};
  for (const [name, price, allocated] of [
    ['unfunded', '1250.50', null], ['partial', '500.00', '200.25'], ['full', '500.00', '500.00'],
    ['complimentary', '0.00', null], ['overfunded', '100.00', '100.01'], ['malformed', 500, null],
  ]) {
    const { id: packageVersionId } = await fixture.packageVersion.create({ data: {
      package: { create: { code: 'FUND-' + randomBytes(5).toString('hex').toUpperCase() } }, version: 1,
      name: 'Funding fixture', description: '', price, kind: 'TIME', validityDays: 30,
    } });
    const purchase = await fixture.purchase.create({ data: {
      clientId: client.id, packageVersionId, type: name === 'complimentary' ? 'COMPLIMENTARY' : 'POSITIVE_PRICE',
      acceptedById: admin.id, acceptedAt: new Date(), terms: { price, currency: 'SAR', kind: 'TIME', validityDays: 30, sessionAllowance: null },
      acceptance: { create: { agreementMethod: 'VERBAL_AGREEMENT', agreementEvidence: 'Test agreement', purpose: 'Test purchase' } },
      membership: name === 'complimentary' ? { create: {} } : undefined,
    } });
    purchases[name] = purchase.id;
    if (allocated) {
      const payment = await fixture.payment.create({ data: {
        intakeId: randomUUID(), clientId: client.id, recordedById: admin.id, amount: allocated, currency: 'SAR',
        method: 'CASH', status: 'VERIFIED', receivedAt: new Date(), verifiedById: admin.id, verifiedAt: new Date(),
      } });
      await fixture.$executeRaw`
        INSERT INTO payment_allocation (payment_id, purchase_id, amount, allocated_by)
        VALUES (${payment.id}::uuid, ${purchase.id}::uuid, ${allocated}::numeric, ${admin.id}::uuid)`;
    }
  }
  return purchases;
}

test('Purchase funding page and relay enforce Admin access and keep credentials server-side', async () => {
  const { unfunded, complimentary, overfunded, malformed } = await fundingFixtures();
  const staffUser = await fixture.user.findUniqueOrThrow({ where: { normalizedEmail: email('reader') } });
  const adminUser = await fixture.user.findUniqueOrThrow({ where: { normalizedEmail: email('admin') } });
  await fixture.staffGrant.createMany({ data: ['PURCHASE_READ', 'FINANCE_READ'].map(permission => ({
    permission, staffUserId: staffUser.id, changedById: adminUser.id,
  })) });
  for (const [role, message] of [
    ['admin', null], ['noGrant', 'Your account does not have access'],
    ['reader', 'Your account does not have access'],
    ['coach', 'Your account does not have access'], ['client', 'Your account does not have access'], [null, 'Sign in to continue'],
  ]) {
    const actor = role ? await signIn(role) : { cookie: '' };
    const page = await fetch(origin + fundingPage, { headers: { cookie: actor.cookie } });
    assert.equal(page.status, 200);
    assert.match(page.headers.get('cache-control'), /no-store/);
    const html = await page.text();
    assert.doesNotMatch(html, /accessToken|refreshToken|__Host-ss_/);
    for (const cookie of actor.cookie.split('; ').filter(Boolean)) assert(!html.includes(cookie.split('=')[1]));
    if (message) {
      assert(html.includes(message));
      assert.doesNotMatch(html, /name="purchaseId"/);
      assert.equal((await relay(actor, role ? 403 : 401, fundingRoute(unfunded))).code, role ? 'FORBIDDEN' : 'UNAUTHENTICATED');
    } else {
      assert.match(html, /name="purchaseId"/);
      assert.deepEqual(await relay(actor, 200, fundingRoute(unfunded.toUpperCase())), {
        purchaseId: unfunded, currency: 'SAR', purchasePrice: '1250.50', allocatedAmount: '0.00',
        remainingAmount: '1250.50', fundingStatus: 'UNFUNDED',
      });
      assert.deepEqual(await relay(actor, 200, fundingRoute(complimentary)), {
        purchaseId: complimentary, currency: 'SAR', purchasePrice: '0.00', allocatedAmount: '0.00',
        remainingAmount: '0.00', fundingStatus: 'FULLY_FUNDED',
      });
      for (const [status, id, code] of [
        [404, randomUUID(), 'PURCHASE_NOT_FOUND'], [409, overfunded, 'PURCHASE_OVERFUNDED'], [500, malformed, 'INTERNAL_ERROR'],
      ]) assert.deepEqual(await relay(actor, status, fundingRoute(id)), { code });
    }
  }
  const admin = await signIn('admin');
  const refresh = admin.cookie.split('; ').find(pair => pair.startsWith('__Host-ss_refresh='));
  for (const cookie of [refresh, '__Host-ss_access=expired; ' + refresh]) {
    const page = await fetch(origin + fundingPage, { headers: { cookie }, redirect: 'manual' });
    assert.equal(page.status, 307);
    assert.equal(page.headers.get('location'), '/?session=expired');
    assert.match(page.headers.get('cache-control'), /no-store/);
    const body = await page.text();
    assert.doesNotMatch(body, /name="purchaseId"|Funding summary/);
    assert(!body.includes(refresh));
  }
});

test('Purchase funding relay forwards only the exact GET route with a valid UUID', async () => {
  const admin = await signIn('admin');
  const id = randomUUID();
  const route = fundingRoute(id);
  const before = upstreamRequests;
  for (const method of ['HEAD', 'OPTIONS', 'POST', 'PATCH', 'PUT', 'DELETE']) {
    await relay(admin, 405, route, { method });
    assert.deepEqual(await relay(admin, 404, 'purchases/positive-price/unsupported', { method }),
      method === 'HEAD' ? null : { code: 'NOT_FOUND' });
  }
  for (const path of ['purchases', 'purchases/' + id, route + '/details', 'purchases/' + id + '/allocate']) {
    assert.deepEqual(await relay(admin, 404, path), { code: 'NOT_FOUND' });
  }
  for (const path of [fundingRoute('bad-id'), route + '?unexpected=1']) {
    assert.deepEqual(await relay(admin, 400, path), { code: 'INVALID_INPUT' });
  }
  assert.equal(upstreamRequests, before);
  const staff = await signIn('noGrant');
  const credential = admin.cookie.split('; ').find(cookie => cookie.startsWith('__Host-ss_access=')).split('=')[1];
  assert.deepEqual(await relay(staff, 403, route, { headers: { Authorization: 'Bearer ' + credential } }), { code: 'FORBIDDEN' });
  assert.equal(upstreamRequests - before, 1);
});

test('Purchase funding viewer validates input, displays results, and handles service and session errors', browserTest, async () => {
  const ids = await fundingFixtures();
  await withChrome(origin, ids.full, async browser => {
    // Authenticate in the browser using a fixture session, without adding another API login to the suite's shared rate limit.
    const session = await signIn('admin');
    await browser.go('/');
    for (const pair of session.cookie.split('; ')) await browser.setCookie(origin, pair);
    await browser.go('/');
    await browser.until(`document.querySelector('nav a[href="${fundingPage}"]')`, 'Admin funding navigation');
    await browser.evaluate(`document.querySelector('nav a[href="${fundingPage}"]').click(); true`);
    await browser.until(`location.pathname === "${fundingPage}" && document.querySelector('input[name=purchaseId]:enabled')`, 'funding form');

    const alert = text => `document.querySelector('[role=alert]')?.textContent.includes(${JSON.stringify(text)})`;
    const submit = id => browser.evaluate(`(() => {
      const input = document.querySelector('input[name=purchaseId]');
      input.value = ${JSON.stringify(id)};
      input.form.requestSubmit();
      return true;
    })()`);
    const before = upstreamRequests;
    await submit('invalid');
    await browser.until(alert('Enter a valid Purchase UUID.'), 'client-side UUID validation');
    assert.equal(upstreamRequests, before);
    assert(!browser.responses.some(response => new URL(response.url).pathname.includes('/api/studio/v1/purchases/')));

    await browser.evaluate(`(() => {
      window.originalFundingFetch = window.fetch;
      window.fetch = (...args) => typeof args[0] === 'string' && args[0].startsWith('/api/studio/v1/purchases/')
        ? new Promise((resolve, reject) => { window.releaseFunding = () => window.originalFundingFetch(...args).then(resolve, reject); })
        : window.originalFundingFetch(...args);
      return true;
    })()`);
    await submit(' ' + ids.unfunded.toUpperCase() + ' ');
    await browser.until(`document.querySelector('form[aria-busy=true]') && document.querySelector('[role=status]').textContent.includes('Loading Purchase funding')`, 'loading state');
    assert.equal(await browser.evaluate('document.querySelector(".funding-summary") === null'), true);
    await browser.evaluate('window.fetch = window.originalFundingFetch; window.releaseFunding(); true');

    const fields = () => browser.evaluate(`Object.fromEntries([...document.querySelectorAll('.funding-summary dl > div')]
      .map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent.trim()]))`);
    for (const [name, price, allocated, remaining, status] of [
      ['unfunded', '1,250.50', '0.00', '1,250.50', 'Unfunded'],
      ['partial', '500.00', '200.25', '299.75', 'Partially funded'],
      ['full', '500.00', '500.00', '0.00', 'Fully funded'],
      ['complimentary', '0.00', '0.00', '0.00', 'Fully funded'],
    ]) {
      if (name !== 'unfunded') await submit(ids[name]);
      await browser.until(`document.querySelector('.funding-summary')?.textContent.includes("${ids[name]}")`, name + ' result');
      assert.deepEqual(await fields(), {
        'Purchase ID': ids[name], 'Purchase price': 'SAR ' + price, 'Allocated amount': 'SAR ' + allocated,
        'Remaining amount': 'SAR ' + remaining, 'Funding status': status,
      });
      assert(browser.responses.some(response => response.url === origin + '/api/studio/v1/' + fundingRoute(ids[name]) && response.status === 200));
    }

    for (const [id, message] of [
      [randomUUID(), 'This Purchase could not be found.'],
      [ids.overfunded, 'Allocations exceed the frozen Purchase price.'],
      [ids.malformed, 'Purchase funding could not be loaded.'],
    ]) {
      await submit(id);
      await browser.until(alert(message), message);
      assert.equal(await browser.evaluate('document.querySelector(".funding-summary") === null'), true);
    }

    for (const [mockFetch, message] of [
      ["async () => Response.json({ code: 'INVALID_INPUT' }, { status: 400 })", 'Enter a valid Purchase UUID.'],
      ["async () => { throw new TypeError('Network failure'); }", 'Purchase funding is temporarily unavailable.'],
    ]) {
      await browser.evaluate(`window.fetch = ${mockFetch}; true`);
      await submit(ids.full);
      await browser.until(alert(message), message);
    }
    await browser.evaluate(`window.fetch = window.originalFundingFetch;
      [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Try again').click(); true`);
    await browser.until(`document.querySelector('.funding-summary')?.textContent.includes("${ids.full}")`, 'retry result');
    assert.equal(await browser.evaluate(`!/accessToken|refreshToken|__Host-ss_/.test(document.documentElement.outerHTML + document.cookie)`), true);

    const staff = await signIn('noGrant');
    for (const pair of staff.cookie.split('; ')) await browser.setCookie(origin, pair);
    await submit(ids.full);
    await browser.until(alert('Your account does not have access to Purchase funding.'), '403 access-denied state');
    assert.equal(await browser.evaluate('document.querySelector(".funding-summary, input[name=purchaseId]") === null'), true);
    await browser.go('/');
    await browser.until(`document.querySelector('[aria-label="Sign out"]')`, 'Staff catalog');
    assert.equal(await browser.evaluate(`document.querySelector('nav a[href="${fundingPage}"]') === null`), true);

    for (const pair of session.cookie.split('; ')) await browser.setCookie(origin, pair);
    await browser.go(fundingPage);
    await browser.until(`document.querySelector('input[name=purchaseId]:enabled')`, 'authorized form');
    await submit(ids.full);
    await browser.until(`document.querySelector('.funding-summary')?.textContent.includes("${ids.full}")`, 'authorized result');
    await browser.go('/');
    await browser.until(`location.pathname === '/' && document.querySelector('[aria-label="Sign out"]')`, 'return to Catalog');
    for (const pair of staff.cookie.split('; ')) await browser.setCookie(origin, pair);
    await browser.traverse(-1);
    await browser.until(`location.pathname === "${fundingPage}" && ${alert('Your account does not have access to Purchase funding.')}`,
      'funding history rechecks Admin access');
    assert.equal(await browser.evaluate('document.querySelector(".funding-summary, input[name=purchaseId]") === null'), true);
    assert(browser.lifecycle.filter(event => event.event === 'pageshow' && new URL(event.url).pathname === fundingPage)
      .every(event => !event.visible), 'restored history must conceal the previous funding result');

    // Use a separate Admin session so restoring it cannot rotate the shared fixture's refresh token.
    const expiring = await login('admin');
    for (const pair of expiring.cookie.split('; ')) await browser.setCookie(origin, pair);
    await browser.go(fundingPage);
    await browser.until(`document.querySelector('input[name=purchaseId]:enabled')`, 'authorized form before expiry');
    await submit(ids.full);
    await browser.until(`document.querySelector('.funding-summary')?.textContent.includes("${ids.full}")`, 'funding result before expiry');
    await browser.setCookie(origin, '__Host-ss_access=expired');
    await submit(ids.full);
    await browser.until(`location.pathname === '/' && location.search === '?session=expired'
      && document.querySelector('form [name=email]')
      && document.querySelector('[role=status]')?.textContent.includes('Your session expired. Sign in or restore your session.')
      && [...document.querySelectorAll('button')].some(button => button.textContent === 'Restore existing session')`,
      '401 returns to dashboard sign-in and session restoration');
    assert(browser.responses.some(response => response.url === origin + '/api/studio/v1/' + fundingRoute(ids.full) && response.status === 401));
    assert.equal(await browser.evaluate('document.querySelector(".funding-summary, input[name=purchaseId]") === null'), true);
    await browser.evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent === 'Restore existing session').click(); true`);
    await browser.until(`document.querySelector('[aria-label="Sign out"]') && document.querySelector('nav a[href="${fundingPage}"]')`,
      'existing session restoration returns to Admin Catalog');
    assert.equal(await browser.evaluate('document.querySelector(".funding-summary, input[name=purchaseId]") === null'), true);
  });
});

test('Membership activation relay requires Admin, CSRF, an exact path and an idempotency key', async () => {
  const ids = await fundingFixtures();
  const path = activationRoute(ids.full);
  const admin = await signIn('admin');
  const post = { method: 'POST', payload: {} };
  const before = upstreamRequests;
  assert.deepEqual(await relay({ cookie: '' }, 401, path, post), { code: 'UNAUTHENTICATED' });
  for (const options of [{ csrf: '' }, { source: 'https://foreign.invalid' }]) {
    assert.deepEqual(await relay(admin, 403, path, { ...post, ...options }), { code: 'CSRF_DENIED' });
  }
  assert.deepEqual(await relay(admin, 400, path, { ...post, key: ' ' }), { code: 'INVALID_IDEMPOTENCY_KEY' });
  assert.deepEqual(await relay(admin, 400, path + '?override=true', post), { code: 'INVALID_INPUT' });
  assert.deepEqual(await relay(admin, 404, path + '/extra', post), { code: 'NOT_FOUND' });
  const getActivation = await fetch(origin + '/api/studio/v1/' + path, { headers: { cookie: admin.cookie } });
  assert.equal(getActivation.status, 405);
  assert.equal(getActivation.headers.get('allow'), 'POST');
  assert.equal(upstreamRequests, before);

  for (const account of ['clientManager', 'coach', 'client']) {
    const actor = await signIn(account);
    const credential = admin.cookie.split('; ').find(cookie => cookie.startsWith('__Host-ss_access=')).split('=')[1];
    assert.deepEqual(await relay(actor, 403, path, { ...post, headers: { Authorization: 'Bearer ' + credential } }), { code: 'FORBIDDEN' });
    assert.deepEqual(await relay(actor, 403, membershipRoute(ids.full)), { code: 'FORBIDDEN' });
    const page = await fetch(origin + fundingPage, { headers: { cookie: actor.cookie } });
    assert.doesNotMatch(await page.text(), /Confirm activation|Activate membership/);
  }
  assert.deepEqual(await relay(admin, 200, membershipRoute(ids.full)), { membershipId: null, status: 'NOT_CREATED' });
  assert.deepEqual(await relay(admin, 409, activationRoute(ids.partial), post), { code: 'ACTIVATION_OVERRIDE_REQUIRED' });
  const write = { ...post, key: randomUUID() };
  const result = await relay(admin, 200, path, write);
  assert.equal(result.membership.status, 'ACTIVE');
  assert.equal(result.membership.purchaseId, ids.full);
  assert.equal(result.overrideUsed, false);
  assert.equal(result.overrideReason, undefined);
  assert.deepEqual(await relay(admin, 200, path, write), result);
  assert.deepEqual(await relay(admin, 200, membershipRoute(ids.full)), { membershipId: result.membership.id, status: 'ACTIVE' });
});

test('Membership activation in Chrome confirms full, partial, unfunded, and complimentary purchases', browserTest, async () => {
  const ids = await fundingFixtures();
  const startingMember = await fixture.membership.findUniqueOrThrow({ where: { purchaseId: ids.complimentary } });
  const admin = await signIn('admin');
  await withChrome(origin, ids.full, async browser => {
    await browser.go('/');
    for (const pair of admin.cookie.split('; ')) await browser.setCookie(origin, pair);
    await browser.go(fundingPage);
    const selector = '.membership-activation';
    const findButton = text => `[...document.querySelectorAll('${selector} button')].find(button => button.textContent.trim() === "${text}")`;
    const click = async text => {
      await browser.until(`!!${findButton(text)}`, text);
      await browser.evaluate(`${findButton(text)}.click(); true`);
    };
    const lookup = async id => {
      await browser.until('document.querySelector("input[name=purchaseId]:enabled")', 'purchase lookup');
      await browser.evaluate(`var lookupInput = document.querySelector('input[name=purchaseId]'); lookupInput.value = "${id}"; lookupInput.form.requestSubmit(); true`);
      await browser.until(`document.querySelector(".funding-summary")?.textContent.includes("${id}")`, 'purchase summary');
    };
    for (const name of ['full', 'partial', 'unfunded', 'complimentary']) {
      const id = ids[name];
      await lookup(id);
      await browser.until(`document.querySelector('${selector}')?.textContent.includes('Pending activation')`, name + ' pending');
      assert.equal(browser.responses.filter(response => response.url.endsWith('/' + activationRoute(id))).length, 0);
      await click('Activate membership');
      await browser.until(`document.querySelector('${selector} h3')?.textContent.includes('Confirm membership activation')`, 'confirmation');
      assert.equal((await fixture.membership.findUnique({ where: { purchaseId: id } }))?.status,
        name === 'complimentary' ? 'PENDING_ACTIVATION' : undefined);
      if (name === 'full') {
        await click('Cancel');
        await click('Activate membership');
      }
      if (name === 'partial' || name === 'unfunded') {
        assert.equal(await browser.evaluate(`${findButton('Confirm activation')}.disabled`), true);
        await browser.evaluate(`document.querySelector('${selector} input[type=checkbox]').click(); true`);
        await browser.until(`document.querySelector('${selector} textarea')`, 'override reason');
        assert.equal(await browser.evaluate(`${findButton('Confirm activation')}.disabled`), true);
        await browser.evaluate(`(() => {
          const field = document.querySelector('${selector} textarea');
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Admin approved the requested start.');
          field.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })()`);
      } else {
        assert.equal(await browser.evaluate(`document.querySelector('${selector} input[type=checkbox]') === null`), true);
        if (name === 'complimentary') assert.match(await browser.evaluate(`document.querySelector('${selector}').textContent`), /No payment is required/);
      }
      await browser.until(`!${findButton('Confirm activation')}.disabled`, 'confirm enabled');
      await click('Confirm activation');
      await browser.until(`document.querySelector('${selector} [role=status]')?.textContent.includes('Membership activated')`, name + ' activation success');
      const membership = await fixture.membership.findUniqueOrThrow({ where: { purchaseId: id } });
      assert.equal(membership.status, 'ACTIVE');
      if (name === 'complimentary') assert.equal(membership.id, startingMember.id);
    }
    await browser.go(fundingPage);
    await lookup(ids.full);
    await browser.until(`document.querySelector('${selector}')?.textContent.includes('Active')`, 'active after refresh');
    assert.equal(await browser.evaluate(`!!${findButton('Activate membership')}`), false);
  });
});

test('Membership activation in Chrome reports stale funding and can refresh before confirmation', browserTest, async () => {
  const ids = await fundingFixtures();
  const admin = await signIn('admin');
  await withChrome(origin, ids.full, async browser => {
    await browser.go('/');
    for (const pair of admin.cookie.split('; ')) await browser.setCookie(origin, pair);
    await browser.go(fundingPage);
    await browser.until('document.querySelector("input[name=purchaseId]:enabled")', 'purchase lookup');
    await browser.evaluate(`const input = document.querySelector('input[name=purchaseId]');
      input.value = "${ids.full}"; input.form.requestSubmit(); true`);
    const activate = `[...document.querySelectorAll('.membership-activation button')].find(button => button.textContent === 'Activate membership')`;
    await browser.until(`!!${activate}`, 'activation available');
    await browser.evaluate(`${activate}.click(); true`);
    const purchase = await fixture.purchase.findUniqueOrThrow({ where: { id: ids.full } });
    const payment = await fixture.payment.create({ data: {
      intakeId: randomUUID(), clientId: purchase.clientId, recordedById: purchase.acceptedById, amount: 1,
      currency: 'SAR', method: 'CASH', status: 'VERIFIED', receivedAt: new Date(),
      verifiedById: purchase.acceptedById, verifiedAt: new Date(),
    } });
    await fixture.$executeRaw`INSERT INTO payment_allocation (payment_id, purchase_id, amount, allocated_by)
      VALUES (${payment.id}::uuid, ${purchase.id}::uuid, 1, ${purchase.acceptedById}::uuid)`;
    await browser.evaluate(`document.querySelector('.activation-confirmation button[type=submit]').click(); true`);
    const alert = text => `document.querySelector('[role=alert]')?.textContent.includes("${text}")`;
    await browser.until(alert('Activation could not proceed'), 'stale funding error');
    assert.equal(await fixture.membership.count({ where: { purchaseId: purchase.id } }), 0);
    await browser.evaluate(`document.querySelector('.membership-activation button').click(); true`);
    await browser.until(alert('Funding information cannot be displayed'), 'funding conflict after refresh');
  });
});

const schedulingPage = '/scheduling';
const scheduleApi = 'scheduling/sessions';
const nextSessionTime = (minutes = 0) => new Date(Date.now() + 48 * 3600_000 + minutes * 60_000).toISOString();
const scheduleWindow = () => '?from=' + encodeURIComponent(nextSessionTime(-1440)) + '&until=' + encodeURIComponent(nextSessionTime(1440));

async function dashboardScheduleFixture(admin) {
  const { sessionTypeId } = await relay(admin, 201, 'session-types', {
    method: 'POST', payload: { code: 'DASH-SCHED-' + randomUUID().slice(0, 8), name: 'Schedule fixture', mode: 'GROUP' },
  });
  const coach = await fixture.user.findUniqueOrThrow({ where: { normalizedEmail: email('coach') } });
  return { sessionTypeId, coachId: coach.id };
}

test('Scheduling relay and Admin workspace support settings, assignment, editing, conflicts and cancellation', async () => {
  const admin = await signIn('admin');
  const { sessionTypeId, coachId } = await dashboardScheduleFixture(admin);
  const settingsPath = 'scheduling/settings/' + sessionTypeId;
  const q = scheduleWindow();
  const body = { sessionTypeId, coachId, startsAt: nextSessionTime() };
  const settings = { method: 'PATCH', payload: { durationMinutes: 60, bufferMinutes: 10, groupCapacity: 6 } };
  const create = { method: 'POST', payload: body };
  const page = await fetch(origin + schedulingPage, { headers: { cookie: admin.cookie } });
  assert.match(await page.text(), /Scheduling settings/);
  const before = upstreamRequests;
  assert.deepEqual(await relay(admin, 403, settingsPath, { ...settings, source: 'https://invalid.example' }), { code: 'CSRF_DENIED' });
  assert.deepEqual(await relay(admin, 403, scheduleApi, { ...create, csrf: '' }), { code: 'CSRF_DENIED' });
  assert.deepEqual(await relay(admin, 400, scheduleApi, { ...create, key: '' }), { code: 'INVALID_IDEMPOTENCY_KEY' });
  assert.deepEqual(await relay(admin, 404, scheduleApi + '/bad-id/cancel', create), { code: 'NOT_FOUND' });
  assert.deepEqual(await relay(admin, 400, scheduleApi + q + '&extra=yes'), { code: 'INVALID_INPUT' });
  assert.equal(upstreamRequests, before);
  assert.equal((await relay(admin, 403, 'scheduling/my-sessions' + q)).code, 'FORBIDDEN');
  await relay({ cookie: '' }, 401, scheduleApi + q);
  for (const role of ['noGrant', 'coach', 'client']) {
    const actor = await signIn(role);
    const protectedPage = await fetch(origin + schedulingPage, { headers: { cookie: actor.cookie } });
    const html = await protectedPage.text();
    assert.match(html, /Your account does not have access to Scheduling/);
    assert.doesNotMatch(html, /Scheduling settings/);
    await relay(actor, 403, scheduleApi + q);
    await relay(actor, 403, scheduleApi, create);
  }

  await relay(admin, 204, settingsPath, settings);
  const defaults = await relay(admin, 200, 'scheduling/settings');
  assert(defaults.some(row => row.sessionTypeId === sessionTypeId && row.bufferMinutes === 10));
  const coaches = await relay(admin, 200, 'scheduling/coaches');
  assert(coaches.some(row => row.id === coachId));
  const { sessionId } = await relay(admin, 201, scheduleApi, create);
  assert.equal((await relay(admin, 409, scheduleApi, create)).code, 'COACH_SCHEDULE_CONFLICT');
  const idPath = scheduleApi + '/' + sessionId;
  const startsAt = new Date(Date.parse(body.startsAt) + 20 * 60_000).toISOString();
  await relay(admin, 204, idPath, { method: 'PATCH', payload: { coachId, startsAt, expectedRevision: 1 } });
  const listing = await relay(admin, 200, scheduleApi + q + '&coachId=' + coachId);
  const edited = listing.items.find(row => row.id === sessionId);
  assert.equal(edited.startsAt, startsAt);
  assert.equal(edited.revision, 2);
  assert.equal(edited.bufferMinutes, 10);
  await relay(admin, 204, idPath + '/cancel', { method: 'POST', payload: { expectedRevision: 2, reason: 'Schedule fixture changed' } });
  assert.equal((await relay(admin, 200, scheduleApi + q)).items.find(row => row.id === sessionId).status, 'CANCELLED');
});

test('Scheduling in Chrome protects navigation and handles conflicts, cancellation and session expiry', browserTest, async () => {
  const admin = await signIn('admin');
  const { sessionTypeId, coachId } = await dashboardScheduleFixture(admin);
  const startsAt = nextSessionTime(180);
  await withChrome(origin, 'Schedule fixture', async browser => {
    await browser.go('/');
    for (const pair of admin.cookie.split('; ')) await browser.setCookie(origin, pair);
    await browser.go('/');
    await browser.until(`document.querySelector('nav a[href="/scheduling"]')`, 'Admin scheduling navigation');
    await browser.evaluate(`document.querySelector('nav a[href="/scheduling"]').click(); true`);
    const settingsSelect = 'document.querySelector("#settings-heading + label select:enabled")';
    await browser.until(settingsSelect, 'settings type selection');
    await browser.evaluate(`(() => {
      const select = ${settingsSelect};
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, "${sessionTypeId}");
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    const settingsForm = `document.querySelector('form[aria-label="Scheduling settings"]')`;
    await browser.until(settingsForm, 'settings form');
    await browser.evaluate(`(() => {
      const form = ${settingsForm};
      form.elements.durationMinutes.value = "60";
      form.elements.bufferMinutes.value = "10";
      form.elements.groupCapacity.value = "7";
      form.requestSubmit();
      return true;
    })()`);
    const createButton = '[...document.querySelectorAll("button")].find(button => button.textContent === "Create session" && !button.disabled)';
    const editor = `document.querySelector('form[aria-label="Session editor"]')`;
    const localStart = new Date(Date.parse(startsAt) + 3 * 60 * 60_000).toISOString().slice(0, -1);
    const create = async () => {
      await browser.until(createButton, 'create session action');
      await browser.evaluate(`${createButton}.click(); true`);
      await browser.until(editor, 'session editor');
      await browser.evaluate(`(() => {
        const form = ${editor};
        form.elements.sessionTypeId.value = "${sessionTypeId}";
        form.elements.coachId.value = "${coachId}";
        form.elements.startsAt.value = "${localStart}";
        form.requestSubmit();
        return true;
      })()`);
    };
    await create();
    await browser.until(`document.querySelector(".notice.success")?.textContent.includes("Session scheduled")`, 'creation success');
    await create();
    await browser.until(`document.querySelector("[role=alert]")?.textContent.includes("post-session buffer")`, 'conflict feedback');

    const rowButton = text => `[...document.querySelectorAll(".schedule-table button")].find(button => !button.disabled && button.textContent === "${text}")`;
    await browser.evaluate(`${rowButton('Edit')}.click(); true`);
    await browser.until(`${editor}?.textContent.includes("Edit session")`, 'edit session');
    const later = new Date(Date.parse(localStart + 'Z') + 30 * 60_000).toISOString().slice(0, -1);
    await browser.evaluate(`(() => { const form = ${editor}; form.elements.startsAt.value = "${later}"; form.requestSubmit(); return true; })()`);
    await browser.until(`document.querySelector(".notice.success")?.textContent.includes("Session updated")`, 'edit success');
    await browser.until(rowButton('Cancel'), 'cancel session action');
    await browser.evaluate(`${rowButton('Cancel')}.click(); true`);
    await browser.until(`${editor}?.elements.reason`, 'cancel confirmation');
    await browser.evaluate(`(() => { const form = ${editor}; form.elements.reason.value = "Coach unavailable"; form.requestSubmit(); return true; })()`);
    await browser.until(`document.querySelector(".schedule-table")?.textContent.includes("Cancelled")`, 'cancellation success');

    // Invalidate only the access cookie to exercise the 401 redirect with a refresh session still present.
    await browser.setCookie(origin, '__Host-ss_access=invalid');
    await browser.evaluate(`document.querySelector('form[aria-label="Schedule filters"]').requestSubmit(); true`);
    await browser.until('location.pathname === "/" && location.search === "?session=expired"', 'expired scheduling session');
    const staff = await signIn('noGrant');
    for (const pair of staff.cookie.split('; ')) await browser.setCookie(origin, pair);
    await browser.go(schedulingPage);
    await browser.until(`document.querySelector("[role=alert]")?.textContent.includes("does not have access to Scheduling")`, 'Staff page denial');
    assert.equal(await browser.evaluate('document.querySelector("#settings-heading") === null'), true);
  });
});

const bookingsPath = '/bookings';
const bookingApi = 'bookings';
const bookingQuery = id => '?scheduledSessionId=' + id;
const approvalPath = id => bookingApi + '/' + id + '/approve';

async function dashboardBookingFixture(adminSession) {
  const admin = adminSession ?? await signIn('admin');
  const { sessionTypeId } = await dashboardScheduleFixture(admin);
  const { id: coachId } = await fixture.user.create({ data: {
    normalizedEmail: randomUUID() + '@coach.example', role: 'COACH', accountState: 'ACTIVE',
    emailVerifiedAt: new Date(), coach: { create: { displayName: 'Booking Coach' } },
  } });
  const [{ id: adminId }, { id: clientId }, { id: otherClient }] = await Promise.all(['admin', 'client', 'clientSecond'].map(key =>
    fixture.user.findUniqueOrThrow({ where: { normalizedEmail: email(key) }, select: { id: true } })));
  const bookingStart = new Date(nextSessionTime(480));
  const scheduledSession = await fixture.scheduledSession.create({ data: {
    sessionTypeId, coachId, startsAt: bookingStart, endsAt: new Date(+bookingStart + 3600_000), bufferMinutes: 0, capacity: 1,
  } });
  const dateInRiyadh = instant => new Date(new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'short', timeZone: 'Asia/Riyadh',
  }).format(instant) + 'T00:00:00Z');
  async function activate(clientId, kind, expired = false) {
    const offer = await fixture.package.create({ data: { code: 'DASH-BOOK-' + randomUUID().slice(0, 8).toUpperCase() } });
    const activatedAt = new Date(Date.now() - (expired ? 4 * 86400_000 : 0));
    const initialSessionAllowance = kind === 'SESSION' ? 2 : null;
    const version = await fixture.packageVersion.create({ data: {
      packageId: offer.id, version: 1, name: (expired ? 'Expired ' : '') + kind + ' booking package', description: 'Private fixture terms',
      kind, price: '0.00', validityDays: expired ? 1 : 6, sessionAllowance: initialSessionAllowance,
      eligibility: { create: { sessionTypeId } },
    } });
    await fixture.packageVersion.update({ where: { id: version.id }, data: { publishedAt: activatedAt } });
    const [{ terms }] = await fixture.$queryRaw`SELECT purchase_terms_for_version(${version.id}::uuid) AS terms`;
    const { membership } = await fixture.purchase.create({ data: {
      packageVersionId: version.id, clientId, acceptedById: adminId, acceptedAt: activatedAt, terms, type: 'COMPLIMENTARY',
      acceptance: { create: { agreementMethod: 'VERBAL_AGREEMENT', agreementEvidence: 'Private fixture', purpose: 'Fixture' } },
      membership: { create: { status: 'ACTIVE', activatedAt, validFrom: dateInRiyadh(activatedAt),
        validThrough: dateInRiyadh(new Date(+activatedAt + (expired ? 0 : 5 * 86400_000))), initialSessionAllowance } },
    }, select: { membership: true } });
    return membership;
  }
  const membership = await activate(clientId, 'SESSION');
  const time = await activate(clientId, 'TIME');
  const expired = await activate(clientId, 'TIME', true);
  const otherMembership = await activate(otherClient, 'SESSION');
  return { admin, session: scheduledSession, clientId, otherClient, membership, time, expired, otherMembership };
}

test('Booking relay enforces Admin, CSRF, exact methods and paths, and financial field redaction', async () => {
  const { admin, session, clientId, membership } = await dashboardBookingFixture();
  const q = bookingQuery(session.id);
  const choicesPath = 'clients/' + clientId + '/booking-memberships';
  const body = { clientId, membershipId: membership.id, scheduledSessionId: session.id };
  const create = { method: 'POST', payload: body };
  const page = await fetch(origin + bookingsPath, { headers: { cookie: admin.cookie } });
  assert.match(page.headers.get('cache-control'), /no-store/);
  assert.match(await page.text(), /Select a scheduled session/);
  const before = upstreamRequests;
  assert.deepEqual(await relay(admin, 403, bookingApi, { ...create, source: 'https://invalid.example' }), { code: 'CSRF_DENIED' });
  assert.deepEqual(await relay(admin, 403, bookingApi, { ...create, csrf: '' }), { code: 'CSRF_DENIED' });
  assert.deepEqual(await relay(admin, 400, bookingApi, { ...create, key: '' }), { code: 'INVALID_IDEMPOTENCY_KEY' });
  assert.deepEqual(await relay(admin, 404, 'bookings/not-a-uuid/approve', { method: 'POST' }), { code: 'NOT_FOUND' });
  assert.deepEqual(await relay(admin, 404, 'bookings/' + session.id + '/reschedule', create), { code: 'NOT_FOUND' });
  for (const method of ['HEAD', 'OPTIONS', 'PUT', 'POST', 'DELETE', 'PATCH']) {
    await relay(admin, 405, choicesPath + q, { method });
  }
  for (const path of [bookingApi, bookingApi + q + '&scheduledSessionId=' + session.id, choicesPath + q + '&after=' + session.id]) {
    assert.deepEqual(await relay(admin, 400, path), { code: 'INVALID_INPUT' });
  }
  assert.equal(upstreamRequests, before);
  await relay({ cookie: '' }, 401, bookingApi + q);
  for (const role of ['noGrant', 'clientManager', 'coach', 'client']) {
    const actor = await signIn(role);
    const denied = await fetch(origin + bookingsPath, { headers: { cookie: actor.cookie } });
    assert.match(await denied.text(), /Your account does not have access to Booking management/);
    await relay(actor, 403, bookingApi + q);
    await relay(actor, 403, choicesPath + q);
    await relay(actor, 403, bookingApi, create);
    for (const action of ['approve', 'reject', 'cancel']) {
      await relay(actor, 403, 'bookings/' + session.id + '/' + action,
        { method: 'POST', ...(action === 'approve' ? {} : { payload: { reason: 'Fixture' } }) });
    }
  }
  const choices = await relay(admin, 200, choicesPath + q);
  assert(choices.some(choice => choice.membershipId === membership.id && choice.eligible));
  assert(choices.some(choice => choice.reason === 'MEMBERSHIP_EXPIRED'));
  assert.doesNotMatch(JSON.stringify(choices), /price|currency|payment|allocation|purchaseId|Private fixture/i);
  const { bookingId } = await relay(admin, 201, bookingApi, create);
  assert.equal((await relay(admin, 409, bookingApi, create)).code, 'BOOKING_ALREADY_EXISTS');
  await relay(admin, 204, approvalPath(bookingId), { method: 'POST' });
  const history = await relay(admin, 200, bookingApi + q);
  assert.equal(history.session.confirmedBookingCount, 1);
  assert.equal(history.items[0].status, 'CONFIRMED');
  assert.equal(history.items[0].membershipId, membership.id);
  assert.doesNotMatch(JSON.stringify(history), /price|currency|payment|allocation|purchaseId|Private fixture/i);
  await relay(admin, 204, bookingApi + '/' + bookingId + '/cancel', { method: 'POST', payload: { reason: 'Keep fixture history' } });
});

async function bookingBrowserSelect(browser, selector, id) {
  await browser.until(`document.querySelector(${JSON.stringify(selector)})?.querySelector("option[value='${id}']:enabled")`,
    'selectable booking option');
  await browser.evaluate(`(() => {
    const select = document.querySelector(${JSON.stringify(selector)});
    select.value = ${JSON.stringify(id)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

const bookingButton = text => `[...document.querySelectorAll('button')].find(button => !button.disabled && button.textContent === ${JSON.stringify(text)})`;
const bookingVisible = text => `document.querySelector('[aria-label="Session bookings"]')?.textContent.includes(${JSON.stringify(text)})`;

test('Booking management in Chrome displays transitions and handles stale conflicts and session expiry', browserTest, async () => {
  const { admin, session, clientId, otherClient, membership, time, otherMembership } = await dashboardBookingFixture();
  const { bookingId: otherBooking } = await relay(admin, 201, bookingApi, {
    method: 'POST', payload: { clientId: otherClient, membershipId: otherMembership.id, scheduledSessionId: session.id },
  });
  await withChrome(origin, clientName('client'), async browser => {
    for (const pair of admin.cookie.split('; ')) await browser.setCookie(origin, pair);
    await browser.go(schedulingPage);
    const link = `document.querySelector('a[href="/bookings?scheduledSessionId=${session.id}"]')`;
    await browser.until(link, 'Bookings link from Scheduling');
    await browser.evaluate(`${link}.click(); true`);
    await browser.until(bookingVisible('0 of 1 seats occupied'), 'available seat');
    await browser.evaluate(`(() => {
      const form = document.querySelector('form[aria-label="Find Client"]');
      form.elements.clientSearch.value = ${JSON.stringify(email('client'))};
      form.requestSubmit();
      return true;
    })()`);
    const clientSelect = '[aria-label="Session bookings"] > label select';
    const membershipSelect = '[aria-label="Create booking"] select';
    const createButton = 'Create pending booking';
    await bookingBrowserSelect(browser, clientSelect, clientId);
    await browser.until(bookingVisible('Membership has expired.'), 'expired membership reason');
    assert.equal(await browser.evaluate(`document.querySelector(${JSON.stringify(membershipSelect)}).value`), '');
    assert.equal(await browser.evaluate(`Boolean(${bookingButton(createButton)})`), false);
    await bookingBrowserSelect(browser, membershipSelect, membership.id);

    async function click(text) {
      const target = bookingButton(text);
      await browser.until(target, text);
      await browser.evaluate(`${target}.click(); true`);
    }

    await click(createButton);
    await browser.until(bookingVisible('Booking created as pending.'), 'new pending booking');
    const own = await fixture.booking.findFirstOrThrow({ where: { scheduledSessionId: session.id, clientId } });
    assert.equal(own.membershipId, membership.id);
    assert.equal(own.status, 'PENDING');

    // Use a separate writer so the open dashboard still shows an available seat.
    await relay(admin, 204, approvalPath(otherBooking), { method: 'POST' });
    const ownApprove = `[...document.querySelectorAll('tr')].find(row =>
      row.querySelector('a[href="/clients/${clientId}"]'))?.querySelector('button:first-of-type:enabled')`;
    await browser.until(ownApprove, 'pending booking approval');
    await browser.evaluate(`${ownApprove}.click(); true`);
    await browser.until(bookingVisible('Capacity may have changed'), 'capacity conflict');
    await browser.until(bookingVisible('1 of 1 seats occupied'), 'reloaded capacity');
    await relay(admin, 204, bookingApi + '/' + otherBooking + '/cancel', { method: 'POST', payload: { reason: 'Seat released' } });
    await click('Refresh bookings');
    await browser.until(bookingVisible('0 of 1 seats occupied'), 'released capacity');

    // Simulate an open dashboard whose selected session has since started.
    await fixture.scheduledSession.update({ where: { id: session.id }, data: {
      startsAt: new Date(+session.startsAt - 4 * 86400_000), endsAt: new Date(+session.endsAt - 4 * 86400_000),
    } });
    await click('Approve');
    await browser.until(bookingVisible('The scheduled session has already started.'), 'started session conflict');
    assert.equal((await fixture.booking.findUniqueOrThrow({ where: { id: own.id } })).status, 'PENDING');
    await fixture.scheduledSession.update({ where: { id: session.id }, data: { startsAt: session.startsAt, endsAt: session.endsAt } });

    await fixture.membership.update({ where: { id: membership.id }, data: { validThrough: membership.validFrom } });
    await click('Approve');
    await browser.until(bookingVisible('no longer eligible for this session'), 'membership conflict');
    assert.equal((await fixture.booking.findUniqueOrThrow({ where: { id: own.id } })).status, 'PENDING');
    await fixture.membership.update({ where: { id: membership.id }, data: { validThrough: membership.validThrough } });
    await click('Approve');
    await browser.until(bookingVisible('Booking confirmed.'), 'confirmation displayed');

    const move = (offset, expectedRevision) => relay(admin, 204, scheduleApi + '/' + session.id, {
      method: 'PATCH', payload: { expectedRevision, coachId: session.coachId, startsAt: new Date(+session.startsAt + offset).toISOString() },
    });
    await move(10 * 86400_000, 1);
    await click('Refresh bookings');
    await browser.until(bookingVisible('Admin review required.'), 'review flag after move');
    assert(await browser.evaluate(bookingVisible('1 of 1 seats occupied')));

    const decision = "document.querySelector('form[aria-label=\"Booking decision\"]')";
    async function reason(action, value) {
      await click(action);
      await browser.until(`${decision}?.elements.reason`, 'booking reason form');
      await browser.evaluate(`(() => {
        const form = ${decision};
        form.elements.reason.value = ${JSON.stringify(value)};
        form.requestSubmit();
        return true;
      })()`);
    }
    await reason('Cancel booking', 'Membership no longer covers the moved session');
    await browser.until(bookingVisible('Booking cancelled.'), 'cancelled booking');
    await move(0, 2);
    await click('Refresh bookings');
    await bookingBrowserSelect(browser, membershipSelect, time.id);
    await click(createButton);
    await browser.until(bookingVisible('Booking created as pending.'), 'pending replacement');
    await reason('Reject', 'Client no longer wants to attend');
    await browser.until(bookingVisible('Booking rejected.'), 'rejection displayed');
    const terminal = await fixture.auditLog.findMany({
      where: { targetType: 'BOOKING', reason: { in: ['Membership no longer covers the moved session', 'Client no longer wants to attend'] } },
    });
    assert.deepEqual(terminal.map(row => row.action).sort(), ['BOOKING_CANCELLED', 'BOOKING_REJECTED']);

    await relay(admin, 204, scheduleApi + '/' + session.id + '/cancel', {
      method: 'POST', payload: { expectedRevision: 3, reason: 'Fixture finished' },
    });
    await click('Refresh bookings');
    await browser.until(bookingVisible('The scheduled session was cancelled.'), 'cancelled ScheduledSession');
    await browser.setCookie(origin, '__Host-ss_access=invalid');
    await click('Refresh bookings');
    await browser.until('location.pathname === "/" && location.search === "?session=expired"', 'expired booking session');
  });
});

test('Booking management in Chrome protects history after switching to a Staff account', browserTest, async t => {
  const { admin, session, clientId, membership } = await dashboardBookingFixture();
  await relay(admin, 201, bookingApi, { method: 'POST', payload: { clientId, membershipId: membership.id, scheduledSessionId: session.id } });
  await withChrome(origin, clientName('client'), async browser => {
    for (const pair of admin.cookie.split('; ')) await browser.setCookie(origin, pair);
    await browser.go(bookingsPath + bookingQuery(session.id));
    await browser.until(bookingVisible(clientName('client')), 'Admin booking data');
    await browser.evaluate(`document.querySelector('nav a[href="/"]').click(); true`);
    await browserSignOut(browser);
    await browserSignIn(browser, 'noGrant');
    await traverseHistory(t, browser, 'Back', bookingsPath,
      alertIs('Your account does not have access to Booking management.'), { denied: true, fresh: true });
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Session bookings"]') === null`), true);
  });
});

const attendancePage = '/attendance';
const attendanceDetail = id => 'attendance/sessions/' + id;
const attendanceLink = id => attendancePage + bookingQuery(id);
const attendanceVisible = text => `document.querySelector('[aria-label="Session attendance"]')?.textContent.includes(${JSON.stringify(text)})`;

async function dashboardAttendanceFixture(minutesAgo, adminSession) {
  const { admin, session, clientId, otherClient, membership, otherMembership } = await dashboardBookingFixture(adminSession);
  const { id: coachId } = await fixture.user.findUniqueOrThrow({ where: { normalizedEmail: email('coach') } });
  const startsAt = new Date(Date.now() - minutesAgo * 60_000);
  const endsAt = new Date(+startsAt + 60 * 60_000);
  const own = await fixture.scheduledSession.update({ where: { id: session.id }, data: { coachId, startsAt, endsAt } });
  const foreign = await fixture.scheduledSession.create({ data: {
    coachId: session.coachId, sessionTypeId: session.sessionTypeId, startsAt, endsAt, capacity: 1, bufferMinutes: 0,
  } });
  const confirmed = await fixture.booking.create({ data: {
    clientId, membershipId: membership.id, scheduledSessionId: own.id, status: 'CONFIRMED',
  } });
  await fixture.booking.create({ data: {
    clientId: otherClient, membershipId: otherMembership.id, scheduledSessionId: own.id, status: 'PENDING',
  } });
  return { admin, coach: await signIn('coach'), own, foreign, confirmed };
}

test('Attendance relay enforces exact scope, methods, projection and write protections', async () => {
  const { admin, coach, own, foreign, confirmed } = await dashboardAttendanceFixture(180);
  const path = attendanceDetail(own.id);
  const submit = path + '/submit';
  const payload = { expectedScheduleRevision: own.revision,
    entries: [{ bookingId: confirmed.id, expectedRevision: 0, outcome: 'ATTENDED' }] };
  const post = { method: 'POST', payload, key: randomUUID() };
  const before = upstreamRequests;
  await relay(coach, 404, 'attendance/sessions/bad-id');
  await relay(coach, 404, path + '/verify', post);
  await relay(coach, 405, path, post);
  await relay(coach, 405, path, { method: 'OPTIONS' });
  const wrongMethod = await fetch(origin + '/api/studio/v1/' + submit);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('allow'), 'POST');
  assert.equal(wrongMethod.headers.get('cache-control'), 'no-store');
  await relay(coach, 400, path + '?limit=2&limit=3');
  await relay(coach, 400, 'scheduling/my-sessions' + scheduleWindow() + '&coachId=' + own.coachId);
  await relay(coach, 400, submit + '?extra=yes', post);
  assert.deepEqual(await relay(coach, 403, submit, { ...post, source: 'https://invalid.example' }), { code: 'CSRF_DENIED' });
  const forgedHost = await new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = httpRequest(origin + '/api/studio/v1/' + submit, {
      method: 'POST', headers: { host: 'invalid.example', origin, cookie: coach.cookie, 'x-csrf-token': coach.csrf,
        'idempotency-key': post.key, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, response => {
      let raw = '';
      response.setEncoding('utf8').on('data', chunk => { raw += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, cache: response.headers['cache-control'], raw }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(body);
  });
  assert.deepEqual(forgedHost, { status: 403, cache: 'no-store', raw: '{"code":"CSRF_DENIED"}' });
  assert.deepEqual(await relay(coach, 403, submit, { ...post, csrf: admin.csrf }), { code: 'CSRF_DENIED' });
  assert.deepEqual(await relay(coach, 400, submit, { ...post, key: '' }), { code: 'INVALID_IDEMPOTENCY_KEY' });
  await relay(coach, 413, submit, { ...post, payload: { fields: 'x'.repeat(17_000) } });
  assert.equal(upstreamRequests, before);
  await relay({ cookie: '' }, 401, path);
  await relay(coach, 404, attendanceDetail(foreign.id));
  await relay(admin, 403, submit, post);
  const roster = await relay(coach, 200, path);
  assert.deepEqual(roster.items, [{ bookingId: confirmed.id, clientDisplayName: clientName('client'),
    bookingStatus: 'CONFIRMED', revision: 0, outcome: null, reviewStatus: 'UNSUBMITTED', submittedAt: null }]);
  assert.doesNotMatch(JSON.stringify(roster), /membership|payment|purchase|commission|private fixture/i);
  await relay(coach, 204, submit, post);
  await relay(coach, 204, submit, post);
  assert.equal((await relay(admin, 200, path)).items[0].reviewStatus, 'PENDING_REVIEW');
  assert.equal(await fixture.attendanceRevision.count({ where: { bookingId: confirmed.id } }), 1);
});

test('Attendance in Chrome supports Coach submission and Admin read-only review, including account switch', browserTest, async t => {
  const { admin, coach, own, foreign, confirmed } = await dashboardAttendanceFixture(30, await login('admin'));
  const staff = await signIn('noGrant');
  await withChrome(origin, clientName('client'), async browser => {
    async function useSession(actor) {
      for (const pair of actor.cookie.split('; ')) await browser.setCookie(origin, pair);
    }
    await useSession(coach);
    await browser.go('/');
    await browser.until(`document.querySelector('a[href="/attendance"]')?.textContent === 'Attendance'`, 'Coach attendance link');
    await browser.evaluate(`document.querySelector('a[href="/attendance"]').click(); true`);
    const ownLink = `document.querySelector('a[href="${attendanceLink(own.id)}"]')`;
    await browser.until(ownLink, 'assigned session on Coach list');
    assert.equal(await browser.evaluate(`!!document.querySelector('a[href="${attendanceLink(foreign.id)}"]')`), false);
    await browser.evaluate(ownLink + '.click(); true');
    await browser.until(attendanceVisible(clientName('client')), 'confirmed attendance roster');
    assert.equal(await browser.evaluate(`!!(${attendanceVisible(clientName('clientSecond'))})`), false);
    await browser.until(`document.querySelector('[aria-label="Session attendance"] input[type=checkbox]')`, 'attendance selection');
    await browser.evaluate(`document.querySelector('[aria-label="Session attendance"] input[type=checkbox]').click(); true`);
    await browser.until(`[...document.querySelectorAll('button')].some(b => b.textContent === 'Submit attendance' && !b.disabled)`,
      'submit enabled after selection');
    await browser.evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Submit attendance').click(); true`);
    await browser.until(attendanceVisible('Pending review'), 'pending attendance after submission refresh');
    assert.equal(await fixture.attendanceRevision.count({ where: { bookingId: confirmed.id } }), 1);

    await browser.go(attendanceLink(foreign.id));
    await browser.until(alertIs('This scheduled session or participant could not be found.'), 'cross-Coach direct URL denial');
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Session attendance"] table') === null`), true);

    await useSession(admin);
    await browser.go(schedulingPage);
    const reviewLink = `document.querySelector('a[href="${attendanceLink(own.id)}"]')`;
    const riyadhDate = new Intl.DateTimeFormat('en-CA', { dateStyle: 'short', timeZone: 'Asia/Riyadh' }).format(own.startsAt);
    await browser.until(`document.querySelector('form[aria-label="Schedule filters"] input[name=from]')`, 'Admin scheduling filters');
    await browser.evaluate(`(() => {
      const filter = document.querySelector('form[aria-label="Schedule filters"]');
      filter.elements.from.value = ${JSON.stringify(riyadhDate)};
      filter.requestSubmit();
      return true;
    })()`);
    await browser.until(reviewLink, 'Admin review attendance link');
    await browser.evaluate(reviewLink + '.click(); true');
    await browser.until(`(${attendanceVisible(clientName('client'))}) && (${attendanceVisible('Pending review')})`, 'Admin pending review');
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Session attendance"] input[type=checkbox]') === null`), true);
    await browser.evaluate(`document.querySelector('nav a[href="/"]').click(); true`);
    await browser.until('location.pathname === "/" && document.readyState === "complete"', 'returned to dashboard');
    await useSession(staff);
    await traverseHistory(t, browser, 'Back', attendancePage, alertIs('Your account does not have access to Attendance.'),
      { denied: true, fresh: true });
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Session attendance"]') === null`), true);
  });
});

test('Attendance return and reaffirmation relay preserves participant history and all write protections', async () => {
  const { admin, coach, own, foreign, confirmed } = await dashboardAttendanceFixture(90);
  const path = attendanceDetail(own.id);
  const record = path + '/participants/' + confirmed.id;
  const second = await fixture.booking.findFirstOrThrow({ where: { scheduledSessionId: own.id, status: 'PENDING' } });
  await fixture.booking.update({ where: { id: second.id }, data: { status: 'CONFIRMED' } });
  await relay(coach, 204, path + '/submit', { method: 'POST', payload: { expectedScheduleRevision: own.revision,
    entries: [{ bookingId: confirmed.id, expectedRevision: 0, outcome: 'ATTENDED' },
      { bookingId: second.id, expectedRevision: 0, outcome: 'ATTENDED' }] } });
  const original = await relay(coach, 200, record);
  const payload = { expectedScheduleRevision: own.revision, expectedRevision: 1, reason: 'Recheck this participant completion.' };
  const intent = { method: 'POST', payload, key: randomUUID() };
  const before = upstreamRequests;
  await relay(admin, 403, record + '/return', { ...intent, source: 'https://wrong.example' });
  await relay(admin, 403, record + '/return', { ...intent, csrf: coach.csrf });
  const forgedHost = await new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = httpRequest(origin + '/api/studio/v1/' + record + '/return', {
      method: 'POST', headers: { host: 'wrong.example', origin, cookie: admin.cookie, 'x-csrf-token': admin.csrf,
        'idempotency-key': intent.key, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(body);
  });
  assert.equal(forgedHost, 403);
  await relay(admin, 400, record + '/return', { ...intent, key: '' });
  await relay(admin, 400, record + '/return?extra=yes', intent);
  await relay(admin, 413, record + '/return', { ...intent, payload: { reason: 'x'.repeat(17_000) } });
  await relay(admin, 405, record + '/return', { allow: 'POST' });
  await relay(admin, 405, record + '/return', { method: 'PATCH', payload, allow: 'POST' });
  await relay(admin, 404, record + '/verify', intent);
  await relay(admin, 404, record + '/return/extra', intent);
  await relay(admin, 400, record + '?limit=2&limit=3');
  assert.equal(upstreamRequests, before);
  await relay({ cookie: '' }, 401, record);
  await relay(coach, 403, record + '/return', intent);
  await relay(admin, 400, record + '/return', { ...intent, payload: { ...payload, reason: '  ' } });
  await relay(admin, 204, record + '/return', intent);
  await relay(admin, 204, record + '/return', intent);
  const detail = await relay(admin, 200, path);
  assert.equal(detail.items.find(row => row.bookingId === confirmed.id).reviewStatus, 'RETURNED');
  assert.equal(detail.items.find(row => row.bookingId === second.id).reviewStatus, 'PENDING_REVIEW');
  const returned = await relay(coach, 200, record);
  assert.equal(returned.items[0].reviewDecision.reason, payload.reason);
  assert.equal(returned.items[0].reviewDecision.decision, 'RETURNED');
  assert.doesNotMatch(JSON.stringify(returned), /membership|payment|purchase|commission|normalizedEmail/i);
  const reaffirm = { method: 'POST', key: randomUUID(), payload: { expectedScheduleRevision: own.revision,
    expectedRevision: 1, reviewedReturnId: returned.items[0].reviewDecision.id, outcome: 'ATTENDED' } };
  const beforeReaffirm = upstreamRequests;
  await relay(coach, 403, record + '/reaffirm', { ...reaffirm, source: 'https://wrong.example' });
  await relay(coach, 403, record + '/reaffirm', { ...reaffirm, csrf: admin.csrf });
  await relay(coach, 400, record + '/reaffirm', { ...reaffirm, key: '' });
  await relay(coach, 405, record + '/reaffirm', { allow: 'POST' });
  assert.equal(upstreamRequests, beforeReaffirm);
  await relay(admin, 403, record + '/reaffirm', reaffirm);
  for (const name of ['noGrant', 'client']) {
    const actor = await signIn(name);
    await relay(actor, 403, record);
    await relay(actor, 403, record + '/return', intent);
    await relay(actor, 403, record + '/reaffirm', reaffirm);
  }
  await relay(coach, 404, attendanceDetail(foreign.id) + '/participants/' + confirmed.id);
  await relay(coach, 404, attendanceDetail(foreign.id) + '/participants/' + confirmed.id + '/reaffirm', reaffirm);
  await relay(coach, 409, record + '/reaffirm', { ...reaffirm, payload: { ...reaffirm.payload, reviewedReturnId: randomUUID() } });
  await relay(coach, 204, record + '/reaffirm', reaffirm);
  await relay(coach, 204, record + '/reaffirm', reaffirm);
  assert.equal((await relay(admin, 200, path)).items.find(row => row.bookingId === confirmed.id).reviewStatus, 'PENDING_REVIEW');
  const history = await relay(admin, 200, record);
  assert.equal(history.items.length, 2);
  assert.deepEqual(history.items[1], returned.items[0]);
  assert.equal(history.items[0].submissionKind, 'REAFFIRMATION');
  assert.equal(original.items[0].id, history.items[1].id);
  const page = await relay(coach, 200, record + '?limit=1');
  assert.deepEqual((await relay(coach, 200, record + '?after=' + page.nextCursor)).items, [history.items[1]]);
  await relay(coach, 409, record + '/reaffirm', { ...reaffirm, key: randomUUID(), payload: { ...reaffirm.payload, expectedRevision: 2 } });
});

test('Attendance in Chrome returns one participant and requires reviewing the reason before Coach reaffirmation', browserTest, async () => {
  const { admin, coach, own, confirmed } = await dashboardAttendanceFixture(300, await login('admin'));
  const path = attendanceDetail(own.id);
  await withChrome(origin, clientName('client'), async browser => {
    async function useSession(actor) {
      for (const pair of actor.cookie.split('; ')) await browser.setCookie(origin, pair);
      await browser.go(attendanceLink(own.id));
      await browser.until(attendanceVisible(clientName('client')), 'attendance roster');
    }
    const button = label => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
    const open = button('Review ' + clientName('client'));
    const returnButton = button('Return to Coach');
    const reaffirmButton = button('Reaffirm Attended');
    await useSession(coach);
    assert.equal(await browser.evaluate(`!!(${open}) || !!(${reaffirmButton})`), false);
    await relay(coach, 204, path + '/submit', { method: 'POST', payload: { expectedScheduleRevision: own.revision,
      entries: [{ bookingId: confirmed.id, expectedRevision: 0, outcome: 'ATTENDED' }] } });
    await useSession(coach);
    await browser.until(open, 'participant review control');
    await browser.evaluate(open + '.click(); true');
    await browser.until(`document.querySelector('[aria-label="Attendance history"]')`, 'original attendance history');
    assert.equal(await browser.evaluate(`!!(${reaffirmButton})`), false);

    await useSession(admin);
    await browser.until(open, 'Admin participant review');
    await browser.evaluate(open + '.click(); true');
    await browser.until(returnButton, 'mandatory reason form');
    assert.equal(await browser.evaluate(returnButton + '.disabled'), true);
    assert.equal(await browser.evaluate(`document.querySelector('textarea').required`), true);
    await browser.evaluate(`(() => {
      const input = document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Please review the participant completion.');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await browser.until(`!(${returnButton}).disabled`, 'return enabled with reason');
    await browser.evaluate(returnButton + '.click(); true');
    await browser.until(attendanceVisible('Attendance returned to the Coach.'), 'Admin returned status');
    await browser.until(`document.querySelector('[aria-label="Attendance history"]')?.textContent.includes('Please review the participant completion.')`, 'return history');
    assert.equal(await browser.evaluate(`!!(${returnButton})`), false);

    await useSession(coach);
    await browser.until(attendanceVisible('Returned'), 'Coach returned status');
    await browser.evaluate(open + '.click(); true');
    await browser.until(reaffirmButton, 'Coach reaffirmation control');
    assert.equal(await browser.evaluate(reaffirmButton + '.disabled'), true);
    assert.equal(await browser.evaluate(`document.querySelector('[aria-label="Attendance history"]').textContent.includes('Please review the participant completion.')`), true);
    await browser.evaluate(`document.querySelector('section[aria-label^="Attendance record for"] input[type=checkbox]').click(); true`);
    await browser.until(`!(${reaffirmButton}).disabled`, 'reaffirm enabled after reason acknowledgment');
    await browser.evaluate(reaffirmButton + '.click(); true');
    await browser.until(attendanceVisible('Attendance reaffirmed and submitted for review.'), 'reaffirmation success');
    await browser.until(`document.querySelector('[aria-label="Attendance history"]')?.textContent.includes('Coach reaffirmation')`, 'new immutable revision');
    assert.equal(await browser.evaluate(`!!(${reaffirmButton})`), false);
    const history = await relay(admin, 200, path + '/participants/' + confirmed.id);
    assert.equal(history.items.length, 2);
    assert.equal(history.items[0].reviewDecision, null);
    assert.equal(history.items[1].reviewDecision.reason, 'Please review the participant completion.');
  });
});



async function s1Fixture(price = '20.00') {
  const admin = await signIn('admin');
  const [client, adminUser] = await Promise.all(['client','admin'].map(key => fixture.user.findUniqueOrThrow({ where: { normalizedEmail: email(key) } })));
  const code = 'S1-' + randomBytes(5).toString('hex');
  const { sessionTypeId } = await relay(admin, 201, 'session-types', { method: 'POST', payload: { code, name: code, mode: 'INDIVIDUAL' } });
  const { packageId } = await relay(admin, 201, 'packages', { method: 'POST', payload: { code, name: code, description: '', price, kind: 'TIME', validityDays: 30, sessionAllowance: null, sessionTypeIds: [sessionTypeId] } });
  const { items: [version] } = await relay(admin, 200, `packages/${packageId}/management`);
  await relay(admin, 204, `packages/${packageId}/versions/${version.id}/publish`, { method: 'POST', payload: { expectedCurrentVersionId: null, expectedDraftRevision: 1 } });
  return { admin, client, adminUser, packageId, version, sessionTypeId, acceptance: { clientId: client.id, packageId, packageVersionId: version.id,
    agreementMethod: 'SIGNED_AGREEMENT', agreementEvidence: 'Synthetic signed agreement', purpose: 'S1-A regression' } };
}

test('S1-A commercial page and relay enforce Admin, exact methods, CSRF, input and audit scope', async () => {
  const f = await s1Fixture();
  for (const role of [null,'noGrant','reader','auditOnly','coach','client']) {
    const actor = role ? await signIn(role) : { cookie: '' };
    const page = await fetch(origin+'/commercial', { headers: { cookie: actor.cookie } });
    const html = await page.text();
    assert(html.includes(role ? 'Your account does not have access to Purchase operations.' : 'Sign in to continue.'));
    assert(!html.includes('name="agreementEvidence"'));
    await relay(actor, role ? 403 : 401, 'purchases/positive-price', { method: 'POST', payload: f.acceptance });
  }
  await relay(f.admin, 403, 'purchases/positive-price', { method: 'POST', payload: f.acceptance, csrf: 'wrong' });
  await relay(f.admin, 403, 'purchases/positive-price', { method: 'POST', payload: f.acceptance, source: 'https://other.invalid' });
  await relay(f.admin, 400, 'purchases/positive-price', { method: 'POST', payload: { ...f.acceptance, role: 'ADMIN' } });
  await relay(f.admin, 400, 'purchases/positive-price?extra=1', { method: 'POST', payload: f.acceptance });
  await relay(f.admin, 400, 'purchases/positive-price', { method: 'POST', payload: f.acceptance, key: '' });
  await relay(f.admin, 405, 'purchases/positive-price', { allow: 'POST' });
  await relay(f.admin, 405, 'payments', { method: 'PUT', payload: {}, allow: 'POST' });
  await relay(f.admin, 404, 'payments/not-a-uuid/verify', { method: 'POST', payload: {} });
  await relay(f.admin, 404, 'purchases/positive-price/extra', { method: 'POST', payload: f.acceptance });
  const accept = { method: 'POST', payload: f.acceptance, key: randomUUID() };
  const { purchaseId } = await relay(f.admin, 201, 'purchases/positive-price', accept);
  assert.deepEqual(await relay(f.admin, 201, 'purchases/positive-price', accept), { purchaseId });
  const record = { method: 'POST', key: randomUUID(), payload: { clientId: f.client.id, intakeId: randomUUID(), amount: '25.00', currency: 'SAR', method: 'CASH', receivedAt: new Date().toISOString() } };
  const { paymentId } = await relay(f.admin, 201, 'payments', record);
  assert.deepEqual(await relay(f.admin, 201, 'payments', record), { paymentId, status: 'UNVERIFIED' });
  const verify = { method: 'POST', key: randomUUID(), payload: {} };
  await relay(f.admin, 200, `payments/${paymentId}/verify`, verify);
  await relay(f.admin, 200, `payments/${paymentId}/verify`, verify);
  assert.equal((await relay(f.admin, 409, `payments/${paymentId}/allocations`, { method: 'POST', payload: { purchaseId, amount:'20.01' } })).code, 'PAYMENT_ALLOCATION_EXCEEDS_PURCHASE_PRICE');
  const allocation = { method:'POST', key:randomUUID(), payload:{ purchaseId, amount:'20.00' } };
  const allocated = await relay(f.admin,201,`payments/${paymentId}/allocations`,allocation);
  assert.deepEqual(await relay(f.admin,201,`payments/${paymentId}/allocations`,allocation),allocated);
  assert.equal((await relay(f.admin,200,membershipRoute(purchaseId))).status,'NOT_CREATED');
  await relay(await signIn('coach'),403,activationRoute(purchaseId),{method:'POST',payload:{}});
  await relay(f.admin,200,activationRoute(purchaseId),{method:'POST',payload:{}});
  assert.equal((await relay(f.admin,200,membershipRoute(purchaseId))).status,'ACTIVE');
  let cursor; const events=[];
  do {
    const page=await relay(f.admin,200,`purchases/${purchaseId}/audit?limit=2`+(cursor?'&after='+cursor:''));
    events.push(...page.items);cursor=page.nextCursor;
  } while(cursor);
  assert.equal(events.length,5);
  assert(events.every(x=>Object.keys(x).sort().join(',')==='action,actorId,createdAt,id,reason,requestId,targetId,targetType'));
  for(const role of ['auditOnly','client','coach']) await relay(await signIn(role),403,`purchases/${purchaseId}/audit`);
  await relay(f.admin,400,`purchases/${purchaseId}/audit?limit=51`);
  await relay(f.admin,400,`purchases/${purchaseId}/audit?limit=2&limit=3`);
  await relay(f.admin,405,`purchases/${purchaseId}/audit`,{method:'POST',payload:{},allow:'GET'});
});

test('S1-A in Chrome resumes every interrupted command and read, activates explicitly and protects account switches', { ...browserTest, timeout: 60_000 }, async () => {
  const f=await s1Fixture();
  await withChrome(origin,userPrefix,async browser=>{
    for(const pair of f.admin.cookie.split('; ')) await browser.setCookie(origin,pair);
    await browser.go('/commercial');
    await browser.until(`document.querySelector('select[name=clientId]:enabled option[value="${f.client.id}"]') && document.querySelector('select[name=packageVersionId] option[value="${f.version.id}"]')`,'commercial choices');
    async function set(name,value,kind='input') {
      await browser.evaluate(`(()=>{const e=document.querySelector('[name="${name}"]'); const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${kind}',{bubbles:true}));return true})()`);
    }
    const button = text => `(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`;
    await set('clientId',f.client.id,'change');await set('packageVersionId',f.version.id,'change');
    await set('agreementEvidence','Signed synthetic agreement');await set('purpose','S1-A browser regression');
    await browser.evaluate(`(()=>{window.s1Fetch=window.fetch;window.s1Requests=[];window.s1Fail='acceptance';window.fetch=async(input,options)=>{
      const url=String(input);const stage=url==='/api/studio/v1/purchases/positive-price'?'acceptance':url==='/api/studio/v1/payments'?'record':/payments\\/[^/]+\\/verify$/.test(url)?'verify':/payments\\/[^/]+\\/allocations$/.test(url)?'allocate':/activate-membership$/.test(url)?'activation':/\\/funding$/.test(url)?'funding':/\\/membership$/.test(url)?'membership':/\\/audit[?]/.test(url)?'audit':null;
      if(stage)window.s1Requests.push({stage,key:options?.headers?.['Idempotency-Key'],body:options?.body});
      if(stage&&stage===window.s1Csrf){window.s1Csrf=null;return Response.json({code:'CSRF_DENIED'},{status:403});}
      const result=await window.s1Fetch(input,options);if(stage&&stage===window.s1Fail&&result.ok){window.s1Fail=null;throw new TypeError('Synthetic lost response');}return result;};return true})()`);
    await browser.until(button('Record purchase acceptance'),'acceptance submit');
    await browser.until(`document.querySelector('[role=alert]') && [...document.querySelectorAll('button')].some(b=>b.textContent==='Retry same acceptance'&&!b.disabled)`,'acceptance retry available');
    assert.equal(await fixture.purchase.count({where:{packageVersionId:f.version.id}}),1);
    await browser.until(button('Retry same acceptance'),'retry acceptance');
    await browser.until(`document.querySelector('[name=amount]:enabled')`,'payment form');
    for(const stage of ['record','verify','allocate','funding','membership']) {
      if(stage==='verify') {
        await browser.evaluate(`window.s1Csrf='verify';true`);
        await browser.until(button('Retry remaining payment steps'),'CSRF rejection');
        await browser.until(`document.querySelector('[role=alert]')?.textContent.includes('CSRF_DENIED') && document.querySelector('[data-payment-id]')`,'preserved workflow after CSRF rejection');
      }
      await browser.evaluate(`window.s1Fail=${JSON.stringify(stage)};true`);
      await browser.until(button(stage==='record'?'Record, verify and allocate payment':'Retry remaining payment steps'),stage+' submit');
      await browser.until(`document.querySelector('[role=alert]') && [...document.querySelectorAll('button')].some(b=>b.textContent==='Retry remaining payment steps'&&!b.disabled)`,stage+' retry');
    }
    await browser.until(button('Retry remaining payment steps'),'final payment recovery');
    await browser.until(`document.querySelector('.membership-activation')?.textContent.includes('Pending activation')`,'explicit activation remains pending');
    const purchase=await fixture.purchase.findFirstOrThrow({where:{packageVersionId:f.version.id}});
    assert.equal(await fixture.membership.count({where:{purchaseId:purchase.id}}),0);
    const allocations=await fixture.paymentAllocation.findMany({where:{purchaseId:purchase.id}});assert.equal(allocations.length,1);
    const receipt=await fixture.payment.findUniqueOrThrow({where:{id:allocations[0].paymentId}});assert.equal(receipt.status,'VERIFIED');
    await browser.until(button('Activate membership'),'activation confirmation');
    await browser.evaluate(`window.s1Fail='activation';true`);
    await browser.until(button('Confirm activation'),'first activation');
    await browser.until(`document.querySelector('.membership-activation [role=alert]')`,'lost activation response');
    await browser.until(button('Confirm activation'),'activation replay');
    await browser.until(`document.querySelector('.membership-activation')?.textContent.includes('Membership activated.')`,'activated');
    await browser.evaluate(`window.s1Fail='audit';true`);
    await browser.until(button('Refresh history'),'audit request');
    await browser.until(`document.querySelector('[role=alert]')`,'audit retryable');
    await browser.until(button('Refresh history'),'audit retry');
    await browser.until(`document.querySelectorAll('.commercial-audit li').length===5`,'complete audit');
    if (process.env.STUDIO_TEST_SCREENSHOTS) await require('node:fs/promises').writeFile(resolve(process.env.STUDIO_TEST_SCREENSHOTS,'s1a-completed.png'), Buffer.from(await browser.screenshot(),'base64'));
    const requests=await browser.evaluate('window.s1Requests');
    for(const stage of ['acceptance','record','verify','allocate','activation']) {
      const attempts=requests.filter(x=>x.stage===stage);assert(attempts.length>=2,stage);assert.equal(new Set(attempts.map(x=>x.key)).size,1,stage+' key');assert.equal(new Set(attempts.map(x=>x.body)).size,1,stage+' body');
    }
    assert.equal(requests.filter(x=>x.stage==='allocate').length,2,'read failures must not replay acknowledged allocation');
    assert.equal(await fixture.membership.count({where:{purchaseId:purchase.id}}),1);
    const staff=await signIn('noGrant');for(const pair of staff.cookie.split('; ')) await browser.setCookie(origin,pair);
    await browser.until(button('Refresh history'),'account switch audit');
    await browser.until(`document.querySelector('[role=alert]')?.textContent==='Your account does not have access to Purchase operations.'`,'denied account switch');
    assert.equal(await browser.evaluate('document.querySelector("[data-purchase-id], [data-payment-id]")===null'),true);
    await browser.go('/commercial');
    await browser.until(`document.querySelector('[role=alert]')?.textContent==='Your account does not have access to Purchase operations.'`,'server page denies Staff');
  });
});

test('S1-A in Chrome pages active Clients and packages and requires a reasoned partial-funding activation', { ...browserTest, timeout:60_000 }, async()=>{
  const f=await s1Fixture('30.00');
  for(let n=0;n<24;n++) await fixture.user.create({data:{normalizedEmail:randomUUID()+'@example.invalid',role:'CLIENT',accountState:'ACTIVE',emailVerifiedAt:new Date(),client:{create:{displayName:'Paged Client '+n}}}});
  async function publishedFixture(code,price,id) {
    const pack=await fixture.package.create({data:{...(id?{id}:{}),code,versions:{create:{version:1,name:'Paged package',description:'',price,kind:'TIME',validityDays:30,eligibility:{create:{sessionTypeId:f.sessionTypeId}}}}},include:{versions:true}});
    await fixture.packageVersion.update({where:{id:pack.versions[0].id},data:{publishedAt:new Date()}});
    return pack;
  }
  for(let n=0;n<24;n++) await publishedFixture('PAGE-'+randomBytes(5).toString('hex').toUpperCase(),'0.00');
  const target=await publishedFixture('PAGE-TARGET','30.00','ffffffff-ffff-4fff-8fff-ffffffffffff');
  await withChrome(origin,userPrefix,async browser=>{
    for(const pair of f.admin.cookie.split('; ')) await browser.setCookie(origin,pair);
    await browser.go('/commercial');
    await browser.until(`document.querySelector('select[name=clientId]:enabled option:nth-child(2)')`,'first Client page');
    assert.equal(await browser.evaluate(`!!document.querySelector('select[name=clientId] option[value="${f.client.id}"]')`),false);
    for(const [field,value,label] of [['clientId',f.client.id,'Load more Clients'],['packageVersionId',target.versions[0].id,'Load more packages']]) {
      for(let page=0;page<8;page++) {
        if(await browser.evaluate(`!!document.querySelector('select[name=${field}] option[value="${value}"]')`)) break;
        await browser.until(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent===${JSON.stringify(label)});if(!b||b.disabled)return false;b.click();return true})()`,label);
        await browser.until(`document.querySelector('select[name=${field}]:enabled')`,'next page ready');
      }
      assert(await browser.evaluate(`!!document.querySelector('select[name=${field}] option[value="${value}"]')`));
    }
    const pending=await fixture.user.findUniqueOrThrow({where:{normalizedEmail:email('clientPending')}});
    assert.equal(await browser.evaluate(`!!document.querySelector('select[name=clientId] option[value="${pending.id}"]')`),false);
    async function set(name,value,event='input') {await browser.evaluate(`(()=>{const e=document.querySelector('[name=${name}]');const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${event}',{bubbles:true}));return true})()`);}
    const click=text=>browser.until(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!b||b.disabled)return false;b.click();return true})()`,text);
    await set('clientId',f.client.id,'change');await set('packageVersionId',target.versions[0].id,'change');await set('agreementMethod','VERBAL_AGREEMENT','change');
    await set('agreementEvidence','Synthetic verbal agreement');await set('purpose','Pagination and partial funding');
    await click('Record purchase acceptance');await browser.until(`document.querySelector('[name=amount]:enabled')`,'payment');
    await set('amount','10.00');await click('Record, verify and allocate payment');
    await browser.until(`document.querySelector('.membership-activation')`,'activation');
    await click('Activate membership');
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].find(x=>x.textContent==='Confirm activation').disabled`),true);
    await browser.evaluate(`document.querySelector('.activation-override input').click();true`);
    await browser.until(`document.querySelector('.activation-reason textarea')`,'reason');
    await browser.evaluate(`(()=>{const e=document.querySelector('.activation-reason textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'Approved synthetic partial funding');e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await click('Confirm activation');await browser.until(`document.querySelector('.membership-activation')?.textContent.includes('Membership activated.')`,'active');
    const purchase=await fixture.purchase.findFirstOrThrow({where:{packageVersionId:target.versions[0].id}});
    const audit=await fixture.auditLog.findFirstOrThrow({where:{targetType:'MEMBERSHIP',action:'MEMBERSHIP_ACTIVATED',redactedDetails:{path:['purchaseId'],equals:purchase.id}}});
    assert.equal(audit.reason,'Approved synthetic partial funding');
    assert.equal(audit.redactedDetails.remainingAmount,'20.00');
    assert.equal(audit.redactedDetails.overrideUsed,true);
  });
});

async function commercialSet(browser, name, value, event = 'input') {
  await browser.evaluate(`(()=>{const e=document.querySelector('[name="${name}"]');
    const p=e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('${event}',{bubbles:true}));return true})()`);
}

async function commercialClick(browser, label) {
  await browser.until(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)});
    if(!b||b.disabled)return false;b.click();return true})()`,label);
}

async function completeCommercialPayment(browser, f) {
  for (const pair of f.admin.cookie.split('; ')) await browser.setCookie(origin,pair);
  await browser.go('/commercial');
  await browser.until(`document.querySelector('[name=clientSearch]:enabled') && document.querySelectorAll('select[name=clientId] option').length>1`, 'initial commercial choices');
  await commercialSet(browser,'clientSearch',f.client.normalizedEmail);
  await commercialClick(browser,'Search Clients');
  await browser.until(`document.querySelector('select[name=clientId]:enabled option[value="${f.client.id}"]')`, 'selected Client');
  for (let page=0;page<8;page++) {
    if (await browser.evaluate(`!!document.querySelector('select[name=packageVersionId] option[value="${f.version.id}"]')`)) break;
    await commercialClick(browser,'Load more packages');
    await browser.until(`document.querySelector('select[name=packageVersionId]:enabled')`, 'next package page');
  }
  await browser.until(`document.querySelector('select[name=packageVersionId] option[value="${f.version.id}"]')`, 'selected package');
  await commercialSet(browser,'clientId',f.client.id,'change');
  await commercialSet(browser,'packageVersionId',f.version.id,'change');
  await commercialSet(browser,'agreementEvidence','Synthetic review regression agreement');
  await commercialSet(browser,'purpose','S1-A review regression');
  await commercialClick(browser,'Record purchase acceptance');
  await browser.until(`document.querySelector('[name=amount]:enabled')`, 'purchase accepted');
  await commercialClick(browser,'Record, verify and allocate payment');
  await browser.until(`document.querySelector('.membership-activation')?.textContent.includes('Pending activation')`, 'payment complete');
  return browser.evaluate(`document.querySelector('[data-purchase-id]').textContent`);
}

const concealedCommercialData = `!document.querySelector('.commercial-workspace, [data-purchase-id], [data-payment-id], .commercial-audit, .terms, [name=clientId], [name=agreementEvidence]')`;
const commercialDenied = `document.querySelector('[role=alert]')?.textContent==='Your account does not have access to Purchase operations.'`;

test('S1-A in Chrome clears the entire commercial workflow after activation is denied to a changed account', { ...browserTest, timeout:60_000 }, async () => {
  const f=await s1Fixture();
  await withChrome(origin,userPrefix,async browser=>{
    const purchaseId=await completeCommercialPayment(browser,f);
    await commercialClick(browser,'Refresh history');
    await browser.until(`document.querySelectorAll('.commercial-audit li').length===4`, 'loaded commercial audit');
    await commercialClick(browser,'Activate membership');
    await browser.evaluate(`window.s1StaleConfirmation=document.querySelector('.activation-confirmation');true`);
    const coach=await signIn('coach');
    for(const pair of coach.cookie.split('; ')) await browser.setCookie(origin,pair);
    await commercialClick(browser,'Confirm activation');
    await browser.until(commercialDenied, 'parent workspace denied');
    assert.equal(await browser.evaluate(concealedCommercialData),true);
    assert.equal(await browser.evaluate(`document.querySelectorAll('form,button').length`),0);
    assert.equal(await fixture.membership.count({where:{purchaseId}}),0);
    const allocationCount=await fixture.paymentAllocation.count({where:{purchaseId}});
    // Restoring cookies alone must not resurrect the invalidated workflow or its old event handlers.
    for(const pair of f.admin.cookie.split('; ')) await browser.setCookie(origin,pair);
    await browser.evaluate(`window.s1StaleConfirmation.requestSubmit();true`);
    await browser.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    assert.equal(await browser.evaluate(`(${commercialDenied}) && (${concealedCommercialData})`),true);
    assert.equal(await fixture.membership.count({where:{purchaseId}}),0);
    assert.equal(await fixture.paymentAllocation.count({where:{purchaseId}}),allocationCount);
    await browser.go('/commercial');
    await browser.until(`document.querySelector('[name=clientSearch]:enabled')`, 'fresh authorized workflow');
    assert.equal(await browser.evaluate(`!document.querySelector('[data-purchase-id], [data-payment-id], .commercial-audit')`),true);
  });
});

test('S1-A in Chrome clears stale activation conflicts only after a successful authoritative refresh', { ...browserTest, timeout:60_000 }, async () => {
  const f=await s1Fixture();
  await withChrome(origin,userPrefix,async browser=>{
    const purchaseId=await completeCommercialPayment(browser,f);
    await relay(f.admin,200,`purchases/${purchaseId}/activate-membership`,{method:'POST',payload:{}});
    await commercialClick(browser,'Activate membership');await commercialClick(browser,'Confirm activation');
    await browser.until(`document.querySelector('.membership-activation [role=alert]')?.textContent.includes('already been activated')`, 'concurrent activation conflict');
    await browser.evaluate(`(()=>{const real=window.fetch;window.s1FailRefresh=true;window.fetch=(input,options)=>{
      if(window.s1FailRefresh && String(input).endsWith('/funding')){window.s1FailRefresh=false;return Promise.resolve(Response.json({code:'DASHBOARD_UNAVAILABLE'},{status:503}));}
      return real(input,options);};return true})()`);
    await commercialClick(browser,'Refresh purchase');
    await browser.until(`document.querySelector('.commercial-workspace')?.getAttribute('aria-busy')==='false' && document.querySelector('.membership-activation [role=alert]')`, 'failed refresh retains conflict');
    await commercialClick(browser,'Refresh purchase');
    await browser.until(`document.querySelector('.membership-activation p')?.textContent==='Active' && document.querySelector('.commercial-workspace')?.getAttribute('aria-busy')==='false'`, 'refreshed authoritative Membership');
    assert.equal(await browser.evaluate(`document.querySelector('.membership-activation [role=alert], .activation-confirmation')===null`),true);
    assert.equal(await browser.evaluate(`document.querySelectorAll('.membership-activation button').length`),0);
    assert.equal(await fixture.membership.count({where:{purchaseId}}),1);
  });
});

test('S1-A in Chrome invalidates Client pagination when the edited search query changes', { ...browserTest, timeout:60_000 }, async () => {
  const a='QUERY-A-'+randomBytes(4).toString('hex'),b='QUERY-B-'+randomBytes(4).toString('hex');
  for(const query of [a,b]) for(let n=0;n<22;n++) await fixture.user.create({data:{normalizedEmail:randomUUID()+'@example.invalid',role:'CLIENT',accountState:'ACTIVE',emailVerifiedAt:new Date(),client:{create:{displayName:query+' '+n}}}});
  const admin=await signIn('admin');
  await withChrome(origin,userPrefix,async browser=>{
    for(const pair of admin.cookie.split('; ')) await browser.setCookie(origin,pair);
    await browser.go('/commercial');
    await browser.until(`document.querySelector('[name=clientSearch]:enabled') && document.querySelectorAll('select[name=clientId] option').length>1`, 'search ready');
    await browser.evaluate(`(()=>{const real=window.fetch;window.s1ClientPages=[];window.fetch=async(input,options)=>{
      const response=await real(input,options);if(String(input).startsWith('/api/studio/v1/clients?')){
        const query=new URL(String(input),location.origin).searchParams;const page=await response.clone().json();
        window.s1ClientPages.push({q:query.get('q'),after:query.get('after'),next:page.nextCursor,status:response.status});}
      return response;};return true})()`);
    await commercialSet(browser,'clientSearch',a);await commercialClick(browser,'Search Clients');
    await browser.until(`document.querySelectorAll('select[name=clientId] option').length===21 && document.querySelector('[name=clientSearch]:enabled')`, 'first query A page');
    await browser.evaluate(`window.s1OldLoadMore=[...document.querySelectorAll('button')].find(x=>x.textContent==='Load more Clients');true`);
    await commercialSet(browser,'clientSearch',b);
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].some(x=>x.textContent==='Load more Clients')`),false);
    await browser.evaluate(`window.s1OldLoadMore.click();true`);
    assert.equal(await browser.evaluate('window.s1ClientPages.length'),1,'Editing the query must invalidate the old paging operation');
    await commercialClick(browser,'Search Clients');
    await browser.until(`document.querySelector('[name=clientSearch]:enabled') && document.querySelectorAll('select[name=clientId] option').length===21`, 'first query B page');
    await commercialClick(browser,'Load more Clients');
    await browser.until(`document.querySelectorAll('select[name=clientId] option').length===23 && document.querySelector('[name=clientSearch]:enabled')`, 'query B next page');
    const pages=await browser.evaluate('window.s1ClientPages');
    assert.deepEqual(pages.map(x=>[x.q,x.after,x.status]),[[a,null,200],[b,null,200],[b,pages[1].next,200]]);
    assert.notEqual(pages[0].next,pages[1].next);
    assert.equal(await browser.evaluate(`document.querySelector('[role=alert]')===null`),true);
  });
});

test('S1-A in Chrome discards delayed refresh data and aborts requests after authorization is lost', { ...browserTest, timeout:60_000 }, async () => {
  const f=await s1Fixture();
  await withChrome(origin,userPrefix,async browser=>{
    const purchaseId=await completeCommercialPayment(browser,f);
    await relay(f.admin,200,`purchases/${purchaseId}/activate-membership`,{method:'POST',payload:{}});
    await commercialClick(browser,'Activate membership');await commercialClick(browser,'Confirm activation');
    await browser.until(`document.querySelector('.membership-activation [role=alert]')`, 'activation conflict');
    await browser.evaluate(`(()=>{const real=window.fetch;window.fetch=async(input,options)=>{
      const url=String(input);
      if(url.endsWith('/funding')){const response=await real(input,options);const body=await response.json();
        window.s1RefreshSignal=options.signal;window.s1FundingReady=true;
        return new Promise(resolve=>{window.s1ReleaseFunding=()=>resolve(Response.json(body));});}
      if(url.endsWith('/membership')) await new Promise(resolve=>{window.s1ReleaseMembership=resolve;});
      return real(input,options);};return true})()`);
    await commercialClick(browser,'Refresh purchase');
    await browser.until(`window.s1FundingReady && !!window.s1ReleaseMembership`, 'held authorized funding response');
    const coach=await signIn('coach');
    for(const pair of coach.cookie.split('; ')) await browser.setCookie(origin,pair);
    await browser.evaluate(`window.s1ReleaseMembership();true`);
    await browser.until(commercialDenied, 'authorization loss invalidates workspace');
    assert.equal(await browser.evaluate('window.s1RefreshSignal?.aborted===true'),true);
    assert.equal(await browser.evaluate(concealedCommercialData),true);
    // Deliberately release a stale success despite the aborted signal to exercise the state guard.
    await browser.evaluate(`window.s1ReleaseFunding();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    assert.equal(await browser.evaluate(`(${commercialDenied}) && (${concealedCommercialData})`),true);
    assert.equal(await browser.evaluate(`document.querySelectorAll('form,button').length`),0);
    assert.equal(await fixture.membership.count({where:{purchaseId}}),1);
  });
});

test('catalog relay returns a safe service unavailable response when the backend stops', async () => {
  const admin = await signIn('admin');
  await api.close();
  api = undefined;
  assert.equal((await relay(admin, 503, 'packages')).code, 'DASHBOARD_UNAVAILABLE');
  assert.deepEqual(await relay(admin, 503, fundingRoute(randomUUID())), { code: 'DASHBOARD_UNAVAILABLE' });
});
