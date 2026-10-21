'use strict';
// Store settings the owner can change in Admin > Settings. Values saved in the database override .env defaults.
const cfg = require('./config');
const { q } = require('./db');
const get = (k) => q.get('SELECT value FROM settings WHERE key=?', k)?.value;
const set = (k, v) => q.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
const paymentTiming = () => (['review_first', 'pay_first'].includes(get('payment_timing')) ? get('payment_timing') : cfg.paymentTiming);
const deliveryDays = () => { const n = parseInt(get('delivery_days'), 10); return n >= 1 && n <= 90 ? n : cfg.deliveryDays; };
const ownerEmail = () => get('owner_email') ?? cfg.ownerEmail;
module.exports = { get, set, paymentTiming, deliveryDays, ownerEmail };
