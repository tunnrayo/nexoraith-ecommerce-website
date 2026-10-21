'use strict';
// First-start helpers so a hosted copy can be set up without typing commands on the server.
// Runs when the server starts (not during tests). Each step is safe to repeat.
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const db = require('./db');
const { hashPassword } = require('./security');

function bootstrap(log = console.log) {
  db.open(); // creates/updates the database tables (migrations)
  // 1) Demo catalogue: only when DEMO_MODE is on AND the catalogue is completely empty.
  if (cfg.demoMode && !db.q.get('SELECT 1 x FROM products LIMIT 1')) {
    const { importCatalog } = require('../scripts/import-catalog');
    const r = importCatalog(JSON.parse(fs.readFileSync(path.join(cfg.root, 'data', 'dev-catalog.json'), 'utf8')));
    for (const [name, fee] of [['Lagos', 250000], ['Other Nigerian locations', 450000]]) {
      if (!db.q.get('SELECT 1 x FROM delivery_zones WHERE name=?', name)) db.q.run("INSERT INTO delivery_zones(name,country_code,fee_minor,estimate_text,confirmed,active) VALUES(?,'NG',?,'',0,1)", name, fee);
    }
    log(`[setup] Empty store in DEMO_MODE: loaded demo catalogue (${r.created} products) and preliminary delivery zones.`);
  }
  // 2) First admin: only when NO admin exists yet and ADMIN_EMAIL + ADMIN_PASSWORD are set. Never overwrites an existing admin.
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase(); const pw = String(process.env.ADMIN_PASSWORD || '');
  if (email && pw && !db.q.get('SELECT 1 x FROM admin_users LIMIT 1')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || pw.length < 12) log('[setup] ADMIN_EMAIL/ADMIN_PASSWORD ignored: need a valid email and a password of at least 12 characters.');
    else { db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?)', email, hashPassword(pw)); log(`[setup] First admin created: ${email}. You can now delete ADMIN_PASSWORD from the host's variables.`); }
  }
  fs.mkdirSync(cfg.uploadDir, { recursive: true });
}
module.exports = { bootstrap };
