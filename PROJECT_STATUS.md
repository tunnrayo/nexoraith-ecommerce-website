# Project Status (updated 2026-10-22, v0.7.0)

**Business model (owner instruction, 2026-10-21):** customers order exact items; the owner sources them personally in the market and arranges delivery. No dropshipping, no automatic supplier fulfilment. DummyJSON is only a temporary source of demo product data.

## v0.7 (owner instruction 2026-10-22): demo catalogue removed - the shop starts EMPTY
**Active products in the project: 0.** The website ships no product data and nothing adds products automatically (start-up, `npm run seed` and Railway first start all leave the catalogue empty). Customers see "Our collection is being prepared. Please check back soon." on the home page, shop, category pages and search. The owner adds her own products in Admin > Products (separate instruction to follow).

Reference used: Git history was inspected back to the first commit (v0.1.0, 2026-10-20). Every version, including the first, already shipped a sample catalogue, so there was no earlier empty-shop version to restore. The empty state was rebuilt from the current code, keeping all later fixes (order workflow, payment safeguards, security, sitemap, image caching, etc.).

Removed: DummyJSON importer (`src/importers/`), `import:dummyjson` script, bundled DummyJSON data (`data/catalogue/`, 194 products), the photo installer (`photos:install`) and its image manifest, Admin > Product photos page, Admin import panel and Products-page import button, automatic import + automatic image download at start-up, built-in 12-product sample catalogue (`data/dev-catalog.json`) and `seed --samples`, 12 demo product illustrations (`public/img/products/`), 27 demo category pictures (only the neutral `default.svg` kept), `make-placeholders.js`, `make-category-images.js`, DummyJSON as default allowed image host (now none), env settings `AUTO_IMPORT_DUMMYJSON`, `AUTO_DOWNLOAD_IMAGES`, `IMPORT_NGN_PER_USD`, `DUMMYJSON_URL`.

Kept on purpose: general image handling (upload checks, neutral placeholder, broken-image detection, optional local copies of linked photos, caching); `npm run import` for the owner's own JSON product files; migrations v1-v6 unchanged (needed so existing databases still upgrade; the v6 `photo_reviews` table stays but is unused); demonstration checkout (payment rehearsal, off unless `DEMO_CHECKOUT=true`); brand assets, fonts, logo, all pages, cart, checkout, orders, payments, admin. The 12 sample products now exist only as a test fixture (`tests/fixtures/test-catalog.json`) loaded by automated tests into temporary databases.

**Existing databases (e.g. the owner's computer) still contain the old products until cleaned.** Added `npm run catalogue:remove-demo` (and Admin > Settings > Remove old demo catalogue): backup first (`data/backups/`), deletes demo products not used by orders, archives demo products that appear in orders (orders, payments, refunds untouched), removes now-empty demo categories and unused saved copies of demo photos; keeps owner products and uploads. The server prints a reminder at start-up while old demo products remain. Tested on a database built with v0.6 (194 DummyJSON + 12 samples + a paid order): 205 deleted, 1 archived (in the paid order), 26 categories removed, 0 active products, order and payment unchanged. **Not run on the owner's real database** (it is on her computer; Railway is not deployed).

## History (superseded by v0.7)
### v0.6: original product photos - installer, manifest, owner photo review (REMOVED in v0.7)
- **Built and tested**: `npm run photos:install` downloads each active product's original catalogue photos (the photos attached to the same DummyJSON record), validates every file (real JPG/PNG/WebP, decodes the header, at least 100x100 px, max 5 MB, rejects HTML error pages), installs them in `public/images/products/<sku>/`, re-points the product and existing order snapshots to the local file, keeps owner uploads, never substitutes another photo, and writes `data/catalogue/image-manifest.json` (per product: source URL, local path, size, SHA-256, source type, usage permission, match confidence, verification, sources checked, resolution). Admin > **Product photos** lets the owner confirm each photo matches the product or reject it (rejected photos are hidden immediately). Importer reuses installed photos on a fresh database. Migration v6 (`photo_reviews`).
- **Actually obtained in this workspace: 0 photos.** Every image host is blocked here (cdn.dummyjson.com, dummyjson.com, apple.com, samsung.com, wikimedia, etc. - rechecked 2026-10-21, also via the proxy). The installer was run on the full 194-product catalogue: 668 of 668 downloads failed ("could not reach the image server"), so `public/images/products/` is empty and the manifest lists all 194 as UNRESOLVED with the reason. No test or placeholder image is counted as a product photo.
- **Permission**: confirmed for 0 products. DummyJSON states no licence for its photos; 102 products are branded (brand owns the photos); 92 have no brand, so no manufacturer can be identified without inventing one.
- **Owner action**: README section 2c (run `npm run photos:install` on her computer, review in Admin > Product photos, commit).

### v0.5: product images investigated and made durable
- **Cause of missing images in the preview**: the build/preview environment's network blocks `cdn.dummyjson.com` (and dummyjson.com, Unsplash, Wikimedia, Hugging Face); every one of the 668 DummyJSON image URLs fails here. The website code was not the cause. DummyJSON's GitHub repository contains the product data but not the images (they are only on its CDN).
- **Fix**: product data snapshot bundled (`data/catalogue`, MIT); cards use DummyJSON's small thumbnails; images are downloaded once and stored locally (volume or Git), verified, served with year-long caching; any product without a working image shows a designed category placeholder; known-broken images are never sent to the browser; JS fallback for runtime failures.
- **Verified here** with 668 labelled test images served by a stand-in image server (because the real host is blocked): 668/668 saved, 194/194 products verified, every product page and shop card rendered from local copies with the stand-in server switched off, again after a restart; zero requests to other hosts.
- **Not verifiable here**: the real DummyJSON photos (blocked). In this environment all 194 products show category placeholders. On Railway / your computer the same code downloads the real photos.
- Also fixed: sitemap listed only 24 of 194 products; plain-text/XML responses had a page CSP that blocked the browser's viewer styles; logo/emblem served as 6 KB WebP copies (were 222 KB / 117 KB PNG) without changing the artwork.

### v0.4: imported DummyJSON products were the catalogue (REMOVED in v0.7)
- Imported products are normal catalogue items (not flagged demo), priced exactly at NGN 1,500 per USD (e.g. 9.99 USD = NGN 14,985.00), saved in the database with the source price recorded for the admin. First start with an empty catalogue imports automatically; `npm run seed` imports; Admin > Settings > Import catalogue.
- All customer-facing demo wording removed (banner, ribbons, notices, "demo" tags, demonstration checkout option). Demonstration checkout only with `DEMO_CHECKOUT=true` (testing). Built-in sample illustrations are hidden automatically once the catalogue is imported.
- Re-imports: match by DummyJSON id, then SKU, then web address; never overwrite products edited in Admin; never change availability or visibility; orders and payments untouched. JSON-LD no longer claims "InStock".
- Catalogue orders are real orders (no longer flagged demo because a delivery fee is preliminary).

## Completed AND tested (45 automated tests + real-browser runs, local)
- Storefront (unchanged design: navy + champagne gold, teal for actions): home, shop (search, category chips/filter, sort, 24 per page), product pages (gallery, exact options with Colour/Size/Model values, quantity, store-owned availability), cart, checkout (contact, delivery zone + fee, address, country, instructions, payment method, payment-timing explanation, 10-day estimate preview), order page, track order, contact, info pages.
- **Exact order records**: each line stores product name, option label, option values, SKU, unit price, quantity, line total and image reference; order stores customer contact, address, instructions, totals, currency, dates, payment status. Shown to the customer and in Admin.
- **Workflow**: review-first (default) or pay-first (Admin > Settings); request payment only after every item is marked available; payment marked confirmed only after Paystack verification (webhook signature + amount/currency check, idempotent); confirmation = payment verified; failed/abandoned payments never confirm.
- **10-day estimate**: confirmation timestamp + estimated date stored at confirmation in Africa/Lagos time; configurable days; month/year/leap-year/timezone tested; revisable only with a reason shown to the customer (original kept).
- **No substitutions**: per-item sourcing status (not yet checked / available / secured / unavailable / removed); unavailable flags the order and tells the customer; removal only with recorded approval; totals recalculated; refunds recorded; progress blocked while flagged; "products secured" and later stages require every item secured.
- **Cancellation and refunds**: paid orders need "customer informed" confirmation; refund due = money actually held (no double refunds); refund completion recorded with the Paystack reference.
- **Customer communication**: timeline of customer-visible updates on the order page; owner messages; Call / WhatsApp / Email links; private order link; optional email via Resend (tested against a local stand-in server); every email attempt logged as sent/skipped/failed.
- **Admin**: dashboard (attention, pending review, awaiting payment, to source, pipeline, refunds, deliveries due), order search and filters (status, payment, fulfilment, demo/real, dates, attention, refund), detailed order page, product search/filters with quick availability/visibility, product editor (options, private market cost, uploads, image links), categories, delivery zones, settings, DummyJSON import, archive all demo products.
- **DummyJSON demo import** (CLI + Admin button): stores products in our database (customers never call DummyJSON); image links from allowed hosts only; sample NGN prices from a stated conversion; ratings, reviews, stock, shipping/warranty/return claims NOT imported; re-runs keep owner edits; API failures change nothing; invalid records reported.
- Image fallback placeholder for broken images. Database migration v3 (tested on a v0.2 database). Security: CSP (images limited to self + allowed hosts), CSRF, sessions, rate limits, server-side totals, private order links.

## Built but UNVERIFIED (needs credentials or the real internet)
- Paystack initialize/verify against the real service; real webhook delivery; Mastercard acceptance depends on the merchant account.
- Live DummyJSON fetch and its product images (the build environment blocks dummyjson.com and cdn.dummyjson.com; tested with a local imitation of the documented format, so images showed the placeholder here).
- Resend email delivery to real inboxes.
- Railway deployment (prepared; not deployed by request).

## Incomplete / not implemented
- Customer accounts (guest checkout + private link + track order by design).
- SMS notifications; automatic Paystack refunds via API (refunds are done in the Paystack dashboard and recorded here).
- Partial-quantity changes on a line (a line is either kept or removed with approval).
- Discount codes; international delivery; multi-currency.

## Blocked on the owner
- Paystack account verification + keys; email domain + Resend key (optional).
- Real products/photos/prices; confirmed delivery fees; approved policy text; logo source files; company address/phone decision.

## Assumptions (documented, changeable)
Currency NGN; review-first default; 10 calendar days; Africa/Lagos; preliminary delivery Lagos NGN 2,500 / other Nigeria NGN 4,500 (must be ticked Confirmed for production checkout); catalogue prices = DummyJSON USD x NGN 1,500 (owner's chosen conversion; not verified local market prices).
