'use strict';
// Usage: npm run import:dummyjson -- [--limit=200] [--rate=1500] [--update] [--download-images] [--draft]
// Imports DEMONSTRATION products from https://dummyjson.com (needs internet). Safe to re-run: existing products are
// skipped unless --update is given (so your Admin edits are kept). See PRODUCT_CATALOG_GUIDE.md.
const { importDummyJson } = require('../src/importers/dummyjson');
require('../src/db').open();
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}`));
const val = (n, d) => (arg(n)?.includes('=') ? arg(n).split('=')[1] : d);
importDummyJson({ limit: val('limit', 200), rate: val('rate', 1500), update: !!arg('update'), downloadImages: !!arg('download-images'), publish: !arg('draft') })
  .then((r) => {
    console.log(`Fetched ${r.fetched}. Created ${r.created}, updated ${r.updated}, skipped (already imported) ${r.skipped}, failed ${r.failed.length}.`);
    if (r.imagesWithoutUrl) console.log(`Products without a usable image: ${r.imagesWithoutUrl} (a placeholder is shown).`);
    if (r.imageErrors) console.log(`Images that could not be downloaded: ${r.imageErrors} (the original URL was kept).`);
    for (const f of r.failed) console.log(` FAILED ${f.item}: ${f.errors.join('; ')}`);
    console.log('Reminder: these are DEMONSTRATION products. Prices are samples, not Nigerian market prices.');
  })
  .catch((e) => { console.error(e.message); process.exit(1); });
