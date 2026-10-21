'use strict';
// Email notifications via Resend (https://resend.com/docs/api-reference/emails/send-email).
// Without RESEND_API_KEY + EMAIL_FROM nothing is sent: each message is recorded as "skipped" so the owner can see it in Admin.
// Never throws into the order flow: a failed email never blocks or undoes an order change.
const cfg = require('./config');
const { q } = require('./db');
const { esc } = require('./security');
const isConfigured = () => !!(cfg.email.apiKey && cfg.email.from);

function record(orderId, to, subject, status, detail = '') {
  q.run('INSERT INTO notifications(order_id,recipient,subject,status,detail) VALUES(?,?,?,?,?)', orderId ?? null, to, subject, status, String(detail).slice(0, 300));
}
// lines: array of plain-text paragraphs. link: optional {href,text}
async function send({ orderId, to, subject, lines, link, idempotencyKey }) {
  if (!to) return { status: 'skipped' };
  if (!isConfigured()) { record(orderId, to, subject, 'skipped', 'Email service not configured (RESEND_API_KEY / EMAIL_FROM).'); return { status: 'skipped' }; }
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1F2937"><h2 style="color:#0B1F2A">${esc(subject)}</h2>${lines.map((l) => `<p>${esc(l).replace(/\n/g, '<br>')}</p>`).join('')}${link ? `<p><a href="${esc(link.href)}" style="background:#0B7F7C;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">${esc(link.text)}</a></p>` : ''}<p style="color:#5F6B76;font-size:13px">${esc(cfg.company.name)} &middot; RC ${esc(cfg.company.rc)} &middot; ${esc(cfg.company.email)}</p></div>`;
  const text = lines.join('\n\n') + (link ? `\n\n${link.text}: ${link.href}` : '');
  try {
    const res = await fetch(cfg.email.base + '/emails', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${cfg.email.apiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey.slice(0, 256) } : {}) },
      body: JSON.stringify({ from: cfg.email.from, to: [to], subject, html, text, reply_to: cfg.company.email }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { record(orderId, to, subject, 'failed', `HTTP ${res.status} ${j.message || ''}`); return { status: 'failed' }; }
    record(orderId, to, subject, 'sent', j.id ? `id ${j.id}` : ''); return { status: 'sent' };
  } catch (err) { record(orderId, to, subject, 'failed', err.message); return { status: 'failed' }; }
}
module.exports = { send, isConfigured };
