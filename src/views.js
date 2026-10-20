'use strict';
const cfg = require('./config');
const { esc } = require('./security');
const money = require('./money');
const C = cfg.company;

const csrfField = (ctx) => `<input type="hidden" name="_csrf" value="${esc(ctx.csrf)}">`;
const price = (p) => money.format(p, cfg.currency);

function layout(ctx, { title, desc = '', body, noindex = false, image = '', jsonld = '', canonicalPath }) {
  const fullTitle = title ? `${title} | ${C.short}` : `${C.short} | ${C.tagline}`;
  const d = desc || `${C.name}: an online store. ${C.tagline}`;
  const canon = cfg.siteUrl + (canonicalPath ?? ctx.path);
  const flash = ctx.flash ? `<div class="flash flash-${esc(ctx.flash.type)}" role="status">${esc(ctx.flash.text)}</div>` : '';
  const devBar = cfg.allowDevProducts ? `<div class="devbar">Development preview. Sample products and prices are for testing only and are not for sale.</div>` : '';
  const nav = [['/', 'Home'], ['/shop', 'Shop'], ['/about', 'About'], ['/contact', 'Contact']]
    .map(([h, t]) => `<a href="${h}"${ctx.path === h ? ' aria-current="page"' : ''}>${t}</a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title><meta name="description" content="${esc(d.slice(0, 300))}">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : `<link rel="canonical" href="${esc(canon)}">`}
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(C.short)}"><meta property="og:title" content="${esc(fullTitle)}"><meta property="og:description" content="${esc(d.slice(0, 300))}">
<meta property="og:url" content="${esc(canon)}">${image ? `<meta property="og:image" content="${esc(cfg.siteUrl + image)}">` : ''}<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#0B1F2A"><link rel="icon" href="/img/favicon.png" type="image/png"><link rel="stylesheet" href="/css/styles.css">${jsonld ? `<script type="application/ld+json">${jsonld.replace(/</g, '\\u003c')}</script>` : ''}
</head><body><a class="skip" href="#main">Skip to main content</a>${devBar}
<header class="site-header"><div class="wrap header-row">
<a class="brand" href="/" aria-label="${esc(C.short)} home"><img src="/img/logo-dark.png" alt="${esc(C.short)}" width="153" height="88"></a>
<button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>
<nav id="site-nav" class="nav" aria-label="Main">${nav}</nav>
<form class="search" action="/shop" method="get" role="search"><label class="sr" for="hs">Search products</label><input id="hs" name="q" type="search" placeholder="Search products" maxlength="80" value="${esc(ctx.search || '')}"><button type="submit" class="btn btn-small">Search</button></form>
<a class="cart-link" href="/cart" aria-label="Cart, ${ctx.cartCount} item${ctx.cartCount === 1 ? '' : 's'}">Cart <span class="cart-count">${ctx.cartCount}</span></a>
</div></header>
<main id="main" tabindex="-1">${flash}${body}</main>
<footer class="site-footer"><div class="wrap footer-grid">
<div><img src="/img/logo-dark.png" alt="" width="120" height="69"><p class="muted-on-dark">${esc(C.tagline)}</p>
<p class="small">${esc(C.name)}<br>RC No: ${esc(C.rc)}</p></div>
<div><h2>Shop</h2><ul><li><a href="/shop">All products</a></li><li><a href="/cart">Cart</a></li></ul></div>
<div><h2>Help</h2><ul><li><a href="/faq">FAQs</a></li><li><a href="/shipping">Shipping</a></li><li><a href="/returns">Returns &amp; refunds</a></li><li><a href="/contact">Contact</a></li></ul></div>
<div><h2>Company</h2><ul><li><a href="/about">About</a></li><li><a href="/privacy">Privacy policy</a></li><li><a href="/terms">Terms of sale</a></li></ul>
<p class="small"><a href="mailto:${esc(C.email)}">${esc(C.email)}</a>${C.phone ? `<br>${esc(C.phone)}` : ''}${C.address ? `<br>${esc(C.address)}` : ''}</p></div>
</div><div class="wrap copy">&copy; ${new Date().getFullYear()} ${esc(C.name)}. All rights reserved.</div></footer>
<script src="/js/app.js" defer></script></body></html>`;
}

function card(p) {
  const range = p.max_price != null && p.max_price !== p.min_price ? `From ${price(p.min_price)}` : price(p.min_price ?? 0);
  const avail = p.n_available === undefined ? '' : p.n_available > 0 ? '<span class="tag tag-ok">Available</span>' : '<span class="tag">Availability to be confirmed</span>';
  return `<article class="card"><a class="card-img" href="/product/${esc(p.slug)}" tabindex="-1" aria-hidden="true">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" width="600" height="600">` : ''}</a>
<div class="card-body">${p.is_development ? '<span class="tag tag-dev">Sample product</span>' : ''}<h3><a href="/product/${esc(p.slug)}">${esc(p.name)}</a></h3>
<p class="price">${range}</p>${avail}</div></article>`;
}

function home(ctx, { cats, featured }) {
  const body = `<section class="hero"><div class="wrap hero-in"><p class="eyebrow">${esc(C.name)}</p><h1>${esc(C.tagline)}</h1>
<p class="lead">Online shopping that is simple, secure and clear. See the full price before you pay.</p>
<p><a class="btn btn-lg" href="/shop">Shop now</a></p></div></section>
${cats.length ? `<section class="wrap section"><h2>Shop by category</h2><ul class="cat-grid">${cats.map((c) => `<li><a class="cat" href="/shop?category=${esc(c.slug)}"><strong>${esc(c.name)}</strong><span>${c.n} product${c.n === 1 ? '' : 's'}</span></a></li>`).join('')}</ul></section>` : ''}
${featured.length ? `<section class="wrap section"><h2>New in the store</h2><div class="grid">${featured.map(card).join('')}</div><p class="center"><a class="btn btn-outline" href="/shop">View all products</a></p></section>` : `<section class="wrap section"><p class="empty">Products are being added. Please check back soon.</p></section>`}
<section class="wrap section"><h2>How it works</h2><ol class="steps"><li><strong>Browse</strong><span>Search and filter the catalogue.</span></li><li><strong>Check the total</strong><span>Your cart and order page show exactly what you will pay.</span></li><li><strong>Pay online</strong><span>Payments are handled by our payment provider; we never see or store your card details.</span></li><li><strong>Follow your order</strong><span>Your order page shows its current status.</span></li></ol></section>
<section class="wrap section note-box"><h2>Need help?</h2><p>Email us at <a href="mailto:${esc(C.email)}">${esc(C.email)}</a> or use the <a href="/contact">contact form</a>.</p></section>`;
  return layout(ctx, { title: '', desc: `${C.short}: ${C.tagline} Browse products, see clear prices and order online.`, body });
}

function shop(ctx, { res, cats, query }) {
  const qs = (o) => { const p = new URLSearchParams({ ...query, ...o }); for (const [k, v] of [...p]) if (!v || (k === 'page' && v === '1')) p.delete(k); const s = p.toString(); return '/shop' + (s ? `?${s}` : ''); };
  const sortOpts = [['newest', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['name', 'Name A to Z']];
  const body = `<div class="wrap section"><h1>Shop</h1>
<form class="filters" action="/shop" method="get"><div><label for="q">Search</label><input id="q" name="q" type="search" maxlength="80" value="${esc(query.search)}"></div>
<div><label for="category">Category</label><select id="category" name="category"><option value="">All categories</option>${cats.map((c) => `<option value="${esc(c.slug)}"${query.category === c.slug ? ' selected' : ''}>${esc(c.name)} (${c.n})</option>`).join('')}</select></div>
<div><label for="sort">Sort by</label><select id="sort" name="sort">${sortOpts.map(([v, t]) => `<option value="${v}"${query.sort === v ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
<div class="filters-actions"><button class="btn" type="submit">Apply</button> <a class="btn btn-outline" href="/shop">Clear</a></div></form>
<p class="muted" aria-live="polite">${res.total} product${res.total === 1 ? '' : 's'} found</p>
${res.items.length ? `<div class="grid">${res.items.map(card).join('')}</div>` : `<div class="empty"><h2>No products found</h2><p>Try a different search or <a href="/shop">clear the filters</a>.</p></div>`}
${res.pages > 1 ? `<nav class="pager" aria-label="Pages">${res.page > 1 ? `<a class="btn btn-outline" href="${qs({ page: res.page - 1 })}" rel="prev">Previous</a>` : ''}<span>Page ${res.page} of ${res.pages}</span>${res.page < res.pages ? `<a class="btn btn-outline" href="${qs({ page: res.page + 1 })}" rel="next">Next</a>` : ''}</nav>` : ''}</div>`;
  const t = query.category ? (cats.find((c) => c.slug === query.category)?.name || 'Shop') : 'Shop';
  return layout(ctx, { title: t, desc: `Browse ${t.toLowerCase()} at ${C.short}.`, body, canonicalPath: '/shop' + (query.category ? `?category=${query.category}` : ''), noindex: !!(query.search || res.page > 1) });
}

const AVAIL_TEXT = { available: 'Available', unavailable: 'Currently unavailable', unverified: 'Availability to be confirmed' };
function product(ctx, p, rel) {
  const purchasable = p.variants.filter((v) => v.availability === 'available' && (v.stock_qty == null || v.stock_qty > 0));
  const prices = p.variants.map((v) => v.price_minor);
  const first = purchasable[0] || p.variants[0];
  const main = p.images[0];
  const opts = p.variants.map((v) => {
    const ok = purchasable.includes(v);
    return `<option value="${v.id}"${ok ? '' : ' disabled'}${first && v.id === first.id ? ' selected' : ''}>${esc(v.label)} - ${price(v.price_minor)} (${ok ? 'Available' : AVAIL_TEXT[v.availability] === 'Available' ? 'Out of stock' : AVAIL_TEXT[v.availability]})</option>`;
  }).join('');
  const body = `<div class="wrap section"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/shop">Shop</a>${p.category_name ? ` / <a href="/shop?category=${esc(p.category_slug)}">${esc(p.category_name)}</a>` : ''}</nav>
<div class="pdp"><div class="gallery">${main ? `<img id="main-img" src="${esc(main.url)}" alt="${esc(main.alt || p.name)}" width="800" height="800">` : '<div class="noimg">No image</div>'}
${p.images.length > 1 ? `<ul class="thumbs">${p.images.map((i) => `<li><button type="button" class="thumb" data-src="${esc(i.url)}" data-alt="${esc(i.alt || p.name)}"><img src="${esc(i.url)}" alt="Show image: ${esc(i.alt || p.name)}" width="80" height="80" loading="lazy"></button></li>`).join('')}</ul>` : ''}</div>
<div class="info">${p.is_development ? '<p class="tag tag-dev">Sample product: for testing only, not for sale</p>' : ''}<h1>${esc(p.name)}</h1>
<p class="price big">${prices.length > 1 && Math.min(...prices) !== Math.max(...prices) ? `From ${price(Math.min(...prices))}` : price(prices[0] ?? 0)}</p>
<div class="desc">${esc(p.description).split(/\n{2,}/).map((x) => `<p>${x.replace(/\n/g, '<br>')}</p>`).join('')}</div>
${purchasable.length ? `<form method="post" action="/cart/add" class="buy">${csrfField(ctx)}<input type="hidden" name="back" value="/product/${esc(p.slug)}">
<label for="variant">Option</label><select id="variant" name="variant_id" required>${opts}</select>
<label for="qty">Quantity</label><input id="qty" name="quantity" type="number" min="1" max="20" value="1" inputmode="numeric" required>
<button class="btn btn-lg" type="submit">Add to cart</button></form>` : `<p class="alert">This product cannot be ordered right now: ${esc(AVAIL_TEXT[first?.availability] || 'availability to be confirmed')}.</p>`}
<p class="small muted">Delivery charges and estimates are shown at checkout once confirmed for your destination. See <a href="/shipping">shipping</a> and <a href="/returns">returns</a>.</p></div></div>
${rel.length ? `<section class="section"><h2>You may also like</h2><div class="grid">${rel.map(card).join('')}</div></section>` : ''}</div>`;
  const ld = !p.is_development && purchasable.length ? JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.description.slice(0, 500), image: p.images.map((i) => cfg.siteUrl + i.url), offers: { '@type': 'Offer', priceCurrency: p.currency, price: (Math.min(...purchasable.map((v) => v.price_minor)) / 100).toFixed(2), availability: 'https://schema.org/InStock', url: `${cfg.siteUrl}/product/${p.slug}` } }) : '';
  return layout(ctx, { title: p.name, desc: p.description.replace(/\s+/g, ' ').slice(0, 155), body, image: main?.url, jsonld: ld, noindex: !!p.is_development });
}

function cartPage(ctx, ls, t) {
  const bad = ls.some((l) => l.problem);
  const body = `<div class="wrap section"><h1>Your cart</h1>${ls.length ? `
<div class="cart-layout"><ul class="lines">${ls.map((l) => `<li class="line"><a href="/product/${esc(l.slug)}">${l.image ? `<img src="${esc(l.image)}" alt="" width="96" height="96">` : ''}</a>
<div class="line-main"><a href="/product/${esc(l.slug)}"><strong>${esc(l.name)}</strong></a><br><span class="muted">${esc(l.variant_label)}</span> ${l.is_development ? '<span class="tag tag-dev">Sample</span>' : ''}
<div>${price(l.price_minor)} each</div>${l.problem ? `<p class="alert" role="alert">${esc(l.problem)}</p>` : ''}
<form method="post" action="/cart/update" class="qty-form">${csrfField(ctx)}<input type="hidden" name="variant_id" value="${l.variant_id}"><label class="sr" for="q${l.variant_id}">Quantity for ${esc(l.name)}</label><input id="q${l.variant_id}" name="quantity" type="number" min="1" max="20" value="${l.quantity}" inputmode="numeric"><button class="btn btn-small btn-outline" type="submit">Update</button></form>
<form method="post" action="/cart/remove">${csrfField(ctx)}<input type="hidden" name="variant_id" value="${l.variant_id}"><button class="link-btn" type="submit">Remove<span class="sr"> ${esc(l.name)}</span></button></form></div>
<div class="line-total">${price(l.line_total)}</div></li>`).join('')}</ul>
<aside class="summary" aria-label="Order summary"><h2>Summary</h2><dl><dt>Subtotal</dt><dd>${price(t.subtotal)}</dd><dt>Delivery</dt><dd>Calculated at checkout</dd></dl>
${bad ? '<p class="alert">Please fix the items marked above before checking out.</p><span class="btn btn-lg btn-disabled" aria-disabled="true">Checkout</span>' : '<a class="btn btn-lg" href="/checkout">Proceed to checkout</a>'}
<p class="center"><a href="/shop">Continue shopping</a></p></aside></div>` : `<div class="empty"><p>Your cart is empty.</p><p><a class="btn" href="/shop">Browse products</a></p></div>`}</div>`;
  return layout(ctx, { title: 'Cart', body, noindex: true });
}

function field(name, label, v, e, attrs = '') {
  return `<div class="field${e[name] ? ' has-error' : ''}"><label for="${name}">${label}</label><input id="${name}" name="${name}" value="${esc(v[name] ?? '')}" ${attrs}${e[name] ? ` aria-invalid="true" aria-describedby="${name}-err"` : ''}>${e[name] ? `<p class="err" id="${name}-err">${esc(e[name])}</p>` : ''}</div>`;
}
function checkoutPage(ctx, ls, zones, v = {}, e = {}, key) {
  const sub = ls.reduce((s, l) => s + l.line_total, 0);
  const body = `<div class="wrap section"><h1>Checkout</h1>${Object.keys(e).length ? '<p class="alert" role="alert">Please correct the highlighted fields.</p>' : ''}
<div class="cart-layout"><form method="post" action="/checkout" class="form" novalidate>${csrfField(ctx)}<input type="hidden" name="checkout_key" value="${esc(key)}">
<h2>Contact</h2>${field('name', 'Full name', v, e, 'autocomplete="name" required')}${field('email', 'Email address', v, e, 'type="email" autocomplete="email" required')}${field('phone', 'Phone number', v, e, 'type="tel" autocomplete="tel" required')}
<h2>Delivery</h2><div class="field${e.zone_id ? ' has-error' : ''}"><label for="zone_id">Destination</label><select id="zone_id" name="zone_id" required>${zones.map((z) => `<option value="${z.id}"${Number(v.zone_id) === z.id ? ' selected' : ''}>${esc(z.name)}${z.confirmed ? '' : ' (delivery charge not yet confirmed)'}</option>`).join('')}</select>${e.zone_id ? `<p class="err">${esc(e.zone_id)}</p>` : ''}</div>
${field('address', 'Street address', v, e, 'autocomplete="street-address" required')}${field('city', 'City / town', v, e, 'autocomplete="address-level2" required')}${field('state', 'State / region', v, e, 'autocomplete="address-level1" required')}${field('postal', 'Postal code (optional)', v, e, 'autocomplete="postal-code"')}
<div class="field"><label for="notes">Delivery instructions (optional)</label><textarea id="notes" name="notes" rows="3" maxlength="300">${esc(v.notes ?? '')}</textarea></div>
<p class="small muted">We collect only what we need to process and deliver your order. See our <a href="/privacy">privacy policy</a>. The next page shows your final total before you pay.</p>
<button class="btn btn-lg" type="submit">Review order and total</button></form>
<aside class="summary"><h2>Your items</h2><ul class="mini">${ls.map((l) => `<li><span>${esc(l.name)} (${esc(l.variant_label)}) &times; ${l.quantity}</span><span>${price(l.line_total)}</span></li>`).join('')}</ul>
<dl><dt>Subtotal</dt><dd>${price(sub)}</dd><dt>Delivery</dt><dd>Added on the next page</dd></dl></aside></div></div>`;
  return layout(ctx, { title: 'Checkout', body, noindex: true });
}

function orderPage(ctx, o, its, token, payments) {
  const unpaid = o.status !== 'cancelled' && ['unpaid', 'failed', 'abandoned', 'pending'].includes(o.payment_status);
  const body = `<div class="wrap section narrow"><h1>Order ${esc(o.reference)}</h1>
<p class="status-box" role="status">${esc(ctx.statusText)}</p>
<dl class="kv"><dt>Order status</dt><dd>${esc(ctx.labels.order)}</dd><dt>Payment</dt><dd>${esc(ctx.labels.payment)}</dd><dt>Delivery progress</dt><dd>${esc(ctx.labels.fulfil)}</dd>
${o.tracking_number ? `<dt>Tracking</dt><dd>${esc(o.tracking_number)}${/^https:\/\//.test(o.tracking_url || '') ? ` (<a href="${esc(o.tracking_url)}" rel="noopener noreferrer">track</a>)` : ''}</dd>` : ''}</dl>
${o.has_development_items ? '<p class="alert">This order contains sample products and is for testing only.</p>' : ''}
<h2>Items</h2><table class="tbl"><thead><tr><th>Item</th><th class="num">Price</th><th class="num">Qty</th><th class="num">Total</th></tr></thead><tbody>${its.map((i) => `<tr><td>${esc(i.product_name)}<br><span class="muted">${esc(i.variant_label)}</span></td><td class="num">${money.format(i.unit_price_minor, o.currency)}</td><td class="num">${i.quantity}</td><td class="num">${money.format(i.line_total_minor, o.currency)}</td></tr>`).join('')}</tbody>
<tfoot><tr><td colspan="3">Subtotal</td><td class="num">${money.format(o.subtotal_minor, o.currency)}</td></tr><tr><td colspan="3">Delivery (${esc(o.delivery_zone_name)})${o.delivery_confirmed ? '' : ' <span class="tag tag-dev">not confirmed</span>'}</td><td class="num">${money.format(o.delivery_fee_minor, o.currency)}</td></tr>
${o.discount_minor ? `<tr><td colspan="3">Discount</td><td class="num">-${money.format(o.discount_minor, o.currency)}</td></tr>` : ''}<tr class="grand"><td colspan="3">Total payable</td><td class="num">${money.format(o.total_minor, o.currency)}</td></tr></tfoot></table>
${unpaid ? `<form method="post" action="/order/${esc(o.reference)}/pay" class="center">${csrfField(ctx)}<input type="hidden" name="t" value="${esc(token)}"><button class="btn btn-lg" type="submit">${o.payment_status === 'unpaid' ? 'Pay' : 'Try payment again'} ${money.format(o.total_minor, o.currency)}</button></form><p class="small muted center">You will be taken to our payment provider. Bookmark this page to return to your order.</p>` : ''}
<h2>Delivery details</h2><p>${esc(o.customer_name)}<br>${esc(o.ship_address)}, ${esc(o.ship_city)}, ${esc(o.ship_state)}<br>${esc(o.customer_email)} &middot; ${esc(o.customer_phone)}</p>
<p class="small muted">Keep this page's link private: it gives access to your order details. Questions? <a href="/contact">Contact us</a> and quote ${esc(o.reference)}.</p></div>`;
  return layout(ctx, { title: `Order ${o.reference}`, body, noindex: true });
}

function contactPage(ctx, v = {}, e = {}, sent = false) {
  const body = `<div class="wrap section narrow"><h1>Contact us</h1><p>Email: <a href="mailto:${esc(C.email)}">${esc(C.email)}</a></p>
${C.phone ? `<p>Phone: ${esc(C.phone)}</p>` : ''}${sent ? '<p class="flash flash-ok" role="status">Thank you. Your message has been received and saved. We will reply by email.</p>' : `
<form method="post" action="/contact" class="form" novalidate>${csrfField(ctx)}<div class="hp" aria-hidden="true"><label for="website">Leave empty</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
${field('name', 'Your name', v, e, 'autocomplete="name" required')}${field('email', 'Email address', v, e, 'type="email" autocomplete="email" required')}${field('subject', 'Subject (optional)', v, e)}
<div class="field${e.message ? ' has-error' : ''}"><label for="message">Message</label><textarea id="message" name="message" rows="6" maxlength="2000" required>${esc(v.message ?? '')}</textarea>${e.message ? `<p class="err">${esc(e.message)}</p>` : ''}</div>
<button class="btn" type="submit">Send message</button></form>`}
<p class="small muted">Messages are stored securely and reviewed by our team. If the form is unavailable, email us directly at the address above.</p></div>`;
  return layout(ctx, { title: 'Contact', desc: `Contact ${C.short} for help with products and orders.`, body });
}

const DRAFT = '<p class="alert"><strong>Draft policy.</strong> This text is a development placeholder and has not been approved by the business. It must be reviewed and confirmed (and, where appropriate, checked by a legal adviser) before the store goes live.</p>';
const PAGES = {
  about: ['About us', `<p>${esc(C.name)} (RC No: ${esc(C.rc)}) runs an online store. Our aim is to make online shopping simple, secure and enjoyable, with clear prices and clear communication.</p><p>We select products to offer to customers and arrange their fulfilment through supply partners. We will always try to tell you plainly what is known about a product, its availability and its delivery.</p><p>Have a question? <a href="/contact">Get in touch</a>.</p>`],
  faq: ['Frequently asked questions', `${DRAFT}<details><summary>How do I order?</summary><p>Add products to your cart, go to checkout, enter your delivery details, review your total and pay through our payment provider.</p></details><details><summary>Do I need an account?</summary><p>No. You can check out as a guest and use the private link on your order page to see its status.</p></details><details><summary>What payment methods can I use?</summary><p>The methods offered by our payment provider at the payment step. We do not see or store your card details.</p></details><details><summary>How long will delivery take?</summary><p>Delivery estimates will be shown only when they have been confirmed for your destination. See <a href="/shipping">shipping</a>.</p></details><details><summary>How do returns work?</summary><p>See <a href="/returns">returns &amp; refunds</a>. The final policy is yet to be confirmed.</p></details><details><summary>How can I contact you?</summary><p>Email <a href="mailto:${esc(C.email)}">${esc(C.email)}</a> or use the <a href="/contact">contact form</a>.</p></details>`],
  shipping: ['Shipping information', `${DRAFT}<p>Delivery destinations, charges and estimated delivery times have <strong>not yet been confirmed</strong>. They will be published here and shown at checkout once the business and its supply partners have confirmed them.</p><p>You will always see the delivery charge and your final total before you pay. Orders are fulfilled after payment is verified. Delivery times are estimates and not guarantees.</p>`],
  returns: ['Returns & refunds', `${DRAFT}<p>The returns and refunds policy is <strong>pending confirmation</strong>. It will describe eligibility, time limits, who pays return costs, and how damaged, wrong or lost items are handled, in line with applicable consumer law and our supplier terms.</p><p>Until then, please <a href="/contact">contact us</a> about any order problem and quote your order reference.</p>`],
  privacy: ['Privacy policy', `${DRAFT}<p>We collect only the information needed to process and deliver orders and answer enquiries: your name, email, phone number, delivery address and order details. Payments are processed by our payment provider; we do not store card numbers or security codes.</p><p>Your details may be shared with our payment provider and fulfilment partners solely to complete your order. We do not sell personal data. To ask about your data, email <a href="mailto:${esc(C.email)}">${esc(C.email)}</a>.</p><p>The store uses essential cookies only (cart and security). Retention periods and the full Nigeria Data Protection Act compliance wording are to be confirmed.</p>`],
  terms: ['Terms of sale', `${DRAFT}<p>These terms are a placeholder. They will cover: who we are (${esc(C.name)}, RC No ${esc(C.rc)}), prices and currency, availability, order acceptance, payment, delivery, returns and refunds, liability, and governing law.</p><p>Prices are shown in ${esc(cfg.currency)}. An order is accepted only after payment has been verified.</p>`],
};
function infoPage(ctx, slug) {
  const [t, html] = PAGES[slug];
  return layout(ctx, { title: t, desc: t + ' - ' + C.short, body: `<div class="wrap section narrow prose"><h1>${esc(t)}</h1>${html}</div>` });
}
function notFound(ctx) {
  return layout(ctx, { title: 'Page not found', noindex: true, body: '<div class="wrap section narrow center"><h1>Page not found</h1><p>Sorry, we could not find that page.</p><p><a class="btn" href="/shop">Go to the shop</a></p></div>' });
}
function errorPage(ctx, msg = 'Something went wrong on our side. Please try again shortly.') {
  return layout(ctx, { title: 'Error', noindex: true, body: `<div class="wrap section narrow center"><h1>Sorry</h1><p>${esc(msg)}</p><p><a class="btn" href="/">Back to home</a></p></div>` });
}
module.exports = { layout, home, shop, product, cartPage, checkoutPage, orderPage, contactPage, infoPage, notFound, errorPage, PAGES, csrfField, esc, price };
