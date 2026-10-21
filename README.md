# Nexoraith Absolute Ventures Ltd - Online Store

An online store where customers choose **exactly** what they want from the catalogue (imported from DummyJSON, priced in Naira at NGN 1,500 per US dollar), and the owner personally sources those exact items in the market and arranges delivery. Includes the storefront, cart, checkout, order management dashboard, Paystack card payments (Mastercard, Visa, Verve where enabled on your Paystack account), a 10-day delivery estimate, customer messages and optional email.

**Honest status:** built and automatically tested on a computer. Paystack and email have **not** been connected to real accounts (no keys yet). The website has **not** been deployed. Read `PROJECT_STATUS.md` before launching.

Company: Nexoraith Absolute Ventures Ltd, RC 9921594, NEXORAITHABSOLUTEVENTURES@GMAIL.COM

---
## 1. How orders work (your business model)
1. **Customer chooses exact items** (product, option such as colour/size/model, quantity) and checks out with name, email, phone and delivery address.
2. **When the customer pays** depends on Admin > Settings:
   - **Review first** (default, recommended for market sourcing): the order is saved as **Pending review** and the customer is *not* charged. You check every item in the market, mark each one **Available in market**, then click **Request payment**. The customer's order page now shows a **Pay** button (and they are emailed if email is set up).
   - **Pay at checkout**: the customer pays straight away.
3. **Payment is confirmed only when Paystack verifies it** (server-to-server check + signed webhook). A customer returning from the payment page proves nothing on its own.
4. **Order confirmed = payment verified.** At that moment the store saves the confirmation time and the **estimated delivery date = confirmation date (Lagos time) + 10 calendar days**. Example: confirmed 21 October 2026 -> estimated 31 October 2026. The date is stored with the order and never silently recalculated.
5. **You source the exact items**: on the order page, mark each line **Secured (bought)**. Progress: Sourcing products -> Products secured -> Preparing for delivery -> Ready for dispatch -> Out for delivery -> Delivered. "Products secured" and later stages need every item secured.
6. **If an exact item can't be found**: mark it **Unavailable**. The order is flagged **Needs attention**, and the customer is told you will contact them and that nothing will be changed without their approval. Contact them (Call / WhatsApp / Email buttons, or post a message on their order page). Then either mark the item found, **remove it with their recorded approval** (totals are recalculated and a refund is recorded if they had paid), or **cancel the order** with their agreement (a full refund is recorded as due). The store **never substitutes** anything automatically.
7. **Refunds**: refund in your Paystack dashboard, then click **Mark refund completed** and enter the Paystack refund reference. The customer sees it.
8. **Delays**: use **Revise the estimate** with a reason; the customer sees the new date, the original date and the reason.

Statuses are kept separate: **Order** (Pending review, Awaiting payment, Order confirmed, Cancelled), **Payment** (Not paid, Payment in progress, Payment confirmed, Payment failed, Payment not completed, Refund pending, Refunded) and **Fulfilment** (Not started ... Delivered, Cancelled). Customers can never change any of them.

## 2. Run it on your computer (first time)
**You need:** Node.js 22.13 or newer (the "LTS" download from https://nodejs.org). No `npm install` is needed: the project has zero third-party dependencies.
1. Open a terminal: Windows = Start, type `PowerShell`, Enter. Mac = Cmd+Space, type `Terminal`, Enter.
2. Check Node: `node -v` should show `v22.x` or higher.
3. Go to the project folder: `cd path/to/nexoraith-ecommerce-website` (tip: type `cd ` then drag the folder into the window).
4. Copy the settings template. Mac/Linux: `cp .env.example .env` Windows: `copy .env.example .env`
5. Create the database, the delivery zones and the catalogue (needs internet for the catalogue):
   ```
   npm run migrate
   npm run seed
   ```
   Expected: `Database is up to date at schema version 4`, then `Catalogue from DummyJSON: fetched 194; created 194 ...`. If you are offline, run `npm run seed` again later or use **Admin > Settings > Import catalogue**. (Offline testing only: `npm run seed -- --samples` adds 12 built-in sample illustrations, hidden again once the catalogue is imported.)
6. If you imported products with an older version of this store, open **Admin > Settings**, tick "Refresh imported products I have not edited" and click **Import catalogue** once, so every price uses the exact NGN 1,500 conversion.
7. Create your admin login (12+ character password):
   - Mac/Linux: `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='your-long-password' npm run create-admin`
   - Windows PowerShell: `$env:ADMIN_EMAIL="you@example.com"; $env:ADMIN_PASSWORD="your-long-password"; npm run create-admin`
8. Start: `npm start`. Expected: `Nexoraith store running at http://localhost:3000 (development)`.
9. Open http://localhost:3000 (shop) and http://localhost:3000/admin (your dashboard). Stop the server with Ctrl+C.

(The ExperimentalWarning about SQLite printed by Node is normal.)

**If something goes wrong**
- `node: command not found` -> install Node.js, then reopen the terminal.
- `Cannot find module 'node:sqlite'` -> Node is too old; install 22.13+.
- `EADDRINUSE` -> port 3000 is busy; set `PORT=3001` and `SITE_URL=http://localhost:3001` in `.env`.
- `Could not reach DummyJSON ... Nothing was changed` -> no internet or DummyJSON is down; try again later. Your store keeps working.
- Product images show "Image not available" -> the image link is broken or blocked; upload a photo in Admin > Products.
- Admin login says "Incorrect" -> rerun step 7 (it resets that admin's password).

## 3. Try the whole workflow
As a customer: pick a product and option -> Add to cart -> Checkout -> Place order (no payment yet). As the owner (in another browser window): Admin > Orders > open the order -> mark items **Available in market** -> **Request payment**. The customer's order page now shows the Pay button (once Paystack keys are set; until then it says online payment is not switched on). To rehearse the payment step without Paystack, set `DEMO_CHECKOUT=true` on your computer: customers then also see a clearly labelled "Demonstration checkout (no payment)"; such orders are labelled DEMO in Admin and never count as paid. Leave it `false` on the live site.

## 4. Run the automated tests
`npm test` (expect `# pass 39`, `# fail 0`). Details in `TESTING.md`.

## 5. Turn on payments (Paystack, Mastercard)
1. Create a Paystack account at https://paystack.com and complete **business verification** (typically your CAC registration (RC 9921594), director ID and a business bank account; Paystack shows the exact list in your dashboard). Card payments, including Mastercard, are part of Paystack's "card" channel once your account is activated.
2. Dashboard > Settings > **API Keys & Webhooks**: copy the **Test Secret Key** (`sk_test_...`). Put it in `.env` as `PAYSTACK_SECRET_KEY=sk_test_...` (no quotes, no spaces) and restart.
3. Set the **Test Webhook URL** to `https://<your-site>/webhooks/paystack` (needs the site online, or a tunnel such as ngrok on your computer, with `SITE_URL` set to that address).
4. Place an order, request payment, and pay with Paystack's published **test cards** (never real cards in test mode). Check Admin shows "Payment confirmed" and the estimated delivery date.
5. Going live: switch to the **Live** secret key and live webhook URL only after the readiness checklist below. Then make one small real payment yourself and refund it.

## 6. Email notifications (optional)
Without email, customers still see every update on their private order page. To also email them (order received, payment link, confirmed with delivery date, progress, estimate changes, cancellation/refund) and to alert yourself about new orders:
1. Create an account at https://resend.com, add and verify your own domain (for example `nexoraith.com`).
2. Create an API key. Set `RESEND_API_KEY=re_...`, `EMAIL_FROM=Nexoraith <orders@yourdomain.com>` and your alert address in `OWNER_NOTIFY_EMAIL` (or Admin > Settings).
3. Every email attempt is listed on the order page in Admin (sent / skipped / failed). A failed email never blocks an order.

## 7. Manage the store (Admin)
- **Dashboard**: what needs attention, orders pending review, awaiting payment, to source, in delivery, refunds, deliveries due soon.
- **Orders**: search by reference/name/email/phone; filter by order, payment and fulfilment status, demo/real, dates, needs attention, refunds. Each order shows customer details, delivery address and instructions, every item with photo, option, SKU, quantity and price, totals, dates, estimate, history, emails and payment attempts.
- **Products**: search and filter; quick Availability (Available to order / Temporarily unavailable / Discontinued) and visibility (Active / Inactive / Archived); edit names, descriptions, prices, options (Colour, Size, Model), photos (upload or image link), and your private market cost.
- **Categories**, **Delivery** (zones and fees), **Inquiries** (contact form), **Settings** (payment timing, delivery days, alert email, DummyJSON demo import, archive all demo products).

## 8. Deploy to Railway (prepared, NOT done)
`railway.json` (start `npm start`, health check `/health`) and `.node-version` (Node 22) are included. On first start the server creates its tables, loads the 12 demo products if `DEMO_MODE=true` and the store is empty, and creates the first admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` if none exists. No terminal is needed on Railway.
1. Railway: New Project > Deploy from GitHub repo > `tunnrayo/nexoraith-ecommerce-website`. (Railway does not need a separate database service: the database is a file.)
2. Add a **Volume** to the service, mount path `/data`. Without it, every redeploy wipes orders.
3. Variables: `NODE_ENV=production`, `DATABASE_PATH=/data/nexoraith.db`, `UPLOAD_DIR=/data/uploads`, `SITE_URL=https://<your Railway or custom domain>` (no trailing slash), `ADMIN_EMAIL` + `ADMIN_PASSWORD` (delete the password after the first start), `PAYMENT_TIMING=review_first`, `BUSINESS_TIMEZONE=Africa/Lagos`, later `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `OWNER_NOTIFY_EMAIL`, `COMPANY_PHONE`/`COMPANY_ADDRESS` once confirmed.
4. Settings > Networking > Generate Domain (or add your domain; HTTPS is automatic). Make `SITE_URL` match. Set the Paystack webhook to `https://<domain>/webhooks/paystack`.
5. Check the deploy logs for `Nexoraith store running at ...` and open `/health` (`{"ok":true}`).
6. The catalogue is imported from DummyJSON automatically on the first start (check the log for `[setup] Empty catalogue: imported ...`). If it failed, use Admin > Settings > **Import catalogue**.
7. In **Admin > Delivery**, tick **Confirmed** on the Lagos and other-Nigeria zones once you are happy with the fees. In production, checkout refuses unconfirmed zones (or set `ALLOW_UNCONFIRMED_DELIVERY=true` to accept them while they are marked preliminary).
8. Keep **one** instance (SQLite). Back up `/data` (database + uploads) regularly. No CORS setup is needed (the site and its server are the same address).

## 9. Production-readiness checklist
- [ ] Catalogue reviewed: every product you list is one you can really source; prices adjusted where the NGN 1,500/USD conversion is not right for your market (imported prices are not verified local prices); products you cannot source hidden or discontinued; `DEMO_CHECKOUT=false`
- [ ] Delivery zones and fees confirmed and ticked "Confirmed" in Admin > Delivery
- [ ] Shipping, returns/refunds, privacy, terms and FAQ text approved (DRAFTS in `src/views.js`, `PAGES`)
- [ ] Company address/phone decision made (none supplied)
- [ ] Original logo files supplied
- [ ] Paystack business verification done; live key + live webhook set; one small real payment + refund tested
- [ ] Email service set up and a test email received (or decide to rely on order pages + phone/WhatsApp)
- [ ] HTTPS domain live; volume backups scheduled; strong admin password; `ADMIN_PASSWORD` removed from Railway variables

## Folder map
`server.js` web server and routes - `src/` business logic (`orders.js` workflow, `delivery-date.js`, `notify.js`, `admin.js`, `importers/dummyjson.js`, `payments/paystack.js`) - `scripts/` setup/import tools - `public/` CSS, JS, fonts, images - `brand-assets/` reference brand files (not public) - `data/` database, uploads, demo catalogue - `tests/` automated tests - `*.md` documentation.
