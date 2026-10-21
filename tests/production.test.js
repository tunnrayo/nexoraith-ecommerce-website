'use strict';
// Production safety: sample products must be hidden/blocked and unconfirmed delivery refused.
const test = require('node:test'); const assert = require('node:assert/strict');
const { setup, client } = require('./helpers');
test('in production mode sample products are hidden and unconfirmed delivery is refused', async () => {
  const ctx = await setup({ NODE_ENV: 'production', ALLOW_DEVELOPMENT_PRODUCTS: 'false', ALLOW_UNCONFIRMED_DELIVERY: 'false' });
  try {
    const c = client(ctx.base);
    const shop = await c.get('/shop'); assert.match(shop.text, /0 products found/);
    assert.equal((await c.get('/product/demo-ceramic-mug')).status, 404);
    assert.ok(!(await c.get('/sitemap.xml')).text.includes('demo-'));
    const cart = require('../src/cart'); const tok = cart.ensureCart(null);
    assert.throws(() => cart.add(tok, ctx.db.q.get("SELECT id FROM variants WHERE sku='DEV-MUG-WHT'").id, 1), /sample product/i);
  } finally { ctx.server.close(); }
});
