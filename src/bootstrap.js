'use strict';
// First-start helpers so a hosted copy can be set up without typing commands on the server.
// Runs when the server starts (not during tests). Each step is safe to repeat and never deletes data.
const fs = require('fs');
const cfg = require('./config');
const db = require('./db');
const { hashPassword } = require('./security');

// The owner's preliminary delivery fees (editable / confirmable in Admin > Delivery). Only added when no zones exist at all.
function ensureZones(addMissingByName = false) {
  db.open();
  if (!addMissingByName && db.q.get('SELECT 1 x FROM delivery_zones WHERE active=1 LIMIT 1')) return 0;
  let n = 0;
  for (const [name, fee] of [['Lagos', 250000], ['Other Nigerian locations', 450000]]) {
    if (!db.q.get('SELECT 1 x FROM delivery_zones WHERE name=?', name)) { db.q.run("INSERT INTO delivery_zones(name,country_code,fee_minor,estimate_text,confirmed,active) VALUES(?,'NG',?,'',0,1)", name, fee); n++; }
  }
  return n;
}
function bootstrap(log = console.log) {
  db.open(); // creates/updates the database tables (migrations)
  if (ensureZones()) log('[setup] Added the preliminary delivery zones (Lagos NGN 2,500; other Nigerian locations NGN 4,500). Confirm them in Admin > Delivery.');
  // First admin: only when NO admin exists yet and ADMIN_EMAIL + ADMIN_PASSWORD are set. Never overwrites an existing admin.
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(); const pw = String(process.env.ADMIN_PASSWORD || '');
  if (email && pw && !db.q.get('SELECT 1 x FROM admin_users LIMIT 1')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || pw.length < 12) log('[setup] ADMIN_EMAIL/ADMIN_PASSWORD ignored: need a valid email and a password of at least 12 characters.');
    else { db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?)', email, hashPassword(pw)); log(`[setup] First admin created: ${email}. You can now delete ADMIN_PASSWORD from the host's variables.`); }
  }
  fs.mkdirSync(cfg.uploadDir, { recursive: true });
}
// Called after the server is listening: if the catalogue is completely empty, import it from DummyJSON (needs internet).
async function autoImport(log = console.log) {
  let r = null;
  if (cfg.autoImportCatalogue && !db.q.get('SELECT 1 x FROM products LIMIT 1')) {
    try {
      r = await require('./importers/dummyjson').importDummyJson({});
      log(`[setup] Empty catalogue: imported ${r.created} products (${r.source === 'snapshot' ? 'from the bundled DummyJSON data, because the live API was unreachable' : 'from DummyJSON'}; failed ${r.failed.length}).`);
    } catch (err) { log(`[setup] Could not import the catalogue automatically: ${err.message} Use Admin > Settings > Import catalogue to try again.`); }
  }
  // Save permanent copies of product images that are still loaded from another website (once; later starts reuse them).
  if (cfg.autoDownloadImages) {
    const images = require('./images');
    try {
      const d = await images.downloadAll();
      if (d.remote) { const c = await images.checkAll(); log(`[setup] Product images: ${d.saved} saved, ${d.reused} already saved, ${d.failed} failed; check: ${c.ok} working, ${c.broken} broken.`); }
    } catch (err) { log(`[setup] Image download skipped: ${err.message}`); }
  }
  return r;
}
module.exports = { bootstrap, ensureZones, autoImport };
