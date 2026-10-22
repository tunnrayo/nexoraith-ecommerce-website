'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
// Tiny env-file loader (no dependencies). Real environment variables always win. ".env.local" (your private local settings) is read
// before ".env". Both files are ignored by Git. Values are never printed anywhere.
for (const name of ['.env.local', '.env']) {
  try {
    for (const line of fs.readFileSync(path.join(root, name), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
    }
  } catch { /* file not present: fine */ }
}
const e = process.env;
const bool = (v, d) => (v == null || v === '' ? d : /^(1|true|yes)$/i.test(v));
const isProd = e.NODE_ENV === 'production';
const port = Number(e.PORT) || 3000;
// DEMO MODE (testing on your computer): allows checkout with delivery fees not yet marked confirmed.
// On by default on your computer; OFF by default in production. It never adds products.
const demoMode = bool(e.DEMO_MODE, !isProd);
module.exports = {
  root, isProd, port,
  // Secret that protects admin sessions (login tokens are stored as a keyed hash). Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  sessionSecret: e.SESSION_SECRET || '',
  // Behind a hosting proxy (Railway) the visitor's real address is the LAST entry of X-Forwarded-For. Default: on in production.
  trustProxy: bool(e.TRUST_PROXY, isProd),
  siteUrl: (e.SITE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
  dbPath: e.DATABASE_PATH === ':memory:' || path.isAbsolute(e.DATABASE_PATH || '') ? e.DATABASE_PATH : path.join(root, e.DATABASE_PATH || 'data/nexoraith.db'),
  currency: e.STORE_CURRENCY || 'NGN',
  locale: e.STORE_LOCALE || 'en-NG',
  demoMode,
  // Show the "Demonstration checkout (no payment)" option to customers. OFF unless you set DEMO_CHECKOUT=true (for testing only).
  demoCheckout: bool(e.DEMO_CHECKOUT, false),
  // Products you tick as "Test product only" stay hidden from customers unless this is true (for your own testing).
  allowDevProducts: bool(e.ALLOW_DEVELOPMENT_PRODUCTS, false),
  allowUnconfirmedDelivery: bool(e.ALLOW_UNCONFIRMED_DELIVERY, demoMode),
  // Uploaded product images. Keep inside the same persistent disk as the database when hosting.
  uploadDir: path.isAbsolute(e.UPLOAD_DIR || '') ? e.UPLOAD_DIR : path.join(root, e.UPLOAD_DIR || 'data/uploads'),
  company: {
    name: 'Nexoraith Absolute Ventures Ltd', short: 'Nexoraith', rc: '9921594',
    email: 'NEXORAITHABSOLUTEVENTURES@GMAIL.COM', tagline: 'Shop Smarter. Live Better.',
    address: e.COMPANY_ADDRESS || '', phone: e.COMPANY_PHONE || '',
  },
  // Self-sourcing workflow settings (see README "How orders work")
  // review_first: you check the market before the customer pays (payment link sent after review). pay_first: customer pays at checkout.
  paymentTiming: ['review_first', 'pay_first'].includes(e.PAYMENT_TIMING) ? e.PAYMENT_TIMING : 'review_first',
  deliveryDays: Math.min(Math.max(parseInt(e.DELIVERY_ESTIMATE_DAYS, 10) || 10, 1), 90),
  timezone: e.BUSINESS_TIMEZONE || 'Africa/Lagos',
  // Optional: other websites allowed for product image links (space separated, https only). Empty by default:
  // product photos are uploaded in Admin and stored by the store itself.
  imageHosts: (e.IMAGE_HOSTS || '').split(/\s+/).filter((h) => /^https:\/\/[a-z0-9.-]+$/i.test(h)),
  ownerEmail: e.OWNER_NOTIFY_EMAIL || '',
  email: { apiKey: e.RESEND_API_KEY || '', from: e.EMAIL_FROM || '', base: e.RESEND_API_URL || 'https://api.resend.com' },
  // Old dropshipping tools (CJdropshipping) are hidden unless SUPPLIER_INTEGRATION=cj
  supplierIntegration: e.SUPPLIER_INTEGRATION === 'cj',
  paystack: { secret: e.PAYSTACK_SECRET_KEY || '', base: 'https://api.paystack.co' },
  cj: { apiKey: e.CJ_API_KEY || '', base: 'https://developers.cjdropshipping.com/api2.0/v1', allowOrderSubmission: bool(e.CJ_ALLOW_ORDER_SUBMISSION, false) },
};
