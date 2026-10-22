'use strict';
// Removes the old demonstration catalogue from an EXISTING database (owner instruction 2026-10-22: start from an empty shop).
//
// What counts as demonstration data (anything else is left alone):
//   - products imported from DummyJSON (source 'dummyjson' or source_ref 'dummyjson:...', SKUs DJ-...)
//   - the built-in sample products (web addresses demo-... / sample-..., SKUs DEV-...)
//   (products you create yourself, including ones you tick "Test product only", are never treated as demo data)
//   - the categories those catalogues created (and that held their products), once no other product uses them
//   - local copies of their photos (uploads/catalog, public/img/catalog, public/images/products) that nothing uses any more
//
// Safety:
//   - a backup copy of the whole database is written first (data/backups/ or next to the database)
//   - a product that appears in any customer order is NOT deleted: it is archived (hidden from the shop), so the order,
//     its payment and refund records stay exactly as they were (order lines also keep their own copy of name, price, image)
//   - orders, order lines, payments, refunds, customers' messages, admin accounts, delivery zones and settings are never touched
//   - photos you uploaded yourself (/uploads/p<id>-...) are never deleted
//   - dryRun: true only reports what would happen
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const db = require('./db');

const DEMO_CATEGORY_SLUGS = [
  // created by the built-in samples (v0.1-v0.3)
  'home-living', 'accessories', 'tech-accessories',
  // created by the DummyJSON import (v0.3-v0.6)
  'beauty', 'fragrances', 'furniture', 'groceries', 'home-decoration', 'kitchen-accessories', 'laptops', 'mens-shirts',
  'mens-shoes', 'mens-watches', 'mobile-accessories', 'motorcycle', 'skin-care', 'smartphones', 'sports-accessories',
  'sunglasses', 'tablets', 'tops', 'vehicle', 'womens-bags', 'womens-dresses', 'womens-jewellery', 'womens-shoes', 'womens-watches',
];
const DEMO_PRODUCT_WHERE = `(p.source='dummyjson' OR p.source_ref LIKE 'dummyjson:%'
  OR p.slug LIKE 'demo-%' OR p.slug LIKE 'sample-%'
  OR EXISTS(SELECT 1 FROM variants v WHERE v.product_id=p.id AND (v.sku LIKE 'DJ-%' OR v.sku LIKE 'DEV-%')))`;

const COPY_DIRS = () => [
  { dir: path.join(cfg.uploadDir, 'catalog'), prefix: '/uploads/catalog/' },
  { dir: path.join(cfg.root, 'public', 'img', 'catalog'), prefix: '/img/catalog/' },
  { dir: path.join(cfg.root, 'public', 'images', 'products'), prefix: '/images/products/', nested: true },
];
function listFiles(dir, nested) {
  if (!fs.existsSync(dir)) return [];
  // public/images/products: ONLY the old photo-installer folders of demo products (dj-123/, dev-.../) are candidates.
  // Files directly in that folder (your approved-catalogue photos nx-001.jpg ...) are never touched.
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (nested
    ? (e.isDirectory() && /^(dj|dev)-/i.test(e.name) ? listFiles(path.join(dir, e.name), false).map((f) => path.join(e.name, f)) : [])
    : e.isFile() ? [e.name] : []));
}

function backup() {
  if (cfg.dbPath === ':memory:') return null;
  const dir = path.join(path.dirname(cfg.dbPath), 'backups'); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `before-demo-removal-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.q.run(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

function removeDemoCatalogue({ dryRun = false, log = () => {} } = {}) {
  db.open(); const { q } = db;
  const demo = q.all(`SELECT p.id, p.name, p.status, p.admin_edited_at, p.category_id,
      (SELECT COUNT(*) FROM order_items oi JOIN variants v ON v.id=oi.variant_id WHERE v.product_id=p.id) used_in_orders
    FROM products p WHERE ${DEMO_PRODUCT_WHERE} ORDER BY p.id`);
  const inOrders = demo.filter((p) => p.used_in_orders > 0);
  const deletable = demo.filter((p) => p.used_in_orders === 0);
  const report = {
    dryRun, backup: null,
    demoProductsFound: demo.length, deleted: deletable.length, archivedBecauseInOrders: inOrders.length,
    editedByOwner: demo.filter((p) => p.admin_edited_at).map((p) => p.name),
    categoriesRemoved: [], imageCopiesRemoved: 0, keptCategories: [],
    activeProductsAfter: null, ordersBefore: q.get('SELECT COUNT(*) n FROM orders').n, paymentsBefore: q.get('SELECT COUNT(*) n FROM payments').n,
  };
  // only categories created by the demo catalogues AND holding demo products; removed once nothing else is in them
  const deletedIds = new Set(deletable.map((p) => p.id));
  const demoCats = [...new Set(demo.map((p) => p.category_id).filter(Boolean))]
    .map((id) => q.get('SELECT id, slug FROM categories WHERE id=?', id)).filter((c) => c && DEMO_CATEGORY_SLUGS.includes(c.slug));
  const emptyAfter = (c) => !q.all('SELECT id FROM products WHERE category_id=?', c.id).some((p) => !deletedIds.has(p.id));
  if (dryRun) {
    report.categoriesRemoved = demoCats.filter(emptyAfter).map((c) => c.slug);
    report.activeProductsAfter = q.get(`SELECT COUNT(*) n FROM products p WHERE p.status='published' AND NOT ${DEMO_PRODUCT_WHERE}`).n;
    return report;
  }
  report.backup = backup(); if (report.backup) log(`Backup written: ${report.backup}`);
  db.tx(() => {
    for (const p of inOrders) q.run("UPDATE products SET status='archived', updated_at=datetime('now') WHERE id=?", p.id);
    for (const p of deletable) {
      // remove anything that may not cascade on older databases, then the product (images, variants, mappings, cart lines cascade)
      q.run('DELETE FROM cart_items WHERE variant_id IN (SELECT id FROM variants WHERE product_id=?)', p.id);
      q.run('DELETE FROM products WHERE id=?', p.id);
    }
    // demo categories that no longer hold any product at all (archived products keep their category)
    for (const c of demoCats) {
      if (q.get('SELECT 1 x FROM products WHERE category_id=? LIMIT 1', c.id)) { report.keptCategories.push(c.slug); continue; }
      q.run('DELETE FROM categories WHERE id=?', c.id); report.categoriesRemoved.push(c.slug);
    }
    // the experimental photo-review records belonged only to demo products (table kept so the migrations stay intact)
    if (q.get("SELECT 1 x FROM sqlite_master WHERE type='table' AND name='photo_reviews'")) q.run('DELETE FROM photo_reviews WHERE product_id NOT IN (SELECT id FROM products)');
  });
  // local copies of catalogue photos that are no longer used by any product or order line
  const used = new Set([
    ...q.all('SELECT url u FROM product_images').map((r) => r.u),
    ...q.all("SELECT card_image_url u FROM products WHERE card_image_url<>''").map((r) => r.u),
    ...q.all("SELECT image_url u FROM order_items WHERE image_url<>''").map((r) => r.u),
  ]);
  for (const { dir, prefix, nested } of COPY_DIRS()) {
    for (const rel of listFiles(dir, nested)) {
      const url = prefix + rel.split(path.sep).join('/');
      if (used.has(url)) continue;
      fs.rmSync(path.join(dir, rel), { force: true }); report.imageCopiesRemoved++;
    }
    if (nested && fs.existsSync(dir)) for (const d of fs.readdirSync(dir)) { const f = path.join(dir, d); try { if (fs.statSync(f).isDirectory() && !fs.readdirSync(f).length) fs.rmdirSync(f); } catch { /* ignore */ } }
  }
  report.activeProductsAfter = q.get("SELECT COUNT(*) n FROM products WHERE status='published'").n;
  report.ordersAfter = q.get('SELECT COUNT(*) n FROM orders').n; report.paymentsAfter = q.get('SELECT COUNT(*) n FROM payments').n;
  return report;
}
const demoProductCount = () => { db.open(); return db.q.get(`SELECT COUNT(*) n FROM products p WHERE ${DEMO_PRODUCT_WHERE} AND p.status<>'archived'`).n; };
module.exports = { removeDemoCatalogue, demoProductCount, DEMO_CATEGORY_SLUGS };
