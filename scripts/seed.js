'use strict';
// Loads the clearly-labelled DEMO catalogue and the preliminary delivery zones. Safe to run repeatedly.
const path = require('path');
const fs = require('fs');
const cfg = require('../src/config');
const db = require('../src/db');
const { importCatalog } = require('./import-catalog');
if (cfg.isProd && !cfg.demoMode) { console.error('Refusing to load demo data in production. Import your real catalogue with: npm run import -- file.json (or set DEMO_MODE=true for a presentation-only site).'); process.exit(1); }
db.open();
const data = JSON.parse(fs.readFileSync(path.join(cfg.root, 'data', 'dev-catalog.json'), 'utf8'));
// Upgrade from v0.1: rename old "sample-x" demo products to "demo-x" so they are updated in place (same SKUs, order history kept).
for (const o of db.q.all("SELECT id, slug FROM products WHERE is_development=1 AND slug LIKE 'sample-%'")) {
  const to = 'demo-' + o.slug.slice(7);
  if (data.products.some((p) => p.slug === to) && !db.q.get('SELECT 1 x FROM products WHERE slug=?', to)) db.q.run('UPDATE products SET slug=? WHERE id=?', to, o.id);
}
const r = importCatalog(data);
// Remove demo options that no longer exist in the demo catalogue (past orders keep their item snapshots).
const skus = new Set(data.products.flatMap((p) => p.variants.map((v) => v.sku)));
let gone = 0;
for (const v of db.q.all("SELECT v.id, v.sku FROM variants v JOIN products p ON p.id=v.product_id WHERE p.is_development=1 AND p.slug LIKE 'demo-%'")) if (!skus.has(v.sku)) gone += db.q.run('DELETE FROM variants WHERE id=?', v.id).changes;
// Older builds used "sample-..." products; archive them so they stop appearing (order history is kept).
const old = db.q.run("UPDATE products SET status='archived' WHERE is_development=1 AND slug LIKE 'sample-%' AND status<>'archived'").changes;
// Preliminary business settings supplied by the owner. NOT verified courier rates: confirmed=0 until approved in Admin > Delivery.
const ZONES = [['Lagos', 'NG', 250000], ['Other Nigerian locations', 'NG', 450000]];
for (const [name, cc, fee] of ZONES) {
  if (!db.q.get('SELECT 1 x FROM delivery_zones WHERE name=?', name)) db.q.run("INSERT INTO delivery_zones(name,country_code,fee_minor,estimate_text,confirmed,active) VALUES(?,?,?,'',0,1)", name, cc, fee);
}
const ph = db.q.run("UPDATE delivery_zones SET active=0 WHERE name='Nigeria (development placeholder)' AND active=1").changes;
console.log(`Demo catalogue: created ${r.created}, updated ${r.updated}, failed ${r.failed.length}. Old sample products archived: ${old}. Retired demo options removed: ${gone}. Old placeholder zone disabled: ${ph}.`);
for (const f of r.failed) console.log(' FAILED', f.item, f.errors);
