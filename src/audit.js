'use strict';
// Administrator activity log. Records WHO did WHAT and WHEN. It never stores passwords, tokens, customer details or form contents.
const { q } = require('./db');
function record(actor, action, target = '', ip = '') {
  try { q.run('INSERT INTO admin_audit(actor,action,target,ip) VALUES(?,?,?,?)', String(actor).slice(0, 120), String(action).slice(0, 80), String(target).slice(0, 160), String(ip).slice(0, 64)); }
  catch (e) { console.error('[audit] could not write:', e.message); } // logging must never break the action itself
}
const recent = (n = 100) => q.all('SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?', n);
module.exports = { record, recent };
