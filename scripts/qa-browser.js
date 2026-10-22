'use strict';
// Optional real-browser check (desktop + phone). Not part of the app: it needs Playwright, which this project does NOT depend on.
//   1. npm install --no-save playwright   (once; then: npx playwright install chromium)
//   2. start the shop in another window: npm start
//   3. QA_ADMIN_EMAIL=you@example.com QA_ADMIN_PASSWORD='your password' node scripts/qa-browser.js
// Browses the shop, searches, opens a product, adds to cart, changes quantity, removes, opens the admin pages, and reports problems.
// Screenshots are written to ./qa-screenshots (ignored by Git).
const fs = require('fs'); const path = require('path');
let chromium; try { ({ chromium } = require('playwright')); } catch { try { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); } catch { console.error('Playwright is not installed. See the instructions at the top of this file.'); process.exit(2); } }
const BASE = process.env.QA_BASE || 'http://localhost:3000'; const OUT = path.join(__dirname, '..', 'qa-screenshots'); fs.mkdirSync(OUT, { recursive: true });
const problems = []; const log = (m) => console.log(m);
async function run(label, viewport, isMobile) {
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport, isMobile, hasTouch: isMobile, deviceScaleFactor: isMobile ? 2 : 1 }); const page = await ctx.newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', (e) => errs.push(String(e))); page.on('requestfailed', (r) => errs.push('request failed ' + r.url()));
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${label}-${n}.png`), fullPage: false });
  const check = async (name) => {
    const bad = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => i.src));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    if (bad.length) problems.push(`${label} ${name}: broken images ${bad.slice(0, 3).join(', ')}`);
    if (overflow) problems.push(`${label} ${name}: page scrolls sideways`);
  };
  await page.goto(BASE + '/'); await check('home'); await shot('1-home');
  await page.goto(BASE + '/shop'); await check('shop'); await shot('2-shop');
  const cat = await page.locator('a[href*="/shop?category="]').first().getAttribute('href'); if (cat) { await page.goto(BASE + cat); await check('category'); await shot('3-category'); }
  await page.goto(BASE + '/shop?q=kettle'); await check('search'); await shot('4-search');
  const href = await page.locator('a[href^="/product/"]').first().getAttribute('href'); await page.goto(BASE + href); await check('product'); await shot('5-product');
  await page.locator('form[action="/cart/add"] button[type=submit]').first().click(); await page.waitForURL('**/cart'); await check('cart'); await shot('6-cart');
  const q = page.locator('form[action="/cart/update"] input[name=quantity]').first(); if (await q.count()) { await q.fill('2'); await q.press('Enter'); await page.waitForLoadState(); await shot('7-cart-qty2'); }
  await page.goto(BASE + '/checkout'); await check('checkout'); await shot('8-checkout');
  await page.goto(BASE + '/cart'); const rm = page.locator('form[action="/cart/remove"] button').first(); if (await rm.count()) { await rm.click(); await page.waitForLoadState(); await shot('9-cart-empty'); }
  if (process.env.QA_ADMIN_EMAIL && process.env.QA_ADMIN_PASSWORD) {
    await page.goto(BASE + '/admin/login'); await page.fill('#email', process.env.QA_ADMIN_EMAIL); await page.fill('#password', process.env.QA_ADMIN_PASSWORD); await page.click('form[action="/admin/login"] button[type=submit]'); await page.waitForURL('**/admin');
    for (const [n, p] of [['dashboard', '/admin'], ['orders', '/admin/orders'], ['products', '/admin/products'], ['health', '/admin/health'], ['audit', '/admin/audit'], ['account', '/admin/account']]) { await page.goto(BASE + p); await check('admin ' + n); await shot(`admin-${n}`); }
  }
  if (errs.length) problems.push(`${label}: browser errors: ${[...new Set(errs)].slice(0, 4).join(' | ')}`);
  await browser.close(); log(`${label}: finished`);
}
(async () => {
  await run('desktop', { width: 1366, height: 850 }, false); await run('mobile', { width: 390, height: 844 }, true);
  if (problems.length) { console.log('PROBLEMS:\n- ' + problems.join('\n- ')); process.exit(1); } console.log('No broken images, sideways scrolling or browser errors found. Screenshots: qa-screenshots/');
})();
