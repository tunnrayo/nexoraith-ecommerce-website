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
const settings = require('./settings');
const notify = require('./notify');
const dd = require('./delivery-date');
const images = require('./images');
const cleanup = require('./catalog-cleanup');
const fs = require('fs');
const path = require('path');
const { imageType } = require('./multipart');
const slugify = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SKU = /^[A-Za-z0-9._-]{2,40}$/;
const AVAIL = ['available', 'unavailable', 'unverified'];
const VAVAIL = { available: 'Available to order', unavailable: 'Unavailable', unverified: 'Not yet checked (cannot be ordered)' };
const OPTION_KEYS = ['Colour', 'Size', 'Model'];

const SESSION_HOURS = 8;
const LABEL = orders.LABEL;
const PAVAIL = { available: 'Available to order', temporarily_unavailable: 'Temporarily unavailable', discontinued: 'Discontinued' };

function currentSession(ctx) {
  const t = ctx.cookies.nx_admin;
  if (!t) return null;
  const s = q.get(`SELECT s.*, u.email FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=?`, sha256(t));
  if (!s) return null;
  if (new Date(s.expires_at.replace(' ', 'T') + 'Z') < new Date()) { q.run('DELETE FROM admin_sessions WHERE token_hash=?', s.token_hash); return null; }
  return s;
}
const nav = (active) => `<nav class="admin-nav" aria-label="Admin">${[['', 'Dashboard'], ['orders', 'Orders'], ['products', 'Products'], ['categories', 'Categories'], ['delivery', 'Delivery'], ['inquiries', 'Inquiries'], ['settings', 'Settings'], ...(cfg.supplierIntegration ? [['supplier', 'Supplier sync']] : [])].map(([h, t]) => `<a href="/admin${h ? '/' + h : ''}"${active === h ? ' aria-current="page"' : ''}>${t}</a>`).join('')}
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
    const real = 'is_demo=0';
    const stats = [
      ['Needs your attention', n(`SELECT COUNT(*) n FROM orders WHERE needs_attention=1 AND status<>'cancelled'`), '/admin/orders?attention=1', 'b-err'],
      ['Pending review (check availability)', n(`SELECT COUNT(*) n FROM orders WHERE status='pending_review'`), '/admin/orders?status=pending_review', 'b-warn'],
      ['Awaiting payment', n(`SELECT COUNT(*) n FROM orders WHERE status='awaiting_payment'`), '/admin/orders?status=awaiting_payment', ''],
      ['Confirmed: to source', n(`SELECT COUNT(*) n FROM orders WHERE status='confirmed' AND fulfillment_status IN('not_started','sourcing')`), '/admin/orders?stage=to_source', 'b-info'],
      ['In delivery pipeline', n(`SELECT COUNT(*) n FROM orders WHERE status='confirmed' AND fulfillment_status IN('products_secured','preparing','ready_for_dispatch','out_for_delivery')`), '/admin/orders?stage=pipeline', ''],
      ['Refunds to process', n(`SELECT COUNT(*) n FROM orders WHERE payment_status='refund_pending' OR refund_due_minor>0`), '/admin/orders?refund=1', 'b-warn'],
      ['Real orders (all time)', n(`SELECT COUNT(*) n FROM orders WHERE ${real}`), '/admin/orders?kind=real', ''],
      ['Demonstration orders', n('SELECT COUNT(*) n FROM orders WHERE is_demo=1'), '/admin/orders?kind=demo', ''],
      ['New inquiries', n("SELECT COUNT(*) n FROM inquiries WHERE status='new'"), '/admin/inquiries', ''],
    ];
    const late = q.all(`SELECT reference, customer_name, estimated_delivery_date FROM orders WHERE status='confirmed' AND fulfillment_status<>'delivered' AND estimated_delivery_date <= ? ORDER BY estimated_delivery_date LIMIT 20`, dd.addDays(dd.localDate(new Date()), 2));
    const status = `<h2>Setup status</h2><ul><li>Payment timing: <strong>${settings.paymentTiming() === 'review_first' ? 'Review first (you check availability, then request payment)' : 'Pay at checkout'}</strong>; delivery estimate ${settings.deliveryDays()} calendar days after confirmation. <a href="/admin/settings">Change</a></li><li>Paystack: ${paystack.isConfigured() ? `configured (${paystack.mode()} mode); live behaviour not yet verified by this software` : '<strong>NOT configured</strong> (no payments can be taken)'}</li><li>Email notifications: ${notify.isConfigured() ? 'configured (Resend)' : '<strong>NOT configured</strong>: customers are not emailed; messages still appear on their order page'}</li><li>Catalogue: ${q.get("SELECT COUNT(*) n FROM products WHERE status='published' AND is_development=0").n} active products. <a href="/admin/products/new">Add a product</a>${cleanup.demoProductCount() ? ` &middot; <strong>${cleanup.demoProductCount()} old demo product(s) still in the database</strong>: <a href="/admin/settings#demo">remove them</a>` : ''}</li><li>Delivery zones: ${q.get('SELECT COUNT(*) n FROM delivery_zones WHERE active=1 AND confirmed=0').n ? `<strong>${q.get('SELECT COUNT(*) n FROM delivery_zones WHERE active=1 AND confirmed=0').n} not confirmed</strong>${cfg.allowUnconfirmedDelivery ? ' (allowed for now)' : ': checkout refuses them until you tick Confirmed'} <a href="/admin/delivery">Review</a>` : 'all confirmed'}</li><li>Demonstration checkout for testing: ${cfg.demoCheckout ? '<strong>ON</strong> (customers see a no-payment test option; set DEMO_CHECKOUT=false)' : 'off'}</li>${cfg.supplierIntegration ? `<li>CJdropshipping tools: ${cj.isConfigured() ? 'API key present (untested)' : 'no API key'}</li>` : ''}</ul>`;
    h.send(ctx, 200, page(ctx, s, '', 'Dashboard', `<dl class="stats">${stats.map(([k, v, href, c]) => `<div><dt><a href="${href}">${k}</a></dt><dd>${v ? `<span class="${c ? 'badge ' + c : ''}">${v}</span>` : 0}</dd></div>`).join('')}</dl>
${late.length ? `<h2>Estimated delivery due within 2 days</h2>${dt(late, [['Order', (o) => `<a href="/admin/orders/${esc(o.reference)}">${esc(o.reference)}</a>`], ['Customer', (o) => esc(o.customer_name)], ['Estimated delivery', (o) => esc(dd.formatDate(o.estimated_delivery_date))]])}<p class="small muted">If you will miss a date, open the order and revise the estimate with a reason: the customer sees it.</p>` : ''}${status}`));
  }));

  const badgeFor = (o) => [
    o.needs_attention && o.status !== 'cancelled' ? '<span class="badge b-err">Needs attention</span>' : '',
    o.is_demo ? '<span class="badge b-warn">DEMO</span>' : '',
  ].join(' ');
  route('GET', '/admin/orders', guard((ctx, s) => {
    const sp = ctx.url.searchParams; const L = orders.LABEL;
    const f = { q: String(sp.get('q') || '').trim().slice(0, 80), status: sp.get('status') || '', payment: sp.get('payment') || '', fulfil: sp.get('fulfil') || '', kind: sp.get('kind') || '', attention: sp.get('attention') || '', refund: sp.get('refund') || '', stage: sp.get('stage') || '', from: sp.get('from') || '', to: sp.get('to') || '' };
    const w = []; const a = [];
    if (f.q) { w.push("(reference LIKE ? OR customer_email LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)"); a.push(...Array(4).fill(`%${f.q}%`)); }
    if (L.status[f.status]) { w.push('status=?'); a.push(f.status); }
    if (L.payment[f.payment]) { w.push('payment_status=?'); a.push(f.payment); }
    if (L.fulfil[f.fulfil]) { w.push('fulfillment_status=?'); a.push(f.fulfil); }
    if (f.kind === 'real') w.push('is_demo=0'); else if (f.kind === 'demo') w.push('is_demo=1');
    if (f.attention) w.push("needs_attention=1 AND status<>'cancelled'");
    if (f.refund) w.push("(payment_status='refund_pending' OR refund_due_minor>0)");
    if (f.stage === 'to_source') w.push("status='confirmed' AND fulfillment_status IN('not_started','sourcing')");
    if (f.stage === 'pipeline') w.push("status='confirmed' AND fulfillment_status IN('products_secured','preparing','ready_for_dispatch','out_for_delivery')");
    if (dd.isYmd(f.from)) { w.push('date(created_at) >= ?'); a.push(f.from); }
    if (dd.isYmd(f.to)) { w.push('date(created_at) <= ?'); a.push(f.to); }
    const rows = q.all(`SELECT * FROM orders ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY needs_attention DESC, id DESC LIMIT 200`, ...a);
    const sel = (name, label, map) => `<div><label for="${name}">${label}</label><select id="${name}" name="${name}"><option value="">Any</option>${Object.entries(map).map(([k, v]) => `<option value="${k}"${f[name] === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>`;
    const form = `<form class="filters" method="get" action="/admin/orders"><div><label for="q">Search</label><input id="q" name="q" value="${esc(f.q)}" placeholder="Reference, name, email or phone"></div>${sel('status', 'Order status', L.status)}${sel('payment', 'Payment', L.payment)}${sel('fulfil', 'Fulfilment', L.fulfil)}${sel('kind', 'Type', { real: 'Real orders', demo: 'Demonstration orders' })}
<div><label for="from">From</label><input id="from" name="from" type="date" value="${esc(f.from)}"></div><div><label for="to">To</label><input id="to" name="to" type="date" value="${esc(f.to)}"></div>
<div><label><input type="checkbox" name="attention" value="1"${f.attention ? ' checked' : ''}> Needs attention</label><br><label><input type="checkbox" name="refund" value="1"${f.refund ? ' checked' : ''}> Refund to process</label></div>
<div class="filters-actions"><button class="btn" type="submit">Filter</button> <a class="btn btn-outline" href="/admin/orders">Clear</a></div></form>`;
    h.send(ctx, 200, page(ctx, s, 'orders', 'Orders', form + `<p class="muted">${rows.length} order(s)${rows.length === 200 ? ' (showing the latest 200)' : ''}</p>` + dt(rows, [
      ['Reference', (o) => `<a href="/admin/orders/${esc(o.reference)}"><strong>${esc(o.reference)}</strong></a><br>${badgeFor(o)}`],
      ['Ordered', (o) => esc(dd.formatDateTime(o.created_at))],
      ['Customer', (o) => `${esc(o.customer_name)}<br><span class="small muted">${esc(o.customer_phone)}</span>`],
      ['Total', (o) => money.format(o.total_minor, o.currency)],
      ['Order', (o) => esc(L.status[o.status])], ['Payment', (o) => o.payment_method === 'demo' ? 'Demo (no payment)' : esc(L.payment[o.payment_status])], ['Fulfilment', (o) => esc(L.fulfil[o.fulfillment_status])],
      ['Est. delivery', (o) => o.estimated_delivery_date ? esc(dd.formatDate(o.estimated_delivery_date)) : '<span class="muted">after confirmation</span>'],
    ])));
  }));

  const waLink = (phone) => { let d = String(phone).replace(/\D/g, ''); if (d.startsWith('0') && d.length === 11) d = '234' + d.slice(1); return d.length >= 10 ? `https://wa.me/${d}` : ''; };
  route('GET', '/admin/orders/:ref', guard((ctx, s) => {
    const o = orders.byReference(ctx.params.ref); if (!o) return h.send(ctx, 404, h.notFound(ctx));
    const L = orders.LABEL; const its = orders.items(o.id); const pays = q.all('SELECT * FROM payments WHERE order_id=? ORDER BY id', o.id);
    const evs = orders.events(o.id); const notes = q.all('SELECT * FROM notifications WHERE order_id=? ORDER BY id DESC LIMIT 30', o.id);
    const R = esc(o.reference); const act = (p) => `/admin/orders/${R}/${p}`; const open = o.status !== 'cancelled';
    const optText = (j) => { try { return Object.entries(JSON.parse(j || '{}')).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(', '); } catch { return ''; } };
    const link = orders.orderLink(o);
    const subj = encodeURIComponent(`Your Nexoraith order ${o.reference}`);
    const nextStages = o.status === 'confirmed' ? orders.STAGES.slice(orders.STAGES.indexOf(o.fulfillment_status) + 1) : [];
    const paidHeld = ['paid', 'refund_pending'].includes(o.payment_status) ? o.total_minor + o.refund_due_minor : 0;
    const sourcing = `<div class="card-a"><h2>Sourcing checklist: exact items ordered</h2><p class="small muted">Buy exactly what is listed. If an item cannot be found exactly as ordered, mark it <strong>Unavailable</strong>: the order is flagged and the customer is told you will contact them. Never substitute without the customer's approval.</p>
${its.map((i) => `<div class="src-item">${i.image_url ? `<img src="${esc(images.displayable(i.image_url))}" alt="">` : '<span class="noimg-s"></span>'}<div><strong>${esc(i.product_name)}</strong> <span class="badge ${({ secured: 'b-ok', available: 'b-info', unavailable: 'b-err', removed: '' })[i.item_status] || 'b-warn'}">${esc(L.item[i.item_status])}</span><br>
<span class="small">Option: <strong>${esc(i.variant_label)}</strong>${optText(i.options_json) ? ` (${optText(i.options_json)})` : ''} &middot; SKU ${esc(i.sku)} &middot; Qty <strong>${i.quantity}</strong> &middot; ${money.format(i.unit_price_minor, o.currency)} each = ${money.format(i.line_total_minor, o.currency)}</span>${i.item_note ? `<br><span class="small muted">Note: ${esc(i.item_note)}</span>` : ''}
${open && i.item_status !== 'removed' ? `<form method="post" action="${act(`items/${i.id}`)}">${csrf(s)}<label class="sr" for="is${i.id}">Item status</label><select id="is${i.id}" name="item_status">${['pending', 'available', 'secured', 'unavailable'].map((x) => `<option value="${x}"${x === i.item_status ? ' selected' : ''}>${L.item[x]}</option>`).join('')}</select><input name="note" maxlength="300" placeholder="Note (optional)" aria-label="Note"><button class="btn btn-small" type="submit">Save</button></form>
${i.item_status === 'unavailable' ? `<form method="post" action="${act(`items/${i.id}/remove`)}">${csrf(s)}<input name="approval" maxlength="300" required placeholder="How the customer approved removal (e.g. WhatsApp 21 Oct)" aria-label="Customer approval"><button class="btn btn-small btn-outline" type="submit">Remove item (customer approved)</button></form>` : ''}` : ''}</div></div>`).join('')}</div>`;
    const actions = `<div class="card-a"><h2>Next step</h2>
${!open ? `<p>Order cancelled${o.cancel_reason ? `: ${esc(o.cancel_reason)}` : ''}.</p>` : ''}
${o.status === 'pending_review' ? `<p>Check the market for every item above and mark each one <strong>Available in market</strong>. Then ask the customer to pay.</p><form method="post" action="${act('request-payment')}">${csrf(s)}<button class="btn" type="submit">Availability confirmed: request payment</button></form><p class="small muted">The customer's order page shows a Pay button and (if email is configured) they are emailed the link.</p>` : ''}
${o.status === 'awaiting_payment' ? `<p>Waiting for the customer to pay${o.payment_method === 'demo' ? ' (demonstration payment)' : ''}. Payment is marked confirmed <strong>only</strong> after Paystack verifies it.</p>` : ''}
${o.status === 'confirmed' && nextStages.length ? `<form method="post" action="${act('fulfilment')}" class="form">${csrf(s)}<div class="field"><label for="to">Move fulfilment to</label><select id="to" name="to">${nextStages.map((x) => `<option value="${x}">${L.fulfil[x]}</option>`).join('')}</select></div><div class="field"><label for="fn">Message to customer (optional, shown on their order page)</label><input id="fn" name="note" maxlength="300"></div><label class="small"><input type="checkbox" name="email" value="1" checked> Email the customer this update</label><button class="btn" type="submit">Update progress</button></form>` : ''}
${o.payment_status === 'refund_pending' || o.refund_due_minor > 0 ? `<div class="attn"><strong>Refund due: ${money.format(o.refund_due_minor, o.currency)}.</strong> Refund it in your Paystack dashboard (Transactions > the payment > Refund), then record it here.<form method="post" action="${act('refunded')}" class="inline-form">${csrf(s)}<div class="field"><label for="rr">Paystack refund reference</label><input id="rr" name="refund_ref" maxlength="120" required></div><button class="btn btn-small" type="submit">Mark refund completed</button></form></div>` : ''}
${open && o.fulfillment_status !== 'delivered' ? `<details><summary>Cancel this order</summary><form method="post" action="${act('cancel')}" class="form">${csrf(s)}<div class="field"><label for="cr">Reason (shown to the customer)</label><input id="cr" name="reason" maxlength="300" required></div>${paidHeld ? `<label><input type="checkbox" name="informed" value="1"> The customer has been told and agrees. A refund of ${money.format(paidHeld, o.currency)} will be recorded as due.</label>` : ''}<button class="btn btn-small btn-outline" type="submit">Cancel order</button></form></details>` : ''}</div>`;
    const estimate = `<div class="card-a"><h2>Delivery estimate</h2>${o.estimated_delivery_date ? `<p><strong>${esc(dd.formatDate(o.estimated_delivery_date))}</strong>${o.original_estimated_delivery_date !== o.estimated_delivery_date ? `<br><span class="small muted">Originally ${esc(dd.formatDate(o.original_estimated_delivery_date))}</span>` : ''}<br><span class="small muted">Confirmed ${esc(dd.formatDateTime(o.confirmed_at))} + ${settings.deliveryDays()} calendar days</span></p>
${open && o.status === 'confirmed' ? `<details><summary>Revise the estimate</summary><form method="post" action="${act('estimate')}" class="form">${csrf(s)}<div class="field"><label for="ed">New estimated date</label><input id="ed" name="date" type="date" required value="${esc(o.estimated_delivery_date)}"></div><div class="field"><label for="er">Reason (shown to the customer)</label><input id="er" name="reason" maxlength="300" required></div><label class="small"><input type="checkbox" name="email" value="1" checked> Email the customer</label><button class="btn btn-small" type="submit">Save new estimate</button></form></details>` : ''}` : `<p class="muted">Set automatically when the order is confirmed (payment verified): ${settings.deliveryDays()} calendar days later.</p>`}</div>`;
    const contact = `<div class="card-a"><h2>Customer</h2><p><strong>${esc(o.customer_name)}</strong><br><a href="tel:${esc(o.customer_phone.replace(/[^\d+]/g, ''))}">${esc(o.customer_phone)}</a><br><a href="mailto:${esc(o.customer_email)}">${esc(o.customer_email)}</a></p>
<p><strong>Deliver to:</strong><br>${esc(o.ship_address)}<br>${esc(o.ship_city)}, ${esc(o.ship_state)}, ${esc(o.ship_country)} ${esc(o.ship_postal)}${o.delivery_notes ? `<br><em>Instructions: ${esc(o.delivery_notes)}</em>` : ''}</p>
<div class="contact-links"><a class="btn btn-small btn-outline" href="tel:${esc(o.customer_phone.replace(/[^\d+]/g, ''))}">Call</a>${waLink(o.customer_phone) ? `<a class="btn btn-small btn-outline" href="${esc(waLink(o.customer_phone))}?text=${encodeURIComponent(`Hello ${o.customer_name}, this is Nexoraith about your order ${o.reference}.`)}" rel="noopener noreferrer" target="_blank">WhatsApp</a>` : ''}<a class="btn btn-small btn-outline" href="mailto:${esc(o.customer_email)}?subject=${subj}&amp;body=${encodeURIComponent(`Hello ${o.customer_name},\n\nYour order page: ${link}\n\n`)}">Email</a></div>
<form method="post" action="${act('message')}" class="form mt">${csrf(s)}<div class="field"><label for="msg">Post a message on the customer's order page${notify.isConfigured() ? ' (also emailed)' : ''}</label><textarea id="msg" name="message" rows="3" maxlength="2000" required placeholder="e.g. The blue size 42 is out of stock in the market. Would you like the black one, or a refund for this item?"></textarea></div><button class="btn btn-small" type="submit">Send to customer</button></form>
<p class="small muted">Customer's private order link (share only with this customer):<br><input value="${esc(link)}" readonly aria-label="Customer order link" class="w100"></p></div>`;
    const summary = `<div class="card-a"><h2>Summary</h2><dl class="kv"><dt>Ordered</dt><dd>${esc(dd.formatDateTime(o.created_at))}</dd><dt>Order status</dt><dd>${esc(L.status[o.status])}</dd><dt>Payment</dt><dd>${o.payment_method === 'demo' ? 'Demonstration (no payment)' : esc(L.payment[o.payment_status])}</dd><dt>Fulfilment</dt><dd>${esc(L.fulfil[o.fulfillment_status])}</dd><dt>Payment timing</dt><dd>${o.payment_timing === 'review_first' ? 'Review first' : 'Pay at checkout'}${o.payment_requested_at ? ` (requested ${esc(dd.formatDateTime(o.payment_requested_at))})` : ''}</dd><dt>Confirmed</dt><dd>${o.confirmed_at ? esc(dd.formatDateTime(o.confirmed_at)) : 'Not yet'}</dd>
<dt>Subtotal</dt><dd>${money.format(o.subtotal_minor, o.currency)}</dd><dt>Delivery</dt><dd>${money.format(o.delivery_fee_minor, o.currency)} (${esc(o.delivery_zone_name)}${o.delivery_confirmed ? '' : ', preliminary fee'})</dd><dt>Total</dt><dd><strong>${money.format(o.total_minor, o.currency)}</strong></dd><dt>Paid (verified)</dt><dd>${money.format(orders.amountPaid(o.id), o.currency)}</dd>${o.refund_due_minor ? `<dt>Refund due</dt><dd>${money.format(o.refund_due_minor, o.currency)}</dd>` : ''}</dl></div>`;
    const attn = o.needs_attention && open ? `<div class="attn"><strong>Needs attention:</strong> ${esc(o.attention_reason)}<form method="post" action="${act('attention')}" class="inline-form">${csrf(s)}<input type="hidden" name="on" value="0"><button class="btn btn-small btn-outline" type="submit">Mark resolved</button></form></div>`
      : open ? `<details><summary>Flag this order for attention</summary><form method="post" action="${act('attention')}" class="inline-form">${csrf(s)}<input type="hidden" name="on" value="1"><div class="field"><label for="ar">What needs attention?</label><input id="ar" name="reason" maxlength="300" required></div><button class="btn btn-small" type="submit">Flag</button></form></details>` : '';
    const history = `<div class="card-a"><h2>History</h2><ol class="timeline">${evs.slice().reverse().map((e) => `<li><time>${esc(dd.formatDateTime(e.created_at))} &middot; ${esc(e.actor)}${e.customer_visible ? ' &middot; <span class="badge b-info">customer sees</span>' : ''}</time><p>${esc(e.body)}</p></li>`).join('')}</ol>
${notes.length ? `<h2>Emails</h2>${dt(notes, [['When', (n) => esc(dd.formatDateTime(n.created_at))], ['To', (n) => esc(n.recipient)], ['Subject', (n) => esc(n.subject)], ['Result', (n) => `<span class="badge ${n.status === 'sent' ? 'b-ok' : n.status === 'failed' ? 'b-err' : ''}">${esc(n.status)}</span> <span class="small muted">${esc(n.detail)}</span>`]])}` : ''}
<h2>Payment attempts</h2>${dt(pays, [['Reference', (p) => esc(p.reference.slice(0, 22) + '...')], ['Status', (p) => esc(p.status)], ['Amount', (p) => money.format(p.amount_minor, p.currency)], ['Updated', (p) => esc(dd.formatDateTime(p.updated_at))], ['Detail', (p) => esc(p.gateway_response || '')]])}
${o.admin_notes.trim() ? `<h2>System notes</h2><pre class="notes">${esc(o.admin_notes.trim())}</pre>` : ''}</div>`;
    const inner = `<p><a href="/admin/orders">&larr; All orders</a> &middot; ${badgeFor(o)}</p>${o.is_demo ? '<p class="alert"><strong>DEMONSTRATION ORDER.</strong> No money was taken. Do not source or deliver.</p>' : ''}${attn}
<div class="admin-cols"><div>${actions}${sourcing}${history}</div><div>${summary}${estimate}${contact}</div></div>`;
    h.send(ctx, 200, page(ctx, s, 'orders', `Order ${o.reference}`, inner));
  }));
  // Every owner action: load order, set the return page, run the workflow function (which enforces the rules).
  const orderAction = (p, fn) => route('POST', `/admin/orders/:ref/${p}`, guard(async (ctx, s) => {
    const o = orders.byReference(ctx.params.ref); if (!o) return h.send(ctx, 404, h.notFound(ctx));
    ctx.back = `/admin/orders/${o.reference}`;
    const text = await fn(o, ctx.body, s.email, ctx.params);
    h.redirect(ctx, ctx.back, { type: 'ok', text: text || 'Saved.' });
  }));
  orderAction('request-payment', async (o, b, who) => { await orders.requestPayment(o, who); return 'Payment requested. The customer can now pay from their order page.'; });
  orderAction('items/:item', (o, b, who, p) => { orders.setItemStatus(o, p.item, b.item_status, b.note, who); return 'Item updated.'; });
  orderAction('items/:item/remove', (o, b, who, p) => { orders.removeItemWithApproval(o, p.item, b.approval, who); return 'Item removed with the customer\'s approval. Totals were recalculated.'; });
  orderAction('fulfilment', async (o, b, who) => { const n = orders.setFulfilment(o, b.to, b.note, who); if (b.email) await orders.notifyLatest(n, `Order update: ${orders.LABEL.fulfil[n.fulfillment_status]}`); return 'Progress updated.'; });
  orderAction('estimate', async (o, b, who) => { const n = orders.reviseEstimate(o, b.date, b.reason, who); if (b.email) await orders.notifyLatest(n, 'Updated delivery estimate'); return 'Estimate updated. The customer can see the new date and reason.'; });
  orderAction('cancel', async (o, b, who) => { const n = orders.cancelOrder(o, b.reason, !!b.informed, who); await orders.notifyLatest(n, 'Your order has been cancelled'); return n.refund_due_minor ? 'Order cancelled. Refund recorded as due: process it in Paystack.' : 'Order cancelled.'; });
  orderAction('refunded', async (o, b, who) => { const n = orders.markRefunded(o, b.refund_ref, who); await orders.notifyLatest(n, 'Your refund has been processed'); return 'Refund recorded.'; });
  orderAction('attention', (o, b, who) => { orders.setAttention(o, b.on === '1', b.reason, who); return b.on === '1' ? 'Order flagged.' : 'Attention cleared.'; });
  orderAction('message', async (o, b, who) => { const r = await orders.messageCustomer(o, b.message, who); return `Message posted on the customer's order page.${r.status === 'sent' ? ' Email sent.' : r.status === 'skipped' ? ' (Email not configured, so it was not emailed.)' : ' Email failed: see the Emails list.'}`; });
  if (cfg.supplierIntegration) route('POST', '/admin/orders/:ref/supplier', guard(async (ctx) => {
    ctx.back = `/admin/orders/${ctx.params.ref}`;
    const o = orders.byReference(ctx.params.ref); if (!o) return h.send(ctx, 404, h.notFound(ctx));
    if (ctx.body.confirm !== 'yes') throw new UserError('Please tick the authorisation box.');
    await cj.submitOrder(o, orders.items(o.id));
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Order sent to CJdropshipping. Check its status before treating it as fulfilled.' });
  }));

  route('GET', '/admin/products', guard((ctx, s) => {
    const sp = ctx.url.searchParams; const f = { q: String(sp.get('q') || '').trim().slice(0, 80), category: sp.get('category') || '', status: sp.get('status') || '', availability: sp.get('availability') || '', kind: sp.get('kind') || '', page: Math.max(parseInt(sp.get('page'), 10) || 1, 1) };
    const w = []; const a = [];
    if (f.q) { w.push("(p.name LIKE ? OR p.slug LIKE ? OR EXISTS(SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.sku LIKE ?))"); a.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
    if (f.category) { w.push('c.slug=?'); a.push(f.category); }
    if (['draft', 'published', 'archived'].includes(f.status)) { w.push('p.status=?'); a.push(f.status); }
    if (PAVAIL[f.availability]) { w.push('p.availability=?'); a.push(f.availability); }
    if (sp.get('images') === 'missing') w.push("p.status='published' AND NOT ((p.card_image_url<>'' AND p.card_image_status<>'broken') OR EXISTS(SELECT 1 FROM product_images i WHERE i.product_id=p.id AND i.status<>'broken'))");
    if (f.kind === 'demo') w.push('p.is_development=1'); else if (f.kind === 'real') w.push('p.is_development=0');
    const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
    const total = q.get(`SELECT COUNT(*) n FROM products p LEFT JOIN categories c ON c.id=p.category_id ${where}`, ...a).n; const per = 50; const pages = Math.max(1, Math.ceil(total / per)); const pg = Math.min(f.page, pages);
    const rows = q.all(`SELECT p.*, c.name cat, (SELECT url FROM product_images i WHERE i.product_id=p.id ORDER BY sort_order,id LIMIT 1) img, (SELECT COUNT(*) FROM variants v WHERE v.product_id=p.id) nv, (SELECT MIN(price_minor) FROM variants v WHERE v.product_id=p.id) minp FROM products p LEFT JOIN categories c ON c.id=p.category_id ${where} ORDER BY p.id DESC LIMIT ${per} OFFSET ${(pg - 1) * per}`, ...a);
    const cats = q.all('SELECT slug, name FROM categories ORDER BY sort_order, name');
    const qs = (o) => '/admin/products?' + new URLSearchParams(Object.entries({ ...f, ...o }).filter(([, v]) => v !== '' && v != null)).toString();
    const filt = `<form class="filters" method="get" action="/admin/products"><div><label for="q">Search</label><input id="q" name="q" value="${esc(f.q)}" placeholder="Name or SKU"></div><div><label for="category">Category</label><select id="category" name="category"><option value="">Any</option>${cats.map((c) => `<option value="${esc(c.slug)}"${f.category === c.slug ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
<div><label for="status">Visibility</label><select id="status" name="status"><option value="">Any</option><option value="published"${f.status === 'published' ? ' selected' : ''}>Active (visible)</option><option value="draft"${f.status === 'draft' ? ' selected' : ''}>Inactive (hidden)</option><option value="archived"${f.status === 'archived' ? ' selected' : ''}>Archived</option></select></div>
<div><label for="availability">Availability</label><select id="availability" name="availability"><option value="">Any</option>${Object.entries(PAVAIL).map(([k, v]) => `<option value="${k}"${f.availability === k ? ' selected' : ''}>${v}</option>`).join('')}</select></div>
<div><label for="kind">Type</label><select id="kind" name="kind"><option value="">Any</option><option value="real"${f.kind === 'real' ? ' selected' : ''}>Products for sale</option><option value="demo"${f.kind === 'demo' ? ' selected' : ''}>Test products</option></select></div><div class="filters-actions"><button class="btn" type="submit">Filter</button> <a class="btn btn-outline" href="/admin/products">Clear</a></div></form>`;
    const quick = (p) => `<form method="post" action="/admin/products/${p.id}/quick" class="inline">${csrf(s)}<input type="hidden" name="back" value="${esc(qs({}))}"><select name="availability" aria-label="Availability of ${esc(p.name)}">${Object.entries(PAVAIL).map(([k, v]) => `<option value="${k}"${p.availability === k ? ' selected' : ''}>${v}</option>`).join('')}</select> <select name="status" aria-label="Visibility of ${esc(p.name)}"><option value="published"${p.status === 'published' ? ' selected' : ''}>Active</option><option value="draft"${p.status === 'draft' ? ' selected' : ''}>Inactive</option><option value="archived"${p.status === 'archived' ? ' selected' : ''}>Archived</option></select> <button class="btn btn-small btn-outline" type="submit">Save</button></form>`;
    h.send(ctx, 200, page(ctx, s, 'products', 'Products', `<p><a class="btn" href="/admin/products/new">+ Add product</a></p>${filt}<p class="muted">${total} product(s)</p>` + dt(rows, [
      ['', (p) => p.img ? `<img src="${esc(images.displayable(p.img))}" alt="" width="48" height="48" class="thumb48">` : ''],
      ['Name', (p) => `<a href="/admin/products/${p.id}">${esc(p.name)}</a>${p.source === 'dummyjson' ? ' <span class="badge b-warn">old demo catalogue</span>' : p.is_development ? ' <span class="badge b-warn">test product</span>' : ''}`], ['Category', (p) => esc(p.cat || '')], ['Price', (p) => p.minp == null ? '' : money.format(p.minp, p.currency) + (p.nv > 1 ? ` <span class="small muted">(${p.nv} options)</span>` : '')],
      ['Availability / visibility', quick], ['Updated', (p) => esc(dd.formatDateTime(p.updated_at))],
    ]) + (pages > 1 ? `<nav class="pager">${pg > 1 ? `<a class="btn btn-outline" href="${esc(qs({ page: pg - 1 }))}">Previous</a>` : ''}<span>Page ${pg} of ${pages}</span>${pg < pages ? `<a class="btn btn-outline" href="${esc(qs({ page: pg + 1 }))}">Next</a>` : ''}</nav>` : '') + '<p class="small muted">Bulk import of your own products: <code>npm run import</code> with your JSON file. See PRODUCT_CATALOG_GUIDE.md.</p>'));
  }));
  route('POST', '/admin/products/:id/quick', guard((ctx) => {
    const id = Number(ctx.params.id); const b = ctx.body; ctx.back = /^\/admin\/products(\?|$)/.test(b.back || '') ? b.back : '/admin/products';
    if (!PAVAIL[b.availability] || !['draft', 'published', 'archived'].includes(b.status)) throw new UserError('Invalid choice.');
    if (!q.run("UPDATE products SET availability=?, status=?, updated_at=datetime('now') WHERE id=?", b.availability, b.status, id).changes) throw new UserError('Product not found.');
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Product updated.' });
  }));
  route('GET', '/admin/products/:id', guard((ctx, s) => {
    const p = q.get('SELECT * FROM products WHERE id=?', Number(ctx.params.id)); if (!p) return h.send(ctx, 404, h.notFound(ctx));
    const cats = q.all('SELECT * FROM categories ORDER BY sort_order,name'); const imgs = q.all('SELECT * FROM product_images WHERE product_id=? ORDER BY sort_order,id', p.id); const vs = q.all('SELECT v.*, m.supplier_product_id spid, m.supplier_variant_id svid, m.cost_minor, m.cost_currency, m.sync_status, m.internal_notes FROM variants v LEFT JOIN supplier_mappings m ON m.variant_id=v.id WHERE v.product_id=? ORDER BY v.sort_order,v.id', p.id);
    const inner = `<p><a href="/admin/products">&larr; All products</a>${p.status === 'published' ? ` &middot; <a href="/product/${esc(p.slug)}">View on store</a>` : ''}</p>${p.is_development ? '<p class="alert">Test product: hidden from customers.</p>' : ''}
<form method="post" action="/admin/products/${p.id}" class="form">${csrf(s)}<div class="field"><label for="name">Name</label><input id="name" name="name" value="${esc(p.name)}" maxlength="150" required></div>
<div class="field"><label for="summary">Short description (product cards, max 160 characters)</label><input id="summary" name="summary" value="${esc(p.summary)}" maxlength="160"></div>
<div class="field"><label for="description">Description</label><textarea id="description" name="description" rows="5" maxlength="4000">${esc(p.description)}</textarea></div>
<label><input type="checkbox" name="is_development" value="1"${p.is_development ? ' checked' : ''}> Test product only (hidden from customers)</label>
<div class="field"><label for="category_id">Category</label><select id="category_id" name="category_id"><option value="">None</option>${cats.map((c) => `<option value="${c.id}"${c.id === p.category_id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
<div class="field"><label for="status">Visibility</label><select id="status" name="status">${[['published', 'Active (visible in the shop)'], ['draft', 'Inactive (hidden)'], ['archived', 'Archived']].map(([x, t]) => `<option value="${x}"${x === p.status ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
<div class="field"><label for="pavail">Availability</label><select id="pavail" name="availability">${Object.entries(PAVAIL).map(([k, v]) => `<option value="${k}"${p.availability === k ? ' selected' : ''}>${v}</option>`).join('')}</select><p class="small muted">Your own setting. "Temporarily unavailable" stays visible but cannot be ordered; "Discontinued" is hidden from the shop.</p></div>
${p.source === 'dummyjson' ? '<p class="note-dev">This product belongs to the old demonstration catalogue. It is kept (archived) only because it appears in a customer order.</p>' : ''}
<p class="small muted">Created ${esc(dd.formatDateTime(p.created_at))} &middot; updated ${esc(dd.formatDateTime(p.updated_at))}</p>
<h2>Options (variants)</h2><p class="small muted">Each option is one exact item a customer can choose (for example "Black, size 42"). Customers order exactly these.</p>${vs.map((v) => `<fieldset class="vfs"><legend>${esc(v.sku)}: ${esc(v.label)}</legend>
<div class="field"><label for="p${v.id}">Retail price (${esc(p.currency)})</label><input id="p${v.id}" name="price_${v.id}" value="${money.toMajorString(v.price_minor)}" inputmode="decimal" required></div>
<div class="field"><label for="ol${v.id}">Option name shown to customers</label><input id="ol${v.id}" name="label_${v.id}" value="${esc(v.label)}" maxlength="80" required></div>
<div class="admin-grid">${OPTION_KEYS.map((k) => `<div class="field"><label for="o${k}${v.id}">${k} (optional)</label><input id="o${k}${v.id}" name="opt_${k}_${v.id}" value="${esc(JSON.parse(v.options_json || '{}')[k] || '')}" maxlength="60"></div>`).join('')}</div>
<div class="field"><label for="a${v.id}">Availability of this option</label><select id="a${v.id}" name="avail_${v.id}">${AVAIL.map((x) => `<option value="${x}"${x === v.availability ? ' selected' : ''}>${VAVAIL[x]}</option>`).join('')}</select></div>
<div class="field"><label for="s${v.id}">Stock quantity (blank = not tracked)</label><input id="s${v.id}" name="stock_${v.id}" value="${v.stock_qty ?? ''}" inputmode="numeric"></div>
${cfg.supplierIntegration ? `<p class="small muted"><strong>CJ mapping</strong> (private). Sync: ${esc(v.sync_status || 'unmapped')}</p><div class="field"><label for="sp${v.id}">CJ product ID</label><input id="sp${v.id}" name="spid_${v.id}" value="${esc(v.spid || '')}" maxlength="80"></div><div class="field"><label for="sv${v.id}">CJ variant ID</label><input id="sv${v.id}" name="svid_${v.id}" value="${esc(v.svid || '')}" maxlength="80"></div>` : `<input type="hidden" name="spid_${v.id}" value="${esc(v.spid || '')}"><input type="hidden" name="svid_${v.id}" value="${esc(v.svid || '')}">`}
<div class="field"><label for="sc${v.id}">Your market cost (optional, private, never shown to customers)</label><input id="sc${v.id}" name="cost_${v.id}" value="${v.cost_minor == null ? '' : money.toMajorString(v.cost_minor)}" inputmode="decimal" placeholder="Leave blank if unknown"></div>
<label class="small"><input type="checkbox" name="del_${v.id}" value="1"> Delete this variant when saving (past orders keep their snapshot)</label></fieldset>`).join('')}
<button class="btn" type="submit">Save product</button></form>
<h2>Add a variant</h2><form method="post" action="/admin/products/${p.id}/variants" class="form vfs">${csrf(s)}<div class="admin-grid">${variantFields()}</div><button class="btn btn-small" type="submit">Add variant</button></form>
<h2>Images</h2>${imgs.length ? `<ul class="img-list">${imgs.map((i, n) => `<li><img src="${esc(images.displayable(i.url))}" alt="${esc(i.alt)}"><span>${n === 0 ? '<strong>Main image</strong><br>' : ''}${esc(i.alt || '(no description)')}</span><form method="post" action="/admin/products/${p.id}/images/${i.id}/delete">${csrf(s)}<button class="link-btn" type="submit">Remove</button></form>${n ? `<form method="post" action="/admin/products/${p.id}/images/${i.id}/main">${csrf(s)}<button class="link-btn" type="submit">Make main image</button></form>` : ''}</li>`).join('')}</ul>` : '<p class="muted">No images yet.</p>'}
<form method="post" action="/admin/products/${p.id}/images" enctype="multipart/form-data" class="form vfs">${csrf(s)}<div class="field"><label for="img">Upload image (JPG, PNG or WebP, max 5 MB; square images look best)</label><input id="img" name="image" type="file" accept="image/jpeg,image/png,image/webp" required></div><div class="field"><label for="alt">Image description for screen readers</label><input id="alt" name="alt" maxlength="150" placeholder="e.g. Tan leather wallet, open"></div><button class="btn btn-small" type="submit">Upload</button></form>
<form method="post" action="/admin/products/${p.id}/image-url" class="form vfs">${csrf(s)}<div class="field"><label for="iu">Or add an image by web address (https, allowed hosts: ${esc(cfg.imageHosts.join(', ') || 'none')})</label><input id="iu" name="url" type="url" maxlength="400" required placeholder="https://..."></div><div class="field"><label for="iua">Image description</label><input id="iua" name="alt" maxlength="150"></div><button class="btn btn-small btn-outline" type="submit">Add image link</button></form>`;
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
      if (!AVAIL.includes(b[`avail_${v.id}`])) throw new UserError('Invalid availability.');
      const label = String(b[`label_${v.id}`] ?? '').trim().slice(0, 80); if (!label) throw new UserError('Every option needs a name.');
      const opts = readOptions(b, `_${v.id}`);
      const st = String(b[`stock_${v.id}`] ?? '').trim(); if (st !== '' && !/^\d{1,6}$/.test(st)) throw new UserError('Stock must be a whole number or blank.');
      const cs = String(b[`cost_${v.id}`] ?? '').trim(); const cost = cs === '' ? null : money.parseToMinor(cs); if (cs !== '' && cost == null) throw new UserError('Supplier cost is not a valid amount.');
      upd.push({ id: v.id, label, opts, pr, av: b[`avail_${v.id}`], st: st === '' ? null : Number(st), cost, spid: String(b[`spid_${v.id}`] || '').trim().slice(0, 80), svid: String(b[`svid_${v.id}`] || '').trim().slice(0, 80) });
    }
    if (b.status === 'published' && !vs.length) throw new UserError('Add at least one variant before publishing.');
    if (!PAVAIL[b.availability]) throw new UserError('Invalid availability.');
    tx(() => {
      q.run("UPDATE products SET name=?, summary=?, description=?, category_id=?, status=?, availability=?, is_development=?, admin_edited_at=datetime('now'), updated_at=datetime('now') WHERE id=?", name, String(b.summary || '').trim().slice(0, 160), String(b.description || '').slice(0, 4000), b.category_id ? Number(b.category_id) : null, b.status, b.availability, b.is_development ? 1 : 0, id);
      for (const d of del) q.run('DELETE FROM variants WHERE id=? AND product_id=?', d, id);
      for (const u of upd) {
        q.run("UPDATE variants SET label=?, options_json=?, price_minor=?, availability=?, stock_qty=?, updated_at=datetime('now') WHERE id=?", u.label, JSON.stringify(u.opts), u.pr, u.av, u.st, u.id);
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
${OPTION_KEYS.map((k) => `<div class="field"><label for="no${k}">${k} (optional)</label><input id="no${k}" name="opt_${k}" maxlength="60"></div>`).join('')}
<div class="field"><label for="navail">Availability of this option</label><select id="navail" name="vavailability">${AVAIL.map((x) => `<option value="${x}">${VAVAIL[x]}</option>`).join('')}</select></div>
<div class="field"><label for="nstock">Stock quantity (blank = not tracked)</label><input id="nstock" name="stock" inputmode="numeric"></div>`;
  }
  function readVariant(b) {
    const sku = String(b.sku || '').trim(); if (!SKU.test(sku)) throw new UserError('SKU must be 2 to 40 letters, numbers, dots, dashes or underscores.');
    if (q.get('SELECT 1 x FROM variants WHERE sku=?', sku)) throw new UserError(`SKU ${sku} is already used.`);
    const label = String(b.label || '').trim().slice(0, 80); if (!label) throw new UserError('Enter the option name shown to customers.');
    const pr = money.parseToMinor(b.price); if (pr == null) throw new UserError('Enter prices like 15000 or 15000.50.');
    const av = b.vavailability ?? b.availability; if (!AVAIL.includes(av)) throw new UserError('Invalid availability.');
    const st = String(b.stock ?? '').trim(); if (st !== '' && !/^\d{1,6}$/.test(st)) throw new UserError('Stock must be a whole number or blank.');
    return { sku, label, pr, av, st: st === '' ? null : Number(st), opts: readOptions(b, '') };
  }
  const insertVariant = (pid, v) => q.run("INSERT INTO variants(product_id,sku,label,options_json,price_minor,availability,stock_qty,sort_order) VALUES(?,?,?,?,?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM variants WHERE product_id=?))", pid, v.sku, v.label, JSON.stringify(v.opts || {}), v.pr, v.av, v.st, pid);
  // Remember that the owner changed this product, so a later catalogue re-import never overwrites it.
  const edited = (id) => q.run("UPDATE products SET admin_edited_at=datetime('now'), updated_at=datetime('now') WHERE id=?", id);
  function readOptions(b, suffix) { const o = {}; for (const k of OPTION_KEYS) { const x = String(b[`opt_${k}${suffix}`] ?? '').trim().slice(0, 60); if (x) o[k] = x; } return o; }

  route('GET', '/admin/products/new', guard((ctx, s) => {
    const cats = q.all('SELECT * FROM categories ORDER BY sort_order,name');
    h.send(ctx, 200, page(ctx, s, 'products', 'Add product', `<p><a href="/admin/products">&larr; All products</a></p><p class="small muted">New products are saved as <strong>draft</strong> (hidden) unless you choose Published. Add images after saving.</p>
<form method="post" action="/admin/products/new" class="form">${csrf(s)}<div class="field"><label for="name">Product name</label><input id="name" name="name" maxlength="150" required></div>
<div class="field"><label for="slug">Web address name (optional; letters, numbers, hyphens)</label><input id="slug" name="slug" maxlength="80" placeholder="made from the name if blank"></div>
<div class="field"><label for="summary">Short description (max 160 characters)</label><input id="summary" name="summary" maxlength="160"></div>
<div class="field"><label for="description">Description</label><textarea id="description" name="description" rows="5" maxlength="4000"></textarea></div>
<div class="field"><label for="category_id">Category</label><select id="category_id" name="category_id"><option value="">None</option>${cats.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
<div class="field"><label for="status">Visibility</label><select id="status" name="status"><option value="draft">Inactive (hidden) for now</option><option value="published">Active (visible in the shop)</option></select></div>
<label><input type="checkbox" name="is_development" value="1"> Test product only (hidden from customers)</label>
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
    insertVariant(id, readVariant(ctx.body)); edited(id);
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
    q.run('INSERT INTO product_images(product_id,url,alt,sort_order) VALUES(?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM product_images WHERE product_id=?))', id, `/uploads/${name}`, String(ctx.body.alt || '').trim().slice(0, 150), id); edited(id);
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Image uploaded.' });
  }));
  route('POST', '/admin/products/:id/image-url', guard((ctx) => {
    const id = Number(ctx.params.id); ctx.back = `/admin/products/${id}`;
    if (!q.get('SELECT 1 x FROM products WHERE id=?', id)) return h.send(ctx, 404, h.notFound(ctx));
    let u; try { u = new URL(String(ctx.body.url || '').trim()); } catch { throw new UserError('Enter a full web address starting with https://'); }
    if (u.protocol !== 'https:' || !cfg.imageHosts.includes(u.origin)) throw new UserError(`Images by link must come from an allowed host (${cfg.imageHosts.join(', ') || 'none configured'}). Otherwise upload the photo instead.`);
    q.run('INSERT INTO product_images(product_id,url,alt,sort_order) VALUES(?,?,?,(SELECT COALESCE(MAX(sort_order),-1)+1 FROM product_images WHERE product_id=?))', id, u.href, String(ctx.body.alt || '').trim().slice(0, 150), id);
    edited(id);
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Image link added.' });
  }));
  route('POST', '/admin/products/:id/images/:img/delete', guard((ctx) => {
    const id = Number(ctx.params.id); ctx.back = `/admin/products/${id}`;
    const im = q.get('SELECT * FROM product_images WHERE id=? AND product_id=?', Number(ctx.params.img), id); if (!im) throw new UserError('Image not found.');
    q.run('DELETE FROM product_images WHERE id=?', im.id); edited(id);
    if (im.url.startsWith('/uploads/') && !q.get('SELECT 1 x FROM product_images WHERE url=?', im.url)) { try { fs.unlinkSync(path.join(cfg.uploadDir, path.basename(im.url))); } catch { /* already gone */ } }
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Image removed.' });
  }));
  route('POST', '/admin/products/:id/images/:img/main', guard((ctx) => {
    const id = Number(ctx.params.id); ctx.back = `/admin/products/${id}`;
    tx(() => { q.run('UPDATE product_images SET sort_order=sort_order+1 WHERE product_id=?', id); q.run('UPDATE product_images SET sort_order=0 WHERE id=? AND product_id=?', Number(ctx.params.img), id); }); edited(id);
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

  if (cfg.supplierIntegration) route('GET', '/admin/supplier', guard((ctx, s) => {
    const rows = q.all(`SELECT m.*, v.sku, p.name FROM supplier_mappings m JOIN variants v ON v.id=m.variant_id JOIN products p ON p.id=v.product_id ORDER BY (m.sync_status='error') DESC, m.id DESC LIMIT 200`);
    h.send(ctx, 200, page(ctx, s, 'supplier', 'Supplier sync', `<p>CJdropshipping API: ${cj.isConfigured() ? 'key present, <strong>not yet tested against a live account</strong>' : '<strong>not configured</strong>'}.</p>` + dt(rows, [['Product', (r) => esc(r.name) + ' ' + esc(r.sku)], ['CJ variant', (r) => esc(r.supplier_variant_id || 'unmapped')], ['Status', (r) => esc(r.sync_status)], ['Last synced', (r) => when(r.last_synced_at)], ['Error', (r) => esc(r.last_error || '')], ['', (r) => r.supplier_variant_id && cj.isConfigured() ? `<form method="post" action="/admin/supplier/${r.variant_id}/sync" class="inline">${csrf(s)}<button class="btn btn-small btn-outline" type="submit">Check CJ</button></form>` : '']])));
  }));
  if (cfg.supplierIntegration) route('POST', '/admin/supplier/:id/sync', guard(async (ctx) => {
    ctx.back = '/admin/supplier'; const r = await cj.syncVariant(Number(ctx.params.id));
    h.redirect(ctx, ctx.back, r.ok ? { type: 'ok', text: 'Supplier record checked.' } : { type: 'error', text: `Supplier check failed: ${r.error}` });
  }));
  // Product photos: the owner confirms, product by product, that the installed photo really shows the product being sold.
  route('GET', '/admin/settings', guard((ctx, s) => {
    const demo = cleanup.removeDemoCatalogue({ dryRun: true });
    h.send(ctx, 200, page(ctx, s, 'settings', 'Settings', `<form method="post" action="/admin/settings" class="form card-a">${csrf(s)}<h2>How orders work</h2>
<fieldset class="opts"><legend>When should customers pay?</legend>
<label class="opt"><input type="radio" name="payment_timing" value="review_first"${settings.paymentTiming() === 'review_first' ? ' checked' : ''}><span><strong>Review first (recommended for market sourcing)</strong><small>The customer places the order without paying. You check the exact items in the market, then click "request payment". Fewer refunds.</small></span></label>
<label class="opt"><input type="radio" name="payment_timing" value="pay_first"${settings.paymentTiming() === 'pay_first' ? ' checked' : ''}><span><strong>Pay at checkout</strong><small>The customer pays immediately. If an exact item cannot be found, you contact them and refund what you cannot supply.</small></span></label></fieldset>
<div class="field"><label for="days">Estimated delivery: calendar days after confirmation</label><input id="days" name="delivery_days" inputmode="numeric" value="${settings.deliveryDays()}" maxlength="2"><p class="small muted">An order is confirmed when its payment is verified. Each order keeps the date calculated at its confirmation (changing this only affects new confirmations). Timezone: ${esc(cfg.timezone)}.</p></div>
<div class="field"><label for="oe">Email me about new orders and payments (optional)</label><input id="oe" name="owner_email" type="email" value="${esc(settings.ownerEmail())}" placeholder="${esc(cfg.company.email)}"><p class="small muted">${notify.isConfigured() ? 'Email service is configured.' : 'Emails are not sent until RESEND_API_KEY and EMAIL_FROM are set (see README).'}</p></div>
<p class="small muted">Changes apply to new orders only; existing orders keep their own payment timing.</p><button class="btn" type="submit">Save settings</button></form>
<div class="card-a" id="images"><h2>Product images</h2>${(() => { const st = images.stats(); return `<p><strong>${st.verified}</strong> of ${st.active} active products have a verified working image. ${st.unchecked ? `${st.unchecked} not checked yet. ` : ''}${st.needImage.length ? `<strong>${st.needImage.length} show a category placeholder</strong> (no working image): <a href="/admin/products?images=missing">see list</a>. ` : ''}${st.remoteOnly ? `${st.remoteOnly} still load images from another website (not yet saved here).` : 'All images are stored on this server.'}</p>`; })()}
<p class="small muted">Photos you upload are already stored on this server. Only if a product links to a photo on another website: "Save permanent copies" downloads it once and stores it on this server's disk (on Railway: the /data volume), so the shop no longer depends on the other website. Run "Check images" afterwards to confirm every image opens.</p>
<form method="post" action="/admin/settings/images" class="inline-form">${csrf(s)}<button class="btn" type="submit" name="action" value="download">Save permanent copies</button><button class="btn btn-outline" type="submit" name="action" value="check">Check images</button></form></div>
<div class="card-a" id="demo"><h2>Remove old demo catalogue</h2>${demo.deleted || cleanup.demoProductCount() ? `<p>This database still contains <strong>${demo.demoProductsFound}</strong> product(s) from the old demonstration catalogue (DummyJSON imports and built-in samples) and ${demo.categoriesRemoved.length} demo categor${demo.categoriesRemoved.length === 1 ? 'y' : 'ies'}.</p>
<p class="small muted">A backup copy of the database is saved first. ${demo.archivedBecauseInOrders ? `${demo.archivedBecauseInOrders} of them appear in customer orders: those are archived (hidden), not deleted, so the orders stay complete. ` : ''}Orders, payments, refunds, admin accounts, delivery zones and settings are not touched. Photos you uploaded yourself are kept.</p>
<form method="post" action="/admin/settings/remove-demo" class="inline-form">${csrf(s)}<label class="small"><input type="checkbox" name="confirm" value="yes" required> Yes, remove the old demo catalogue permanently</label><button class="btn btn-outline" type="submit">Remove demo catalogue</button></form>` : `<p>No demonstration products are left. The catalogue contains only products you add.${demo.archivedBecauseInOrders ? ` (${demo.archivedBecauseInOrders} old demo product(s) are kept archived, hidden from the shop, only because they appear in customer orders.)` : ''}</p>`}</div>`));
  }));
  route('POST', '/admin/settings', guard((ctx) => {
    ctx.back = '/admin/settings'; const b = ctx.body;
    if (!['review_first', 'pay_first'].includes(b.payment_timing)) throw new UserError('Choose when customers pay.');
    const d = String(b.delivery_days || '').trim(); if (!/^\d{1,2}$/.test(d) || +d < 1 || +d > 90) throw new UserError('Delivery days must be a whole number from 1 to 90.');
    const oe = String(b.owner_email || '').trim().toLowerCase(); if (oe && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(oe)) throw new UserError('Enter a valid email address or leave it blank.');
    settings.set('payment_timing', b.payment_timing); settings.set('delivery_days', d); settings.set('owner_email', oe);
    h.redirect(ctx, ctx.back, { type: 'ok', text: 'Settings saved.' });
  }));
  route('POST', '/admin/settings/images', guard(async (ctx) => {
    ctx.back = '/admin/settings#images';
    if (!rateLimit(`img:${ctx.ip}`, 6, 10 * 60 * 1000)) throw new UserError('Please wait a few minutes before running this again.');
    if (ctx.body.action === 'download') {
      const r = await images.downloadAll(); const c = await images.checkAll();
      return h.redirect(ctx, ctx.back, { type: r.failed ? 'error' : 'ok', text: `Images: ${r.saved} saved, ${r.reused} already saved, ${r.failed} could not be downloaded${r.errors[0] ? ` (e.g. ${r.errors[0].slice(0, 120)})` : ''}. Check: ${c.ok} working, ${c.broken} broken.` });
    }
    const c = await images.checkAll();
    h.redirect(ctx, ctx.back, { type: c.broken ? 'error' : 'ok', text: `Checked ${c.checked} image(s): ${c.ok} working, ${c.broken} broken (broken ones are replaced by the category placeholder).` });
  }));
  route('POST', '/admin/settings/remove-demo', guard((ctx) => {
    ctx.back = '/admin/settings#demo'; if (ctx.body.confirm !== 'yes') throw new UserError('Tick the box to confirm.');
    const r = cleanup.removeDemoCatalogue();
    h.redirect(ctx, ctx.back, { type: 'ok', text: `Demo catalogue removed: ${r.deleted} product(s) deleted, ${r.archivedBecauseInOrders} archived because they appear in orders, ${r.categoriesRemoved.length} categor${r.categoriesRemoved.length === 1 ? 'y' : 'ies'} removed. Active products now: ${r.activeProductsAfter}.${r.backup ? ' A backup of the database was saved first.' : ''}` });
  }));
}
module.exports = { register, LABEL };
