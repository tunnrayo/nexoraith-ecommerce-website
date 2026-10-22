# Integrations - actual status (2026-10-21)
## Business model
The owner sources products herself after customers order. **No supplier/dropshipping integration is used.** The CJdropshipping adapter from v0.1 is kept in `src/suppliers/cj.js` but its admin tools are hidden unless `SUPPLIER_INTEGRATION=cj`.

## Paystack (payments, incl. Mastercard)
**Status: implemented; NOT verified against Paystack (no keys yet).** Live payments are not active.
Per https://paystack.com/docs/api/transaction/ : `POST https://api.paystack.co/transaction/initialize` (Bearer secret key; `email`, `amount` in kobo, `currency`, our unique `reference`, `callback_url`, `metadata`), `GET /transaction/verify/:reference`, webhook header `x-paystack-signature` = HMAC-SHA512(raw body, secret key). Card payments (Mastercard/Visa/Verve) belong to Paystack's `card` channel; we do not restrict channels, so whatever your account has enabled is offered.
Flow: order (review first: only after the owner requests payment) -> customer clicks Pay -> Paystack page -> `/payment/callback` verifies server-side and/or the signed webhook arrives -> `applyPaymentResult` requires status success + same amount + same currency -> payment confirmed, order confirmed, delivery estimate set. Duplicates are ignored (event table + per-payment status). Failed/abandoned never confirm. A payment for a cancelled order is flagged for refund.
Refunds: done by the owner in the Paystack dashboard, then recorded in Admin (reference kept). Not automated.
Needed from the owner: Paystack account + business verification, test secret key, webhook URL, a sandbox run, then live key.

## Email (Resend)
**Status: implemented; tested only against a local stand-in server.** Per https://resend.com/docs/api-reference/emails/send-email : `POST https://api.resend.com/emails`, `Authorization: Bearer re_...`, JSON `from`, `to`, `subject`, `html`, `text`. Without `RESEND_API_KEY` + `EMAIL_FROM` nothing is sent and each message is logged as "skipped"; failures are logged and never block orders. Needs a verified sending domain in Resend.

## DummyJSON (REMOVED in v0.7, 2026-10-22)
The DummyJSON importer, its bundled data, the photo installer and the image manifest have been removed at the owner's request. The store makes no calls to DummyJSON or its image server, and allows no outside image hosts by default (`IMAGE_HOSTS` empty). Old imported products in an existing database are removed with `npm run catalogue:remove-demo` (backup first; products that appear in orders are archived, not deleted).

## Product photos (v0.8)
No image service. Photos are files in the project (`public/images/products`, deployed with the code) or Admin uploads (volume). Candidate official sources (Oraimo, NIVEA) and retailer listings (Syinix, SILVER CREST, Maxi, Binatone) are recorded in the approved list; none downloaded (blocked in Claude's workspace) and permission is unconfirmed for all.

## Hosting (Railway)
Prepared only (`railway.json`, README section 8). Not deployed; no Railway resources created.


## Status check (2026-10-22, v0.10)
Paystack: code complete and tested only against a simulated Paystack; **no key is configured here, so nothing has been verified against the real service.** Email (Resend): not configured. CJdropshipping: switched off; the business sources items manually. Admin > Health check shows these as BLOCKED / NOT RUN until you supply credentials, and never claims they work.
