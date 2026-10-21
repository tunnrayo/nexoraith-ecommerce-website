'use strict';
// Product images: make them durable and never show a broken image.
//  - downloadAll(): saves a permanent copy of every remote product image (e.g. DummyJSON's CDN) into the store's own storage
//      target 'uploads' -> UPLOAD_DIR/catalog (Railway volume; survives restarts and redeploys)
//      target 'repo'    -> public/img/catalog (inside the project, so the files can be committed to Git)
//    and points the product at the local copy. The original URL is kept in original_url for reference.
//  - checkAll(): verifies that every image actually loads (local file present and a real image; remote URL answers with an image)
//    and records the result, so pages never use an image already known to be broken.
//  - placeholderFor(category): a designed, category-specific "photo coming soon" image (public/img/categories), used only when
//    a product has no working image. It is clearly a placeholder, never presented as a photo of the product.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const { q } = require('./db');
const { imageType } = require('./multipart');

const PUBLIC = path.join(cfg.root, 'public');
const CAT_DIR = path.join(PUBLIC, 'img', 'categories');
function placeholderFor(categorySlug) {
  const slug = String(categorySlug || '').replace(/[^a-z0-9-]/g, '');
  return slug && fs.existsSync(path.join(CAT_DIR, `${slug}.svg`)) ? `/img/categories/${slug}.svg` : '/img/categories/default.svg';
}
// Read the real pixel size from the file header (PNG, JPEG, WebP). Returns null if the bytes are not a decodable image header.
function imageInfo(buf) {
  const t = imageType(buf); if (!t) return null;
  try {
    if (t === 'png') return { type: t, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (t === 'webp') {
      const chunk = buf.slice(12, 16).toString();
      if (chunk === 'VP8 ') return { type: t, width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') { const b = buf.readUInt32LE(21); return { type: t, width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
      if (chunk === 'VP8X') return { type: t, width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      return null;
    }
    for (let i = 2; i < buf.length - 9;) { // JPEG: walk the segments to the start-of-frame marker
      if (buf[i] !== 0xff) return null;
      const m = buf[i + 1]; const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { type: t, height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  } catch { /* truncated */ }
  return null;
}
const isRemote = (u) => /^https?:\/\//.test(String(u || ''));
function localFile(u) {
  if (String(u).startsWith('/uploads/')) return path.join(cfg.uploadDir, path.normalize(u.slice(9)).replace(/^(\.\.[/\\])+/, ''));
  if (/^\/(img|images)\//.test(String(u))) return path.join(PUBLIC, path.normalize(u).replace(/^(\.\.[/\\])+/, ''));
  return null;
}
function localOk(u) {
  const f = localFile(u); if (!f) return false;
  try { const fd = fs.openSync(f, 'r'); const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd); return !!imageType(b) || /\.svg$/i.test(f); } catch { return false; }
}
async function remoteOk(u, timeout = 10000) {
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(timeout) });
    if (!res.ok) return false;
    const reader = res.body.getReader(); const { value } = await reader.read(); reader.cancel().catch(() => {});
    return !!(value && imageType(Buffer.from(value)));
  } catch { return false; }
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const it = items[i++]; await fn(it); } })); }

// Every image reference of active (published) products: gallery rows and card images.
function refs() {
  const gallery = q.all("SELECT i.id, i.url, 'gallery' kind FROM product_images i JOIN products p ON p.id=i.product_id WHERE p.status='published'");
  const cards = q.all("SELECT id, card_image_url url, 'card' kind FROM products WHERE status='published' AND card_image_url<>''");
  return [...gallery, ...cards];
}
function mark(r, status) {
  if (r.kind === 'gallery') q.run("UPDATE product_images SET status=?, checked_at=datetime('now') WHERE id=?", status, r.id);
  else q.run('UPDATE products SET card_image_status=? WHERE id=?', status, r.id);
}
async function checkAll({ concurrency = 6 } = {}) {
  const all = refs(); const out = { checked: all.length, ok: 0, broken: 0 };
  await pool(all, concurrency, async (r) => { const ok = isRemote(r.url) ? await remoteOk(r.url) : localOk(r.url); mark(r, ok ? 'ok' : 'broken'); out[ok ? 'ok' : 'broken']++; });
  return out;
}
async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > 5 * 1024 * 1024) throw new Error('empty or larger than 5 MB');
  const ext = imageType(buf); if (!ext) throw new Error('not a JPG/PNG/WebP image');
  return { buf, ext };
}
// Download each remote image once (same URL = same file), store it locally and re-point the product to it.
async function downloadAll({ target = 'uploads', concurrency = 4 } = {}) {
  const dir = target === 'repo' ? path.join(PUBLIC, 'img', 'catalog') : path.join(cfg.uploadDir, 'catalog');
  const prefix = target === 'repo' ? '/img/catalog/' : '/uploads/catalog/';
  fs.mkdirSync(dir, { recursive: true });
  const remote = refs().filter((r) => isRemote(r.url));
  const urls = [...new Set(remote.map((r) => r.url))];
  const local = new Map(); const out = { remote: urls.length, saved: 0, reused: 0, failed: 0, errors: [] };
  await pool(urls, concurrency, async (u) => {
    const name = crypto.createHash('sha256').update(u).digest('hex').slice(0, 24);
    const existing = fs.readdirSync(dir).find((f) => f.startsWith(name + '.'));
    if (existing && localOk(prefix + existing)) { local.set(u, prefix + existing); out.reused++; return; }
    try { const { buf, ext } = await fetchImage(u); fs.writeFileSync(path.join(dir, `${name}.${ext}`), buf); local.set(u, `${prefix}${name}.${ext}`); out.saved++; }
    catch (err) { out.failed++; if (out.errors.length < 10) out.errors.push(`${u}: ${err.message}`); }
  });
  for (const [u, l] of local) {
    q.run("UPDATE product_images SET url=?, original_url=CASE WHEN original_url='' THEN ? ELSE original_url END, status='ok', checked_at=datetime('now') WHERE url=?", l, u, u);
    q.run("UPDATE products SET card_image_url=?, card_image_original=CASE WHEN card_image_original='' THEN ? ELSE card_image_original END, card_image_status='ok' WHERE card_image_url=?", l, u, u);
    q.run('UPDATE order_items SET image_url=? WHERE image_url=?', l, u); // same picture, now stored permanently
  }
  return out;
}
// Summary for Admin: how many active products have a working image, which ones need attention.
function stats() {
  const rows = q.all(`SELECT p.id, p.name, p.card_image_url card, p.card_image_status cs,
      (SELECT COUNT(*) FROM product_images i WHERE i.product_id=p.id) n, (SELECT COUNT(*) FROM product_images i WHERE i.product_id=p.id AND i.status='ok') nok,
      (SELECT COUNT(*) FROM product_images i WHERE i.product_id=p.id AND i.status='broken') nbad,
      (SELECT COUNT(*) FROM product_images i WHERE i.product_id=p.id AND i.url LIKE 'https://%') nremote
    FROM products p WHERE p.status='published' ORDER BY p.id`);
  const s = { active: rows.length, verified: 0, unchecked: 0, needImage: [], remoteOnly: 0 };
  for (const r of rows) {
    const verified = r.cs === 'ok' || r.nok > 0;
    const anyUnknown = (r.card && r.cs === 'unchecked') || r.n - r.nok - r.nbad > 0;
    if (r.nremote > 0 || /^https:/.test(r.card || '')) s.remoteOnly++;
    if (verified) s.verified++; else if (anyUnknown) s.unchecked++; else s.needImage.push({ id: r.id, name: r.name });
  }
  return s;
}
module.exports = { placeholderFor, checkAll, downloadAll, stats, localOk, isRemote, imageInfo };
