# Deployment guide (Railway) and production-readiness

**Status: prepared, NOT deployed.** Nothing has been pushed to GitHub or deployed to Railway. Do that only when you decide to.

## Which host? (honest answer about Vercel)
This store is one Node.js server with a **SQLite database file** and **uploaded photos on disk**. That design needs a host with a **persistent disk and one running copy**. **Railway with a Volume fits. Vercel does not**: Vercel runs short-lived serverless functions whose files are erased, so orders and uploads would be lost, and it cannot run this server as written. Moving to Vercel would need a different database (e.g. a hosted PostgreSQL) and file storage, which is a larger rewrite and has not been done. Everything below is for Railway.

## Environment variables (set in Railway > your service > Variables; all apply to the one "production" environment)
| Variable | Required? | What to put | Secret? |
|---|---|---|---|
| `NODE_ENV` | yes | `production` | no |
| `SITE_URL` | yes | `https://your-domain` (no trailing slash) | no |
| `DATABASE_PATH` | yes | `/data/nexoraith.db` (on the Volume) | no |
| `UPLOAD_DIR` | yes | `/data/uploads` (on the Volume) | no |
| `SESSION_SECRET` | yes | 48+ random characters (generate below) | **yes** |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first start only | your sign-in email and a NEW private password (12+ chars). Delete `ADMIN_PASSWORD` after the first start. | **yes** |
| `PAYMENT_TIMING` | optional | `review_first` (default) or `pay_first` | no |
| `PAYSTACK_SECRET_KEY` | for payments | `sk_test_...` first, `sk_live_...` only after testing | **yes** |
| `RESEND_API_KEY`, `EMAIL_FROM`, `OWNER_NOTIFY_EMAIL` | optional | email notifications (needs a verified domain) | key is secret |
| `COMPANY_PHONE`, `COMPANY_ADDRESS` | optional | only when the business has them | no |
| `TRUST_PROXY` | optional | defaults to `true` in production (Railway sits behind a proxy; needed so each visitor gets their own rate limit) | no |
| `DEMO_CHECKOUT`, `ALLOW_DEVELOPMENT_PRODUCTS`, `ALLOW_UNCONFIRMED_DELIVERY` | leave unset/`false` | test-only switches | no |

There are **no** `NEXT_PUBLIC_*`-style variables: the app is server-rendered, so no secret is ever sent to the browser. Generate a session secret on your computer:
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` (do not share it).

## Steps
1. Push the project to your GitHub (only when you approve). `.env.local` is ignored by Git; confirm with `git status` that no `.env*` file (other than `.env.example`) is listed.
2. Railway > New Project > Deploy from GitHub repo. Add a **Volume** mounted at `/data` (without it every deploy erases orders).
3. Add the variables above. Generate a domain (HTTPS is automatic) and set `SITE_URL` to it.
4. Watch the deploy logs for `Nexoraith store running at ...`; open `/health` (`{"ok":true}`).
5. Sign in at `https://your-domain/admin/login`, open **Settings > Import / refresh approved catalogue** once, then **Health check > Run all checks now**.
6. Remove `ADMIN_PASSWORD` from Railway variables. Change the password any time in **Account**.
7. Keep **one** instance only (SQLite). Do not scale to several copies.

## Switching from test mode to live payments (do not skip)
1. Paystack account fully verified. 2. Set `PAYSTACK_SECRET_KEY=sk_test_...`; set the webhook URL in Paystack to `https://your-domain/webhooks/paystack`. 3. Make a **test** payment (Paystack test card) and confirm the order becomes *Paid* only after the verification step. 4. Swap to the `sk_live_...` key. 5. Make one small real payment, then refund it from the Paystack dashboard and record the refund on the order. 6. Only then announce the shop.

## Backups and recovery
The database is the file `/data/nexoraith.db` (+ `-wal`/`-shm` while running) and photos are in `/data/uploads`. **There is no automatic backup yet.** Before launch: (a) in Railway enable Volume backups if your plan offers them, and (b) regularly download a copy. A safe consistent copy can be made with the SQLite command `VACUUM INTO` (the clean-up tools already do this before changing data, into `/data/backups/`). To restore: stop the service, replace the file with a copy, start again. Test a restore once before launch.

## Production-readiness checklist (current honest state)
- [x] Server-side admin sign-in, CSRF, session expiry, rate limits, security headers (tested)
- [x] Server-calculated prices and totals; payment marked paid only after server verification; webhook signature check (tested with simulated Paystack)
- [ ] Real Paystack test and live payment verified end to end (needs your Paystack keys)
- [ ] Persistent Volume attached and `DATABASE_PATH`/`UPLOAD_DIR` pointed at it (Health check warns if not)
- [ ] `SESSION_SECRET` set; a NEW private admin password (the one shared in chat must be replaced)
- [ ] Delivery fees confirmed (Admin > Delivery); policies (shipping, returns, privacy, terms) approved by you
- [ ] Photo rights confirmed per product (Photo check); all 20 flagged photos reviewed
- [ ] Backups scheduled and a restore tested
- [ ] Health check shows no FAIL on the live site (run it on the live URL, including the HTTPS and cookie checks)
