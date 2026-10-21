'use strict';
// Order workflow for a self-sourcing store: the owner buys EXACTLY what the customer ordered, after the order is placed.
// Three separate states are kept on every order:
//   status:             pending_review -> awaiting_payment -> confirmed | cancelled
//   payment_status:     unpaid | pending | paid | failed | abandoned | refund_pending | refunded   (paid ONLY after gateway verification)
//   fulfillment_status: not_started -> sourcing -> products_secured -> preparing -> ready_for_dispatch -> out_for_delivery -> delivered | cancelled
// Each order line also has an item_status used while sourcing. Nothing is ever substituted automatically.
const crypto = require('crypto');
const cfg = require('./config');
const { q, tx, appSecret } = require('./db');
const cart = require('./cart');
const { UserError } = require('./errors');
const paystack = require('./payments/paystack');
const settings = require('./settings');
const notify = require('./notify');
const money = require('./money');
const dd = require('./delivery-date');

const LABEL = {
  status: { pending_review: 'Pending review', awaiting_payment: 'Awaiting payment', confirmed: 'Order confirmed', cancelled: 'Cancelled' },
  payment: { unpaid: 'Not paid', pending: 'Payment in progress', paid: 'Payment confirmed', failed: 'Payment failed', abandoned: 'Payment not completed', refund_pending: 'Refund pending', refunded: 'Refunded' },
  fulfil: { not_started: 'Not started', sourcing: 'Sourcing products', products_secured: 'Products secured', preparing: 'Preparing for delivery', ready_for_dispatch: 'Ready for dispatch', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' },
  item: { pending: 'Not yet checked', available: 'Available in market', secured: 'Secured (bought)', unavailable: 'Unavailable: needs customer decision', removed: 'Removed with customer approval' },
};
const STAGES = ['not_started', 'sourcing', 'products_secured', 'preparing', 'ready_for_dispatch', 'out_for_delivery', 'delivered'];
const NEEDS_ALL_SECURED = new Set(['products_secured', 'preparing', 'ready_for_dispatch', 'out_for_delivery', 'delivered']);

const newReference = () => `NX-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
// Guest access token is derived from the reference with a server-side secret, so it can be recomputed but not guessed.
const accessToken = (reference) => crypto.createHmac('sha256', appSecret()).update(reference).digest('base64url').slice(0, 32);
const tokenOk = (reference, t) => { const a = Buffer.from(accessToken(reference)), b = Buffer.from(String(t || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const orderLink = (o) => `${cfg.siteUrl}/order/${o.reference}?t=${accessToken(o.reference)}`;
const byReference = (ref) => q.get('SELECT * FROM orders WHERE reference=?', ref);
const byId = (id) => q.get('SELECT * FROM orders WHERE id=?', id);
const items = (orderId) => q.all('SELECT * FROM order_items WHERE order_id=? ORDER BY id', orderId);
const activeItems = (orderId) => items(orderId).filter((i) => i.item_status !== 'removed');
const events = (orderId, customerOnly = false) => q.all(`SELECT * FROM order_events WHERE order_id=? ${customerOnly ? 'AND customer_visible=1' : ''} ORDER BY id`, orderId);
const amountPaid = (orderId) => q.get("SELECT COALESCE(SUM(amount_minor),0) n FROM payments WHERE order_id=? AND status='success'", orderId).n;
const fmt = (o, minor) => money.format(minor, o.currency);
function logEvent(orderId, kind, body, customerVisible = false, actor = 'system') {
  q.run('INSERT INTO order_events(order_id,kind,body,customer_visible,actor) VALUES(?,?,?,?,?)', orderId, kind, String(body).slice(0, 2000), customerVisible ? 1 : 0, actor);
}
const nowSql = () => new Date().toISOString().replace('T', ' ').slice(0, 19); // same format as SQLite datetime('now') (UTC)

// ---------- notifications (never block or undo an order change) ----------
function summaryLines(o) {
  return activeItems(o.id).map((i) => `- ${i.product_name} (${i.variant_label}) x ${i.quantity}: ${fmt(o, i.line_total_minor)}`).join('\n') + `\nDelivery (${o.delivery_zone_name}): ${fmt(o, o.delivery_fee_minor)}\nTotal: ${fmt(o, o.total_minor)}`;
}
async function emailCustomer(o, subject, lines) {
  try { return await notify.send({ orderId: o.id, to: o.customer_email, subject: `${subject} (${o.reference})`, lines, link: { href: orderLink(o), text: 'View your order' } }); } catch { return { status: 'failed' }; }
}
async function emailOwner(o, subject, lines) {
  const to = settings.ownerEmail(); if (!to) return { status: 'skipped' };
  try { return await notify.send({ orderId: o.id, to, subject: `${subject} (${o.reference})`, lines: [...lines, `Admin: ${cfg.siteUrl}/admin/orders/${o.reference}`] }); } catch { return { status: 'failed' }; }
}

// ---------- create ----------
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
    const method = f.payment_method === 'demo' ? 'demo' : 'paystack';
    if (method === 'demo' && !cfg.demoMode) throw new UserError('Demonstration orders are switched off on this store.');
    const hasDev = ls.some((l) => l.is_development);
    // A demo order is any order placed with demo products, unconfirmed delivery, or the demo payment method. It can never become "paid".
    const isDemo = hasDev || method === 'demo' || (!zone.confirmed && cfg.demoMode) ? 1 : 0;
    const timing = settings.paymentTiming();
    const status = timing === 'review_first' ? 'pending_review' : 'awaiting_payment';
    const reference = newReference();
    const r = q.run(`INSERT INTO orders(reference,checkout_key,status,customer_name,customer_email,customer_phone,ship_address,ship_city,ship_state,ship_country,ship_postal,delivery_notes,
        currency,subtotal_minor,delivery_fee_minor,discount_minor,total_minor,delivery_zone_name,delivery_confirmed,has_development_items,is_demo,payment_method,payment_timing,payment_requested_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      reference, checkoutKey, status, f.name, f.email, f.phone, f.address, f.city, f.state, zone.country_code, f.postal, f.notes,
      ls[0].currency, t.subtotal, t.delivery, t.discount, t.total, zone.name, zone.confirmed, hasDev ? 1 : 0, isDemo, method, timing, timing === 'pay_first' ? nowSql() : null);
    const oid = Number(r.lastInsertRowid);
    for (const l of ls) {
      // Exact snapshot of what the customer chose: name, option, SKU, price, quantity, image and option values.
      q.run('INSERT INTO order_items(order_id,variant_id,product_name,variant_label,sku,unit_price_minor,quantity,line_total_minor,image_url,options_json) VALUES(?,?,?,?,?,?,?,?,?,?)',
        oid, l.variant_id, l.name, l.variant_label, l.sku, l.price_minor, l.quantity, l.line_total, l.image || '', l.options_json || '{}');
    }
    logEvent(oid, 'created', timing === 'review_first'
      ? 'Order received. We are checking that your exact items are available before asking you to pay. You have not been charged.'
      : 'Order received. Please complete payment to confirm it.', true, 'customer');
    cart.clear(cartToken);
    return { order: byId(oid), duplicate: false };
  });
}
async function afterCreate(o) {
  const review = o.status === 'pending_review';
  await emailCustomer(o, 'We received your order', [`Hello ${o.customer_name},`, review ? 'Thank you for your order. We will check that your exact items are available and then send you a link to pay. You have not been charged yet.' : 'Thank you for your order. Please complete payment to confirm it.', summaryLines(o), `Estimated delivery: ${settings.deliveryDays()} calendar days after your order is confirmed (confirmation happens when your payment is verified).`]);
  await emailOwner(o, 'New order', [`${o.customer_name}, ${o.customer_phone}, ${o.customer_email}`, summaryLines(o), review ? 'Action: check availability of the exact items, then request payment.' : 'Waiting for the customer\'s payment.', o.is_demo ? 'DEMO order: do not source.' : '']);
}

// ---------- payment ----------
function canPay(o) { return o.payment_method === 'paystack' && o.status === 'awaiting_payment' && !['paid', 'refund_pending', 'refunded'].includes(o.payment_status); }
async function startPayment(order) {
  if (order.payment_method === 'demo') throw new UserError('This is a demonstration order. No payment can be taken for it.');
  if (order.status === 'pending_review') throw new UserError('We are still checking that your exact items are available. We will send you a payment link as soon as they are confirmed. You have not been charged.');
  if (order.status === 'cancelled') throw new UserError('This order has been cancelled, so it cannot be paid.');
  if (['paid', 'refund_pending', 'refunded'].includes(order.payment_status)) throw new UserError('This order has already been paid.');
  if (!paystack.isConfigured()) throw new UserError('Online payment is not switched on for this store yet. Your order has been saved and no money has been taken.', { code: 'payment_unconfigured' });
  const n = q.get('SELECT COUNT(*) n FROM payments WHERE order_id=?', order.id).n + 1;
  const reference = `${order.reference}-P${n}-${crypto.randomBytes(8).toString('hex')}`; // high-entropy: the payment return page uses it to find the order
  q.run('INSERT INTO payments(order_id,provider,reference,amount_minor,currency,status) VALUES(?,?,?,?,?,?)', order.id, 'paystack', reference, order.total_minor, order.currency, 'initiated');
  try {
    const data = await paystack.initialize({ email: order.customer_email, amountMinor: order.total_minor, currency: order.currency, reference,
      callbackUrl: `${cfg.siteUrl}/payment/callback`, metadata: { order_reference: order.reference } });
    q.run("UPDATE payments SET status='pending', updated_at=datetime('now') WHERE reference=?", reference);
    q.run("UPDATE orders SET payment_status='pending', updated_at=datetime('now') WHERE id=? AND payment_status NOT IN('paid','refund_pending','refunded')", order.id);
    return data.authorization_url;
  } catch (err) {
    q.run("UPDATE payments SET status='failed', gateway_response=?, updated_at=datetime('now') WHERE reference=?", String(err.message).slice(0, 200), reference);
    throw new UserError('We could not start the payment. Nothing was charged. Please try again in a moment.', { code: 'payment_init_failed' });
  }
}
// The single confirmation rule: an order becomes "confirmed" when its payment is verified by the gateway
// (or, for demonstration orders only, when the demo payment step is completed). The delivery estimate starts here.
function confirmNow(o, actor) {
  const at = nowSql(); const est = dd.estimate(at, settings.deliveryDays());
  q.run("UPDATE orders SET status='confirmed', confirmed_at=?, estimated_delivery_date=?, original_estimated_delivery_date=?, updated_at=datetime('now') WHERE id=?", at, est, est, o.id);
  logEvent(o.id, 'confirmed', `Order confirmed. Estimated delivery: ${dd.formatDate(est)} (${settings.deliveryDays()} calendar days after confirmation). We will now source your exact items.`, true, actor);
}
// Apply a verified provider result to our records. Idempotent: safe to call many times for the same payment.
function applyPaymentResult(reference, data) {
  return tx(() => {
    const p = q.get('SELECT * FROM payments WHERE reference=?', reference);
    if (!p) return { ok: false, reason: 'unknown_reference' };
    const o = byId(p.order_id);
    if (p.status === 'success') return { ok: true, already: true, order: o };
    const st = String(data.status || '').toLowerCase();
    if (st === 'success') {
      if (Number(data.amount) !== p.amount_minor || String(data.currency || '').toUpperCase() !== p.currency) {
        q.run("UPDATE payments SET status='failed', gateway_response='REVIEW: amount or currency mismatch', provider_txn_id=?, updated_at=datetime('now') WHERE id=?", String(data.id ?? ''), p.id);
        q.run("UPDATE orders SET needs_attention=1, attention_reason=?, admin_notes=admin_notes||?, updated_at=datetime('now') WHERE id=?", 'Payment amount/currency mismatch: check in Paystack', `\n[${new Date().toISOString()}] REVIEW: provider reported success for ${reference} but amount/currency did not match. Order NOT marked paid.`, o.id);
        return { ok: false, reason: 'mismatch', order: o };
      }
      q.run("UPDATE payments SET status='success', provider_txn_id=?, gateway_response=?, paid_at=datetime('now'), updated_at=datetime('now') WHERE id=?", String(data.id ?? ''), String(data.gateway_response || 'success').slice(0, 200), p.id);
      if (['paid', 'refund_pending', 'refunded'].includes(o.payment_status)) {
        q.run("UPDATE orders SET needs_attention=1, attention_reason='Second payment received: refund it', admin_notes=admin_notes||?, updated_at=datetime('now') WHERE id=?", `\n[${new Date().toISOString()}] REVIEW: second successful payment ${reference} received for an already-paid order. Refund it in Paystack.`, o.id);
        return { ok: true, duplicatePayment: true, order: o };
      }
      if (o.status === 'cancelled') {
        q.run("UPDATE orders SET payment_status='refund_pending', refund_due_minor=?, needs_attention=1, attention_reason='Payment arrived for a cancelled order: refund it', updated_at=datetime('now') WHERE id=?", p.amount_minor, o.id);
        logEvent(o.id, 'payment', 'A payment was received for this cancelled order. It will be refunded.', true);
        return { ok: true, order: byId(o.id) };
      }
      q.run("UPDATE orders SET payment_status='paid', updated_at=datetime('now') WHERE id=?", o.id);
      logEvent(o.id, 'payment', `Payment of ${fmt(o, p.amount_minor)} verified by Paystack.`, true);
      if (o.status === 'pending_review') q.run("UPDATE orders SET needs_attention=1, attention_reason='Paid before availability review: check items now' WHERE id=?", o.id);
      if (o.status !== 'confirmed') confirmNow(o, 'system');
      for (const it of activeItems(o.id)) if (it.variant_id) q.run('UPDATE variants SET stock_qty=MAX(stock_qty-?,0) WHERE id=? AND stock_qty IS NOT NULL', it.quantity, it.variant_id);
      return { ok: true, confirmedNow: true, order: byId(o.id) };
    }
    if (st === 'failed' || st === 'abandoned' || st === 'reversed') {
      const ps = st === 'abandoned' ? 'abandoned' : 'failed';
      q.run("UPDATE payments SET status=?, gateway_response=?, updated_at=datetime('now') WHERE id=?", ps, String(data.gateway_response || st).slice(0, 200), p.id);
      if (!['paid', 'refund_pending', 'refunded'].includes(o.payment_status)) q.run("UPDATE orders SET payment_status=?, updated_at=datetime('now') WHERE id=?", ps, o.id);
      return { ok: false, reason: ps, order: byId(o.id) };
    }
    return { ok: false, reason: 'pending', order: o };
  });
}
async function afterPayment(result) {
  if (!result?.confirmedNow) return;
  const o = result.order;
  await emailCustomer(o, 'Order confirmed', [`Hello ${o.customer_name},`, 'Your payment has been verified and your order is confirmed. We will now source exactly the items you ordered.', summaryLines(o), `Estimated delivery: ${dd.formatDate(o.estimated_delivery_date)}. This is an estimate; we will tell you if anything changes.`]);
  await emailOwner(o, 'Payment confirmed: start sourcing', [summaryLines(o), `Estimated delivery promised: ${dd.formatDate(o.estimated_delivery_date)}`]);
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
// Demonstration payment step: confirms a DEMO order so the full workflow (incl. delivery estimate) can be shown.
// It NEVER sets payment_status to paid and never reduces stock.
function confirmDemo(order) {
  if (!cfg.demoMode) throw new UserError('Demonstration orders are switched off on this store.');
  if (!order.is_demo || order.payment_method !== 'demo') throw new UserError('Only demonstration orders can be confirmed this way.');
  if (order.status === 'cancelled') throw new UserError('This order has been cancelled.');
  if (order.status === 'pending_review') throw new UserError('This demonstration order is still pending review. The store owner must confirm availability first.');
  tx(() => {
    const o = byId(order.id);
    if (o.status !== 'awaiting_payment' || o.payment_status !== 'unpaid') return;
    q.run("UPDATE orders SET demo_confirmed_at=datetime('now') WHERE id=?", o.id);
    confirmNow(o, 'customer (demo)');
  });
  return byId(order.id);
}

// ---------- owner actions (called from the protected admin area only) ----------
function requireOpen(o) { if (o.status === 'cancelled') throw new UserError('This order has been cancelled.'); }
function refreshAttention(orderId) {
  const bad = activeItems(orderId).filter((i) => i.item_status === 'unavailable');
  if (bad.length) q.run("UPDATE orders SET needs_attention=1, attention_reason=?, updated_at=datetime('now') WHERE id=?", `Exact item unavailable: ${bad.map((i) => i.product_name + ' (' + i.variant_label + ')').join(', ')}. Contact the customer for approval before changing anything.`, orderId);
  else q.run("UPDATE orders SET needs_attention=0, attention_reason='', updated_at=datetime('now') WHERE id=? AND attention_reason LIKE 'Exact item unavailable:%'", orderId);
}
async function requestPayment(o, actor) {
  requireOpen(o);
  if (o.status !== 'pending_review') throw new UserError('Payment can only be requested for an order that is pending review.');
  const its = activeItems(o.id);
  const unchecked = its.filter((i) => !['available', 'secured'].includes(i.item_status));
  if (unchecked.length) throw new UserError(`Mark every item as "Available in market" (or secured) before requesting payment. Still to check: ${unchecked.map((i) => i.product_name).join(', ')}.`);
  q.run("UPDATE orders SET status='awaiting_payment', payment_requested_at=datetime('now'), updated_at=datetime('now') WHERE id=? AND status='pending_review'", o.id);
  logEvent(o.id, 'payment_request', 'Good news: your exact items are available. Please complete payment to confirm your order.', true, actor);
  const fresh = byId(o.id);
  await emailCustomer(fresh, 'Your items are available: please pay to confirm', [`Hello ${o.customer_name},`, 'We have checked and the exact items you ordered are available. Please use the button below to pay securely and confirm your order.', summaryLines(fresh), `Once your payment is verified, estimated delivery is ${settings.deliveryDays()} calendar days later.`]);
  return fresh;
}
function setItemStatus(o, itemId, status, note, actor) {
  requireOpen(o);
  if (!['pending', 'available', 'secured', 'unavailable'].includes(status)) throw new UserError('Invalid item status.');
  const it = q.get('SELECT * FROM order_items WHERE id=? AND order_id=?', Number(itemId), o.id);
  if (!it) throw new UserError('Item not found on this order.');
  if (it.item_status === 'removed') throw new UserError('This item was removed from the order.');
  tx(() => {
    q.run('UPDATE order_items SET item_status=?, item_note=? WHERE id=?', status, String(note || '').trim().slice(0, 300), it.id);
    logEvent(o.id, 'item', `${it.product_name} (${it.variant_label}): ${LABEL.item[it.item_status]} -> ${LABEL.item[status]}${note ? '. ' + note : ''}`, false, actor);
    if (status === 'unavailable' && it.item_status !== 'unavailable') logEvent(o.id, 'attention', `We could not yet obtain "${it.product_name} (${it.variant_label})" exactly as you ordered it. We will contact you. Nothing will be substituted or changed without your approval.`, true, actor);
    refreshAttention(o.id);
  });
  return byId(o.id);
}
// Remove one line ONLY with the customer's recorded approval. Totals are recalculated; a refund is recorded if already paid.
function removeItemWithApproval(o, itemId, approval, actor) {
  requireOpen(o);
  const note = String(approval || '').trim().slice(0, 300);
  if (note.length < 5) throw new UserError('Record how and when the customer approved this change (for example "Customer approved by WhatsApp, 21 Oct").');
  const it = q.get('SELECT * FROM order_items WHERE id=? AND order_id=?', Number(itemId), o.id);
  if (!it || it.item_status === 'removed') throw new UserError('Item not found on this order.');
  if (activeItems(o.id).length < 2) throw new UserError('This is the only item on the order. Cancel the order instead (with the customer\'s agreement).');
  if (['out_for_delivery', 'delivered'].includes(o.fulfillment_status)) throw new UserError('This order is already out for delivery.');
  tx(() => {
    q.run("UPDATE order_items SET item_status='removed', item_note=? WHERE id=?", `Customer approval: ${note}`, it.id);
    const sub = activeItems(o.id).reduce((s, i) => s + i.line_total_minor, 0);
    const paid = ['paid', 'refund_pending'].includes(o.payment_status);
    q.run("UPDATE orders SET subtotal_minor=?, total_minor=?+delivery_fee_minor-discount_minor, refund_due_minor=refund_due_minor+?, updated_at=datetime('now') WHERE id=?", sub, sub, paid ? it.line_total_minor : 0, o.id);
    const n = byId(o.id);
    logEvent(o.id, 'change', `With your approval (${note}), "${it.product_name} (${it.variant_label}) x ${it.quantity}" was removed from your order. New total: ${fmt(n, n.total_minor)}.${paid ? ` A refund of ${fmt(n, it.line_total_minor)} is due to you.` : ''}`, true, actor);
    refreshAttention(o.id);
  });
  return byId(o.id);
}
function setFulfilment(o, to, note, actor) {
  requireOpen(o);
  if (o.status !== 'confirmed') throw new UserError('Fulfilment can start only after the order is confirmed (payment verified).');
  const from = STAGES.indexOf(o.fulfillment_status), target = STAGES.indexOf(to);
  if (target < 0) throw new UserError('Invalid fulfilment status.');
  if (target <= from) throw new UserError('Fulfilment can only move forward.');
  if (o.needs_attention && target > STAGES.indexOf('sourcing')) throw new UserError('Resolve the issue flagged on this order first (see "Needs attention").');
  if (NEEDS_ALL_SECURED.has(to)) {
    const left = activeItems(o.id).filter((i) => i.item_status !== 'secured');
    if (left.length) throw new UserError(`Mark every item as "Secured (bought)" first. Not yet secured: ${left.map((i) => i.product_name).join(', ')}.`);
  }
  q.run("UPDATE orders SET fulfillment_status=?, updated_at=datetime('now') WHERE id=?", to, o.id);
  logEvent(o.id, 'fulfilment', `${LABEL.fulfil[to]}${note ? '. ' + note : ''}`, true, actor);
  return byId(o.id);
}
function cancelOrder(o, reason, customerInformed, actor) {
  if (o.status === 'cancelled') throw new UserError('This order is already cancelled.');
  if (o.fulfillment_status === 'delivered') throw new UserError('Delivered orders cannot be cancelled.');
  const why = String(reason || '').trim().slice(0, 300);
  if (why.length < 5) throw new UserError('Give a short reason for the cancellation (it is shown to the customer).');
  // Money still held = current total + any refund already owed (covers earlier partial refunds after an approved item removal).
  const paidStates = ['paid', 'refund_pending'];
  const paid = paidStates.includes(o.payment_status) ? o.total_minor + o.refund_due_minor : 0;
  if (paid > 0 && !customerInformed) throw new UserError('This order has been paid. Tick the box to confirm the customer has been told and agrees, then process the refund.');
  tx(() => {
    q.run("UPDATE orders SET status='cancelled', fulfillment_status='cancelled', cancel_reason=?, needs_attention=?, attention_reason=?, payment_status=CASE WHEN payment_status IN('paid') THEN 'refund_pending' ELSE payment_status END, refund_due_minor=?, updated_at=datetime('now') WHERE id=?",
      why, paid > 0 ? 1 : 0, paid > 0 ? 'Refund due: refund it in Paystack, then mark it refunded here' : '', paid > 0 ? paid : o.refund_due_minor, o.id);
    logEvent(o.id, 'cancelled', `Order cancelled: ${why}.${paid > 0 ? ` A refund of ${fmt(o, paid)} will be made to your original payment method.` : ' You were not charged.'}`, true, actor);
  });
  return byId(o.id);
}
function markRefunded(o, refundRef, actor) {
  const ref = String(refundRef || '').trim().slice(0, 120);
  if (ref.length < 3) throw new UserError('Enter the refund reference from your Paystack dashboard.');
  if (!(o.payment_status === 'refund_pending' || o.refund_due_minor > 0)) throw new UserError('No refund is due on this order.');
  const amount = o.refund_due_minor;
  tx(() => {
    q.run("UPDATE orders SET payment_status=CASE WHEN payment_status='refund_pending' THEN 'refunded' ELSE payment_status END, refund_due_minor=0, needs_attention=CASE WHEN attention_reason LIKE 'Refund due%' OR attention_reason LIKE 'Payment arrived%' THEN 0 ELSE needs_attention END, attention_reason=CASE WHEN attention_reason LIKE 'Refund due%' OR attention_reason LIKE 'Payment arrived%' THEN '' ELSE attention_reason END, updated_at=datetime('now') WHERE id=?", o.id);
    logEvent(o.id, 'refund', `Refund of ${fmt(o, amount)} processed (reference ${ref}). It can take a few working days to reach your account.`, true, actor);
  });
  return byId(o.id);
}
function reviseEstimate(o, ymd, reason, actor) {
  requireOpen(o);
  if (o.status !== 'confirmed' || !o.estimated_delivery_date) throw new UserError('The estimate can be revised only on a confirmed order.');
  if (!dd.isYmd(ymd)) throw new UserError('Choose a valid date.');
  if (ymd < dd.localDate(o.confirmed_at)) throw new UserError('The new estimate cannot be before the confirmation date.');
  const why = String(reason || '').trim().slice(0, 300); if (why.length < 5) throw new UserError('Explain the reason for the change (it is shown to the customer).');
  if (ymd === o.estimated_delivery_date) throw new UserError('That is already the current estimate.');
  q.run("UPDATE orders SET estimated_delivery_date=?, updated_at=datetime('now') WHERE id=?", ymd, o.id);
  logEvent(o.id, 'estimate', `Estimated delivery updated from ${dd.formatDate(o.estimated_delivery_date)} to ${dd.formatDate(ymd)}: ${why}`, true, actor);
  return byId(o.id);
}
function setAttention(o, on, reason, actor) {
  const r = String(reason || '').trim().slice(0, 300);
  if (on && r.length < 3) throw new UserError('Say what needs attention.');
  if (!on && activeItems(o.id).some((i) => i.item_status === 'unavailable')) throw new UserError('An item is still marked unavailable. Mark it found, or remove it with the customer\'s approval, first.');
  q.run("UPDATE orders SET needs_attention=?, attention_reason=?, updated_at=datetime('now') WHERE id=?", on ? 1 : 0, on ? r : '', o.id);
  logEvent(o.id, 'attention', on ? `Flagged: ${r}` : 'Attention flag cleared.', false, actor);
  return byId(o.id);
}
async function messageCustomer(o, text, actor) {
  const body = String(text || '').trim().slice(0, 2000);
  if (body.length < 3) throw new UserError('Write a message first.');
  logEvent(o.id, 'message', body, true, actor);
  return emailCustomer(o, 'An update about your order', [`Hello ${o.customer_name},`, body]);
}
async function notifyLatest(o, subject) { const e = events(o.id, true).pop(); if (e) await emailCustomer(o, subject, [`Hello ${o.customer_name},`, e.body]); }

// Find an order from reference + email (guest "track my order"). Returns null when they don't match.
function lookup(reference, email) {
  const o = byReference(String(reference || '').trim().toUpperCase().slice(0, 40));
  if (!o) return null;
  const a = Buffer.from(o.customer_email), b = Buffer.from(String(email || '').trim().toLowerCase());
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? o : null;
}
const FULFIL_TEXT = {
  not_started: 'Payment confirmed. We are about to start sourcing your exact items.',
  sourcing: 'We are sourcing the exact items you ordered.',
  products_secured: 'All your items have been secured.',
  preparing: 'Your order is being prepared for delivery.',
  ready_for_dispatch: 'Your order is ready for dispatch.',
  out_for_delivery: 'Your order is out for delivery.',
  delivered: 'Your order has been delivered.',
};
function customerStatus(o) {
  if (o.status === 'cancelled') return `This order has been cancelled${o.cancel_reason ? `: ${o.cancel_reason}` : '.'}${o.payment_status === 'refund_pending' ? ' Your refund is being processed.' : o.payment_status === 'refunded' ? ' Your refund has been processed.' : ''}`;
  if (o.payment_method === 'demo') {
    if (o.status === 'pending_review') return 'Demonstration order received. In the real workflow the store owner now checks the exact items in the market before asking for payment.';
    if (o.status === 'awaiting_payment') return 'Demonstration: items confirmed available. Complete the demonstration payment below (no money is taken).';
    return `Demonstration order confirmed. No payment was taken and nothing will be delivered. ${FULFIL_TEXT[o.fulfillment_status] || ''}`.trim();
  }
  if (o.status === 'pending_review') return 'Order received. We are checking that your exact items are available. We will send you a payment link once they are confirmed. You have not been charged.';
  if (o.status === 'awaiting_payment') {
    if (o.payment_status === 'failed') return 'The payment did not go through. Your order is not confirmed yet. You can try paying again.';
    if (o.payment_status === 'abandoned') return 'The payment was not completed. You can try paying again.';
    if (o.payment_status === 'pending') return 'Waiting for payment confirmation from the payment provider.';
    return o.payment_timing === 'review_first' ? 'Your exact items are available. Please complete payment to confirm your order.' : 'Please complete payment to confirm your order.';
  }
  return FULFIL_TEXT[o.fulfillment_status] || 'Order confirmed.';
}
module.exports = {
  LABEL, STAGES, createOrder, afterCreate, byReference, byId, items, activeItems, events, amountPaid, canPay, startPayment, applyPaymentResult, afterPayment, handleWebhook,
  accessToken, tokenOk, orderLink, customerStatus, newReference, confirmDemo, lookup, logEvent,
  requestPayment, setItemStatus, removeItemWithApproval, setFulfilment, cancelOrder, markRefunded, reviseEstimate, setAttention, messageCustomer, notifyLatest,
};
