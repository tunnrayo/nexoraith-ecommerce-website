'use strict';
// Loads the clearly-labelled DEVELOPMENT sample catalogue and one delivery zone. Safe to run repeatedly.
const path = require('path');
const fs = require('fs');
const cfg = require('../src/config');
const db = require('../src/db');
const { importCatalog } = require('./import-catalog');
if (cfg.isProd) { console.error('Refusing to load sample data in production. Import your real catalogue with: npm run import -- file.json'); process.exit(1); }
db.open();
const r = importCatalog(JSON.parse(fs.readFileSync(path.join(cfg.root, 'data', 'dev-catalog.json'), 'utf8')));
if (!db.q.get('SELECT 1 x FROM delivery_zones LIMIT 1')) {
  db.q.run("INSERT INTO delivery_zones(name,country_code,fee_minor,estimate_text,confirmed,active) VALUES('Nigeria (development placeholder)','NG',150000,'',0,1)");
}
console.log(`Sample catalogue: created ${r.created}, updated ${r.updated}, failed ${r.failed.length}.`);
for (const f of r.failed) console.log(' FAILED', f.item, f.errors);
