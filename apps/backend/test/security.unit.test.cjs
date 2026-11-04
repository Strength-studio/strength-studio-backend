const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Role, StaffPermission } = require('@prisma/client');
const { hasAction, staffPermissions } = require('../dist/identity/permissions.js');
const { hashPassword, checkPassword } = require('../dist/identity/password.js');
const { loadConfig } = require('../dist/platform/config.js');

test('passwords are salted Argon2id digests and a wrong password does not verify', async () => {
  const password = 'foundation test passphrase';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^\$argon2id\$/);
  assert.notEqual(first, second);
  assert(!first.includes(password));
  assert.equal(await checkPassword(first, password), true);
  assert.equal(await checkPassword(first, 'wrong passphrase'), false);
});

test('staff grants are independent and cannot express commission access or the activation exception', () => {
  assert.equal(hasAction(Role.STAFF, [], 'client.manage'), false);
  assert.equal(hasAction(Role.STAFF, [StaffPermission.CLIENT_MANAGE], 'client.manage'), true);
  assert.equal(hasAction(Role.STAFF, [StaffPermission.CLIENT_MANAGE], 'membership.activate'), false);
  assert.equal(hasAction(Role.STAFF, [StaffPermission.MEMBERSHIP_ACTIVATE], 'membership.activate'), true);
  for (const role of [Role.STAFF, Role.CLIENT, Role.COACH]) {
    assert.equal(hasAction(role, Object.values(StaffPermission), 'commission.read'), false);
    assert.equal(hasAction(role, Object.values(StaffPermission), 'membership.activate_exception'), false);
  }
  assert.equal(hasAction(Role.ADMIN, [], 'membership.activate_exception'), true);
  assert.equal(hasAction(Role.ADMIN, [], 'commission.read'), true);
  assert.equal(hasAction(Role.ADMIN, [], 'unlisted.action'), false);
  assert.equal(staffPermissions.has('commission.read'), false);
  assert.equal(staffPermissions.has('membership.activate_exception'), false);
});

test('configuration requires a real signing key and an exact dashboard origin', () => {
  const env = { DATABASE_URL: 'postgresql://localhost/strength_studio', AUTH_SIGNING_KEY: 'a1'.repeat(32) };
  assert.equal(loadConfig({ ...env, DASHBOARD_ORIGIN: 'https://dashboard.example' }).signingKey.length, 32);
  assert.throws(() => loadConfig({ ...env, AUTH_SIGNING_KEY: 'example' }), /AUTH_SIGNING_KEY/);
  assert.throws(() => loadConfig({ ...env, DASHBOARD_ORIGIN: 'https://dashboard.example/path' }), /DASHBOARD_ORIGIN/);
  assert.throws(() => loadConfig({ ...env, NODE_ENV: 'production', DASHBOARD_ORIGIN: 'http://localhost:3001' }), /DASHBOARD_ORIGIN/);
});
