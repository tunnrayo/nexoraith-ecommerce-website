'use strict';
// Usage:
//   npm run images:check                 -> checks that every active product image really opens; records the result
//   npm run images:download              -> saves permanent copies into UPLOAD_DIR/catalog (data/uploads/catalog by default)
//   npm run images:download -- --to-repo -> saves them into public/img/catalog instead, so you can commit them to Git
// Needs internet access to the image host (cdn.dummyjson.com for the imported catalogue).
const images = require('../src/images');
require('../src/db').open();
(async () => {
  if (process.argv[2] === 'download') {
    const r = await images.downloadAll({ target: process.argv.includes('--to-repo') ? 'repo' : 'uploads' });
    console.log(`Remote images: ${r.remote}. Saved ${r.saved}, already saved ${r.reused}, failed ${r.failed}.`);
    for (const e of r.errors) console.log(' FAILED', e);
  }
  const c = await images.checkAll(); const s = images.stats();
  console.log(`Checked ${c.checked} image(s): ${c.ok} working, ${c.broken} broken.`);
  console.log(`Active products: ${s.active}. With a verified working image: ${s.verified}. Showing a category placeholder: ${s.needImage.length}. Still loading from another website: ${s.remoteOnly}.`);
  for (const p of s.needImage.slice(0, 50)) console.log(` needs image: #${p.id} ${p.name}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
