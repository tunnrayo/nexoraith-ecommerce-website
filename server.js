'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const cfg = require('./src/config');
const db = require('./src/db');
const { esc, rand, safeEqual, parseCookies, cookie, rateLimit, clientIp } = require('./src/security');
const { UserError } = require('./src/errors');
const catalog = require('./src/catalog');
const cart = require('./src/cart');
const orders = require('./src/orders');
const validate = require('./src/validate');
const views = require('./src/views');
const admin = require('./src/admin');
const paystack = require('./src/payments/paystack');
const { q } = require('./src/db');
const multipart = require('./src/multipart');
const settings = require('./src/settings');
const dd = require('./src/delivery-date');

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2' };
const routes = [];
function route(method, pattern, handler) {
  const names = []; const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, names, handler });
}
const SECURITY_HEADERS = {
  'Content-Security-Policy': `default-src 'self'; img-src ${["'self'", 'data:', ...cfg.imageHosts].join(' ')}; style-src 'self'; script-src 'self'; form-action 'self' https://*.paystack.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`,
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};
if (cfg.isProd) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';

function send(ctx, status, body, type = 'text/html; charset=utf-8', extra = {}) {
  const { res } = ctx;
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS, ...extra };
  // Plain-text and XML responses (robots.txt, sitemap.xml, webhooks) contain no scripts; a page-style CSP only stops the browser's own viewer styling them.
  if (!/^text\/html/.test(type)) headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'";
  if (ctx.setCookies.length) headers['Set-Cookie'] = ctx.setCookies;
  res.writeHead(status, headers); res.end(ctx.method === 'HEAD' ? undefined : body);
}
function redirect(ctx, loc, flash) {
  if (flash) ctx.setCookies.push(cookie('nx_flash', JSON.stringify(flash), { maxAge: 60 }));
  send(ctx, 303, '', 'text/plain', { Location: loc });
}
const localPath = (p, fallback) => (typeof p === 'string' && /^\/(?![/\\])/.test(p) ? p : fallback);
const checkCsrf = (ctx) => !!ctx.cookies.nx_csrf && safeEqual(ctx.body?._csrf || '', ctx.cookies.nx_csrf);
const helpers = { send, redirect, checkCsrf, csrfField: views.csrfField, errorPage: (c, m) => views.errorPage(c, m), notFound: (c) => views.notFound(c) };

function readBody(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function serveStatic(ctx) {
  let rel; try { rel = decodeURIComponent(ctx.path); } catch { return false; }
  // Admin-uploaded product images live outside /public (in the persistent data folder).
  const up = rel.startsWith('/uploads/');
  const rootDir = up ? cfg.uploadDir : PUBLIC;
  const file = path.normalize(path.join(rootDir, up ? rel.slice(9) : rel));
  if (!file.startsWith(rootDir + path.sep)) return false;
  if (up && !/\.(png|jpg|webp)$/i.test(file)) return false;
  let st; try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const type = MIME[path.extname(file).toLowerCase()];
  if (!type) return false;
  // Caching: uploaded/downloaded images have unique names that never change -> cache for a year.
  // Other images and fonts: a week. CSS/JS: an hour (so design updates show quickly). Browsers revalidate with Last-Modified.
  const cache = up ? 'public, max-age=31536000, immutable' : /^\/(img|images|fonts)\//.test(rel) ? 'public, max-age=604800' : 'public, max-age=3600';
  const lastMod = st.mtime.toUTCString();
  if (ctx.req.headers['if-modified-since'] === lastMod) { ctx.res.writeHead(304, { 'Cache-Control': cache, 'Last-Modified': lastMod }); ctx.res.end(); return true; }
  ctx.res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache, 'Last-Modified': lastMod, 'X-Content-Type-Options': 'nosniff' });
  if (ctx.method === 'HEAD') ctx.res.end(); else fs.createReadStream(file).pipe(ctx.res);
  return true;
}

// ---------- public routes ----------
route('GET', '/', (ctx) => send(ctx, 200, views.home(ctx, { cats: catalog.categories(), featured: catalog.featured(8) })));
route('GET', '/shop', (ctx) => {
  const sp = ctx.url.searchParams;
  const query = { search: (sp.get('q') || '').trim().slice(0, 80), category: sp.get('category') || '', sort: catalog.SORTS[sp.get('sort')] ? sp.get('sort') : 'newest', page: sp.get('page') || '1' };
  ctx.search = query.search;
  const res = catalog.listProducts(query);
  send(ctx, 200, views.shop(ctx, { res, cats: catalog.categories(), current: query.category ? catalog.category(query.category) : null, query: { ...query, q: query.search } }));
});
route('GET', '/category/:slug', (ctx) => redirect(ctx, `/shop?category=${encodeURIComponent(ctx.params.slug)}`));
route('GET', '/product/:slug', (ctx) => {
  const p = catalog.getProduct(ctx.params.slug);
  if (!p) return send(ctx, 404, views.notFound(ctx));
  send(ctx, 200, views.product(ctx, p, catalog.related(p), zones(), checkoutInfo()));
});
for (const slug of Object.keys(views.PAGES)) route('GET', `/${slug}`, (ctx) => send(ctx, 200, views.infoPage(ctx, slug, { zones: zones(), days: settings.deliveryDays() })));

function needCsrf(ctx) { if (!checkCsrf(ctx)) { send(ctx, 403, views.errorPage(ctx, 'Your session expired. Please go back, reload the page and try again.')); return false; } return true; }
function withCart(ctx) {
  if (!ctx.cartToken) { ctx.cartToken = cart.ensureCart(ctx.cookies.nx_cart); ctx.setCookies.push(cookie('nx_cart', ctx.cartToken, { maxAge: 60 * 60 * 24 * 30 })); }
  return ctx.cartToken;
}
route('GET', '/cart', (ctx) => { const ls = ctx.cartToken ? cart.lines(ctx.cartToken) : []; send(ctx, 200, views.cartPage(ctx, ls, cart.totals(ls), zones())); });
route('POST', '/cart/add', (ctx) => {
  if (!needCsrf(ctx)) return;
  const back = localPath(ctx.body.back, '/cart');
  try { cart.add(withCart(ctx), ctx.body.variant_id, ctx.body.quantity); redirect(ctx, '/cart', { type: 'ok', text: 'Added to your cart.' }); }
  catch (e) { if (e instanceof UserError) return redirect(ctx, back, { type: 'error', text: e.message }); throw e; }
});
route('POST', '/cart/update', (ctx) => {
  if (!needCsrf(ctx)) return;
  try { cart.setQty(withCart(ctx), ctx.body.variant_id, ctx.body.quantity); redirect(ctx, '/cart', { type: 'ok', text: 'Cart updated.' }); }
  catch (e) { if (e instanceof UserError) return redirect(ctx, '/cart', { type: 'error', text: e.message }); throw e; }
});
route('POST', '/cart/remove', (ctx) => { if (!needCsrf(ctx)) return; cart.remove(withCart(ctx), ctx.body.variant_id); redirect(ctx, '/cart', { type: 'ok', text: 'Item removed.' }); });

// What the checkout page says about timing: payment flow + the 10-day estimate if confirmed today.
function checkoutInfo() { const d = settings.deliveryDays(); return { timing: settings.paymentTiming(), days: d, ifToday: dd.formatDate(dd.estimate(new Date(), d)) }; }
function zones() { return q.all('SELECT * FROM delivery_zones WHERE active=1 ORDER BY id'); }
// Payment methods offered at checkout. Paystack is always the customer-facing method; "demo" never takes money.
function methods() { return cfg.demoCheckout ? ['paystack', 'demo'] : ['paystack']; } // demo option only when DEMO_CHECKOUT=true (testing)
route('GET', '/checkout', (ctx) => {
  const ls = ctx.cartToken ? cart.lines(ctx.cartToken) : [];
  if (!ls.length) return redirect(ctx, '/cart', { type: 'error', text: 'Your cart is empty.' });
  if (ls.some((l) => l.problem)) return redirect(ctx, '/cart', { type: 'error', text: 'Some items need attention before checkout.' });
  const zs = zones();
  if (!zs.length) return send(ctx, 200, views.errorPage(ctx, 'Checkout is not available yet: no delivery destinations have been set up.'));
  send(ctx, 200, views.checkoutPage(ctx, ls, zs, {}, {}, rand(18), methods(), paystack.isConfigured(), checkoutInfo()));
});
route('POST', '/checkout', async (ctx) => {
  if (!needCsrf(ctx)) return;
  if (!rateLimit(`co:${ctx.ip}`, 15, 10 * 60 * 1000)) return send(ctx, 429, views.errorPage(ctx, 'Too many attempts. Please wait a few minutes and try again.'));
  const zs = zones(); const ms = methods(); const { v, e, ok } = validate.checkout(ctx.body, zs, ms);
  const key = /^[A-Za-z0-9_-]{16,64}$/.test(ctx.body.checkout_key || '') ? ctx.body.checkout_key : rand(18);
  const ls = ctx.cartToken ? cart.lines(ctx.cartToken) : [];
  if (!ls.length) return redirect(ctx, '/cart', { type: 'error', text: 'Your cart is empty.' });
  if (!ok) return send(ctx, 422, views.checkoutPage(ctx, ls, zs, { ...v, zone_id: v.zone_id }, e, key, ms, paystack.isConfigured(), checkoutInfo()));
  try {
    const { order, duplicate } = orders.createOrder(ctx.cartToken, v, key);
    if (!duplicate) await orders.afterCreate(order);
    const text = order.status === 'pending_review' ? 'Order received. We will check your exact items and send you a payment link. You have not been charged.' : order.payment_method === 'demo' ? 'Demonstration order saved. Review it below and complete the demonstration.' : 'Order saved. Please review the total below and pay to confirm it.';
    redirect(ctx, `/order/${order.reference}?t=${orders.accessToken(order.reference)}`, { type: 'ok', text });
  } catch (err) {
    if (err instanceof UserError) return redirect(ctx, err.code === 'cart_problem' ? '/cart' : '/checkout', { type: 'error', text: err.message });
    throw err;
  }
});
function loadOrder(ctx) {
  const o = orders.byReference(ctx.params.ref);
  const t = ctx.url.searchParams.get('t') || ctx.body?.t;
  return o && orders.tokenOk(o.reference, t) ? { o, t } : null;
}
route('GET', '/order/:ref', (ctx) => {
  const r = loadOrder(ctx); if (!r) return send(ctx, 404, views.notFound(ctx));
  ctx.statusText = orders.customerStatus(r.o);
  const L = orders.LABEL;
  ctx.labels = { order: L.status[r.o.status], payment: r.o.payment_method === 'demo' ? 'Demonstration: no payment taken' : L.payment[r.o.payment_status], fulfil: L.fulfil[r.o.fulfillment_status] };
  send(ctx, 200, views.orderPage(ctx, r.o, orders.items(r.o.id), r.t, { events: orders.events(r.o.id, true), canPay: orders.canPay(r.o) && paystack.isConfigured(), payConfigured: paystack.isConfigured(), days: settings.deliveryDays() }));
});
route('POST', '/order/:ref/pay', async (ctx) => {
  if (!needCsrf(ctx)) return;
  const r = loadOrder(ctx); if (!r) return send(ctx, 404, views.notFound(ctx));
  const back = `/order/${r.o.reference}?t=${r.t}`;
  if (!rateLimit(`pay:${ctx.ip}`, 10, 10 * 60 * 1000)) return redirect(ctx, back, { type: 'error', text: 'Too many attempts. Please wait a few minutes.' });
  try { redirect(ctx, await orders.startPayment(r.o)); }
  catch (e) { if (e instanceof UserError) return redirect(ctx, back, { type: 'error', text: e.message }); throw e; }
});
route('POST', '/order/:ref/demo-confirm', (ctx) => {
  if (!needCsrf(ctx)) return;
  const r = loadOrder(ctx); if (!r) return send(ctx, 404, views.notFound(ctx));
  const back = `/order/${r.o.reference}?t=${r.t}`;
  try { orders.confirmDemo(r.o); redirect(ctx, back, { type: 'ok', text: 'Demonstration order complete. No payment was taken.' }); }
  catch (e) { if (e instanceof UserError) return redirect(ctx, back, { type: 'error', text: e.message }); throw e; }
});
route('GET', '/track', (ctx) => send(ctx, 200, views.trackPage(ctx)));
route('POST', '/track', (ctx) => {
  if (!needCsrf(ctx)) return;
  if (!rateLimit(`tr:${ctx.ip}`, 10, 10 * 60 * 1000)) return send(ctx, 429, views.errorPage(ctx, 'Too many attempts. Please wait a few minutes and try again.'));
  const o = orders.lookup(ctx.body.reference, ctx.body.email);
  if (!o) return send(ctx, 404, views.trackPage(ctx, { reference: String(ctx.body.reference || '').slice(0, 40), email: String(ctx.body.email || '').slice(0, 254) }, 'We could not find an order with that reference and email address. Check both and try again.'));
  redirect(ctx, `/order/${o.reference}?t=${orders.accessToken(o.reference)}`);
});
// Paystack sends the customer back here. The redirect itself proves NOTHING: we verify with Paystack server-side.
route('GET', '/payment/callback', async (ctx) => {
  const ref = String(ctx.url.searchParams.get('reference') || ctx.url.searchParams.get('trxref') || '').slice(0, 120);
  const pay = ref && q.get('SELECT * FROM payments WHERE reference=?', ref);
  if (!pay) return send(ctx, 404, views.notFound(ctx));
  const order = q.get('SELECT * FROM orders WHERE id=?', pay.order_id);
  const back = `/order/${order.reference}?t=${orders.accessToken(order.reference)}`;
  let flash = { type: 'ok', text: 'We are confirming your payment with the payment provider. This page updates once it is verified.' };
  try {
    const result = orders.applyPaymentResult(ref, await paystack.verify(ref));
    await orders.afterPayment(result);
    if (result.ok) flash = { type: 'ok', text: 'Payment verified. Thank you!' };
    else if (result.reason === 'mismatch') flash = { type: 'error', text: 'We could not match your payment to this order. Please contact us with your order reference.' };
    else if (result.reason === 'failed' || result.reason === 'abandoned') flash = { type: 'error', text: 'The payment was not completed.' };
  } catch (err) { console.error('verify failed:', err.message); }
  redirect(ctx, back, flash);
});
route('POST', '/webhooks/paystack', async (ctx) => {
  const raw = ctx.raw || Buffer.alloc(0);
  if (!paystack.verifySignature(raw, ctx.req.headers['x-paystack-signature'])) return send(ctx, 401, 'invalid signature', 'text/plain');
  let evt; try { evt = JSON.parse(raw.toString('utf8')); } catch { return send(ctx, 400, 'bad json', 'text/plain'); }
  try { await orders.afterPayment(orders.handleWebhook(evt)); } catch (err) { console.error('webhook error:', err.message); return send(ctx, 500, 'error', 'text/plain'); }
  send(ctx, 200, 'ok', 'text/plain');
});
route('GET', '/contact', (ctx) => send(ctx, 200, views.contactPage(ctx)));
route('POST', '/contact', (ctx) => {
  if (!needCsrf(ctx)) return;
  if (ctx.body.website) return send(ctx, 200, views.contactPage(ctx, {}, {}, true)); // honeypot: pretend success
  if (!rateLimit(`ct:${ctx.ip}`, 5, 10 * 60 * 1000)) return send(ctx, 429, views.errorPage(ctx, 'Too many messages. Please try again later.'));
  const { v, e, ok } = validate.contact(ctx.body);
  if (!ok) return send(ctx, 422, views.contactPage(ctx, v, e));
  q.run('INSERT INTO inquiries(name,email,subject,message) VALUES(?,?,?,?)', v.name, v.email, v.subject, v.message);
  send(ctx, 200, views.contactPage(ctx, {}, {}, true));
});
route('GET', '/health', (ctx) => { q.get('SELECT 1 x'); send(ctx, 200, JSON.stringify({ ok: true }), 'application/json'); });
route('GET', '/robots.txt', (ctx) => send(ctx, 200, `User-agent: *\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nDisallow: /order/\nDisallow: /payment/\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`, 'text/plain; charset=utf-8'));
route('GET', '/sitemap.xml', (ctx) => {
  const urls = ['/', '/shop', '/about', '/contact', '/faq', '/shipping', '/returns', '/privacy', '/terms'];
  // every active catalogue product (not just the first page)
  for (const p of q.all("SELECT slug FROM products WHERE status='published' AND availability<>'discontinued' AND is_development=0 ORDER BY id")) urls.push(`/product/${p.slug}`);
  for (const c of catalog.categories()) urls.push(`/shop?category=${encodeURIComponent(c.slug)}`);
  send(ctx, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(cfg.siteUrl + u)}</loc></url>`).join('')}</urlset>`, 'application/xml');
});
admin.register(route, helpers);

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const ctx = { req, res, url, path: url.pathname, method: req.method, cookies: parseCookies(req.headers.cookie), setCookies: [], params: {}, body: {}, ip: clientIp(req) };
  try {
    if ((ctx.method === 'GET' || ctx.method === 'HEAD') && serveStatic(ctx)) return;
    const fits = (r) => (r.method === ctx.method || (ctx.method === 'HEAD' && r.method === 'GET')) && r.re.test(ctx.path);
    const m = routes.find((r) => !r.names.length && fits(r)) || routes.find(fits); // exact paths (e.g. /admin/products/new) win over :params
    if (!m) { prepare(ctx); return send(ctx, 404, views.notFound(ctx)); }
    const mm = ctx.path.match(m.re); m.names.forEach((n, i) => { try { ctx.params[n] = decodeURIComponent(mm[i + 1]); } catch { ctx.params[n] = ''; } });
    if (ctx.method === 'POST') {
      const ct = String(req.headers['content-type'] || '');
      const upload = /^\/admin\/products\/\d+\/images$/.test(ctx.path) && /^multipart\/form-data/i.test(ct);
      ctx.raw = await readBody(req, ctx.path === '/webhooks/paystack' ? 1024 * 1024 : upload ? 6 * 1024 * 1024 : 100 * 1024);
      if (upload) { const mp = multipart.parse(ctx.raw, ct); ctx.body = mp.fields; ctx.files = mp.files; }
      else if (ctx.path !== '/webhooks/paystack') ctx.body = Object.fromEntries(new URLSearchParams(ctx.raw.toString('utf8')));
    }
    prepare(ctx);
    await m.handler(ctx);
  } catch (err) {
    if (err.status === 413) return send(ctx, 413, 'Request too large (images must be under 5 MB).', 'text/plain');
    if (err.status === 400) return send(ctx, 400, 'Bad request', 'text/plain');
    console.error(`[error] ${ctx.method} ${ctx.path}: ${err.message}`);
    if (!res.headersSent) { try { send(ctx, 500, views.errorPage(ctx)); } catch { res.end(); } }
  }
}
// Fills in per-request values the templates need: cart count, CSRF token, one-time flash message.
function prepare(ctx) {
  ctx.cartToken = ctx.cookies.nx_cart && /^[A-Za-z0-9_-]{20,64}$/.test(ctx.cookies.nx_cart) && q.get('SELECT 1 x FROM carts WHERE token=?', ctx.cookies.nx_cart) ? ctx.cookies.nx_cart : null;
  ctx.cartCount = cart.count(ctx.cartToken);
  ctx.csrf = ctx.cookies.nx_csrf || rand(24);
  if (!ctx.cookies.nx_csrf) ctx.setCookies.push(cookie('nx_csrf', ctx.csrf));
  if (ctx.cookies.nx_flash && ctx.method !== 'POST') {
    try { const f = JSON.parse(ctx.cookies.nx_flash); if (['ok', 'error'].includes(f.type)) ctx.flash = { type: f.type, text: String(f.text).slice(0, 300) }; } catch { /* ignore */ }
    ctx.setCookies.push(cookie('nx_flash', '', { maxAge: 0 }));
  }
}
function createServer() { db.open(); return http.createServer(handle); }
module.exports = { createServer };
if (require.main === module) {
  if (cfg.isProd && paystack.mode() === 'test') console.warn('WARNING: production mode but Paystack TEST key in use.');
  if (cfg.isProd && cfg.demoMode) console.warn('NOTICE: DEMO_MODE is ON in production: checkout accepts delivery fees not yet marked confirmed.');
  require('./src/bootstrap').bootstrap();
  createServer().listen(cfg.port, () => { console.log(`Nexoraith store running at ${cfg.siteUrl} (${cfg.isProd ? 'production' : 'development'})`); const demo = require('./src/catalog-cleanup').demoProductCount(); if (demo) console.log(`[setup] This database still contains ${demo} old demonstration product(s). Remove them with "npm run catalogue:remove-demo" or Admin > Settings > Remove old demo catalogue.`); });
}
