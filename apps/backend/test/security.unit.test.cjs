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

test('staff grants are independent and cannot authorize activation or commission access', () => {
  assert.equal(hasAction(Role.STAFF, [], 'client.manage'), false);
  assert.equal(hasAction(Role.STAFF, [StaffPermission.CLIENT_MANAGE], 'client.manage'), true);
  assert.equal(hasAction(Role.STAFF, [StaffPermission.CLIENT_MANAGE], 'membership.activate'), false);
  assert.equal(hasAction(Role.STAFF, [StaffPermission.MEMBERSHIP_ACTIVATE], 'membership.activate'), false);
  for (const role of [Role.STAFF, Role.CLIENT, Role.COACH]) {
    assert.equal(hasAction(role, Object.values(StaffPermission), 'commission.read'), false);
    assert.equal(hasAction(role, Object.values(StaffPermission), 'membership.activate'), false);
    assert.equal(hasAction(role, Object.values(StaffPermission), 'membership.activate_exception'), false);
  }
  assert.equal(hasAction(Role.ADMIN, [], 'membership.activate_exception'), true);
  assert.equal(hasAction(Role.ADMIN, [], 'membership.activate'), true);
  assert.equal(hasAction(Role.ADMIN, [], 'commission.read'), true);
  assert.equal(hasAction(Role.ADMIN, [], 'unlisted.action'), false);
  assert.equal(staffPermissions.has('commission.read'), false);
  assert.equal(staffPermissions.has('membership.activate'), false);
  assert.equal(staffPermissions.has('membership.activate_exception'), false);
});

test('public catalog and scoped audit actions require independent staff grants', () => {
  for (const [action, grant] of [
    ['catalog.read', StaffPermission.CATALOG_READ],
    ['catalog.manage', StaffPermission.CATALOG_MANAGE],
    ['audit.read', StaffPermission.AUDIT_READ],
  ]) {
    assert.equal(hasAction(Role.STAFF, [grant], action), true);
    assert.equal(hasAction(Role.STAFF, [StaffPermission.CATALOG_PRIVATE_MANAGE], action), false);
    assert.equal(hasAction(Role.STAFF, [], action), false);
    assert.equal(hasAction(Role.ADMIN, [], action), true);
    assert.equal(hasAction(Role.COACH, [], action), false);
    assert.equal(hasAction(Role.CLIENT, [], action), action === 'catalog.read');
  }
  assert.equal(hasAction(Role.STAFF, [StaffPermission.CATALOG_MANAGE], 'catalog.read'), false);
  assert.equal(hasAction(Role.STAFF, [StaffPermission.CATALOG_MANAGE], 'audit.read'), false);
});

test('configuration requires a real signing key and an exact dashboard origin', () => {
  const env = { DATABASE_URL: 'postgresql://localhost/strength_studio', AUTH_SIGNING_KEY: 'a1'.repeat(32) };
  assert.equal(loadConfig({ ...env, DASHBOARD_ORIGIN: 'https://dashboard.example' }).signingKey.length, 32);
  assert.throws(() => loadConfig({ ...env, AUTH_SIGNING_KEY: 'example' }), /AUTH_SIGNING_KEY/);
  assert.throws(() => loadConfig({ ...env, DASHBOARD_ORIGIN: 'https://dashboard.example/path' }), /DASHBOARD_ORIGIN/);
  assert.throws(() => loadConfig({ ...env, NODE_ENV: 'production', DASHBOARD_ORIGIN: 'http://localhost:3001' }), /DASHBOARD_ORIGIN/);
});

test('payment.record authorizes recording alone and uses the existing Staff grant', () => {
  assert.equal(staffPermissions.get('payment.record'), StaffPermission.PAYMENT_RECORD);
  assert.equal(hasAction(Role.ADMIN, [], 'payment.record'), true);
  assert.equal(hasAction(Role.STAFF, [], 'payment.record'), false);
  assert.equal(hasAction(Role.STAFF, [StaffPermission.PAYMENT_VERIFY, StaffPermission.PAYMENT_ALLOCATE], 'payment.record'), false);
  for (const role of [Role.STAFF, Role.COACH, Role.CLIENT]) {
    const grants = [StaffPermission.PAYMENT_RECORD];
    assert.equal(hasAction(role, grants, 'payment.record'), role === Role.STAFF);
    assert.equal(hasAction(role, grants, 'payment.allocate'), false);
    assert.equal(hasAction(role, grants, 'membership.activate'), false);
  }
});

test('payment.verify authorizes only Admin and cannot be assigned as a Staff grant', () => {
  assert.equal(hasAction(Role.ADMIN, [], 'payment.verify'), true);
  assert.equal(staffPermissions.has('payment.verify'), false);
  for (const role of [Role.STAFF, Role.COACH, Role.CLIENT]) {
    assert.equal(hasAction(role, Object.values(StaffPermission), 'payment.verify'), false);
  }
});
