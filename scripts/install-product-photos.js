'use strict';
// Installs each active product's photographs permanently into the project (public/images/products/<sku>/) and writes
// data/catalogue/image-manifest.json (one entry per active product: source URL, local path, size, pixel dimensions,
// SHA-256, usage-permission status, match confidence, verification). Works on your EXISTING database: no reset, no seed.
//
//   npm run photos:install                  download + validate + install + update the manifest (needs internet)
//   npm run photos:install -- --manifest-only   only (re)write the manifest from what is already installed
//   npm run photos:install -- --only=DJ-12  just one product (by SKU)
//
// Source used: the photo attached to the same catalogue record by the product API the catalogue came from (DummyJSON's
// image server). Photos you uploaded yourself in Admin are never replaced. Nothing is ever substituted: if a photo cannot be
// downloaded and validated, the product keeps its category placeholder and the manifest says why.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('../src/config');
const db = require('../src/db');
const { imageInfo } = require('../src/images');
const { q } = db;

const DEST = path.join(cfg.root, 'public', 'images', 'products');
const MANIFEST = path.join(cfg.root, 'data', 'catalogue', 'image-manifest.json');
const MIN_PX = 100; const MAX_BYTES = 5 * 1024 * 1024;
const args = process.argv.slice(2); const manifestOnly = args.includes('--manifest-only');
const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];

const PERMISSION = (brand) => (brand
  ? { status: 'not confirmed', note: `Photo supplied with the DummyJSON catalogue record. DummyJSON states no licence for its product photos, and "${brand}" product photos are normally owned by the brand. Confirm reseller use with ${brand}, its authorised distributor or your supplier, or replace with your own photo.` }
  : { status: 'not confirmed', note: 'Photo supplied with the DummyJSON catalogue record. DummyJSON states no licence for its product photos. Confirm the right to use it commercially or replace it with your own photo.' });
const localFile = (u) => (u.startsWith('/images/') || u.startsWith('/img/') ? path.join(cfg.root, 'public', u) : u.startsWith('/uploads/') ? path.join(cfg.uploadDir, u.slice(9)) : null);

function validate(buf) {
  if (buf && /^\s*</.test(buf.slice(0, 64).toString())) return { ok: false, error: 'received an HTML page, not an image' };
  if (!buf || buf.length < 200) return { ok: false, error: 'file too small or empty' };
  if (buf.length > MAX_BYTES) return { ok: false, error: 'larger than 5 MB' };
  const info = imageInfo(buf);
  if (!info) return { ok: false, error: /^\s*</.test(buf.slice(0, 64).toString()) ? 'received an HTML page, not an image' : 'not a decodable JPG/PNG/WebP image' };
  if (info.width < MIN_PX || info.height < MIN_PX) return { ok: false, error: `image only ${info.width}x${info.height}px` };
  return { ok: true, info };
}
async function getBytes(u) {
  const lf = localFile(u);
  if (lf) return fs.readFileSync(lf); // an earlier saved copy (e.g. npm run images:download) of the same original photo
  const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
const errMsg = (e) => (e.cause?.code ? `could not reach the image server (${e.cause.code})` : e.name === 'TimeoutError' ? 'image server did not answer within 20 s' : e.message);

(async () => {
  db.open();
  const products = q.all(`SELECT p.id, p.name, p.source, p.source_ref, p.card_image_url, p.card_image_original, c.slug category,
      (SELECT sku FROM variants v WHERE v.product_id=p.id ORDER BY sort_order,id LIMIT 1) sku
    FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.status='published' ORDER BY p.id`)
    .filter((p) => !only || p.sku === only);
  const snap = new Map(JSON.parse(fs.readFileSync(path.join(cfg.root, 'data', 'catalogue', 'dummyjson-products.json'), 'utf8')).products.map((x) => [`dummyjson:${x.id}`, x]));
  const reviews = new Map(q.all('SELECT * FROM photo_reviews').map((r) => [r.product_id, r]));
  const old = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { products: [] };
  const oldBy = new Map((old.products || []).map((e) => [e.source_ref || `id:${e.product_id}`, e]));
  const entries = [];
  for (const p of products) {
    const sku = String(p.sku || `P${p.id}`).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const brand = snap.get(p.source_ref)?.brand || '';
    const entry = { product_id: p.id, source_ref: p.source_ref || '', sku: p.sku, name: p.name, brand, category: p.category, photos: [] };
    if (p.source !== 'dummyjson') { // products you created yourself: your own photos, nothing to install
      const own = q.all('SELECT url FROM product_images WHERE product_id=? ORDER BY sort_order,id', p.id);
      Object.assign(entry, { source_type: 'owner (added in Admin)', usage_permission: { status: 'owner responsibility', note: 'Photos uploaded or linked by the store owner.' }, match_confidence: 'owner supplied', photos: own.map((r) => ({ role: 'gallery', local_path: r.url, status: 'owner photo' })) });
      entries.push(entry); continue;
    }
    // what to install: the card photo (thumbnail) and every gallery photo still pointing at the original source photos
    const card = { role: 'card', source_url: p.card_image_original || p.card_image_url, current: p.card_image_url };
    const gallery = q.all('SELECT id, url, original_url FROM product_images WHERE product_id=? ORDER BY sort_order,id', p.id)
      .map((r, i) => ({ role: 'gallery', row: r.id, n: i + 1, source_url: r.original_url || r.url, current: r.url }));
    const prev = oldBy.get(p.source_ref);
    for (const ph of [card, ...gallery]) {
      if (!ph.source_url) continue;
      const ownUpload = /^\/uploads\/p\d+-/.test(ph.current || ''); // uploaded by the owner in Admin: keep
      if (ownUpload) { entry.photos.push({ role: ph.role, source_url: ph.current, local_path: ph.current, status: 'owner photo (kept)' }); continue; }
      const prevPh = prev?.photos?.find((x) => x.source_url === ph.source_url && x.status === 'installed');
      const rel = `/images/products/${sku}/${ph.role === 'card' ? 'card' : ph.n}`;
      const rec = { role: ph.role, source_url: ph.source_url, local_path: '', status: 'pending' };
      try {
        let buf; let fromInstalled = false;
        const installed = prevPh && fs.existsSync(path.join(cfg.root, 'public', prevPh.local_path)) ? prevPh.local_path : null;
        if (installed) { buf = fs.readFileSync(path.join(cfg.root, 'public', installed)); fromInstalled = true; }
        else if (manifestOnly) { rec.status = 'not installed'; entry.photos.push(rec); continue; }
        else buf = await getBytes(ph.current && localFile(ph.current) ? ph.current : ph.source_url);
        const v = validate(buf);
        if (!v.ok) throw new Error(v.error);
        const target = fromInstalled ? installed : `${rel}.${v.info.type === 'jpg' ? 'jpg' : v.info.type}`;
        if (!fromInstalled) { fs.mkdirSync(path.join(DEST, sku), { recursive: true }); fs.writeFileSync(path.join(cfg.root, 'public', target), buf); }
        Object.assign(rec, { local_path: target, status: 'installed', bytes: buf.length, width: v.info.width, height: v.info.height, format: v.info.type, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
        // point the product at the installed file (only rows that still show this same original photo)
        if (ph.role === 'card') q.run("UPDATE products SET card_image_url=?, card_image_original=?, card_image_status='ok' WHERE id=? AND (card_image_url=? OR card_image_original=?)", target, ph.source_url, p.id, ph.current, ph.source_url);
        else q.run("UPDATE product_images SET url=?, original_url=?, status='ok', checked_at=datetime('now') WHERE id=?", target, ph.source_url, ph.row);
        if (ph.current !== target) q.run('UPDATE order_items SET image_url=? WHERE image_url=?', target, ph.current);
      } catch (e) { rec.status = 'failed'; rec.error = errMsg(e); }
      entry.photos.push(rec);
    }
    const inst = entry.photos.filter((x) => x.status === 'installed');
    const rv = reviews.get(p.id);
    Object.assign(entry, {
      source_type: 'catalogue product API (DummyJSON image server): the photo attached to this same catalogue record',
      usage_permission: PERMISSION(brand),
      match_confidence: rv?.verdict === 'matches' ? 'confirmed by owner visual check' : rv?.verdict === 'wrong' ? 'REJECTED by owner visual check' : 'same catalogue record (identity by record); visual check by owner still required',
      verification: { photos_installed: inst.length, photos_total: entry.photos.length, files_decoded: inst.length > 0 && inst.every((x) => x.width >= MIN_PX), product_points_to_local_files: inst.length > 0 && inst.every((x) => x.local_path.startsWith('/images/products/')), visual_check: rv ? `${rv.verdict} (${rv.reviewed_by}, ${rv.reviewed_at})` : 'pending' },
      resolution: inst.length > 0 && rv?.verdict !== 'wrong' ? 'photo installed (permission still to be confirmed)' : 'UNRESOLVED: exact product photo not installed; the category placeholder is shown',
      sources_checked: [
        { source: 'catalogue product API image (DummyJSON image server)', result: inst.length ? `${inst.length} of ${entry.photos.length} photo(s) downloaded and validated` : `not obtained: ${[...new Set(entry.photos.map((x) => x.error).filter(Boolean))].join('; ') || 'not attempted (manifest-only run)'}` },
        { source: brand ? `${brand} official site / authorised distributor` : 'manufacturer site', result: brand ? 'not checked automatically: needs a manual check and the brand\'s written permission for reseller use' : 'no brand in the catalogue record, so no manufacturer can be identified without inventing one' },
      ],
      checked_at: new Date().toISOString(),
    });
    entries.push(entry);
  }
  const dj = entries.filter((e) => e.source_ref.startsWith('dummyjson:'));
  const summary = {
    generated_at: new Date().toISOString(), mode: manifestOnly ? 'manifest-only' : 'install',
    active_products_checked: entries.length,
    with_installed_photo: dj.filter((e) => e.verification.photos_installed > 0).length,
    with_all_photos_installed: dj.filter((e) => e.verification.photos_installed > 0 && e.verification.photos_installed === e.verification.photos_total).length,
    usage_permission_confirmed: 0,
    usage_permission_requires_confirmation: dj.filter((e) => e.verification.photos_installed > 0).length,
    showing_category_fallback: dj.filter((e) => e.verification.photos_installed === 0).length,
    owner_managed_products: entries.length - dj.length,
    visually_checked_matches: dj.filter((e) => /^matches/.test(e.verification.visual_check)).length,
    visually_rejected: dj.filter((e) => /^wrong/.test(e.verification.visual_check)).length,
    unresolved: dj.filter((e) => /^UNRESOLVED/.test(e.resolution)).length,
    note: 'Installed = downloaded from the source, decoded, at least 100x100 px, stored under public/images/products and linked to the product. Commercial reuse is NOT confirmed for any DummyJSON photo (no licence stated). Visual match must be confirmed by the owner in Admin > Product photos. Products not installed keep their current photo link: the site shows the remote DummyJSON photo when the visitor can load it, otherwise the category placeholder.',
  };
  const out = { summary, products: entries };
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(out, null, 1));
  const failed = dj.flatMap((e) => e.photos.filter((x) => x.status === 'failed').map((x) => `${e.sku} ${x.role}: ${x.error}`));
  console.log(JSON.stringify(summary, null, 1));
  if (failed.length) { console.log(`Failed downloads: ${failed.length}. First few:`); for (const f of failed.slice(0, 8)) console.log('  ' + f); }
  console.log(`Manifest written to ${path.relative(cfg.root, MANIFEST)}.`);
})().catch((e) => { console.error(e.message); process.exit(1); });
