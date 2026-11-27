const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { createServer } = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { resolve } = require('node:path');
const { writeFile } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('../../backend/node_modules/@prisma/client');
const { startApp } = require('../../backend/dist/app.js');
const { loadConfig } = require('../../backend/dist/platform/config.js');
const { hashPassword } = require('../../backend/dist/identity/password.js');
const { OnboardingDeliveryService, FakeVerificationTransport } = require('../../backend/dist/onboarding/delivery.service.js');
const { withChrome } = require('./chrome.cjs');
const dbName = 'studio_s2a_dashboard_' + randomBytes(6).toString('hex'), password = 'dashboard onboarding passphrase';
let control, db, app, dashboard, origin, adminId, staffId, created = false, upstreamRequests = 0;
const browserTest = { skip: !process.env.STUDIO_TEST_CHROME, timeout: 60000 };
before(async () => {
  const api = new URL(process.env.DATABASE_URL), owner = new URL(process.env.MIGRATION_DATABASE_URL);
  for (const url of [api, owner]) { assert(['127.0.0.1', 'localhost'].includes(url.hostname)); assert.equal(url.pathname, '/strength_studio'); }
  assert.equal(api.host, owner.host); assert.equal(api.username, 'studio_api');
  const c = new URL(owner); c.pathname = '/postgres'; control = new PrismaClient({ datasourceUrl: c.href });
  await control.$executeRawUnsafe(`CREATE DATABASE "${dbName}" TEMPLATE "strength_studio"`); created = true;
  owner.pathname = api.pathname = '/' + dbName; db = new PrismaClient({ datasourceUrl: owner.href });
  const hash = await hashPassword(password);
  const admin = await db.user.create({ data: { normalizedEmail: 'admin@s2a-dashboard.example', role: 'ADMIN', accountState: 'ACTIVE', emailVerifiedAt: new Date(), passwordHash: hash } });
  adminId = admin.id;
  const staff = await db.user.create({ data: { normalizedEmail: 'staff@s2a-dashboard.example', role: 'STAFF', accountState: 'ACTIVE', emailVerifiedAt: new Date(), passwordHash: hash } });
  staffId = staff.id; await db.staffGrant.create({ data: { staffUserId: staffId, changedById: adminId, permission: 'CLIENT_MANAGE' } });
  const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; await new Promise(r => server.close(r));
  origin = 'http://127.0.0.1:' + port;
  app = await startApp({ ...loadConfig({ ...process.env, DATABASE_URL: api.href, DASHBOARD_ORIGIN: origin }), host: '127.0.0.1', port: 0, onboardingKey: randomBytes(32) });
  app.getHttpServer().on('request', () => { upstreamRequests++; });
  dashboard = spawn(process.execPath, [resolve(__dirname, '../node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: resolve(__dirname, '..'), env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', DASHBOARD_ORIGIN: origin,
      API_BASE_URL: await app.getUrl(), DASHBOARD_CSRF_KEY: randomBytes(32).toString('hex') }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = ''; dashboard.stderr.on('data', b => { errors += b; });
  for (let i = 0; i < 100; i++) { if ((await fetch(origin).catch(() => null))?.ok) return; await delay(100); }
  throw new Error('Dashboard failed to start: ' + errors);
});
after(async () => {
  if (dashboard && dashboard.exitCode === null) { const exit = once(dashboard, 'exit'); dashboard.kill('SIGTERM'); await exit; }
  await app?.close(); await db?.$disconnect();
  if (created) await control.$executeRawUnsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`); await control?.$disconnect();
});
function merge(jar, response) {
  for (const value of response.headers.getSetCookie()) { const [pair] = value.split(';'); const at = pair.indexOf('='); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
}
const cookie = jar => [...jar].map(([k, v]) => k + '=' + v).join('; ');
async function call(path, body, jar = new Map(), extra = {}, method = 'POST') {
  const response = await fetch(origin + path, { method, headers: { cookie: cookie(jar), origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  merge(jar, response); const result = response.status === 204 ? null : await response.json(); return { response, result };
}
const signed = new Map();
async function login(role) {
  if (!signed.has(role)) { const jar = new Map(); const r = await call('/api/session/login', { email: role + '@s2a-dashboard.example', password }, jar); assert.equal(r.response.status, 200); signed.set(role, jar); }
  return new Map(signed.get(role));
}
async function write(path, body, jar, extra = {}) {
  const csrf = await call('/api/session/csrf', undefined, jar, {}, 'GET');
  return call('/api/studio/v1/' + path, body, jar, { 'X-CSRF-Token': csrf.result.csrfToken, 'X-Studio-Actor': adminId, 'Idempotency-Key': randomUUID(), ...extra });
}
async function invite() {
  const jar = await login('admin'), email = randomUUID() + '@s2a-dashboard.example';
  const r = await write('users/invite', { email, displayName: 'Dashboard Client' }, jar);
  assert.equal(r.response.status, 201, JSON.stringify(r.result)); return { ...r.result, email, jar };
}
const proof = url => new URLSearchParams(new URL(url).hash.slice(1)).get('token');
async function publicCall(action, body, jar) {
  const challenge = await call('/api/onboarding/csrf', undefined, jar, {}, 'GET');
  return call('/api/onboarding/' + action, body, jar, { 'X-Onboarding-CSRF': challenge.result.csrfToken });
}
async function field(browser, name, value) {
  await browser.evaluate(`(()=>{const e=document.querySelector('[name=${name}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
}
async function click(browser, text) { await browser.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent===${JSON.stringify(text)});if(!e||e.disabled)throw new Error('Button unavailable');e.click();return true})()`); }

test('S2-A Admin relay enforces identity, Origin, CSRF, payload and Staff read boundary', async () => {
  const admin = await login('admin'), staff = await login('staff'), body = { email: randomUUID() + '@s2a-dashboard.example', displayName: 'Secure' };
  for (const extra of [{ origin: 'https://untrusted.invalid' }, { 'X-CSRF-Token': '' }, { 'X-Studio-Actor': staffId }]) {
    const before = upstreamRequests;
    assert.equal((await write('users/invite', body, admin, extra)).response.status, 403);
    if ('origin' in extra || 'X-CSRF-Token' in extra) assert.equal(upstreamRequests, before, 'Origin/CSRF rejection must precede any backend identity call');
  }
  assert.equal((await write('users/invite', body, staff)).response.status, 403);
  assert.equal((await write('users/invite', { ...body, role: 'ADMIN' }, admin)).response.status, 400);
  const r = await write('users/invite', body, admin); assert.equal(r.response.status, 201); assert(r.result.setupLink);
  assert.equal((await write('users/invite', body, admin)).response.status, 409);
  const page = await fetch(origin + '/clients/' + r.result.clientId, { headers: { cookie: cookie(admin) } });
  assert(!(await page.text()).includes(proof(r.result.setupLink)));
  const directory = await fetch(origin + '/clients', { headers: { cookie: cookie(staff) } });
  const html = await directory.text(); assert(html.includes('Secure')); assert(!html.includes('Invite Client'));
});

test('S2-A public relay separates email proof and HttpOnly password authorization with pre-auth CSRF', async () => {
  const invitation = await invite(), jar = new Map();
  let r = await call('/api/onboarding/accept', { token: proof(invitation.setupLink) }, jar); assert.equal(r.response.status, 403);
  const nonce = await call('/api/onboarding/csrf', undefined, jar, {}, 'GET');
  assert.equal((await call('/api/onboarding/accept', { token: proof(invitation.setupLink) }, jar,
    { origin: 'https://untrusted.invalid', 'X-Onboarding-CSRF': nonce.result.csrfToken })).response.status, 403);
  assert.equal((await call('/api/onboarding/accept', { token: proof(invitation.setupLink) }, jar,
    { 'X-Onboarding-CSRF': 'forged' })).response.status, 403);
  r = await publicCall('accept', { token: proof(invitation.setupLink), email: 'other@example.invalid' }, jar);
  assert.equal(r.response.status, 400);
  r = await publicCall('accept', { token: proof(invitation.setupLink) }, jar); assert.equal(r.response.status, 202);
  const fake = new FakeVerificationTransport(); await app.get(OnboardingDeliveryService).dispatch(fake, 100);
  const token = proof(fake.messages.find(m => m.to === invitation.email).url);
  r = await publicCall('verify', { token }, jar); assert.equal(r.response.status, 200);
  assert.equal(r.result.verified, true); assert.match(r.result.flowId, /^[A-Za-z0-9_-]{32}$/);
  assert.deepEqual(Object.keys(r.result).sort(), ['flowId', 'verified']);
  const flowId = r.result.flowId, authorization = jar.get('__Host-ss_password_setup');
  assert(authorization.startsWith(flowId + '.'));
  assert(!JSON.stringify(r.result).includes(authorization.split('.')[1]), 'verification JSON must not disclose the setup credential');
  assert(r.response.headers.getSetCookie().some(value => value.includes('__Host-ss_password_setup=') && value.includes('HttpOnly') && value.includes('Secure')));
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } })).accountState, 'PENDING_VERIFICATION');
  let before = upstreamRequests;
  assert.equal((await publicCall('password', { password }, jar)).response.status, 400);
  assert.equal(upstreamRequests, before, 'missing flow must not forward any authorization');
  assert.equal(jar.get('__Host-ss_password_setup'), authorization);
  before = upstreamRequests;
  assert.equal((await publicCall('password', { password, flowId: 'x'.repeat(32) }, jar)).response.status, 400);
  assert.equal(upstreamRequests, before, 'mismatched flow must not forward any authorization');
  assert.equal(jar.get('__Host-ss_password_setup'), authorization);
  before = upstreamRequests;
  const malformedFlow = await publicCall('password', { password, flowId: '' }, jar);
  assert.equal(malformedFlow.response.status, 400); assert.equal(malformedFlow.result.code, 'CHALLENGE_INVALID_OR_EXPIRED');
  assert.equal(upstreamRequests, before);
  assert.equal(jar.get('__Host-ss_password_setup'), authorization);
  r = await publicCall('password', { password, flowId }, jar); assert.equal(r.response.status, 200); assert.deepEqual(r.result, { completed: true });
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } })).accountState, 'ACTIVE');
  assert.equal((await publicCall('verify', { token }, jar)).response.status, 400);
});

test('S2-A in Chrome Admin creates and hides manual disclosure after account switch', browserTest, async () => {
  const admin = await login('admin'), email = randomUUID() + '@s2a-dashboard.example';
  await withChrome(origin, 'Dashboard Client', async browser => {
    for (const pair of cookie(admin).split('; ')) await browser.setCookie(origin, pair);
    await browser.go('/clients/new'); await browser.until(`!!document.querySelector('input[name=displayName]:enabled')`, 'Admin invitation ready');
    if (process.env.STUDIO_TEST_ARTIFACTS) await writeFile(resolve(process.env.STUDIO_TEST_ARTIFACTS, 'admin-onboarding.png'), Buffer.from(await browser.screenshot(), 'base64'));
    await field(browser, 'displayName', 'Chrome Client'); await field(browser, 'email', email); await click(browser, 'Create invitation');
    await browser.until(`!!document.querySelector('[aria-label="Manual setup link"] input')`, 'one-time manual disclosure');
    const link = await browser.evaluate(`document.querySelector('[aria-label="Manual setup link"] input').value`); assert(link.includes('/setup#token='));
    const staff = await login('staff'); for (const pair of cookie(staff).split('; ')) await browser.setCookie(origin, pair);
    await browser.evaluate(`window.dispatchEvent(new Event('focus'));true`);
    await browser.until(`document.querySelector('[role=alert]')?.textContent.includes('access changed')`, 'account switch conceals secret');
    assert.equal(await browser.evaluate(`document.body.innerText.includes(${JSON.stringify(link)}) || !!document.querySelector('[aria-label="Manual setup link"]')`), false);
    assert.equal(await db.user.count({ where: { normalizedEmail: email } }), 1);
  });
});

test('S2-A in Chrome completes manual link, separate email proof and password setup', browserTest, async () => {
  const invitation = await invite();
  await withChrome(origin, 'Client setup', async browser => {
    await browser.go('/setup#token=' + proof(invitation.setupLink));
    await browser.until(`document.querySelector('button')?.disabled===false`, 'manual proof ready');
    assert.equal(await browser.evaluate('location.hash'), '');
    assert.equal(await browser.evaluate(`JSON.stringify(history.state).includes(${JSON.stringify(proof(invitation.setupLink))})`), false);
    if (process.env.STUDIO_TEST_ARTIFACTS) await writeFile(resolve(process.env.STUDIO_TEST_ARTIFACTS, 'client-setup.png'), Buffer.from(await browser.screenshot(), 'base64'));
    await click(browser, 'Send verification email');
    await browser.until(`document.querySelector('[role=status]')?.textContent.includes('queued')`, 'separate proof queued');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } })).emailVerifiedAt, null);
    const fake = new FakeVerificationTransport(); await app.get(OnboardingDeliveryService).dispatch(fake, 100);
    const emailToken = proof(fake.messages.find(m => m.to === invitation.email).url);
    await browser.go('/verify-email#token=' + emailToken);
    await browser.until(`document.querySelector('button')?.disabled===false`, 'email proof ready'); await click(browser, 'Verify email');
    await browser.until(`location.pathname==='/setup-password' && !!document.querySelector('[name=password]:enabled')`, 'password authorization');
    assert.equal(await browser.evaluate(`document.cookie.includes('ss_password_setup')`), false);
    assert.equal(await browser.evaluate('location.hash'), '');
    assert.equal(await browser.evaluate(`JSON.stringify(history.state).includes(${JSON.stringify(emailToken)})`), false);
    const beforeReload = await browser.evaluate('performance.timeOrigin');
    await browser.evaluate('location.reload();true');
    await browser.until(`performance.timeOrigin!==${beforeReload} && !!document.querySelector('[name=password]:enabled')`, 'password flow bound after reload');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } })).accountState, 'PENDING_VERIFICATION');
    await field(browser, 'password', password); await click(browser, 'Complete setup');
    await browser.until(`document.querySelector('[role=status]')?.textContent.includes('account is active')`, 'automatic enablement');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } })).accountState, 'ACTIVE');
  });
});

test('S2-A in Chrome displays cooldown and explicitly reissues/revokes through profile', browserTest, async () => {
  const invitation = await invite();
  await withChrome(origin, 'Dashboard Client', async browser => {
    for (const pair of cookie(invitation.jar).split('; ')) await browser.setCookie(origin, pair);
    await browser.go('/clients/' + invitation.clientId);
    await browser.until(`!![...document.querySelectorAll('button')].find(x=>x.textContent==='Reissue setup link')`, 'onboarding status');
    assert.equal(await browser.evaluate(`[...document.querySelectorAll('button')].find(x=>x.textContent==='Reissue setup link').disabled`), true);
    await db.$executeRaw`UPDATE onboarding_challenge SET created_at=created_at-interval '61 seconds' WHERE user_id=${invitation.clientId}::uuid`;
    await click(browser, 'Refresh onboarding');
    await browser.until(`[...document.querySelectorAll('button')].find(x=>x.textContent==='Reissue setup link')?.disabled===false`, 'cooldown elapsed');
    await click(browser, 'Reissue setup link'); await field(browser, 'reason', 'Replacement requested'); await click(browser, 'Confirm reissue');
    await browser.until(`!!document.querySelector('[aria-label="Manual setup link"]') && document.querySelector('.onboarding-admin')?.getAttribute('aria-busy')==='false'`, 'replacement disclosed and refresh completed');
    await click(browser, 'Hide setup link'); await click(browser, 'Revoke onboarding'); await field(browser, 'reason', 'Stop setup'); await click(browser, 'Confirm revoke');
    await browser.until(`document.querySelector('.onboarding-admin [role=status]')?.textContent==='Onboarding revoked'`, 'chain revoked');
  });
});

async function emailProof(invitation) {
  assert.equal((await publicCall('accept', { token: proof(invitation.setupLink) }, new Map())).response.status, 202);
  const fake = new FakeVerificationTransport(); await app.get(OnboardingDeliveryService).dispatch(fake, 100);
  return proof(fake.messages.find(message => message.to === invitation.email).url);
}
async function readyPublic(browser, path) {
  await browser.go(path);
  await browser.until(`!!document.querySelector('.onboarding-public button:enabled')`, 'public step ready');
}
async function watchResends(browser) {
  await browser.evaluate(`(()=>{const original=window.fetch;window.resendResponses=[];window.fetch=async(...args)=>{
    const response=await original(...args);
    if(args[0]==='/api/onboarding/resend') window.resendResponses.push({status:response.status,body:await response.clone().json()});
    return response;
  };return true})()`);
}
async function resendInBrowser(browser, email, count = 1) {
  await field(browser, 'email', email); await click(browser, 'Request verification email');
  await browser.until(`window.resendResponses.length===${count} && document.querySelector('.onboarding-public')?.getAttribute('aria-busy')==='false'`, 'resend acknowledgement');
  assert.deepEqual(await browser.evaluate('window.resendResponses.at(-1)'), { status: 202, body: { accepted: true } });
  assert.equal(await browser.evaluate(`document.querySelector('[name=email]').value`), email);
}

test('S2-A R01 in Chrome rejects tab A after tab B replaces its password authorization', browserTest, async () => {
  const a = await invite(), b = await invite(), tokenA = await emailProof(a), tokenB = await emailProof(b);
  await withChrome(origin, 'Client setup', async browser => {
    await readyPublic(browser, '/verify-email#token=' + tokenA); await click(browser, 'Verify email');
    await browser.until(`location.pathname==='/setup-password' && !!document.querySelector('[name=password]:enabled')`, 'tab A password form');
    await field(browser, 'password', password);
    assert(await browser.evaluate(`Boolean(window.otherTab=window.open('/verify-email#token='+${JSON.stringify(tokenB)},'s2a-client-b'))`, { userGesture: true }));
    await browser.until(`window.otherTab?.location.pathname==='/verify-email' && window.otherTab.document.querySelector('button')?.disabled===false`, 'tab B proof ready');
    await browser.evaluate(`window.otherTab.document.querySelector('button').click();true`);
    await browser.until(`window.otherTab.location.pathname==='/setup-password' && !!window.otherTab.document.querySelector('[name=password]:enabled')`, 'tab B password form');
    await click(browser, 'Complete setup');
    await browser.until(`!!document.querySelector('[role=alert]') || document.querySelector('[role=status]')?.textContent.includes('account is active')`, 'tab A submission resolved');
    const clientB = await db.user.findUniqueOrThrow({ where: { id: b.clientId } });
    assert.equal(clientB.passwordHash !== null, false, 'tab A must never establish tab B credentials');
    assert.equal(clientB.accountState, 'PENDING_VERIFICATION');
    assert.match(await browser.evaluate(`document.querySelector('[role=alert]')?.textContent ?? ''`), /invalid, used or expired/);
    await browser.evaluate(`(()=>{const w=window.otherTab,e=w.document.querySelector('[name=password]');
      Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(password)});
      e.dispatchEvent(new w.Event('input',{bubbles:true}));w.document.querySelector('form button').click();return true})()`);
    await browser.until(`window.otherTab.document.querySelector('[role=status]')?.textContent.includes('account is active')`, 'tab B authorization survives mismatch');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: b.clientId } })).accountState, 'ACTIVE');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: a.clientId } })).passwordHash, null);
    await browser.evaluate('window.otherTab.close();true');
  });
});

test('S2-A R02 in Chrome preserves an unused setup proof after an ineligible resend', browserTest, async () => {
  const invitation = await invite();
  await withChrome(origin, 'Client setup', async browser => {
    await readyPublic(browser, '/setup#token=' + proof(invitation.setupLink)); await watchResends(browser);
    await resendInBrowser(browser, invitation.email);
    assert.equal(await db.onboardingDelivery.count({ where: { challenge: { userId: invitation.clientId } } }), 0);
    assert(await browser.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Send verification email'&&!button.disabled)`));
    await click(browser, 'Send verification email');
    await browser.until(`document.querySelector('[role=status]')?.textContent.includes('queued')`, 'original setup proof accepted');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } })).accountState, 'PENDING_VERIFICATION');
  });
});

test('S2-A R02 in Chrome preserves email proof after a cooldown-suppressed resend', browserTest, async () => {
  const invitation = await invite(), token = await emailProof(invitation);
  await withChrome(origin, 'Client setup', async browser => {
    await readyPublic(browser, '/verify-email#token=' + token); await watchResends(browser);
    await resendInBrowser(browser, invitation.email);
    assert.equal(await db.onboardingChallenge.count({ where: { userId: invitation.clientId, purpose: 'EMAIL' } }), 1);
    assert(await browser.evaluate(`!![...document.querySelectorAll('button')].find(button=>button.textContent==='Verify email'&&!button.disabled)`));
    await click(browser, 'Verify email');
    await browser.until(`location.pathname==='/setup-password' && !!document.querySelector('[name=password]:enabled')`, 'original email proof remains usable');
  });
});

test('S2-A R02 in Chrome preserves password authorization and draft after suppressed resends', browserTest, async () => {
  const invitation = await invite(), token = await emailProof(invitation);
  await withChrome(origin, 'Client setup', async browser => {
    await readyPublic(browser, '/verify-email#token=' + token); await click(browser, 'Verify email');
    await browser.until(`location.pathname==='/setup-password' && !!document.querySelector('[name=password]:enabled')`, 'password form ready');
    await field(browser, 'password', password); await watchResends(browser);
    await resendInBrowser(browser, 'absent@s2a-dashboard.example');
    assert.equal(await browser.evaluate(`document.querySelector('[name=password]')?.value`), password);
    await resendInBrowser(browser, invitation.email, 2);
    assert.equal(await browser.evaluate(`document.querySelector('[name=password]')?.value`), password);
    assert.equal(await db.onboardingChallenge.count({ where: { userId: invitation.clientId, purpose: 'EMAIL' } }), 1);
    await click(browser, 'Complete setup');
    await browser.until(`document.querySelector('[role=status]')?.textContent.includes('account is active')`, 'original password authorization remains usable');
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } })).accountState, 'ACTIVE');
  });
});

test('S2-A R02 relay retains authorization on acknowledgement but enforces actual resend supersession', async () => {
  const invitation = await invite(), token = await emailProof(invitation), jar = new Map();
  const verified = await publicCall('verify', { token }, jar), flowId = verified.result.flowId;
  const authorization = jar.get('__Host-ss_password_setup');
  await db.$executeRaw`UPDATE onboarding_challenge SET created_at=created_at-interval '61 seconds' WHERE user_id=${invitation.clientId}::uuid AND purpose='EMAIL'`;
  const resent = await publicCall('resend', { email: invitation.email }, jar);
  assert.equal(resent.response.status, 202); assert.deepEqual(resent.result, { accepted: true });
  assert.equal(jar.get('__Host-ss_password_setup'), authorization);
  assert.equal(resent.response.headers.getSetCookie().length, 0, 'acknowledgement must not clear authorization');
  assert.equal(await db.onboardingChallenge.count({ where: { userId: invitation.clientId, purpose: 'EMAIL' } }), 2);
  assert.equal((await publicCall('password', { password, flowId }, jar)).response.status, 400, 'backend supersession remains authoritative');
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } })).passwordHash, null);
  const fake = new FakeVerificationTransport(); await app.get(OnboardingDeliveryService).dispatch(fake, 100);
  const replacement = await publicCall('verify', { token: proof(fake.messages.find(message => message.to === invitation.email).url) }, jar);
  assert.equal(replacement.response.status, 200);
  assert.equal((await publicCall('password', { password, flowId: replacement.result.flowId }, jar)).response.status, 200);
});

test('S2-A R03 in Chrome preserves invitation drafts on focus and visibility, concealing them on identity change', browserTest, async () => {
  const admin = await login('admin'), email = randomUUID() + '@s2a-dashboard.example', name = 'Retained invitation draft';
  await withChrome(origin, 'Dashboard Client', async browser => {
    for (const pair of cookie(admin).split('; ')) await browser.setCookie(origin, pair);
    await browser.go('/clients/new'); await browser.until(`!!document.querySelector('[name=displayName]:enabled')`, 'invitation ready');
    await field(browser, 'displayName', name); await field(browser, 'email', email);
    await browser.evaluate(`(()=>{const original=window.fetch;window.identityReads=0;window.fetch=(...args)=>{
      if(args[0]==='/api/studio/v1/me')window.identityReads++;return original(...args);
    };window.dispatchEvent(new Event('focus'));return true})()`);
    await browser.until(`window.identityReads>0 && !!document.querySelector('[name=email]:enabled')`, 'focus revalidation completed');
    assert.equal(await browser.evaluate(`document.querySelector('[name=displayName]').value`), name);
    assert.equal(await browser.evaluate(`document.querySelector('[name=email]').value`), email);
    await browser.evaluate(`Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));true`);
    await browser.until(`document.querySelector('[role=status]')?.textContent.includes('Checking')`, 'hidden draft concealed');
    const reads = await browser.evaluate('window.identityReads');
    await browser.evaluate(`Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));true`);
    await browser.until(`window.identityReads>${reads} && !!document.querySelector('[name=email]:enabled')`, 'visibility revalidation completed');
    assert.equal(await browser.evaluate(`document.querySelector('[name=displayName]').value`), name);
    assert.equal(await browser.evaluate(`document.querySelector('[name=email]').value`), email);
    const staff = await login('staff'); for (const pair of cookie(staff).split('; ')) await browser.setCookie(origin, pair);
    await browser.evaluate(`window.dispatchEvent(new Event('focus'));true`);
    await browser.until(`document.querySelector('[role=alert]')?.textContent.includes('access changed')`, 'changed identity denied');
    assert.equal(await browser.evaluate(`!!document.querySelector('[name=email]') || !!document.querySelector('[name=displayName]') || document.body.innerText.includes(${JSON.stringify(name)})`), false);
    for (const pair of cookie(admin).split('; ')) await browser.setCookie(origin, pair);
    await browser.evaluate(`window.dispatchEvent(new Event('focus'));true`);
    assert.equal(await browser.evaluate(`!!document.querySelector('[name=email]')`), false, 'old draft must not return after invalidation');
    assert.equal(await db.user.count({ where: { normalizedEmail: email } }), 0);
  });
});
