'use strict';
// v0.3: self-sourcing workflow (review first / pay first), exact-item sourcing, no substitutions without approval,
// 10-day delivery estimate, refunds, customer messages, email, DummyJSON demo import, product availability, DB upgrade.
const test = require('node:test'); const assert = require('node:assert/strict');
const http = require('http'); const crypto = require('crypto'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { execFileSync } = require('child_process');
const { setup, client } = require('./helpers');
let ctx; let adm; let T;
test.before(async () => {
  ctx = await setup({ PAYMENT_TIMING: 'review_first' }); require('../src/bootstrap').ensureZones(true);
  const sec = require('../src/security'); ctx.db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?)', 'owner@example.test', sec.hashPassword('owner-long-password'));
  adm = client(ctx.base); await adm.post('/admin/login', { _csrf: csrf((await adm.get('/admin/login')).text), email: 'owner@example.test', password: 'owner-long-password' });
  T = csrf((await adm.get('/admin')).text);
});
test.after(() => ctx.server.close());
const csrf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
const vid = (sku) => ctx.db.q.get('SELECT id FROM variants WHERE sku=?', sku).id;
const zone = (name) => ctx.db.q.get('SELECT * FROM delivery_zones WHERE name=?', name);
const get = (ref) => ctx.db.q.get('SELECT * FROM orders WHERE reference=?', ref);
const orders = () => require('../src/orders');
const sign = (raw) => crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
async function placeOrder(items, extra = {}) {
  const cl = client(ctx.base); await cl.get('/shop');
  for (const [sku, qn] of items) await cl.post('/cart/add', { _csrf: cl.jar.nx_csrf, variant_id: vid(sku), quantity: qn });
  const page = await cl.get('/checkout'); const key = page.text.match(/name="checkout_key" value="([^"]+)"/)[1];
  const r = await cl.post('/checkout', { _csrf: csrf(page.text), checkout_key: key, name: 'Bola Ade', email: 'bola@example.com', phone: '08031234567', address: '5 Market Road', city: 'Yaba', state: 'Lagos', zone_id: zone('Lagos').id, payment_method: 'paystack', notes: 'Call on arrival', ...extra });
  assert.equal(r.status, 303); const ref = r.location.split('/')[2].split('?')[0];
  return { cl, ref, link: r.location, page };
}
async function paySuccessfully(ref) { // simulates the verified Paystack webhook for this order's amount
  const o = get(ref); const pref = `${ref}-P1-${crypto.randomBytes(6).toString('hex')}`;
  ctx.db.q.run("INSERT INTO payments(order_id,provider,reference,amount_minor,currency,status) VALUES(?,?,?,?,?,'pending')", o.id, 'paystack', pref, o.total_minor, 'NGN');
  const raw = JSON.stringify({ event: 'charge.success', data: { id: Math.floor(Math.random() * 1e9), reference: pref, amount: o.total_minor, currency: 'NGN', status: 'success' } });
  const res = await fetch(ctx.base + '/webhooks/paystack', { method: 'POST', headers: { 'x-paystack-signature': sign(raw), 'content-type': 'application/json' }, body: raw });
  assert.equal(res.status, 200); return get(ref);
}

test('delivery estimate: 10 calendar days from the confirmation date in Africa/Lagos; month, year, leap-year and timezone safe', () => {
  const d = require('../src/delivery-date');
  assert.equal(d.estimate('2026-10-21T10:00:00Z', 10), '2026-10-31');
  assert.equal(d.estimate('2026-10-21 22:59:59', 10), '2026-10-31', '23:59 Lagos time is still 21 October');
  assert.equal(d.estimate('2026-10-21T23:30:00Z', 10), '2026-11-01', '00:30 Lagos time is already 22 October');
  assert.equal(d.estimate('2026-12-25T09:00:00Z', 10), '2027-01-04');
  assert.equal(d.estimate('2028-02-25T12:00:00Z', 10), '2028-03-06', 'leap year');
  assert.equal(d.estimate('2027-02-25T12:00:00Z', 10), '2027-03-07');
  assert.equal(d.formatDate('2026-10-31'), 'Saturday, 31 October 2026');
  assert.equal(d.isYmd('2026-02-30'), false);
});

test('review first: order saved unpaid, no payment possible until the owner confirms every exact item, then confirmation sets the estimate', async () => {
  const { cl, ref, link, page } = await placeOrder([['DEV-SUN-TOR', 1], ['DEV-CAN-OUD', 2]]);
  assert.match(page.text, /Place order \(no payment yet\)/); assert.match(page.text, /10 calendar days/);
  let o = get(ref); assert.equal(o.status, 'pending_review'); assert.equal(o.payment_status, 'unpaid'); assert.equal(o.payment_timing, 'review_first'); assert.equal(o.confirmed_at, null);
  const its = ctx.db.q.all('SELECT * FROM order_items WHERE order_id=?', o.id);
  assert.equal(its.length, 2); assert.match(its[0].image_url, /^\/img\/products\/demo-sunglasses\.svg$/); assert.equal(JSON.parse(its[0].options_json).Frame, 'Tortoise'); assert.equal(its[1].quantity, 2);
  const cust = await cl.get(link); assert.match(cust.text, /Order received/); assert.match(cust.text, /You have not been charged/); assert.match(cust.text, /Frame: Tortoise/); assert.doesNotMatch(cust.text, /\/pay"/);
  const pay = await cl.post(`/order/${ref}/pay`, { _csrf: cl.jar.nx_csrf, t: link.split('t=')[1] }); assert.match((await cl.get(pay.location)).text, /still checking/);
  // owner tries to request payment before checking items -> refused
  await adm.post(`/admin/orders/${ref}/request-payment`, { _csrf: T }); assert.equal(get(ref).status, 'pending_review');
  for (const i of its) await adm.post(`/admin/orders/${ref}/items/${i.id}`, { _csrf: T, item_status: 'available', note: 'Seen at Balogun market' });
  await adm.post(`/admin/orders/${ref}/request-payment`, { _csrf: T }); o = get(ref);
  assert.equal(o.status, 'awaiting_payment'); assert.ok(o.payment_requested_at); assert.equal(o.estimated_delivery_date, null, 'no estimate while payment is pending');
  assert.match((await cl.get(link)).text, /Pay .* securely/);
  o = await paySuccessfully(ref);
  assert.equal(o.status, 'confirmed'); assert.equal(o.payment_status, 'paid'); assert.ok(o.confirmed_at);
  const d = require('../src/delivery-date'); assert.equal(o.estimated_delivery_date, d.estimate(o.confirmed_at, 10));
  const after = await cl.get(link); assert.match(after.text, /Thank you, Bola/); assert.match(after.text, new RegExp(d.formatDate(o.estimated_delivery_date)));
  const adminPage = await adm.get(`/admin/orders/${ref}`);
  for (const re of [/Bola Ade/, /08031234567/, /bola@example\.com/, /5 Market Road/, /Call on arrival/, /Tortoise frame/, /Estimated delivery|Delivery estimate/, /Payment confirmed/]) assert.match(adminPage.text, re);
});

test('exact item unavailable: order flagged, customer told nothing changes without approval; removal needs recorded approval; refund recorded', async () => {
  const { cl, ref, link } = await placeOrder([['DEV-WAT-NVY', 1], ['DEV-CABLE-SET', 1]]);
  const its = ctx.db.q.all('SELECT * FROM order_items WHERE order_id=(SELECT id FROM orders WHERE reference=?) ORDER BY id', ref);
  for (const i of its) await adm.post(`/admin/orders/${ref}/items/${i.id}`, { _csrf: T, item_status: 'available' });
  await adm.post(`/admin/orders/${ref}/request-payment`, { _csrf: T }); await paySuccessfully(ref);
  await adm.post(`/admin/orders/${ref}/items/${its[0].id}`, { _csrf: T, item_status: 'unavailable', note: 'Navy strap sold out everywhere' });
  let o = get(ref); assert.equal(o.needs_attention, 1); assert.match(o.attention_reason, /Minimalist Wrist Watch/);
  const page = (await cl.get(link)).text; assert.match(page, /Nothing will be substituted or changed without your approval/); assert.match(page, /we will contact you before any change/);
  await adm.post(`/admin/orders/${ref}/fulfilment`, { _csrf: T, to: 'products_secured' }); assert.equal(get(ref).fulfillment_status, 'not_started', 'cannot progress while flagged');
  await adm.post(`/admin/orders/${ref}/items/${its[0].id}/remove`, { _csrf: T, approval: '' }); assert.equal(get(ref).total_minor, o.total_minor, 'no change without recorded approval');
  await adm.post(`/admin/orders/${ref}/items/${its[0].id}/remove`, { _csrf: T, approval: 'Customer approved by WhatsApp on 21 Oct' });
  o = get(ref); assert.equal(o.subtotal_minor, 250000); assert.equal(o.total_minor, 250000 + 250000); assert.equal(o.refund_due_minor, 2800000); assert.equal(o.needs_attention, 0);
  assert.match((await cl.get(link)).text, /Removed with your approval/);
  await adm.post(`/admin/orders/${ref}/refunded`, { _csrf: T, refund_ref: 'RF-12345' }); o = get(ref); assert.equal(o.refund_due_minor, 0); assert.equal(o.payment_status, 'paid');
  // cancelling now refunds only the money still held (no double refund)
  await adm.post(`/admin/orders/${ref}/cancel`, { _csrf: T, reason: 'Customer changed mind' }); assert.equal(get(ref).status, 'confirmed', 'paid order needs the customer-informed tick');
  await adm.post(`/admin/orders/${ref}/cancel`, { _csrf: T, reason: 'Customer changed their mind', informed: '1' });
  o = get(ref); assert.equal(o.status, 'cancelled'); assert.equal(o.payment_status, 'refund_pending'); assert.equal(o.refund_due_minor, 500000);
  await adm.post(`/admin/orders/${ref}/refunded`, { _csrf: T, refund_ref: 'RF-67890' }); assert.equal(get(ref).payment_status, 'refunded');
  assert.match((await cl.get(link)).text, /refund has been processed/i);
});

test('estimate revision needs a reason and is shown to the customer; owner messages appear on the order page', async () => {
  const { cl, ref, link } = await placeOrder([['DEV-BOT-750', 1]]);
  const it = ctx.db.q.get('SELECT id FROM order_items WHERE order_id=(SELECT id FROM orders WHERE reference=?)', ref);
  await adm.post(`/admin/orders/${ref}/items/${it.id}`, { _csrf: T, item_status: 'available' }); await adm.post(`/admin/orders/${ref}/request-payment`, { _csrf: T });
  const o = await paySuccessfully(ref); const d = require('../src/delivery-date'); const later = d.addDays(o.estimated_delivery_date, 3);
  await adm.post(`/admin/orders/${ref}/estimate`, { _csrf: T, date: later, reason: '' }); assert.equal(get(ref).estimated_delivery_date, o.estimated_delivery_date);
  await adm.post(`/admin/orders/${ref}/estimate`, { _csrf: T, date: later, reason: 'Market closed for a public holiday' });
  const n = get(ref); assert.equal(n.estimated_delivery_date, later); assert.equal(n.original_estimated_delivery_date, o.estimated_delivery_date);
  await adm.post(`/admin/orders/${ref}/message`, { _csrf: T, message: 'Your bottle is secured and will be packed tomorrow.' });
  const page = (await cl.get(link)).text; assert.match(page, /public holiday/); assert.match(page, /Updated from/); assert.match(page, /packed tomorrow/);
  const notes = ctx.db.q.all('SELECT * FROM notifications WHERE order_id=?', n.id); assert.ok(notes.length >= 2); assert.ok(notes.every((x) => x.status === 'skipped'), 'without an email service nothing is claimed as sent');
});

test('pay first (setting): customer pays at checkout; failed and abandoned payments never confirm the order', async () => {
  require('../src/settings').set('payment_timing', 'pay_first');
  try {
    const { ref } = await placeOrder([['DEV-STAND-SLV', 1]]);
    assert.equal(get(ref).status, 'awaiting_payment');
    const o = get(ref); const pref = `${ref}-P1-${crypto.randomBytes(6).toString('hex')}`;
    ctx.db.q.run("INSERT INTO payments(order_id,provider,reference,amount_minor,currency,status) VALUES(?,?,?,?,?,'pending')", o.id, 'paystack', pref, o.total_minor, 'NGN');
    orders().applyPaymentResult(pref, { status: 'abandoned' }); assert.equal(get(ref).payment_status, 'abandoned'); assert.equal(get(ref).status, 'awaiting_payment');
    orders().applyPaymentResult(pref, { status: 'failed', gateway_response: 'Declined' }); assert.equal(get(ref).payment_status, 'failed'); assert.equal(get(ref).confirmed_at, null);
    const done = await paySuccessfully(ref); assert.equal(done.status, 'confirmed');
  } finally { require('../src/settings').set('payment_timing', 'review_first'); }
});

test('product availability is owned by the store: temporarily unavailable cannot be ordered, discontinued is hidden', async () => {
  const p = ctx.db.q.get("SELECT id FROM products WHERE slug='demo-power-bank'").id;
  await adm.post(`/admin/products/${p}/quick`, { _csrf: T, availability: 'temporarily_unavailable', status: 'published' });
  const cl = client(ctx.base); await cl.get('/shop');
  await cl.post('/cart/add', { _csrf: cl.jar.nx_csrf, variant_id: vid('DEV-PWR-10K'), quantity: 1 });
  assert.equal(ctx.db.q.get('SELECT COUNT(*) n FROM cart_items WHERE variant_id=?', vid('DEV-PWR-10K')).n, 0);
  assert.match((await cl.get('/product/demo-power-bank')).text, /temporarily unavailable/);
  await adm.post(`/admin/products/${p}/quick`, { _csrf: T, availability: 'discontinued', status: 'published' });
  assert.doesNotMatch((await cl.get('/shop?q=power')).text, /Slim Power Bank/);
  await adm.post(`/admin/products/${p}/quick`, { _csrf: T, availability: 'available', status: 'published' });
  assert.match((await adm.get('/admin/products?q=power')).text, /Slim Power Bank/);
});

test('emails: sent through the email API when configured (tested against a local stand-in server), failures never block the order', async () => {
  const got = []; const mock = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { got.push({ auth: req.headers.authorization, body: JSON.parse(b) }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"test-email-1"}'); }); });
  await new Promise((r) => mock.listen(0, r));
  const cfg = require('../src/config'); const keep = { ...cfg.email };
  Object.assign(cfg.email, { apiKey: 're_test_key', from: 'Nexoraith <orders@example.test>', base: `http://localhost:${mock.address().port}` });
  try {
    const { ref } = await placeOrder([['DEV-CABLE-SET', 1]]);
    assert.ok(got.length >= 1); assert.equal(got[0].auth, 'Bearer re_test_key'); assert.deepEqual(got[0].body.to, ['bola@example.com']); assert.match(got[0].body.subject, new RegExp(ref)); assert.match(got[0].body.text, /Cable Organiser Set/);
    assert.equal(ctx.db.q.get("SELECT status FROM notifications WHERE recipient='bola@example.com' ORDER BY id DESC").status, 'sent');
    cfg.email.base = 'http://localhost:1'; // unreachable email service
    const second = await placeOrder([['DEV-CABLE-SET', 1]]); assert.equal(get(second.ref).status, 'pending_review', 'order still created');
    assert.equal(ctx.db.q.get('SELECT status FROM notifications ORDER BY id DESC').status, 'failed');
  } finally { Object.assign(cfg.email, keep); mock.close(); }
});

test('DummyJSON demo import: imports names/images/categories into our DB, sample prices, no reviews/stock claims; skips on re-run; API failure changes nothing', async () => {
  const products = [
    { id: 1, title: 'Essence Mascara Lash Princess', description: 'Popular mascara. Long lasting.', category: 'beauty', price: 9.99, brand: 'Essence', stock: 5, rating: 4.94, availabilityStatus: 'Low Stock', shippingInformation: 'Ships in 1 month', reviews: [{ rating: 5, comment: 'Great!', reviewerName: 'X' }], images: ['https://cdn.dummyjson.com/product-images/1/1.webp'], thumbnail: 'https://cdn.dummyjson.com/product-images/1/thumbnail.webp' },
    { id: 2, title: 'Mens Cotton Shirt', description: 'A shirt.', category: 'mens-shirts', price: 24.5, images: ['https://evil.example.com/x.png'], thumbnail: '' },
    { id: 3, title: '', price: 'abc', category: 'x' },
  ];
  let fail = false;
  const mock = http.createServer((req, res) => { if (fail) { res.writeHead(500); return res.end('down'); } const u = new URL(req.url, 'http://x'); const skip = +u.searchParams.get('skip') || 0; const limit = +u.searchParams.get('limit') || 30; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ products: products.slice(skip, skip + limit), total: products.length, skip, limit })); });
  await new Promise((r) => mock.listen(0, r)); const base = `http://localhost:${mock.address().port}/products`;
  const { importDummyJson } = require('../src/importers/dummyjson');
  try {
    const r = await importDummyJson({ limit: 200, rate: 1500, base, archiveSamples: false });
    assert.equal(r.fetched, 3); assert.equal(r.created, 2); assert.equal(r.failed.length, 1); assert.match(r.failed[0].errors.join(), /title|price/);
    const p = ctx.db.q.get("SELECT * FROM products WHERE slug LIKE 'dj-1-%'"); assert.equal(p.is_development, 0, 'imported products are the regular catalogue'); assert.equal(p.source, 'dummyjson'); assert.equal(p.availability, 'available');
    assert.doesNotMatch(p.description, /Great!|Ships in 1 month|Low Stock|4\.94|DEMONSTRATION/); assert.equal(p.source_price_text, '9.99 USD x 1500 = NGN 14985.00');
    const v = ctx.db.q.get("SELECT * FROM variants WHERE sku='DJ-1'"); assert.equal(v.price_minor, 1498500, '9.99 USD x NGN 1,500 exactly'); assert.equal(v.stock_qty, null, 'DummyJSON stock is not trusted');
    assert.equal(ctx.db.q.get("SELECT name FROM categories WHERE slug='mens-shirts'").name, "Men's Shirts");
    assert.equal(ctx.db.q.get("SELECT COUNT(*) n FROM product_images WHERE product_id=(SELECT id FROM products WHERE slug LIKE 'dj-2-%')").n, 0, 'images from non-allowed hosts are refused');
    const html = await fetch(`${ctx.base}/product/${p.slug}`); const text = await html.text();
    assert.match(text, /cdn\.dummyjson\.com\/product-images\/1\/1\.webp/); assert.match(html.headers.get('content-security-policy'), /img-src 'self' data: https:\/\/cdn\.dummyjson\.com/);
    ctx.db.q.run("UPDATE variants SET price_minor=777700 WHERE sku='DJ-1'");
    const again = await importDummyJson({ base, archiveSamples: false }); assert.equal(again.skipped, 2);
    products[0].title = 'Essence Mascara Renamed'; // DummyJSON renames a product: same id, so it is the same product (no duplicate, no SKU clash)
    const renamed = await importDummyJson({ base, archiveSamples: false, update: true }); assert.equal(renamed.failed.length, 1, 'only the invalid record'); assert.equal(renamed.updated, 2);
    assert.equal(ctx.db.q.get("SELECT COUNT(*) n FROM products WHERE source='dummyjson'").n, 2); assert.equal(ctx.db.q.get("SELECT name FROM products WHERE source_ref='dummyjson:1'").name, 'Essence Mascara Renamed');
    ctx.db.q.run("UPDATE variants SET price_minor=777700 WHERE sku='DJ-1'"); assert.equal(ctx.db.q.get("SELECT price_minor p FROM variants WHERE sku='DJ-1'").p, 777700, 'owner edits kept');
    fail = true; const before = ctx.db.q.get('SELECT COUNT(*) n FROM products').n;
    await assert.rejects(importDummyJson({ base, archiveSamples: false }), /Could not reach DummyJSON.*Nothing was changed/);
    assert.equal(ctx.db.q.get('SELECT COUNT(*) n FROM products').n, before);
    fail = false;
    // the store keeps working with no access to DummyJSON at all (catalogue is in our DB)
    mock.close(); assert.equal((await fetch(`${ctx.base}/shop?q=mascara`)).status, 200);
  } finally { try { mock.close(); } catch { /* closed */ } }
});

test('customers cannot change order state: no admin session = no access; order pages need the secret link', async () => {
  const { ref, link } = await placeOrder([['DEV-CABLE-SET', 1]]); const stranger = client(ctx.base); await stranger.get('/');
  for (const p of ['request-payment', 'fulfilment', 'cancel', 'refunded', 'estimate', 'message']) {
    const r = await stranger.post(`/admin/orders/${ref}/${p}`, { _csrf: stranger.jar.nx_csrf, to: 'delivered' }); assert.equal(r.status, 303); assert.equal(r.location, '/admin/login');
  }
  assert.equal(get(ref).status, 'pending_review');
  assert.equal((await stranger.get(`/order/${ref}`)).status, 404); assert.equal((await stranger.get(link)).status, 200);
});

test('database upgrade from v0.2 keeps orders, items and payments and maps old statuses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nxmig-')); const file = path.join(dir, 'old.db');
  const { DatabaseSync } = require('node:sqlite'); const { MIGRATIONS } = require('../src/db');
  const old = new DatabaseSync(file); old.exec(MIGRATIONS[0]); old.exec(MIGRATIONS[1]); old.exec('PRAGMA user_version=2');
  old.exec(`INSERT INTO orders(id,reference,status,payment_status,fulfillment_status,customer_name,customer_email,customer_phone,ship_address,ship_city,ship_state,ship_country,currency,subtotal_minor,delivery_fee_minor,total_minor)
    VALUES(1,'NX-OLD1','confirmed','paid','shipped','A','a@b.co','0801','x','y','z','NG','NGN',1000,500,1500),(2,'NX-OLD2','pending_payment','unpaid','not_started','B','b@b.co','0802','x','y','z','NG','NGN',1000,500,1500)`);
  old.exec("INSERT INTO order_items(order_id,product_name,variant_label,sku,unit_price_minor,quantity,line_total_minor) VALUES(1,'P','V','S',1000,1,1000),(2,'P','V','S',1000,1,1000)");
  old.exec("INSERT INTO payments(order_id,provider,reference,amount_minor,currency,status,paid_at) VALUES(1,'paystack','NX-OLD1-P1',1500,'NGN','success','2026-10-21 10:00:00')"); old.close();
  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', "const {q}=require('./src/db');console.log(JSON.stringify({v:q.get('PRAGMA user_version').user_version,o:q.all('SELECT reference,status,fulfillment_status,estimated_delivery_date FROM orders ORDER BY id'),i:q.get('SELECT COUNT(*) n FROM order_items').n,p:q.get('SELECT COUNT(*) n FROM payments').n}))"], { cwd: path.join(__dirname, '..'), env: { ...process.env, DATABASE_PATH: file } }).toString();
  const r = JSON.parse(out.trim().split('\n').pop());
  assert.equal(r.v, 6); assert.equal(r.i, 2); assert.equal(r.p, 1);
  assert.deepEqual(r.o.map((x) => [x.reference, x.status, x.fulfillment_status]), [['NX-OLD1', 'confirmed', 'out_for_delivery'], ['NX-OLD2', 'awaiting_payment', 'not_started']]);
  assert.equal(r.o[0].estimated_delivery_date, '2026-10-31');
});
