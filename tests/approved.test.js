'use strict';
// v0.8: the owner's approved 100-product catalogue. Photos here are GENERATED TEST FILES in a temporary folder that only
// exercise the mechanism (validation, linking, placeholder, owner photo check); they are not product photographs.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('fs'); const os = require('os'); const path = require('path'); const zlib = require('zlib');
const { setup, client } = require('./helpers');
const PHOTOS = fs.mkdtempSync(path.join(os.tmpdir(), 'nxphotos-'));
process.env.APPROVED_PRIVATE_PATH = path.join(__dirname, 'fixtures', 'test-reference-prices.json'); // invented test numbers
process.env.PRODUCT_PHOTO_DIR = PHOTOS; process.env.PRODUCT_MANIFEST_PATH = path.join(PHOTOS, 'manifest.json');
function png(w, h) { // a real, decodable PNG (solid colour)
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x88)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}
fs.writeFileSync(path.join(PHOTOS, 'nx-001.png'), png(300, 300)); fs.writeFileSync(path.join(PHOTOS, 'nx-001-2.png'), png(400, 300));
fs.writeFileSync(path.join(PHOTOS, 'nx-036.png'), '<!doctype html><html><body>Access denied</body></html>'.padEnd(400, ' '));
fs.writeFileSync(path.join(PHOTOS, 'nx-051.png'), png(50, 50));
let ctx; let adm; let T; let ap;
const csrf = (html) => html.match(/name="_csrf" value="([^"]+)"/)[1];
const LIST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalogue', 'approved-products.json'), 'utf8'));
const slugOf = (sku) => ctx.db.q.get('SELECT p.slug FROM variants v JOIN products p ON p.id=v.product_id WHERE v.sku=?', sku).slug;
const naira = (n) => `₦${n.toLocaleString('en-NG')}.00`;
test.before(async () => {
  ctx = await setup({ catalogue: false, NODE_ENV: 'production', ALLOW_UNCONFIRMED_DELIVERY: 'false', DEMO_CHECKOUT: 'false', PAYMENT_TIMING: 'review_first' });
  ap = require('../src/approved-catalogue');
  const sec = require('../src/security'); ctx.db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?)', 'owner@example.test', sec.hashPassword('owner-long-password'));
  adm = client(ctx.base); await adm.post('/admin/login', { _csrf: csrf((await adm.get('/admin/login')).text), email: 'owner@example.test', password: 'owner-long-password' });
  T = csrf((await adm.get('/admin')).text);
});
test.after(() => { ctx.server.close(); fs.rmSync(PHOTOS, { recursive: true, force: true }); });

test('the approved list holds exactly the 100 supplied products, prices exact, in 7 categories', () => {
  assert.equal(LIST.products.length, 100); assert.equal(new Set(LIST.products.map((p) => p.id)).size, 100);
  const by = {}; for (const p of LIST.products) by[p.category] = (by[p.category] || 0) + 1;
  assert.deepEqual(by, { 'home-kitchen': 20, 'fashion-accessories': 15, 'beauty-personal-care': 15, 'gadgets-electronics': 15, 'baby-kids': 10, 'sports-outdoor': 10, 'office-accessories': 15 });
  const p = (n) => LIST.products.find((x) => x.list_no === n);
  assert.deepEqual([p(1).name, p(1).price], ['Syinix 2.2L electric kettle', 6150]);
  assert.deepEqual([p(11).name, p(11).price], ['Maxi 20L microwave oven', 56185]);
  assert.ok(!LIST.products.some((x) => 'reference_price' in x) && !('pricing_rule_observed' in LIST), 'the committed catalogue file holds no private market prices or margin rule');
  assert.deepEqual([p(65).name, p(65).price], ['USB external SSD, 500GB', 70000]); assert.deepEqual([p(100).name, p(100).price], ['Whiteboard with markers', 20000]);
});

test('import (via Admin) creates all 100 products in the store, safely repeatable, with photos validated', async () => {
  assert.equal((await adm.post('/admin/settings/approved-import', { _csrf: T })).status, 303);
  const q = ctx.db.q;
  assert.equal(q.get("SELECT COUNT(*) n FROM products WHERE source='approved' AND status='published'").n, 100);
  assert.equal(q.get('SELECT COUNT(*) n FROM categories').n, 7);
  for (const p of LIST.products) assert.equal(q.get('SELECT price_minor m FROM variants WHERE sku=?', p.id).m, p.price * 100, p.id);
  assert.equal(q.get("SELECT m.cost_minor c FROM supplier_mappings m JOIN variants v ON v.id=m.variant_id WHERE v.sku='NX-004'").c, 888800, 'private price kept in the database from the private file');
  assert.equal(q.get("SELECT COUNT(*) n FROM supplier_mappings WHERE cost_minor IS NOT NULL").n, 3, 'only the products listed in the private file got a cost');
  const r2 = ap.importApproved(); assert.equal(r2.created, 0); assert.equal(r2.updated, 100);
  assert.equal(q.get('SELECT COUNT(*) n FROM products').n, 100); assert.equal(q.get('SELECT COUNT(*) n FROM variants').n, 100);
  assert.equal(r2.productsWithPhoto, 1, 'only NX-001 has valid photo files');
  assert.ok(r2.rejectedPhotos.some((x) => /NX-036 .*web page/.test(x))); assert.ok(r2.rejectedPhotos.some((x) => /NX-051 .*too small \(50x50px/.test(x)));
  assert.deepEqual(q.all("SELECT url FROM product_images WHERE product_id=(SELECT product_id FROM variants WHERE sku='NX-001') ORDER BY sort_order").map((r) => r.url), ['/images/products/nx-001.png', '/images/products/nx-001-2.png']);
  assert.equal(q.get("SELECT COUNT(*) n FROM product_images WHERE product_id=(SELECT product_id FROM variants WHERE sku='NX-036')").n, 0, 'no wrong file, no substitute');
  assert.equal(require('../src/catalog-cleanup').demoProductCount(), 0, 'approved products are never treated as demo data');
});

test('shop, categories, counts, search, product pages, delivery policy; private reference price never public', async () => {
  const c = client(ctx.base);
  const shop = (await c.get('/shop')).text; assert.match(shop, /100 products found/); assert.match(shop, /Page 1 of 5/);
  assert.match(shop, /Home and Kitchen <span>20<\/span>/); assert.match(shop, /Baby and Kids <span>10<\/span>/); assert.match(shop, /Office Accessories <span>15<\/span>/);
  assert.match((await c.get('/shop?category=beauty-personal-care')).text, /15 products found/);
  const niv = (await c.get('/shop?q=nivea')).text; assert.match(niv, /5 products found/);
  assert.match((await c.get('/shop?q=oraimo')).text, /2 products found/);
  const asc = (await c.get('/shop?category=office-accessories&sort=price_asc')).text; assert.ok(asc.indexOf('A4 notebook set') < asc.indexOf('Ergonomic office chair'));
  const home = (await c.get('/')).text; assert.match(home, /Shop by category/); assert.doesNotMatch(home, /Our collection is being prepared/);
  for (const p of LIST.products) {
    const r = await c.get(`/product/${slugOf(p.id)}`); assert.equal(r.status, 200, p.id);
    assert.match(r.text, new RegExp(naira(p.price).replace(/[.$]/g, '\\$&')), p.id);
    const priv = { 'NX-001': 4321, 'NX-004': 8888, 'NX-011': 47777 }[p.id]; if (priv) assert.doesNotMatch(r.text, new RegExp(priv.toLocaleString('en-NG')), `${p.id} private price hidden`);
  }
  const k = (await c.get(`/product/${slugOf('NX-001')}`)).text;
  assert.match(k, /id="main-img" src="\/images\/products\/nx-001\.png"/); assert.match(k, /Brand: Syinix/); assert.match(k, /Capacity: 2\.2 litres/);
  assert.match(k, /Estimated Delivery:<\/strong> Within 10 days after order confirmation/);
  assert.match((await c.get(`/product/${slugOf('NX-036')}`)).text, /id="main-img" src="\/img\/categories\/default\.svg"/);
  assert.match((await c.get('/shipping')).text, /Orders are processed after confirmation\. Estimated delivery is within 10 days of order confirmation, subject to product availability, supplier processing, shipping arrangements, and the customer's delivery location\./);
});

test('cart and review-first checkout use the right product, option and price', async () => {
  const c = client(ctx.base); await c.get('/shop');
  const vid = ctx.db.q.get("SELECT id FROM variants WHERE sku='NX-004'").id;
  await c.post('/cart/add', { _csrf: c.jar.nx_csrf, variant_id: vid, quantity: 2 });
  const cart = (await c.get('/cart')).text; assert.match(cart, /Vegetable multi-chopper/); assert.match(cart, /₦33,000\.00/);
  const page = await c.get('/checkout'); const key = page.text.match(/name="checkout_key" value="([^"]+)"/)[1];
  const r = await c.post('/checkout', { _csrf: csrf(page.text), checkout_key: key, name: 'Ada Obi', email: 'ada@example.com', phone: '08031234567', address: '5 Market Road', city: 'Yaba', state: 'Lagos', zone_id: ctx.db.q.get("SELECT id FROM delivery_zones WHERE name='Test zone'").id });
  assert.equal(r.status, 303); const ref = r.location.split('/')[2].split('?')[0];
  const o = ctx.db.q.get('SELECT * FROM orders WHERE reference=?', ref); assert.equal(o.status, 'pending_review'); assert.equal(o.payment_status, 'unpaid'); assert.equal(o.subtotal_minor, 3300000);
  const it = ctx.db.q.get('SELECT * FROM order_items WHERE order_id=?', o.id); assert.deepEqual([it.sku, it.product_name, it.unit_price_minor, it.quantity], ['NX-004', 'Vegetable multi-chopper', 1650000, 2]);
});

test('owner edits and visibility are never overwritten by a re-import; photo check hides a wrong photo and is recorded', async () => {
  const q = ctx.db.q; const id = q.get("SELECT product_id p FROM variants WHERE sku='NX-002'").p; const v = q.get("SELECT id FROM variants WHERE sku='NX-002'").id;
  const edit = (await adm.get(`/admin/products/${id}`)).text;
  const form = { _csrf: T, name: 'Electric hand mixer (5-speed)', summary: '', description: 'My own words.', category_id: String(q.get('SELECT category_id c FROM products WHERE id=?', id).c), status: 'published', availability: 'available', [`price_${v}`]: '6500', [`label_${v}`]: 'Standard', [`vavailability_${v}`]: 'available', [`avail_${v}`]: 'available', [`stock_${v}`]: '', [`sku_${v}`]: 'NX-002' };
  assert.ok(edit.includes('name="name"'));
  await adm.post(`/admin/products/${id}`, form);
  q.run("UPDATE products SET status='draft' WHERE id=(SELECT product_id FROM variants WHERE sku='NX-003')");
  const r = ap.importApproved(); assert.ok(r.keptYourEdits.some((x) => /NX-002/.test(x)));
  assert.equal(q.get('SELECT name FROM products WHERE id=?', id).name, 'Electric hand mixer (5-speed)');
  assert.equal(q.get("SELECT status FROM products WHERE id=(SELECT product_id FROM variants WHERE sku='NX-003')").status, 'draft', 'visibility you set is kept');
  q.run("UPDATE products SET status='published' WHERE id=(SELECT product_id FROM variants WHERE sku='NX-003')");
  const k = q.get("SELECT product_id p FROM variants WHERE sku='NX-001'").p;
  assert.match((await adm.get(`/admin/products/${k}`)).text, /Photo check/);
  await adm.post(`/admin/products/${k}/photo-check`, { _csrf: T, verdict: 'wrong', source_url: 'Own photo', note: 'wrong colour' });
  assert.match((await client(ctx.base).get(`/product/${slugOf('NX-001')}`)).text, /id="main-img" src="\/img\/categories\/default\.svg"/);
  ap.importApproved(); assert.match((await client(ctx.base).get(`/product/${slugOf('NX-001')}`)).text, /id="main-img" src="\/img\/categories\/default\.svg"/, 're-import keeps a rejected photo hidden');
  await adm.post(`/admin/products/${k}/photo-check`, { _csrf: T, verdict: 'matches', source_url: 'Own photo', permission: 'confirmed' });
  assert.match((await client(ctx.base).get(`/product/${slugOf('NX-001')}`)).text, /id="main-img" src="\/images\/products\/nx-001\.png"/);
  const m = ap.writeManifest(); assert.deepEqual([m.products_supplied, m.products_in_store, m.with_photo, m.visually_confirmed, m.permission_confirmed, m.missing_photo], [100, 100, 1, 1, 1, 99]);
  const e = JSON.parse(fs.readFileSync(process.env.PRODUCT_MANIFEST_PATH, 'utf8')).products.find((x) => x.product_id === 'NX-051');
  assert.equal(e.match_status, 'missing photo'); assert.match(e.rejected_files[0].reason, /too small/); assert.match(e.source_candidates[0].url, /oraimo\.com/);
});

test('the 100 installed collage photos: one per approved product, real decodable images, provenance recorded, permission unconfirmed', () => {
  const dir = path.join(__dirname, '..', 'public', 'images', 'products'); const { imageInfo } = require('../src/images');
  const files = fs.readdirSync(dir).filter((f) => /^nx-\d{3}\.jpg$/.test(f)).sort();
  assert.deepEqual(files, LIST.products.map((p) => `${p.id.toLowerCase()}.jpg`).sort());
  for (const f of files) { const i = imageInfo(fs.readFileSync(path.join(dir, f))); assert.equal(i.type, 'jpg', f); assert.ok(i.width >= 300 && i.width === i.height, f); }
  const src = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'catalogue', 'photo-sources.json'), 'utf8')).photos;
  assert.equal(Object.keys(src).length, 100);
  for (const p of LIST.products) { const e = src[p.id]; assert.equal(e.file, `/images/products/${p.id.toLowerCase()}.jpg`); assert.equal(e.permission, 'unconfirmed'); assert.equal(e.label_in_collage, `${p.list_no}. ${p.name}`); assert.ok(fs.existsSync(path.join(__dirname, '..', e.collage)), e.collage); }
  assert.ok(src['NX-062'].needs_review && /JBL/.test(src['NX-062'].review_notes));
});

test('importing without the private price file works and never erases a private cost already saved', () => {
  const q = ctx.db.q; process.env.APPROVED_PRIVATE_PATH = path.join(PHOTOS, 'does-not-exist.json');
  const r = ap.importApproved(); assert.equal(r.failed.length, 0); assert.equal(r.privateCostsApplied, 0);
  assert.equal(q.get("SELECT m.cost_minor c FROM supplier_mappings m JOIN variants v ON v.id=m.variant_id WHERE v.sku='NX-004'").c, 888800, 'existing private cost kept');
  assert.equal(q.get('SELECT COUNT(*) n FROM variants').n, 100);
});
