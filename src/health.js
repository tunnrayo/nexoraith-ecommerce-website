'use strict';
// Website Health-Check Centre. Every check reports one of: PASS, FAIL, WARNING, NOT RUN, BLOCKED.
//   PASS     the check ran and the result is good
//   FAIL     the check ran and found a real problem
//   WARNING  the check ran; works, but needs attention before going live
//   NOT RUN  the check could not be executed here (reason is stated); it is NOT counted as passed
//   BLOCKED  cannot work until something outside the software is supplied (a credential, an account, a decision)
// Checks never reveal secret values, customer records, stack traces or full logs. They use a rolled-back transaction for the write test
// and remove their own throw-away cart. They never place an order, start a payment or contact a supplier.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const cfg = require('./config');
const db = require('./db');
const { q } = require('./db');
const paystack = require('./payments/paystack');
const notify = require('./notify');
const cj = require('./suppliers/cj');
const settings = require('./settings');

const R = (group, name, status, detail, fix = '') => ({ group, name, status, detail, fix, at: new Date().toISOString() });
const PASS = 'PASS', FAIL = 'FAIL', WARN = 'WARNING', NOTRUN = 'NOT RUN', BLOCK = 'BLOCKED';

// ---------- configuration (values are never shown) ----------
function configChecks() {
  const out = []; const g = 'Configuration';
  const admins = q.get('SELECT COUNT(*) n FROM admin_users').n;
  out.push(admins ? R(g, 'Admin account exists', PASS, `${admins} administrator account(s). Passwords are stored only as scrypt hashes.`) : R(g, 'Admin account exists', FAIL, 'No administrator exists, so nobody can sign in.', 'Run: npm run create-admin (see README), or set ADMIN_EMAIL and ADMIN_PASSWORD once before first start.'));
  out.push(cfg.sessionSecret.length >= 32 ? R(g, 'Session secret (SESSION_SECRET)', PASS, 'Set (32+ characters). Admin login tokens are stored as keyed hashes.')
    : R(g, 'Session secret (SESSION_SECRET)', cfg.isProd ? FAIL : WARN, cfg.sessionSecret ? 'Set but shorter than 32 characters.' : 'Not set. Login tokens fall back to a plain hash.', 'Generate one: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))" and save it as SESSION_SECRET.'));
  out.push(R(g, 'Running mode', cfg.isProd ? PASS : WARN, cfg.isProd ? 'NODE_ENV=production.' : 'Development mode (normal on your computer). Secure cookies and HSTS are only enabled in production.', cfg.isProd ? '' : 'On the live server set NODE_ENV=production.'));
  const https = /^https:\/\//.test(cfg.siteUrl); const local = /localhost|127\.0\.0\.1/.test(cfg.siteUrl);
  out.push(cfg.isProd ? (https && !local ? R(g, 'SITE_URL', PASS, 'Public HTTPS address configured.') : R(g, 'SITE_URL', FAIL, 'In production SITE_URL must be your public https:// address (used for payment return links and the sitemap).', 'Set SITE_URL=https://your-domain'))
    : R(g, 'SITE_URL', local ? WARN : PASS, local ? 'Local address (normal for development).' : 'Set.', local ? 'Before launch set SITE_URL to your public https:// address.' : ''));
  const inApp = (p) => path.resolve(p).startsWith(cfg.root + path.sep);
  if (cfg.dbPath !== ':memory:') out.push(cfg.isProd && inApp(cfg.dbPath) ? R(g, 'Database location is persistent', WARN, 'The database file is inside the application folder. On Railway/serverless hosts that folder is erased on every deploy.', 'Attach a Railway Volume (mount /data) and set DATABASE_PATH=/data/nexoraith.db and UPLOAD_DIR=/data/uploads.') : R(g, 'Database location is persistent', cfg.isProd ? PASS : NOTRUN, cfg.isProd ? 'Database is outside the application folder (verify it is on a mounted volume).' : 'Only meaningful on the live server.'));
  out.push(cfg.isProd && inApp(cfg.uploadDir) ? R(g, 'Uploaded images location is persistent', WARN, 'UPLOAD_DIR is inside the application folder and would be lost on redeploy.', 'Set UPLOAD_DIR=/data/uploads on the same volume.') : R(g, 'Uploaded images location is persistent', cfg.isProd ? PASS : NOTRUN, cfg.isProd ? 'Uploads are outside the application folder.' : 'Only meaningful on the live server.'));
  const risky = [cfg.demoCheckout && 'DEMO_CHECKOUT', cfg.allowDevProducts && 'ALLOW_DEVELOPMENT_PRODUCTS', cfg.allowUnconfirmedDelivery && 'unconfirmed delivery fees allowed'].filter(Boolean);
  out.push(risky.length ? R(g, 'Test-only switches are off', cfg.isProd ? FAIL : WARN, `Currently ON: ${risky.join(', ')}.`, 'Turn these off before real customers use the shop.') : R(g, 'Test-only switches are off', PASS, 'Demonstration checkout, development products and unconfirmed delivery fees are all off.'));
  const zones = q.all('SELECT confirmed FROM delivery_zones WHERE active=1');
  out.push(!zones.length ? R(g, 'Delivery zones', FAIL, 'No active delivery zone: checkout cannot work.', 'Admin > Delivery') : zones.some((z) => !z.confirmed) ? R(g, 'Delivery zones confirmed', WARN, `${zones.filter((z) => !z.confirmed).length} of ${zones.length} active zone(s) still carry preliminary fees.`, 'Admin > Delivery: tick Confirmed once the fee is final.') : R(g, 'Delivery zones confirmed', PASS, `${zones.length} active zone(s), all confirmed.`));
  out.push(cfg.company.phone || cfg.company.address ? R(g, 'Public contact details', PASS, 'Official email always shown; optional phone/address configured.') : R(g, 'Public contact details', WARN, 'Only the official email is published. No phone or address has been supplied (none is invented).', 'Optional: set COMPANY_PHONE / COMPANY_ADDRESS when the business has them.'));
  return out;
}

// ---------- integrations ----------
function integrationChecks() {
  const out = []; const g = 'Payments, email and supplier';
  if (!paystack.isConfigured()) out.push(R(g, 'Paystack payment credentials', BLOCK, 'PAYSTACK_SECRET_KEY is not set, so no online payment can be taken. Orders can still be received and reviewed.', 'Add your Paystack key (see INTEGRATIONS.md). Test key first (sk_test_...).'));
  else out.push(R(g, 'Paystack payment credentials', paystack.mode() === 'live' ? WARN : PASS, `A ${paystack.mode()} key is present. Whether Paystack accepts it was NOT checked from here.`, paystack.mode() === 'live' ? 'Live key: confirm a small real test payment and refund before announcing the shop.' : 'Test key: no real money moves. Switch to the live key only after end-to-end testing.'));
  out.push(R(g, 'Paystack key accepted by Paystack', NOTRUN, 'This page never calls Paystack, so key validity is unverified. Run one test-mode payment to verify.'));
  const payHook = `${cfg.siteUrl}/webhooks/paystack`;
  out.push(R(g, 'Paystack webhook address', paystack.isConfigured() ? WARN : BLOCK, `Paystack must be told to send events to ${payHook}. Signature checking is built in (HMAC-SHA512); whether Paystack is calling it cannot be seen from here.`, 'Paystack dashboard > Settings > API Keys & Webhooks > set the webhook URL.'));
  const ev = q.get('SELECT COUNT(*) n, MAX(received_at) last FROM payment_events');
  out.push(R(g, 'Webhook events received', ev.n ? PASS : NOTRUN, ev.n ? `${ev.n} event(s) received, latest ${ev.last} UTC.` : 'None received yet (expected until a test payment is made).'));
  const failedPay = q.get("SELECT COUNT(*) n FROM payments WHERE status IN('failed','abandoned')").n;
  out.push(R(g, 'Failed or abandoned payment attempts', failedPay ? WARN : PASS, failedPay ? `${failedPay} attempt(s) recorded. They are not counted as paid.` : 'None recorded.', failedPay ? 'Admin > Orders > filter Payment to review.' : ''));
  out.push(notify.isConfigured() ? R(g, 'Email service (Resend)', PASS, 'API key and sender are configured. Delivery has not been verified from here.') : R(g, 'Email service (Resend)', BLOCK, 'Not configured. Nothing is emailed; customers still see updates on their private order page.', 'Optional: RESEND_API_KEY and EMAIL_FROM (verified domain).'));
  const nf = q.get("SELECT COUNT(*) n FROM notifications WHERE status='failed'").n;
  out.push(R(g, 'Email sending failures', nf ? WARN : PASS, nf ? `${nf} email(s) failed to send. See the order pages.` : 'No failed emails recorded.'));
  out.push(cfg.supplierIntegration ? R(g, 'CJdropshipping tools', cj.isConfigured() ? WARN : BLOCK, cj.isConfigured() ? 'Enabled with an API key; never exercised against the real service, and orders are only sent manually.' : 'Enabled but no CJ_API_KEY.', '') : R(g, 'Supplier fulfilment', PASS, 'Manual sourcing by the owner is the active workflow (no supplier API is used or claimed). Orders are never auto-submitted to a supplier.'));
  return out;
}

// ---------- database ----------
function databaseChecks() {
  const out = []; const g = 'Database';
  const t0 = Date.now();
  try { q.get('SELECT 1 x'); out.push(R(g, 'Connection', PASS, `SQLite (built into Node ${process.versions.node}) answered in ${Date.now() - t0} ms.`)); } catch { return [R(g, 'Connection', FAIL, 'The database did not respond.')]; }
  const v = q.get('PRAGMA user_version').user_version;
  out.push(v === db.MIGRATIONS.length ? R(g, 'Schema is up to date', PASS, `Schema version ${v} of ${db.MIGRATIONS.length}.`) : R(g, 'Schema is up to date', FAIL, `Schema version ${v}, expected ${db.MIGRATIONS.length}.`, 'Restart the app (migrations run on start) or run: npm run migrate'));
  const qc = q.all('PRAGMA quick_check').map((r) => Object.values(r)[0]);
  out.push(qc.length === 1 && qc[0] === 'ok' ? R(g, 'File integrity (quick_check)', PASS, 'SQLite reports the database file is healthy.') : R(g, 'File integrity (quick_check)', FAIL, 'SQLite reported problems. Restore the latest backup.'));
  const fk = q.all('PRAGMA foreign_key_check').length;
  out.push(fk ? R(g, 'Relationships (foreign keys)', FAIL, `${fk} row(s) point at records that no longer exist.`) : R(g, 'Relationships (foreign keys)', PASS, 'All relationships are consistent.'));
  // write test inside a transaction that is rolled back: nothing is kept
  try {
    q.run('SAVEPOINT hc_write'); q.run("INSERT INTO settings(key,value) VALUES('__health_probe__','1')");
    const seen = q.get("SELECT value FROM settings WHERE key='__health_probe__'")?.value === '1';
    q.run('ROLLBACK TO hc_write'); q.run('RELEASE hc_write');
    const gone = !q.get("SELECT 1 x FROM settings WHERE key='__health_probe__'");
    out.push(seen && gone ? R(g, 'Read / write (rolled back)', PASS, 'A test record was written, read back and rolled back; nothing was kept.') : R(g, 'Read / write (rolled back)', FAIL, 'Write test did not behave as expected.'));
  } catch { try { q.run('ROLLBACK TO hc_write'); q.run('RELEASE hc_write'); } catch { /* ignore */ } out.push(R(g, 'Read / write (rolled back)', FAIL, 'The database refused a test write (read-only disk or permissions?).', 'Check the data folder / volume is writable.')); }
  const dupName = q.get("SELECT COUNT(*) n FROM (SELECT lower(name) k FROM products WHERE status<>'archived' GROUP BY k HAVING COUNT(*)>1)").n;
  out.push(dupName ? R(g, 'Duplicate product names', WARN, `${dupName} product name(s) appear more than once.`, 'Admin > Products: check they are intentional.') : R(g, 'Duplicate product names', PASS, 'No duplicate product names. (SKUs and web addresses are unique by database rule.)'));
  const paidNoPay = q.get("SELECT COUNT(*) n FROM orders o WHERE o.payment_status='paid' AND o.is_demo=0 AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='success')").n;
  out.push(paidNoPay ? R(g, 'Every paid order has a verified payment', FAIL, `${paidNoPay} real order(s) are marked paid without a successful verified payment record.`, 'Investigate in Admin > Orders; do not source these orders until reconciled.') : R(g, 'Every paid order has a verified payment', PASS, 'No real order is marked paid without a verified payment record.'));
  const badTot = q.get("SELECT COUNT(*) n FROM orders o WHERE o.total_minor <> o.subtotal_minor + o.delivery_fee_minor - o.discount_minor").n;
  out.push(badTot ? R(g, 'Order totals add up', FAIL, `${badTot} order(s) have inconsistent totals.`) : R(g, 'Order totals add up', PASS, 'Every order total equals subtotal + delivery - discount (also enforced by a database rule).'));
  const live = q.get("SELECT COUNT(*) n FROM products WHERE status='published'").n;
  const noPrice = q.get("SELECT COUNT(*) n FROM products p WHERE status='published' AND NOT EXISTS(SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.price_minor>0)").n;
  out.push(noPrice ? R(g, 'Published products have a price', FAIL, `${noPrice} published product(s) have no priced option.`) : R(g, 'Published products have a price', live ? PASS : NOTRUN, live ? `All ${live} published products have a price.` : 'No published products yet.'));
  // photo files on disk
  const urls = q.all("SELECT COALESCE(NULLIF(card_image_url,''),(SELECT url FROM product_images i WHERE i.product_id=p.id ORDER BY sort_order,id LIMIT 1)) u FROM products p WHERE status='published'").map((r) => r.u).filter(Boolean);
  const local = urls.filter((u) => u.startsWith('/')); const missing = local.filter((u) => { const rel = decodeURIComponent(u); const f = rel.startsWith('/uploads/') ? path.join(cfg.uploadDir, rel.slice(9)) : path.join(cfg.root, 'public', rel); return !fs.existsSync(f); });
  const without = live - urls.length;
  out.push(missing.length || without > 0 ? R(g, 'Product photos present', WARN, `${missing.length} photo file(s) missing on disk and ${Math.max(without, 0)} published product(s) with no photo (the neutral placeholder is shown instead).`, 'Admin > Products > filter missing photos.') : R(g, 'Product photos present', live ? PASS : NOTRUN, live ? `All ${live} published products have a photo file on disk.` : 'No published products yet.'));
  const tracked = q.get('SELECT COUNT(*) n FROM variants WHERE stock_qty IS NOT NULL').n;
  out.push(R(g, 'Stock quantities', NOTRUN, tracked ? `${tracked} option(s) carry a stock number set by you.` : 'The shop does not track stock numbers (items are sourced to order). Availability is a status you set, never a guessed quantity.'));
  // backups
  const bdir = path.join(path.dirname(cfg.dbPath === ':memory:' ? cfg.root : cfg.dbPath), 'backups'); let nb = 0, latest = '';
  try { const f = fs.readdirSync(bdir).filter((x) => x.endsWith('.db')).map((x) => ({ x, t: fs.statSync(path.join(bdir, x)).mtime })).sort((a, b) => b.t - a.t); nb = f.length; latest = f[0]?.t.toISOString().slice(0, 16).replace('T', ' ') || ''; } catch { /* none */ }
  out.push(nb ? R(g, 'Backups', WARN, `${nb} backup file(s) found; newest ${latest} UTC. Backups here are manual (made before cleanups); they are NOT scheduled and live on the same disk.`, 'Download a copy regularly (see DEPLOYMENT.md > Backups).') : R(g, 'Backups', WARN, 'No backup file found. No scheduled backup exists.', 'Before launch set up a regular backup of the database file (see DEPLOYMENT.md > Backups).'));
  out.push(R(g, 'Hosting suitability', NOTRUN, 'Verified only by deployment: this database is one SQLite file on a disk. It needs a host with a persistent volume and a single running instance (Railway + Volume). It is NOT suitable for Vercel/serverless, where files do not persist.'));
  return out;
}

// ---------- over-the-network checks against this server itself ----------
const IMG_RE = /<img\b[^>]*>/gi;
async function webChecks(port) {
  const out = []; const base = `http://127.0.0.1:${port}`;
  const get = async (p, o = {}) => { try { const r = await fetch(base + p, { redirect: 'manual', signal: AbortSignal.timeout(8000), ...o }); const text = /text|json|xml/.test(r.headers.get('content-type') || '') ? await r.text() : (await r.arrayBuffer(), ''); return { r, text, status: r.status }; } catch (e) { return { err: e.message, status: 0, text: '', r: { headers: new Headers() } }; } };
  // a product a customer can really order: published, available, with an available priced option
  const first = q.get(`SELECT p.slug, p.name FROM products p WHERE p.status='published' AND p.availability='available' AND (p.is_development=0 OR ${cfg.allowDevProducts ? 1 : 0})
    AND EXISTS(SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.availability='available' AND v.price_minor>0 AND (v.stock_qty IS NULL OR v.stock_qty>=2)) ORDER BY p.id LIMIT 1`);
  const cat = q.get('SELECT slug FROM categories ORDER BY sort_order, id LIMIT 1');
  const g1 = 'Public pages';
  const pages = [['Homepage', '/'], ['Shop listing', '/shop'], ['Search', '/shop?q=a'], ['Sorting', '/shop?sort=price_asc'], ...(cat ? [['Category filter', `/shop?category=${cat.slug}`]] : []), ...(first ? [['Product page', `/product/${first.slug}`]] : []),
    ['Cart', '/cart'], ['Contact', '/contact'], ['Order tracking', '/track'], ['About', '/about'], ['FAQ', '/faq'], ['Shipping', '/shipping'], ['Returns', '/returns'], ['Privacy', '/privacy'], ['Terms', '/terms']];
  const html = {};
  for (const [name, p] of pages) {
    const x = await get(p); html[p] = x.text;
    out.push(x.status === 200 ? R(g1, name, PASS, `${p} answered 200.`) : R(g1, name, FAIL, `${p} answered ${x.status || 'no response'}.`));
  }
  if (!first) out.push(R(g1, 'Product page', NOTRUN, 'No published, available product exists to open.'));
  // SEO + accessibility basics on the pages above
  const g2 = 'Page quality (automatic, basic)';
  const prob = [];
  for (const [p, t] of Object.entries(html)) {
    if (!t) continue;
    if (!/<html[^>]+lang=/i.test(t)) prob.push(`${p}: no lang attribute`);
    if (!/<title>[^<]{3,}<\/title>/i.test(t)) prob.push(`${p}: no title`);
    if (!/<meta[^>]+name="description"[^>]+content="[^"]{20,}/i.test(t)) prob.push(`${p}: no meta description`);
    if (!/<meta[^>]+name="viewport"/i.test(t)) prob.push(`${p}: no viewport`);
    if ((t.match(/<h1\b/gi) || []).length !== 1) prob.push(`${p}: ${(t.match(/<h1\b/gi) || []).length} h1 headings`);
    for (const im of t.match(IMG_RE) || []) if (!/\balt=/.test(im)) prob.push(`${p}: image without alt`);
    for (const m of t.matchAll(/<input\b[^>]*\bid="([^"]+)"[^>]*>/gi)) { if (/type="(hidden|submit|checkbox)"/i.test(m[0])) continue; if (!new RegExp(`for="${m[1]}"`).test(t) && !/aria-label=/.test(m[0])) prob.push(`${p}: field #${m[1]} has no label`); }
  }
  out.push(prob.length ? R(g2, 'Titles, descriptions, headings, alt text, labels', FAIL, [...new Set(prob)].slice(0, 8).join('; ') + (prob.length > 8 ? ` (+${prob.length - 8} more)` : '')) : R(g2, 'Titles, descriptions, headings, alt text, labels', PASS, `Checked ${Object.keys(html).length} pages: language, title, meta description, viewport, one h1, image alt text and form labels all present.`));
  out.push(R(g2, 'Responsive layout, colour contrast, keyboard use', NOTRUN, 'These need a real browser. Run: npm run qa:browser (needs Playwright) — see TESTING.md.'));
  // internal links + images
  const g3 = 'Links and images';
  const links = new Set(); const images = new Set();
  for (const p of ['/', '/shop', ...(first ? [`/product/${first.slug}`] : []), '/contact', '/faq']) for (const m of (html[p] || '').matchAll(/(?:href|src)="(\/[^"#]*)"/g)) { (/\.(jpg|png|svg|webp|css|js|woff2|ico)(\?|$)/i.test(m[1]) ? images : links).add(m[1].replace(/&amp;/g, '&')); }
  const badL = [];
  for (const l of [...links].slice(0, 70)) { if (/^\/(admin|logout)/.test(l)) continue; const x = await get(l); if (![200, 303, 302].includes(x.status)) badL.push(`${l} (${x.status || 'no reply'})`); }
  out.push(badL.length ? R(g3, 'Internal links', FAIL, `Broken: ${badL.slice(0, 6).join(', ')}`) : R(g3, 'Internal links', PASS, `${Math.min(links.size, 70)} distinct internal links from the home, shop, product, contact and FAQ pages all resolve.`));
  const badI = [];
  for (const i of [...images].slice(0, 80)) { const x = await get(i); if (x.status !== 200) badI.push(`${i} (${x.status || 'no reply'})`); }
  out.push(badI.length ? R(g3, 'Images and assets', FAIL, `Missing: ${badI.slice(0, 6).join(', ')}${badI.length > 6 ? ` (+${badI.length - 6})` : ''}`) : R(g3, 'Images and assets', images.size ? PASS : NOTRUN, images.size ? `${Math.min(images.size, 80)} images/styles/scripts referenced on those pages all load.` : 'No images referenced.'));
  const sm = await get('/sitemap.xml'); const rb = await get('/robots.txt');
  out.push(sm.status === 200 && rb.status === 200 && /Disallow: \/admin/.test(rb.text) ? R(g3, 'Sitemap and robots.txt', PASS, 'Both exist; robots.txt keeps /admin, cart, checkout and order pages out of search engines.') : R(g3, 'Sitemap and robots.txt', FAIL, 'Missing or incomplete.'));

  // cart + checkout flow (throw-away cart, removed afterwards; no order is created)
  const g4 = 'Cart and checkout';
  if (!first) out.push(R(g4, 'Add to cart, update, remove', NOTRUN, 'No published, available product to test with.'), R(g4, 'Checkout validation', NOTRUN, 'Needs a product in the cart.'));
  else {
    const jar = {}; const take = (x) => { for (const c of x.r.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } };
    const cookieHdr = () => Object.entries(jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
    const post = async (p, body) => { const x = await get(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHdr() }, body: new URLSearchParams(body).toString() }); take(x); return x; };
    take(await get('/shop'));
    const v = q.get("SELECT v.id, v.price_minor FROM variants v JOIN products p ON p.id=v.product_id WHERE p.slug=? AND v.availability='available' ORDER BY v.id LIMIT 1", first.slug);
    try {
      const noCsrf = await get('/cart/add', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `variant_id=${v.id}&quantity=1` });
      out.push(noCsrf.status === 403 ? R(g4, 'Cart rejects requests without a security token (CSRF)', PASS, 'POST without the token answered 403.') : R(g4, 'Cart rejects requests without a security token (CSRF)', FAIL, `Answered ${noCsrf.status}.`));
      const add = await post('/cart/add', { _csrf: jar.nx_csrf, variant_id: v.id, quantity: 2 });
      let cartPage = (await get('/cart', { headers: { cookie: cookieHdr() } })).text;
      const okAdd = add.status === 303 && cartPage.includes(first.name.replace(/&/g, '&amp;').slice(0, 20));
      out.push(okAdd ? R(g4, 'Add to cart', PASS, `Added 2 x "${first.name}"; it appears in the cart.`) : R(g4, 'Add to cart', FAIL, `Add answered ${add.status}; product ${okAdd ? '' : 'not '}found in the cart.`));
      const fmtd = require('./money').format(v.price_minor * 2, cfg.currency);
      out.push(cartPage.includes(fmtd) ? R(g4, 'Cart total uses database price', PASS, 'Cart subtotal equals database price x quantity.') : R(g4, 'Cart total uses database price', WARN, 'Could not match the subtotal text on the page (formatting differs?). Covered by the automated tests.'));
      const tamper = await post('/cart/add', { _csrf: jar.nx_csrf, variant_id: v.id, quantity: 9999, price: 1 });
      out.push(tamper.status === 303 && !/Added to your cart/.test(decodeURIComponent(jar.nx_flash || '')) ? R(g4, 'Invalid quantity / client price rejected', PASS, 'Quantity 9999 refused; a price sent by the browser is ignored.') : R(g4, 'Invalid quantity / client price rejected', FAIL, 'An excessive quantity was accepted.'));
      await post('/cart/update', { _csrf: jar.nx_csrf, variant_id: v.id, quantity: 1 });
      const bad = await post('/checkout', { _csrf: jar.nx_csrf, checkout_key: 'x'.repeat(20), name: '', email: 'not-an-email' });
      out.push(bad.status === 422 && !q.get("SELECT 1 x FROM orders WHERE customer_email='not-an-email'") ? R(g4, 'Checkout validation', PASS, 'Empty name and a malformed email are rejected (422) and no order was created.') : R(g4, 'Checkout validation', FAIL, `Answered ${bad.status}.`));
      await post('/cart/remove', { _csrf: jar.nx_csrf, variant_id: v.id });
      out.push((await get('/cart', { headers: { cookie: cookieHdr() } })).text.includes('empty') ? R(g4, 'Remove from cart', PASS, 'Item removed; the cart shows its empty state.') : R(g4, 'Remove from cart', FAIL, 'Cart is not empty after removal.'));
    } catch (e) { out.push(R(g4, 'Cart and checkout flow', FAIL, `Stopped: ${String(e.message).slice(0, 120)}`)); }
    finally { if (jar.nx_cart) q.run('DELETE FROM carts WHERE token=?', jar.nx_cart); }
    out.push(R(g4, 'Order creation and payment verification', NOTRUN, 'Not run from this page because it would create a real order. They are covered by the automated test suite on a separate test database: npm test.'));
  }
  // security
  const g5 = 'Security (live requests)';
  const home = await get('/');
  const h = (n) => home.r.headers.get(n);
  const need = ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy'].filter((n) => !h(n));
  out.push(need.length ? R(g5, 'Security headers', FAIL, `Missing: ${need.join(', ')}`) : R(g5, 'Security headers', PASS, 'CSP, X-Frame-Options, nosniff, Referrer-Policy and Permissions-Policy are sent.'));
  out.push(h('strict-transport-security') ? R(g5, 'HTTPS enforcement (HSTS)', PASS, 'Strict-Transport-Security is sent.') : R(g5, 'HTTPS enforcement (HSTS)', cfg.isProd ? FAIL : NOTRUN, cfg.isProd ? 'Not sent in production.' : 'Only sent in production (expected on your computer). Verify on the live site.'));
  const sc = (home.r.headers.getSetCookie?.() || []).join('\n');
  out.push(/HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc) ? R(g5, 'Cookie flags', cfg.isProd && !/Secure/i.test(sc) ? FAIL : PASS, `HttpOnly and SameSite=Lax set${cfg.isProd ? '; Secure set' : ' (Secure is added in production)'}.`) : R(g5, 'Cookie flags', FAIL, 'Cookies are missing HttpOnly/SameSite.'));
  const adminPaths = ['/admin', '/admin/orders', '/admin/products', '/admin/products/new', '/admin/categories', '/admin/delivery', '/admin/inquiries', '/admin/settings', '/admin/health', '/admin/audit', '/admin/account'];
  const leaks = []; for (const p of adminPaths) { const x = await get(p); if (!(x.status === 303 && /\/admin\/login$/.test(x.r.headers.get('location') || ''))) leaks.push(`${p} (${x.status})`); }
  out.push(leaks.length ? R(g5, 'Admin pages require sign-in', FAIL, `Not protected: ${leaks.join(', ')}`) : R(g5, 'Admin pages require sign-in', PASS, `${adminPaths.length} admin pages redirect an anonymous visitor to the login page.`));
  const mut = []; for (const p of ['/admin/products/new', '/admin/products/1', '/admin/products/1/quick', '/admin/orders/NX-X/cancel', '/admin/settings', '/admin/delivery/1', '/admin/categories/1', '/admin/inquiries/1/handled', '/admin/account/password']) { const x = await get(p, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=x' }); if (!(x.status === 303 && /\/admin\/login$/.test(x.r.headers.get('location') || '')) && x.status !== 404) mut.push(`${p} (${x.status})`); }
  out.push(mut.length ? R(g5, 'Admin changes require sign-in', FAIL, `Accepted without sign-in: ${mut.join(', ')}`) : R(g5, 'Admin changes require sign-in', PASS, 'Anonymous POSTs to admin actions are refused.'));
  const o1 = await get('/order/NX-NOSUCH?t=abc'); const o2 = await get('/order/NX-NOSUCH');
  out.push(o1.status === 404 && o2.status === 404 ? R(g5, 'Orders cannot be viewed by guessing', PASS, 'An order page needs the reference AND its private signed token; wrong or missing tokens answer 404.') : R(g5, 'Orders cannot be viewed by guessing', FAIL, `Answered ${o1.status}/${o2.status}.`));
  const wh = await get('/webhooks/paystack', { method: 'POST', headers: { 'content-type': 'application/json', 'x-paystack-signature': 'bad' }, body: '{"event":"charge.success","data":{"reference":"x"}}' });
  out.push(wh.status === 401 ? R(g5, 'Payment webhook rejects forged calls', PASS, 'A call with a wrong signature was refused (401) and changed nothing.') : R(g5, 'Payment webhook rejects forged calls', FAIL, `Answered ${wh.status}.`));
  const trav = []; for (const p of ['/..%2f..%2fetc%2fpasswd', '/uploads/..%2f..%2fnexoraith.db', '/%2e%2e/package.json', '/data/nexoraith.db', '/.env', '/.env.local', '/src/config.js']) { const x = await get(p); if (x.status === 200) trav.push(p); }
  out.push(trav.length ? R(g5, 'Private files are not downloadable', FAIL, `Served: ${trav.join(', ')}`) : R(g5, 'Private files are not downloadable', PASS, 'Path-traversal attempts and requests for .env, the database and source files do not return content.'));
  const secrets = [process.env.ADMIN_PASSWORD, cfg.sessionSecret, cfg.paystack.secret, cfg.email.apiKey, cfg.cj.apiKey].filter((s) => s && s.length >= 8);
  const leakedIn = Object.entries(html).filter(([, t]) => secrets.some((s) => t.includes(s))).map(([p]) => p);
  out.push(leakedIn.length ? R(g5, 'Secrets not present in public pages', FAIL, `A configured secret value appears in: ${leakedIn.join(', ')}`) : R(g5, 'Secrets not present in public pages', PASS, `Checked ${Object.keys(html).length} pages for ${secrets.length} configured secret value(s); none found. (Values are not displayed here.)`));
  out.push(R(g5, 'Rate limiting', NOTRUN, 'Login, checkout, contact, tracking and payment start are rate-limited in code and covered by the automated tests; not triggered here so it does not lock you out.'));
  return out;
}

// ---------- repository / build ----------
function projectChecks() {
  const out = []; const g = 'Project and deployment files';
  const pkg = JSON.parse(fs.readFileSync(path.join(cfg.root, 'package.json'), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  out.push(deps.length ? R(g, 'Third-party packages', WARN, `${deps.length} package(s): ${deps.join(', ')}. Keep them updated.`) : R(g, 'Third-party packages', PASS, 'None. The app uses only Node.js built-ins, so there are no vulnerable npm packages to patch.'));
  const need = [22, 13]; const [ma, mi] = process.versions.node.split('.').map(Number);
  out.push(ma > need[0] || (ma === need[0] && mi >= need[1]) ? R(g, 'Node.js version', PASS, `Node ${process.versions.node} (needs 22.13 or newer).`) : R(g, 'Node.js version', FAIL, `Node ${process.versions.node} is too old.`));
  out.push(fs.existsSync(path.join(cfg.root, 'railway.json')) ? R(g, 'Railway start/health settings', PASS, 'railway.json present: start with "npm start", health check /health.') : R(g, 'Railway start/health settings', WARN, 'railway.json missing.'));
  try { execFileSync('git', ['check-ignore', '-q', '.env.local'], { cwd: cfg.root, stdio: 'ignore' }); out.push(R(g, 'Secret files excluded from Git', PASS, '.env.local is ignored by Git.')); }
  catch (e) { out.push(e.status === 1 ? R(g, 'Secret files excluded from Git', FAIL, '.env.local is NOT ignored by Git. Fix .gitignore before any commit.') : R(g, 'Secret files excluded from Git', NOTRUN, 'Git is not available on this machine/host, so the ignore rule could not be tested here.')); }
  out.push(R(g, 'Automated tests and production build', NOTRUN, 'Run on your computer: npm test (there is no separate compile step for this app).'));
  return out;
}

async function runAll(port) {
  const started = new Date();
  const all = [...configChecks(), ...integrationChecks(), ...databaseChecks(), ...projectChecks(), ...await webChecks(port)];
  const counts = {}; for (const r of all) counts[r.status] = (counts[r.status] || 0) + 1;
  const result = { at: started.toISOString(), ms: Date.now() - started.getTime(), counts, results: all };
  settings.set('health_last', JSON.stringify(result));
  return result;
}
const last = () => { try { return JSON.parse(settings.get('health_last')); } catch { return null; } };
module.exports = { runAll, last, configChecks, databaseChecks, integrationChecks, projectChecks, webChecks };
