'use strict';
// v0.7: the store starts with an EMPTY catalogue (owner instruction 2026-10-22). Nothing adds products automatically;
// old demonstration products can be removed from an existing database without touching orders or payments.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const path = require('path');
const { spawn, execFile } = require('child_process');
const { setup, client } = require('./helpers');
const ROOT = path.join(__dirname, '..');
let ctx; let adm; let T;
const csrf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
const visibleText = (html) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const imgSrcs = (html) => [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
const BRAND = /^\/img\/(icon-crop|logo-dark|favicon)/;
const count = (sql = "SELECT COUNT(*) n FROM products WHERE status='published'") => ctx.db.q.get(sql).n;

test.before(async () => {
  ctx = await setup({ catalogue: false, NODE_ENV: 'production', ALLOW_DEVELOPMENT_PRODUCTS: 'false', ALLOW_UNCONFIRMED_DELIVERY: 'false', DEMO_CHECKOUT: 'false', PAYMENT_TIMING: 'review_first' });
  const sec = require('../src/security'); ctx.db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?)', 'owner@example.test', sec.hashPassword('owner-long-password'));
  adm = client(ctx.base); await adm.post('/admin/login', { _csrf: csrf((await adm.get('/admin/login')).text), email: 'owner@example.test', password: 'owner-long-password' });
  T = csrf((await adm.get('/admin')).text);
});
test.after(() => ctx.server.close());

test('the project ships no demo catalogue, importer, photo installer or product images', () => {
  for (const f of ['src/importers', 'scripts/import-dummyjson.js', 'scripts/install-product-photos.js', 'data/catalogue', 'data/dev-catalog.json', 'public/img/products', 'public/images']) assert.ok(!fs.existsSync(path.join(ROOT, f)), f);
  const pkg = require('../package.json'); assert.ok(!pkg.scripts['import:dummyjson'] && !pkg.scripts['photos:install']);
  const code = ['server.js', 'src/config.js', 'src/bootstrap.js', 'src/views.js', 'src/catalog.js', 'scripts/seed.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.doesNotMatch(code, /dummyjson|dev-catalog|autoImport/i);
  assert.equal(count('SELECT COUNT(*) n FROM products'), 0); assert.equal(count('SELECT COUNT(*) n FROM categories'), 0);
});

test('empty shop: home, shop, categories, search and cart show clean empty states; no product images; no demo wording', async () => {
  const c = client(ctx.base);
  const home = await c.get('/'); assert.equal(home.status, 200);
  assert.match(home.text, /Our collection is being prepared/); assert.match(home.text, /Please check back soon/);
  assert.doesNotMatch(home.text, /Shop by category|New in the store|href="#categories"/);
  const shop = await c.get('/shop'); assert.match(shop.text, /0 products found/); assert.match(shop.text, /Our collection is being prepared/);
  assert.doesNotMatch(shop.text, /class="chip" href="\/shop\?category=/, 'no category chips');
  for (const p of ['/shop?q=mascara', '/shop?q=phone&sort=price_asc', '/shop?category=beauty', '/shop?category=smartphones&page=3', '/category/home-living']) {
    const r = await c.get(p); const html = r.status === 303 ? (await c.get(r.location)).text : r.text;
    assert.match(html, /0 products found/, p); assert.match(html, /Our collection is being prepared/, p);
  }
  assert.equal((await c.get('/product/demo-ceramic-mug')).status, 404); assert.equal((await c.get('/product/dj-1-essence-mascara-lash-princess')).status, 404);
  const cart = await c.get('/cart'); assert.match(cart.text, /Your cart is empty/);
  for (const p of ['/', '/shop', '/shop?category=beauty', '/cart', '/checkout', '/about', '/faq', '/shipping', '/returns', '/contact', '/track']) {
    const r = await c.get(p); const html = r.status === 303 ? (await c.get(r.location)).text : r.text;
    assert.doesNotMatch(visibleText(html), /\b(demo|demonstration|sample|dummyjson|test shop)\b/i, p);
    for (const src of imgSrcs(html)) assert.match(src, BRAND, `only brand images on ${p}: ${src}`);
  }
  const sm = await (await fetch(ctx.base + '/sitemap.xml')).text(); assert.doesNotMatch(sm, /\/product\/|category=/);
});

test('restarting the real server and running seed never adds products', async () => {
  const env = { ...process.env, PORT: String(4100 + Math.floor(Math.random() * 50)) };
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: ROOT, env }); let out = '';
  child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (out += d));
  try {
    for (let i = 0; i < 40 && !/running at/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 1500)); // give any background start-up task time to run
    assert.match(out, /running at/); assert.doesNotMatch(out, /import|demonstration product/i);
    assert.match(await (await fetch(`http://localhost:${env.PORT}/shop`)).text(), /0 products found/);
  } finally { child.kill(); }
  const seedOut = await new Promise((res, rej) => execFile(process.execPath, ['--disable-warning=ExperimentalWarning', 'scripts/seed.js'], { cwd: ROOT, env }, (e, so) => (e ? rej(e) : res(so))));
  assert.match(seedOut, /No products are added/);
  assert.equal(count('SELECT COUNT(*) n FROM products'), 0);
});

test('the owner can add a category and a product in Admin; it then appears in the shop, category and search', async () => {
  assert.match((await adm.get('/admin')).text, /0 active products/);
  assert.equal((await adm.post('/admin/categories/new', { _csrf: T, name: 'Handbags', description: 'Bags we source for you.', sort_order: '1' })).status, 303);
  const catId = ctx.db.q.get("SELECT id FROM categories WHERE slug='handbags'").id;
  const r = await adm.post('/admin/products/new', { _csrf: T, name: 'Tan Leather Tote', summary: 'Roomy tote.', description: 'A roomy tote.', category_id: String(catId), status: 'published', sku: 'NX-TOTE-TAN', label: 'Tan', price: '25000', vavailability: 'available', stock: '' });
  assert.equal(r.status, 303); assert.equal(count(), 1);
  const c = client(ctx.base);
  assert.match((await c.get('/shop')).text, /1 product found/); assert.match((await c.get('/shop?category=handbags')).text, /Tan Leather Tote/);
  assert.match((await c.get('/shop?q=tote')).text, /Tan Leather Tote/); assert.match((await c.get('/')).text, /Tan Leather Tote/);
  const pdp = await c.get('/product/tan-leather-tote'); assert.equal(pdp.status, 200); assert.match(pdp.text, /₦25,000\.00/);
  assert.match(pdp.text, /src="\/img\/categories\/default\.svg"/, 'no photo yet: neutral placeholder');
  // clean up so later tests start from the empty shop again
  ctx.db.q.run("DELETE FROM products WHERE slug='tan-leather-tote'"); ctx.db.q.run("DELETE FROM categories WHERE slug='handbags'");
});

test('removing the old demo catalogue from an existing database: backup first, orders and payments untouched, owner products kept', async () => {
  const q = ctx.db.q; const cfg = require('../src/config');
  const cat = (slug, name) => Number(q.run('INSERT INTO categories(slug,name) VALUES(?,?)', slug, name).lastInsertRowid);
  const beauty = cat('beauty', 'Beauty'); const home = cat('home-living', 'Home & Living'); const phones = cat('smartphones', 'Smartphones'); const mine = cat('bags', 'Bags');
  const prod = (slug, catId, src, sku, img) => {
    const id = Number(q.run("INSERT INTO products(slug,name,category_id,currency,status,source,source_ref) VALUES(?,?,?,'NGN','published',?,?)", slug, slug, catId, src, src === 'dummyjson' ? `dummyjson:${slug}` : '').lastInsertRowid);
    const vid = Number(q.run("INSERT INTO variants(product_id,sku,label,price_minor,availability) VALUES(?,?,'Standard',100000,'available')", id, sku).lastInsertRowid);
    if (img) q.run('INSERT INTO product_images(product_id,url) VALUES(?,?)', id, img);
    return { id, vid };
  };
  fs.mkdirSync(path.join(cfg.uploadDir, 'catalog'), { recursive: true });
  fs.writeFileSync(path.join(cfg.uploadDir, 'catalog', 'aaa.webp'), 'x'); fs.writeFileSync(path.join(cfg.uploadDir, 'catalog', 'bbb.webp'), 'x');
  fs.writeFileSync(path.join(cfg.uploadDir, 'p99-mine.png'), 'x');
  const dj1 = prod('dj-1-mascara', beauty, 'dummyjson', 'DJ-1', '/uploads/catalog/aaa.webp');
  const dj2 = prod('dj-2-phone', phones, 'dummyjson', 'DJ-2', '/uploads/catalog/bbb.webp'); // appears in a paid order
  const sample = prod('demo-ceramic-mug', home, '', 'DEV-MUG-WHT', '/img/products/demo-ceramic-mug.svg');
  const own = prod('my-lipstick', beauty, '', 'NX-LIP-1', '/uploads/p99-mine.png'); // the owner's own product in a demo-named category
  const ownTest = prod('my-test-bag', mine, '', 'NX-TEST-1'); q.run('UPDATE products SET is_development=1 WHERE id=?', ownTest.id);
  const cartTok = require('../src/cart').ensureCart(null); q.run('INSERT INTO cart_items(cart_token,variant_id,quantity) VALUES(?,?,1)', cartTok, dj1.vid);
  q.run("INSERT INTO orders(reference,status,payment_status,fulfillment_status,customer_name,customer_email,customer_phone,ship_address,ship_city,ship_state,ship_country,currency,subtotal_minor,delivery_fee_minor,total_minor) VALUES('NX-KEEP1','confirmed','paid','sourcing','A','a@b.co','0801','x','y','z','NG','NGN',100000,0,100000)");
  const oid = q.get("SELECT id FROM orders WHERE reference='NX-KEEP1'").id;
  q.run("INSERT INTO order_items(order_id,variant_id,product_name,variant_label,sku,unit_price_minor,quantity,line_total_minor,image_url) VALUES(?,?,'dj-2-phone','Standard','DJ-2',100000,1,100000,'/uploads/catalog/bbb.webp')", oid, dj2.vid);
  q.run("INSERT INTO payments(order_id,provider,reference,amount_minor,currency,status) VALUES(?,'paystack','NX-KEEP1-P1',100000,'NGN','success')", oid);
  const snapshot = () => JSON.stringify([q.all('SELECT * FROM orders'), q.all('SELECT * FROM order_items'), q.all('SELECT * FROM payments'), q.all('SELECT * FROM delivery_zones'), q.all('SELECT * FROM admin_users'), q.all('SELECT * FROM settings')]);
  const before = snapshot();

  const cleanup = require('../src/catalog-cleanup');
  assert.equal(cleanup.demoProductCount(), 3);
  const dry = cleanup.removeDemoCatalogue({ dryRun: true });
  assert.deepEqual([dry.demoProductsFound, dry.deleted, dry.archivedBecauseInOrders], [3, 2, 1]); assert.deepEqual(dry.categoriesRemoved, ['home-living']);
  assert.equal(q.get('SELECT COUNT(*) n FROM products').n, 5, 'dry run changes nothing');
  const page = await adm.get('/admin/settings'); assert.match(page.text, /still contains <strong>3<\/strong> product/);
  assert.match((await adm.get('/admin')).text, /3 old demo product/);
  assert.equal((await adm.post('/admin/settings/remove-demo', { _csrf: T })).status, 303); assert.equal(q.get('SELECT COUNT(*) n FROM products').n, 5, 'needs the confirmation tick');
  const r = await adm.post('/admin/settings/remove-demo', { _csrf: T, confirm: 'yes' }); assert.equal(r.status, 303);

  assert.doesNotMatch((await adm.get('/admin/products')).text, /Import catalogue|import-dummyjson/);
  assert.equal(snapshot(), before, 'orders, order lines, payments, delivery zones, admins and settings unchanged');
  assert.equal(q.get('SELECT COUNT(*) n FROM products WHERE id IN (?,?)', dj1.id, sample.id).n, 0, 'unused demo products deleted');
  assert.equal(q.get('SELECT status FROM products WHERE id=?', dj2.id).status, 'archived', 'demo product in an order is archived, not deleted');
  assert.equal(q.get('SELECT variant_id v FROM order_items WHERE order_id=?', oid).v, dj2.vid, 'order line still linked');
  assert.equal(q.get('SELECT status FROM products WHERE id=?', own.id).status, 'published'); assert.equal(q.get('SELECT is_development d FROM products WHERE id=?', ownTest.id).d, 1, 'owner test product kept');
  assert.ok(q.get("SELECT 1 x FROM categories WHERE slug='beauty'"), 'kept: holds the owner product'); assert.ok(q.get("SELECT 1 x FROM categories WHERE slug='smartphones'"), 'kept: holds the archived product');
  assert.ok(q.get("SELECT 1 x FROM categories WHERE slug='bags'")); assert.ok(!q.get("SELECT 1 x FROM categories WHERE slug='home-living'"), 'empty demo category removed');
  assert.equal(q.get('SELECT COUNT(*) n FROM cart_items WHERE variant_id=?', dj1.vid).n, 0);
  assert.ok(!fs.existsSync(path.join(cfg.uploadDir, 'catalog', 'aaa.webp')), 'unused saved demo photo removed');
  assert.ok(fs.existsSync(path.join(cfg.uploadDir, 'catalog', 'bbb.webp')), 'photo used by an order kept');
  assert.ok(fs.existsSync(path.join(cfg.uploadDir, 'p99-mine.png')), 'owner upload kept');
  const backups = fs.readdirSync(path.join(path.dirname(cfg.dbPath), 'backups'));
  assert.equal(backups.length, 1); assert.match(backups[0], /^before-demo-removal-.+\.db$/);
  const { DatabaseSync } = require('node:sqlite'); const b = new DatabaseSync(path.join(path.dirname(cfg.dbPath), 'backups', backups[0]), { readOnly: true });
  assert.equal(b.prepare('SELECT COUNT(*) n FROM products').get().n, 5, 'backup holds the database as it was'); b.close();
  assert.equal(cleanup.demoProductCount(), 0); assert.doesNotMatch((await adm.get('/admin')).text, /old demo product/);
  assert.match((await adm.get('/admin/settings')).text, /No demonstration products are left.*1 old demo product\(s\) are kept archived/);
  const shop = (await client(ctx.base).get('/shop')).text; assert.match(shop, /1 product found/); assert.match(shop, /my-lipstick/); assert.doesNotMatch(shop, /dj-2-phone|demo-ceramic/);
  // running it again is harmless
  const again = cleanup.removeDemoCatalogue(); assert.equal(again.deleted, 0); assert.equal(again.archivedBecauseInOrders, 1); assert.equal(snapshot(), before);
});
