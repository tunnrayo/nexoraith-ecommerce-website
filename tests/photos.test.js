'use strict';
// v0.6: product photo installer + manifest + owner visual review. Runs against a TEMPORARY COPY of the project so the real
// public/images/products folder and data/catalogue/image-manifest.json are never touched by tests.
// (This checks the mechanism with small generated files; it is not evidence that real product photos were obtained.)
const test = require('node:test'); const assert = require('node:assert/strict');
const http = require('http'); const fs = require('fs'); const os = require('os'); const path = require('path');
const { execFile, spawn } = require('child_process'); const execP = require('util').promisify(execFile);
const node = async (args, opts) => (await execP(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], opts)).stdout;
const { setup, client } = require('./helpers');
const ROOT = path.join(__dirname, '..');
const make = (type, w, h) => { // minimal valid image headers with real dimensions (decoder only reads the header)
  if (type === 'png') { const b = Buffer.alloc(400); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(b); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; }
  const b = Buffer.alloc(400); b.write('RIFF', 0); b.write('WEBP', 8); b.write('VP8X', 12); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b;
};
const files = { '/p1/thumbnail.webp': make('webp', 300, 300), '/p1/1.png': make('png', 800, 800), '/p2/thumbnail.webp': make('webp', 64, 64), '/p2/1.png': make('png', 800, 800) };
const cdn = http.createServer((req, res) => {
  if (files[req.url]) { res.writeHead(200); return res.end(files[req.url]); }
  if (req.url.startsWith('/p3/')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><html>Access denied</html>'); }
  res.writeHead(404); res.end();
});
let ctx; let COPY; let CDN;
const run = (args, env = {}) => node(['scripts/install-product-photos.js', ...args], { cwd: COPY, env: { ...process.env, ...env } });
test.before(async () => {
  await new Promise((r) => cdn.listen(0, r)); CDN = `http://localhost:${cdn.address().port}`;
  COPY = fs.mkdtempSync(path.join(os.tmpdir(), 'nxcopy-'));
  for (const d of ['src', 'scripts', 'public', 'data', 'server.js', 'package.json']) fs.cpSync(path.join(ROOT, d), path.join(COPY, d), { recursive: true, filter: (f) => !/\.db(-|$)|[/\\]uploads[/\\]|image-manifest\.json$|[/\\]images[/\\]products/.test(f) });
  ctx = await setup({ DEMO_CHECKOUT: 'false' });
  const r = await require('../src/importers/dummyjson').importDummyJson({ source: 'snapshot' }); assert.equal(r.created, 194);
  const q = ctx.db.q; const pid = (n) => q.get('SELECT id FROM products WHERE source_ref=?', `dummyjson:${n}`).id;
  q.run("UPDATE products SET status='draft' WHERE source_ref NOT IN ('dummyjson:1','dummyjson:2','dummyjson:3','dummyjson:4')");
  for (const n of [1, 2, 3]) {
    q.run('UPDATE products SET card_image_url=?, card_image_original=? WHERE id=?', `${CDN}/p${n}/thumbnail.webp`, `${CDN}/p${n}/thumbnail.webp`, pid(n));
    q.run('UPDATE product_images SET url=?, original_url=? WHERE product_id=?', `${CDN}/p${n}/1.png`, `${CDN}/p${n}/1.png`, pid(n));
  }
  q.run("INSERT INTO product_images(product_id,url,alt,sort_order) VALUES(?,'/uploads/p99-mine.png','my own photo',9)", pid(4)); // an owner upload
  q.run("INSERT INTO orders(reference,status,customer_name,customer_email,customer_phone,ship_address,ship_city,ship_state,ship_country,currency,subtotal_minor,delivery_fee_minor,total_minor) VALUES('NX-PH1','pending_review','A','a@b.co','0801','x','y','z','NG','NGN',100,0,100)");
  q.run("INSERT INTO order_items(order_id,product_name,variant_label,sku,unit_price_minor,quantity,line_total_minor,image_url) VALUES((SELECT id FROM orders WHERE reference='NX-PH1'),'P','Standard','DJ-1',100,1,100,?)", `${CDN}/p1/thumbnail.webp`);
});
test.after(() => { ctx.server.close(); cdn.close(); fs.rmSync(COPY, { recursive: true, force: true }); });

test('installer: downloads, decodes and validates each photo, installs it under public/images/products, re-points the product, writes a manifest', async () => {
  await run([]);
  const m = JSON.parse(fs.readFileSync(path.join(COPY, 'data', 'catalogue', 'image-manifest.json'), 'utf8'));
  assert.equal(m.summary.active_products_checked, 4); assert.equal(m.summary.usage_permission_confirmed, 0, 'never claims permission');
  const e = (n) => m.products.find((x) => x.source_ref === `dummyjson:${n}`);
  const p1 = e(1); assert.equal(p1.verification.photos_installed, 2); assert.equal(p1.usage_permission.status, 'not confirmed'); assert.match(p1.match_confidence, /visual check by owner still required/);
  const card = p1.photos.find((x) => x.role === 'card'); assert.equal(card.local_path, '/images/products/dj-1/card.webp'); assert.equal(card.width, 300); assert.match(card.sha256, /^[0-9a-f]{64}$/);
  assert.ok(fs.existsSync(path.join(COPY, 'public', 'images', 'products', 'dj-1', 'card.webp'))); assert.ok(fs.existsSync(path.join(COPY, 'public', 'images', 'products', 'dj-1', '1.png')));
  const q = ctx.db.q; const prod = q.get("SELECT * FROM products WHERE source_ref='dummyjson:1'");
  assert.equal(prod.card_image_url, '/images/products/dj-1/card.webp'); assert.equal(prod.card_image_original, `${CDN}/p1/thumbnail.webp`);
  assert.equal(q.get('SELECT url FROM product_images WHERE product_id=?', prod.id).url, '/images/products/dj-1/1.png');
  assert.equal(q.get("SELECT image_url u FROM order_items WHERE sku='DJ-1'").u, '/images/products/dj-1/card.webp');
  const p2 = e(2); assert.equal(p2.photos.find((x) => x.role === 'card').status, 'failed'); assert.match(p2.photos.find((x) => x.role === 'card').error, /only 64x64px/);
  const p3 = e(3); assert.equal(p3.verification.photos_installed, 0); assert.match(p3.photos[0].error, /HTML page/);
  assert.match(q.get("SELECT card_image_url u FROM products WHERE source_ref='dummyjson:3'").u, /^http/, 'failed photos are not replaced by anything else');
  assert.ok(e(4).photos.some((x) => x.status === 'owner photo (kept)')); assert.equal(q.get("SELECT COUNT(*) n FROM product_images WHERE url='/uploads/p99-mine.png'").n, 1);
  assert.equal(m.summary.with_installed_photo, 2); assert.equal(m.summary.showing_category_fallback, 2);
});

test('manifest-only re-run keeps installed photos; a fresh database imports straight onto the installed files', async () => {
  await run(['--manifest-only']);
  const m = JSON.parse(fs.readFileSync(path.join(COPY, 'data', 'catalogue', 'image-manifest.json'), 'utf8'));
  assert.equal(m.summary.with_installed_photo, 2);
  const fresh = path.join(COPY, 'fresh.db');
  const out = (await node(['-e', "require('./src/importers/dummyjson').importDummyJson({source:'snapshot'}).then((r)=>{const {q}=require('./src/db');console.log(JSON.stringify({used:r.installedPhotosUsed,card:q.get(\"SELECT card_image_url u FROM products WHERE source_ref='dummyjson:1'\").u}))})"], { cwd: COPY, env: { ...process.env, DATABASE_PATH: fresh } })).trim().split('\n').pop();
  // the snapshot's own URLs are the real DummyJSON ones, so only photos installed FROM those URLs are reused; ours came from the test server
  assert.ok(JSON.parse(out).used >= 0);
  // direct check of the mapping logic with a manifest entry for the real snapshot URL
  const mf = path.join(COPY, 'data', 'catalogue', 'image-manifest.json'); const mm = JSON.parse(fs.readFileSync(mf, 'utf8'));
  mm.products[0].photos.find((x) => x.role === 'card').source_url = 'https://cdn.dummyjson.com/product-images/beauty/essence-mascara-lash-princess/thumbnail.webp'; fs.writeFileSync(mf, JSON.stringify(mm));
  const fresh2 = path.join(COPY, 'fresh2.db');
  const out2 = (await node(['-e', "require('./src/importers/dummyjson').importDummyJson({source:'snapshot'}).then(()=>{const {q}=require('./src/db');console.log(q.get(\"SELECT card_image_url u FROM products WHERE source_ref='dummyjson:1'\").u)})"], { cwd: COPY, env: { ...process.env, DATABASE_PATH: fresh2 } })).trim().split('\n').pop();
  assert.equal(out2, '/images/products/dj-1/card.webp');
});

test('installed photos are served with caching and rendered on the card and product page; owner rejection hides a wrong photo', async () => {
  const port = 3980 + Math.floor(Math.random() * 9);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', `require('./server').createServer().listen(${port})`], { cwd: COPY, env: { ...process.env } });
  try {
    await new Promise((r) => setTimeout(r, 900)); const B = `http://localhost:${port}`;
    const f = await fetch(`${B}/images/products/dj-1/card.webp`); assert.equal(f.status, 200); assert.equal(f.headers.get('content-type'), 'image/webp'); assert.match(f.headers.get('cache-control'), /max-age=604800/);
    const slug = ctx.db.q.get("SELECT slug FROM products WHERE source_ref='dummyjson:1'").slug;
    assert.match(await (await fetch(`${B}/product/${slug}`)).text(), /\/images\/products\/dj-1\/1\.png/);
    assert.match(await (await fetch(`${B}/shop?q=mascara`)).text(), /\/images\/products\/dj-1\/card\.webp/);
  } finally { child.kill(); }
  const sec = require('../src/security'); ctx.db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?)', 'owner@example.test', sec.hashPassword('owner-long-password'));
  const adm = client(ctx.base); const csrf = (h) => h.match(/name="_csrf" value="([^"]+)"/)[1];
  await adm.post('/admin/login', { _csrf: csrf((await adm.get('/admin/login')).text), email: 'owner@example.test', password: 'owner-long-password' });
  const page = await adm.get('/admin/photos?show=all'); assert.equal(page.status, 200); assert.match(page.text, /Product photos/);
  const id = ctx.db.q.get("SELECT id FROM products WHERE source_ref='dummyjson:1'").id;
  await adm.post(`/admin/photos/${id}`, { _csrf: csrf(page.text), verdict: 'wrong', note: 'shows a different shade' });
  const slug = ctx.db.q.get('SELECT slug FROM products WHERE id=?', id).slug;
  assert.match((await client(ctx.base).get(`/product/${slug}`)).text, /id="main-img" src="\/img\/categories\/beauty\.svg"/);
  await adm.post(`/admin/photos/${id}`, { _csrf: csrf(page.text), verdict: 'matches' });
  assert.equal(ctx.db.q.get('SELECT verdict FROM photo_reviews WHERE product_id=?', id).verdict, 'matches');
});
