'use strict';
// DEMONSTRATION catalogue import from DummyJSON (https://dummyjson.com/docs/products).
// DummyJSON is NOT a supplier. Imported products are marked as demo data (is_development=1, source='dummyjson').
// What is imported: title, description, brand, category, a SAMPLE price, image URLs.
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
async function downloadImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`image HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new Error('image too large');
  const ext = imageType(buf); if (!ext) throw new Error('not a JPG/PNG/WebP image');
  fs.mkdirSync(cfg.uploadDir, { recursive: true });
  const name = `dj-${rand(9).replace(/[^A-Za-z0-9]/g, 'x')}.${ext}`;
  fs.writeFileSync(path.join(cfg.uploadDir, name), buf);
  return `/uploads/${name}`;
}
// Turn one DummyJSON product into our format, or return a list of problems.
function map(p, rate) {
  const errors = [];
  const id = Number(p?.id); if (!Number.isInteger(id) || id <= 0) errors.push('missing id');
  const title = String(p?.title || '').trim(); if (!title) errors.push('missing title');
  const usd = Number(p?.price); if (!(usd > 0)) errors.push('missing or invalid price');
  const category = slugify(p?.category); if (!category) errors.push('missing category');
  const imgs = [...(Array.isArray(p?.images) ? p.images : []), p?.thumbnail].filter((u, i, a) => typeof u === 'string' && imageOk(u) && a.indexOf(u) === i).slice(0, 6);
  if (errors.length) return { errors };
  const naira = Math.max(Math.round((usd * rate) / 50) * 50, 50); // SAMPLE price: arbitrary conversion, rounded to NGN 50
  const desc = String(p.description || '').trim();
  const summary = (desc.split(/(?<=\.)\s/)[0] || desc).slice(0, 160);
  return {
    slug: `dj-${id}-${slugify(title)}`.slice(0, 80), sku: `DJ-${id}`, name: title.slice(0, 150), category, categoryName: catName(category), summary,
    description: `${desc}${p.brand ? `\n\nBrand: ${String(p.brand).slice(0, 80)}` : ''}\n\nDEMONSTRATION PRODUCT imported from DummyJSON sample data. Not verified for sale; price is a sample.`,
    price_minor: naira * 100, images: imgs, alt: title.slice(0, 140),
  };
}
// options: { limit=200, rate=1500 (NGN per 1 USD sample price, arbitrary), update=false, downloadImages=false, publish=true }
async function importDummyJson({ limit = 200, rate = 1500, update = false, downloadImages = false, publish = true, base } = {}) {
  limit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500); rate = Number(rate) > 0 ? Number(rate) : 1500;
  const report = { fetched: 0, created: 0, updated: 0, skipped: 0, failed: [], imagesWithoutUrl: 0, imageErrors: 0 };
  const list = await fetchProducts(limit, base); // throws before any change if the API is unavailable
  report.fetched = list.length;
  for (const raw of list) {
    const m = map(raw, rate);
    if (m.errors) { report.failed.push({ item: `DummyJSON id ${raw?.id ?? '?'}`, errors: m.errors }); continue; }
    const existing = q.get('SELECT id FROM products WHERE slug=?', m.slug);
    if (existing && !update) { report.skipped++; continue; } // keeps any edits you made in Admin
    let urls = m.images;
    if (downloadImages && urls.length) {
      const local = [];
      for (const u of urls) { try { local.push(await downloadImage(u)); } catch { report.imageErrors++; } }
      urls = local.length ? local : urls;
    }
    if (!urls.length) report.imagesWithoutUrl++;
    try {
      tx(() => {
        q.run('INSERT INTO categories(slug,name,sort_order) VALUES(?,?,100) ON CONFLICT(slug) DO NOTHING', m.category, m.categoryName);
        const cat = q.get('SELECT id FROM categories WHERE slug=?', m.category).id;
        let pid;
        if (existing) {
          pid = existing.id;
          q.run("UPDATE products SET name=?, summary=?, description=?, category_id=?, is_development=1, source='dummyjson', updated_at=datetime('now') WHERE id=?", m.name, m.summary, m.description, cat, pid);
          report.updated++;
        } else {
          pid = Number(q.run("INSERT INTO products(slug,name,summary,description,category_id,currency,status,is_development,availability,source) VALUES(?,?,?,?,?,?,?,1,'available','dummyjson')", m.slug, m.name, m.summary, m.description, cat, cfg.currency, publish ? 'published' : 'draft').lastInsertRowid);
          report.created++;
        }
        q.run('DELETE FROM product_images WHERE product_id=?', pid);
        urls.forEach((u, i) => q.run('INSERT INTO product_images(product_id,url,alt,sort_order) VALUES(?,?,?,?)', pid, u, `${m.alt} (demo image ${i + 1})`, i));
        const v = q.get('SELECT id, product_id FROM variants WHERE sku=?', m.sku);
        if (v && v.product_id !== pid) throw new Error(`SKU ${m.sku} already belongs to another product`);
        if (v) q.run("UPDATE variants SET price_minor=?, updated_at=datetime('now') WHERE id=?", m.price_minor, v.id);
        else q.run("INSERT INTO variants(product_id,sku,label,options_json,price_minor,availability,stock_qty,sort_order) VALUES(?,?,'Standard','{}',?,'available',NULL,0)", pid, m.sku, m.price_minor);
      });
    } catch (err) { report.failed.push({ item: m.slug, errors: [err.message] }); }
  }
  return report;
}
module.exports = { importDummyJson, map, fetchProducts };
