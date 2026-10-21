# Testing
Run: `npm test` (Node's built-in runner; each test file gets its own temporary database, temporary upload folder and a real HTTP server).
**Last run (2026-10-21, Node 22.22, Linux): 25 passed, 0 failed.**

Covered (unit + HTTP): money maths; validation; webhook signature (valid/tampered/missing); password hashing; HTML escaping; catalogue search/filter/sort; supplier data absent from public HTML; cart add/merge/update/remove and refusal of unavailable/unverified/out-of-stock/over-stock items; CSRF; checkout validation and input preserved; server-computed totals ignoring browser values; order snapshot unaffected by later price change; duplicate checkout key; order link secrecy; webhook bad signature/amount mismatch/success/replay (stock reduced once); return page cannot mark paid; no-key payment path; contact form + honeypot; admin blocked when logged out, login, CSRF, shipped-needs-tracking, unpaid cannot ship, supplier submission off by default; security headers; path traversal; production mode hides/blocks demo products.
New in v0.2 (`tests/demo.test.js`): preliminary Lagos/other-Nigeria fees seeded unconfirmed and shown at checkout; demo checkout completes without payment, never paid, stock untouched, Paystack refused for demo orders, wrong token refused; demo method refused when demo mode is off; track order (right vs wrong email, case/space tolerant); admin create product (auto slug, duplicate SKU refused), add variant (exact kobo), PNG upload stored and served, non-image upload refused, category add, delivery zone add, dashboard/orders show demo orders.

Manual / browser checks done (Playwright + Chromium, scripts kept outside the repo):
- Full demo journey on 1366px and 390px: category page -> product (option + quantity) -> cart -> checkout (zone change updates total preview) -> review -> complete demo order -> confirmation. Preview total equalled the server total (2 x NGN 7,500 + NGN 4,500 = NGN 19,500). No console errors; no horizontal scrolling.
- Screenshots reviewed: home (desktop + mobile), shop, product, checkout, confirmation, mobile menu, admin dashboard, admin product editor.
- First start in production-style settings: tables created, demo catalogue loaded only when empty, first admin created only with a 12+ character password.
- Upgrade of a v0.1 database to schema v2 and re-seeding (old sample products carried over, no failures; second run idempotent).

**Not tested:** real Paystack/CJ calls, deployment on Railway (not done by request), accessibility audit with assistive technology (semantic HTML, labels, focus styles, skip link implemented), load, Windows/Mac, email.
