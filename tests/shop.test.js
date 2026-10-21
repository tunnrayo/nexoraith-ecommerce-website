'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const crypto = require('crypto');
const { setup, client } = require('./helpers');
let ctx; let c;
test.before(async () => { ctx = await setup(); });
test.after(() => ctx.server.close());
const csrf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
const variantId = (sku) => ctx.db.q.get('SELECT id FROM variants WHERE sku=?', sku).id;
const refOf = (r) => r.location.split('/')[2].split('?')[0];
async function addToCart(cl, sku, qty = 1) {
  await cl.get('/shop');
  return cl.post('/cart/add', { _csrf: cl.jar.nx_csrf, variant_id: variantId(sku), quantity: qty, back: '/shop' });
}
const form = (extra = {}) => ({ name: 'Ada Obi', email: 'ada@example.com', phone: '+2348012345678', address: '12 Test Street', city: 'Lagos', state: 'Lagos', zone_id: ctx.db.q.get("SELECT id FROM delivery_zones WHERE name='Test zone'").id, ...extra });
async function placeOrder(cl, extra = {}) {
  const page = await cl.get('/checkout'); assert.equal(page.status, 200);
  const key = page.text.match(/name="checkout_key" value="([^"]+)"/)[1];
  return cl.post('/checkout', { _csrf: csrf(page.text), checkout_key: key, ...form(extra) });
}

test('storefront pages render with real catalogue data', async () => {
  c = client(ctx.base);
  const home = await c.get('/'); assert.equal(home.status, 200); assert.match(home.text, /Shop Smarter\. Live Better\./); assert.match(home.text, /NEXORAITHABSOLUTEVENTURES@GMAIL\.COM/);
  const shop = await c.get('/shop'); assert.match(shop.text, /Stoneware Ceramic Mug/); assert.match(shop.text, /12 products found/);
  assert.match((await c.get('/shop?q=wallet')).text, /1 product found/);
  assert.match((await c.get('/shop?q=zzzzqq')).text, /No products found/);
  assert.match((await c.get('/shop?category=tech-accessories')).text, /4 products found/);
  const asc = (await c.get('/shop?sort=price_asc')).text; assert.ok(asc.indexOf('Cable Organiser Set') < asc.indexOf('Linen Throw Cushion'));
  assert.equal((await c.get('/product/does-not-exist')).status, 404);
});
test('supplier cost and ids never appear in public HTML', async () => {
  const v = variantId('DEV-MUG-WHT');
  ctx.db.q.run("INSERT INTO supplier_mappings(variant_id,supplier_product_id,supplier_variant_id,cost_minor) VALUES(?,?,?,?)", v, 'SECRETPID', 'SECRETVID', 123456);
  const html = (await c.get('/product/demo-ceramic-mug')).text + (await c.get('/shop')).text;
  assert.ok(!/SECRETPID|SECRETVID|1234\.56|123456/.test(html));
});
test('cart: add, merge, update, remove; unavailable/unverified/out-of-stock rejected', async () => {
  const cl = client(ctx.base);
  assert.equal((await addToCart(cl, 'DEV-MUG-WHT', 2)).status, 303);
  await addToCart(cl, 'DEV-MUG-WHT', 1);
  let cart = (await cl.get('/cart')).text; assert.match(cart, /value="3"/); assert.match(cart, /13,500\.00/);
  await cl.post('/cart/update', { _csrf: csrf(cart), variant_id: variantId('DEV-MUG-WHT'), quantity: 1 });
  cart = (await cl.get('/cart')).text; assert.match(cart, /4,500\.00/);
  for (const sku of ['DEV-MUG-BLK', 'DEV-CUSH-BEI', 'DEV-PWR-20K']) await addToCart(cl, sku);
  assert.equal(ctx.db.q.get('SELECT COUNT(*) n FROM cart_items').n >= 1, true);
  const unavailable = ctx.db.q.all("SELECT 1 FROM cart_items WHERE variant_id IN (SELECT id FROM variants WHERE sku IN ('DEV-MUG-BLK','DEV-CUSH-BEI','DEV-PWR-20K'))");
  assert.equal(unavailable.length, 0, 'unavailable, unverified and out-of-stock items must not enter the cart');
  await addToCart(cl, 'DEV-WAL-BRN', 50); // capped by max quantity and stock (3)
  assert.equal(ctx.db.q.all("SELECT quantity FROM cart_items WHERE variant_id=?", variantId('DEV-WAL-BRN')).length, 0, 'quantity above stock is refused');
  await cl.post('/cart/remove', { _csrf: csrf(cart), variant_id: variantId('DEV-MUG-WHT') });
  assert.match((await cl.get('/cart')).text, /Your cart is empty/);
});
test('CSRF: cart POST without token is rejected', async () => {
  const cl = client(ctx.base); await cl.get('/shop');
  assert.equal((await cl.post('/cart/add', { variant_id: variantId('DEV-MUG-WHT'), quantity: 1 })).status, 403);
});
test('checkout validation preserves input and shows errors', async () => {
  const cl = client(ctx.base); await addToCart(cl, 'DEV-STAND-SLV');
  const r = await placeOrder(cl, { email: 'nope' });
  assert.equal(r.status, 422); assert.match(r.text, /valid email/); assert.match(r.text, /value="Ada Obi"/);
});
test('order: server computes totals, snapshots items, ignores browser prices, blocks duplicates', async () => {
  const cl = client(ctx.base); await addToCart(cl, 'DEV-TOTE-L', 2); await addToCart(cl, 'DEV-STAND-SLV', 1);
  const page = await cl.get('/checkout'); const key = page.text.match(/name="checkout_key" value="([^"]+)"/)[1];
  const body = { _csrf: csrf(page.text), checkout_key: key, ...form(), total: '1', price: '1', total_minor: '1' };
  const r = await cl.post('/checkout', body); assert.equal(r.status, 303); assert.match(r.location, /^\/order\/NX-[A-Z0-9]+\?t=/);
  const o = ctx.db.q.get('SELECT * FROM orders WHERE reference=?', refOf(r));
  assert.equal(o.subtotal_minor, 1850000); assert.equal(o.delivery_fee_minor, 150000); assert.equal(o.total_minor, 2000000);
  assert.equal(o.status, 'pending_payment'); assert.equal(o.payment_status, 'unpaid'); assert.equal(o.fulfillment_status, 'not_started');
  assert.equal(ctx.db.q.all('SELECT * FROM order_items WHERE order_id=?', o.id).length, 2);
  ctx.db.q.run("UPDATE variants SET price_minor=999999 WHERE sku='DEV-TOTE-L'");
  assert.equal(ctx.db.q.get('SELECT unit_price_minor u FROM order_items WHERE order_id=? AND sku=?', o.id, 'DEV-TOTE-L').u, 750000, 'snapshot keeps the order-time price');
  ctx.db.q.run("UPDATE variants SET price_minor=750000 WHERE sku='DEV-TOTE-L'");
  const n = ctx.db.q.get('SELECT COUNT(*) n FROM orders').n; await addToCart(cl, 'DEV-STAND-SLV');
  const dup = await cl.post('/checkout', body); assert.equal(dup.status, 303); assert.equal(ctx.db.q.get('SELECT COUNT(*) n FROM orders').n, n, 'same checkout key must not create a second order');
  const emptied = client(ctx.base); assert.match((await emptied.get('/cart')).text, /empty/);
});
test('order page needs the secret token; other customers cannot view it', async () => {
  const cl = client(ctx.base); await addToCart(cl, 'DEV-STAND-SLV'); const r = await placeOrder(cl);
  const [path] = r.location.split('?'); const anon = client(ctx.base);
  assert.equal((await anon.get(path)).status, 404); assert.equal((await anon.get(path + '?t=wrong')).status, 404);
  const ok = await anon.get(r.location); assert.equal(ok.status, 200); assert.match(ok.text, /Total payable/);
});
test('payment: webhook rejects bad signature; success needs matching amount; idempotent', async () => {
  const cl = client(ctx.base); await addToCart(cl, 'DEV-WAL-BRN', 1); const r = await placeOrder(cl);
  const ref = refOf(r); const o = ctx.db.q.get('SELECT * FROM orders WHERE reference=?', ref);
  const pref = `${ref}-P1-test`; ctx.db.q.run("INSERT INTO payments(order_id,provider,reference,amount_minor,currency,status) VALUES(?,?,?,?,?,'pending')", o.id, 'paystack', pref, o.total_minor, 'NGN');
  const send = (evt, sig) => { const raw = JSON.stringify(evt); const s = sig ?? crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex'); return fetch(ctx.base + '/webhooks/paystack', { method: 'POST', headers: { 'x-paystack-signature': s, 'content-type': 'application/json' }, body: raw }); };
  const evt = { event: 'charge.success', data: { id: 777, reference: pref, amount: o.total_minor, currency: 'NGN', status: 'success' } };
  assert.equal((await send(evt, 'bad')).status, 401); assert.equal(ctx.db.q.get('SELECT payment_status p FROM orders WHERE id=?', o.id).p, 'unpaid');
  assert.equal((await send({ ...evt, data: { ...evt.data, id: 778, amount: 100 } })).status, 200);
  let row = ctx.db.q.get('SELECT * FROM orders WHERE id=?', o.id); assert.equal(row.payment_status, 'unpaid', 'amount mismatch must not mark paid'); assert.match(row.admin_notes, /REVIEW/);
  ctx.db.q.run("UPDATE payments SET status='pending' WHERE reference=?", pref);
  const stockBefore = ctx.db.q.get("SELECT stock_qty s FROM variants WHERE sku='DEV-WAL-BRN'").s;
  assert.equal((await send(evt)).status, 200); row = ctx.db.q.get('SELECT * FROM orders WHERE id=?', o.id);
  assert.equal(row.payment_status, 'paid'); assert.equal(row.status, 'confirmed'); assert.equal(row.fulfillment_status, 'awaiting_supplier');
  assert.equal(ctx.db.q.get("SELECT stock_qty s FROM variants WHERE sku='DEV-WAL-BRN'").s, stockBefore - 1);
  assert.equal((await send(evt)).status, 200); assert.equal((await send(evt)).status, 200);
  assert.equal(ctx.db.q.get("SELECT stock_qty s FROM variants WHERE sku='DEV-WAL-BRN'").s, stockBefore - 1, 'replayed webhook must not process twice');
});
test('payment return page alone never marks an order paid', async () => {
  const cl = client(ctx.base); await addToCart(cl, 'DEV-STAND-SLV', 1); const r = await placeOrder(cl);
  const ref = refOf(r); const o = ctx.db.q.get('SELECT * FROM orders WHERE reference=?', ref);
  ctx.db.q.run("INSERT INTO payments(order_id,provider,reference,amount_minor,currency,status) VALUES(?,?,?,?,?,'pending')", o.id, 'paystack', `${ref}-P1-zz`, o.total_minor, 'NGN');
  assert.equal((await cl.get(`/payment/callback?reference=${ref}-P1-zz`)).status, 303);
  assert.notEqual(ctx.db.q.get('SELECT payment_status p FROM orders WHERE id=?', o.id).p, 'paid');
  assert.equal((await cl.get('/payment/callback?reference=unknown')).status, 404);
});
test('paying without a Paystack key keeps the order, takes no money, explains why', async () => {
  const config = require('../src/config'); const keep = config.paystack.secret; const keepDemo = config.demoMode; config.paystack.secret = ''; config.demoMode = false;
  try {
    const cl = client(ctx.base); await addToCart(cl, 'DEV-STAND-SLV'); const r = await placeOrder(cl); const page = await cl.get(r.location);
    const pay = await cl.post(`/order/${refOf(r)}/pay`, { _csrf: csrf(page.text), t: r.location.split('t=')[1] });
    assert.equal(pay.status, 303); assert.match(pay.location, /^\/order\//);
    assert.match((await cl.get(pay.location)).text, /not switched on/);
  } finally { config.paystack.secret = keep; config.demoMode = keepDemo; }
});
test('contact form validates, stores, and ignores honeypot bots', async () => {
  const cl = client(ctx.base); const t = csrf((await cl.get('/contact')).text);
  assert.equal((await cl.post('/contact', { _csrf: t, name: 'A', email: 'bad', message: 'hi' })).status, 422);
  const ok = await cl.post('/contact', { _csrf: t, name: 'Ada', email: 'a@b.co', subject: 'Hi', message: 'Hello, I have a question about an order.' }); assert.equal(ok.status, 200); assert.match(ok.text, /received/);
  assert.equal(ctx.db.q.get('SELECT COUNT(*) n FROM inquiries').n, 1);
  await cl.post('/contact', { _csrf: t, name: 'Bot', email: 'b@b.co', message: 'spam spam spam spam', website: 'http://x' }); assert.equal(ctx.db.q.get('SELECT COUNT(*) n FROM inquiries').n, 1);
});
test('admin: blocked when logged out; login works; wrong password fails; CSRF enforced', async () => {
  const sec = require('../src/security'); ctx.db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?)', 'boss@example.test', sec.hashPassword('a-long-test-password'));
  const anon = client(ctx.base);
  for (const p of ['/admin', '/admin/orders', '/admin/products', '/admin/inquiries', '/admin/delivery', '/admin/supplier']) { const r = await anon.get(p); assert.equal(r.status, 303); assert.equal(r.location, '/admin/login'); }
  assert.equal((await anon.post('/admin/products/1', { name: 'x' })).status, 303);
  const t = csrf((await anon.get('/admin/login')).text);
  assert.equal((await anon.post('/admin/login', { _csrf: t, email: 'boss@example.test', password: 'wrong' })).location, '/admin/login');
  assert.equal((await anon.post('/admin/login', { _csrf: t, email: 'boss@example.test', password: 'a-long-test-password' })).location, '/admin');
  const dash = await anon.get('/admin'); assert.equal(dash.status, 200); assert.match(dash.text, /Dashboard/);
  assert.equal((await anon.post('/admin/delivery/1', { name: 'x' })).status, 403);
  assert.match((await anon.get('/admin/orders')).text, /NX-/);
});
test('admin: shipped needs tracking; unpaid orders cannot be shipped; supplier submit is off by default', async () => {
  const adm = client(ctx.base); await adm.post('/admin/login', { _csrf: csrf((await adm.get('/admin/login')).text), email: 'boss@example.test', password: 'a-long-test-password' });
  const paid = ctx.db.q.get("SELECT * FROM orders WHERE payment_status='paid'"); const unpaid = ctx.db.q.get("SELECT * FROM orders WHERE payment_status='unpaid' LIMIT 1");
  const t = csrf((await adm.get(`/admin/orders/${paid.reference}`)).text);
  await adm.post(`/admin/orders/${paid.reference}/fulfilment`, { _csrf: t, to: 'processing' });
  await adm.post(`/admin/orders/${paid.reference}/fulfilment`, { _csrf: t, to: 'shipped', tracking_number: '' });
  assert.equal(ctx.db.q.get('SELECT fulfillment_status f FROM orders WHERE id=?', paid.id).f, 'processing');
  await adm.post(`/admin/orders/${paid.reference}/fulfilment`, { _csrf: t, to: 'shipped', tracking_number: 'TRK123' });
  assert.equal(ctx.db.q.get('SELECT fulfillment_status f FROM orders WHERE id=?', paid.id).f, 'shipped');
  await adm.post(`/admin/orders/${unpaid.reference}/fulfilment`, { _csrf: t, to: 'shipped', tracking_number: 'X' });
  assert.equal(ctx.db.q.get('SELECT fulfillment_status f FROM orders WHERE id=?', unpaid.id).f, 'not_started');
  assert.equal((await adm.post(`/admin/orders/${paid.reference}/supplier`, { _csrf: t, confirm: 'yes' })).status, 303);
  assert.equal(ctx.db.q.get('SELECT COUNT(*) n FROM supplier_orders').n, 0);
});
test('security headers present, no secrets in pages, path traversal blocked', async () => {
  const r = await fetch(ctx.base + '/'); assert.match(r.headers.get('content-security-policy'), /script-src 'self'/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(!(await r.text()).includes(process.env.PAYSTACK_SECRET_KEY));
  assert.equal((await fetch(ctx.base + '/..%2f..%2fetc/passwd')).status, 404);
  assert.equal((await fetch(ctx.base + '/webhooks/paystack', { method: 'POST', body: '{}' })).status, 401);
});
