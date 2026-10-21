'use strict';
// Sets up a store on your computer:
//   npm run seed            -> delivery zones + import the catalogue from DummyJSON (needs internet)
//   npm run seed -- --samples -> also load the 12 built-in sample illustrations (offline testing only; hidden once the catalogue is imported)
// Safe to run repeatedly. Never deletes products, orders or payments; products you edited in Admin are never overwritten.
const path = require('path');
const fs = require('fs');
const cfg = require('../src/config');
const db = require('../src/db');
const { ensureZones } = require('../src/bootstrap');
db.open();
const z = ensureZones();
console.log(z ? `Delivery zones added: ${z} (preliminary; confirm them in Admin > Delivery).` : 'Delivery zones already set up.');
(async () => {
  if (process.argv.includes('--samples')) {
    if (cfg.isProd) { console.error('Refusing to load built-in samples in production.'); process.exit(1); }
    const { importCatalog } = require('./import-catalog');
    const r = importCatalog(JSON.parse(fs.readFileSync(path.join(cfg.root, 'data', 'dev-catalog.json'), 'utf8')));
    console.log(`Built-in samples: created ${r.created}, updated ${r.updated}, failed ${r.failed.length}.`);
  }
  try {
    const r = await require('../src/importers/dummyjson').importDummyJson({});
    console.log(`Catalogue from DummyJSON${r.source === 'snapshot' ? ' (bundled copy; the live API was not reachable)' : ''}: fetched ${r.fetched}; created ${r.created}, skipped (already there) ${r.skipped}, kept your edits ${r.keptEdits}, failed ${r.failed.length}. Built-in samples hidden: ${r.samplesArchived}.`);
    for (const f of r.failed) console.log(' FAILED', f.item, f.errors.join('; '));
  } catch (err) { console.error(err.message, 'Run "npm run seed" again when you are online.'); process.exitCode = 1; }
})();
