'use strict';
// Catalogue import from DummyJSON (https://dummyjson.com/docs/products). These products are the store's starting catalogue.
// DummyJSON is NOT a supplier and its prices are NOT Nigerian market prices: the owner checks real availability per order
// (review-first workflow) and can edit every product. Imported rows carry source='dummyjson' (shown to the admin only).
// What is imported: title, description, brand, category, price converted at the configured rate (default NGN 1,500 per USD), image URLs.
// What is deliberately NOT imported: ratings, reviews, stock numbers, availabilityStatus, shipping/warranty/return text
// (they would be invented claims for this store). Availability is owned by the store and edited in Admin.
// The catalogue lives in our own database afterwards: customers never trigger calls to DummyJSON.
const fs = require('fs');
const path = require('path');
const cfg = require('../config');
const { q, tx } = require('../db');
const { rand } = require('../security');
const { imageType } = require('../multipart');

const slugify = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
const catName = (slug) => String(slug).split('-').map((w) => ({ mens: "Men's", womens: "Women's" }[w] || w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
const imageOk = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && cfg.imageHosts.includes(x.origin); } catch { return false; } };

async function fetchJson(url, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) { last = err; if (i < attempts - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1))); }
  }
  throw new Error(`Could not reach DummyJSON (${last?.message || 'unknown error'}). Nothing was changed.`);
}
// Fetch up to `limit` products, page by page.
async function fetchProducts(limit, base = cfg.dummyjsonUrl) {
  const out = []; let skip = 0; const page = Math.min(limit, 100);
  while (out.length < limit) {
    const j = await fetchJson(`${base}?limit=${page}&skip=${skip}`);
    if (!j || !Array.isArray(j.products)) throw new Error('DummyJSON returned an unexpected response (no "products" list). Nothing was changed.');
    out.push(...j.products);
    skip += j.products.length;
    if (!j.products.length || skip >= Number(j.total || 0)) break;
  }
  return out.slice(0, limit);
}
// Turn one DummyJSON product into our format, or return a list of problems.
function map(p, rate) {
  const errors = [];
  const id = Number(p?.id); if (!Number.isInteger(id) || id <= 0) errors.push('missing id');
  const title = String(p?.title || '').trim(); if (!title) errors.push('missing title');
  const usd = Number(p?.price); if (!(usd > 0)) errors.push('missing or invalid price');
  const category = slugify(p?.category); if (!category) errors.push('missing category');
  // Gallery = the product photos; card = DummyJSON's small thumbnail (much lighter for product grids).
  const imgs = (Array.isArray(p?.images) ? p.images : []).filter((u, i, a) => typeof u === 'string' && imageOk(u) && a.indexOf(u) === i).slice(0, 6);
  const thumb = typeof p?.thumbnail === 'string' && imageOk(p.thumbnail) ? p.thumbnail : '';
  if (errors.length) return { errors };
  const priceMinor = Math.round(usd * rate * 100); // exact conversion to kobo, e.g. 9.99 USD x 1,500 = NGN 14,985.00
  const desc = String(p.description || '').trim();
  const summary = (desc.split(/(?<=\.)\s/)[0] || desc).slice(0, 160);
  return {
    slug: `dj-${id}-${slugify(title)}`.slice(0, 80), sku: `DJ-${id}`, name: title.slice(0, 150), category, categoryName: catName(category), summary,
    description: `${desc}${p.brand ? `\n\nBrand: ${String(p.brand).slice(0, 80)}` : ''}`,
    price_minor: priceMinor, images: imgs.length ? imgs : (thumb ? [thumb] : []), thumb: thumb || imgs[0] || '', alt: title.slice(0, 140),
    source_ref: `dummyjson:${id}`, source_price_text: `${usd.toFixed(2)} USD x ${rate} = NGN ${(priceMinor / 100).toFixed(2)}`,
  };
}
// options: { limit=200, rate=cfg.importRate (NGN per 1 USD), update=false (refresh unedited imports), downloadImages=false, publish=true, archiveSamples=true }
// The bundled copy of DummyJSON's product data (MIT licence), used when the live API cannot be reached.
const SNAPSHOT = path.join(cfg.root, 'data', 'catalogue', 'dummyjson-products.json');
// Photos already installed in the project (public/images/products, listed in data/catalogue/image-manifest.json):
// a fresh database uses these local files straight away instead of linking to the remote source.
function installedPhotos() {
  const f = path.join(cfg.root, 'data', 'catalogue', 'image-manifest.json'); const m = new Map();
  try { for (const e of JSON.parse(fs.readFileSync(f, 'utf8')).products || []) for (const ph of e.photos || []) if (ph.status === 'installed' && ph.source_url && fs.existsSync(path.join(cfg.root, 'public', ph.local_path))) m.set(ph.source_url, ph.local_path); } catch { /* no manifest yet */ }
  return m;
}
function snapshotProducts(limit) { return JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')).products.slice(0, limit); }
// source: 'auto' (live API, else bundled snapshot), 'api' (live only), 'snapshot' (bundled only)
async function importDummyJson({ limit = 200, rate = cfg.importRate, update = false, downloadImages = false, publish = true, archiveSamples = true, base, source = base ? 'api' : 'auto' } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500); rate = Number(rate) > 0 ? Number(rate) : cfg.importRate;
  const report = { fetched: 0, created: 0, updated: 0, skipped: 0, keptEdits: 0, failed: [], imagesWithoutUrl: 0, imageErrors: 0, samplesArchived: 0, source: 'api', apiError: '' };
  let list;
  if (source === 'snapshot') { list = snapshotProducts(limit); report.source = 'snapshot'; }
  else {
    try { list = await fetchProducts(limit, base); } // throws before any change if the API is unavailable
    catch (err) { if (source !== 'auto') throw err; list = snapshotProducts(limit); report.source = 'snapshot'; report.apiError = err.message; }
  }
  report.fetched = list.length;
  const installed = installedPhotos(); report.installedPhotosUsed = 0;
  for (const raw of list) {
    const m = map(raw, rate);
    if (m.errors) { report.failed.push({ item: `DummyJSON id ${raw?.id ?? '?'}`, errors: m.errors }); continue; }
    // Match an earlier import by its DummyJSON id first (stable even if the title changes), then by SKU, then by web address.
    const existing = q.get("SELECT id, admin_edited_at, source_ref FROM products WHERE source='dummyjson' AND source_ref=?", m.source_ref)
      || q.get("SELECT p.id, p.admin_edited_at, p.source_ref FROM variants v JOIN products p ON p.id=v.product_id WHERE v.sku=? AND p.source='dummyjson'", m.sku)
      || q.get('SELECT id, admin_edited_at, source_ref FROM products WHERE slug=?', m.slug);
    if (existing && !existing.source_ref) q.run('UPDATE products SET source_ref=? WHERE id=?', m.source_ref, existing.id);
    if (existing && existing.admin_edited_at) { report.keptEdits++; continue; } // never overwrite a product the owner edited
    if (existing && !update) { report.skipped++; continue; }
    const urls = m.images;
    if (!urls.length) report.imagesWithoutUrl++;
    try {
      tx(() => {
        q.run('INSERT INTO categories(slug,name,sort_order) VALUES(?,?,100) ON CONFLICT(slug) DO NOTHING', m.category, m.categoryName);
        const cat = q.get('SELECT id FROM categories WHERE slug=?', m.category).id;
        let pid;
        if (existing) {
          pid = existing.id;
          q.run("UPDATE products SET name=?, summary=?, description=?, category_id=?, is_development=0, source='dummyjson', source_ref=?, source_price_text=?, updated_at=datetime('now') WHERE id=?", m.name, m.summary, m.description, cat, m.source_ref, m.source_price_text, pid);
          report.updated++;
        } else {
          pid = Number(q.run("INSERT INTO products(slug,name,summary,description,category_id,currency,status,is_development,availability,source,source_ref,source_price_text,card_image_url,card_image_original) VALUES(?,?,?,?,?,?,?,0,'available','dummyjson',?,?,?,?)", m.slug, m.name, m.summary, m.description, cat, cfg.currency, publish ? 'published' : 'draft', m.source_ref, m.source_price_text, m.thumb, m.thumb).lastInsertRowid);
          report.created++;
        }
        // Keep permanent local copies already saved for the same original image (refreshing must not undo a download).
        const kept = new Map(q.all("SELECT url, original_url, status FROM product_images WHERE product_id=? AND original_url<>'' AND url NOT LIKE 'https://%'", pid).map((r) => [r.original_url, r]));
        q.run('DELETE FROM product_images WHERE product_id=?', pid);
        urls.forEach((u, i) => { const k = kept.get(u); const loc = installed.get(u); if (loc) report.installedPhotosUsed++; q.run('INSERT INTO product_images(product_id,url,alt,sort_order,original_url,status) VALUES(?,?,?,?,?,?)', pid, loc || (k ? k.url : u), i ? `${m.alt}, view ${i + 1}` : m.alt, i, u, loc ? 'ok' : k ? k.status : 'unchecked'); });
        const keepCard = q.get("SELECT 1 x FROM products WHERE id=? AND card_image_original=? AND card_image_url<>'' AND card_image_url NOT LIKE 'https://%'", pid, m.thumb);
        const locCard = installed.get(m.thumb);
        if (locCard) q.run("UPDATE products SET card_image_url=?, card_image_original=?, card_image_status='ok' WHERE id=?", locCard, m.thumb, pid);
        else if (!keepCard) q.run("UPDATE products SET card_image_url=?, card_image_original=?, card_image_status='unchecked' WHERE id=?", m.thumb, m.thumb, pid);
        const v = q.get('SELECT id, product_id FROM variants WHERE sku=?', m.sku);
        if (v && v.product_id !== pid) throw new Error(`SKU ${m.sku} already belongs to another product`);
        if (v) q.run("UPDATE variants SET price_minor=?, updated_at=datetime('now') WHERE id=?", m.price_minor, v.id);
        else q.run("INSERT INTO variants(product_id,sku,label,options_json,price_minor,availability,stock_qty,sort_order) VALUES(?,?,'Standard','{}',?,'available',NULL,0)", pid, m.sku, m.price_minor);
      });
    } catch (err) { report.failed.push({ item: m.slug, errors: [err.message] }); }
  }
  // Once the imported catalogue exists, hide the old built-in sample illustrations (they stay in the database; orders keep their history).
  if (archiveSamples && q.get("SELECT 1 x FROM products WHERE source='dummyjson' AND status='published' LIMIT 1")) {
    report.samplesArchived = q.run("UPDATE products SET status='archived', updated_at=datetime('now') WHERE is_development=1 AND source='' AND slug LIKE 'demo-%' AND status<>'archived'").changes;
  }
  // Optionally save permanent copies of every image now (needs internet access to the image host).
  if (downloadImages) { const d = await require('../images').downloadAll(); report.imagesSaved = d.saved; report.imageErrors = d.failed; }
  return report;
}
module.exports = { importDummyJson, map, fetchProducts, snapshotProducts };
