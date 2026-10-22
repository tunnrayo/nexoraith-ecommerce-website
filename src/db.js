'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

const MIGRATIONS = [`
CREATE TABLE categories(id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE products(id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','archived')),
  is_development INTEGER NOT NULL DEFAULT 0 CHECK(is_development IN(0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX idx_products_status ON products(status, category_id);
CREATE TABLE product_images(id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, url TEXT NOT NULL, alt TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE variants(id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, sku TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT 'Default', options_json TEXT NOT NULL DEFAULT '{}',
  price_minor INTEGER NOT NULL CHECK(price_minor >= 0),
  availability TEXT NOT NULL DEFAULT 'unverified' CHECK(availability IN('available','unavailable','unverified')),
  stock_qty INTEGER CHECK(stock_qty IS NULL OR stock_qty >= 0), sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
-- PRIVATE: never selected by public storefront queries
CREATE TABLE supplier_mappings(id INTEGER PRIMARY KEY, variant_id INTEGER NOT NULL UNIQUE REFERENCES variants(id) ON DELETE CASCADE,
  supplier TEXT NOT NULL DEFAULT 'cjdropshipping', supplier_product_id TEXT, supplier_variant_id TEXT,
  cost_minor INTEGER CHECK(cost_minor IS NULL OR cost_minor >= 0), cost_currency TEXT, shipping_note TEXT,
  sync_status TEXT NOT NULL DEFAULT 'unmapped' CHECK(sync_status IN('unmapped','mapped','synced','error')),
  last_synced_at TEXT, last_error TEXT, internal_notes TEXT);
CREATE TABLE carts(token TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE cart_items(cart_token TEXT NOT NULL REFERENCES carts(token) ON DELETE CASCADE, variant_id INTEGER NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 20), PRIMARY KEY(cart_token, variant_id));
CREATE TABLE delivery_zones(id INTEGER PRIMARY KEY, name TEXT NOT NULL, country_code TEXT NOT NULL, fee_minor INTEGER NOT NULL DEFAULT 0 CHECK(fee_minor >= 0),
  estimate_text TEXT NOT NULL DEFAULT '', confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN(0,1)), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)));
CREATE TABLE orders(id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, checkout_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK(status IN('pending_payment','confirmed','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN('unpaid','pending','paid','failed','abandoned','refunded')),
  fulfillment_status TEXT NOT NULL DEFAULT 'not_started' CHECK(fulfillment_status IN('not_started','awaiting_supplier','supplier_submitted','processing','shipped','delivered','cancelled')),
  customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, customer_phone TEXT NOT NULL,
  ship_address TEXT NOT NULL, ship_city TEXT NOT NULL, ship_state TEXT NOT NULL, ship_country TEXT NOT NULL, ship_postal TEXT NOT NULL DEFAULT '', delivery_notes TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL, subtotal_minor INTEGER NOT NULL, delivery_fee_minor INTEGER NOT NULL, discount_minor INTEGER NOT NULL DEFAULT 0, total_minor INTEGER NOT NULL,
  delivery_zone_name TEXT NOT NULL DEFAULT '', delivery_confirmed INTEGER NOT NULL DEFAULT 0, has_development_items INTEGER NOT NULL DEFAULT 0,
  tracking_number TEXT, tracking_url TEXT, admin_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK(total_minor = subtotal_minor + delivery_fee_minor - discount_minor));
CREATE INDEX idx_orders_email ON orders(customer_email);
CREATE TABLE order_items(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, variant_id INTEGER REFERENCES variants(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL, variant_label TEXT NOT NULL, sku TEXT NOT NULL, unit_price_minor INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), line_total_minor INTEGER NOT NULL);
CREATE TABLE payments(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), provider TEXT NOT NULL, reference TEXT NOT NULL UNIQUE,
  amount_minor INTEGER NOT NULL, currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'initiated' CHECK(status IN('initiated','pending','success','failed','abandoned')),
  provider_txn_id TEXT, gateway_response TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT);
CREATE TABLE payment_events(event_key TEXT PRIMARY KEY, provider TEXT NOT NULL, type TEXT NOT NULL, reference TEXT, received_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE supplier_orders(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id), supplier TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('prepared','submitted','failed')), supplier_order_id TEXT, request_json TEXT, response_summary TEXT, last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(order_id, supplier));
CREATE TABLE admin_users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE admin_sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE inquiries(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new' CHECK(status IN('new','handled')), created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`, `
-- v2 (2026-10-21): short product summaries, category descriptions, demo orders and payment method
ALTER TABLE products ADD COLUMN summary TEXT NOT NULL DEFAULT '';
ALTER TABLE categories ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN(0,1));
ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'paystack' CHECK(payment_method IN('paystack','demo'));
ALTER TABLE orders ADD COLUMN demo_confirmed_at TEXT;
CREATE INDEX idx_orders_demo ON orders(is_demo);
`, `-- fk-off
-- v3 (2026-10-21): self-sourcing business model. Orders table rebuilt with new status sets (SQLite cannot alter CHECKs).
CREATE TABLE orders_new(id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, checkout_key TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK(status IN('pending_review','awaiting_payment','confirmed','cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK(payment_status IN('unpaid','pending','paid','failed','abandoned','refund_pending','refunded')),
  fulfillment_status TEXT NOT NULL DEFAULT 'not_started' CHECK(fulfillment_status IN('not_started','sourcing','products_secured','preparing','ready_for_dispatch','out_for_delivery','delivered','cancelled')),
  customer_name TEXT NOT NULL, customer_email TEXT NOT NULL, customer_phone TEXT NOT NULL,
  ship_address TEXT NOT NULL, ship_city TEXT NOT NULL, ship_state TEXT NOT NULL, ship_country TEXT NOT NULL, ship_postal TEXT NOT NULL DEFAULT '', delivery_notes TEXT NOT NULL DEFAULT '',
  currency TEXT NOT NULL, subtotal_minor INTEGER NOT NULL, delivery_fee_minor INTEGER NOT NULL, discount_minor INTEGER NOT NULL DEFAULT 0, total_minor INTEGER NOT NULL,
  delivery_zone_name TEXT NOT NULL DEFAULT '', delivery_confirmed INTEGER NOT NULL DEFAULT 0, has_development_items INTEGER NOT NULL DEFAULT 0,
  tracking_number TEXT, tracking_url TEXT, admin_notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK(is_demo IN(0,1)),
  payment_method TEXT NOT NULL DEFAULT 'paystack' CHECK(payment_method IN('paystack','demo')),
  demo_confirmed_at TEXT,
  payment_timing TEXT NOT NULL DEFAULT 'pay_first' CHECK(payment_timing IN('review_first','pay_first')),
  payment_requested_at TEXT,
  confirmed_at TEXT,
  estimated_delivery_date TEXT CHECK(estimated_delivery_date IS NULL OR estimated_delivery_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  original_estimated_delivery_date TEXT,
  needs_attention INTEGER NOT NULL DEFAULT 0 CHECK(needs_attention IN(0,1)),
  attention_reason TEXT NOT NULL DEFAULT '',
  refund_due_minor INTEGER NOT NULL DEFAULT 0 CHECK(refund_due_minor >= 0),
  cancel_reason TEXT NOT NULL DEFAULT '',
  CHECK(total_minor = subtotal_minor + delivery_fee_minor - discount_minor));
INSERT INTO orders_new(id,reference,checkout_key,status,payment_status,fulfillment_status,customer_name,customer_email,customer_phone,ship_address,ship_city,ship_state,ship_country,ship_postal,delivery_notes,
  currency,subtotal_minor,delivery_fee_minor,discount_minor,total_minor,delivery_zone_name,delivery_confirmed,has_development_items,tracking_number,tracking_url,admin_notes,created_at,updated_at,
  is_demo,payment_method,demo_confirmed_at,payment_timing,payment_requested_at,confirmed_at,estimated_delivery_date,original_estimated_delivery_date)
SELECT o.id,o.reference,o.checkout_key,
  CASE WHEN o.status='cancelled' THEN 'cancelled' WHEN o.demo_confirmed_at IS NOT NULL THEN 'confirmed' WHEN o.status='pending_payment' THEN 'awaiting_payment' ELSE o.status END,
  o.payment_status,
  CASE o.fulfillment_status WHEN 'awaiting_supplier' THEN 'not_started' WHEN 'supplier_submitted' THEN 'sourcing' WHEN 'processing' THEN 'preparing' WHEN 'shipped' THEN 'out_for_delivery' ELSE o.fulfillment_status END,
  o.customer_name,o.customer_email,o.customer_phone,o.ship_address,o.ship_city,o.ship_state,o.ship_country,o.ship_postal,o.delivery_notes,
  o.currency,o.subtotal_minor,o.delivery_fee_minor,o.discount_minor,o.total_minor,o.delivery_zone_name,o.delivery_confirmed,o.has_development_items,o.tracking_number,o.tracking_url,o.admin_notes,o.created_at,o.updated_at,
  o.is_demo,o.payment_method,o.demo_confirmed_at,'pay_first',o.created_at,
  c.t, date(datetime(c.t,'+1 hours'),'+10 days'), date(datetime(c.t,'+1 hours'),'+10 days')
FROM orders o LEFT JOIN (SELECT o2.id oid, COALESCE((SELECT MIN(paid_at) FROM payments p WHERE p.order_id=o2.id AND p.status='success'), o2.demo_confirmed_at) t FROM orders o2) c ON c.oid=o.id;
DROP TABLE orders;
ALTER TABLE orders_new RENAME TO orders;
CREATE INDEX idx_orders_email ON orders(customer_email);
CREATE INDEX idx_orders_demo ON orders(is_demo);
CREATE INDEX idx_orders_status ON orders(status, payment_status, fulfillment_status);
-- Order lines: exact item snapshot + sourcing status per line
ALTER TABLE order_items ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE order_items ADD COLUMN options_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE order_items ADD COLUMN item_status TEXT NOT NULL DEFAULT 'pending' CHECK(item_status IN('pending','available','secured','unavailable','removed'));
ALTER TABLE order_items ADD COLUMN item_note TEXT NOT NULL DEFAULT '';
-- Product-level availability (owned by the store, never by an external API)
ALTER TABLE products ADD COLUMN availability TEXT NOT NULL DEFAULT 'available' CHECK(availability IN('available','temporarily_unavailable','discontinued'));
ALTER TABLE products ADD COLUMN source TEXT NOT NULL DEFAULT '';
-- Order history / customer communication log
CREATE TABLE order_events(id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT NOT NULL DEFAULT 'system', kind TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', customer_visible INTEGER NOT NULL DEFAULT 0 CHECK(customer_visible IN(0,1)));
CREATE INDEX idx_events_order ON order_events(order_id, id);
-- Outgoing notifications (email). status records whether it was actually sent.
CREATE TABLE notifications(id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  channel TEXT NOT NULL DEFAULT 'email', recipient TEXT NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('sent','skipped','failed')), detail TEXT NOT NULL DEFAULT '');
`, `
-- v4 (2026-10-21): imported DummyJSON products become the regular catalogue. Track owner edits so re-imports never overwrite them.
ALTER TABLE products ADD COLUMN admin_edited_at TEXT;
ALTER TABLE products ADD COLUMN source_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN source_price_text TEXT NOT NULL DEFAULT '';
UPDATE products SET is_development=0,
  description=replace(description, char(10)||char(10)||'DEMONSTRATION PRODUCT imported from DummyJSON sample data. Not verified for sale; price is a sample.', '')
  WHERE source='dummyjson';
UPDATE product_images SET alt=substr(alt, 1, instr(alt, ' (demo image ')-1)
  WHERE instr(alt, ' (demo image ')>0 AND product_id IN (SELECT id FROM products WHERE source='dummyjson');
`, `
-- v5 (2026-10-21): durable product images. card_image_url = small image for product cards (DummyJSON thumbnail).
-- Image check results are stored so customers are never shown an image already known to be broken.
ALTER TABLE products ADD COLUMN card_image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN card_image_original TEXT NOT NULL DEFAULT '';
ALTER TABLE product_images ADD COLUMN status TEXT NOT NULL DEFAULT 'unchecked' CHECK(status IN('unchecked','ok','broken'));
ALTER TABLE product_images ADD COLUMN checked_at TEXT;
ALTER TABLE product_images ADD COLUMN original_url TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN card_image_status TEXT NOT NULL DEFAULT 'unchecked' CHECK(card_image_status IN('unchecked','ok','broken'));
UPDATE products SET card_image_url=(SELECT url FROM product_images i WHERE i.product_id=products.id AND i.url LIKE '%/thumbnail.%' ORDER BY id LIMIT 1)
  WHERE source='dummyjson' AND EXISTS(SELECT 1 FROM product_images i WHERE i.product_id=products.id AND i.url LIKE '%/thumbnail.%');
DELETE FROM product_images WHERE url LIKE 'https://cdn.dummyjson.com/%/thumbnail.%'
  AND product_id IN (SELECT id FROM products WHERE source='dummyjson' AND admin_edited_at IS NULL)
  AND (SELECT COUNT(*) FROM product_images j WHERE j.product_id=product_images.product_id) > 1;
`, `
-- v6 (2026-10-21): owner's visual confirmation that a product photo really shows the product.
CREATE TABLE photo_reviews(product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK(verdict IN('matches','wrong')), note TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL, reviewed_at TEXT NOT NULL DEFAULT (datetime('now')));
`, `
-- v7 (2026-10-22): photo check on each product's admin page also records where the photo came from and whether the
-- owner has confirmed the right to use it commercially (default: unconfirmed).
ALTER TABLE photo_reviews ADD COLUMN source_url TEXT NOT NULL DEFAULT '';
ALTER TABLE photo_reviews ADD COLUMN permission TEXT NOT NULL DEFAULT 'unconfirmed' CHECK(permission IN('unconfirmed','confirmed'));
`, `
-- v8 (2026-10-22): administrator activity log (who did what, when). Never stores passwords, tokens or form contents.
CREATE TABLE admin_audit(id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')), actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_audit_at ON admin_audit(id);
`];

let db;
function open(file = cfg.dbPath) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode=WAL;');
  migrate();
  return db;
}
function migrate() {
  let v = db.prepare('PRAGMA user_version').get().user_version;
  while (v < MIGRATIONS.length) {
    // Migrations that rebuild a table must run with foreign keys OFF (SQLite's documented procedure),
    // otherwise dropping the old table would cascade-delete child rows. Integrity is checked before commit.
    const fkOff = MIGRATIONS[v].startsWith('-- fk-off');
    if (fkOff) db.exec('PRAGMA foreign_keys=OFF');
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      if (fkOff && db.prepare('PRAGMA foreign_key_check').all().length) throw new Error(`migration ${v + 1}: foreign key check failed`);
      v += 1; db.exec(`PRAGMA user_version=${v}`); db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }
    finally { if (fkOff) db.exec('PRAGMA foreign_keys=ON'); }
  }
  return v;
}
const q = {
  get: (sql, ...a) => open().prepare(sql).get(...a),
  all: (sql, ...a) => open().prepare(sql).all(...a),
  run: (sql, ...a) => open().prepare(sql).run(...a),
};
let depth = 0;
function tx(fn) {
  open();
  if (depth) return fn(); // already inside a transaction
  db.exec('BEGIN IMMEDIATE'); depth = 1;
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
  finally { depth = 0; }
}
function setting(key, make) {
  const r = q.get('SELECT value FROM settings WHERE key=?', key);
  if (r) return r.value;
  const val = make();
  q.run('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)', key, val);
  return q.get('SELECT value FROM settings WHERE key=?', key).value;
}
// Secret used to derive guest order-access tokens. Generated once, stored in the database.
const appSecret = () => setting('app_secret', () => crypto.randomBytes(32).toString('hex'));
module.exports = { open, q, tx, migrate, setting, appSecret, MIGRATIONS };
