'use strict';
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
function checkout(f, zones) {
  const v = {
    name: clean(f.name, 100), email: clean(f.email, 254).toLowerCase(), phone: clean(f.phone, 25),
    address: clean(f.address, 200), city: clean(f.city, 80), state: clean(f.state, 80), postal: clean(f.postal, 20),
    notes: clean(f.notes, 300), zone_id: Number(f.zone_id),
  };
  const e = {};
  if (v.name.length < 2) e.name = 'Please enter your full name.';
  if (!EMAIL.test(v.email)) e.email = 'Please enter a valid email address.';
  const digits = v.phone.replace(/\D/g, '');
  if (!/^[+\d][\d\s()-]*$/.test(v.phone) || digits.length < 7 || digits.length > 15) e.phone = 'Please enter a valid phone number (7 to 15 digits).';
  if (v.address.length < 5) e.address = 'Please enter your delivery address.';
  if (v.city.length < 2) e.city = 'Please enter your city or town.';
  if (v.state.length < 2) e.state = 'Please enter your state or region.';
  if (!zones.some((z) => z.id === v.zone_id)) e.zone_id = 'Please choose a delivery destination.';
  return { v, e, ok: !Object.keys(e).length };
}
function contact(f) {
  const v = { name: clean(f.name, 100), email: clean(f.email, 254).toLowerCase(), subject: clean(f.subject, 120), message: clean(f.message, 2000) };
  const e = {};
  if (v.name.length < 2) e.name = 'Please enter your name.';
  if (!EMAIL.test(v.email)) e.email = 'Please enter a valid email address.';
  if (v.message.length < 10) e.message = 'Please write a message of at least 10 characters.';
  return { v, e, ok: !Object.keys(e).length };
}
module.exports = { checkout, contact, clean, EMAIL };
