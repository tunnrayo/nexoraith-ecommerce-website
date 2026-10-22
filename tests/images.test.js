'use strict';
// Shared product-image handling (kept for the owner's own products): fixed dimensions, fallback placeholder, broken-image
// detection, optional local copies of linked photos, caching. Uses the test-only fixture catalogue and a local stand-in image server.
const test = require('node:test'); const assert = require('node:assert/strict');
const http = require('http'); const fs = require('fs'); const path = require('path');
const { spawn } = require('child_process');
const { setup, client } = require('./helpers');
const WEBP = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.webp')); const PNG = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.png'));
let hits = 0;
const cdn = http.createServer((req, res) => {
  hits++;
  if (req.url.endsWith('.webp')) { res.writeHead(200, { 'content-type': 'image/webp' }); return res.end(WEBP); }
  if (req.url.endsWith('.png')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
  if (req.url.endsWith('.html')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>not an image</html>'); }
  res.writeHead(404); res.end();
});
let ctx; let CDN; let adm; let T;
const csrf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
const imgs = (html) => [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
const pid = (slug) => ctx.db.q.get('SELECT id FROM products WHERE slug=?', slug).id;
test.before(async () => {
  await new Promise((r) => cdn.listen(0, r)); CDN = `http://localhost:${cdn.address().port}`;
  ctx = await setup({ DEMO_CHECKOUT: 'false', PAYMENT_TIMING: 'review_first' });
  const sec = require('../src/security'); ctx.db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?)', 'owner@example.test', sec.hashPassword('owner-long-password'));
  adm = client(ctx.base); await adm.post('/admin/login', { _csrf: csrf((await adm.get('/admin/login')).text), email: 'owner@example.test', password: 'owner-long-password' });
  T = csrf((await adm.get('/admin')).text);
});
test.after(() => { ctx.server.close(); cdn.close(); });

test('no demo product or demo category pictures are shipped; one neutral placeholder', () => {
  const pub = path.join(__dirname, '..', 'public', 'img');
  assert.deepEqual(fs.readdirSync(path.join(pub, 'categories')), ['default.svg']);
  assert.ok(!fs.existsSync(path.join(pub, 'products')), 'demo product illustrations removed');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'data', 'catalogue', 'dummyjson-products.json')), 'bundled DummyJSON data removed');
  assert.equal(require('../src/images').placeholderFor('anything'), '/img/categories/default.svg');
});

test('every product image tag has fixed dimensions, a fallback and sensible loading (first row eager, rest lazy)', async () => {
  const c = client(ctx.base);
  const shop = (await c.get('/shop')).text; const cards = imgs(shop.split('<div class="grid">')[1]).filter((t) => /data-fallback=/.test(t));
  assert.equal(cards.length, 12);
  for (const t of cards) { assert.match(t, /width="\d+" height="\d+"/); assert.match(t, /data-fallback="\/img\/categories\/default\.svg"/); assert.match(t, /decoding="async"/); }
  assert.equal(cards.filter((t) => /fetchpriority="high"/.test(t)).length, 4); assert.equal(cards.filter((t) => /loading="lazy"/.test(t)).length, 8);
  const main = imgs((await c.get('/product/demo-ceramic-mug')).text).find((t) => /id="main-img"/.test(t));
  assert.match(main, /fetchpriority="high"/); assert.match(main, /data-fallback="\/img\/categories\/default\.svg"/);
});

test('image check marks unreachable images broken; pages then show the placeholder instead of a broken image', async () => {
  const id = pid('demo-linen-cushion');
  ctx.db.q.run('UPDATE products SET card_image_url=? WHERE id=?', `${CDN}/missing.jpg`, id);
  ctx.db.q.run('UPDATE product_images SET url=? WHERE product_id=?', `${CDN}/not-an-image.html`, id);
  const r = await require('../src/images').checkAll(); assert.equal(r.broken, 2); assert.equal(r.ok, r.checked - 2);
  const page = (await client(ctx.base).get('/product/demo-linen-cushion')).text;
  assert.match(imgs(page).find((t) => /main-img/.test(t)), /src="\/img\/categories\/default\.svg"/);
  assert.doesNotMatch(page, /missing\.jpg|not-an-image/);
  const st = require('../src/images').stats(); assert.ok(st.needImage.some((x) => x.id === id)); assert.match((await adm.get('/admin/products?images=missing')).text, /Linen/);
});

test('linked photos can be saved as permanent local copies once, served with long caching, order snapshots updated, survives a restart', async () => {
  const id = pid('demo-soy-candle');
  ctx.db.q.run("UPDATE products SET card_image_url=?, card_image_status='unchecked' WHERE id=?", `${CDN}/p3/thumbnail.webp`, id);
  ctx.db.q.run("UPDATE product_images SET url=?, status='unchecked' WHERE product_id=?", `${CDN}/p3/1.png`, id);
  ctx.db.q.run("INSERT INTO orders(reference,status,customer_name,customer_email,customer_phone,ship_address,ship_city,ship_state,ship_country,currency,subtotal_minor,delivery_fee_minor,total_minor) VALUES('NX-IMG1','pending_review','A','a@b.co','0801','x','y','z','NG','NGN',100,0,100)");
  ctx.db.q.run("INSERT INTO order_items(order_id,product_name,variant_label,sku,unit_price_minor,quantity,line_total_minor,image_url) VALUES((SELECT id FROM orders WHERE reference='NX-IMG1'),'P','Standard','X-1',100,1,100,?)", `${CDN}/p3/thumbnail.webp`);
  const im = require('../src/images');
  hits = 0; const d = await im.downloadAll();
  assert.equal(d.saved, 2); assert.equal(d.failed, 2, 'the two missing images from the previous test fail and stay as they were');
  const card = ctx.db.q.get('SELECT card_image_url u, card_image_original o, card_image_status s FROM products WHERE id=?', id);
  assert.match(card.u, /^\/uploads\/catalog\/[0-9a-f]{24}\.webp$/); assert.equal(card.o, `${CDN}/p3/thumbnail.webp`); assert.equal(card.s, 'ok');
  assert.equal(ctx.db.q.get("SELECT image_url u FROM order_items WHERE sku='X-1'").u, card.u);
  const res = await fetch(ctx.base + card.u); assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'image/webp'); assert.match(res.headers.get('cache-control'), /max-age=31536000, immutable/);
  assert.equal((await fetch(ctx.base + card.u, { headers: { 'if-modified-since': res.headers.get('last-modified') } })).status, 304);
  hits = 0; const d2 = await im.downloadAll(); assert.equal(d2.saved, 0); assert.equal(hits, 2, 'saved images are not downloaded again');
  const port = 3990 + Math.floor(Math.random() * 9);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', `require('./server').createServer().listen(${port})`], { cwd: path.join(__dirname, '..'), env: { ...process.env } });
  try {
    await new Promise((r) => setTimeout(r, 900));
    assert.match(await (await fetch(`http://localhost:${port}/product/demo-soy-candle`)).text(), /\/uploads\/catalog\/[0-9a-f]{24}\.png/);
    assert.equal((await fetch(`http://localhost:${port}${card.u}`)).status, 200);
  } finally { child.kill(); }
});

test('sitemap lists every product for sale and category; text responses use a minimal security policy; no outside image hosts by default', async () => {
  const r = await fetch(ctx.base + '/sitemap.xml'); const x = await r.text();
  assert.equal((x.match(/\/product\//g) || []).length, ctx.db.q.get("SELECT COUNT(*) n FROM products WHERE status='published' AND availability<>'discontinued' AND is_development=0").n);
  assert.match(x, /shop\?category=home-living/); assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match((await fetch(ctx.base + '/')).headers.get('content-security-policy'), /img-src 'self' data:;/);
});
test('admin image panel reports the counts and the check button works', async () => {
  const page = (await adm.get('/admin/settings')).text; assert.match(page, /Product images/); assert.match(page, /active products have a verified working image/);
  assert.doesNotMatch(page, /Import catalogue|import-dummyjson|Product photos/);
  assert.equal((await adm.post('/admin/settings/images', { _csrf: T, action: 'check' })).status, 303);
  assert.equal((await fetch(ctx.base + '/img/categories/default.svg')).status, 200);
});
