'use strict';
// v0.4: the imported DummyJSON catalogue is the store's regular catalogue, shown with no demo presentation (production-style settings).
const test = require('node:test'); const assert = require('node:assert/strict');
const http = require('http'); const crypto = require('crypto');
const { setup, client } = require('./helpers');
const CATS = ['beauty', 'fragrances', 'mens-shirts'];
const products = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, title: i === 0 ? 'Essence Mascara Lash Princess' : `Catalogue Item ${i + 1}`, description: `Item ${i + 1} description. Second sentence.`, category: CATS[i % 3], price: i === 0 ? 9.99 : 10 + i, brand: 'Brand', stock: 99, rating: 4.9, availabilityStatus: 'In Stock', reviews: [{ comment: 'Lovely', rating: 5 }], images: [`https://cdn.dummyjson.com/product-images/${i + 1}/1.webp`], thumbnail: `https://cdn.dummyjson.com/product-images/${i + 1}/t.webp` }));
const mock = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); const skip = +u.searchParams.get('skip') || 0; const limit = +u.searchParams.get('limit') || 30; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ products: products.slice(skip, skip + limit), total: products.length, skip, limit })); });
let ctx; let adm; let T;
const csrf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
const visibleText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
test.before(async () => {
  await new Promise((r) => mock.listen(0, r)); process.env.DUMMYJSON_URL = `http://localhost:${mock.address().port}/products`;
  ctx = await setup({ NODE_ENV: 'production', ALLOW_DEVELOPMENT_PRODUCTS: 'false', ALLOW_UNCONFIRMED_DELIVERY: 'false', DEMO_CHECKOUT: 'false', PAYMENT_TIMING: 'review_first' });
  // an older order + payment that must survive the catalogue changes
  ctx.db.q.run("INSERT INTO orders(reference,status,payment_status,fulfillment_status,customer_name,customer_email,customer_phone,ship_address,ship_city,ship_state,ship_country,currency,subtotal_minor,delivery_fee_minor,total_minor) VALUES('NX-KEEP1','confirmed','paid','sourcing','A','a@b.co','0801','x','y','z','NG','NGN',1000,500,1500)");
  ctx.db.q.run("INSERT INTO payments(order_id,provider,reference,amount_minor,currency,status) VALUES((SELECT id FROM orders WHERE reference='NX-KEEP1'),'paystack','NX-KEEP1-P1',1500,'NGN','success')");
  const sec = require('../src/security'); ctx.db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?)', 'owner@example.test', sec.hashPassword('owner-long-password'));
  adm = client(ctx.base); await adm.post('/admin/login', { _csrf: csrf((await adm.get('/admin/login')).text), email: 'owner@example.test', password: 'owner-long-password' });
  T = csrf((await adm.get('/admin')).text);
});
test.after(() => { ctx.server.close(); mock.close(); });

test('admin import makes the DummyJSON products the storefront catalogue, priced in Naira at NGN 1,500 per USD', async () => {
  const r = await adm.post('/admin/settings/import-dummyjson', { _csrf: T, limit: '200', rate: '1500' });
  assert.equal(r.status, 303); assert.equal(ctx.db.q.get("SELECT COUNT(*) n FROM products WHERE source='dummyjson' AND status='published' AND is_development=0 AND availability='available'").n, 30);
  assert.equal(ctx.db.q.get("SELECT price_minor p FROM variants WHERE sku='DJ-1'").p, 1498500);
  assert.equal(ctx.db.q.get("SELECT price_minor p FROM variants WHERE sku='DJ-2'").p, 1650000, '11.00 USD x 1,500');
  assert.equal(ctx.db.q.get("SELECT COUNT(*) n FROM products WHERE slug LIKE 'demo-%' AND status='published'").n, 0, 'built-in sample illustrations are hidden');
  const c = client(ctx.base);
  const home = await c.get('/'); assert.match(home.text, /Catalogue Item/); assert.match(home.text, /cdn\.dummyjson\.com\/product-images/);
  const shop = await c.get('/shop'); assert.match(shop.text, /30 products found/); assert.match(shop.text, /Page 1 of 2/);
  const found = (await c.get('/shop?q=mascara')).text; assert.match(found, /1 product found/); assert.match(found, /₦14,985\.00/);
  assert.match((await c.get('/shop?category=fragrances')).text, /10 products found/);
  const slug = ctx.db.q.get("SELECT slug FROM products WHERE source_ref='dummyjson:1'").slug;
  const pdp = await c.get(`/product/${slug}`); assert.equal(pdp.status, 200); assert.match(pdp.text, /Item 1 description/); assert.match(pdp.text, /₦14,985\.00/);
  assert.match(pdp.text, /application\/ld\+json/); assert.doesNotMatch(pdp.text, /InStock|In Stock|Lovely|4\.9/, 'no stock, rating or review claims');
});

test('no demo presentation anywhere a customer looks', async () => {
  const c = client(ctx.base); const slug = ctx.db.q.get("SELECT slug FROM products WHERE source_ref='dummyjson:1'").slug;
  await c.get('/shop'); await c.post('/cart/add', { _csrf: c.jar.nx_csrf, variant_id: ctx.db.q.get("SELECT id FROM variants WHERE sku='DJ-1'").id, quantity: 1 });
  for (const p of ['/', '/shop', `/product/${slug}`, '/cart', '/checkout', '/about', '/faq', '/shipping', '/contact', '/track', '/shop?category=beauty']) {
    const r = await c.get(p); assert.equal(r.status, 200, p);
    assert.doesNotMatch(visibleText(r.text), /\b(demo|demonstration|sample|test shop)\b/i, `demo wording on ${p}`);
  }
});

test('customer orders an imported product exactly; owner reviews, requests payment; verified payment confirms with the 10-day estimate', async () => {
  const c = client(ctx.base); await c.get('/shop'); const vid = ctx.db.q.get("SELECT id FROM variants WHERE sku='DJ-4'").id;
  await c.post('/cart/add', { _csrf: c.jar.nx_csrf, variant_id: vid, quantity: 2 });
  const page = await c.get('/checkout'); assert.doesNotMatch(page.text, /payment_method" value="demo"/);
  const key = page.text.match(/name="checkout_key" value="([^"]+)"/)[1];
  const r = await c.post('/checkout', { _csrf: csrf(page.text), checkout_key: key, name: 'Ngozi Eze', email: 'ngozi@example.com', phone: '08051234567', address: '1 Allen Avenue', city: 'Ikeja', state: 'Lagos', zone_id: ctx.db.q.get("SELECT id FROM delivery_zones WHERE name='Test zone'").id });
  assert.equal(r.status, 303); const ref = r.location.split('/')[2].split('?')[0];
  let o = ctx.db.q.get('SELECT * FROM orders WHERE reference=?', ref);
  assert.equal(o.is_demo, 0, 'catalogue orders are real orders'); assert.equal(o.status, 'pending_review'); assert.equal(o.subtotal_minor, 2 * 1950000);
  const it = ctx.db.q.get('SELECT * FROM order_items WHERE order_id=?', o.id); assert.equal(it.product_name, 'Catalogue Item 4'); assert.equal(it.quantity, 2); assert.equal(it.unit_price_minor, 1950000); assert.match(it.image_url, /^https:\/\/cdn\.dummyjson\.com\//);
  await adm.post(`/admin/orders/${ref}/items/${it.id}`, { _csrf: T, item_status: 'available' }); await adm.post(`/admin/orders/${ref}/request-payment`, { _csrf: T });
  assert.equal(ctx.db.q.get('SELECT status FROM orders WHERE id=?', o.id).status, 'awaiting_payment');
  const pref = `${ref}-P1-${crypto.randomBytes(6).toString('hex')}`; o = ctx.db.q.get('SELECT * FROM orders WHERE id=?', o.id);
  ctx.db.q.run("INSERT INTO payments(order_id,provider,reference,amount_minor,currency,status) VALUES(?,?,?,?,?,'pending')", o.id, 'paystack', pref, o.total_minor, 'NGN');
  const raw = JSON.stringify({ event: 'charge.success', data: { id: 4242, reference: pref, amount: o.total_minor, currency: 'NGN', status: 'success' } });
  await fetch(ctx.base + '/webhooks/paystack', { method: 'POST', headers: { 'x-paystack-signature': crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(raw).digest('hex') }, body: raw });
  o = ctx.db.q.get('SELECT * FROM orders WHERE id=?', o.id); assert.equal(o.status, 'confirmed'); assert.equal(o.payment_status, 'paid');
  assert.equal(o.estimated_delivery_date, require('../src/delivery-date').estimate(o.confirmed_at, 10));
  const cust = await c.get(r.location); assert.match(cust.text, /Thank you, Ngozi/); assert.match(cust.text, /Catalogue Item 4/); assert.match(cust.text, /Estimated delivery/);
  assert.match((await adm.get(`/admin/orders/${ref}`)).text, /Ngozi Eze/);
});

test('re-import never overwrites owner edits or availability, keeps orders and payments; prices stay editable', async () => {
  const pid = ctx.db.q.get("SELECT id FROM products WHERE source_ref='dummyjson:2'").id; const vid = ctx.db.q.get("SELECT id FROM variants WHERE sku='DJ-2'").id;
  const form = await adm.get(`/admin/products/${pid}`); assert.match(form.text, /Imported from DummyJSON/); assert.match(form.text, /11\.00 USD x 1500/);
  await adm.post(`/admin/products/${pid}`, { _csrf: T, name: 'Edited Shirt', summary: 'Mine', description: 'My description', status: 'published', availability: 'available', [`price_${vid}`]: '17500', [`avail_${vid}`]: 'available', [`label_${vid}`]: 'Standard', [`stock_${vid}`]: '' });
  assert.ok(ctx.db.q.get('SELECT admin_edited_at a FROM products WHERE id=?', pid).a);
  const p3 = ctx.db.q.get("SELECT id FROM products WHERE source_ref='dummyjson:3'").id;
  await adm.post(`/admin/products/${p3}/quick`, { _csrf: T, availability: 'temporarily_unavailable', status: 'published' });
  ctx.db.q.run("UPDATE products SET name='Stale name' WHERE source_ref='dummyjson:5'");
  const before = { o: ctx.db.q.get('SELECT COUNT(*) n FROM orders').n, p: ctx.db.q.get('SELECT COUNT(*) n FROM payments').n };
  const r = await require('../src/importers/dummyjson').importDummyJson({ update: true });
  assert.equal(r.keptEdits, 1); assert.equal(r.failed.length, 0);
  const edited = ctx.db.q.get('SELECT * FROM products WHERE id=?', pid); assert.equal(edited.name, 'Edited Shirt'); assert.equal(ctx.db.q.get('SELECT price_minor p FROM variants WHERE id=?', vid).p, 1750000);
  assert.equal(ctx.db.q.get('SELECT availability a FROM products WHERE id=?', p3).a, 'temporarily_unavailable', 'import never changes availability');
  assert.equal(ctx.db.q.get("SELECT name FROM products WHERE source_ref='dummyjson:5'").name, 'Catalogue Item 5', 'unedited imports are refreshed on request');
  assert.deepEqual({ o: ctx.db.q.get('SELECT COUNT(*) n FROM orders').n, p: ctx.db.q.get('SELECT COUNT(*) n FROM payments').n }, before);
  assert.equal(ctx.db.q.get("SELECT payment_status s FROM orders WHERE reference='NX-KEEP1'").s, 'paid');
  assert.match((await client(ctx.base).get('/shop?q=Edited')).text, /₦17,500\.00/);
});
