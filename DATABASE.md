# Database (SQLite file; default `data/nexoraith.db`)
Migrations live in `src/db.js` (current schema version **3**) (`MIGRATIONS` array; schema version in `PRAGMA user_version`). `npm run migrate` applies pending ones. To change the schema, **append** a new SQL string; never edit an old one.

Tables: `categories`, `products`, `product_images`, `variants` (price_minor, availability, stock_qty), `supplier_mappings` (PRIVATE: CJ ids, cost, sync status), `carts`, `cart_items`, `delivery_zones`, `orders` (snapshot of customer/address/totals), `order_items` (name, variant, sku, unit price snapshot), `payments` (one row per attempt), `payment_events` (webhook dedupe), `supplier_orders`, `admin_users`, `admin_sessions`, `inquiries`, `settings` (generated app secret).

Constraints: foreign keys ON; CHECKs for money >= 0, status enums, quantity 1..20, and the order total formula. Prices are INTEGER minor units.

Backup: copy `data/nexoraith.db` (stop the server or use `sqlite3 .backup`). With WAL, also copy `-wal`/`-shm` files if the server is running, or better, stop first. Restore by replacing the file while stopped. Keep backups private: they contain customer data and the generated app secret (losing the secret invalidates guest order links).

v2 added: `products.summary`, `categories.description`, `orders.is_demo`, `orders.payment_method` (`paystack|demo`), `orders.demo_confirmed_at`. Existing databases upgrade automatically on start.
Uploaded images live in `UPLOAD_DIR` (default `data/uploads`): back this folder up together with the database.

v3 (2026-10-21, self-sourcing): `orders` rebuilt (SQLite cannot change CHECK constraints) with statuses `pending_review|awaiting_payment|confirmed|cancelled`, payment `unpaid|pending|paid|failed|abandoned|refund_pending|refunded`, fulfilment `not_started|sourcing|products_secured|preparing|ready_for_dispatch|out_for_delivery|delivered|cancelled`, plus `payment_timing`, `payment_requested_at`, `confirmed_at`, `estimated_delivery_date`, `original_estimated_delivery_date`, `needs_attention`, `attention_reason`, `refund_due_minor`, `cancel_reason`. The rebuild runs with foreign keys off and checks integrity before commit; old statuses are mapped (pending_payment -> awaiting_payment, shipped -> out_for_delivery, etc.). `order_items` gained `image_url`, `options_json`, `item_status`, `item_note`. `products` gained `availability`, `source`. New tables `order_events`, `notifications`.

v7 (no schema change, 2026-10-22): the store ships no products. `npm run catalogue:remove-demo` removes old demo products from an existing database (backup to `data/backups/` first; products in orders are archived, never deleted). The `photo_reviews` table (v6) is no longer used but kept so older databases upgrade cleanly. Back up `data/backups/` together with the database if you want to keep those copies.
