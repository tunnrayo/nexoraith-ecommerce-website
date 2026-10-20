'use strict';
// Usage: npm run import -- path/to/catalog.json
// Validates every record, imports the good ones, and PRINTS every failed record (nothing is skipped silently).
const fs = require('fs');
const path = require('path');
const cfg = require('../src/config');
const db = require('../src/db');
const money = require('../src/money');
const { q, tx } = db;
const AV = ['available', 'unavailable', 'unverified'];
const ST = ['draft', 'published', 'archived'];
const slugOk = (s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s || '');

function validateProduct(p) {
  const errs = [];
  if (!slugOk(p.slug)) errs.push('slug must be lowercase letters, numbers and hyphens');
  if (!p.name || String(p.name).length > 150) errs.push('name is required (max 150 chars)');
  if (p.status && !ST.includes(p.status)) errs.push(`status must be one of ${ST.join(', ')}`);
  if (!Array.isArray(p.variants) || !p.variants.length) errs.push('at least one variant is required');
  const skus = new Set();
  for (const [i, v] of (p.variants || []).entries()) {
    if (!v.sku || !/^[A-Za-z0-9._-]{2,40}$/.test(v.sku)) errs.push(`variant ${i + 1}: invalid sku`);
    else if (skus.has(v.sku)) errs.push(`variant ${i + 1}: duplicate sku ${v.sku}`); else skus.add(v.sku);
    if (money.parseToMinor(v.price) == null) errs.push(`variant ${i + 1}: price must look like 15000 or 15000.50`);
    if (v.availability && !AV.includes(v.availability)) errs.push(`variant ${i + 1}: availability must be ${AV.join('/')}`);
    if (v.stock != null && !(Number.isInteger(v.stock) && v.stock >= 0)) errs.push(`variant ${i + 1}: stock must be a whole number >= 0 or omitted`);
    if (v.supplier?.cost != null && money.parseToMinor(v.supplier.cost) == null) errs.push(`variant ${i + 1}: supplier.cost invalid`);
  }
  for (const [i, im] of (p.images || []).entries()) {
    if (!/^\/img\/[A-Za-z0-9._\/-]+$/.test(im.url || '') || im.url.includes('..')) errs.push(`image ${i + 1}: url must be a local path starting with /img/`);
    else if (!fs.existsSync(path.join(cfg.root, 'public', im.url))) errs.push(`image ${i + 1}: file not found in public${im.url}`);
  }
  return errs;
}
function importCatalog(data) {
  const report = { created: 0, updated: 0, failed: [] };
  db.open();
  for (const c of data.categories || []) {
    if (!slugOk(c.slug) || !c.name) { report.failed.push({ item: `category ${c.slug}`, errors: ['invalid slug or name'] }); continue; }
    q.run('INSERT INTO categories(slug,name,sort_order) VALUES(?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order', c.slug, c.name, c.sort_order || 0);
  }
  for (const p of data.products || []) {
    const errs = validateProduct(p);
    const cat = p.category ? q.get('SELECT id FROM categories WHERE slug=?', p.category) : null;
    if (p.category && !cat) errs.push(`unknown category "${p.category}"`);
    if (errs.length) { report.failed.push({ item: `product ${p.slug || '(no slug)'}`, errors: errs }); continue; }
    try {
      tx(() => {
        const ex = q.get('SELECT id FROM products WHERE slug=?', p.slug);
        let id;
        if (ex) { id = ex.id; q.run("UPDATE products SET name=?, description=?, category_id=?, status=?, is_development=?, currency=?, updated_at=datetime('now') WHERE id=?", p.name, p.description || '', cat?.id ?? null, p.status || 'draft', p.is_development ? 1 : 0, cfg.currency, id); report.updated++; }
        else { id = Number(q.run('INSERT INTO products(slug,name,description,category_id,status,is_development,currency) VALUES(?,?,?,?,?,?,?)', p.slug, p.name, p.description || '', cat?.id ?? null, p.status || 'draft', p.is_development ? 1 : 0, cfg.currency).lastInsertRowid); report.created++; }
        if (p.images) { q.run('DELETE FROM product_images WHERE product_id=?', id); p.images.forEach((im, i) => q.run('INSERT INTO product_images(product_id,url,alt,sort_order) VALUES(?,?,?,?)', id, im.url, im.alt || '', i)); }
        p.variants.forEach((v, i) => {
          const other = q.get('SELECT product_id FROM variants WHERE sku=?', v.sku);
          if (other && other.product_id !== id) throw new Error(`sku ${v.sku} already belongs to another product`);
          q.run(`INSERT INTO variants(product_id,sku,label,options_json,price_minor,availability,stock_qty,sort_order) VALUES(?,?,?,?,?,?,?,?)
            ON CONFLICT(sku) DO UPDATE SET label=excluded.label, options_json=excluded.options_json, price_minor=excluded.price_minor, availability=excluded.availability, stock_qty=excluded.stock_qty, sort_order=excluded.sort_order, updated_at=datetime('now')`,
            id, v.sku, v.label || 'Default', JSON.stringify(v.options || {}), money.parseToMinor(v.price), v.availability || 'unverified', v.stock ?? null, i);
          const vid = q.get('SELECT id FROM variants WHERE sku=?', v.sku).id; const s = v.supplier;
          if (s) q.run(`INSERT INTO supplier_mappings(variant_id,supplier_product_id,supplier_variant_id,cost_minor,cost_currency,shipping_note,sync_status) VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(variant_id) DO UPDATE SET supplier_product_id=excluded.supplier_product_id, supplier_variant_id=excluded.supplier_variant_id, cost_minor=excluded.cost_minor, cost_currency=excluded.cost_currency, shipping_note=excluded.shipping_note`,
            vid, s.product_id || null, s.variant_id || null, s.cost != null ? money.parseToMinor(s.cost) : null, s.cost_currency || null, s.shipping_note || null, s.variant_id ? 'mapped' : 'unmapped');
        });
      });
    } catch (err) { report.failed.push({ item: `product ${p.slug}`, errors: [err.message] }); }
  }
  return report;
}
module.exports = { importCatalog, validateProduct };
if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: npm run import -- path/to/catalog.json'); process.exit(1); }
  let data; try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('Could not read JSON file:', e.message); process.exit(1); }
  const r = importCatalog(data);
  console.log(`Created ${r.created}, updated ${r.updated}, failed ${r.failed.length}.`);
  for (const f of r.failed) console.log(` FAILED ${f.item}:\n   - ${f.errors.join('\n   - ')}`);
  process.exit(r.failed.length ? 2 : 0);
}
