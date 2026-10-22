'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function parseCookies(h = '') {
  const out = {};
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ } }
  }
  return out;
}
function cookie(name, value, { maxAge, httpOnly = true } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (httpOnly) c += '; HttpOnly';
  if (cfg.isProd) c += '; Secure';
  if (maxAge != null) c += `; Max-Age=${maxAge}`;
  return c;
}
// Simple in-memory rate limiter (per process). Good enough for one small server.
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return arr.length <= max;
}
const resetRateLimits = () => hits.clear(); // for automated tests
// Password hashing with scrypt
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const k = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64); const want = Buffer.from(key, 'hex');
  return k.length === want.length && crypto.timingSafeEqual(k, want); // a malformed stored hash fails safely instead of throwing
}
// Admin login tokens are stored only as a keyed hash (HMAC with SESSION_SECRET when set, plain SHA-256 otherwise),
// so a copy of the database alone cannot be used to forge a session.
const sessionHash = (t) => (cfg.sessionSecret ? crypto.createHmac('sha256', cfg.sessionSecret).update(String(t)).digest('hex') : sha256(String(t)));
// The visitor's address. Behind a hosting proxy only the LAST X-Forwarded-For entry (added by the proxy itself) is trusted.
function clientIp(req) {
  if (cfg.trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (xff.length) return xff[xff.length - 1].slice(0, 64);
  }
  return req.socket.remoteAddress || 'unknown';
}
module.exports = { resetRateLimits, sessionHash, clientIp, esc, rand, sha256, safeEqual, parseCookies, cookie, rateLimit, hashPassword, verifyPassword };
