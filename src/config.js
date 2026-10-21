'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
// Tiny .env loader (no dependencies). Real environment variables win over .env.
try {
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file: fine */ }
const e = process.env;
const bool = (v, d) => (v == null || v === '' ? d : /^(1|true|yes)$/i.test(v));
const isProd = e.NODE_ENV === 'production';
const port = Number(e.PORT) || 3000;
// DEMO MODE: presentation/testing. Shows sample products, allows unconfirmed delivery fees and offers a clearly
// labelled "demonstration order" (no money taken). On by default on your computer; OFF by default in production.
const demoMode = bool(e.DEMO_MODE, !isProd);
module.exports = {
  root, isProd, port,
  siteUrl: (e.SITE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  dbPath: path.isAbsolute(e.DATABASE_PATH || '') ? e.DATABASE_PATH : path.join(root, e.DATABASE_PATH || 'data/nexoraith.db'),
  currency: e.STORE_CURRENCY || 'NGN',
  locale: e.STORE_LOCALE || 'en-NG',
  demoMode,
  allowDevProducts: bool(e.ALLOW_DEVELOPMENT_PRODUCTS, demoMode),
  allowUnconfirmedDelivery: bool(e.ALLOW_UNCONFIRMED_DELIVERY, demoMode),
  // Uploaded product images. Keep inside the same persistent disk as the database when hosting.
  uploadDir: path.isAbsolute(e.UPLOAD_DIR || '') ? e.UPLOAD_DIR : path.join(root, e.UPLOAD_DIR || 'data/uploads'),
  company: {
    name: 'Nexoraith Absolute Ventures Ltd', short: 'Nexoraith', rc: '9921594',
    email: 'NEXORAITHABSOLUTEVENTURES@GMAIL.COM', tagline: 'Shop Smarter. Live Better.',
    address: e.COMPANY_ADDRESS || '', phone: e.COMPANY_PHONE || '',
  },
  paystack: { secret: e.PAYSTACK_SECRET_KEY || '', base: 'https://api.paystack.co' },
  cj: { apiKey: e.CJ_API_KEY || '', base: 'https://developers.cjdropshipping.com/api2.0/v1', allowOrderSubmission: bool(e.CJ_ALLOW_ORDER_SUBMISSION, false) },
};
