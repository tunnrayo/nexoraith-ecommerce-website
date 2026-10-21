# Nexoraith Absolute Ventures Ltd - Online Store

A complete e-commerce application: branded storefront, catalogue, cart, checkout, database, order processing, a clearly labelled **demonstration checkout** for presentations, Paystack payment integration, CJdropshipping groundwork, and a protected admin area.

**Honest status:** everything below is built and automatically tested locally with demo data. Paystack and CJdropshipping have **not** been connected to real accounts (no credentials yet). The website has **not** been deployed. Read `PROJECT_STATUS.md` before launching.

Company: Nexoraith Absolute Ventures Ltd, RC 9921594, NEXORAITHABSOLUTEVENTURES@GMAIL.COM

---
## 1. Run it on your computer (first time)

**You need:** Node.js version 22.13 or newer (the "LTS" download from https://nodejs.org). No `npm install` is needed: the project has zero third-party dependencies.

1. Open a terminal: Windows = press Start, type `PowerShell`, Enter. Mac = Cmd+Space, type `Terminal`, Enter.
2. Check Node: type `node -v` and press Enter. You should see `v22.x` or higher. If not, install Node first.
3. Go to the project folder: `cd path/to/nexoraith` (tip: type `cd ` then drag the folder into the window).
4. Copy the settings template.
   - Mac/Linux: `cp .env.example .env`
   - Windows PowerShell: `copy .env.example .env`
5. Create the database and load the **demo** products and preliminary delivery zones:
   ```
   npm run migrate
   npm run seed
   ```
   Expected: `Database is up to date at schema version 2` and `Demo catalogue: created 12 ...`.
6. Create your admin login (choose your own email and a password of 12+ characters):
   - Mac/Linux: `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='your-long-password' npm run create-admin`
   - Windows PowerShell: `$env:ADMIN_EMAIL="you@example.com"; $env:ADMIN_PASSWORD="your-long-password"; npm run create-admin`
   Expected: `Admin user ready: you@example.com`.
7. Start the store: `npm start`. Expected: `Nexoraith store running at http://localhost:3000 (development)`.
8. Open http://localhost:3000 in your browser. Admin: http://localhost:3000/admin (log in with step 6). Stop the server with Ctrl+C.

(The ExperimentalWarning about SQLite printed by Node is normal and harmless.)

**If something goes wrong**
- `node: command not found` -> install Node.js, then reopen the terminal.
- `Cannot find module 'node:sqlite'` or similar -> your Node is too old; install version 22.13+.
- `EADDRINUSE` -> port 3000 is busy; set `PORT=3001` in `.env` and also `SITE_URL=http://localhost:3001`.
- Admin login says "Incorrect": rerun step 6 (it resets that admin's password).
- Pages look unstyled: hard-refresh the browser (Ctrl+Shift+R / Cmd+Shift+R).

## 2. Presenting the store (demo mode)
On your computer demo mode is on automatically. Demo mode:
- shows the 12 demo products (each marked "Demo product", every image marked "DEMO IMAGE") and a yellow "Demonstration store" bar;
- allows the preliminary delivery fees (Lagos NGN 2,500; other Nigerian locations NGN 4,500), marked "preliminary";
- offers **Demonstration checkout (no payment)**. The customer reviews the order and clicks "Complete demonstration order" to see the confirmation page. No money is taken, stock is not reduced, and the order is labelled DEMO in Admin and can never become "paid".

Suggested walk-through for your boss: Home -> Shop by category -> a product (choose an option) -> Add to cart -> Checkout (pick a destination: the total updates) -> Review -> Complete demonstration order -> Track order (reference + email) -> Admin (dashboard, orders, products, categories, delivery).

## 3. Run the automated tests
`npm test` (expect `# pass 25`, `# fail 0`). Details in `TESTING.md`.

## 4. Manage the store (Admin)
- **Products**: "+ Add product", edit name / short description / description / category / status, prices, availability, stock, add or delete variants (options), upload images (JPG/PNG/WebP up to 5 MB) and choose the main image. Tick "Demo / sample product" only for test items.
- **Categories**: add, rename, describe, reorder, delete when empty.
- **Delivery**: edit or add zones. Tick **Confirmed** only after the fee is approved; in live mode, checkout refuses unconfirmed zones.
- **Orders**: filter real vs demonstration orders; move paid orders through fulfilment (shipped needs a tracking number).
- **Inquiries**: messages from the contact form (no email is sent automatically).
Bulk import: see `PRODUCT_CATALOG_GUIDE.md`.

## 5. Turn on payments (Paystack)
1. Create a Paystack account and, in the dashboard, copy your **Test Secret Key** (starts `sk_test_`): Settings > API Keys & Webhooks.
2. Open `.env` in a text editor and set `PAYSTACK_SECRET_KEY=sk_test_...` (no spaces, no quotes). Restart `npm start`. Checkout now also offers "Pay online with Paystack".
3. Paystack must reach the server to send webhooks. On a hosted site set the Paystack **Webhook URL** to `https://<your-domain>/webhooks/paystack`. Locally use a tunnel (e.g. ngrok) and set `SITE_URL` to the tunnel address.
4. Place a test order and pay with Paystack's published test cards. Never use real cards in test mode.
5. Going live needs Paystack business activation, the live key, and every item in the readiness checklist. Details: `INTEGRATIONS.md`.

## 6. CJdropshipping
Set `CJ_API_KEY` (CJ account > API Key Management > Generate). Admin > Supplier sync can then check mapped variants. Order submission to CJ stays **off** (`CJ_ALLOW_ORDER_SUBMISSION=false`) until you have tested and approved the workflow. See `INTEGRATIONS.md`.

## 7. Deploy to Railway (prepared, NOT done)
The project includes `railway.json` (start command `npm start`, health check `/health`) and `.node-version` (Node 22). On first start the server creates its tables automatically, loads the demo catalogue if `DEMO_MODE=true` and the store is empty, and creates the first admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` if no admin exists. So **no terminal commands are needed on Railway**.
1. Put the project in a **private** GitHub repository (`.env`, the database and uploads are git-ignored).
2. Railway: New Project > Deploy from GitHub repo > choose the repo.
3. Add a **Volume** to the service, mount path `/data` (SQLite is a file; without a volume every redeploy wipes orders).
4. Variables (service > Variables):
   - `NODE_ENV=production`
   - `DATABASE_PATH=/data/nexoraith.db`
   - `UPLOAD_DIR=/data/uploads`
   - `SITE_URL=https://<the Railway or custom domain>` (no trailing slash)
   - `DEMO_MODE=true` for the presentation site (set `false` before real trading)
   - `ADMIN_EMAIL=...` and `ADMIN_PASSWORD=...` (12+ characters; delete the password variable after the first successful start)
   - later: `PAYSTACK_SECRET_KEY`, `CJ_API_KEY`, `COMPANY_PHONE`/`COMPANY_ADDRESS` once confirmed
5. Settings > Networking > Generate Domain (or add your own domain; HTTPS is automatic). Update `SITE_URL` to match.
6. Check the deploy logs for `Nexoraith store running at ...` and open `/health` (should show `{"ok":true}`).
7. Keep **one** instance (SQLite). Back up `/data` regularly.

## 8. Production-readiness checklist
- [ ] `DEMO_MODE=false`; real products, images, prices, availability imported; demo products archived
- [ ] Delivery zones, fees, estimates confirmed and ticked "Confirmed" in Admin > Delivery
- [ ] Shipping, returns, privacy, terms, FAQ text approved (they are DRAFTS in `src/views.js`, `PAGES`)
- [ ] Company address/phone decision made (none supplied; see `PROJECT_STATUS.md`)
- [ ] Original logo files supplied (current logo is a crop of the style-guide image)
- [ ] Paystack live activation + live key + webhook set + one real small test payment you authorise
- [ ] CJ API access verified with a test product; supplier workflow approved
- [ ] HTTPS domain live; `NODE_ENV=production`; volume backups scheduled
- [ ] Admin password strong; `ADMIN_PASSWORD` variable removed from the host
- [ ] Contact-form inbox process agreed (messages stored in Admin > Inquiries; no email is sent)

## Folder map
`server.js` web server and routes - `src/` business logic - `scripts/` setup/import tools - `public/` CSS, JS, fonts, images - `brand-assets/` reference brand files (not served publicly) - `data/` database, uploads, demo catalogue - `tests/` automated tests - `*.md` documentation.
