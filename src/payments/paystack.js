'use strict';
// Paystack integration per official docs (https://paystack.com/docs/api/):
//  - POST /transaction/initialize  (amount in minor units, e.g. kobo)
//  - GET  /transaction/verify/:reference
//  - Webhook header x-paystack-signature = HMAC-SHA512(raw request body, secret key)
const crypto = require('crypto');
const cfg = require('../config');
const { safeEqual } = require('../security');

const isConfigured = () => /^sk_(test|live)_/.test(cfg.paystack.secret);
const mode = () => (cfg.paystack.secret.startsWith('sk_live_') ? 'live' : cfg.paystack.secret.startsWith('sk_test_') ? 'test' : 'none');

async function call(method, path, body) {
  const res = await fetch(cfg.paystack.base + path, {
    method,
    headers: { Authorization: `Bearer ${cfg.paystack.secret}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok || !json || json.status !== true) {
    const err = new Error(json?.message || `Paystack request failed (${res.status})`);
    err.httpStatus = res.status; throw err;
  }
  return json.data;
}
const initialize = ({ email, amountMinor, currency, reference, callbackUrl, metadata }) =>
  call('POST', '/transaction/initialize', { email, amount: amountMinor, currency, reference, callback_url: callbackUrl, metadata });
const verify = (reference) => call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);

function verifySignature(rawBody, header, secret = cfg.paystack.secret) {
  if (!secret || !header) return false;
  const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
  return safeEqual(expected, header);
}
module.exports = { isConfigured, mode, initialize, verify, verifySignature };
