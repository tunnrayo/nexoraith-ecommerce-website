'use strict';
// All money is stored as INTEGER minor units (kobo for NGN). Never floats.
const cfg = require('./config');
const cache = new Map();
function fmtFor(cur) {
  if (!cache.has(cur)) cache.set(cur, new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cur }));
  return cache.get(cur);
}
exports.format = (minor, cur = cfg.currency) => fmtFor(cur).format(minor / 100);
// "1,500.50" -> 150050 ; returns null if not a valid amount
exports.parseToMinor = (s) => {
  const t = String(s ?? '').trim().replace(/,/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  const [a, b = ''] = t.split('.');
  return parseInt(a, 10) * 100 + parseInt((b + '00').slice(0, 2), 10);
};
exports.toMajorString = (minor) => (minor / 100).toFixed(2);
