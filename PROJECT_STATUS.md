# Project Status (updated 2026-10-21, v0.2.0)

## Completed AND tested (automated tests + real-browser run, local, demo data)
- Brand design system: deep navy + champagne gold primary; teal only for buttons, links, focus/interactive states, small graphics. Self-hosted Plus Jakarta Sans + Inter.
- Home landing page: hero with gold emblem, category tiles, featured products, brand promise (Trust, Quality, Convenience, Customer focus), how it works, contact call to action.
- Shop: search, category chips + filter, sort, pagination, category headings/descriptions, product cards (category, short description, price, availability, quick add-to-cart for single-option items).
- Product pages: gallery, option cards with price/availability/low-stock, quantity stepper, delivery fees box, related products.
- Cart, checkout (contact, delivery zone with fees, address, payment method; live total preview), review page, order page, confirmation page.
- **Demonstration checkout** (DEMO_MODE): completes the journey without payment; demo orders never become paid, never reduce stock, cannot be fulfilled, are labelled DEMO and filterable in Admin.
- **Track order** page (reference + email, rate limited, timing-safe comparison).
- Preliminary delivery zones: Lagos NGN 2,500; Other Nigerian locations NGN 4,500 (unconfirmed, editable).
- Server-side cart; live prices from DB; unavailable/unverified/out-of-stock refused; max quantity 20.
- Checkout: validation, server-side totals, order-time price snapshot, duplicate-submission protection, guest order access via secret link.
- Separate order status / payment status / fulfilment status.
- Payment logic: webhook HMAC-SHA512 verification, amount+currency match, idempotency, stock reduced once, return page never trusts redirect.
- Admin: login (scrypt, rate limit, sessions, CSRF); dashboard separating real vs demo orders; orders (filter real/demo) and guarded status changes; **add products**; edit products incl. short description and demo flag; **add/delete variants**; **image upload** (JPG/PNG/WebP checked by file signature, 5 MB max) with main-image choice and removal; **categories** (add/edit/reorder/delete-when-empty); delivery zones (edit + **add**); inquiries; supplier sync page.
- First-start bootstrap for hosting: automatic migrations, demo catalogue when empty in DEMO_MODE, first admin from env vars.
- Security: CSP and headers, HTML escaping, parameterised SQL, rate limits, supplier data never in public HTML, demo products blocked when demo mode is off; brand style-guide image removed from the public folder.
- Responsive: checked at 1366px and 390px (no horizontal scrolling, mobile menu works).

## Built but UNVERIFIED (no credentials/network in build environment)
- Paystack initialize + verify HTTP calls (written to official docs; never run against Paystack)
- Paystack webhook delivery from the real service (signature logic tested with locally signed payloads)
- CJdropshipping adapter: endpoint names from official index; parameter names and response fields NOT verified
- Railway deployment config (`railway.json`, `.node-version`): written, **not deployed** (owner will connect Railway)
- Windows/Mac execution, Node versions other than 22.22

## Incomplete / not implemented
- Customer accounts (guest checkout + track order by design)
- Email sending (order confirmations, contact replies): needs an email service decision
- Automatic CJ product import UI, scheduled stock/price/tracking sync
- Refunds via Paystack API (cancel/refund is manual; admin is warned)
- Discount codes (field exists in order totals, no promotion engine)
- International shipping and multi-currency (architecture allows zones per country; nothing configured)
- Newsletter (intentionally not built)

## Blocked on business decisions / inputs
- Launch categories, real products and photos, margins, confirmed delivery fees/estimates, returns policy, supplier agreement (none secured yet: CJdropshipping / BigBuy / Alibaba under consideration)
- Paystack account activation/keys; CJ API key
- Original logo files (current logo is a crop of the supplied style-guide image: low resolution)
- Company address/phone: the style-guide image shows an Abuja address and a phone number in sample mock-ups, but the project brief says none was supplied, so NONE are shown. Confirm, then set COMPANY_ADDRESS / COMPANY_PHONE.
- Tagline "Shop Smarter. Live Better." used because the style guide marks it recommended; final brand sign-off pending.

## Assumptions made (documented, not final policy)
Currency NGN; guest checkout; SQLite; demo prices invented and labelled; delivery fees as supplied by owner (preliminary); teal buttons darkened to #0B7F7C for text contrast (brand teal #0EA5A1 kept for graphics/focus).
