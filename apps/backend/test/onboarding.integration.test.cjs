const { before, beforeEach, afterEach, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { startApp } = require('../dist/app.js');
const { loadConfig } = require('../dist/platform/config.js');
const { Sessions } = require('../dist/identity/session.service.js');
const { hashPassword } = require('../dist/identity/password.js');
const { OnboardingDeliveryService, FakeVerificationTransport } = require('../dist/onboarding/delivery.service.js');
const name = 'studio_s2a_test_' + randomBytes(6).toString('hex');
let owner, db, runtime, app, base, admin, staff, users, urls;
const fixturePassword = 'onboarding fixture passphrase';
const deliveryKey = randomBytes(32);
before(async () => {
  const api = new URL(process.env.DATABASE_URL), migration = new URL(process.env.MIGRATION_DATABASE_URL);
  for (const u of [api, migration]) {
    assert(['127.0.0.1', 'localhost'].includes(u.hostname)); assert.equal(u.pathname, '/strength_studio');
  }
  assert.equal(api.host, migration.host); assert.equal(api.username, 'studio_api');
  const control = new URL(migration); control.pathname = '/postgres';
  owner = new PrismaClient({ datasourceUrl: control.href });
  await owner.$executeRawUnsafe(`CREATE DATABASE "${name}" TEMPLATE "strength_studio"`);
  api.pathname = migration.pathname = '/' + name; urls = { api, migration };
  db = new PrismaClient({ datasourceUrl: migration.href }); runtime = new PrismaClient({ datasourceUrl: api.href });
  const passwordHash = await hashPassword(fixturePassword);
  users = {};
  for (const role of ['ADMIN', 'STAFF', 'COACH', 'CLIENT']) {
    users[role] = await db.user.create({ data: { normalizedEmail: role.toLowerCase() + '@s2a.example', role,
      accountState: 'ACTIVE', passwordHash, emailVerifiedAt: new Date(),
      ...(role === 'CLIENT' ? { client: { create: { displayName: 'Existing' } } } : {}) } });
  }
  await db.staffGrant.create({ data: { staffUserId: users.STAFF.id, permission: 'CLIENT_MANAGE', changedById: users.ADMIN.id } });
});
beforeEach(async () => {
  app = await startApp({ ...loadConfig({ ...process.env, DATABASE_URL: urls.api.href }), host: '127.0.0.1', port: 0, onboardingKey: deliveryKey });
  base = (await app.getUrl()) + '/api/v1';
  const service = app.get(Sessions);
  admin = (await service.login(users.ADMIN.normalizedEmail, fixturePassword)).accessToken;
  staff = (await service.login(users.STAFF.normalizedEmail, fixturePassword)).accessToken;
});
afterEach(async () => app?.close());
after(async () => {
  await Promise.all([db?.$disconnect(), runtime?.$disconnect()]);
  if (owner) await owner.$executeRawUnsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
  await owner?.$disconnect();
});
async function req(path, body, access, key, method = 'POST') {
  const response = await fetch(base + path, { method, headers: {
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...(access ? { Authorization: 'Bearer ' + access } : {}), ...(key ? { 'Idempotency-Key': key } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
async function ok(status, path, body, access, key, method) {
  const result = await req(path, body, access, key, method);
  assert.equal(result.status, status, JSON.stringify(result)); return result.body;
}
async function invite(email = randomUUID() + '@s2a.example') {
  return ok(201, '/users/invite', { email, displayName: 'New Client' }, admin, randomUUID());
}
const token = link => new URLSearchParams(new URL(link).hash.slice(1)).get('token');
async function proveInvitation(invitation) {
  await ok(202, '/auth/accept-invitation', { token: token(invitation.setupLink) });
  const fake = new FakeVerificationTransport(); await app.get(OnboardingDeliveryService).dispatch(fake, 100);
  const recipient = (await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } })).normalizedEmail;
  const email = fake.messages.find(m => m.to === recipient);
  assert(email); return { fake, emailToken: token(email.url) };
}
async function age(id, purpose) {
  await db.$executeRaw`UPDATE onboarding_challenge SET created_at=created_at-interval '61 seconds' WHERE user_id=${id}::uuid AND purpose=${purpose}::onboarding_purpose`;
}

test('S2-A creates Client only, completes separate proof/password stages, then signs in without a purchase', async () => {
  const email = randomUUID() + '@s2a.example';
  const invitation = await invite('  ' + email.toUpperCase() + '  ');
  assert(invitation.linkAvailable); assert.equal(await db.onboardingDelivery.count(), 0);
  let user = await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } });
  assert.equal(user.normalizedEmail, email); assert.equal(user.passwordHash, null); assert.equal(user.accountState, 'INVITED');
  const { emailToken } = await proveInvitation(invitation);
  await ok(400, '/auth/setup-password', { token: token(invitation.setupLink), password: fixturePassword });
  const auth = await ok(200, '/auth/verify-email', { token: emailToken });
  user = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  assert(user.emailVerifiedAt); assert.equal(user.accountState, 'PENDING_VERIFICATION'); assert.equal(user.passwordHash, null);
  await ok(401, '/auth/login', { email, password: fixturePassword });
  await ok(400, '/auth/setup-password', { token: auth.token, password: 'short' });
  await ok(204, '/auth/setup-password', { token: auth.token, password: fixturePassword });
  const login = await ok(200, '/auth/login', { email, password: fixturePassword }); assert(login.accessToken);
  assert.equal(await db.purchase.count({ where: { clientId: user.id } }), 0);
  assert.equal((await ok(200, `/clients/${user.id}/onboarding`, undefined, admin, undefined, 'GET')).status, 'COMPLETED');
  await ok(400, '/auth/verify-email', { token: emailToken });
  await ok(400, '/auth/setup-password', { token: auth.token, password: fixturePassword });
  const stored = JSON.stringify(await db.auditLog.findMany({ where: { targetId: user.id } }));
  for (const secret of [email, emailToken, auth.token, fixturePassword, token(invitation.setupLink)]) assert(!stored.includes(secret));
});

test('S2-A denies Staff writes while retaining Client reads; strict DTO and cross-role collisions', async () => {
  const payload = { email: randomUUID() + '@s2a.example', displayName: 'No escalation' };
  await ok(403, '/users/invite', payload, staff, randomUUID());
  await ok(401, '/users/invite', payload, undefined, randomUUID());
  await ok(400, '/users/invite', { ...payload, role: 'ADMIN' }, admin, randomUUID());
  await ok(200, '/clients', undefined, staff, undefined, 'GET');
  const before = await db.user.findUniqueOrThrow({ where: { id: users.COACH.id } });
  const rejected = await ok(409, '/users/invite', { ...payload, email: before.normalizedEmail }, admin, randomUUID());
  assert.equal(rejected.code, 'CLIENT_IDENTITY_CONFLICT'); assert(!JSON.stringify(rejected).includes(before.id));
  assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: before.id } }), before);
  const invitation = await invite();
  for (const action of ['reissue', 'revoke']) await ok(403, `/users/${invitation.clientId}/onboarding/${action}`,
    { expectedRevision: 1, reason: 'No Staff writes' }, staff, randomUUID());
  await ok(403, `/clients/${invitation.clientId}/onboarding`, undefined, staff, undefined, 'GET');
});

test('S2-A serializes duplicate creation/idempotency and never rediscloses a replayed secret', async () => {
  const body = { email: randomUUID() + '@s2a.example', displayName: 'Concurrent' }, key = randomUUID();
  const results = await Promise.all([req('/users/invite', body, admin, key), req('/users/invite', body, admin, key)]);
  assert.deepEqual(results.map(r => r.status), [201, 201]);
  assert.equal(results.filter(r => r.body.setupLink).length, 1);
  assert.equal(results[0].body.clientId, results[1].body.clientId);
  await ok(409, '/users/invite', { ...body, displayName: 'Changed' }, admin, key);
  await ok(409, '/users/invite', body, admin, randomUUID());
  assert.equal(await db.user.count({ where: { normalizedEmail: body.email } }), 1);
  const other = { ...body, email: randomUUID() + '@s2a.example' };
  const different = await Promise.all([req('/users/invite', other, admin, randomUUID()), req('/users/invite', other, admin, randomUUID())]);
  assert.deepEqual(different.map(r => r.status).sort(), [201, 409]);
});

test('S2-A replacement enforces cooldown, rate limit, revision and old-link invalidation', async () => {
  const invitation = await invite(), path = `/users/${invitation.clientId}/onboarding/reissue`;
  const body = { expectedRevision: 1, reason: 'Replace safely' };
  await ok(409, path, body, admin, randomUUID());
  await age(invitation.clientId, 'SETUP');
  const replacement = await ok(200, path, body, admin, randomUUID());
  await ok(400, '/auth/accept-invitation', { token: token(invitation.setupLink) });
  await ok(409, path, body, admin, randomUUID());
  let revision = 2;
  for (let i = 1; i < 5; i++) {
    await age(invitation.clientId, 'SETUP');
    await ok(200, path, { ...body, expectedRevision: revision++ }, admin, randomUUID());
  }
  await age(invitation.clientId, 'SETUP');
  const denied = await ok(409, path, { ...body, expectedRevision: revision }, admin, randomUUID());
  assert.equal(denied.code, 'ONBOARDING_RATE_LIMITED');
  assert(replacement.setupLink);
});

test('S2-A concurrent proof and password consumption commit only once; revocation defeats descendants', async () => {
  const invitation = await invite();
  const accepts = await Promise.all([req('/auth/accept-invitation', { token: token(invitation.setupLink) }), req('/auth/accept-invitation', { token: token(invitation.setupLink) })]);
  assert.deepEqual(accepts.map(r => r.status).sort(), [202, 400]);
  const fake = new FakeVerificationTransport(); await app.get(OnboardingDeliveryService).dispatch(fake, 100);
  const emailToken = token(fake.messages.at(-1).url);
  const proofs = await Promise.all([req('/auth/verify-email', { token: emailToken }), req('/auth/verify-email', { token: emailToken })]);
  assert.deepEqual(proofs.map(r => r.status).sort(), [200, 400]);
  const authorization = proofs.find(r => r.status === 200).body.token;
  const writes = await Promise.all([req('/auth/setup-password', { token: authorization, password: fixturePassword }), req('/auth/setup-password', { token: authorization, password: fixturePassword })]);
  assert.deepEqual(writes.map(r => r.status).sort(), [204, 400]);
  const second = await invite(), delivered = await proveInvitation(second);
  const ticket = await ok(200, '/auth/verify-email', { token: delivered.emailToken });
  await ok(204, `/users/${second.clientId}/onboarding/revoke`, { expectedRevision: 1, reason: 'Stop entire chain' }, admin, randomUUID());
  await ok(400, '/auth/setup-password', { token: ticket.token, password: fixturePassword });
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: second.clientId } })).passwordHash, null);
});

test('S2-A email resend stays generic and supersedes proof/password authorization', async () => {
  const invitation = await invite(), delivered = await proveInvitation(invitation);
  const user = await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } });
  const response = await ok(202, '/auth/resend-verification', { email: user.normalizedEmail });
  assert.deepEqual(response, await ok(202, '/auth/resend-verification', { email: 'missing@s2a.example' }));
  await age(user.id, 'EMAIL');
  await ok(202, '/auth/resend-verification', { email: user.normalizedEmail });
  await ok(400, '/auth/verify-email', { token: delivered.emailToken });
  const fake = new FakeVerificationTransport(); await app.get(OnboardingDeliveryService).dispatch(fake, 100);
  const ticket = await ok(200, '/auth/verify-email', { token: token(fake.messages.at(-1).url) });
  await age(user.id, 'EMAIL');
  await ok(202, '/auth/resend-verification', { email: user.normalizedEmail });
  await ok(400, '/auth/setup-password', { token: ticket.token, password: fixturePassword });
});

test('S2-A expires proofs using DB time and preserves pending records; disabled accounts cannot finish', async () => {
  const invitation = await invite();
  await db.$executeRaw`UPDATE onboarding_challenge SET created_at=clock_timestamp()-interval '25 hours', expires_at=clock_timestamp()-interval '1 second' WHERE id=${invitation.challengeId}::uuid`;
  await ok(400, '/auth/accept-invitation', { token: token(invitation.setupLink) });
  assert(await db.user.findUnique({ where: { id: invitation.clientId } }));
  const second = await invite(), delivered = await proveInvitation(second);
  await ok(204, `/users/${second.clientId}/disable`, {}, admin, randomUUID());
  await ok(400, '/auth/verify-email', { token: delivered.emailToken });
});

test('S2-A queue encrypts secrets, retries same proof and fences competing dispatchers', async () => {
  const invitation = await invite(); await ok(202, '/auth/accept-invitation', { token: token(invitation.setupLink) });
  const row = await db.onboardingDelivery.findFirstOrThrow({ where: { challenge: { userId: invitation.clientId } } });
  assert(!row.ciphertext.includes('http')); assert(!row.ciphertext.includes('@'));
  const worker = app.get(OnboardingDeliveryService);
  await worker.dispatch({ async send() { throw new Error('secret-bearing error must be discarded'); } }, 100);
  assert.equal((await db.onboardingDelivery.findUniqueOrThrow({ where: { id: row.id } })).acceptedAt, null);
  await db.onboardingDelivery.update({ where: { id: row.id }, data: { availableAt: new Date(0) } });
  const fake = new FakeVerificationTransport(); await Promise.all([worker.dispatch(fake, 100), worker.dispatch(fake, 100)]);
  const recipient = (await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } })).normalizedEmail;
  assert.equal(fake.messages.filter(m => m.to === recipient).length, 1);
  const stored = await db.onboardingDelivery.findUniqueOrThrow({ where: { id: row.id } });
  assert(stored.acceptedAt); assert.equal(stored.ciphertext, null);
  assert.equal(await db.onboardingChallenge.count({ where: { userId: invitation.clientId, purpose: 'EMAIL' } }), 1);
});

test('S2-A migration keeps ordinary identity and immutable proof writes denied', async () => {
  await assert.rejects(runtime.$executeRaw`UPDATE app_user SET password_hash='bad' WHERE id=${users.CLIENT.id}::uuid`);
  await assert.rejects(runtime.$executeRaw`INSERT INTO app_user(normalized_email,role,account_state) VALUES('bad@s2a.example','ADMIN','ACTIVE')`);
  const invitation = await invite();
  await assert.rejects(runtime.$executeRaw`UPDATE onboarding_challenge SET digest=repeat('a',64) WHERE id=${invitation.challengeId}::uuid`);
  await assert.rejects(runtime.$executeRaw`DELETE FROM client_onboarding WHERE user_id=${invitation.clientId}::uuid`);
  await assert.rejects(runtime.$executeRaw`SELECT public.onboarding_complete_password(${users.CLIENT.id}::uuid,${invitation.challengeId}::uuid,'$argon2id$bad')`);
});

test('S2-A audit failure rolls back creation, proof acceptance and final activation', async () => {
  const email = randomUUID() + '@s2a.example', key = randomUUID();
  const createTrigger = async (action) => {
    assert(['CLIENT_INVITED', 'EMAIL_VERIFIED', 'ACCOUNT_ENABLED'].includes(action));
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION s2a_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action::text='${action}' THEN RAISE EXCEPTION 'test audit rollback'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER s2a_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION s2a_audit_failure()');
  };
  const drop = () => db.$executeRawUnsafe('DROP TRIGGER s2a_audit_failure ON audit_log');
  await createTrigger('CLIENT_INVITED');
  try { await ok(500, '/users/invite', { email, displayName: 'Rollback' }, admin, key); } finally { await drop(); }
  assert.equal(await db.user.count({ where: { normalizedEmail: email } }), 0);
  assert.equal(await db.idempotencyKey.count({ where: { actorId: users.ADMIN.id, key } }), 0);
  const invitation = await ok(201, '/users/invite', { email, displayName: 'Rollback' }, admin, key);
  const delivered = await proveInvitation(invitation);
  await createTrigger('EMAIL_VERIFIED');
  try { await ok(500, '/auth/verify-email', { token: delivered.emailToken }); } finally { await drop(); }
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } })).emailVerifiedAt, null);
  const ticket = await ok(200, '/auth/verify-email', { token: delivered.emailToken });
  await createTrigger('ACCOUNT_ENABLED');
  try { await ok(500, '/auth/setup-password', { token: ticket.token, password: fixturePassword }); } finally { await drop(); }
  const pending = await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } });
  assert.equal(pending.accountState, 'PENDING_VERIFICATION'); assert.equal(pending.passwordHash, null);
  await ok(204, '/auth/setup-password', { token: ticket.token, password: fixturePassword });
});

test('S2-A email/password expiry and five-resend ceiling never enable or repair an identity', async () => {
  const incomplete = await db.user.create({ data: { normalizedEmail: randomUUID() + '@s2a.example', role: 'CLIENT', accountState: 'INVITED' } });
  await ok(409, '/users/invite', { email: incomplete.normalizedEmail, displayName: 'No repair' }, admin, randomUUID());
  assert.equal(await db.clientProfile.count({ where: { userId: incomplete.id } }), 0);
  await assert.rejects(db.clientProfile.create({ data: { userId: randomUUID(), displayName: 'No orphan' } }));
  const invitation = await invite(), delivered = await proveInvitation(invitation);
  await db.$executeRaw`UPDATE onboarding_challenge SET created_at=clock_timestamp()-interval '25 hours', expires_at=clock_timestamp()-interval '1 second' WHERE user_id=${invitation.clientId}::uuid AND purpose='EMAIL'`;
  await ok(400, '/auth/verify-email', { token: delivered.emailToken });
  const email = (await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } })).normalizedEmail;
  // The expired initial challenge is outside the replacement counter; only actual replacements count.
  for (let i = 0; i < 5; i++) {
    await age(invitation.clientId, 'EMAIL');
    await ok(202, '/auth/resend-verification', { email });
  }
  await age(invitation.clientId, 'EMAIL');
  await ok(202, '/auth/resend-verification', { email });
  assert.equal(await db.onboardingChallenge.count({ where: { userId: invitation.clientId, purpose: 'EMAIL', replacement: true } }), 5);
  const fake = new FakeVerificationTransport(); await app.get(OnboardingDeliveryService).dispatch(fake, 100);
  const ticket = await ok(200, '/auth/verify-email', { token: token(fake.messages.find(m => m.to === email).url) });
  await db.$executeRaw`UPDATE onboarding_challenge SET created_at=clock_timestamp()-interval '16 minutes', expires_at=clock_timestamp()-interval '1 second' WHERE user_id=${invitation.clientId}::uuid AND purpose='PASSWORD'`;
  await ok(400, '/auth/setup-password', { token: ticket.token, password: fixturePassword });
  const pending = await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } });
  assert.equal(pending.passwordHash, null); assert.equal(pending.accountState, 'PENDING_VERIFICATION');
});

test('S2-A HTTP logs and rejection/delivery audits never record proof or password secrets', async () => {
  const captured = [], original = process.stdout.write;
  process.stdout.write = function(chunk, ...args) { captured.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)); return original.call(this, chunk, ...args); };
  let invitation, emailProof, ticket, recipient;
  try {
    invitation = await invite();
    recipient = (await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } })).normalizedEmail;
    await ok(202, '/auth/accept-invitation', { token: token(invitation.setupLink) });
    await app.get(OnboardingDeliveryService).dispatch({ async send(message) {
      if (message.to === recipient) emailProof = token(message.url);
      throw new Error('Untrusted provider error: ' + message.url);
    } }, 100);
    assert(emailProof);
    ticket = await ok(200, '/auth/verify-email', { token: emailProof });
    await ok(204, '/auth/setup-password', { token: ticket.token, password: fixturePassword });
    await ok(400, '/auth/verify-email', { token: emailProof });
  } finally { process.stdout.write = original; }
  const logs = captured.join(''), audits = JSON.stringify(await db.auditLog.findMany({ where: {
    OR: [{ targetId: invitation.clientId }, { action: 'ONBOARDING_REJECTED' }],
  } }));
  for (const value of [token(invitation.setupLink), emailProof, ticket.token, recipient, fixturePassword]) {
    assert(!logs.includes(value), 'HTTP/provider logging must exclude credentials/recipient');
    assert(!audits.includes(value), 'Audit must exclude credentials/recipient');
  }
});

test('S2-A collision matrix preserves every existing identity and denies all non-Admin managers', async () => {
  for (const [role, accountState, verified] of [
    ['CLIENT', 'ACTIVE', true], ['CLIENT', 'DISABLED', true], ['CLIENT', 'INVITED', false],
    ['CLIENT', 'PENDING_VERIFICATION', false], ['CLIENT', 'ACTIVE', false],
    ['STAFF', 'ACTIVE', true], ['COACH', 'ACTIVE', true], ['ADMIN', 'ACTIVE', true],
  ]) {
    const existing = await db.user.create({ data: { normalizedEmail: randomUUID() + '@s2a.example', role, accountState,
      emailVerifiedAt: verified ? new Date() : null, passwordHash: await hashPassword(fixturePassword),
      ...(role === 'CLIENT' ? { client: { create: { displayName: 'Unchanged collision fixture' } } } : {}) } });
    const before = await db.user.findUniqueOrThrow({ where: { id: existing.id }, include: { client: true } });
    const result = await ok(409, '/users/invite', { email: '  ' + existing.normalizedEmail.toUpperCase() + '  ', displayName: 'Must not replace' }, admin, randomUUID());
    assert.equal(result.code, 'CLIENT_IDENTITY_CONFLICT');
    assert.deepEqual(await db.user.findUniqueOrThrow({ where: { id: existing.id }, include: { client: true } }), before);
    assert.equal(await db.clientOnboarding.count({ where: { userId: existing.id } }), 0);
  }
  const invitation = await invite();
  for (const role of ['CLIENT', 'COACH']) {
    const access = (await app.get(Sessions).login(users[role].normalizedEmail, fixturePassword)).accessToken;
    await ok(403, '/users/invite', { email: randomUUID() + '@s2a.example', displayName: 'Forbidden' }, access, randomUUID());
    for (const action of ['reissue', 'revoke']) await ok(403, `/users/${invitation.clientId}/onboarding/${action}`,
      { expectedRevision: 1, reason: 'Forbidden' }, access, randomUUID());
    await ok(403, `/clients/${invitation.clientId}/onboarding`, undefined, access, undefined, 'GET');
  }
});

test('S2-A rejected password capabilities are audited even before expensive hashing', async () => {
  const absent = randomBytes(32).toString('base64url');
  const before = await db.auditLog.count({ where: { action: 'ONBOARDING_REJECTED' } });
  await ok(400, '/auth/setup-password', { token: absent, password: fixturePassword });
  assert.equal(await db.auditLog.count({ where: { action: 'ONBOARDING_REJECTED' } }), before + 1);
  const invitation = await invite(), delivered = await proveInvitation(invitation);
  const ticket = await ok(200, '/auth/verify-email', { token: delivered.emailToken });
  await db.$executeRaw`UPDATE onboarding_challenge SET created_at=clock_timestamp()-interval '16 minutes', expires_at=clock_timestamp()-interval '1 second' WHERE user_id=${invitation.clientId}::uuid AND purpose='PASSWORD'`;
  await ok(400, '/auth/setup-password', { token: ticket.token, password: fixturePassword });
  const events = await db.auditLog.findMany({ where: { action: 'ONBOARDING_REJECTED' }, orderBy: { createdAt: 'desc' }, take: 2 });
  assert.equal(await db.auditLog.count({ where: { action: 'ONBOARDING_REJECTED' } }), before + 2);
  assert(events.every(e => e.actorId === null && e.redactedDetails.stage === 'PASSWORD' && e.redactedDetails.outcome === 'REJECTED'));
  for (const value of [absent, ticket.token, fixturePassword]) assert(!JSON.stringify(events).includes(value));
  const user = await db.user.findUniqueOrThrow({ where: { id: invitation.clientId } });
  assert.equal(user.accountState, 'PENDING_VERIFICATION'); assert.equal(user.passwordHash, null);
});
