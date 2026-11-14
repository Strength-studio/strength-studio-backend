const { test } = require('node:test');
const assert = require('node:assert/strict');
const { membershipValidity } = require('../dist/purchases/membership-activation.service.js');

test('membership validity starts on the Riyadh approval date and includes the entire final date', () => {
  for (const [instant, days, start, end] of [
    ['2026-11-11T20:59:59.999Z', 1, '2026-11-11', '2026-11-11'],
    ['2026-11-11T21:00:00.000Z', 3, '2026-11-12', '2026-11-14'],
    ['2028-02-28T21:00:00.000Z', 2, '2028-02-29', '2028-03-01'],
    ['2026-12-31T20:59:00.000Z', 2, '2026-12-31', '2027-01-01'],
  ]) {
    assert.deepEqual(membershipValidity(new Date(instant), days), {
      validFrom: new Date(start), validThrough: new Date(end),
    });
  }
});

test('membership validity rejects an end date outside the API calendar range', () => {
  assert.throws(() => membershipValidity(new Date('2026-11-14T00:00:00Z'), 2_147_483_647), {
    response: { code: 'PURCHASE_VALIDITY_OUT_OF_RANGE' },
  });
});
