'use strict';
// Usage:  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-password' npm run create-admin
// (run again with an existing email to reset that admin's password)
const db = require('../src/db');
const { hashPassword } = require('../src/security');
const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const pw = String(process.env.ADMIN_PASSWORD || '');
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('Set ADMIN_EMAIL to a valid email address.'); process.exit(1); }
if (pw.length < 12) { console.error('ADMIN_PASSWORD must be at least 12 characters.'); process.exit(1); }
db.open();
db.q.run('INSERT INTO admin_users(email,password_hash) VALUES(?,?) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash', email, hashPassword(pw));
db.q.run('DELETE FROM admin_sessions WHERE user_id=(SELECT id FROM admin_users WHERE email=?)', email);
console.log(`Admin user ready: ${email}`);
