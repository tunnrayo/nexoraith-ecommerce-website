'use strict';
// Minimal multipart/form-data parser (no dependencies) for the admin image upload form.
// Returns { fields: {name: value}, files: [{ field, filename, type, data(Buffer) }] }.
function parse(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw Object.assign(new Error('missing boundary'), { status: 400 });
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const out = { fields: {}, files: [] };
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buf.slice(start, start + 2).toString() === '--') break; // closing boundary
    const headEnd = buf.indexOf('\r\n\r\n', start);
    if (headEnd === -1) break;
    const head = buf.slice(start + 2, headEnd).toString('utf8');
    const next = buf.indexOf(boundary, headEnd + 4);
    if (next === -1) break;
    const data = buf.slice(headEnd + 4, next - 2); // strip trailing CRLF
    const name = /name="([^"]*)"/i.exec(head)?.[1];
    const filename = /filename="([^"]*)"/i.exec(head)?.[1];
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() || '';
    if (name != null) {
      if (filename != null) { if (data.length) out.files.push({ field: name, filename, type, data }); }
      else out.fields[name] = data.toString('utf8');
    }
    pos = next;
  }
  return out;
}
// Identify an image from its first bytes (do not trust the filename or browser-sent type).
function imageType(data) {
  if (data.length > 8 && data[0] === 0x89 && data.slice(1, 4).toString() === 'PNG') return 'png';
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.length > 12 && data.slice(0, 4).toString() === 'RIFF' && data.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
module.exports = { parse, imageType };
