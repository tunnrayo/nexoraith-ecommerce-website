# Changelog
## 0.10.0 - 2026-10-22
- Privacy before publishing to GitHub: the owner's private market (reference) prices and the margin rule were removed from the committed catalogue file and from history; they now live in the Git-ignored `data/catalogue/private/reference-prices.json`. Import works with or without it and never erases a saved cost. (v0.8-v0.10 were combined into this single commit for that reason.)
- Admin: Website Health-Check Centre (`/admin/health`, ~70 live checks, statuses PASS/FAIL/WARNING/NOT RUN/BLOCKED, last result stored), Activity log (`/admin/audit`, migration v8 `admin_audit`), Account page with password change, dashboard Business overview (verified payments only).
- Sign-in: private `.env.local` support; `SESSION_SECRET` makes admin session tokens keyed hashes (HMAC); `TRUST_PROXY` / correct visitor address behind Railway (rate limits were shared by all visitors behind a proxy).
- Fix: signing in with an email that does not exist caused a server error (500) instead of "incorrect email or password".
- Optional `npm run qa:browser` (Playwright) desktop + phone browse/cart/admin check. DEPLOYMENT.md added. Tests: 62.
## 0.9.0 - 2026-10-22
- 100 product photos cut from the owner's 7 category collages and installed as public/images/products/nx-NNN.jpg; photo-sources.json, image-manifest.json, docs/photo-mapping.csv, docs/source-collages/, scripts/extract-collage-photos.py.
- Fix: demo cleanup no longer deletes files in public/images/products (only old dj-*/dev-* folders). Tests: 51.
## 0.8.0 - 2026-10-22
- Owner's approved catalogue: 100 products, 7 categories, exact prices, private reference price; `npm run catalogue:import` and Admin import button (repeatable, keeps owner edits/visibility).
- Product photos from `public/images/products/nx-NNN.*` with validation; Admin Photo check (match, source, permission); `data/catalogue/image-manifest.json`; migration v7.
- Owner's delivery policy wording on product and shipping pages.
- 0 genuine photos installed (none supplied; image websites unreachable from the build workspace). Tests: 50.
## 0.7.0 - 2026-10-22
- Shop starts empty: removed the DummyJSON importer, bundled DummyJSON data, built-in sample catalogue, demo product/category images, photo installer, image manifest, Admin Product photos page, import panels, auto-import and auto image download at start-up; `seed` adds delivery zones only; no outside image hosts by default.
- Branded empty states ("Our collection is being prepared") on home, shop, category and search; category pages without products show a clean message.
- `npm run catalogue:remove-demo` / Admin > Settings > Remove old demo catalogue: backup, delete unused demo products, archive those in orders, remove empty demo categories and unused demo photo copies; start-up reminder while demo products remain.
- Images from hosts that are no longer allowed show the neutral placeholder (no blocked requests). "Test product only" products hidden unless ALLOW_DEVELOPMENT_PRODUCTS=true.
- Tests: 45 (new empty-shop + cleanup tests; test products moved to tests/fixtures).
## 0.6.0 - 2026-10-21
- `npm run photos:install`: installs each active product's original catalogue photos into `public/images/products/<sku>/` with validation (decodable JPG/PNG/WebP, >=100x100 px, <=5 MB, HTML rejected), re-points products and order snapshots, keeps owner uploads, never substitutes; writes `data/catalogue/image-manifest.json` (source, local path, SHA-256, permission, match confidence, verification, sources checked, resolution).
- Admin > Product photos: owner confirms or rejects each photo; rejected photos hidden. Migration v6 (photo_reviews). Importer reuses installed photos. `/images/` cached 1 week.
- Run here on 194 products: 0 photos obtainable (all image hosts blocked in this workspace); manifest lists all 194 as unresolved. Tests: 48.
## 0.5.0 - 2026-10-21
- Investigated missing images: preview network blocks cdn.dummyjson.com (not a code bug).
- Bundled DummyJSON product data snapshot (MIT) with automatic fallback; thumbnails for cards; gallery without duplicate thumbnail.
- Durable images: one-time download to local storage (volume or Git), image health check, admin Product images panel, npm run images:check / images:download, auto-download on start in production.
- Designed category placeholders (28) instead of blank/broken images; eager first row, lazy rest, fixed dimensions, year-long caching for saved images, Last-Modified/304.
- Sitemap now lists every product and category; minimal CSP for text/XML; logo and emblem served as small WebP copies.
- Migration v5. Tests: 45.
## 0.4.0 - 2026-10-21
- DummyJSON products become the regular storefront catalogue: exact NGN 1,500/USD prices, no demo flag, auto-import on first start, seed imports.
- Removed all customer-facing demo presentation (banner, ribbons, notices, demo tags); demonstration checkout only with DEMO_CHECKOUT=true.
- Re-import matches by DummyJSON id/SKU, never overwrites admin-edited products (admin_edited_at), never changes availability; built-in samples hidden after import.
- Catalogue orders no longer flagged demo because of preliminary delivery fees. JSON-LD without stock claims.
- Migration v4 (existing imports converted, demo text removed). Tests: 39.
## 0.3.0 - 2026-10-21
- Business model changed to self-sourcing: review-first (default) or pay-first payment timing; request-payment step; confirmation = payment verified.
- 10-day delivery estimate stored at confirmation (Africa/Lagos), revisable with reason; shown to customer and admin.
- Exact-item records (image, options, SKU) and per-item sourcing status; no substitutions; approval-recorded item removal; refunds recorded; cancellation flow; attention flags.
- Customer order page timeline, owner messages, Call/WhatsApp/Email links, optional Resend email with delivery log.
- New admin order dashboard, filters, settings page; product search/filters, store-owned availability, options (Colour/Size/Model), image links, private market cost.
- DummyJSON demo import (CLI + admin), image fallback, external image hosts in CSP.
- DB migration v3; CJ tools hidden. Tests: 35.
## 0.2.0 - 2026-10-21
- Redesigned storefront to the brand direction: deep navy + champagne gold primary, teal for buttons/interactive states only; new landing page; self-hosted fonts; mobile fixes (email overflow, table columns).
- 12-product labelled demo catalogue in 3 categories with new demo illustrations; product summaries; category descriptions and images.
- Preliminary delivery zones Lagos NGN 2,500 / other Nigeria NGN 4,500; delivery fees shown on product, cart, checkout, shipping page.
- Checkout payment-method choice; demonstration checkout and confirmation page (no payment, never paid); Track order page.
- Admin: add product, add/delete variants, image upload, categories, add delivery zone, real vs demo order separation.
- First-start bootstrap and Railway config file (not deployed). Migration v2. Style-guide image moved out of public folder.
- Tests: 25 (5 new). Real-browser demo checkout run on desktop and mobile.
## 0.1.0 - 2026-10-20
Initial complete build: storefront, catalogue + importer, DB-backed cart, checkout, order state model, Paystack integration (unverified), CJ adapter (untested), admin, security headers, SEO files, 20 automated tests, documentation.
