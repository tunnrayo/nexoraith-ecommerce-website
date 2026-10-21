# Changelog
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
