'use strict';
// Server-rendered HTML templates. Every dynamic value goes through esc() to prevent HTML injection.
const cfg = require('./config');
const { esc } = require('./security');
const money = require('./money');
const images = require('./images');
const dd = require('./delivery-date');
const COUNTRY = { NG: 'Nigeria' };
const C = cfg.company;

const csrfField = (ctx) => `<input type="hidden" name="_csrf" value="${esc(ctx.csrf)}">`;
const price = (p) => money.format(p, cfg.currency);
// Long email address: allow wrapping after the @ so it never overflows small screens.
const mail = () => `<a class="email" href="mailto:${esc(C.email)}">${esc(C.email).replace('@', '@<wbr>')}</a>`;
// Product image tag: always has a category placeholder to fall back to (server-side when there is no image,
// in the browser via app.js if a file fails), fixed dimensions (no layout shift) and lazy loading below the fold.
const pimg = (src, cat, { w = 800, h = 800, alt = '', eager = false, id = '' } = {}) => {
  const fb = images.placeholderFor(cat);
  return `<img${id ? ` id="${id}"` : ''} src="${esc(src || fb)}" data-fallback="${esc(fb)}" alt="${esc(alt)}" width="${w}" height="${h}" decoding="async"${eager ? ' fetchpriority="high"' : ' loading="lazy"'}>`;
};
const absUrl = (u) => (/^https:\/\//.test(u) ? u : cfg.siteUrl + u);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Small inline icons (decorative, aria-hidden).
const I = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.6 7.5 9.5 4.3-.9 7.5-4.9 7.5-9.5V6z"/><path d="m8.8 12 2.3 2.3 4.3-4.6"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
  truck: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>',
  people: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2c3 .2 5.5 2.6 5.5 5.8"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6 8.5 7 8.5-7"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

function layout(ctx, { title, desc = '', body, noindex = false, image = '', jsonld = '', canonicalPath, bodyClass = '' }) {
  const fullTitle = title ? `${title} | ${C.short}` : `${C.short} | ${C.tagline}`;
  const d = desc || `${C.name}: an online store. ${C.tagline}`;
  const canon = cfg.siteUrl + (canonicalPath ?? ctx.path);
  const flash = ctx.flash ? `<div class="flash flash-${esc(ctx.flash.type)}" role="status"><div class="wrap">${esc(ctx.flash.text)}</div></div>` : '';
  const devBar = ''; // no customer-facing demo banner
  const nav = [['/', 'Home'], ['/shop', 'Shop'], ['/about', 'About'], ['/track', 'Track order'], ['/contact', 'Contact']]
    .map(([h, t]) => `<a href="${h}"${ctx.path === h ? ' aria-current="page"' : ''}>${t}</a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title><meta name="description" content="${esc(d.slice(0, 300))}">
${noindex ? '<meta name="robots" content="noindex,nofollow">' : `<link rel="canonical" href="${esc(canon)}">`}
<meta property="og:type" content="website"><meta property="og:site_name" content="${esc(C.short)}"><meta property="og:title" content="${esc(fullTitle)}"><meta property="og:description" content="${esc(d.slice(0, 300))}">
<meta property="og:url" content="${esc(canon)}"><meta property="og:image" content="${esc(absUrl(image || '/img/logo-dark.png'))}"><meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#07131D"><link rel="icon" href="/img/favicon.png" type="image/png">
<link rel="preload" href="/fonts/plus-jakarta-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/css/styles.css">${jsonld ? `<script type="application/ld+json">${jsonld.replace(/</g, '\\u003c')}</script>` : ''}
</head><body${bodyClass ? ` class="${bodyClass}"` : ''}><a class="skip" href="#main">Skip to main content</a>${devBar}
<header class="site-header"><div class="wrap header-row">
<a class="brand" href="/" aria-label="${esc(C.short)} home"><img src="/img/logo-dark-320.webp" alt="${esc(C.short)}" width="320" height="185"></a>
<button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav"><span class="bars" aria-hidden="true"></span>Menu</button>
<nav id="site-nav" class="nav" aria-label="Main">${nav}</nav>
<form class="search" action="/shop" method="get" role="search"><label class="sr" for="hs">Search products</label><input id="hs" name="q" type="search" placeholder="Search products" maxlength="80" value="${esc(ctx.search || '')}"><button type="submit" class="search-btn" aria-label="Search">${I.search}</button></form>
<a class="cart-link" href="/cart" aria-label="Cart, ${plural(ctx.cartCount, 'item')}">${I.cart}<span class="cart-count">${ctx.cartCount}</span></a>
</div></header>
<main id="main" tabindex="-1">${flash}${body}</main>
<footer class="site-footer"><div class="wrap footer-grid">
<div class="footer-brand"><img src="/img/logo-dark-320.webp" alt="${esc(C.short)}" width="320" height="185" loading="lazy"><p class="tagline">${esc(C.tagline)}</p>
<p class="small">${esc(C.name)}<br>RC No: ${esc(C.rc)}</p></div>
<div><h2>Shop</h2><ul><li><a href="/shop">All products</a></li><li><a href="/cart">Cart</a></li><li><a href="/track">Track an order</a></li></ul></div>
<div><h2>Help</h2><ul><li><a href="/faq">FAQs</a></li><li><a href="/shipping">Shipping &amp; delivery</a></li><li><a href="/returns">Returns &amp; refunds</a></li><li><a href="/contact">Contact us</a></li></ul></div>
<div><h2>Company</h2><ul><li><a href="/about">About us</a></li><li><a href="/privacy">Privacy policy</a></li><li><a href="/terms">Terms &amp; conditions</a></li></ul>
<p class="small footer-contact">${I.mail}${mail()}${C.phone ? `<br>${esc(C.phone)}` : ''}${C.address ? `<br>${esc(C.address)}` : ''}</p></div>
</div><div class="wrap copy"><span>&copy; ${new Date().getFullYear()} ${esc(C.name)}. All rights reserved.</span><span>RC No: ${esc(C.rc)}</span></div></footer>
<script src="/js/app.js" defer></script></body></html>`;
}

const AVAIL_TEXT = { available: 'Available', unavailable: 'Currently unavailable', unverified: 'Availability to be confirmed' };
function card(p, ctx, i = 99) {
  const range = p.max_price != null && p.max_price !== p.min_price ? `From ${price(p.min_price)}` : price(p.min_price ?? 0);
  const avail = p.n_available === undefined ? '' : p.availability === 'temporarily_unavailable' ? '<span class="tag tag-muted">Temporarily unavailable</span>' : p.n_available > 0 ? '<span class="tag tag-ok">Available to order</span>' : '<span class="tag tag-muted">Not available to order</span>';
  const quick = ctx && p.buy_variant && p.n_variants === 1
    ? `<form method="post" action="/cart/add" class="card-buy">${csrfField(ctx)}<input type="hidden" name="variant_id" value="${p.buy_variant}"><input type="hidden" name="quantity" value="1"><input type="hidden" name="back" value="${esc(ctx.path)}"><button class="btn btn-small btn-block" type="submit">Add to cart<span class="sr">: ${esc(p.name)}</span></button></form>`
    : `<a class="btn btn-small btn-outline btn-block" href="/product/${esc(p.slug)}">${p.buy_variant ? 'Choose options' : 'View details'}<span class="sr">: ${esc(p.name)}</span></a>`;
  return `<article class="card"><a class="card-img" href="/product/${esc(p.slug)}" tabindex="-1" aria-hidden="true">${pimg(p.image, p.category_slug, { alt: p.image_alt || p.name, eager: i < 4 })}</a>
<div class="card-body">${p.category_name ? `<p class="card-cat">${esc(p.category_name)}</p>` : ''}<h3><a href="/product/${esc(p.slug)}">${esc(p.name)}</a></h3>
${p.summary ? `<p class="card-sum">${esc(p.summary)}</p>` : ''}<div class="card-meta"><p class="price">${range}</p>${avail}</div>${quick}</div></article>`;
}

function home(ctx, { cats, featured }) {
  const body = `<section class="hero"><div class="wrap hero-in">
<div class="hero-copy"><p class="eyebrow">${esc(C.name)}</p><h1><span class="l">Shop Smarter.</span> <span class="l gold">Live Better.</span></h1>
<p class="lead">A simple, secure way to shop online. Quality products, clear prices and a checkout that shows your full total, including delivery, before you pay.</p>
<div class="hero-cta"><a class="btn btn-lg" href="/shop">Shop the collection ${I.arrow}</a><a class="btn btn-lg btn-ghost" href="#categories">Browse categories</a></div>
<ul class="assure"><li>${I.check}Full price shown before payment</li><li>${I.shield}Card details handled by our payment provider, never stored by us</li><li>${I.truck}Follow every order with your reference</li></ul></div>
<div class="hero-art" aria-hidden="true"><div class="emblem"><img src="/img/icon-crop.webp" alt="" width="296" height="288" fetchpriority="high"></div><span class="hero-line"></span></div>
</div></section>
${cats.length ? `<section class="wrap section" id="categories"><div class="sec-head row"><div><p class="kicker">Collections</p><h2>Shop by category</h2></div>${cats.length > 6 ? `<a class="more" href="/shop">All ${cats.length} categories ${I.arrow}</a>` : ''}</div><ul class="cat-grid">${cats.slice(0, 6).map((c) => `<li><a class="cat" href="/shop?category=${esc(c.slug)}">${pimg(c.image, c.slug, { w: 120, h: 120 })}<span class="cat-txt"><strong>${esc(c.name)}</strong>${c.description ? `<span>${esc(c.description)}</span>` : ''}<em>${plural(c.n, 'product')} ${I.arrow}</em></span></a></li>`).join('')}</ul></section>` : ''}
${featured.length ? `<section class="wrap section"><div class="sec-head row"><div><p class="kicker">Featured</p><h2>New in the store</h2></div><a class="more" href="/shop">View all products ${I.arrow}</a></div><div class="grid">${featured.map((p, i) => card(p, ctx, i)).join('')}</div></section>` : `<section class="wrap section"><p class="empty">Products are being added. Please check back soon.</p></section>`}
<section class="band"><div class="wrap"><div class="sec-head center"><p class="kicker">Our promise</p><h2>Shopping you can trust</h2></div>
<ul class="pillars"><li>${I.shield}<h3>Trust</h3><p>Honest product information. If availability or delivery has not been confirmed, we say so.</p></li>
<li>${I.star}<h3>Quality</h3><p>Products are chosen for the store and described plainly, without exaggerated claims.</p></li>
<li>${I.truck}<h3>Convenience</h3><p>Guest checkout, clear totals and an order page you can return to at any time.</p></li>
<li>${I.people}<h3>Customer focus</h3><p>Real answers by email, with your order reference so nothing gets lost.</p></li></ul></div></section>
<section class="wrap section"><div class="sec-head center"><p class="kicker">How it works</p><h2>From browsing to delivery</h2></div><ol class="steps"><li><strong>Browse</strong><span>Search and filter the catalogue by category or price.</span></li><li><strong>Check the total</strong><span>Your cart and checkout show exactly what you will pay, delivery included.</span></li><li><strong>Pay securely</strong><span>Payment is handled by our payment provider; we never see or store your card details.</span></li><li><strong>Follow your order</strong><span>Your private order page shows its current status and tracking when available.</span></li></ol></section>
<section class="wrap section"><div class="cta-box"><div><h2>Questions before you order?</h2><p>Email us at ${mail()} and we will reply as soon as we can.</p></div><div class="cta-actions"><a class="btn" href="/contact">Contact us</a><a class="btn btn-outline" href="/track">Track an order</a></div></div></section>`;
  return layout(ctx, { title: '', desc: `${C.short}: ${C.tagline} Browse products, see clear prices and order online from ${C.name}.`, body, bodyClass: 'is-home' });
}

function shop(ctx, { res, cats, query, current }) {
  const qs = (o) => { const p = new URLSearchParams({ ...query, ...o }); for (const [k, v] of [...p]) if (!v || (k === 'page' && v === '1') || k === 'search') p.delete(k); const s = p.toString(); return '/shop' + (s ? `?${s}` : ''); };
  const sortOpts = [['newest', 'Newest'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['name', 'Name A to Z']];
  const t = current ? current.name : 'Shop';
  const body = `<section class="page-head"><div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / ${current ? `<a href="/shop">Shop</a> / <span>${esc(current.name)}</span>` : '<span>Shop</span>'}</nav><h1>${esc(current ? current.name : 'All products')}</h1>${current?.description ? `<p class="lead-sm">${esc(current.description)}</p>` : current ? `<p class="lead-sm">All ${esc(current.name)} products. Search within the category or sort by price.</p>` : '<p class="lead-sm">Browse the full catalogue. Search, filter by category and sort by price.</p>'}</div></section>
<div class="wrap section">
<ul class="chips" aria-label="Categories"><li><a class="chip" href="/shop"${!query.category ? ' aria-current="page"' : ''}>All</a></li>${cats.map((c) => `<li><a class="chip" href="/shop?category=${esc(c.slug)}"${query.category === c.slug ? ' aria-current="page"' : ''}>${esc(c.name)} <span>${c.n}</span></a></li>`).join('')}</ul>
<form class="filters" action="/shop" method="get"><div><label for="q">Search</label><input id="q" name="q" type="search" maxlength="80" value="${esc(query.search)}" placeholder="Product name or keyword"></div>
<div><label for="category">Category</label><select id="category" name="category"><option value="">All categories</option>${cats.map((c) => `<option value="${esc(c.slug)}"${query.category === c.slug ? ' selected' : ''}>${esc(c.name)} (${c.n})</option>`).join('')}</select></div>
<div><label for="sort">Sort by</label><select id="sort" name="sort">${sortOpts.map(([v, x]) => `<option value="${v}"${query.sort === v ? ' selected' : ''}>${x}</option>`).join('')}</select></div>
<div class="filters-actions"><button class="btn" type="submit">Apply</button> <a class="btn btn-outline" href="/shop">Clear</a></div></form>
<p class="muted count" aria-live="polite">${res.total} product${res.total === 1 ? '' : 's'} found</p>
${res.items.length ? `<div class="grid">${res.items.map((p, i) => card(p, ctx, i)).join('')}</div>` : `<div class="empty"><h2>No products found</h2><p>Try a different search or <a href="/shop">clear the filters</a>.</p></div>`}
${res.pages > 1 ? `<nav class="pager" aria-label="Pages">${res.page > 1 ? `<a class="btn btn-outline" href="${qs({ page: res.page - 1 })}" rel="prev">Previous</a>` : ''}<span>Page ${res.page} of ${res.pages}</span>${res.page < res.pages ? `<a class="btn btn-outline" href="${qs({ page: res.page + 1 })}" rel="next">Next</a>` : ''}</nav>` : ''}</div>`;
  return layout(ctx, { title: t, desc: current?.description || `Browse ${t.toLowerCase()} at ${C.short}.`, body, canonicalPath: '/shop' + (query.category ? `?category=${query.category}` : ''), noindex: !!(query.search || res.page > 1) });
}

const zoneLine = (z) => `${esc(z.name)}: ${price(z.fee_minor)}${z.confirmed ? '' : ' <span class="tag tag-dev">preliminary</span>'}${z.estimate_text ? ` <span class="muted">(${esc(z.estimate_text)})</span>` : ''}`;
function product(ctx, p, rel, zones = [], x = {}) {
  const pOk = p.availability === 'available';
  const ok = (v) => pOk && v.availability === 'available' && (v.stock_qty == null || v.stock_qty > 0);
  const purchasable = p.variants.filter(ok);
  const prices = p.variants.map((v) => v.price_minor);
  const first = purchasable[0] || p.variants[0];
  const main = p.images[0];
  const why = (v) => (ok(v) ? 'Available' : v.availability === 'available' ? 'Out of stock' : AVAIL_TEXT[v.availability]);
  const opts = p.variants.map((v) => `<label class="opt${ok(v) ? '' : ' opt-off'}"><input type="radio" name="variant_id" value="${v.id}"${ok(v) ? '' : ' disabled'}${first && v.id === first.id && ok(v) ? ' checked' : ''} required data-price="${esc(price(v.price_minor))}"><span><strong>${esc(v.label)}</strong> <span class="opt-p">${price(v.price_minor)}</span>${optText(v.options_json) ? `<small>${esc(optText(v.options_json))}</small>` : ''}<small>${why(v)}${ok(v) && v.stock_qty != null && v.stock_qty <= 5 ? `: only ${v.stock_qty} left` : ''}</small></span></label>`).join('');
  const body = `<div class="wrap section"><nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/shop">Shop</a>${p.category_name ? ` / <a href="/shop?category=${esc(p.category_slug)}">${esc(p.category_name)}</a>` : ''} / <span>${esc(p.name)}</span></nav>
<div class="pdp"><div class="gallery"><div class="main-img">${pimg(main?.url, p.category_slug, { alt: main?.alt || p.name, eager: true, id: 'main-img' })}</div>
${p.images.length > 1 ? `<ul class="thumbs">${p.images.map((i) => `<li><button type="button" class="thumb" data-src="${esc(i.url)}" data-alt="${esc(i.alt || p.name)}">${pimg(i.url, p.category_slug, { w: 80, h: 80, alt: `Show image: ${i.alt || p.name}` })}</button></li>`).join('')}</ul>` : ''}</div>
<div class="info">${p.category_name ? `<p class="kicker">${esc(p.category_name)}</p>` : ''}<h1>${esc(p.name)}</h1>${p.summary ? `<p class="lead-sm">${esc(p.summary)}</p>` : ''}
<p class="price big" id="pdp-price">${prices.length > 1 && Math.min(...prices) !== Math.max(...prices) ? `From ${price(Math.min(...prices))}` : price(prices[0] ?? 0)}</p>
${purchasable.length ? `<form method="post" action="/cart/add" class="buy">${csrfField(ctx)}<input type="hidden" name="back" value="/product/${esc(p.slug)}">
<fieldset class="opts"><legend>${p.variants.length > 1 ? 'Choose an option' : 'Option'}</legend>${opts}</fieldset>
<div class="qty-row"><label for="qty">Quantity</label><div class="stepper"><button type="button" class="step" data-step="-1" aria-label="Decrease quantity">&minus;</button><input id="qty" name="quantity" type="number" min="1" max="20" value="1" inputmode="numeric" required><button type="button" class="step" data-step="1" aria-label="Increase quantity">+</button></div></div>
<button class="btn btn-lg btn-block" type="submit">${I.cart} Add to cart</button>
<p class="small muted exact">${I.check} We source exactly the option you choose. No substitutes (brand, size, colour or model) without your approval. Availability is checked by our team after you order.</p></form>` : `<p class="alert">This product cannot be ordered right now: ${esc(p.availability === 'discontinued' ? 'it has been discontinued' : p.availability === 'temporarily_unavailable' ? 'it is temporarily unavailable' : AVAIL_TEXT[first?.availability] || 'availability to be confirmed')}.</p>`}
<div class="ship-box"><h2>${I.truck} Delivery</h2>${zones.length ? `<ul>${zones.map((z) => `<li>${zoneLine(z)}</li>`).join('')}</ul>` : '<p>Delivery charges are shown at checkout.</p>'}<p class="small"><strong>Estimated delivery:</strong> ${x.days || 10} calendar days after order confirmation${x.ifToday ? ` (if confirmed today: ${esc(x.ifToday)})` : ''}.</p><p class="small muted">Your order is confirmed when your payment is verified. Your delivery charge and final total are shown before you pay. See <a href="/shipping">shipping</a> and <a href="/returns">returns</a>.</p></div>
<div class="desc"><h2>Product details</h2>${esc(p.description).split(/\n{2,}/).map((x) => `<p>${x.replace(/\n/g, '<br>')}</p>`).join('')}</div></div></div>
${rel.length ? `<section class="section related"><div class="sec-head"><h2>You may also like</h2></div><div class="grid">${rel.map((r) => card(r, ctx)).join('')}</div></section>` : ''}</div>`;
  const ld = !p.is_development && purchasable.length ? JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.description.slice(0, 500), image: p.images.map((i) => absUrl(i.url)), offers: { '@type': 'Offer', priceCurrency: p.currency, price: (Math.min(...purchasable.map((v) => v.price_minor)) / 100).toFixed(2), url: `${cfg.siteUrl}/product/${p.slug}` } }) : '';
  return layout(ctx, { title: p.name, desc: (p.summary || p.description).replace(/\s+/g, ' ').slice(0, 155), body, image: main?.url, jsonld: ld, noindex: !!p.is_development });
}

function cartPage(ctx, ls, t, zones = []) {
  const bad = ls.some((l) => l.problem);
  const fees = zones.map((z) => z.fee_minor);
  const body = `<section class="page-head"><div class="wrap"><h1>Your cart</h1></div></section><div class="wrap section">${ls.length ? `
<div class="cart-layout"><ul class="lines">${ls.map((l) => `<li class="line"><a href="/product/${esc(l.slug)}" tabindex="-1" aria-hidden="true">${pimg(l.image, l.category_slug, { w: 96, h: 96 })}</a>
<div class="line-main"><a href="/product/${esc(l.slug)}"><strong>${esc(l.name)}</strong></a><br><span class="muted">${esc(l.variant_label)}${optText(l.options_json) ? ` &middot; ${esc(optText(l.options_json))}` : ''}</span>
<div class="small">${price(l.price_minor)} each</div>${l.problem ? `<p class="alert" role="alert">${esc(l.problem)}</p>` : ''}
<div class="line-actions"><form method="post" action="/cart/update" class="qty-form">${csrfField(ctx)}<input type="hidden" name="variant_id" value="${l.variant_id}"><label class="sr" for="q${l.variant_id}">Quantity for ${esc(l.name)}</label><input id="q${l.variant_id}" name="quantity" type="number" min="1" max="20" value="${l.quantity}" inputmode="numeric"><button class="btn btn-small btn-outline" type="submit">Update</button></form>
<form method="post" action="/cart/remove">${csrfField(ctx)}<input type="hidden" name="variant_id" value="${l.variant_id}"><button class="link-btn" type="submit">Remove<span class="sr"> ${esc(l.name)}</span></button></form></div></div>
<div class="line-total">${price(l.line_total)}</div></li>`).join('')}</ul>
<aside class="summary" aria-label="Order summary"><h2>Order summary</h2><dl><dt>Subtotal (${plural(ls.reduce((s, l) => s + l.quantity, 0), 'item')})</dt><dd>${price(t.subtotal)}</dd><dt>Delivery</dt><dd>${fees.length ? `${Math.min(...fees) === Math.max(...fees) ? price(fees[0]) : `${price(Math.min(...fees))} to ${price(Math.max(...fees))}`}<br><span class="small muted">chosen at checkout</span>` : 'Calculated at checkout'}</dd></dl>
${bad ? '<p class="alert">Please fix the items marked above before checking out.</p><span class="btn btn-lg btn-block btn-disabled" aria-disabled="true">Proceed to checkout</span>' : '<a class="btn btn-lg btn-block" href="/checkout">Proceed to checkout</a>'}
<p class="center small"><a href="/shop">Continue shopping</a></p></aside></div>` : `<div class="empty"><h2>Your cart is empty</h2><p>Browse the catalogue and add something you like.</p><p><a class="btn" href="/shop">Browse products</a></p></div>`}</div>`;
  return layout(ctx, { title: 'Cart', body, noindex: true });
}

function field(name, label, v, e, attrs = '') {
  return `<div class="field${e[name] ? ' has-error' : ''}"><label for="${name}">${label}</label><input id="${name}" name="${name}" value="${esc(v[name] ?? '')}" ${attrs}${e[name] ? ` aria-invalid="true" aria-describedby="${name}-err"` : ''}>${e[name] ? `<p class="err" id="${name}-err">${esc(e[name])}</p>` : ''}</div>`;
}
const METHOD = {
  paystack: (on) => ['Pay online with Paystack', on ? 'Card (including Mastercard, where enabled), bank transfer or USSD, on Paystack\'s secure page. We never see your card details.' : 'Paystack has not been activated for this store yet. Your order will be saved, but payment cannot be taken until it is.'],
  demo: () => ['Demonstration checkout (no payment)', 'For presentation and testing. Completes the order journey without taking any money. Nothing will be delivered.'],
};
function checkoutPage(ctx, ls, zones, v = {}, e = {}, key, methods = ['paystack'], paystackOn = false, info = {}) {
  const sub = ls.reduce((s, l) => s + l.line_total, 0);
  const zsel = Number(v.zone_id) || zones[0]?.id;
  const msel = v.payment_method && methods.includes(v.payment_method) ? v.payment_method : 'paystack';
  const z0 = zones.find((z) => z.id === zsel) || zones[0];
  const body = `<section class="page-head"><div class="wrap"><ol class="progress" aria-label="Checkout steps"><li class="done">Cart</li><li aria-current="step">Details</li><li>Review &amp; pay</li></ol><h1>Checkout</h1></div></section>
<div class="wrap section">${Object.keys(e).length ? '<p class="alert" role="alert">Please correct the highlighted fields.</p>' : ''}
<div class="cart-layout"><form method="post" action="/checkout" class="form panel" novalidate id="checkout-form">${csrfField(ctx)}<input type="hidden" name="checkout_key" value="${esc(key)}">
<h2><span class="stepnum">1</span> Contact details</h2>${field('name', 'Full name', v, e, 'autocomplete="name" required')}<div class="two">${field('email', 'Email address', v, e, 'type="email" autocomplete="email" required')}${field('phone', 'Phone number', v, e, 'type="tel" autocomplete="tel" required placeholder="e.g. 0803 000 0000"')}</div>
<h2><span class="stepnum">2</span> Delivery</h2><fieldset class="opts${e.zone_id ? ' has-error' : ''}"><legend>Delivery destination</legend>${zones.map((z) => `<label class="opt"><input type="radio" name="zone_id" value="${z.id}" data-fee="${z.fee_minor}"${z.id === zsel ? ' checked' : ''} required><span><strong>${esc(z.name)}</strong> <span class="opt-p">${price(z.fee_minor)}</span><small>${z.confirmed ? (z.estimate_text ? esc(z.estimate_text) : 'Confirmed delivery charge') : 'Preliminary charge, not yet confirmed by our delivery partners'}</small></span></label>`).join('')}${e.zone_id ? `<p class="err">${esc(e.zone_id)}</p>` : ''}</fieldset>
${field('address', 'Street address', v, e, 'autocomplete="street-address" required')}<div class="two">${field('city', 'City / town', v, e, 'autocomplete="address-level2" required')}${field('state', 'State', v, e, 'autocomplete="address-level1" required')}</div><div class="two">${field('postal', 'Postal code (optional)', v, e, 'autocomplete="postal-code"')}<div class="field"><label for="country">Country</label><input id="country" value="${esc([...new Set(zones.map((z) => COUNTRY[z.country_code] || z.country_code))].join(', '))}" readonly aria-describedby="country-help"><p class="small muted" id="country-help">We currently deliver within Nigeria only.</p></div></div>
<div class="field"><label for="notes">Delivery instructions (optional)</label><textarea id="notes" name="notes" rows="3" maxlength="300">${esc(v.notes ?? '')}</textarea></div>
<h2><span class="stepnum">3</span> Payment method</h2><fieldset class="opts${e.payment_method ? ' has-error' : ''}"><legend class="sr">Payment method</legend>${methods.map((m) => { const [t, d] = METHOD[m](paystackOn); return `<label class="opt"><input type="radio" name="payment_method" value="${m}"${m === msel ? ' checked' : ''} required><span><strong>${t}</strong><small>${d}</small></span></label>`; }).join('')}${e.payment_method ? `<p class="err">${esc(e.payment_method)}</p>` : ''}</fieldset>
<div class="info-box">${info.timing === 'review_first' ? `<p><strong>How payment works:</strong> after you place your order we check that your <strong>exact items</strong> are available, then send you a secure payment link. You are not charged when you place the order.</p>` : `<p><strong>How payment works:</strong> you pay securely on the next page. If an exact item cannot be obtained, we contact you before changing anything and refund what you paid for it.</p>`}<p><strong>Estimated delivery:</strong> ${info.days || 10} calendar days after your order is confirmed (when your payment is verified)${info.ifToday ? `. If confirmed today: ${esc(info.ifToday)}` : ''}.</p></div>
<p class="small muted">We collect only what we need to process and deliver your order. See our <a href="/privacy">privacy policy</a>. The next page shows your order and final total before any payment.</p>
<button class="btn btn-lg btn-block" type="submit">${info.timing === 'review_first' ? 'Place order (no payment yet)' : 'Review order and total'}</button></form>
<aside class="summary" aria-label="Order summary"><h2>Your items</h2><ul class="mini">${ls.map((l) => `<li>${pimg(l.image, l.category_slug, { w: 48, h: 48 })}<span>${esc(l.name)}<br><small class="muted">${esc(l.variant_label)}${optText(l.options_json) ? ` (${esc(optText(l.options_json))})` : ''} &times; ${l.quantity}</small></span><span>${price(l.line_total)}</span></li>`).join('')}</ul>
<dl><dt>Subtotal</dt><dd>${price(sub)}</dd><dt>Delivery</dt><dd id="sum-del">${z0 ? price(z0.fee_minor) : 'Choose destination'}</dd><dt class="grand">Total</dt><dd class="grand" id="sum-total" data-sub="${sub}" data-currency="${esc(cfg.currency)}" data-locale="${esc(cfg.locale)}">${price(sub + (z0?.fee_minor || 0))}</dd></dl>
<p class="small muted">Totals are recalculated by our server from current prices when you continue.</p></aside></div></div>`;
  return layout(ctx, { title: 'Checkout', body, noindex: true });
}

const ITEM_CUSTOMER = { pending: '', available: 'Available', secured: 'Secured for you', unavailable: 'Not yet found: we will contact you before any change', removed: 'Removed with your approval' };
const optText = (j) => { try { const o = JSON.parse(j || '{}'); return Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(', '); } catch { return ''; } };
function orderPage(ctx, o, its, token, x = {}) {
  const demo = o.payment_method === 'demo';
  const confirmed = o.status === 'confirmed';
  const first = String(o.customer_name).split(/\s+/)[0];
  const est = o.estimated_delivery_date ? dd.formatDate(o.estimated_delivery_date) : '';
  const hero = confirmed ? `<div class="confirm"><div class="confirm-icon">${I.check}</div><div><h1>${demo ? 'Demonstration order confirmed' : `Thank you, ${esc(first)}`}</h1><p>${demo ? 'The full order journey worked. <strong>No payment was taken and nothing will be delivered.</strong>' : `Your payment has been verified and order <strong>${esc(o.reference)}</strong> is confirmed.`}</p><p class="small">Order reference: <strong>${esc(o.reference)}</strong></p></div></div>`
    : o.status === 'pending_review' ? `<div class="confirm"><div class="confirm-icon">${I.check}</div><div><h1>Order received</h1><p>Thank you, ${esc(first)}. We are now checking that the <strong>exact items</strong> you chose are available. We will send you a payment link once they are confirmed. <strong>You have not been charged.</strong></p><p class="small">Order reference: <strong>${esc(o.reference)}</strong></p></div></div>`
    : `<ol class="progress" aria-label="Checkout steps"><li class="done">Cart</li><li class="done">Details</li><li aria-current="step">Review &amp; pay</li></ol><h1>Order ${esc(o.reference)}</h1>`;
  const estBox = confirmed && est ? `<div class="est-box"><span class="est-label">${I.truck} Estimated delivery</span><strong>${esc(est)}</strong><span class="small">${o.original_estimated_delivery_date && o.original_estimated_delivery_date !== o.estimated_delivery_date ? `Updated from ${esc(dd.formatDate(o.original_estimated_delivery_date))}. ` : ''}${x.days || 10} calendar days after order confirmation (${esc(dd.formatDateTime(o.confirmed_at))}). This is an estimate: we still need to source and deliver your items, and we will tell you if it changes.</span></div>`
    : o.status !== 'cancelled' ? `<p class="small muted">Estimated delivery: ${x.days || 10} calendar days after order confirmation. Your order is confirmed when your payment is verified.</p>` : '';
  const body = `<section class="page-head"><div class="wrap narrow">${hero}</div></section><div class="wrap section narrow">
<p class="status-box" role="status">${esc(ctx.statusText)}</p>
${o.needs_attention && o.status !== 'cancelled' && its.some((i) => i.item_status === 'unavailable') ? '<p class="note-dev"><strong>We need your decision on part of this order.</strong> We will contact you by phone or email. Nothing will be substituted or changed without your approval.</p>' : ''}
${o.refund_due_minor > 0 ? `<p class="note-dev">A refund of <strong>${money.format(o.refund_due_minor, o.currency)}</strong> is being processed to your original payment method.</p>` : ''}
${demo ? '<p class="note-dev">Test order placed with the demonstration checkout: no payment was taken and it will not be delivered.</p>' : ''}
${estBox}
<dl class="kv"><dt>Order status</dt><dd>${esc(ctx.labels.order)}</dd><dt>Payment</dt><dd>${esc(ctx.labels.payment)}</dd><dt>Delivery progress</dt><dd>${esc(ctx.labels.fulfil)}</dd><dt>Order date</dt><dd>${esc(dd.formatDateTime(o.created_at))}</dd>
${o.tracking_number ? `<dt>Tracking</dt><dd>${esc(o.tracking_number)}${/^https:\/\//.test(o.tracking_url || '') ? ` (<a href="${esc(o.tracking_url)}" rel="noopener noreferrer">track</a>)` : ''}</dd>` : ''}</dl>
<h2>What you ordered</h2><p class="small muted">We source exactly these items. We never substitute a different product, brand, size, colour or model without your approval.</p>
<ul class="olines">${its.map((i) => `<li class="oline${i.item_status === 'removed' ? ' removed' : ''}">${pimg(i.image_url, '', { w: 72, h: 72 })}<div><strong>${esc(i.product_name)}</strong><br><span class="muted small">${esc(i.variant_label)}${optText(i.options_json) ? ` &middot; ${esc(optText(i.options_json))}` : ''} &middot; SKU ${esc(i.sku)}</span><br><span class="small">${money.format(i.unit_price_minor, o.currency)} &times; ${i.quantity}</span>${ITEM_CUSTOMER[i.item_status] ? ` <span class="tag ${i.item_status === 'unavailable' ? 'tag-dev' : i.item_status === 'removed' ? 'tag-muted' : 'tag-ok'}">${ITEM_CUSTOMER[i.item_status]}</span>` : ''}</div><div class="num">${money.format(i.line_total_minor, o.currency)}</div></li>`).join('')}</ul>
<dl class="totals"><dt>Subtotal</dt><dd>${money.format(o.subtotal_minor, o.currency)}</dd><dt>Delivery (${esc(o.delivery_zone_name)})${o.delivery_confirmed ? '' : ' <span class="tag tag-dev">preliminary</span>'}</dt><dd>${money.format(o.delivery_fee_minor, o.currency)}</dd>
${o.discount_minor ? `<dt>Discount</dt><dd>-${money.format(o.discount_minor, o.currency)}</dd>` : ''}<dt class="grand">Total${demo ? ' (demonstration, not charged)' : ''}</dt><dd class="grand">${money.format(o.total_minor, o.currency)}</dd></dl>
${x.canPay ? `<form method="post" action="/order/${esc(o.reference)}/pay" class="pay-box">${csrfField(ctx)}<input type="hidden" name="t" value="${esc(token)}"><button class="btn btn-lg btn-block" type="submit">${o.payment_status === 'unpaid' ? 'Pay' : 'Try payment again'} ${money.format(o.total_minor, o.currency)} securely</button><p class="small muted center">You will be taken to Paystack's secure page (card payments including Mastercard, where enabled). We never see or store your card details.</p></form>` : ''}
${!demo && o.status === 'awaiting_payment' && !x.payConfigured ? '<p class="alert">Online payment is not switched on for this store yet. Your order is saved and no money has been taken.</p>' : ''}
${demo && o.status === 'awaiting_payment' ? `<form method="post" action="/order/${esc(o.reference)}/demo-confirm" class="pay-box">${csrfField(ctx)}<input type="hidden" name="t" value="${esc(token)}"><button class="btn btn-lg btn-block" type="submit">Complete demonstration payment</button><p class="small muted center">No money is taken. This shows the confirmation step and the delivery estimate.</p></form>` : ''}
${x.events?.length ? `<h2>Order updates</h2><ol class="timeline">${x.events.slice().reverse().map((e) => `<li><time>${esc(dd.formatDateTime(e.created_at))}</time><p>${esc(e.body)}</p></li>`).join('')}</ol>` : ''}
<h2>Delivery details</h2><p>${esc(o.customer_name)}<br>${esc(o.ship_address)}, ${esc(o.ship_city)}, ${esc(o.ship_state)}, ${esc(COUNTRY[o.ship_country] || o.ship_country)}<br>${esc(o.customer_email)} &middot; ${esc(o.customer_phone)}${o.delivery_notes ? `<br><span class="muted">Instructions: ${esc(o.delivery_notes)}</span>` : ''}</p>
<p class="small muted">Keep this page's link private: it gives access to your order details. You can also find this order later on the <a href="/track">track order</a> page with your reference and email. Questions? Email ${mail()} or <a href="/contact">contact us</a> and quote ${esc(o.reference)}.</p>
${confirmed ? '<p><a class="btn btn-outline" href="/shop">Continue shopping</a></p>' : ''}</div>`;
  return layout(ctx, { title: `Order ${o.reference}`, body, noindex: true });
}

function trackPage(ctx, v = {}, error = '') {
  const body = `<section class="page-head"><div class="wrap narrow"><h1>Track your order</h1><p class="lead-sm">Enter the order reference (it starts with NX-) and the email address used at checkout.</p></div></section><div class="wrap section narrow">
${error ? `<p class="alert" role="alert">${esc(error)}</p>` : ''}<form method="post" action="/track" class="form panel">${csrfField(ctx)}${field('reference', 'Order reference', v, {}, 'required placeholder="NX-..." autocapitalize="characters" maxlength="40"')}${field('email', 'Email address', v, {}, 'type="email" autocomplete="email" required')}<button class="btn" type="submit">Find my order</button></form></div>`;
  return layout(ctx, { title: 'Track your order', desc: `Check the status of your ${C.short} order.`, body, noindex: true });
}

function contactPage(ctx, v = {}, e = {}, sent = false) {
  const body = `<section class="page-head"><div class="wrap"><h1>Contact us</h1><p class="lead-sm">Questions about a product or an order? We are happy to help.</p></div></section><div class="wrap section"><div class="contact-grid">
<div class="panel contact-card"><h2>${I.mail} Email</h2><p>${mail()}</p>${C.phone ? `<h2>Phone</h2><p>${esc(C.phone)}</p>` : ''}${C.address ? `<h2>Address</h2><p>${esc(C.address)}</p>` : ''}<p class="small muted">For an existing order, please include your order reference (it starts with NX-).</p><p class="small">${esc(C.name)}<br>RC No: ${esc(C.rc)}</p></div>
<div>${sent ? '<p class="flash-box" role="status">Thank you. Your message has been received and saved. We will reply by email.</p>' : `
<form method="post" action="/contact" class="form panel" novalidate>${csrfField(ctx)}<div class="hp" aria-hidden="true"><label for="website">Leave empty</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
<div class="two">${field('name', 'Your name', v, e, 'autocomplete="name" required')}${field('email', 'Email address', v, e, 'type="email" autocomplete="email" required')}</div>${field('subject', 'Subject (optional)', v, e)}
<div class="field${e.message ? ' has-error' : ''}"><label for="message">Message</label><textarea id="message" name="message" rows="6" maxlength="2000" required>${esc(v.message ?? '')}</textarea>${e.message ? `<p class="err">${esc(e.message)}</p>` : ''}</div>
<button class="btn" type="submit">Send message</button><p class="small muted">Messages are stored securely and reviewed by our team. If the form is unavailable, email us directly.</p></form>`}</div></div></div>`;
  return layout(ctx, { title: 'Contact', desc: `Contact ${C.short} for help with products and orders.`, body });
}

const DRAFT = '<p class="note-dev"><strong>Draft policy.</strong> This text has not yet been approved by the business. It must be reviewed and confirmed (and, where appropriate, checked by a legal adviser) before the store goes live.</p>';
const PAGES = {
  about: ['About us', () => `<p class="lead-sm">${esc(C.name)} (RC No: ${esc(C.rc)}) is a Nigerian online retail business. Our aim is to make online shopping simple, secure and enjoyable, with clear prices and clear communication.</p>
<h2>What we do</h2><p>You choose exactly what you want on our website. After your order is confirmed, we source those exact items and arrange delivery to you. We show each product at our own price and the full total, including delivery, before you pay.</p>
<h2>How we work</h2><ul class="ticks"><li>We tell you plainly what is known about a product, its availability and its delivery.</li><li>We never substitute a different product, brand, size, colour or model without your approval.</li><li>Payments are handled by a regulated payment provider; we never store card details.</li><li>Every order has a private order page and a reference you can quote when you contact us.</li></ul>
<p>Have a question? <a href="/contact">Get in touch</a>.</p>`],
  faq: ['Frequently asked questions', () => `${DRAFT}<details open><summary>How do I order?</summary><p>Add products to your cart, go to checkout, enter your delivery details, review your total and pay through our payment provider.</p></details><details><summary>Do I need an account?</summary><p>No. You check out as a guest. Your order page link, or the <a href="/track">track order</a> page (reference + email), shows its status.</p></details><details><summary>What payment methods can I use?</summary><p>The methods offered by our payment provider (Paystack) at the payment step, such as card, bank transfer or USSD, once online payment is activated. We do not see or store your card details.</p></details><details><summary>How much is delivery?</summary><p>Delivery charges are shown for each destination at checkout. See <a href="/shipping">shipping &amp; delivery</a>.</p></details><details><summary>How long will delivery take?</summary><p>Estimated delivery is 10 calendar days after your order is confirmed (when your payment is verified). The date is shown on your order page.</p></details><details><summary>What if an item is not available?</summary><p>We contact you first. We never replace it with a different product, brand, size, colour or model without your approval. If you prefer, we remove it and refund you for it, or cancel the order with a full refund.</p></details><details><summary>When do I pay?</summary><p>Depending on the store's current setting, either at checkout, or after we have checked that your exact items are available (we then send you a secure payment link). The checkout page tells you which.</p></details><details><summary>How do returns work?</summary><p>See <a href="/returns">returns &amp; refunds</a>. The final policy is yet to be confirmed.</p></details><details><summary>Do you ship outside Nigeria?</summary><p>Not yet. International destinations will be added only once shipping, payment and supplier coverage have been confirmed.</p></details><details><summary>How can I contact you?</summary><p>Email ${mail()} or use the <a href="/contact">contact form</a>.</p></details>`],
  shipping: ['Shipping & delivery', (x) => `${DRAFT}<h2>Delivery charges</h2>${x.zones?.length ? `<ul class="ticks">${x.zones.map((z) => `<li>${zoneLine(z)}</li>`).join('')}</ul><p class="small muted">Charges marked "preliminary" are initial business settings, not verified courier rates. They may change before launch.</p>` : '<p>Delivery destinations and charges have not been set up yet.</p>'}
<h2>Delivery times</h2><p>Estimated delivery is <strong>10 calendar days after your order is confirmed</strong>. Your order is confirmed when your payment has been verified by our payment provider. The estimated date is shown on your order page. It is an estimate, not a guarantee: we personally source each item after you order, and if sourcing or delivery is delayed we will update your order page and tell you.</p>
<h2>How it works</h2><p>You always see the delivery charge and your final total before you pay. We source exactly the items you ordered after your order is confirmed. If an exact item cannot be found, we contact you: nothing is substituted or changed without your approval, and you are refunded for anything we cannot supply.</p><p>We currently deliver within Nigeria only.</p>`],
  returns: ['Returns & refunds', () => `${DRAFT}<p>The returns and refunds policy is <strong>pending confirmation</strong>. It will describe eligibility, time limits, who pays return costs, and how damaged, wrong or lost items are handled, in line with applicable consumer law and our supplier terms.</p><p>Until then, please <a href="/contact">contact us</a> about any order problem and quote your order reference.</p>`],
  privacy: ['Privacy policy', () => `${DRAFT}<p>We collect only the information needed to process and deliver orders and answer enquiries: your name, email, phone number, delivery address and order details. Payments are processed by our payment provider; we do not store card numbers or security codes.</p><p>Your details may be shared with our payment provider and fulfilment partners solely to complete your order. We do not sell personal data. To ask about your data, email ${mail()}.</p><p>The store uses essential cookies only (cart and security). Retention periods and the full Nigeria Data Protection Act 2023 compliance wording are to be confirmed.</p>`],
  terms: ['Terms & conditions', () => `${DRAFT}<p>These terms are a placeholder. They will cover: who we are (${esc(C.name)}, RC No ${esc(C.rc)}), prices and currency, availability, order acceptance, payment, delivery, returns and refunds, liability, and governing law.</p><p>Prices are shown in ${esc(cfg.currency)}. An order is accepted only after payment has been verified.</p>`],
};
function infoPage(ctx, slug, extra = {}) {
  const [t, html] = PAGES[slug];
  return layout(ctx, { title: t, desc: t + ' - ' + C.short, body: `<section class="page-head"><div class="wrap narrow"><h1>${esc(t)}</h1></div></section><div class="wrap section narrow prose">${html(extra)}</div>` });
}
function notFound(ctx) {
  return layout(ctx, { title: 'Page not found', noindex: true, body: '<div class="wrap section narrow center"><h1>Page not found</h1><p>Sorry, we could not find that page.</p><p><a class="btn" href="/shop">Go to the shop</a></p></div>' });
}
function errorPage(ctx, msg = 'Something went wrong on our side. Please try again shortly.') {
  return layout(ctx, { title: 'Error', noindex: true, body: `<div class="wrap section narrow center"><h1>Sorry</h1><p>${esc(msg)}</p><p><a class="btn" href="/">Back to home</a></p></div>` });
}
module.exports = { layout, home, shop, product, cartPage, checkoutPage, orderPage, trackPage, contactPage, infoPage, notFound, errorPage, PAGES, csrfField, esc, price, card };
