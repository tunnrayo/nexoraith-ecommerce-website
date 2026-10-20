# Architecture
**Stack:** Node.js 22 (built-in `http`, built-in `node:sqlite`), server-rendered HTML, one stylesheet, ~15 lines of progressive-enhancement JS. **Zero npm dependencies** (chosen so a beginner has nothing to install and nothing to keep patched, and because the build environment had no package network).

| Layer | Files |
|---|---|
| HTTP, routing, headers, cookies, CSRF | `server.js` |
| Config (env) | `src/config.js` |
| Database + migrations + transactions | `src/db.js` |
| Catalogue (public queries only) | `src/catalog.js` |
| Cart (server-side, DB-backed, cookie token) | `src/cart.js` |
| Orders, payment state machine | `src/orders.js` |
| Paystack | `src/payments/paystack.js` |
| CJdropshipping adapter | `src/suppliers/cj.js` |
| Admin | `src/admin.js` |
| HTML templates | `src/views.js` |
| Validation, security helpers, money | `src/validate.js`, `src/security.js`, `src/money.js` |

## Key decisions
- **Money** is integer minor units (kobo). Total is enforced by a DB CHECK: total = subtotal + delivery - discount.
- **Server is the source of truth**: cart stores only variant IDs and quantities; price/availability are read from the DB each time. Browser price fields are ignored (tested).
- **Three separate states** on an order: `status` (pending_payment/confirmed/cancelled), `payment_status` (unpaid/pending/paid/failed/abandoned/refunded), `fulfillment_status` (not_started/awaiting_supplier/supplier_submitted/processing/shipped/delivered/cancelled).
- **Payments**: order created first (pending), payment attempts in `payments` (high-entropy reference per attempt). Paid only via `applyPaymentResult` after provider verification/signed webhook with matching amount+currency, inside a transaction; duplicate events deduped by `payment_events`.
- **Guest order access**: token = HMAC(app secret, order reference). Not stored, not guessable, recomputable (lets duplicate submissions redirect safely).
- **Supplier privacy**: supplier tables are never joined in public queries. Admin-only.
- **Supplier orders** can never be created automatically: needs env flag + paid order + all variants mapped + admin ticks authorisation; UNIQUE(order, supplier) blocks duplicates.
- **Sample data** carries `is_development=1`; hidden/blocked in production unless explicitly allowed.
- **Single-process SQLite** (WAL). Rate limiter is in-memory (per process). Scale-out would need Postgres + shared rate limit store.
