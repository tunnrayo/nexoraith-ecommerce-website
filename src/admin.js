'use strict';
// Administration area. Every route except /admin/login requires a valid server-side session; every POST requires the session CSRF token.
const cfg = require('./config');
const { q, tx } = require('./db');
const { esc, rand, sha256, safeEqual, rateLimit, hashPassword, verifyPassword, cookie } = require('./security');
const { UserError } = require('./errors');
const { layout } = require('./views');
const money = require('./money');
const orders = require('./orders');
const cj = require('./suppliers/cj');
const paystack = require('./payments/paystack');
const fs = require('fs');
const path = require('path');
const { imageType } = require('./multipart');
const slugify = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKU = /^[A-Za-z0-9._-]{2,40}$/;
const AVAIL = ['available', 'unavailable', 'unverified'];

const SESSION_HOURS = 8;
const LABEL = {
  status: { pending_payment: 'Pending payment', confirmed: 'Confirmed', cancelled: 'Cancelled' },
  payment: { unpaid: 'Not paid', pending: 'Payment pending', paid: 'Paid', failed: 'Payment failed', abandoned: 'Payment abandoned', refunded: 'Refunded' },
  fulfil: { not_started: 'Not started', awaiting_supplier: 'Awaiting supplier processing', supplier_submitted: 'Supplier order submitted', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' },
};
const NEXT = { awaiting_supplier: ['supplier_submitted', 'processing', 'cancelled'], supplier_submitted: ['processing', 'shipped', 'cancelled'], processing: ['shipped', 'cancelled'], shipped: ['delivered'] };

function currentSession(ctx) {
  const t = ctx.cookies.nx_admin;
  if (!t) return null;
  const s = q.get(`SELECT s.*, u.email FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=?`, sha256(t));
  if (!s) return null;
  if (new Date(s.expires_at.replace(' ', 'T') + 'Z') < new Date()) { q.run('DELETE FROM admin_sessions WHERE token_hash=?', s.token_hash); return null; }
  return s;
}
const nav = (active) => `<nav class="admin-nav" aria-label="Admin">${[['', 'Dashboard'], ['orders', 'Orders'], ['products', 'Products'], ['categories', 'Categories'], ['delivery', 'Delivery'], ['inquiries', 'Inquiries'], ['supplier', 'Supplier sync']].map(([h, t]) => `<a href="/admin${h ? '/' + h : ''}"${active === h ? ' aria-current="page"' : ''}>${t}</a>`).join('')}
<form method="post" action="/admin/logout" class="inline">__CSRF__<button class="link-btn" type="submit">Log out</button></form></nav>`;
function page(ctx, s, active, title, inner) {
  const body = `<div class="wrap section"><h1>${esc(title)}</h1>${nav(active).replace('__CSRF__', `<input type="hidden" name="_csrf" value="${esc(s.csrf)}">`)}${inner}</div>`;
  return layout({ ...ctx, csrf: s.csrf }, { title: `Admin: ${title}`, body, noindex: true });
}
const csrf = (s) => `<input type="hidden" name="_csrf" value="${esc(s.csrf)}">`;
const when = (t) => esc(String(t || '').slice(0, 16));
const dt = (rows, cols) => rows.length ? `<div class="scroll"><table class="tbl"><thead><tr>${cols.map((c) => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="empty">Nothing here yet.</p>';

function register(route, h) {
  const guard = (fn) => async (ctx) => {
    const s = currentSession(ctx);
    if (!s) return h.redirect(ctx, '/admin/login');
    if (ctx.method === 'POST' && !safeEqual(ctx.body._csrf || '', s.csrf)) return h.send(ctx, 403, page(ctx, s, '', 'Forbidden', '<p class="alert">Security check failed. Go back, reload the page and try again.</p>'));
    try { return await fn(ctx, s); } catch (e) {
      if (e instanceof UserError) return h.redirect(ctx, ctx.back || '/admin', { type: 'error', text: e.message });
      throw e;
    }
  };

  route('GET', '/admin/login', (ctx) => {
    if (currentSession(ctx)) return h.redirect(ctx, '/admin');
    const noAdmin = !q.get('SELECT 1 x FROM admin_users LIMIT 1');
    h.send(ctx, 200, layout(ctx, { title: 'Admin login', noindex: true, body: `<div class="wrap section narrow"><h1>Admin login</h1>${noAdmin ? '<p class="alert">No admin user exists yet. Create one with <code>npm run create-admin</code> (see README).</p>' : ''}
<form method="post" action="/admin/login" class="form">${h.csrfField(ctx)}<div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required></div><div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><button class="btn" type="submit">Log in</button></form></div>` }));
  });
  route('POST', '/admin/login', (ctx) => {
    if (!h.checkCsrf(ctx)) return h.send(ctx, 403, h.errorPage(ctx, 'Security check failed. Reload the page and try again.'));
    if (!rateLimit(`login:${ctx.ip}`, 6, 15 * 60 * 1000)) return h.send(ctx, 429, h.errorPage(ctx, 'Too many login attempts. Please wait 15 minutes.'));
    const email = String(ctx.body.email || '').trim().toLowerCase();
    const u = q.get('SELECT * FROM admin_users WHERE email=?', email);
    const ok = u ? verifyPassword(String(ctx.body.password || ''), u.password_hash) : (verifyPassword('x', 'scrypt$00$00'), false);
    if (!ok) return h.redirect(ctx, '/admin/login', { type: 'error', text: 'Incorrect email or password.' });
    const token = rand(32);
    q.run('INSERT INTO admin_sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,datetime(\'now\',?))', sha256(token), u.id, rand(24), `+${SESSION_HOURS} hours`);
    q.run("DELETE FROM admin_sessions WHERE expires_at < datetime('now')");
    ctx.setCookies.push(cookie('nx_admin', token, { maxAge: SESSION_HOURS * 3600 }));
    h.redirect(ctx, '/admin');
  });
  route('POST', '/admin/logout', guard((ctx, s) => {
    q.run('DELETE FROM admin_sessions WHERE token_hash=?', s.token_hash);
    ctx.setCookies.push(cookie('nx_admin', '', { maxAge: 0 }));
    h.redirect(ctx, '/admin/login');
  }));

  route('GET', '/admin', guard((ctx, s) => {
    const n = (sql) => q.get(sql).n;
    const stats = [['Real orders awaiting payment', n("SELECT COUNT(*) n FROM orders WHERE is_demo=0 AND payment_status IN('unpaid','pending') AND status<>'cancelled'")], ['Paid orders awaiting processing', n("SELECT COUNT(*) n FROM orders WHERE is_demo=0 AND fulfillment_status='awaiting_supplier'")], ['Demonstration orders', n('SELECT COUNT(*) n FROM orders WHERE is_demo=1')], ['Demo products published', n("SELECT COUNT(*) n FROM products WHERE is_development=1 AND status='published'")], ['Orders needing review', n("SELECT COUNT(*) n FROM orders WHERE admin_notes LIKE '%REVIEW:%'")], ['New inquiries', n("SELECT COUNT(*) n FROM inquiries WHERE status='new'")], ['Supplier sync errors', n("SELECT COUNT(*) n FROM supplier_mappings WHERE sync_status='error'")]];
    const status = `<h2>Integration status</h2><ul><li>Paystack: ${paystack.isConfigured() ? `configured (${paystack.mode()} mode), webhook and live results not yet verified by this software` : 'NOT configured (no payments can be taken)'}</li><li>CJdropshipping API: ${cj.isConfigured() ? 'API key present (untested)' : 'NOT configured'}; order submission ${cfg.cj.allowOrderSubmission ? 'ENABLED' : 'disabled'}</li><li>Demo mode ${cfg.demoMode ? '<strong>ON</strong> (demonstration checkout offered; demo orders never count as paid)' : 'off'}</li><li>Sample products ${cfg.allowDevProducts ? 'ALLOWED (development)' : 'blocked'}; unconfirmed delivery ${cfg.allowUnconfirmedDelivery ? 'ALLOWED (development)' : 'blocked'}</li></ul>`;
    h.send(ctx, 200, page(ctx, s, '', 'Dashboard', `<dl class="stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>${status}`));
  }));

  route('GET', '/admin/orders', guard((ctx, s) => {
    const search = String(ctx.url.searchParams.get('q') || '').trim().slice(0, 80); const st = ctx.url.searchParams.get('payment') || ''; const kind = ctx.url.searchParams.get('kind') || '';
    const w = []; const a = [];
    if (search) { w.push("(reference LIKE ? OR customer_email LIKE ? OR customer_name LIKE ?)"); a.push(`%${search}%`, `%${search}%`, `%${search}%`); }
    if (LABEL.payment[st]) { w.push('payment_status=?'); a.push(st); }
    if (kind === 'real') w.push('is_demo=0'); else if (kind === 'demo') w.push('is_demo=1');
    const rows = q.all(`SELECT * FROM orders ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id DESC LIMIT 100`, ...a);
    const f = `<form class="filters" method="get" action="/admin/orders"><div><label for="q">Search</label><input id="q" name="q" value="${esc(search)}" placeholder="Reference, email or name"></div><div><label for="payment">Payment</label><select id="payment" name="payment"><option value="">Any</option>${Object.entries(LABEL.payment).map(([k, v]) => `<option value="${k}"${st === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div><div><label for="kind">Type</label><select id="kind" name="kind"><option value="">All</option><option value="real"${kind === 'real' ? ' selected' : ''}>Real orders</option><option value="demo"${kind === 'demo' ? ' selected' : ''}>Demonstration orders</option></select></div><div class="filters-actions"><button class="btn" type="submit">Filter</button></div></form>`;
    h.send(ctx, 200, page(ctx, s, 'orders', 'Orders', f + dt(rows, [['Reference', (o) => `<a href="/admin/orders/${esc(o.reference)}">${esc(o.reference)}</a>${o.admin_notes.includes('REVIEW:') ? ' <span class="tag tag-dev">review</span>' : ''}${o.is_demo ? ' <span class="tag tag-dev">DEMO</span>' : ''}`], ['Date', (o) => when(o.created_at)], ['Customer', (o) => esc(o.customer_name)], ['Total', (o) => money.format(o.total_minor, o.currency)], ['Payment', (o) => o.payment_method === 'demo' ? 'Demo (no payment)' + (o.demo_confirmed_at ? ', completed' : '') : LABEL.payment[o.payment_status]], ['Fulfilment', (o) => LABEL.fulfil[o.fulfillment_status]]])));
  }));
  route('GET', '/admin/orders/:ref', guard((ctx, s) => {
    const o = orders.byReference(ctx.params.ref); if (!o) return h.send(ctx, 404, h.notFound(ctx));
    const its = orders.items(o.id); const pays = q.all('SELECT * FROM payments WHERE order_id=? ORDER BY id', o.id); const so = q.get('SELECT * FROM supplier_orders WHERE order_id=?', o.id);
    const next = o.payment_status === 'paid' ? (NEXT[o.fulfillment_status] || []) : [];
    const canCancel = o.status !== 'cancelled' && !['shipped', 'delivered'].includes(o.fulfillment_status);
    const prep = cj.buildOrderPayload(o, its);
    const inner = `<p><a href="/admin/orders">&larr; All orders</a></p><dl class="kv"><dt>Reference</dt><dd>${esc(o.reference)}</dd><dt>Created</dt><dd>${when(o.created_at)} UTC</dd><dt>Status</dt><dd>${LABEL.status[o.status]}</dd><dt>Payment</dt><dd>${LABEL.payment[o.payment_status]}</dd><dt>Fulfilment</dt><dd>${LABEL.fulfil[o.fulfillment_status]}</dd>
<dt>Customer</dt><dd>${esc(o.customer_name)}, ${esc(o.customer_email)}, ${esc(o.customer_phone)}</dd><dt>Ship to</dt><dd>${esc(o.ship_address)}, ${esc(o.ship_city)}, ${esc(o.ship_state)}, ${esc(o.ship_country)} ${esc(o.ship_postal)}</dd>${o.delivery_notes ? `<dt>Notes</dt><dd>${esc(o.delivery_notes)}</dd>` : ''}<dt>Tracking</dt><dd>${esc(o.tracking_number || 'none')}</dd></dl>
${o.is_demo ? `<p class="alert"><strong>DEMONSTRATION ORDER</strong> (payment method: ${esc(o.payment_method)}${o.demo_confirmed_at ? `, demo completed ${when(o.demo_confirmed_at)}` : ''}). No money was taken. Do not fulfil.</p>` : ''}${o.has_development_items ? '<p class="alert">Contains SAMPLE/DEMO products: do not fulfil.</p>' : ''}${o.admin_notes.trim() ? `<h2>Internal notes</h2><pre class="notes">${esc(o.admin_notes.trim())}</pre>` : ''}
<h2>Items (price snapshot)</h2>${dt(its, [['Item', (i) => `${esc(i.product_name)} (${esc(i.variant_label)}) ${esc(i.sku)}`], ['Unit', (i) => money.format(i.unit_price_minor, o.currency)], ['Qty', (i) => i.quantity], ['Line', (i) => money.format(i.line_total_minor, o.currency)]])}
<p>Subtotal ${money.format(o.subtotal_minor, o.currency)} + delivery ${money.format(o.delivery_fee_minor, o.currency)} (${esc(o.delivery_zone_name)}${o.delivery_confirmed ? '' : ', NOT confirmed'}) = <strong>${money.format(o.total_minor, o.currency)}</strong></p>
<h2>Payment attempts</h2>${dt(pays, [['Reference', (p) => esc(p.reference.slice(0, 22) + '...')], ['Status', (p) => esc(p.status)], ['Amount', (p) => money.format(p.amount_minor, p.currency)], ['Updated', (p) => when(p.updated_at)], ['Detail', (p) => esc(p.gateway_response || '')]])}
<h2>Fulfilment</h2>${next.length || canCancel ? `<form method="post" action="/admin/orders/${esc(o.reference)}/fulfilment" class="form">${csrf(s)}<div class="field"><label for="to">Move to</label><select id="to" name="to">${next.map((n) => `<option value="${n}">${LABEL.fulfil[n]}</option>`).join('')}${canCancel ? '<option value="cancelled">Cancel order (refund handled manually)</option>' : ''}</select></div><div class="field"><label for="tn">Tracking number (required for Shipped)</label><input id="tn" name="tracking_number" maxlength="80"></div><div class="field"><label for="tu">Tracking link (https only, optional)</label><input id="tu" name="tracking_url" maxlength="300"></div><div class="field"><label for="note">Note (optional, internal)</label><input id="note" name="note" maxlength="200"></div><button class="btn" type="submit">Update status</button></form>` : '<p class="muted">No further manual status changes available.</p>'}
<h2>CJdropshipping order</h2>${so ? `<p>Supplier order: ${esc(so.status)} ${so.supplier_order_id ? '(CJ id ' + esc(so.supplier_order_id) + ')' : ''} ${so.last_error ? '<br>Last error: ' + esc(so.last_error) : ''}</p>` : '<p class="muted">No supplier order has been created.</p>'}
${prep.unmapped.length ? `<p class="alert">Not mapped to CJ yet: ${esc(prep.unmapped.join(', '))}</p>` : '<details><summary>Review payload that would be sent</summary><pre class="notes">' + esc(JSON.stringify(prep.payload, null, 2)) + '</pre></details>'}
${!so && o.payment_status === 'paid' && cfg.cj.allowOrderSubmission && !prep.unmapped.length ? `<form method="post" action="/admin/orders/${esc(o.reference)}/supplier" class="form">${csrf(s)}<label><input type="checkbox" name="confirm" value="yes" required> I authorise sending this order to CJdropshipping (this may commit company funds).</label><button class="btn btn-outline" type="submit">Submit to CJ</button></form>` : '<p class="small muted">Submission is available only when CJ_ALLOW_ORDER_SUBMISSION=true, the order is paid, items are mapped, and no supplier order exists.</p>'}`;
    h.send(ctx, 200, page(ctx, s, 'orders', `Order ${o.reference}`, inner));
  }));
  route('POST', '/admin/orders/:ref/fulfilment', guard((ctx, s) => {
    ctx.back = `/admin/orders/${ctx.params.ref}`;
    const o = orders.byReference(ctx.params.ref); if (!o) return h.send(ctx, 404, h.notFound(ctx));
    const to = String(ctx.body.to || ''); const tn = String(ctx.body.tracking_number || '').trim().slice(0, 80); let tu = String(ctx.body.tracking_url || '').trim().slice(0, 300);
    if (tu && !/^https:\/\//.test(tu)) throw new UserError('Tracking link must start with https://');
    const note = String(ctx.body.note || '').trim().slice(0, 200);
    tx(() => {
      const cur = q.get('SELECT * FROM orders WHERE id=?', o.id);
      if (to === 'cancelled') {
        if (cur.status === 'cancelled' || ['shipped', 'delivered'].includes(cur.fulfillment_status)) throw new UserError('This order can no longer be cancelled.');
        const paidNote = cur.payment_status === 'paid' ? ' PAID order cancelled: refund must be handled manually in Paystack.' : '';
        q.run("UPDATE orders SET status='cancelled', fulfillment_status='cancelled', admin_notes=admin_notes||?, updated_at=datetime('now') WHERE id=?", `\n[${new Date().toISOString()}] Cancelled by ${s.email}.${paidNote} ${note}`, o.id);
        return;
      }
      if (cur.payment_status !== 'paid' || !(NEXT[cur.fulfillment_status] || []).includes(to)) throw new UserError('That status change is not allowed for this order right now.');
      if (to === 'shipped' && !tn) throw new UserError('Enter a tracking number before marking an order as shipped.');
      q.run("UPDATE orders SET fulfillment_status=?, tracking_number=COALESCE(NULLIF(?,''),tracking_number), tracking_url=COALESCE(NULLIF(?,''),tracking_url), admin_notes=admin_notes||?, updated_at=datetime('now') WHERE id=?", to, tn, tu, `\n[${new Date().toISOString()}] ${s.email}: ${cur.fulfillment_status} -> ${to}. ${note}`, o.id);
    });
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Order updated.' });
  }));
  route('POST', '/admin/orders/:ref/supplier', guard(async (ctx) => {
    ctx.back = `/admin/orders/${ctx.params.ref}`;
    const o = orders.byReference(ctx.params.ref); if (!o) return h.send(ctx, 404, h.notFound(ctx));
    if (ctx.body.confirm !== 'yes') throw new UserError('Please tick the authorisation box.');
    await cj.submitOrder(o, orders.items(o.id));
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Order sent to CJdropshipping. Check its status before treating it as fulfilled.' });
  }));

  route('GET', '/admin/products', guard((ctx, s) => {
    const rows = q.all(`SELECT p.*, c.name cat, (SELECT COUNT(*) FROM variants v WHERE v.product_id=p.id) nv, (SELECT MIN(price_minor) FROM variants v WHERE v.product_id=p.id) minp FROM products p LEFT JOIN categories c ON c.id=p.category_id ORDER BY p.id DESC`);
    h.send(ctx, 200, page(ctx, s, 'products', 'Products', '<p><a class="btn" href="/admin/products/new">+ Add product</a></p>' + dt(rows, [['Name', (p) => `<a href="/admin/products/${p.id}">${esc(p.name)}</a>${p.is_development ? ' <span class="tag tag-dev">sample</span>' : ''}`], ['Category', (p) => esc(p.cat || '')], ['Status', (p) => esc(p.status)], ['Variants', (p) => p.nv], ['From', (p) => p.minp == null ? '' : money.format(p.minp, p.currency)]]) + '<p class="small muted">Demo products are marked "sample". Add or update products in bulk with <code>npm run import</code> (see PRODUCT_CATALOG_GUIDE.md).</p>'));
  }));
  route('GET', '/admin/products/:id', guard((ctx, s) => {
    const p = q.get('SELECT * FROM products WHERE id=?', Number(ctx.params.id)); if (!p) return h.send(ctx, 404, h.notFound(ctx));
    const cats = q.all('SELECT * FROM categories ORDER BY sort_order,name'); const imgs = q.all('SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order,id', p.id); const vs = q.all('SELECT v.*, m.supplier_product_id spid, m.supplier_variant_id svid, m.cost_minor, m.cost_currency, m.sync_status, m.internal_notes FROM variants v LEFT JOIN supplier_mappings m ON m.variant_id=v.id WHERE v.product_id=? ORDER BY v.sort_order,v.id', p.id);
    const inner = `<p><a href="/admin/products">&larr; All products</a>${p.status === 'published' ? ` &middot; <a href="/product/${esc(p.slug)}">View on store</a>` : ''}</p>${p.is_development ? '<p class="alert">Sample product (development data). Replace before launch.</p>' : ''}
<form method="post" action="/admin/products/${p.id}" class="form">${csrf(s)}<div class="field"><label for="name">Name</label><input id="name" name="name" value="${esc(p.name)}" maxlength="150" required></div>
<div class="field"><label for="summary">Short description (product cards, max 160 characters)</label><input id="summary" name="summary" value="${esc(p.summary)}" maxlength="160"></div>
<div class="field"><label for="description">Description</label><textarea id="description" name="description" rows="5" maxlength="4000">${esc(p.description)}</textarea></div>
<label><input type="checkbox" name="is_development" value="1"${p.is_development ? ' checked' : ''}> Demo / sample product (cannot be sold when demo mode is off)</label>
<div class="field"><label for="category_id">Category</label><select id="category_id" name="category_id"><option value="">None</option>${cats.map((c) => `<option value="${c.id}"${c.id === p.category_id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
<div class="field"><label for="status">Publication status</label><select id="status" name="status">${['draft', 'published', 'archived'].map((x) => `<option${x === p.status ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
<h2>Variants</h2>${vs.map((v) => `<fieldset class="vfs"><legend>${esc(v.sku)}: ${esc(v.label)}</legend>
<div class="field"><label for="p${v.id}">Retail price (${esc(p.currency)})</label><input id="p${v.id}" name="price_${v.id}" value="${money.toMajorString(v.price_minor)}" inputmode="decimal" required></div>
<div class="field"><label for="a${v.id}">Availability</label><select id="a${v.id}" name="avail_${v.id}">${['available', 'unavailable', 'unverified'].map((x) => `<option${x === v.availability ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
<div class="field"><label for="s${v.id}">Stock quantity (blank = not tracked)</label><input id="s${v.id}" name="stock_${v.id}" value="${v.stock_qty ?? ''}" inputmode="numeric"></div>
<p class="small muted"><strong>Private supplier mapping</strong> (never shown to customers). Sync: ${esc(v.sync_status || 'unmapped')}</p>
<div class="field"><label for="sp${v.id}">CJ product ID</label><input id="sp${v.id}" name="spid_${v.id}" value="${esc(v.spid || '')}" maxlength="80"></div>
<div class="field"><label for="sv${v.id}">CJ variant ID</label><input id="sv${v.id}" name="svid_${v.id}" value="${esc(v.svid || '')}" maxlength="80"></div>
<div class="field"><label for="sc${v.id}">Supplier cost (${esc(v.cost_currency || 'currency of supplier')}), internal only</label><input id="sc${v.id}" name="cost_${v.id}" value="${v.cost_minor == null ? '' : money.toMajorString(v.cost_minor)}" inputmode="decimal"></div>
<label class="small"><input type="checkbox" name="del_${v.id}" value="1"> Delete this variant when saving (past orders keep their snapshot)</label></fieldset>`).join('')}
<button class="btn" type="submit">Save product</button></form>
<h2>Add a variant</h2><form method="post" action="/admin/products/${p.id}/variants" class="form vfs">${csrf(s)}<div class="admin-grid">${variantFields()}</div><button class="btn btn-small" type="submit">Add variant</button></form>
<h2>Images</h2>${imgs.length ? `<ul class="img-list">${imgs.map((i, n) => `<li><img src="${esc(i.url)}" alt="${esc(i.alt)}"><span>${n === 0 ? '<strong>Main image</strong><br>' : ''}${esc(i.alt || '(no description)')}</span><form method="post" action="/admin/products/${p.id}/images/${i.id}/delete">${csrf(s)}<button class="link-btn" type="submit">Remove</button></form>${n ? `<form method="post" action="/admin/products/${p.id}/images/${i.id}/main">${csrf(s)}<button class="link-btn" type="submit">Make main image</button></form>` : ''}</li>`).join('')}</ul>` : '<p class="muted">No images yet.</p>'}
<form method="post" action="/admin/products/${p.id}/images" enctype="multipart/form-data" class="form vfs">${csrf(s)}<div class="field"><label for="img">Upload image (JPG, PNG or WebP, max 5 MB; square images look best)</label><input id="img" name="image" type="file" accept="image/jpeg,image/png,image/webp" required></div><div class="field"><label for="alt">Image description for screen readers</label><input id="alt" name="alt" maxlength="150" placeholder="e.g. Tan leather wallet, open"></div><button class="btn btn-small" type="submit">Upload</button></form>`;
    h.send(ctx, 200, page(ctx, s, 'products', p.name, inner));
  }));
  route('POST', '/admin/products/:id', guard((ctx) => {
    const id = Number(ctx.params.id); ctx.back = `/admin/products/${id}`;
    const p = q.get('SELECT * FROM products WHERE id=?', id); if (!p) return h.send(ctx, 404, h.notFound(ctx));
    const b = ctx.body; const name = String(b.name || '').trim().slice(0, 150); if (!name) throw new UserError('Name is required.');
    if (!['draft', 'published', 'archived'].includes(b.status)) throw new UserError('Invalid status.');
    const vs = q.all('SELECT id FROM variants WHERE product_id=?', id);
    const upd = []; const del = vs.filter((v) => b[`del_${v.id}`]).map((v) => v.id);
    if (del.length && del.length === vs.length) throw new UserError('A product needs at least one variant. Add another variant before deleting this one.');
    for (const v of vs) {
      if (del.includes(v.id)) continue;
      const pr = money.parseToMinor(b[`price_${v.id}`]); if (pr == null) throw new UserError('Enter prices like 15000 or 15000.50.');
      if (!['available', 'unavailable', 'unverified'].includes(b[`avail_${v.id}`])) throw new UserError('Invalid availability.');
      const st = String(b[`stock_${v.id}`] ?? '').trim(); if (st !== '' && !/^\d{1,6}$/.test(st)) throw new UserError('Stock must be a whole number or blank.');
      const cs = String(b[`cost_${v.id}`] ?? '').trim(); const cost = cs === '' ? null : money.parseToMinor(cs); if (cs !== '' && cost == null) throw new UserError('Supplier cost is not a valid amount.');
      upd.push({ id: v.id, pr, av: b[`avail_${v.id}`], st: st === '' ? null : Number(st), cost, spid: String(b[`spid_${v.id}`] || '').trim().slice(0, 80), svid: String(b[`svid_${v.id}`] || '').trim().slice(0, 80) });
    }
    if (b.status === 'published' && !vs.length) throw new UserError('Add at least one variant before publishing.');
    tx(() => {
      q.run("UPDATE products SET name=?, summary=?, description=?, category_id=?, status=?, is_development=?, updated_at=datetime('now') WHERE id=?", name, String(b.summary || '').trim().slice(0, 160), String(b.description || '').slice(0, 4000), b.category_id ? Number(b.category_id) : null, b.status, b.is_development ? 1 : 0, id);
      for (const d of del) q.run('DELETE FROM variants WHERE id=? AND product_id=?', d, id);
      for (const u of upd) {
        q.run("UPDATE variants SET price_minor=?, availability=?, stock_qty=?, updated_at=datetime('now') WHERE id=?", u.pr, u.av, u.st, u.id);
        q.run(`INSERT INTO supplier_mappings(variant_id,supplier_product_id,supplier_variant_id,cost_minor,sync_status) VALUES(?,?,?,?,?)
          ON CONFLICT(variant_id) DO UPDATE SET supplier_product_id=excluded.supplier_product_id, supplier_variant_id=excluded.supplier_variant_id, cost_minor=excluded.cost_minor,
          sync_status=CASE WHEN excluded.supplier_variant_id<>'' THEN CASE WHEN sync_status IN('synced','error') THEN sync_status ELSE 'mapped' END ELSE 'unmapped' END`, u.id, u.spid || null, u.svid || null, u.cost, u.svid ? 'mapped' : 'unmapped');
      }
    });
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Product saved.' });
  }));

  function variantFields() {
    return `<div class="field"><label for="nsku">SKU (your stock code, unique)</label><input id="nsku" name="sku" maxlength="40" required placeholder="e.g. NX-WAL-TAN"></div>
<div class="field"><label for="nlabel">Option name shown to customers</label><input id="nlabel" name="label" maxlength="80" required placeholder="e.g. Tan, Large, 10,000 mAh"></div>
<div class="field"><label for="nprice">Retail price (${esc(cfg.currency)})</label><input id="nprice" name="price" inputmode="decimal" required placeholder="e.g. 9500"></div>
<div class="field"><label for="navail">Availability</label><select id="navail" name="availability">${AVAIL.map((x) => `<option>${x}</option>`).join('')}</select></div>
<div class="field"><label for="nstock">Stock quantity (blank = not tracked)</label><input id="nstock" name="stock" inputmode="numeric"></div>`;
  }
  function readVariant(b) {
    const sku = String(b.sku || '').trim(); if (!SKU.test(sku)) throw new UserError('SKU must be 2 to 40 letters, numbers, dots, dashes or underscores.');
    if (q.get('SELECT 1 x FROM variants WHERE sku=?', sku)) throw new UserError(`SKU ${sku} is already used.`);
    const label = String(b.label || '').trim().slice(0, 80); if (!label) throw new UserError('Enter the option name shown to customers.');
    const pr = money.parseToMinor(b.price); if (pr == null) throw new UserError('Enter prices like 15000 or 15000.50.');
    if (!AVAIL.includes(b.availability)) throw new UserError('Invalid availability.');
    const st = String(b.stock ?? '').trim(); if (st !== '' && !/^\d{1,6}$/.test(st)) throw new UserError('Stock must be a whole number or blank.');
    return { sku, label, pr, av: b.availability, st: st === '' ? null : Number(st) };
  }
  const insertVariant = (pid, v) => q.run("INSERT INTO variants(product_id,sku,label,options_json,price_minor,availability,stock_qty,sort_order) VALUES(?,?,?,'{}',?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM variants WHERE product_id=?))", pid, v.sku, v.label, v.pr, v.av, v.st, pid);

  route('GET', '/admin/products/new', guard((ctx, s) => {
    const cats = q.all('SELECT * FROM categories ORDER BY sort_order,name');
    h.send(ctx, 200, page(ctx, s, 'products', 'Add product', `<p><a href="/admin/products">&larr; All products</a></p><p class="small muted">New products are saved as <strong>draft</strong> (hidden) unless you choose Published. Add images after saving.</p>
<form method="post" action="/admin/products/new" class="form">${csrf(s)}<div class="field"><label for="name">Product name</label><input id="name" name="name" maxlength="150" required></div>
<div class="field"><label for="slug">Web address name (optional; letters, numbers, hyphens)</label><input id="slug" name="slug" maxlength="80" placeholder="made from the name if blank"></div>
<div class="field"><label for="summary">Short description (max 160 characters)</label><input id="summary" name="summary" maxlength="160"></div>
<div class="field"><label for="description">Description</label><textarea id="description" name="description" rows="5" maxlength="4000"></textarea></div>
<div class="field"><label for="category_id">Category</label><select id="category_id" name="category_id"><option value="">None</option>${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
<div class="field"><label for="status">Publication status</label><select id="status" name="status"><option>draft</option><option>published</option></select></div>
<label><input type="checkbox" name="is_development" value="1"${cfg.demoMode ? ' checked' : ''}> Demo / sample product</label>
<h2>First option (variant)</h2><div class="admin-grid">${variantFields()}</div><button class="btn" type="submit">Create product</button></form>`));
  }));
  route('POST', '/admin/products/new', guard((ctx) => {
    ctx.back = '/admin/products/new'; const b = ctx.body;
    const name = String(b.name || '').trim().slice(0, 150); if (!name) throw new UserError('Name is required.');
    const slug = String(b.slug || '').trim() ? String(b.slug).trim().toLowerCase() : slugify(name);
    if (!SLUG.test(slug)) throw new UserError('Web address name must be lowercase letters, numbers and single hyphens.');
    if (q.get('SELECT 1 x FROM products WHERE slug=?', slug)) throw new UserError('Another product already uses that web address name.');
    if (!['draft', 'published'].includes(b.status)) throw new UserError('Invalid status.');
    const v = readVariant(b);
    const id = tx(() => {
      const pid = Number(q.run('INSERT INTO products(slug,name,summary,description,category_id,status,is_development,currency) VALUES(?,?,?,?,?,?,?,?)', slug, name, String(b.summary || '').trim().slice(0, 160), String(b.description || '').slice(0, 4000), b.category_id ? Number(b.category_id) : null, b.status, b.is_development ? 1 : 0, cfg.currency).lastInsertRowid);
      insertVariant(pid, v); return pid;
    });
    h.redirect(ctx, `/admin/products/${id}`, { type: 'ok', text: 'Product created. Now add images.' });
  }));
  route('POST', '/admin/products/:id/variants', guard((ctx) => {
    const id = Number(ctx.params.id); ctx.back = `/admin/products/${id}`;
    if (!q.get('SELECT 1 x FROM products WHERE id=?', id)) return h.send(ctx, 404, h.notFound(ctx));
    insertVariant(id, readVariant(ctx.body));
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Variant added.' });
  }));
  route('POST', '/admin/products/:id/images', guard((ctx) => {
    const id = Number(ctx.params.id); ctx.back = `/admin/products/${id}`;
    if (!q.get('SELECT 1 x FROM products WHERE id=?', id)) return h.send(ctx, 404, h.notFound(ctx));
    const f = (ctx.files || []).find((x) => x.field === 'image');
    if (!f) throw new UserError('Choose an image file to upload.');
    if (f.data.length > 5 * 1024 * 1024) throw new UserError('Images must be under 5 MB.');
    const ext = imageType(f.data); if (!ext) throw new UserError('Only JPG, PNG or WebP images can be uploaded.');
    fs.mkdirSync(cfg.uploadDir, { recursive: true });
    const name = `p${id}-${rand(9).replace(/[^A-Za-z0-9]/g, 'x')}.${ext}`;
    fs.writeFileSync(path.join(cfg.uploadDir, name), f.data);
    q.run('INSERT INTO product_images(product_id,url,alt,sort_order) VALUES(?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM product_images WHERE product_id=?))', id, `/uploads/${name}`, String(ctx.body.alt || '').trim().slice(0, 150), id);
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Image uploaded.' });
  }));
  route('POST', '/admin/products/:id/images/:img/delete', guard((ctx) => {
    const id = Number(ctx.params.id); ctx.back = `/admin/products/${id}`;
    const im = q.get('SELECT * FROM product_images WHERE id=? AND product_id=?', Number(ctx.params.img), id); if (!im) throw new UserError('Image not found.');
    q.run('DELETE FROM product_images WHERE id=?', im.id);
    if (im.url.startsWith('/uploads/') && !q.get('SELECT 1 x FROM product_images WHERE url=?', im.url)) { try { fs.unlinkSync(path.join(cfg.uploadDir, path.basename(im.url))); } catch { /* already gone */ } }
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Image removed.' });
  }));
  route('POST', '/admin/products/:id/images/:img/main', guard((ctx) => {
    const id = Number(ctx.params.id); ctx.back = `/admin/products/${id}`;
    tx(() => { q.run('UPDATE product_images SET sort_order=sort_order+1 WHERE product_id=?', id); q.run('UPDATE product_images SET sort_order=0 WHERE id=? AND product_id=?', Number(ctx.params.img), id); });
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Main image changed.' });
  }));

  route('GET', '/admin/categories', guard((ctx, s) => {
    const rows = q.all('SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id=c.id) n FROM categories c ORDER BY sort_order, name');
    const f = (c = {}) => `<div class="field"><label>Name<input name="name" value="${esc(c.name || '')}" maxlength="60" required></label></div><div class="field"><label>Description (shown on the category page)<input name="description" value="${esc(c.description || '')}" maxlength="200"></label></div><div class="field"><label>Display order (smaller first)<input name="sort_order" value="${c.sort_order ?? 0}" inputmode="numeric" maxlength="4"></label></div>`;
    h.send(ctx, 200, page(ctx, s, 'categories', 'Categories', `${rows.map((c) => `<form method="post" action="/admin/categories/${c.id}" class="form vfs">${csrf(s)}<p><strong>${esc(c.name)}</strong> <span class="muted">/shop?category=${esc(c.slug)} &middot; ${c.n} product(s)</span></p><div class="admin-grid">${f(c)}</div><div><button class="btn btn-small" type="submit" name="action" value="save">Save</button>${c.n ? '' : ' <button class="btn btn-small btn-outline" type="submit" name="action" value="delete">Delete (empty)</button>'}</div></form>`).join('')}
<h2>Add a category</h2><form method="post" action="/admin/categories/new" class="form vfs">${csrf(s)}<div class="admin-grid">${f()}</div><button class="btn btn-small" type="submit">Add category</button></form>`));
  }));
  const readCat = (b) => {
    const name = String(b.name || '').trim().slice(0, 60); if (!name) throw new UserError('Category name is required.');
    const so = String(b.sort_order ?? '0').trim(); if (!/^-?\d{1,4}$/.test(so)) throw new UserError('Display order must be a whole number.');
    return { name, description: String(b.description || '').trim().slice(0, 200), sort: Number(so) };
  };
  route('POST', '/admin/categories/new', guard((ctx) => {
    ctx.back = '/admin/categories'; const c = readCat(ctx.body); const slug = slugify(c.name);
    if (!SLUG.test(slug)) throw new UserError('Use letters or numbers in the category name.');
    if (q.get('SELECT 1 x FROM categories WHERE slug=?', slug)) throw new UserError('A category with that name already exists.');
    q.run('INSERT INTO categories(slug,name,description,sort_order) VALUES(?,?,?,?)', slug, c.name, c.description, c.sort);
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Category added.' });
  }));
  route('POST', '/admin/categories/:id', guard((ctx) => {
    ctx.back = '/admin/categories'; const id = Number(ctx.params.id);
    if (ctx.body.action === 'delete') {
      if (q.get('SELECT 1 x FROM products WHERE category_id=?', id)) throw new UserError('Move or delete the products in this category first.');
      q.run('DELETE FROM categories WHERE id=?', id); return h.redirect(ctx, ctx.back, { type: 'ok', text: 'Category deleted.' });
    }
    const c = readCat(ctx.body); q.run('UPDATE categories SET name=?, description=?, sort_order=? WHERE id=?', c.name, c.description, c.sort, id);
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Category saved.' });
  }));

  route('GET', '/admin/inquiries', guard((ctx, s) => {
    const rows = q.all('SELECT * FROM inquiries ORDER BY id DESC LIMIT 200');
    h.send(ctx, 200, page(ctx, s, 'inquiries', 'Inquiries', dt(rows, [['Date', (r) => when(r.created_at)], ['From', (r) => `${esc(r.name)}<br><a href="mailto:${esc(r.email)}">${esc(r.email)}</a>`], ['Message', (r) => `<strong>${esc(r.subject)}</strong><br>${esc(r.message).replace(/\n/g, '<br>')}`], ['Status', (r) => r.status === 'new' ? `<form method="post" action="/admin/inquiries/${r.id}/handled" class="inline">${csrf(s)}<button class="btn btn-small" type="submit">Mark handled</button></form>` : 'Handled']])));
  }));
  route('POST', '/admin/inquiries/:id/handled', guard((ctx) => { q.run("UPDATE inquiries SET status='handled' WHERE id=?", Number(ctx.params.id)); h.redirect(ctx, '/admin/inquiries'); }));

  route('GET', '/admin/delivery', guard((ctx, s) => {
    const zs = q.all('SELECT * FROM delivery_zones ORDER BY id');
    const inner = `<p class="alert">Delivery charges are business decisions. Tick "Confirmed" only after the fee and estimate have been approved. In production, checkout refuses destinations that are not confirmed.</p>${zs.map((z) => `<form method="post" action="/admin/delivery/${z.id}" class="form vfs">${csrf(s)}<div class="field"><label for="n${z.id}">Name</label><input id="n${z.id}" name="name" value="${esc(z.name)}" maxlength="80"></div><div class="field"><label for="c${z.id}">Country code (2 letters)</label><input id="c${z.id}" name="country_code" value="${esc(z.country_code)}" maxlength="2"></div><div class="field"><label for="f${z.id}">Delivery fee (${esc(cfg.currency)})</label><input id="f${z.id}" name="fee" value="${money.toMajorString(z.fee_minor)}"></div><div class="field"><label for="e${z.id}">Estimate text (shown to customers)</label><input id="e${z.id}" name="estimate_text" value="${esc(z.estimate_text)}" maxlength="120"></div>
<label><input type="checkbox" name="confirmed" value="1"${z.confirmed ? ' checked' : ''}> Confirmed</label> <label><input type="checkbox" name="active" value="1"${z.active ? ' checked' : ''}> Active</label> <button class="btn btn-small" type="submit">Save</button></form>`).join('')}
<h2>Add a delivery zone</h2><form method="post" action="/admin/delivery/new" class="form vfs">${csrf(s)}<div class="admin-grid"><div class="field"><label for="nn">Name (e.g. Abuja)</label><input id="nn" name="name" maxlength="80" required></div><div class="field"><label for="nc">Country code</label><input id="nc" name="country_code" value="NG" maxlength="2"></div><div class="field"><label for="nf">Delivery fee (${esc(cfg.currency)})</label><input id="nf" name="fee" required></div><div class="field"><label for="ne">Estimate text (optional)</label><input id="ne" name="estimate_text" maxlength="120"></div></div><label><input type="checkbox" name="confirmed" value="1"> Confirmed</label> <button class="btn btn-small" type="submit">Add zone</button></form>`;
    h.send(ctx, 200, page(ctx, s, 'delivery', 'Delivery zones', inner));
  }));
  route('POST', '/admin/delivery/new', guard((ctx) => {
    ctx.back = '/admin/delivery'; const b = ctx.body; const fee = money.parseToMinor(b.fee); if (fee == null) throw new UserError('Enter a valid delivery fee.');
    if (!/^[A-Za-z]{2}$/.test(String(b.country_code || ''))) throw new UserError('Country code must be 2 letters, e.g. NG.');
    const name = String(b.name || '').trim().slice(0, 80); if (!name) throw new UserError('Zone name is required.');
    q.run('INSERT INTO delivery_zones(name,country_code,fee_minor,estimate_text,confirmed,active) VALUES(?,?,?,?,?,1)', name, b.country_code.toUpperCase(), fee, String(b.estimate_text || '').slice(0, 120), b.confirmed ? 1 : 0);
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Delivery zone added.' });
  }));
  route('POST', '/admin/delivery/:id', guard((ctx) => {
    ctx.back = '/admin/delivery'; const b = ctx.body; const fee = money.parseToMinor(b.fee); if (fee == null) throw new UserError('Enter a valid delivery fee.');
    if (!/^[A-Za-z]{2}$/.test(String(b.country_code || ''))) throw new UserError('Country code must be 2 letters, e.g. NG.');
    q.run('UPDATE delivery_zones SET name=?, country_code=?, fee_minor=?, estimate_text=?, confirmed=?, active=? WHERE id=?', String(b.name || '').trim().slice(0, 80) || 'Zone', b.country_code.toUpperCase(), fee, String(b.estimate_text || '').slice(0, 120), b.confirmed ? 1 : 0, b.active ? 1 : 0, Number(ctx.params.id));
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Delivery zone saved.' });
  }));

  route('GET', '/admin/supplier', guard((ctx, s) => {
    const rows = q.all(`SELECT m.*, v.sku, p.name FROM supplier_mappings m JOIN variants v ON v.id=m.variant_id JOIN products p ON p.id=v.product_id ORDER BY (m.sync_status='error') DESC, m.id DESC LIMIT 200`);
    h.send(ctx, 200, page(ctx, s, 'supplier', 'Supplier sync', `<p>CJdropshipping API: ${cj.isConfigured() ? 'key present, <strong>not yet tested against a live account</strong>' : '<strong>not configured</strong>'}.</p>` + dt(rows, [['Product', (r) => esc(r.name) + ' ' + esc(r.sku)], ['CJ variant', (r) => esc(r.supplier_variant_id || 'unmapped')], ['Status', (r) => esc(r.sync_status)], ['Last synced', (r) => when(r.last_synced_at)], ['Error', (r) => esc(r.last_error || '')], ['', (r) => r.supplier_variant_id && cj.isConfigured() ? `<form method="post" action="/admin/supplier/${r.variant_id}/sync" class="inline">${csrf(s)}<button class="btn btn-small btn-outline" type="submit">Check CJ</button></form>` : '']])));
  }));
  route('POST', '/admin/supplier/:id/sync', guard(async (ctx) => {
    ctx.back = '/admin/supplier'; const r = await cj.syncVariant(Number(ctx.params.id));
    h.redirect(ctx, ctx.back, r.ok ? { type: 'ok', text: 'Supplier record checked.' } : { type: 'error', text: `Supplier check failed: ${r.error}` });
  }));
}
module.exports = { register, LABEL };
