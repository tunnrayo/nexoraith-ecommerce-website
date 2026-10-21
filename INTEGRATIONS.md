# Integrations - actual status
## Paystack (payments)
**Status: implemented, NOT verified against Paystack. No keys were available.** Live payments are not active.
Implemented per https://paystack.com/docs/api/: `POST /transaction/initialize` (amount in kobo, our unique reference, callback URL), `GET /transaction/verify/:reference`, webhook header `x-paystack-signature` = HMAC-SHA512(raw body, secret key).
Flow: order saved -> customer clicks Pay on order page -> redirected to Paystack -> returns to `/payment/callback` (server calls verify) and/or Paystack calls `/webhooks/paystack` (signature checked) -> `applyPaymentResult` checks status=success, amount and currency match, then marks paid once.
Missing: `PAYSTACK_SECRET_KEY` (test then live), business activation, webhook URL in dashboard, a real sandbox run by you. Never expose the secret key; it lives only in `.env`/host variables. Card data never touches this server.
Known to confirm: supported currencies for your Paystack account (NGN default), `form-action` CSP allows `https://*.paystack.com` for the redirect.
## CJdropshipping
**Status: adapter written; UNTESTED against a live account.** Official docs: https://developers.cjdropshipping.com/en/api/api2/ . Base `https://developers.cjdropshipping.com/api2.0/v1`.
Auth: `POST /authentication/getAccessToken` with `{apiKey}` (token ~15 days; limited to one call per 5 min; header `CJ-Access-Token`). Endpoints referenced: `/product/query`, `/product/variant/queryByVid`, `/product/stock/queryByVid`, `/logistic/getTrackInfo`, `/shopping/order/createOrderV2`. Endpoint paths come from CJ's published index; **request parameter names and response fields are not verified** and are marked "check docs" in `src/suppliers/cj.js`.
What works without CJ: manual product mapping (CJ product/variant IDs and cost stored privately), order payload preview in Admin.
Safeguards: order submission needs `CJ_ALLOW_ORDER_SUBMISSION=true`, a paid confirmed order, all items mapped, an explicit admin authorisation tick; one supplier order per order (DB UNIQUE); failures leave the order "awaiting supplier", never "fulfilled". Creating a CJ order may still need payment on CJ's side (their balance/confirm endpoints are NOT called by this software).
Not built: scheduled sync, tracking back-fill, CJ shipping-cost quotes (use `/logistic/freightCalculate` later), CJ product import UI.
Missing: CJ account, API key, a test product, your approval of the fulfilment workflow.
## Email
Not integrated. Contact messages are stored (Admin > Inquiries). Order emails are not sent.
## Demonstration checkout (not a payment integration)
Built-in, active only with `DEMO_MODE=true`. Takes no money and talks to no provider. Demo orders cannot be paid or fulfilled. Turn off before trading.
## Hosting (Railway)
Prepared only (`railway.json`, README section 7). **Not deployed and no Railway resources were created**: the owner will connect Railway herself.
## Supplier options (not yet chosen; no agreement secured)
CJdropshipping (adapter exists, see above), BigBuy and Alibaba are under consideration. Their reseller/API terms have not been reviewed against an actual account in this build; the supplier adapter pattern (`src/suppliers/`) and private `supplier_mappings` table allow adding another supplier without changing the storefront.
