'use strict';
// v0.5: product images are durable (saved locally once), verified, cached, and never shown broken.
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
test.before(async () => {
  await new Promise((r) => cdn.listen(0, r)); CDN = `http://localhost:${cdn.address().port}`;
  ctx = await setup({ DEMO_CHECKOUT: 'false', PAYMENT_TIMING: 'review_first' });
  const sec = require('../src/security'); ctx.db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?)', 'owner@example.test', sec.hashPassword('owner-long-password'));
  adm = client(ctx.base); await adm.post('/admin/login', { _csrf: csrf((await adm.get('/admin/login')).text), email: 'owner@example.test', password: 'owner-long-password' });
  T = csrf((await adm.get('/admin')).text);
});
test.after(() => { ctx.server.close(); cdn.close(); });

test('bundled DummyJSON data: 194 products, every one gets a card thumbnail and gallery images, every category has a designed placeholder', async () => {
  const r = await require('../src/importers/dummyjson').importDummyJson({ source: 'snapshot' });
  assert.equal(r.source, 'snapshot'); assert.equal(r.created, 194); assert.equal(r.failed.length, 0);
  const active = ctx.db.q.all("SELECT p.*, c.slug cat FROM products p JOIN categories c ON c.id=p.category_id WHERE p.source='dummyjson' AND p.status='published'");
  assert.equal(active.length, 194);
  for (const p of active) {
    assert.match(p.card_image_url, /^https:\/\/cdn\.dummyjson\.com\/product-images\/.+\/thumbnail\.webp$/, p.name);
    assert.ok(ctx.db.q.get('SELECT COUNT(*) n FROM product_images WHERE product_id=?', p.id).n >= 1, p.name);
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'img', 'categories', `${p.cat}.svg`)), `placeholder for ${p.cat}`);
  }
  assert.equal(ctx.db.q.get("SELECT COUNT(*) n FROM product_images WHERE url LIKE '%/thumbnail.%' AND product_id IN (SELECT id FROM products WHERE source='dummyjson')").n, 0, 'thumbnail is the card image, not repeated in the gallery');
});

test('every image tag has fixed dimensions, a category fallback and sensible loading (first row eager, rest lazy)', async () => {
  const c = client(ctx.base);
  const shop = (await c.get('/shop')).text; const cards = imgs(shop.split('<div class="grid">')[1]).filter((t) => /data-fallback=/.test(t));
  assert.equal(cards.length, 24);
  for (const t of cards) { assert.match(t, /width="\d+" height="\d+"/); assert.match(t, /data-fallback="\/img\/categories\/[a-z-]+\.svg"/); assert.match(t, /decoding="async"/); }
  assert.equal(cards.filter((t) => /fetchpriority="high"/.test(t)).length, 4); assert.equal(cards.filter((t) => /loading="lazy"/.test(t)).length, 20);
  const slug = ctx.db.q.get("SELECT slug FROM products WHERE source_ref='dummyjson:1'").slug;
  const pdp = (await c.get(`/product/${slug}`)).text; const main = imgs(pdp).find((t) => /id="main-img"/.test(t));
  assert.match(main, /fetchpriority="high"/); assert.match(main, /cdn\.dummyjson\.com\/product-images\/beauty\/essence-mascara-lash-princess\/1\.webp/); assert.match(main, /data-fallback="\/img\/categories\/beauty\.svg"/);
});

test('image check marks unreachable images broken; pages then show the category placeholder instead of a broken image', async () => {
  const p = ctx.db.q.get("SELECT * FROM products WHERE source_ref='dummyjson:2'"); // a beauty product
  ctx.db.q.run("UPDATE products SET card_image_url=? WHERE id=?", `${CDN}/missing.jpg`, p.id);
  ctx.db.q.run("UPDATE product_images SET url=? WHERE product_id=?", `${CDN}/not-an-image.html`, p.id);
  const imagesMod = require('../src/images');
  // check only this product (others point at the real CDN): mark the rest ok so the test does not depend on the internet
  ctx.db.q.run("UPDATE product_images SET status='ok' WHERE product_id<>?", p.id); ctx.db.q.run("UPDATE products SET card_image_status='ok' WHERE id<>?", p.id);
  const ref = ctx.db.q.all("SELECT id FROM products WHERE id<>? AND status='published'", p.id).map((x) => x.id);
  ctx.db.q.run(`UPDATE products SET status='draft' WHERE id IN (${ref.join(',')})`);
  const r = await imagesMod.checkAll(); assert.equal(r.broken, r.checked, 'both images of this product are broken');
  ctx.db.q.run(`UPDATE products SET status='published' WHERE id IN (${ref.join(',')})`);
  const page = (await client(ctx.base).get(`/product/${p.slug}`)).text;
  assert.match(imgs(page).find((t) => /main-img/.test(t)), /src="\/img\/categories\/beauty\.svg"/);
  assert.doesNotMatch(page, /missing\.jpg|not-an-image/);
  assert.match((await client(ctx.base).get('/shop?q=' + encodeURIComponent(p.name.split(' ')[0]))).text, /\/img\/categories\/beauty\.svg/);
  const st = imagesMod.stats(); assert.ok(st.needImage.some((x) => x.id === p.id)); assert.match((await adm.get('/admin/products?images=missing')).text, new RegExp(p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('download saves permanent local copies once, serves them with long caching, updates order snapshots, survives a restart', async () => {
  const p = ctx.db.q.get("SELECT * FROM products WHERE source_ref='dummyjson:3'");
  ctx.db.q.run("UPDATE products SET card_image_url=?, card_image_status='unchecked' WHERE id=?", `${CDN}/p3/thumbnail.webp`, p.id);
  ctx.db.q.run("UPDATE product_images SET url=?, status='unchecked' WHERE product_id=?", `${CDN}/p3/1.png`, p.id);
  ctx.db.q.run("UPDATE product_images SET url=?, status='broken' WHERE product_id=(SELECT id FROM products WHERE source_ref='dummyjson:2')", `${CDN}/gone.jpg`);
  // an existing order that used the remote image keeps the same picture, now stored locally
  ctx.db.q.run("INSERT INTO orders(reference,status,customer_name,customer_email,customer_phone,ship_address,ship_city,ship_state,ship_country,currency,subtotal_minor,delivery_fee_minor,total_minor) VALUES('NX-IMG1','pending_review','A','a@b.co','0801','x','y','z','NG','NGN',100,0,100)");
  ctx.db.q.run("INSERT INTO order_items(order_id,product_name,variant_label,sku,unit_price_minor,quantity,line_total_minor,image_url) VALUES((SELECT id FROM orders WHERE reference='NX-IMG1'),'P','Standard','DJ-3',100,1,100,?)", `${CDN}/p3/thumbnail.webp`);
  const others = ctx.db.q.all("SELECT id FROM products WHERE id NOT IN (?, (SELECT id FROM products WHERE source_ref='dummyjson:2')) AND status='published'", p.id).map((x) => x.id);
  ctx.db.q.run(`UPDATE products SET status='draft' WHERE id IN (${others.join(',')})`); // keep the test offline: only our stand-in CDN
  const im = require('../src/images');
  hits = 0; const d = await im.downloadAll();
  assert.equal(d.saved, 2); assert.equal(d.failed, 2, 'the two missing images (404) fail and stay as they were');
  const card = ctx.db.q.get('SELECT card_image_url u, card_image_original o, card_image_status s FROM products WHERE id=?', p.id);
  assert.match(card.u, /^\/uploads\/catalog\/[0-9a-f]{24}\.webp$/); assert.match(card.o, /^https:\/\/cdn\.dummyjson\.com\//, 'the true original source is remembered'); assert.equal(card.s, 'ok');
  assert.match(ctx.db.q.get('SELECT url FROM product_images WHERE product_id=?', p.id).url, /^\/uploads\/catalog\/[0-9a-f]{24}\.png$/);
  assert.equal(ctx.db.q.get("SELECT image_url u FROM order_items WHERE sku='DJ-3'").u, card.u);
  assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR, 'catalog', path.basename(card.u))));
  const res = await fetch(ctx.base + card.u); assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'image/webp'); assert.match(res.headers.get('cache-control'), /max-age=31536000, immutable/);
  const again = await fetch(ctx.base + card.u, { headers: { 'if-modified-since': res.headers.get('last-modified') } }); assert.equal(again.status, 304);
  hits = 0; const d2 = await im.downloadAll(); assert.equal(d2.saved, 0); assert.equal(hits, 2, 'already-saved images are not downloaded again (only the failed ones are retried)');
  // refreshing the import must not undo the local copies
  ctx.db.q.run("UPDATE products SET card_image_original='https://cdn.dummyjson.com/product-images/beauty/powder-canister/thumbnail.webp' WHERE id=?", p.id);
  // restart: a brand-new server process on the same database and upload folder still serves the saved image
  const port = 3990 + Math.floor(Math.random() * 9);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', `require('./server').createServer().listen(${port})`], { cwd: path.join(__dirname, '..'), env: { ...process.env } });
  try {
    await new Promise((r) => setTimeout(r, 900));
    const html = await (await fetch(`http://localhost:${port}/product/${p.slug}`)).text(); assert.match(html, /\/uploads\/catalog\/[0-9a-f]{24}\.png/);
    assert.equal((await fetch(`http://localhost:${port}${card.u}`)).status, 200);
  } finally { child.kill(); }
  ctx.db.q.run(`UPDATE products SET status='published' WHERE id IN (${others.join(',')})`);
});

test('sitemap lists every active product and category; text responses use a minimal security policy', async () => {
  const r = await fetch(ctx.base + '/sitemap.xml'); const x = await r.text();
  assert.equal((x.match(/\/product\//g) || []).length, ctx.db.q.get("SELECT COUNT(*) n FROM products WHERE status='published' AND availability<>'discontinued' AND is_development=0").n);
  assert.match(x, /shop\?category=smartphones/); assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
});
test('admin image panel reports the counts and the check button works', async () => {
  const page = (await adm.get('/admin/settings')).text; assert.match(page, /Product images/); assert.match(page, /active products have a verified working image/);
  const r = await adm.post('/admin/settings/images', { _csrf: T, action: 'check' }); assert.equal(r.status, 303);
  assert.equal((await fetch(ctx.base + '/img/categories/default.svg')).status, 200);
});
