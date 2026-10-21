'use strict';
const cfg = require('./config');
const { q, tx } = require('./db');
const { UserError } = require('./errors');
const { rand } = require('./security');
const MAX_QTY = 20;

function ensureCart(token) {
  if (token && /^[A-Za-z0-9_-]{20,64}$/.test(token) && q.get('SELECT 1 x FROM carts WHERE token=?', token)) return token;
  const t = rand(24);
  q.run('INSERT INTO carts(token) VALUES(?)', t);
  return t;
}
function problemFor(r) {
  if (r.status !== 'published' || r.product_availability === 'discontinued') return 'This product is no longer available.';
  if (r.product_availability === 'temporarily_unavailable') return 'This product is temporarily unavailable.';
  if (r.is_development && !cfg.allowDevProducts) return 'This is a sample product and cannot be ordered.';
  if (r.availability === 'unavailable') return 'This option is currently unavailable.';
  if (r.availability !== 'available') return 'Availability for this option has not been verified yet.';
  if (r.stock_qty != null && r.stock_qty < r.quantity) return r.stock_qty === 0 ? 'This option is out of stock.' : `Only ${r.stock_qty} left. Please reduce the quantity.`;
  return null;
}
// Live lines: prices always come from the database, never from the browser.
function lines(token) {
  return q.all(`SELECT ci.variant_id, ci.quantity, v.sku, v.label variant_label, v.options_json, v.price_minor, v.availability, v.stock_qty,
      p.id product_id, p.slug, p.name, p.status, p.availability product_availability, p.is_development, p.currency,
      CASE WHEN p.card_image_url<>'' AND p.card_image_status<>'broken' THEN p.card_image_url ELSE (SELECT url FROM product_images i WHERE i.product_id=p.id AND i.status<>'broken' ORDER BY sort_order,id LIMIT 1) END image, (SELECT slug FROM categories c WHERE c.id=p.category_id) category_slug
    FROM cart_items ci JOIN variants v ON v.id=ci.variant_id JOIN products p ON p.id=v.product_id WHERE ci.cart_token=? ORDER BY ci.rowid`, token)
    .map((r) => ({ ...r, line_total: r.price_minor * r.quantity, problem: problemFor(r) }));
}
const count = (token) => (token ? (q.get('SELECT COALESCE(SUM(quantity),0) n FROM cart_items WHERE cart_token=?', token).n) : 0);
function parseQty(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_QTY) throw new UserError(`Please choose a quantity between 1 and ${MAX_QTY}.`);
  return n;
}
function add(token, variantId, qty) {
  const n = parseQty(qty);
  const vid = Number(variantId);
  if (!Number.isInteger(vid)) throw new UserError('Please choose a product option.');
  return tx(() => {
    const r = q.get(`SELECT v.id, v.availability, v.stock_qty, p.status, p.availability product_availability, p.is_development, p.currency FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=?`, vid);
    if (!r) throw new UserError('That product option could not be found.');
    const have = q.get('SELECT quantity FROM cart_items WHERE cart_token=? AND variant_id=?', token, vid)?.quantity || 0;
    const total = Math.min(have + n, MAX_QTY);
    const prob = problemFor({ ...r, quantity: total });
    if (prob) throw new UserError(prob);
    q.run(`INSERT INTO cart_items(cart_token,variant_id,quantity) VALUES(?,?,?) ON CONFLICT(cart_token,variant_id) DO UPDATE SET quantity=excluded.quantity`, token, vid, total);
    q.run("UPDATE carts SET updated_at=datetime('now') WHERE token=?", token);
  });
}
function setQty(token, variantId, qty) {
  const n = parseQty(qty);
  const r = q.run('UPDATE cart_items SET quantity=? WHERE cart_token=? AND variant_id=?', n, token, Number(variantId));
  if (!r.changes) throw new UserError('That item is not in your cart.');
}
const remove = (token, variantId) => q.run('DELETE FROM cart_items WHERE cart_token=? AND variant_id=?', token, Number(variantId));
const clear = (token) => q.run('DELETE FROM cart_items WHERE cart_token=?', token);
function totals(ls, deliveryFee = 0, discount = 0) {
  const subtotal = ls.reduce((s, l) => s + l.price_minor * l.quantity, 0);
  return { subtotal, delivery: deliveryFee, discount, total: subtotal + deliveryFee - discount };
}
module.exports = { ensureCart, lines, count, add, setQty, remove, clear, totals, MAX_QTY };
