'use strict';
// Admin portal: sign-in with an environment-supplied password, session protection, activity log, password change,
// dashboard figures (only verified money counts) and the Website Health-Check Centre.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const { setup, client } = require('./helpers');
const PW = 'Zq9!test**only-password'; // test-only value, not a real credential
const SECRET = 'test-session-secret-0123456789-0123456789-abcdef';
let ctx; let adm;
const csrf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
const login = async (c, email = 'owner@example.test', password = PW) => c.post('/admin/login', { _csrf: csrf((await c.get('/admin/login')).text), email, password });
test.before(async () => {
  ctx = await setup({ DEMO_CHECKOUT: 'false', PAYMENT_TIMING: 'review_first', SESSION_SECRET: SECRET });
  const sec = require('../src/security'); ctx.db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?)', 'owner@example.test', sec.hashPassword(PW));
  adm = client(ctx.base);
});
test.after(() => ctx.server.close());

test('a password containing symbols works; wrong passwords and unknown users fail identically; failures are logged', async () => {
  const c = client(ctx.base);
  assert.equal((await login(c, 'owner@example.test', 'wrong-password-123')).location, '/admin/login');
  assert.equal((await login(c, 'nobody@example.test', PW)).location, '/admin/login');
  assert.equal((await c.get('/admin')).location, '/admin/login', 'still signed out');
  const r = await login(adm); assert.equal(r.location, '/admin');
  const dash = await adm.get('/admin'); assert.equal(dash.status, 200); assert.match(dash.text, /Business overview/);
  const log = ctx.db.q.all('SELECT actor, action FROM admin_audit').map((x) => `${x.actor}|${x.action}`);
  assert.ok(log.includes('owner@example.test|login') && log.includes('owner@example.test|login failed') && log.includes('nobody@example.test|login failed'));
});
test('session cookie is HttpOnly and SameSite; its token is stored only as a keyed hash (HMAC with SESSION_SECRET)', async () => {
  const c = client(ctx.base); const page = await c.get('/admin/login');
  const r = await fetch(ctx.base + '/admin/login', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `nx_csrf=${encodeURIComponent(csrf(page.text))}` }, body: new URLSearchParams({ _csrf: csrf(page.text), email: 'owner@example.test', password: PW }).toString() });
  const sc = r.headers.getSetCookie().find((x) => x.startsWith('nx_admin=')); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/);
  const token = decodeURIComponent(sc.split(';')[0].split('=')[1]); const crypto = require('crypto');
  const hmac = crypto.createHmac('sha256', SECRET).update(token).digest('hex');
  assert.ok(ctx.db.q.get('SELECT 1 x FROM admin_sessions WHERE token_hash=?', hmac), 'stored as HMAC');
  assert.ok(!ctx.db.q.get('SELECT 1 x FROM admin_sessions WHERE token_hash=?', crypto.createHash('sha256').update(token).digest('hex')), 'plain hash is not accepted');
  assert.ok(!JSON.stringify(ctx.db.q.all('SELECT * FROM admin_sessions')).includes(token), 'raw token never stored');
});
test('every admin page and every admin action refuses an anonymous visitor', async () => {
  const c = client(ctx.base);
  for (const p of ['/admin', '/admin/orders', '/admin/orders/NX-1', '/admin/products', '/admin/products/new', '/admin/products/1', '/admin/categories', '/admin/delivery', '/admin/inquiries', '/admin/settings', '/admin/health', '/admin/audit', '/admin/account']) {
    const r = await c.get(p); assert.equal(r.status, 303, p); assert.equal(r.location, '/admin/login', p);
  }
  for (const p of ['/admin/products/new', '/admin/products/1', '/admin/products/1/quick', '/admin/categories/new', '/admin/delivery/new', '/admin/settings', '/admin/settings/approved-import', '/admin/settings/remove-demo', '/admin/health/run', '/admin/account/password', '/admin/orders/NX-1/cancel', '/admin/inquiries/1/handled']) {
    const r = await c.post(p, { name: 'x' }); assert.equal(r.location, '/admin/login', p);
  }
  assert.equal(ctx.db.q.get('SELECT COUNT(*) n FROM admin_audit WHERE action LIKE ?', 'POST %').n, 0, 'rejected requests are not recorded as admin actions');
});
test('admin POSTs without the session security token are refused (CSRF)', async () => {
  const r = await adm.post('/admin/settings', { payment_timing: 'pay_first' });
  assert.equal(r.status, 403);
});
test('admin changes are written to the activity log without form contents', async () => {
  const T = csrf((await adm.get('/admin')).text); const p = ctx.db.q.get("SELECT id FROM products WHERE status='published' LIMIT 1");
  const r = await adm.post(`/admin/products/${p.id}/quick`, { _csrf: T, back: '/admin/products', availability: 'temporarily_unavailable', status: 'published' });
  assert.equal(r.status, 303);
  const row = ctx.db.q.get("SELECT * FROM admin_audit WHERE action LIKE 'POST products/%quick' ORDER BY id DESC LIMIT 1"); assert.ok(row); assert.equal(row.actor, 'owner@example.test');
  assert.ok(!JSON.stringify(ctx.db.q.all('SELECT * FROM admin_audit')).includes(PW), 'password never logged');
  const page = (await adm.get('/admin/audit')).text; assert.match(page, /Activity log/); assert.match(page, /owner@example.test/);
});
test('password change: needs the current password, 12+ characters, matching repeats; signs out other sessions', async () => {
  require('../src/security').resetRateLimits();
  const other = client(ctx.base); await login(other); assert.equal((await other.get('/admin')).status, 200);
  const T = csrf((await adm.get('/admin/account')).text);
  const fail = async (f) => { const r = await adm.post('/admin/account/password', { _csrf: T, ...f }); assert.equal(r.status, 303); return (await adm.get('/admin/account')).text; };
  assert.match(await fail({ current: 'nope', password: 'a-brand-new-password-1', password2: 'a-brand-new-password-1' }), /current password is not correct/);
  assert.match(await fail({ current: PW, password: 'short', password2: 'short' }), /at least 12/);
  assert.match(await fail({ current: PW, password: 'a-brand-new-password-1', password2: 'different-password-22' }), /do not match/);
  require('../src/security').resetRateLimits(); const NEW = 'A-new-Private-Password-2026!';
  await adm.post('/admin/account/password', { _csrf: T, current: PW, password: NEW, password2: NEW });
  assert.equal((await adm.get('/admin')).status, 200, 'this session stays signed in');
  assert.equal((await other.get('/admin')).location, '/admin/login', 'other sessions are signed out');
  assert.equal((await login(client(ctx.base), 'owner@example.test', PW)).location, '/admin/login', 'old password no longer works');
  assert.equal((await login(client(ctx.base), 'owner@example.test', NEW)).location, '/admin', 'new password works');
  assert.ok(!JSON.stringify(ctx.db.q.all('SELECT * FROM admin_audit')).includes(NEW));
});
test('dashboard counts only verified payments as money received; waiting orders are not income', async () => {
  const mk = (ref, status, pay) => ctx.db.q.run("INSERT INTO orders(reference,status,payment_status,customer_name,customer_email,customer_phone,ship_address,ship_city,ship_state,ship_country,currency,subtotal_minor,delivery_fee_minor,total_minor) VALUES(?,?,?,'T','t@example.test','0801','x','y','z','NG','NGN',100000,0,100000)", ref, status, pay);
  mk('NX-DASH1', 'awaiting_payment', 'unpaid'); mk('NX-DASH2', 'confirmed', 'paid');
  let page = (await adm.get('/admin')).text; assert.match(page, /Verified payments received<\/dt><dd>none/);
  assert.match(page, /Orders waiting for review \/ payment \(not income\)<\/dt><dd>[^<]*1,000\.00/);
  const id = ctx.db.q.get("SELECT id FROM orders WHERE reference='NX-DASH2'").id;
  ctx.db.q.run("INSERT INTO payments(order_id,provider,reference,amount_minor,currency,status,paid_at) VALUES(?,'paystack','dash-ref-1',100000,'NGN','success',datetime('now'))", id);
  page = (await adm.get('/admin')).text; assert.match(page, /Verified payments received<\/dt><dd>[^<]*1,000\.00[^<]*1 order/);
});

test('health centre: runs real checks, statuses are from the allowed set, nothing is called PASS without running, no secrets or stack traces shown', async () => {
  const T = csrf((await adm.get('/admin/health')).text);
  assert.match((await adm.get('/admin/health')).text, /No check has been run yet/);
  assert.equal((await adm.post('/admin/health/run', { _csrf: T })).status, 303);
  const last = require('../src/health').last(); assert.ok(last && last.results.length > 50);
  const allowed = ['PASS', 'FAIL', 'WARNING', 'NOT RUN', 'BLOCKED']; for (const r of last.results) { assert.ok(allowed.includes(r.status), r.name); assert.ok(r.at && r.detail, r.name); }
  const by = (n) => last.results.find((r) => r.name === n);
  assert.equal(by('Homepage').status, 'PASS'); assert.equal(by('Add to cart').status, 'PASS'); assert.equal(by('Checkout validation').status, 'PASS');
  assert.equal(by('Admin pages require sign-in').status, 'PASS'); assert.equal(by('Payment webhook rejects forged calls').status, 'PASS');
  assert.equal(by('Order creation and payment verification').status, 'NOT RUN');
  assert.equal(by('Responsive layout, colour contrast, keyboard use').status, 'NOT RUN');
  assert.equal(by('Paystack key accepted by Paystack').status, 'NOT RUN', 'credential validity is never claimed');
  assert.equal(by('Session secret (SESSION_SECRET)').status, 'PASS');
  assert.equal(ctx.db.q.get('SELECT COUNT(*) n FROM carts').n, 0, 'the throw-away cart was removed');
  assert.equal(ctx.db.q.get("SELECT COUNT(*) n FROM orders WHERE customer_email='not-an-email'").n, 0);
  assert.equal(ctx.db.q.get("SELECT COUNT(*) n FROM settings WHERE key='__health_probe__'").n, 0, 'write test rolled back');
  const page = (await adm.get('/admin/health')).text; assert.match(page, /Last run/);
  for (const secret of [SECRET, 'sk_test_unit_test_secret', PW]) assert.ok(!page.includes(secret), 'secret value not displayed');
  assert.doesNotMatch(page, /at .*\.js:\d+|node:internal|Error:/);
  assert.match((await adm.get('/admin')).text, /last check/);
});
test('health centre detects real problems (a paid order with no verified payment, a missing photo file)', async () => {
  ctx.db.q.run("INSERT INTO orders(reference,status,payment_status,customer_name,customer_email,customer_phone,ship_address,ship_city,ship_state,ship_country,currency,subtotal_minor,delivery_fee_minor,total_minor) VALUES('NX-FAKEPAID','confirmed','paid','T','t@example.test','0801','x','y','z','NG','NGN',5000,0,5000)");
  const pid = ctx.db.q.get("SELECT id FROM products WHERE status='published' LIMIT 1").id;
  ctx.db.q.run("UPDATE products SET card_image_url='/images/products/does-not-exist.jpg' WHERE id=?", pid);
  const res = require('../src/health').databaseChecks(); const by = (n) => res.find((r) => r.name === n);
  assert.equal(by('Every paid order has a verified payment').status, 'FAIL');
  assert.equal(by('Product photos present').status, 'WARNING');
  const T = csrf((await adm.get('/admin/health')).text); await adm.post('/admin/health/run', { _csrf: T });
  assert.match((await adm.get('/admin/health')).text, /marked paid without a successful verified payment/);
  ctx.db.q.run("DELETE FROM orders WHERE reference='NX-FAKEPAID'");
});
test('SESSION_SECRET and proxy handling: behind a proxy the visitor address is the last X-Forwarded-For entry', () => {
  const run = (env, code) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', code], { cwd: path.join(__dirname, '..'), env: { PATH: process.env.PATH, ...env } }).toString().trim();
  const code = "const s=require('./src/security');console.log(s.clientIp({headers:{'x-forwarded-for':'6.6.6.6, 41.1.2.3'},socket:{remoteAddress:'10.0.0.1'}}), s.sessionHash('abc').length)";
  assert.equal(run({ TRUST_PROXY: 'true' }, code), '41.1.2.3 64');
  assert.equal(run({ TRUST_PROXY: 'false' }, code), '10.0.0.1 64', 'header ignored when no proxy is trusted');
  assert.equal(run({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40) }, code), '41.1.2.3 64', 'production trusts the proxy by default');
  const a = run({ SESSION_SECRET: 'k1'.repeat(20) }, "console.log(require('./src/security').sessionHash('abc'))"); const b = run({ SESSION_SECRET: 'k2'.repeat(20) }, "console.log(require('./src/security').sessionHash('abc'))");
  assert.notEqual(a, b, 'different secrets give different hashes');
});
test('.env.local is read by the app but ignored by Git, and no real secret file is tracked', () => {
  const root = path.join(__dirname, '..'); const ign = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(ign, /^\.env\.\*$/m); assert.match(ign, /^!\.env\.example$/m);
  try { const tracked = execFileSync('git', ['ls-files'], { cwd: root }).toString().split('\n'); assert.ok(!tracked.some((f) => /^\.env(\.|$)/.test(f) && f !== '.env.example'), 'no .env file tracked'); } catch (e) { if (e.code !== 'ENOENT' && !/not a git repository/i.test(String(e.stderr))) throw e; }
});

test('hostile text in product names, descriptions and customer messages is escaped everywhere; SQL-style input is harmless', async () => {
  require('../src/security').resetRateLimits();
  const T = csrf((await adm.get('/admin')).text); const XSS = '<script>alert(1)</script><img src=x onerror=alert(2)>';
  const r = await adm.post('/admin/products/new', { _csrf: T, name: `Hostile ${XSS}`, slug: 'hostile-product', summary: XSS, description: XSS, status: 'published', sku: 'HOSTILE-1', label: 'Standard', price: '1000', vavailability: 'available' });
  assert.equal(r.status, 303); assert.match(r.location, /\/admin\/products\/\d+$/);
  const c = client(ctx.base);
  for (const p of ['/product/hostile-product', '/shop?q=Hostile', '/admin/products', `/admin/products/${r.location.split('/').pop()}`]) {
    const html = (p.startsWith('/admin') ? await adm.get(p) : await c.get(p)).text;
    assert.ok(!html.includes('<script>alert'), p); assert.ok(!/<img src=x onerror/.test(html), p);
  }
  // customer contact form: stored as text and shown escaped in the admin inbox
  const page = await c.get('/contact'); const ct = csrf(page.text);
  await c.post('/contact', { _csrf: ct, name: XSS, email: 'a@example.test', subject: "x'); DROP TABLE orders;--", message: `Hello ${XSS} '; DROP TABLE products;--` });
  assert.ok(ctx.db.q.get('SELECT COUNT(*) n FROM inquiries').n >= 1);
  const inbox = (await adm.get('/admin/inquiries')).text; assert.ok(!inbox.includes('<script>alert')); assert.match(inbox, /&lt;script&gt;/);
  assert.ok(ctx.db.q.get("SELECT COUNT(*) n FROM sqlite_master WHERE name IN('orders','products')").n === 2, 'tables intact');
  // search and filter inputs are parameterised
  assert.equal((await c.get(`/shop?q=${encodeURIComponent("' OR 1=1; --")}&category=${encodeURIComponent("x' OR '1'='1")}&sort=price_asc;DROP`)).status, 200);
  assert.equal((await c.get('/order/' + encodeURIComponent("NX'; DROP TABLE orders;--"))).status, 404);
  // open redirect: the "back" field cannot send a customer to another website
  const t2 = csrf((await c.get('/shop')).text); const v = ctx.db.q.get("SELECT id FROM variants WHERE availability='available' LIMIT 1").id;
  const bad = await c.post('/cart/add', { _csrf: t2, variant_id: v, quantity: 99, back: 'https://evil.example/phish' });
  assert.ok(!/evil\.example/.test(bad.location || ''), 'no redirect to another site');
});
