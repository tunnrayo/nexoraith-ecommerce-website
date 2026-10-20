'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const money = require('../src/money'); const validate = require('../src/validate'); const paystack = require('../src/payments/paystack'); const sec = require('../src/security');
test('money: parses and formats exact minor units', () => {
  assert.equal(money.parseToMinor('1,500.50'), 150050); assert.equal(money.parseToMinor('0.1'), 10); assert.equal(money.parseToMinor('19.99'), 1999);
  assert.equal(money.parseToMinor('abc'), null); assert.equal(money.parseToMinor('-5'), null); assert.equal(money.parseToMinor('1.234'), null);
  assert.equal(money.toMajorString(150050), '1500.50');
});
test('checkout validation rejects bad input and accepts good input', () => {
  const zones = [{ id: 1 }];
  const bad = validate.checkout({ name: 'A', email: 'x', phone: '12', address: '', city: '', state: '', zone_id: '9' }, zones);
  assert.equal(bad.ok, false); for (const k of ['name', 'email', 'phone', 'address', 'city', 'state', 'zone_id']) assert.ok(bad.e[k], k);
  const good = validate.checkout({ name: 'Ada Obi', email: 'Ada@Example.com', phone: '+234 801 234 5678', address: '12 Test Street', city: 'Lagos', state: 'Lagos', zone_id: '1' }, zones);
  assert.equal(good.ok, true); assert.equal(good.v.email, 'ada@example.com');
});
test('paystack webhook signature: valid accepted, tampered/missing rejected', () => {
  const body = Buffer.from('{"event":"charge.success"}'); const secret = 'sk_test_x';
  const sig = require('crypto').createHmac('sha512', secret).update(body).digest('hex');
  assert.equal(paystack.verifySignature(body, sig, secret), true);
  assert.equal(paystack.verifySignature(Buffer.from('{"event":"charge.successX"}'), sig, secret), false);
  assert.equal(paystack.verifySignature(body, '', secret), false); assert.equal(paystack.verifySignature(body, sig, ''), false);
});
test('password hashing verifies only the right password', () => {
  const h = sec.hashPassword('correct horse battery'); assert.equal(sec.verifyPassword('correct horse battery', h), true); assert.equal(sec.verifyPassword('wrong', h), false);
});
test('html escaping', () => assert.equal(sec.esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;'));
