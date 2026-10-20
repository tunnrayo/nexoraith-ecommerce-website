# Database (SQLite file; default `data/nexoraith.db`)
Migrations live in `src/db.js` (`MIGRATIONS` array; schema version in `PRAGMA user_version`). `npm run migrate` applies pending ones. To change the schema, **append** a new SQL string; never edit an old one.

Tables: `categories`, `products`, `product_images`, `variants` (price_minor, availability, stock_qty), `supplier_mappings` (PRIVATE: CJ ids, cost, sync status), `carts`, `cart_items`, `delivery_zones`, `orders` (snapshot of customer/address/totals), `order_items` (name, variant, sku, unit price snapshot), `payments` (one row per attempt), `payment_events` (webhook dedupe), `supplier_orders`, `admin_users`, `admin_sessions`, `inquiries`, `settings` (generated app secret).

Constraints: foreign keys ON; CHECKs for money >= 0, status enums, quantity 1..20, and the order total formula. Prices are INTEGER minor units.

Backup: copy `data/nexoraith.db` (stop the server or use `sqlite3 .backup`). With WAL, also copy `-wal`/`-shm` files if the server is running, or better, stop first. Restore by replacing the file while stopped. Keep backups private: they contain customer data and the generated app secret (losing the secret invalidates guest order links).
