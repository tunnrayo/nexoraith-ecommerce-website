'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const { q, tx, appSecret } = require('./db');
const cart = require('./cart');
const { UserError } = require('./errors');
const paystack = require('./payments/paystack');

const newReference = () => `NX-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
// Guest access token is derived from the reference with a server-side secret, so it can be recomputed but not guessed.
const accessToken = (reference) => crypto.createHmac('sha256', appSecret()).update(reference).digest('base64url').slice(0, 32);
const tokenOk = (reference, t) => { const a = Buffer.from(accessToken(reference)), b = Buffer.from(String(t || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };

function createOrder(cartToken, f, checkoutKey) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(checkoutKey || '')) throw new UserError('Your checkout session expired. Please reload the checkout page and try again.');
  return tx(() => {
    const dup = q.get('SELECT * FROM orders WHERE checkout_key=?', checkoutKey);
    if (dup) return { order: dup, duplicate: true };
    const ls = cart.lines(cartToken);
    if (!ls.length) throw new UserError('Your cart is empty.');
    const bad = ls.find((l) => l.problem);
    if (bad) throw new UserError(`${bad.name} (${bad.variant_label}): ${bad.problem}`, { code: 'cart_problem' });
    if (new Set(ls.map((l) => l.currency)).size > 1) throw new UserError('Your cart contains items in different currencies.');
    const zone = q.get('SELECT * FROM delivery_zones WHERE id=? AND active=1', f.zone_id);
    if (!zone) throw new UserError('Please choose a valid delivery destination.');
    if (!zone.confirmed && !cfg.allowUnconfirmedDelivery) throw new UserError('Delivery charges for this destination have not been confirmed yet, so we cannot take orders for it.');
    const t = cart.totals(ls, zone.fee_minor, 0);
    if (t.total <= 0) throw new UserError('The order total must be greater than zero.');
    const reference = newReference();
    const r = q.run(`INSERT INTO orders(reference,checkout_key,customer_name,customer_email,customer_phone,ship_address,ship_city,ship_state,ship_country,ship_postal,delivery_notes,
        currency,subtotal_minor,delivery_fee_minor,discount_minor,total_minor,delivery_zone_name,delivery_confirmed,has_development_items)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      reference, checkoutKey, f.name, f.email, f.phone, f.address, f.city, f.state, zone.country_code, f.postal, f.notes,
      ls[0].currency, t.subtotal, t.delivery, t.discount, t.total, zone.name, zone.confirmed, ls.some((l) => l.is_development) ? 1 : 0);
    const oid = Number(r.lastInsertRowid);
    for (const l of ls) {
      q.run('INSERT INTO order_items(order_id,variant_id,product_name,variant_label,sku,unit_price_minor,quantity,line_total_minor) VALUES(?,?,?,?,?,?,?,?)',
        oid, l.variant_id, l.name, l.variant_label, l.sku, l.price_minor, l.quantity, l.line_total);
    }
    cart.clear(cartToken);
    return { order: q.get('SELECT * FROM orders WHERE id=?', oid), duplicate: false };
  });
}
const byReference = (ref) => q.get('SELECT * FROM orders WHERE reference=?', ref);
const items = (orderId) => q.all('SELECT * FROM order_items WHERE order_id=? ORDER BY id', orderId);

// Start a payment attempt with Paystack. Order stays unpaid unless the provider accepts the request.
async function startPayment(order) {
  if (!paystack.isConfigured()) throw new UserError('Online payment is not switched on for this store yet. Your order has been saved and no money has been taken.', { code: 'payment_unconfigured' });
  if (order.payment_status === 'paid') throw new UserError('This order has already been paid.');
  const n = q.get('SELECT COUNT(*) n FROM payments WHERE order_id=?', order.id).n + 1;
  const reference = `${order.reference}-P${n}-${crypto.randomBytes(8).toString("hex")}`; // high-entropy: the payment return page uses it to find the order
  q.run('INSERT INTO payments(order_id,provider,reference,amount_minor,currency,status) VALUES(?,?,?,?,?,?)', order.id, 'paystack', reference, order.total_minor, order.currency, 'initiated');
  try {
    const data = await paystack.initialize({ email: order.customer_email, amountMinor: order.total_minor, currency: order.currency, reference,
      callbackUrl: `${cfg.siteUrl}/payment/callback`, metadata: { order_reference: order.reference } });
    q.run("UPDATE payments SET status='pending', updated_at=datetime('now') WHERE reference=?", reference);
    q.run("UPDATE orders SET payment_status='pending', updated_at=datetime('now') WHERE id=? AND payment_status<>'paid'", order.id);
    return data.authorization_url;
  } catch (err) {
    q.run("UPDATE payments SET status='failed', gateway_response=?, updated_at=datetime('now') WHERE reference=?", String(err.message).slice(0, 200), reference);
    throw new UserError('We could not start the payment. Nothing was charged. Please try again in a moment.', { code: 'payment_init_failed' });
  }
}

// Apply a verified provider result to our records. Idempotent: safe to call many times for the same payment.
function applyPaymentResult(reference, data) {
  return tx(() => {
    const p = q.get('SELECT * FROM payments WHERE reference=?', reference);
    if (!p) return { ok: false, reason: 'unknown_reference' };
    const o = q.get('SELECT * FROM orders WHERE id=?', p.order_id);
    if (p.status === 'success') return { ok: true, already: true, order: o };
    const st = String(data.status || '').toLowerCase();
    if (st === 'success') {
      if (Number(data.amount) !== p.amount_minor || String(data.currency || '').toUpperCase() !== p.currency) {
        q.run("UPDATE payments SET status='failed', gateway_response='REVIEW: amount or currency mismatch', provider_txn_id=?, updated_at=datetime('now') WHERE id=?", String(data.id ?? ''), p.id);
        q.run("UPDATE orders SET admin_notes=admin_notes||?, updated_at=datetime('now') WHERE id=?", `\n[${new Date().toISOString()}] REVIEW: provider reported success for ${reference} but amount/currency did not match. Order NOT marked paid.`, o.id);
        return { ok: false, reason: 'mismatch', order: o };
      }
      q.run("UPDATE payments SET status='success', provider_txn_id=?, gateway_response=?, paid_at=datetime('now'), updated_at=datetime('now') WHERE id=?", String(data.id ?? ''), String(data.gateway_response || 'success').slice(0, 200), p.id);
      if (o.payment_status === 'paid') {
        q.run("UPDATE orders SET admin_notes=admin_notes||?, updated_at=datetime('now') WHERE id=?", `\n[${new Date().toISOString()}] REVIEW: second successful payment ${reference} received for an already-paid order. Consider refunding it.`, o.id);
        return { ok: true, duplicatePayment: true, order: o };
      }
      if (o.status === 'cancelled') {
        q.run("UPDATE orders SET payment_status='paid', admin_notes=admin_notes||?, updated_at=datetime('now') WHERE id=?", `\n[${new Date().toISOString()}] REVIEW: payment arrived for a cancelled order.`, o.id);
        return { ok: true, order: byReference(o.reference) };
      }
      q.run("UPDATE orders SET status='confirmed', payment_status='paid', fulfillment_status='awaiting_supplier', updated_at=datetime('now') WHERE id=?", o.id);
      for (const it of items(o.id)) if (it.variant_id) q.run('UPDATE variants SET stock_qty=MAX(stock_qty-?,0) WHERE id=? AND stock_qty IS NOT NULL', it.quantity, it.variant_id);
      return { ok: true, order: byReference(o.reference) };
    }
    if (st === 'failed' || st === 'abandoned' || st === 'reversed') {
      const ps = st === 'abandoned' ? 'abandoned' : 'failed';
      q.run("UPDATE payments SET status=?, gateway_response=?, updated_at=datetime('now') WHERE id=?", ps, String(data.gateway_response || st).slice(0, 200), p.id);
      if (o.payment_status !== 'paid') q.run("UPDATE orders SET payment_status=?, updated_at=datetime('now') WHERE id=?", ps, o.id);
      return { ok: false, reason: ps, order: byReference(o.reference) };
    }
    return { ok: false, reason: 'pending', order: o };
  });
}
// Webhook: signature must already be verified by the caller. Deduplicated by event key.
function handleWebhook(evt) {
  const type = String(evt?.event || '');
  const d = evt?.data || {};
  if (!d.reference) return { handled: false };
  const key = `${type}:${d.id ?? d.reference}`;
  const fresh = q.run('INSERT OR IGNORE INTO payment_events(event_key,provider,type,reference) VALUES(?,?,?,?)', key, 'paystack', type, String(d.reference)).changes > 0;
  if (!fresh) return { handled: true, duplicate: true };
  if (type === 'charge.success') return { handled: true, ...applyPaymentResult(d.reference, { ...d, status: 'success' }) };
  return { handled: false };
}

const STATUS_TEXT = {
  pending_payment: 'We have received your order details. It will be confirmed once payment is verified.',
  paid: 'Payment confirmed. Your order is awaiting processing.',
  awaiting_supplier: 'Payment confirmed. Your order is waiting to be processed.',
  supplier_submitted: 'Your order has been passed on for fulfilment.',
  processing: 'Your order is being prepared.',
  shipped: 'Your order has been dispatched.',
  delivered: 'Your order has been marked as delivered.',
  cancelled: 'This order has been cancelled.',
};
function customerStatus(o) {
  if (o.status === 'cancelled') return STATUS_TEXT.cancelled;
  if (o.payment_status === 'failed') return 'The payment did not go through. No order has been confirmed. You can try paying again.';
  if (o.payment_status === 'abandoned') return 'The payment was not completed. You can try paying again.';
  if (o.payment_status !== 'paid') return o.payment_status === 'pending' ? 'Waiting for payment confirmation from the payment provider.' : STATUS_TEXT.pending_payment;
  return STATUS_TEXT[o.fulfillment_status] || STATUS_TEXT.paid;
}
module.exports = { createOrder, byReference, items, startPayment, applyPaymentResult, handleWebhook, accessToken, tokenOk, customerStatus, newReference };
