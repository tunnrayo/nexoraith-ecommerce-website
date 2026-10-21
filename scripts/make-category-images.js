'use strict';
// Generates category-specific "photo coming soon" placeholder images (SVG, ~1 KB each) in public/img/categories/.
// Used ONLY when a product has no working image. They are clearly placeholders, not photos of any product.
// Usage: node scripts/make-category-images.js
const fs = require('fs'); const path = require('path');
const out = path.join(__dirname, '..', 'public', 'img', 'categories'); fs.mkdirSync(out, { recursive: true });
const I = {
  bottle: '<path d="M85 40h30v25l15 20v75a10 10 0 0 1-10 10H80a10 10 0 0 1-10-10V85l15-20z"/><path d="M70 115h60"/>',
  perfume: '<rect x="60" y="80" width="80" height="90" rx="14"/><rect x="85" y="52" width="30" height="28" rx="4"/><path d="M100 52V38h22"/>',
  jar: '<rect x="55" y="88" width="90" height="77" rx="12"/><rect x="62" y="62" width="76" height="26" rx="6"/>',
  sofa: '<path d="M42 100V77a15 15 0 0 1 15-15h86a15 15 0 0 1 15 15v23"/><rect x="30" y="100" width="140" height="45" rx="10"/><path d="M46 145v18M154 145v18"/>',
  lamp: '<path d="M70 42h60l20 58H50z"/><path d="M100 100v60M72 163h56"/>',
  basket: '<path d="M35 88h130l-15 77H50z"/><path d="M70 88l20-45M130 88l-20-45M75 112v35M100 112v35M125 112v35"/>',
  pot: '<rect x="45" y="85" width="110" height="70" rx="12"/><path d="M30 97h15M155 97h15M70 85V70h60v15"/>',
  laptop: '<rect x="50" y="50" width="100" height="70" rx="6"/><path d="M30 140h140l-10 15H40z"/>',
  tablet: '<rect x="60" y="35" width="80" height="130" rx="12"/><circle cx="100" cy="150" r="4"/>',
  phone: '<rect x="70" y="30" width="60" height="140" rx="12"/><path d="M92 45h16"/>',
  headphones: '<path d="M50 120v-20a50 50 0 0 1 100 0v20"/><rect x="40" y="115" width="25" height="45" rx="8"/><rect x="135" y="115" width="25" height="45" rx="8"/>',
  shirt: '<path d="M72 40l-37 25 15 26 16-8v77h68V83l16 8 15-26-37-25c-5 12-16 18-28 18s-23-6-28-18z"/>',
  dress: '<path d="M82 35h36l-5 35 37 95H50l37-95z"/>',
  shoe: '<path d="M30 140v-30l30-10 30 20 60 10a20 20 0 0 1 20 20v10z"/><path d="M30 150h140"/>',
  watch: '<rect x="82" y="30" width="36" height="140" rx="8"/><circle cx="100" cy="100" r="35"/><path d="M100 80v20l12 10"/>',
  motorbike: '<circle cx="55" cy="135" r="25"/><circle cx="150" cy="135" r="25"/><path d="M55 135l35-45h30l30 45M90 90l-10-20H65M120 90l15-20h15"/>',
  car: '<path d="M35 132v-25l25-35h80l25 35v25z"/><circle cx="65" cy="135" r="15"/><circle cx="135" cy="135" r="15"/><path d="M60 102h80"/>',
  ball: '<circle cx="100" cy="100" r="60"/><path d="M40 100h120M100 40c-25 30-25 90 0 120M100 40c25 30 25 90 0 120"/>',
  glasses: '<path d="M30 90h55v15a20 20 0 0 1-20 20H50a20 20 0 0 1-20-20zM115 90h55v15a20 20 0 0 1-20 20h-15a20 20 0 0 1-20-20zM85 96h30"/>',
  bag: '<path d="M45 78h110l10 87H35z"/><path d="M75 78V63a25 25 0 0 1 50 0v15"/>',
  ring: '<circle cx="100" cy="122" r="43"/><path d="M84 78l16-32 16 32z"/>',
  box: '<path d="M40 70l60-30 60 30v70l-60 30-60-30z"/><path d="M40 70l60 30 60-30M100 100v70"/>',
};
const CATS = {
  beauty: ['Beauty', 'bottle'], fragrances: ['Fragrances', 'perfume'], 'skin-care': ['Skin Care', 'jar'], furniture: ['Furniture', 'sofa'],
  'home-decoration': ['Home Decoration', 'lamp'], groceries: ['Groceries', 'basket'], 'kitchen-accessories': ['Kitchen Accessories', 'pot'],
  laptops: ['Laptops', 'laptop'], tablets: ['Tablets', 'tablet'], smartphones: ['Smartphones', 'phone'], 'mobile-accessories': ['Mobile Accessories', 'headphones'],
  'mens-shirts': ["Men's Shirts", 'shirt'], tops: ['Tops', 'shirt'], 'womens-dresses': ["Women's Dresses", 'dress'], 'mens-shoes': ["Men's Shoes", 'shoe'],
  'womens-shoes': ["Women's Shoes", 'shoe'], 'mens-watches': ["Men's Watches", 'watch'], 'womens-watches': ["Women's Watches", 'watch'],
  motorcycle: ['Motorcycle', 'motorbike'], vehicle: ['Vehicle', 'car'], 'sports-accessories': ['Sports Accessories', 'ball'], sunglasses: ['Sunglasses', 'glasses'],
  'womens-bags': ["Women's Bags", 'bag'], 'womens-jewellery': ["Women's Jewellery", 'ring'], 'home-living': ['Home & Living', 'lamp'],
  accessories: ['Accessories', 'bag'], 'tech-accessories': ['Tech Accessories', 'headphones'], default: ['Nexoraith', 'box'],
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
for (const [slug, [name, icon]] of Object.entries(CATS)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img" aria-label="${esc(name)}: photo coming soon"><defs><radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F1E9DC"/></radialGradient></defs><rect width="800" height="800" fill="url(#g)"/><rect x="24" y="24" width="752" height="752" rx="28" fill="none" stroke="#E5DCCB" stroke-width="2"/><g transform="translate(250 150) scale(1.5)" fill="none" stroke="#B8935A" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${I[icon]}</g><text x="400" y="560" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="40" font-weight="700" fill="#0B1F2A">${esc(name)}</text><text x="400" y="612" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="26" fill="#5F6B76">Photo coming soon</text></svg>`;
  fs.writeFileSync(path.join(out, `${slug}.svg`), svg);
}
console.log(`Wrote ${Object.keys(CATS).length} category placeholders to ${out}`);
