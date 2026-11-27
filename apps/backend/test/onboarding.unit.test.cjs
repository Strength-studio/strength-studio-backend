const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { seal, unseal, secret, validSecret } = require('../dist/onboarding/security.js');
test('onboarding delivery encryption authenticates the key, challenge identity and ciphertext', () => {
  const key = randomBytes(32), message = { to: 'test@example.invalid', url: 'https://studio.invalid/verify-email#token=' + secret() };
  const first = seal(key, 'proof-a', message), second = seal(key, 'proof-a', message);
  assert.notEqual(first, second); assert(!first.includes(message.to)); assert(!first.includes(message.url));
  assert.deepEqual(unseal(key, 'proof-a', first), message);
  assert.throws(() => unseal(key, 'proof-b', first));
  assert.throws(() => unseal(randomBytes(32), 'proof-a', first));
  const tampered = Buffer.from(first, 'base64url'); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => unseal(key, 'proof-a', tampered.toString('base64url')));
});
test('onboarding credentials are independent opaque secrets with strict transport syntax', () => {
  const values = new Set(Array.from({ length: 100 }, secret));
  assert.equal(values.size, 100);
  for (const value of values) assert(validSecret(value));
  for (const value of ['', 'a'.repeat(42), 'a'.repeat(44), '/'.repeat(43), ' '.repeat(43)]) assert(!validSecret(value));
});
