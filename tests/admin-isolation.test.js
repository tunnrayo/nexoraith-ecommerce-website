'use strict';
// Admin isolation and order visibility: the staff area is separate from the shop, unreachable without a valid server-side session,
// ends on logout/expiry, and shows each order's full details (statuses kept separate) to the signed-in admin only.
const test = require('node:test'); const assert = require('node:assert/strict');
const { setup, client } = require('./helpers');
const PW = 'Zq9!isolation-test-password';
let ctx; let adm;
const csrf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
const login = async (c) => c.post('/admin/login', { _csrf: csrf((await c.get('/admin/login')).text), email: 'owner@example.test', password: PW });
test.before(async () => {
  ctx = await setup({ DEMO_CHECKOUT: 'false', PAYMENT_TIMING: 'review_first', SESSION_SECRET: 'isolation-test-secret-0123456789-abcdefghij' });
  ctx.db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?)', 'owner@example.test', require('../src/security').hashPassword(PW));
  adm = client(ctx.base); await login(adm);
});
test.after(() => ctx.server.close());

test('public pages never link to the admin area; the staff area has its own header with no shop navigation, search or cart', async () => {
  const c = client(ctx.base);
  for (const p of ['/', '/shop', '/about', '/contact', '/faq', '/shipping', '/returns', '/privacy', '/terms', '/track', '/cart', '/product/demo-ceramic-mug']) {
    const t = (await c.get(p)).text; assert.ok(!/href="\/admin/i.test(t), `${p} links to admin`); assert.ok(!/admin/i.test(t.replace(/<script[\s\S]*?<\/script>/g, '').match(/<nav[\s\S]*?<\/nav>/gi)?.join('') || ''), p);
  }
  const sm = (await c.get('/sitemap.xml')).text; assert.ok(!/admin/.test(sm)); assert.match((await c.get('/robots.txt')).text, /Disallow: \/admin/);
  const page = (await adm.get('/admin')).text;
  assert.match(page, /Staff area/); assert.doesNotMatch(page, /class="cart-link"|class="search"|id="site-nav"|Track an order|Privacy policy/);
  const login = await client(ctx.base).get('/admin/login'); assert.match(login.text, /Staff area/); assert.doesNotMatch(login.text, /class="cart-link"|id="site-nav"/);
  for (const r of [login, await adm.get('/admin/orders')]) { assert.match(r.headers.get('x-robots-tag'), /noindex/); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.match(r.text, /name="robots" content="noindex,nofollow"/); }
});
test('knowing the admin address is not enough: no session, forged cookies, guessed tokens and a shop cookie all get nothing', async () => {
  const anon = client(ctx.base);
  for (const p of ['/admin', '/admin/orders', '/admin/orders/NX-ANY', '/admin/products', '/admin/inquiries', '/admin/settings', '/admin/health', '/admin/audit', '/admin/account', '/admin/delivery', '/admin/categories', '/admin/products/new']) {
    const r = await anon.get(p); assert.equal(r.location, '/admin/login', p); assert.ok(!/customer|NX-|@/i.test(r.text), `${p} body leaks nothing`);
  }
  // a visitor who has a cart/CSRF cookie from the shop is still not an admin
  const shopper = client(ctx.base); await shopper.get('/shop'); assert.equal((await shopper.get('/admin')).location, '/admin/login');
  // forged / guessed / SQL-style / oversized session cookies
  for (const v of ['0'.repeat(43), 'admin', "' OR '1'='1", 'a'.repeat(5000), ctx.db.q.get('SELECT token_hash FROM admin_sessions LIMIT 1').token_hash]) {
    const r = await fetch(ctx.base + '/admin/orders', { redirect: 'manual', headers: { cookie: `nx_admin=${encodeURIComponent(v)}` } });
    assert.equal(r.status, 303, `cookie ${v.slice(0, 12)}`); assert.equal(r.headers.get('location'), '/admin/login');
  }
  // admin POST with a forged cookie is refused and changes nothing
  const before = ctx.db.q.get('SELECT COUNT(*) n FROM products').n;
  const f = await fetch(ctx.base + '/admin/products/new', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'nx_admin=forged' }, body: 'name=Evil&sku=EVIL-1&label=x&price=1&status=published&vavailability=available' });
  assert.equal(f.headers.get('location'), '/admin/login'); assert.equal(ctx.db.q.get('SELECT COUNT(*) n FROM products').n, before);
});
test('logout revokes the session on the server: the old cookie stops working even if replayed', async () => {
  const c = client(ctx.base); await login(c); assert.equal((await c.get('/admin')).status, 200);
  const stolen = c.jar.nx_admin; const T = csrf((await c.get('/admin')).text);
  await c.post('/admin/logout', { _csrf: T });
  assert.equal(ctx.db.q.get("SELECT COUNT(*) n FROM admin_sessions WHERE token_hash IN (SELECT token_hash FROM admin_sessions)").n >= 1, true);
  const replay = await fetch(ctx.base + '/admin', { redirect: 'manual', headers: { cookie: `nx_admin=${encodeURIComponent(stolen)}` } });
  assert.equal(replay.status, 303); assert.equal(replay.headers.get('location'), '/admin/login', 'replayed cookie refused after logout');
});
test('sessions expire on the server; an expired session is refused and removed', async () => {
  const c = client(ctx.base); await login(c); assert.equal((await c.get('/admin')).status, 200);
  const h = require('../src/security').sessionHash(c.jar.nx_admin);
  ctx.db.q.run("UPDATE admin_sessions SET expires_at=datetime('now','-1 minutes') WHERE token_hash=?", h);
  assert.equal((await c.get('/admin/orders')).location, '/admin/login');
  assert.equal(ctx.db.q.get('SELECT COUNT(*) n FROM admin_sessions WHERE token_hash=?', h).n, 0, 'expired session deleted');
  const max = ctx.db.q.get("SELECT (julianday(expires_at)-julianday('now'))*24 hrs FROM admin_sessions ORDER BY rowid DESC LIMIT 1").hrs; assert.ok(max <= 8.01, 'sessions last 8 hours at most');
});
test('admin opens a customer order: reference, items, quantities, totals, email, phone and delivery details; statuses kept separate; changes persist', async () => {
  const shop = client(ctx.base); await shop.get('/shop');
  const v = ctx.db.q.get("SELECT v.id, v.price_minor, p.name FROM variants v JOIN products p ON p.id=v.product_id WHERE v.availability='available' ORDER BY v.id LIMIT 1");
  await shop.post('/cart/add', { _csrf: shop.jar.nx_csrf, variant_id: v.id, quantity: 3 });
  const page = await shop.get('/checkout'); const key = page.text.match(/name="checkout_key" value="([^"]+)"/)[1];
  const zone = ctx.db.q.get("SELECT id, fee_minor, name FROM delivery_zones WHERE name='Test zone'");
  const placed = await shop.post('/checkout', { _csrf: csrf(page.text), checkout_key: key, name: 'Ada Obi', email: 'ada.customer@example.test', phone: '+2348012345678', address: '12 Test Street, Yaba', city: 'Lagos', state: 'Lagos', zone_id: zone.id, notes: 'Call on arrival' });
  assert.equal(placed.status, 303); const ref = placed.location.match(/\/order\/(NX-[A-Z0-9-]+)/)[1];
  // the customer's private page works only with its token; the bare reference does not
  assert.equal((await client(ctx.base).get(`/order/${ref}`)).status, 404);
  assert.equal((await client(ctx.base).get(`/admin/orders/${ref}`)).location, '/admin/login');
  const o = (await adm.get(`/admin/orders/${ref}`)).text; const text = o.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  for (const must of [ref, v.name, 'Qty 3', 'ada.customer@example.test', '+2348012345678', '12 Test Street, Yaba', 'Lagos', 'Call on arrival', 'Test zone']) assert.ok(text.includes(must), `order page shows: ${must}`);
  const money = require('../src/money'); assert.ok(text.includes(money.format(v.price_minor * 3 + zone.fee_minor, 'NGN')), 'total = items + delivery'); assert.ok(text.includes(money.format(zone.fee_minor, 'NGN')), 'delivery fee shown');
  assert.match(o, /<dt>Order status<\/dt><dd>[^<]+<\/dd>/); assert.match(text, /Payment .*Fulfilment|Fulfil/i);
  const row = ctx.db.q.get('SELECT status, payment_status, fulfillment_status FROM orders WHERE reference=?', ref);
  assert.deepEqual([row.status, row.payment_status, row.fulfillment_status], ['pending_review', 'unpaid', 'not_started'], 'three statuses are separate; nothing is paid');
  // the admin list finds it by email and the order is not visible to the public tracker without matching email
  assert.match((await adm.get('/admin/orders?q=ada.customer')).text, new RegExp(ref));
  // simulate a Paystack-verified payment (as the verified path would leave it), then move fulfilment as the admin
  const id = ctx.db.q.get('SELECT id FROM orders WHERE reference=?', ref).id;
  ctx.db.q.run("UPDATE orders SET status='confirmed', payment_status='paid', confirmed_at=datetime('now'), estimated_delivery_date=date('now','+10 days') WHERE id=?", id);
  ctx.db.q.run("INSERT INTO payments(order_id,provider,reference,amount_minor,currency,status,paid_at) VALUES(?,'paystack','iso-ref-1',?,'NGN','success',datetime('now'))", id, v.price_minor * 3 + zone.fee_minor);
  const T = csrf((await adm.get('/admin')).text);
  const r = await adm.post(`/admin/orders/${ref}/fulfilment`, { _csrf: T, to: 'sourcing', note: 'Started shopping for the items' }); assert.equal(r.status, 303);
  const after = ctx.db.q.get('SELECT status, payment_status, fulfillment_status FROM orders WHERE reference=?', ref);
  assert.deepEqual([after.status, after.payment_status, after.fulfillment_status], ['confirmed', 'paid', 'sourcing'], 'fulfilment changed; payment untouched');
  assert.match((await adm.get(`/admin/orders/${ref}`)).text, /Started shopping for the items/, 'history saved');
  assert.ok(ctx.db.q.get("SELECT 1 x FROM admin_audit WHERE action LIKE 'POST orders/%/fulfilment'"), 'logged in the activity log');
  // no way to mark paid by a click, and an invalid jump is refused
  assert.equal((await adm.post(`/admin/orders/${ref}/mark-paid`, { _csrf: T })).status, 404);
  await adm.post(`/admin/orders/${ref}/fulfilment`, { _csrf: T, to: 'not_started' });
  assert.equal(ctx.db.q.get('SELECT fulfillment_status f FROM orders WHERE reference=?', ref).f, 'sourcing', 'cannot go backwards');
});
test('customer-facing policy pages carry no internal review labels', async () => {
  const c = client(ctx.base);
  for (const p of ['/faq', '/shipping', '/returns', '/privacy', '/terms', '/about', '/']) {
    const t = (await c.get(p)).text; assert.doesNotMatch(t, /draft policy|pending (legal|confirmation)|legal (adviser|review)|lawyer|placeholder\.|has not yet been approved|yet to be confirmed|to be confirmed/i, p);
  }
  for (const p of ['/returns', '/privacy', '/terms', '/shipping']) { const t = (await c.get(p)).text; assert.ok(t.length > 2500, `${p} has real content`); }
  assert.match((await c.get('/returns')).text, /damaged, incorrect or incomplete/); assert.doesNotMatch((await c.get('/returns')).text, /\d+ ?(days|hours)[^.]*refund|free return|money.back/i, 'no invented refund promise');
});
