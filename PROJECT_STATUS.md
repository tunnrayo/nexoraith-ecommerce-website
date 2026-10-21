# Project Status (updated 2026-10-21, v0.3.0)

**Business model (owner instruction, 2026-10-21):** customers order exact items; the owner sources them personally in the market and arranges delivery. No dropshipping, no automatic supplier fulfilment. DummyJSON is only a temporary source of demo product data.

## Completed AND tested (35 automated tests + real-browser run, local, demo data)
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
- Live DummyJSON fetch (the build environment blocks the site; tested with a local imitation of its documented format).
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
Currency NGN; review-first default; 10 calendar days; Africa/Lagos; preliminary delivery Lagos NGN 2,500 / other Nigeria NGN 4,500; DummyJSON sample price conversion NGN 1,500 per 1.00 (arbitrary, not a market rate).
