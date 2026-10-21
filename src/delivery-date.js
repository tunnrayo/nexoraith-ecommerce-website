'use strict';
// Estimated delivery = the calendar date of confirmation in the BUSINESS timezone + N calendar days.
// Calendar arithmetic is done on a pure date (UTC midnight) so month/year ends and leap years are exact,
// and daylight-saving changes (if the timezone has any) cannot shift the result.
const cfg = require('./config');

// "2026-10-21T23:30:00Z" (Date or string) -> "2026-10-22" for Africa/Lagos
function localDate(instant, tz = cfg.timezone) {
  const d = instant instanceof Date ? instant : new Date(String(instant).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(instant)) ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) throw new Error('invalid date');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
const estimate = (confirmedAt, days = cfg.deliveryDays, tz = cfg.timezone) => addDays(localDate(confirmedAt, tz), days);
// "2026-10-31" -> "Saturday, 31 October 2026"
const formatDate = (ymd) => (ymd ? new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(ymd + 'T00:00:00Z')) : '');
// SQLite "YYYY-MM-DD HH:MM:SS" (UTC) -> "21 Oct 2026, 13:05" in business time
function formatDateTime(ts, tz = cfg.timezone) {
  if (!ts) return '';
  const d = new Date(String(ts).replace(' ', 'T') + (/[zZ]$/.test(String(ts)) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? String(ts) : new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && addDays(s, 0) === s;
module.exports = { localDate, addDays, estimate, formatDate, formatDateTime, isYmd };
