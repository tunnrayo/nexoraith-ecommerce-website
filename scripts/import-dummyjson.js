'use strict';
// Usage: npm run import:dummyjson -- [--limit=200] [--rate=1500] [--update] [--download-images] [--draft]
// Imports the store catalogue from https://dummyjson.com (needs internet). Safe to re-run: existing products are skipped
// (--update refreshes products you have NOT edited; products edited in Admin are never overwritten). See PRODUCT_CATALOG_GUIDE.md.
const { importDummyJson } = require('../src/importers/dummyjson');
require('../src/db').open();
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}`));
const val = (n, d) => (arg(n)?.includes('=') ? arg(n).split('=')[1] : d);
importDummyJson({ limit: val('limit', 200), rate: val('rate', undefined), update: !!arg('update'), downloadImages: !!arg('download-images'), publish: !arg('draft') })
  .then((r) => {
    console.log(`Fetched ${r.fetched}. Created ${r.created}, updated ${r.updated}, skipped (already imported) ${r.skipped}, kept your edits ${r.keptEdits}, failed ${r.failed.length}. Built-in samples hidden: ${r.samplesArchived}.`);
    if (r.imagesWithoutUrl) console.log(`Products without a usable image: ${r.imagesWithoutUrl} (a placeholder is shown).`);
    if (r.imageErrors) console.log(`Images that could not be downloaded: ${r.imageErrors} (the original URL was kept).`);
    for (const f of r.failed) console.log(` FAILED ${f.item}: ${f.errors.join('; ')}`);
    console.log('Reminder: prices are converted from DummyJSON at the configured rate; they are not verified Nigerian market prices. Check availability per order.');
  })
  .catch((e) => { console.error(e.message); process.exit(1); });
