'use strict';
// Adds/refreshes YOUR approved catalogue (data/catalogue/approved-products.json) in your existing database and
// links the photos in public/images/products/. Safe to run again: no duplicates, your Admin edits are kept,
// orders are never touched. Also writes the photo record data/catalogue/image-manifest.json.
//   npm run catalogue:import
const { importApproved, writeManifest } = require('../src/approved-catalogue');
try {
  const r = importApproved();
  console.log(`Approved list: ${r.supplied} products. Added ${r.created}, refreshed ${r.updated}, kept as you edited them ${r.keptYourEdits.length}, failed ${r.failed.length}.`);
  console.log(`Active approved products in the store: ${r.activeApproved}. With a photo: ${r.productsWithPhoto}. Without a photo (placeholder shown): ${r.missingPhoto.length}.`);
  for (const f of r.failed) console.log(' FAILED', f);
  for (const f of r.rejectedPhotos) console.log(' PHOTO REJECTED', f);
  console.log(r.privateCostsApplied ? `Private market prices applied to ${r.privateCostsApplied} products (from data/catalogue/private/reference-prices.json).` : 'No private market-price file found (data/catalogue/private/reference-prices.json): public prices were imported; private costs already saved were left unchanged.');
  const m = writeManifest();
  console.log(`Photo record written to data/catalogue/image-manifest.json: ${m.with_photo} with photo, ${m.visually_confirmed} visually confirmed, ${m.permission_confirmed} with permission confirmed, ${m.missing_photo} missing.`);
  process.exitCode = r.failed.length ? 2 : 0;
} catch (err) { console.error('Nothing was imported:', err.message); process.exit(1); }
