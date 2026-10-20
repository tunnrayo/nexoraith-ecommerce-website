# Project Status (updated 2026-10-20)

## Completed AND tested (automated tests, local, sample data)
- Storefront: home, shop (search, category filter, sort, pagination), product pages (gallery, options, quantity), cart, checkout, order page, contact form, About/FAQ/Shipping/Returns/Privacy/Terms (policy pages are DRAFTS), 404, sitemap.xml, robots.txt
- Server-side cart; live prices from DB; unavailable/unverified/out-of-stock refused; max quantity 20
- Checkout: validation, server-side totals, order-time price snapshot, duplicate-submission protection, guest order access via secret link
- Separate order status / payment status / fulfilment status
- Payment logic: webhook HMAC-SHA512 verification, amount+currency match, idempotency, stock reduced once, return page never trusts redirect
- Admin: login (scrypt, rate limit, sessions, CSRF), orders list/detail, guarded status changes (shipped needs tracking), products (price, availability, stock, publish, private supplier mapping), delivery zones, inquiries, supplier sync page
- Security: CSP and headers, HTML escaping, parameterised SQL, rate limits, supplier data never in public HTML, sample products blocked in production
- Catalogue importer with validation and failure report

## Built but UNVERIFIED (no credentials/network in build environment)
- Paystack initialize + verify HTTP calls (written to official docs; never run against Paystack)
- Paystack webhook delivery from the real service (signature logic is tested with locally signed payloads)
- CJdropshipping adapter (auth, product/variant/stock/tracking reads, guarded order submission): endpoint names from official index; parameter names and response fields NOT verified
- Real-browser end-to-end checkout (server flow tested over HTTP; visual check by screenshots only on home/shop/product at desktop+mobile)
- Windows execution, Node versions other than 22.22

## Incomplete / not implemented
- Customer accounts (guest checkout only, by design)
- Email sending (order confirmations, contact replies) - needs an email service decision
- Automatic CJ product import UI, automatic stock/price sync, tracking sync into orders (adapter functions exist; no scheduler)
- Refunds via Paystack API (cancel/refund is manual; admin is warned)
- Discount codes (field exists in order totals, no promotion engine)
- Self-hosted fonts (site uses Plus Jakarta Sans / Inter if installed, else system fonts)
- Multi-image upload in admin (images via import JSON + files in public/img)
- Newsletter (intentionally not built)

## Blocked on business decisions / inputs
- Launch categories, products, countries, currency (default NGN), margins, delivery fees/estimates, returns policy, supplier arrangements
- Paystack account activation/keys; CJ API key
- Original logo files (current logo is a crop of the supplied style-guide image: low resolution)
- Company address/phone: the style-guide image shows an Abuja address and a phone number in sample mock-ups, but the project brief says none was supplied, so NONE are shown. Confirm, then set COMPANY_ADDRESS / COMPANY_PHONE in `.env`.
- Tagline: "Shop Smarter. Live Better." used because the style guide marks it recommended; the style guide's own checklist says brand decisions are unconfirmed.

## Assumptions made (documented, not final policy)
Currency NGN; sample delivery zone "Nigeria (development placeholder)" fee 1,500.00 marked NOT confirmed; guest checkout; SQLite; teal buttons darkened to #0B7F7C for text contrast (brand teal #0EA5A1 kept for graphics/focus).
