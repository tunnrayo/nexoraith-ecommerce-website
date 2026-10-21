'use strict';
// Each test file gets its own temp database and a real HTTP server on a random port.
const os = require('os'); const path = require('path'); const fs = require('fs');
function setup(env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-'));
  process.env.DATABASE_PATH = path.join(dir, 't.db'); process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  process.env.NODE_ENV = env.NODE_ENV || 'development';
  process.env.PAYSTACK_SECRET_KEY = env.PAYSTACK_SECRET_KEY ?? 'sk_test_unit_test_secret';
  process.env.ALLOW_DEVELOPMENT_PRODUCTS = env.ALLOW_DEVELOPMENT_PRODUCTS ?? 'true';
  process.env.ALLOW_UNCONFIRMED_DELIVERY = env.ALLOW_UNCONFIRMED_DELIVERY ?? 'true';
  process.env.SITE_URL = 'http://localhost:3999';
  const db = require('../src/db'); db.open();
  const { importCatalog } = require('../scripts/import-catalog');
  importCatalog(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'dev-catalog.json'), 'utf8')));
  db.q.run("INSERT INTO delivery_zones(name,country_code,fee_minor,confirmed,active) VALUES('Test zone','NG',150000,1,1)");
  const server = require('../server').createServer();
  return new Promise((res) => server.listen(0, () => res({ server, base: `http://localhost:${server.address().port}`, db })));
}
// Minimal cookie-aware HTTP client
function client(base) {
  const jar = {};
  const store = (r) => { for (const c of r.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i); const v = decodeURIComponent(kv.slice(i + 1)); if (/Max-Age=0/i.test(c)) delete jar[k]; else jar[k] = v; } };
  const hdr = () => Object.entries(jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
  const go = async (method, p, form) => {
    const r = await fetch(base + p, { method, redirect: 'manual', headers: { cookie: hdr(), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: form ? new URLSearchParams(form).toString() : undefined });
    store(r); const text = await r.text(); return { status: r.status, location: r.headers.get('location'), text, headers: r.headers };
  };
  return { jar, get: (p) => go('GET', p), post: (p, f) => go('POST', p, f) };
}
module.exports = { setup, client };
