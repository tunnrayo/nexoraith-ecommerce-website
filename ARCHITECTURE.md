# Architecture
**Stack:** Node.js 22 (built-in `http`, built-in `node:sqlite`), server-rendered HTML, one stylesheet, ~35 lines of progressive-enhancement JS (the site works without JS), self-hosted fonts. **Zero npm dependencies** (chosen so a beginner has nothing to install and nothing to keep patched, and because the build environment had no package network).

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
| Admin (orders, products, variants, images, categories, delivery, inquiries, supplier) | `src/admin.js` |
| Image upload parsing + file-signature check | `src/multipart.js` |
| First-start setup (migrate, delivery zones, first admin; never adds products) | `src/bootstrap.js` |
| Removal of the old demo catalogue from existing databases (backup first) | `src/catalog-cleanup.js`, `scripts/remove-demo-catalogue.js` |
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
- **Empty catalogue by default**: the app ships no product data. Products the owner ticks "Test product only" carry `is_development=1` and are hidden/blocked unless `ALLOW_DEVELOPMENT_PRODUCTS=true`. Tests load `tests/fixtures/test-catalog.json` into their own temporary database.
- **Single-process SQLite** (WAL). Rate limiter is in-memory (per process). Scale-out would need Postgres + shared rate limit store.
- **Demo mode** (`DEMO_MODE`, default on locally, off in production): allows unconfirmed delivery fees; `DEMO_CHECKOUT=true` adds the no-payment `demo` method for rehearsals (off by default). Orders get `is_demo=1` when they contain demo products, use the demo method, or use an unconfirmed zone in demo mode. `confirmDemo` only sets `demo_confirmed_at`; payment_status stays `unpaid`, stock untouched, fulfilment impossible. `startPayment` refuses demo orders.
- **Uploads** are stored in `UPLOAD_DIR` (default `data/uploads`, outside `public/`) and served from `/uploads/` (png/jpg/webp only). Type is decided from the file's first bytes, not the name.
- **Routing**: exact paths win over `:param` paths (e.g. `/admin/products/new` before `/admin/products/:id`).
- **Hosting**: `railway.json` (start `npm start`, health `/health`); one instance + persistent volume for `/data`.

## v0.3 (self-sourcing workflow)
- `src/orders.js` holds every workflow rule: create (review_first -> `pending_review`, pay_first -> `awaiting_payment`), `requestPayment` (all items available/secured), `applyPaymentResult` (the single confirmation rule: payment verified -> `confirmed`, `confirmed_at`, `estimated_delivery_date`), `setItemStatus`, `removeItemWithApproval`, `setFulfilment` (forward only; secured items required; blocked while flagged), `cancelOrder`, `markRefunded`, `reviseEstimate`, `messageCustomer`. Admin routes only call these functions.
- `order_events` = history; `customer_visible=1` rows form the customer's timeline. `notifications` = email log.
- `src/delivery-date.js`: local date in `BUSINESS_TIMEZONE` via `Intl`, then pure calendar arithmetic (UTC date math), stored as `YYYY-MM-DD`.
- `src/settings.js`: owner-editable settings in the `settings` table override `.env` defaults.
- Product availability: product-level `availability` (available / temporarily_unavailable / discontinued) + per-option availability; both must allow ordering.
- Images: local `/img`, `/uploads`, or https links from `IMAGE_HOSTS` (CSP `img-src`); `app.js` swaps broken images for `/img/placeholder.svg`.
