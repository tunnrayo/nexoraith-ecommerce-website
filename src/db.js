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
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[v]); v += 1; db.exec(`PRAGMA user_version=${v}`); db.exec('COMMIT'); }
    catch (err) { db.exec('ROLLBACK'); throw err; }
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
