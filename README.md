# Nexoraith Absolute Ventures Ltd - Online Store

A complete e-commerce application: storefront, catalogue, cart, checkout, database, order processing, Paystack payment integration, CJdropshipping groundwork, and a protected admin area.

**Honest status:** everything below is built and automatically tested locally with sample data. Paystack and CJdropshipping have **not** been connected to real accounts yet (no credentials were available). Read `PROJECT_STATUS.md` before launching.

Company: Nexoraith Absolute Ventures Ltd, RC 9921594, NEXORAITHABSOLUTEVENTURES@GMAIL.COM

---
## 1. Run it on your computer (first time)

**You need:** Node.js version 22.13 or newer (the "LTS" download from https://nodejs.org). No other software and no `npm install` are needed because the project has zero third-party dependencies.

1. Open a terminal: Windows = press Start, type `PowerShell`, Enter. Mac = Cmd+Space, type `Terminal`, Enter.
2. Check Node: type `node -v` and press Enter. You should see `v22.x` or higher. If not, install Node first.
3. Go to the project folder: `cd path/to/nexoraith` (tip: type `cd ` then drag the folder into the window).
4. Copy the settings template.
   - Mac/Linux: `cp .env.example .env`
   - Windows PowerShell: `copy .env.example .env`
5. Create the database and load the **sample** products:
   ```
   npm run migrate
   npm run seed
   ```
   Expected: `Database is up to date at schema version 1` and `Sample catalogue: created 6 ...`.
6. Create your admin login (choose your own email and a password of 12+ characters):
   - Mac/Linux: `ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='your-long-password' npm run create-admin`
   - Windows PowerShell: `$env:ADMIN_EMAIL="you@example.com"; $env:ADMIN_PASSWORD="your-long-password"; npm run create-admin`
   Expected: `Admin user ready: you@example.com`.
7. Start the store: `npm start`. Expected: `Nexoraith store running at http://localhost:3000 (development)`.
8. Open http://localhost:3000 in your browser. Admin: http://localhost:3000/admin (log in with step 6). Stop the server with Ctrl+C.

**If something goes wrong**
- `node: command not found` -> install Node.js, then reopen the terminal.
- `Cannot find module 'node:sqlite'` or similar -> your Node is too old; install version 22.13+.
- `EADDRINUSE` -> port 3000 is busy; set `PORT=3001` in `.env` and also `SITE_URL=http://localhost:3001`.
- Admin login says "Incorrect": rerun step 6 (it resets that admin's password).

## 2. Run the automated tests
`npm test` (expect `# pass 20`, `# fail 0`). Details in `TESTING.md`.

## 3. Turn on payments (Paystack)
1. Create a Paystack account and, in the dashboard, copy your **Test Secret Key** (starts `sk_test_`): Settings > API Keys & Webhooks.
2. Open `.env` in a text editor and set `PAYSTACK_SECRET_KEY=sk_test_...` (no spaces, no quotes). Restart `npm start`.
3. Paystack must reach your computer to send webhooks; locally use a tunnel tool (for example ngrok) and set the Paystack **Test Webhook URL** to `https://<your-tunnel>/webhooks/paystack`, and `SITE_URL` to the same tunnel address. Without webhooks, the return page still verifies the payment with Paystack, but the webhook is the safety net.
4. Place a test order and pay with Paystack's published test cards. Never use real cards in test mode.
5. Going live needs Paystack business activation, the live key, and every item in the readiness checklist below. Details: `INTEGRATIONS.md`.

## 4. CJdropshipping
Set `CJ_API_KEY` (CJ account > API Key Management > Generate). Admin > Supplier sync can then check mapped variants. Order submission to CJ stays **off** (`CJ_ALLOW_ORDER_SUBMISSION=false`) until you have tested and approved the workflow. See `INTEGRATIONS.md`.

## 5. Add your real products
See `PRODUCT_CATALOG_GUIDE.md` (JSON file + `npm run import -- yourfile.json`, or edit prices/availability in Admin > Products).

## 6. Deploy (recommended: Railway, single service + volume)
SQLite is a file, so the host must keep a **persistent disk**.
1. Put the project in a private GitHub repository (`.env` and `data/*.db` are already git-ignored).
2. In Railway: New Project > Deploy from GitHub repo. Add a **Volume** mounted at `/data`.
3. Set variables: `NODE_ENV=production`, `DATABASE_PATH=/data/nexoraith.db`, `SITE_URL=https://your-domain`, `PAYSTACK_SECRET_KEY`, optional `CJ_API_KEY`, `COMPANY_PHONE`/`COMPANY_ADDRESS` once confirmed. Do **not** set the two `ALLOW_...` variables.
4. Start command `npm start` (Railway detects it). Run `npm run migrate` once from Railway's shell, then create your admin with `create-admin`, then import real products.
5. Add your custom domain in Railway (HTTPS is automatic). Set the Paystack webhook to `https://your-domain/webhooks/paystack`.
6. Keep **one** instance only (SQLite). Back up `/data/nexoraith.db` regularly (Railway volume backups or download copies).
Nothing has been deployed by this project; you must do these steps.

## 7. Production-readiness checklist
- [ ] Real products, images, prices, availability imported; sample data absent
- [ ] Delivery zones, fees, estimates confirmed and ticked "Confirmed" in Admin > Delivery
- [ ] Shipping, returns, privacy, terms pages replaced with approved text (they are DRAFTS)
- [ ] Company address/phone decision made (none supplied; see `PROJECT_STATUS.md`)
- [ ] Original logo files supplied (current logo is a crop of the style-guide image)
- [ ] Paystack live activation + live key + webhook set + one real small test payment you authorise
- [ ] CJ API access verified with a test product; supplier workflow approved
- [ ] HTTPS domain live; `NODE_ENV=production`; backups scheduled
- [ ] Admin password strong; only trusted people have it
- [ ] Contact-form inbox process agreed (messages are stored in Admin > Inquiries; no email is sent)

## Folder map
`server.js` web server and routes - `src/` business logic - `scripts/` setup/import tools - `public/` CSS, JS, images - `data/` database + sample catalogue - `tests/` automated tests - `*.md` documentation.
