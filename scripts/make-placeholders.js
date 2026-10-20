'use strict';
// Generates clearly-labelled SAMPLE placeholder images (not real product photos) using brand colours.
const fs = require('fs'); const path = require('path');
const out = path.join(__dirname, '..', 'public', 'img', 'products'); fs.mkdirSync(out, { recursive: true });
const shapes = {
  'sample-ceramic-mug': '<rect x="190" y="230" width="180" height="170" rx="22" fill="#D4AF7C"/><path d="M370 270h30a38 38 0 0 1 0 76h-30" fill="none" stroke="#D4AF7C" stroke-width="22"/>',
  'sample-linen-cushion': '<rect x="150" y="190" width="300" height="240" rx="40" fill="#D4AF7C"/><path d="M170 220q130 40 260 0" stroke="#0B1F2A" stroke-width="6" fill="none" opacity=".35"/>',
  'sample-leather-wallet': '<rect x="160" y="220" width="280" height="190" rx="24" fill="#D4AF7C"/><rect x="330" y="285" width="110" height="60" rx="12" fill="#0B1F2A" opacity=".35"/>',
  'sample-canvas-tote': '<path d="M175 250h250l20 170H155z" fill="#D4AF7C"/><path d="M230 250v-40a70 70 0 0 1 140 0v40" fill="none" stroke="#D4AF7C" stroke-width="18"/>',
  'sample-phone-stand': '<path d="M200 420l60-210h60l-30 210z" fill="#D4AF7C"/><rect x="170" y="410" width="260" height="26" rx="10" fill="#D4AF7C"/>',
  'sample-cable-organiser': '<circle cx="300" cy="300" r="120" fill="none" stroke="#D4AF7C" stroke-width="36"/><circle cx="300" cy="300" r="52" fill="#D4AF7C" opacity=".5"/>',
};
for (const [name, shape] of Object.entries(shapes)) {
  fs.writeFileSync(path.join(out, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" role="img"><rect width="600" height="600" fill="#0B1F2A"/>${shape}<rect x="0" y="540" width="600" height="60" fill="#0EA5A1" opacity=".9"/><text x="300" y="578" text-anchor="middle" font-family="Arial,sans-serif" font-size="22" font-weight="700" fill="#fff">SAMPLE IMAGE - NOT A REAL PRODUCT</text></svg>`);
}
console.log('Placeholders written to', out);
