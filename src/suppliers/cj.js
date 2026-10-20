'use strict';
// CJdropshipping adapter. Base URL and auth flow are from CJ's official API 2.0 docs
// (https://developers.cjdropshipping.com/en/api/api2/). STATUS: UNTESTED against a live CJ account.
// Endpoints used (names confirmed in the official endpoint index):
//   POST /authentication/getAccessToken   body {apiKey}  (token valid 15 days; call limited to once per 5 minutes)
//   GET  /product/query                    (product details)
//   GET  /product/variant/queryByVid       (variant details)
//   GET  /product/stock/queryByVid         (stock)
//   GET  /logistic/getTrackInfo            (tracking)
//   POST /shopping/order/createOrderV2     (order creation - gated, see submitOrder)
// Request parameter names marked "check docs" must be confirmed with a real account before relying on them.
const cfg = require('../config');
const { q } = require('../db');
const { UserError } = require('../errors');

const isConfigured = () => cfg.cj.apiKey.length > 10;
let tokenCache = null;

async function request(method, path, { query, body, auth = true } = {}) {
  const url = new URL(cfg.cj.base + path);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['CJ-Access-Token'] = await getToken();
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || (json.code !== undefined && json.code !== 200)) {
    const e = new Error(json?.message || `CJ request failed (${res.status})`); e.httpStatus = res.status; throw e;
  }
  return json.data;
}
async function getToken() {
  if (!isConfigured()) throw new UserError('CJdropshipping API key is not configured.');
  if (tokenCache && tokenCache.expires > Date.now() + 60000) return tokenCache.token;
  const data = await request('POST', '/authentication/getAccessToken', { body: { apiKey: cfg.cj.apiKey }, auth: false });
  tokenCache = { token: data.accessToken, expires: Date.parse(data.accessTokenExpiryDate) || Date.now() + 14 * 864e5 };
  return tokenCache.token;
}
const fetchProduct = (pid) => request('GET', '/product/query', { query: { pid } });            // check docs: param name
const fetchVariant = (vid) => request('GET', '/product/variant/queryByVid', { query: { vid } }); // check docs: param name
const fetchStock = (vid) => request('GET', '/product/stock/queryByVid', { query: { vid } });     // check docs: param name
const fetchTracking = (trackNumber) => request('GET', '/logistic/getTrackInfo', { query: { trackNumber } }); // check docs

// Read-only sync for ONE mapped variant: updates supplier cost/stock record and sync status. Never changes retail price.
async function syncVariant(variantId) {
  const m = q.get('SELECT * FROM supplier_mappings WHERE variant_id=?', variantId);
  if (!m || !m.supplier_variant_id) throw new UserError('This variant is not mapped to a CJ variant.');
  try {
    const v = await fetchVariant(m.supplier_variant_id);
    const cost = v && (v.variantSellPrice ?? v.sellPrice);
    const costMinor = cost != null && !Number.isNaN(Number(cost)) ? Math.round(Number(cost) * 100) : m.cost_minor;
    q.run("UPDATE supplier_mappings SET cost_minor=?, cost_currency=COALESCE(cost_currency,'USD'), sync_status='synced', last_synced_at=datetime('now'), last_error=NULL WHERE variant_id=?", costMinor, variantId);
    return { ok: true };
  } catch (err) {
    q.run("UPDATE supplier_mappings SET sync_status='error', last_error=? WHERE variant_id=?", String(err.message).slice(0, 300), variantId);
    return { ok: false, error: err.message };
  }
}

// Builds the order payload from our records so an admin can REVIEW it. Field names follow CJ's createOrder docs excerpt;
// the products[] item shape is "check docs".
function buildOrderPayload(order, items) {
  const rows = items.map((it) => ({ it, m: it.variant_id ? q.get('SELECT * FROM supplier_mappings WHERE variant_id=?', it.variant_id) : null }));
  const unmapped = rows.filter((r) => !r.m || !r.m.supplier_variant_id).map((r) => r.it.sku);
  return {
    unmapped,
    payload: {
      orderNumber: order.reference, shippingCountryCode: order.ship_country, shippingCountry: order.ship_country, shippingProvince: order.ship_state,
      shippingCity: order.ship_city, shippingAddress: order.ship_address, shippingZip: order.ship_postal, shippingCustomerName: order.customer_name,
      shippingPhone: order.customer_phone, remark: '', products: rows.filter((r) => r.m?.supplier_variant_id).map((r) => ({ vid: r.m.supplier_variant_id, quantity: r.it.quantity })),
    },
  };
}
// Guarded submission. Does NOT run unless CJ_ALLOW_ORDER_SUBMISSION=true, the order is paid, and none exists yet (UNIQUE(order_id,supplier)).
async function submitOrder(order, items) {
  if (!cfg.cj.allowOrderSubmission) throw new UserError('Supplier order submission is switched off (CJ_ALLOW_ORDER_SUBMISSION=false).');
  if (order.payment_status !== 'paid' || order.status !== 'confirmed') throw new UserError('Only paid, confirmed orders can be sent to the supplier.');
  const { unmapped, payload } = buildOrderPayload(order, items);
  if (unmapped.length) throw new UserError(`Not mapped to CJ variants yet: ${unmapped.join(', ')}`);
  const ins = q.run("INSERT OR IGNORE INTO supplier_orders(order_id,supplier,status,request_json) VALUES(?,?,?,?)", order.id, 'cjdropshipping', 'prepared', JSON.stringify(payload));
  if (!ins.changes) throw new UserError('A supplier order already exists for this order. Check its status before trying again.');
  try {
    const data = await request('POST', '/shopping/order/createOrderV2', { body: payload });
    q.run("UPDATE supplier_orders SET status='submitted', supplier_order_id=?, response_summary=?, updated_at=datetime('now') WHERE order_id=? AND supplier='cjdropshipping'", String(data?.orderId ?? ''), JSON.stringify(data).slice(0, 500), order.id);
    q.run("UPDATE orders SET fulfillment_status='supplier_submitted', updated_at=datetime('now') WHERE id=? AND fulfillment_status='awaiting_supplier'", order.id);
    return { ok: true };
  } catch (err) {
    q.run("UPDATE supplier_orders SET status='failed', last_error=?, updated_at=datetime('now') WHERE order_id=? AND supplier='cjdropshipping'", String(err.message).slice(0, 300), order.id);
    throw new UserError(`CJ rejected or failed the request: ${err.message}. The order was NOT marked as fulfilled.`);
  }
}
module.exports = { isConfigured, getToken, fetchProduct, fetchVariant, fetchStock, fetchTracking, syncVariant, buildOrderPayload, submitOrder };
