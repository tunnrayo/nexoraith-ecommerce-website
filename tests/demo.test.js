'use strict';
// v0.2 features: demo checkout, preliminary delivery zones, order lookup, admin product/image/category/zone management.
const test = require('node:test'); const assert = require('node:assert/strict');
const { setup, client } = require('./helpers');
let ctx;
test.before(async () => { ctx = await setup(); require('../scripts/seed'); }); // seed adds Lagos / Other Nigerian locations
test.after(() => ctx.server.close());
const csrf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
const vid = (sku) => ctx.db.q.get('SELECT id FROM variants WHERE sku=?', sku).id;
const zone = (name) => ctx.db.q.get('SELECT * FROM delivery_zones WHERE name=?', name);
async function order(cl, extra = {}, sku = 'DEV-WAL-BRN') {
  await cl.get('/shop'); await cl.post('/cart/add', { _csrf: cl.jar.nx_csrf, variant_id: vid(sku), quantity: 1 });
  const page = await cl.get('/checkout'); const key = page.text.match(/name="checkout_key" value="([^"]+)"/)[1];
  return { page, r: await cl.post('/checkout', { _csrf: csrf(page.text), checkout_key: key, name: 'Ada Obi', email: 'ada@example.com', phone: '08031234567', address: '12 Test Street', city: 'Ikeja', state: 'Lagos', zone_id: zone('Lagos').id, ...extra }) };
}

test('preliminary delivery zones: Lagos 2,500 and other Nigeria 4,500, not confirmed, shown at checkout', async () => {
  assert.equal(zone('Lagos').fee_minor, 250000); assert.equal(zone('Other Nigerian locations').fee_minor, 450000);
  assert.equal(zone('Lagos').confirmed, 0); assert.equal(zone('Other Nigerian locations').confirmed, 0);
  const { page } = await order(client(ctx.base), { email: 'bad' });
  assert.match(page.text, /Lagos/); assert.match(page.text, /4,500\.00/); assert.match(page.text, /Preliminary charge/);
  assert.match(page.text, /Demonstration checkout/);
});
test('demo checkout: totals from server, completes without payment, never marked paid, stock untouched', async () => {
  const cl = client(ctx.base); const stock = ctx.db.q.get("SELECT stock_qty s FROM variants WHERE sku='DEV-WAL-BRN'").s;
  const { r } = await order(cl, { payment_method: 'demo', zone_id: zone('Other Nigerian locations').id });
  assert.equal(r.status, 303); const ref = r.location.split('/')[2].split('?')[0];
  let o = ctx.db.q.get('SELECT * FROM orders WHERE reference=?', ref);
  assert.equal(o.is_demo, 1); assert.equal(o.payment_method, 'demo'); assert.equal(o.total_minor, 950050 + 450000);
  const page = await cl.get(r.location); assert.match(page.text, /Complete demonstration payment/);
  const pay = await cl.post(`/order/${ref}/pay`, { _csrf: csrf(page.text), t: r.location.split('t=')[1] });
  assert.match((await cl.get(pay.location)).text, /demonstration order/i);
  const done = await cl.post(`/order/${ref}/demo-confirm`, { _csrf: csrf(page.text), t: r.location.split('t=')[1] });
  const conf = await cl.get(done.location); assert.match(conf.text, /Demonstration order confirmed/); assert.match(conf.text, /No payment was taken/); assert.match(conf.text, /Estimated delivery/);
  o = ctx.db.q.get('SELECT * FROM orders WHERE reference=?', ref);
  assert.ok(o.demo_confirmed_at); assert.equal(o.status, 'confirmed'); assert.ok(o.estimated_delivery_date); assert.equal(o.payment_status, 'unpaid'); assert.equal(o.fulfillment_status, 'not_started');
  assert.equal(ctx.db.q.get("SELECT stock_qty s FROM variants WHERE sku='DEV-WAL-BRN'").s, stock);
  assert.equal((await client(ctx.base).post(`/order/${ref}/demo-confirm`, { _csrf: 'x', t: 'wrong' })).status, 403);
});
test('demo method is refused when demo mode is off', async () => {
  const config = require('../src/config'); config.demoMode = false;
  try { const { r } = await order(client(ctx.base), { payment_method: 'demo' }); assert.equal(r.status, 422); assert.match(r.text, /payment method/); }
  finally { config.demoMode = true; }
});
test('track order: right reference + email opens the order; wrong email does not', async () => {
  const cl = client(ctx.base); const { r } = await order(cl, {}, 'DEV-CABLE-SET'); const ref = r.location.split('/')[2].split('?')[0];
  const t = client(ctx.base); const f = csrf((await t.get('/track')).text);
  const bad = await t.post('/track', { _csrf: f, reference: ref, email: 'someone@else.com' }); assert.equal(bad.status, 404); assert.match(bad.text, /could not find/);
  const ok = await t.post('/track', { _csrf: f, reference: ref.toLowerCase(), email: ' ADA@example.com ' }); assert.equal(ok.status, 303); assert.match(ok.location, new RegExp(`^/order/${ref}\\?t=`));
  assert.equal((await t.get(ok.location)).status, 200);
});
test('admin: create product, add variant, upload image (PNG only), categories and delivery zones', async () => {
  const sec = require('../src/security'); ctx.db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?)', 'owner@example.test', sec.hashPassword('another-long-password'));
  const a = client(ctx.base); await a.post('/admin/login', { _csrf: csrf((await a.get('/admin/login')).text), email: 'owner@example.test', password: 'another-long-password' });
  const t = csrf((await a.get('/admin/products/new')).text);
  assert.equal((await client(ctx.base).get('/admin/products/new')).status, 303, 'logged-out users are sent to login');
  const cr = await a.post('/admin/products/new', { _csrf: t, name: 'Real Test Lamp', summary: 'A lamp', description: 'Desc', status: 'published', sku: 'NX-LAMP-1', label: 'Warm white', price: '15000', availability: 'available', stock: '' });
  assert.equal(cr.status, 303); const pid = Number(cr.location.split('/').pop()); const p = ctx.db.q.get('SELECT * FROM products WHERE id=?', pid);
  assert.equal(p.slug, 'real-test-lamp'); assert.equal(p.is_development, 0);
  assert.equal((await a.post('/admin/products/new', { _csrf: t, name: 'Dup', status: 'draft', sku: 'NX-LAMP-1', label: 'x', price: '1', availability: 'available' })).location, '/admin/products/new', 'duplicate SKU refused');
  await a.post(`/admin/products/${pid}/variants`, { _csrf: t, sku: 'NX-LAMP-2', label: 'Cool white', price: '15500.50', availability: 'unverified' });
  assert.equal(ctx.db.q.get("SELECT price_minor p FROM variants WHERE sku='NX-LAMP-2'").p, 1550050);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const up = async (buf, name) => { const fd = new FormData(); fd.set('_csrf', t); fd.set('alt', 'Lamp photo'); fd.set('image', new Blob([buf]), name);
    return fetch(`${ctx.base}/admin/products/${pid}/images`, { method: 'POST', body: fd, redirect: 'manual', headers: { cookie: Object.entries(a.jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') } }); };
  assert.equal((await up(png, 'lamp.png')).status, 303);
  const im = ctx.db.q.get('SELECT * FROM product_images WHERE product_id=?', pid); assert.match(im.url, /^\/uploads\/p\d+-.+\.png$/);
  const served = await fetch(ctx.base + im.url); assert.equal(served.status, 200); assert.equal(served.headers.get('content-type'), 'image/png');
  await up(Buffer.from('<script>alert(1)</script>'), 'evil.png'); assert.equal(ctx.db.q.get('SELECT COUNT(*) n FROM product_images WHERE product_id=?', pid).n, 1, 'non-images refused');
  assert.match((await client(ctx.base).get('/product/real-test-lamp')).text, /Lamp photo/);
  await a.post('/admin/categories/new', { _csrf: t, name: 'Lighting', description: 'Lamps and lights', sort_order: '5' });
  assert.equal(ctx.db.q.get("SELECT name FROM categories WHERE slug='lighting'").name, 'Lighting');
  await a.post('/admin/delivery/new', { _csrf: t, name: 'Abuja', country_code: 'NG', fee: '5000' });
  assert.equal(zone('Abuja').fee_minor, 500000); assert.equal(zone('Abuja').confirmed, 0);
  const dash = await a.get('/admin'); assert.match(dash.text, /Demonstration orders/);
  assert.match((await a.get('/admin/orders?kind=demo')).text, /DEMO/);
});
