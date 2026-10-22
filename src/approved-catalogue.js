'use strict';
// The owner's APPROVED catalogue (data/catalogue/approved-products.json, 100 products supplied 2026-10-22).
//
// importApproved(): safe to run any number of times.
//   - creates missing products (matched by their stable id NX-001 ... NX-100, then by SKU); never duplicates
//   - refreshes products you have NOT edited in Admin (name, texts, category, price, private reference price)
//   - never touches products you edited in Admin, never changes visibility/availability you set, never touches orders
//   - links product photos found in public/images/products/ (<sku>.jpg|png|webp, extra photos <sku>-2.jpg ...)
//     after checking each file is a real, decodable image; photos you uploaded in Admin are kept
//   - no photo file = the neutral "Image not available" placeholder (never another product's photo)
// writeManifest(): data/catalogue/image-manifest.json, one entry per approved product (photo files, size, pixels,
//   SHA-256, source, permission and visual-check status).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const db = require('./db');
const { imageInfo } = require('./images');

const DATA = path.join(cfg.root, 'data', 'catalogue', 'approved-products.json');
const PHOTO_DIR = () => process.env.PRODUCT_PHOTO_DIR || path.join(cfg.root, 'public', 'images', 'products');
const MANIFEST = process.env.PRODUCT_MANIFEST_PATH || path.join(cfg.root, 'data', 'catalogue', 'image-manifest.json');
const MIN_PX = 200; const MAX_BYTES = 4 * 1024 * 1024;
const slugify = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
// Your private market (reference) prices are NOT part of the committed catalogue file. They are read from a separate file that stays
// on your own computer (ignored by Git): data/catalogue/private/reference-prices.json  { "prices": { "NX-001": 6150, ... } }
// If it is missing the import still works: products and public prices are loaded, and any private cost already saved is left unchanged.
const PRIVATE = () => process.env.APPROVED_PRIVATE_PATH || path.join(cfg.root, 'data', 'catalogue', 'private', 'reference-prices.json');
function load() {
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  let priv = {}; try { priv = JSON.parse(fs.readFileSync(PRIVATE(), 'utf8')).prices || {}; } catch { /* no private file: fine */ }
  for (const p of data.products) if (Number.isFinite(priv[p.id])) p.reference_price = priv[p.id];
  return data;
}

const srcText = (p, data) => `Approved list ${data.approved_on}, no. ${p.list_no}${Number.isFinite(p.reference_price) ? `: reference NGN ${p.reference_price.toLocaleString('en-NG')}, ` : ': '}Nexoraith price NGN ${p.price.toLocaleString('en-NG')}`;

function describe(p) {
  const lines = [];
  if (p.brand) lines.push(`Brand: ${p.brand}`);
  for (const d of p.details || []) lines.push(d);
  const head = lines.length ? `${lines.join('\n')}\n\n` : '';
  const confirm = p.brand
    ? 'Before you pay, we confirm the exact item with you (model, colour and size where these apply).'
    : 'Brand, model and colour are not fixed in this listing: before you pay, we confirm the exact item with you.';
  return `${head}${confirm} If anything differs from this listing, we contact you first and nothing is changed without your approval.`;
}
const summary = (p) => [p.brand, ...(p.details || [])].filter(Boolean).join(' · ').slice(0, 160);

// Photo files for one product, validated. Returns { ok: [{url,file,bytes,width,height,format,sha256}], rejected: [{file,reason}] }
function photoFiles(sku) {
  const dir = PHOTO_DIR(); const base = sku.toLowerCase(); const out = { ok: [], rejected: [] };
  if (!fs.existsSync(dir)) return out;
  const re = new RegExp(`^${base}(?:-(\\d{1,2}))?\\.(jpe?g|png|webp)$`, 'i');
  const files = fs.readdirSync(dir).filter((f) => re.test(f))
    .sort((a, b) => Number((a.match(re)[1]) || 1) - Number((b.match(re)[1]) || 1));
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    const info = buf.length <= MAX_BYTES ? imageInfo(buf) : null;
    let reason = '';
    if (buf.length > MAX_BYTES) reason = `larger than ${MAX_BYTES / 1024 / 1024} MB: please resize`;
    else if (!info) reason = /^\s*</.test(buf.slice(0, 64).toString()) ? 'this is a web page saved as an image, not a photo' : 'not a readable JPG/PNG/WebP image';
    else if (info.width < MIN_PX || info.height < MIN_PX) reason = `too small (${info.width}x${info.height}px; at least ${MIN_PX}x${MIN_PX}px)`;
    if (reason) { out.rejected.push({ file: f, reason }); continue; }
    out.ok.push({ url: `/images/products/${f}`, file: f, bytes: buf.length, width: info.width, height: info.height, format: info.type, sha256: crypto.createHash('sha256').update(buf).digest('hex') });
  }
  return out;
}

function importApproved({ log = () => {} } = {}) {
  db.open(); const { q } = db; const data = load();
  const report = { supplied: data.products.length, created: 0, updated: 0, keptYourEdits: [], photosLinked: 0, productsWithPhoto: 0, missingPhoto: [], rejectedPhotos: [], privateCostsApplied: 0, failed: [] };
  db.tx(() => {
    for (const c of data.categories) q.run('INSERT INTO categories(slug,name,sort_order) VALUES(?,?,?) ON CONFLICT(slug) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order', c.slug, c.name, c.sort_order);
  });
  for (const p of data.products) {
    try {
      const priceMinor = Math.round(p.price * 100); const refMinor = Number.isFinite(p.reference_price) ? Math.round(p.reference_price * 100) : null;
      if (!p.id || !p.name || !(priceMinor > 0)) throw new Error('missing id, name or price');
      const cat = q.get('SELECT id FROM categories WHERE slug=?', p.category); if (!cat) throw new Error(`unknown category ${p.category}`);
      const ref = `approved:${p.id}`;
      const ex = q.get("SELECT id, admin_edited_at FROM products WHERE source='approved' AND source_ref=?", ref)
        || q.get('SELECT p.id, p.admin_edited_at FROM variants v JOIN products p ON p.id=v.product_id WHERE v.sku=?', p.id);
      const photos = photoFiles(p.id); for (const r of photos.rejected) report.rejectedPhotos.push(`${p.id} ${r.file}: ${r.reason}`);
      db.tx(() => {
        let id;
        if (ex && ex.admin_edited_at) { id = ex.id; report.keptYourEdits.push(`${p.id} ${p.name}`); }
        else if (ex) {
          id = ex.id;
          q.run("UPDATE products SET name=?, summary=?, description=?, category_id=?, source='approved', source_ref=?, source_price_text=?, updated_at=datetime('now') WHERE id=?",
            p.name, summary(p), describe(p), cat.id, ref, srcText(p, data), id);
          q.run('UPDATE variants SET price_minor=?, updated_at=datetime(\'now\') WHERE sku=? AND product_id=?', priceMinor, p.id, id);
          report.updated++;
        } else {
          let slug = slugify(p.name); if (q.get('SELECT 1 x FROM products WHERE slug=?', slug)) slug = `${slug}-${p.id.toLowerCase()}`;
          id = Number(q.run("INSERT INTO products(slug,name,summary,description,category_id,currency,status,is_development,availability,source,source_ref,source_price_text) VALUES(?,?,?,?,?,?,'published',0,'available','approved',?,?)",
            slug, p.name, summary(p), describe(p), cat.id, data.currency, ref, srcText(p, data)).lastInsertRowid);
          q.run("INSERT INTO variants(product_id,sku,label,options_json,price_minor,availability,sort_order) VALUES(?,?,'Standard','{}',?,'available',0)", id, p.id, priceMinor);
          report.created++;
        }
        const vid = q.get('SELECT id FROM variants WHERE sku=?', p.id)?.id;
        if (vid && !(ex && ex.admin_edited_at)) {
          q.run(`INSERT INTO supplier_mappings(variant_id,supplier,cost_minor,cost_currency,shipping_note,sync_status) VALUES(?,'market',?,'NGN',?,'unmapped')
            ON CONFLICT(variant_id) DO UPDATE SET cost_minor=COALESCE(excluded.cost_minor, supplier_mappings.cost_minor), cost_currency=excluded.cost_currency, shipping_note=CASE WHEN excluded.cost_minor IS NULL THEN supplier_mappings.shipping_note ELSE excluded.shipping_note END`, vid, refMinor, refMinor == null ? '' : 'Reference price from the approved list (private)');
          if (refMinor != null) report.privateCostsApplied++;
        }
        // photos: owner uploads win; otherwise the validated files in public/images/products (or none)
        const own = q.get("SELECT 1 x FROM product_images WHERE product_id=? AND url NOT LIKE '/images/products/%' LIMIT 1", id);
        if (!own) {
          const rejected = q.get("SELECT verdict FROM photo_reviews WHERE product_id=?", id)?.verdict === 'wrong';
          q.run("DELETE FROM product_images WHERE product_id=? AND url LIKE '/images/products/%'", id);
          photos.ok.forEach((ph, i) => q.run("INSERT INTO product_images(product_id,url,alt,sort_order,status,checked_at,original_url) VALUES(?,?,?,?,?,datetime('now'),'')", id, ph.url, `${p.name}${i ? ` (photo ${i + 1})` : ''}`, i, rejected ? 'broken' : 'ok'));
          q.run("UPDATE products SET card_image_url=?, card_image_original='', card_image_status=? WHERE id=?", photos.ok[0]?.url || '', rejected ? 'broken' : 'ok', id);
        }
      });
      const n = q.get("SELECT COUNT(*) n FROM product_images WHERE product_id=(SELECT product_id FROM variants WHERE sku=?) AND status<>'broken'", p.id).n;
      report.photosLinked += photos.ok.length; if (n) report.productsWithPhoto++; else report.missingPhoto.push(`${p.id} ${p.name}`);
    } catch (err) { report.failed.push(`${p.id || '?'} ${p.name || ''}: ${err.message}`); }
  }
  report.activeApproved = q.get("SELECT COUNT(*) n FROM products WHERE source='approved' AND status='published'").n;
  log(report); return report;
}

const SOURCES = path.join(cfg.root, 'data', 'catalogue', 'photo-sources.json');
function writeManifest() {
  db.open(); const { q } = db; const data = load();
  const srcs = fs.existsSync(SOURCES) ? JSON.parse(fs.readFileSync(SOURCES, 'utf8')).photos || {} : {};
  const entries = data.products.map((p) => {
    const prod = q.get("SELECT p.id, p.slug, p.status, (SELECT verdict FROM photo_reviews r WHERE r.product_id=p.id) verdict, (SELECT note FROM photo_reviews r WHERE r.product_id=p.id) note, (SELECT source_url FROM photo_reviews r WHERE r.product_id=p.id) src, (SELECT permission FROM photo_reviews r WHERE r.product_id=p.id) perm, (SELECT reviewed_by||' '||reviewed_at FROM photo_reviews r WHERE r.product_id=p.id) by FROM variants v JOIN products p ON p.id=v.product_id WHERE v.sku=?", p.id);
    const files = photoFiles(p.id);
    const uploads = prod ? q.all("SELECT url FROM product_images WHERE product_id=? AND url NOT LIKE '/images/products/%'", prod.id).map((r) => r.url) : [];
    const has = files.ok.length + uploads.length > 0; const sr = files.ok.length ? srcs[p.id] : null;
    return {
      product_id: p.id, list_no: p.list_no, name: p.name, brand: p.brand || '', category: p.category, store_page: prod ? `/product/${prod.slug}` : null,
      image_paths: [...files.ok.map((f) => f.url), ...uploads], files: files.ok, rejected_files: files.rejected,
      source: prod?.src || sr?.source || (has ? 'not recorded' : ''), source_detail: sr ? { collage: sr.collage, label_in_collage: sr.label_in_collage, tile_box_xyxy: sr.tile_box_xyxy, product_box_xyxy: sr.product_box_xyxy, source_px: sr.source_px, enlarged: sr.enlarged } : null,
      extracted: sr ? sr.extracted : null, source_candidates: p.photo_candidates || [],
      match_status: !has ? 'missing photo' : prod?.verdict === 'matches' ? 'visually confirmed by owner' : prod?.verdict === 'wrong' ? 'REJECTED by owner (hidden)' : sr ? 'matched by the printed number and name in the collage; checked by Claude, not yet confirmed by owner' : 'not yet visually checked',
      needs_review: has && prod?.verdict !== 'matches' ? true : false, review_notes: sr?.review_notes || '',
      permission_status: !has ? 'n/a' : prod?.perm === 'confirmed' ? 'confirmed by owner' : 'unconfirmed',
      verification_notes: [prod?.note, prod?.by ? `checked by ${prod.by}` : '', !has ? 'Awaiting photo: add public/images/products/' + p.id.toLowerCase() + '.jpg (or upload in Admin) and re-run npm run catalogue:import.' : ''].filter(Boolean).join(' '),
    };
  });
  const summaryOut = {
    generated_at: new Date().toISOString(), products_supplied: data.products.length,
    products_in_store: entries.filter((e) => e.store_page).length,
    with_photo: entries.filter((e) => e.image_paths.length).length,
    visually_confirmed: entries.filter((e) => e.match_status === 'visually confirmed by owner').length,
    matched_by_collage_label: entries.filter((e) => /^matched by the printed/.test(e.match_status)).length,
    flagged_for_review: entries.filter((e) => e.review_notes).length,
    permission_confirmed: entries.filter((e) => e.permission_status === 'confirmed by owner').length,
    permission_unconfirmed: entries.filter((e) => e.permission_status === 'unconfirmed').length,
    missing_photo: entries.filter((e) => !e.image_paths.length).length,
  };
  fs.writeFileSync(MANIFEST, JSON.stringify({ summary: summaryOut, products: entries }, null, 1));
  return summaryOut;
}
module.exports = { importApproved, writeManifest, photoFiles, describe, load, MANIFEST };
