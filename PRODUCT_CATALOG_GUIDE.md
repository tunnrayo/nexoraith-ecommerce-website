# Product Catalogue Guide
**The catalogue starts empty** (owner decision, 2026-10-22). There are no built-in samples and no imported products, and nothing adds products automatically (not the server start, not `npm run seed`). Until you publish a product, customers see "Our collection is being prepared. Please check back soon."

If your database still has products from an older version (DummyJSON imports or the built-in samples), remove them once with `npm run catalogue:remove-demo` or Admin > Settings > **Remove old demo catalogue** (README step 6).

## Photos
Upload photos on each product's admin page (JPG, PNG or WebP). They are stored by the store itself and served with long caching. A product without a photo shows a neutral "Image not available" picture. Prefer your own photos of the items you actually source. `npm run images:check` lists products that still need a photo.

## Easiest way: Admin
Admin > Products > **+ Add product** (name, short description, description, category, first option and price), then upload photos on the product page and add more options. Leave status `draft` until checked, then `published`.

## Add real products
1. Easiest: leave `images` out of the file and upload the photos in Admin after importing. (A file import can only point at images already stored on the site, paths starting `/uploads/` or `/img/`.)
2. Create a file, e.g. `my-products.json`:
```json
{
  "categories": [{ "slug": "my-category", "name": "My Category", "sort_order": 1 }],
  "products": [{
    "slug": "example-product", "name": "Example Product", "category": "my-category",
    "status": "draft", "summary": "One line for product cards (max 160).", "description": "Plain-text description.",
    "variants": [{
      "sku": "EX-001-BLK", "label": "Black", "options": { "Colour": "Black" },
      "price": "15000.00", "availability": "unverified", "stock": null,
      "supplier": { "product_id": "CJ-PID", "variant_id": "CJ-VID", "cost": "6.50", "cost_currency": "USD" }
    }]
  }]
}
```
3. Import: `npm run import -- my-products.json`. It prints created/updated counts and **every failed record with reasons**. Re-running updates by `slug`/`sku`.
4. In Admin > Products set availability to `available` (only after you have verified it with the supplier), then status `published`.
Rules: price like `15000` or `15000.50` (in the store currency); availability `available|unavailable|unverified` (only `available` can be bought); status `draft|published|archived`; `stock` is a whole number or omit it/`null` when not reliably known. Supplier fields are private. Never put supplier prices in `description`.
A product you tick **Test product only** is hidden from customers (unless `ALLOW_DEVELOPMENT_PRODUCTS=true`), so you can try things without showing them.

## Options customers choose
Each option (variant) is one exact item: give it a clear name (e.g. "Black, size 42") and fill Colour / Size / Model where relevant. Customers see these values and they are saved on the order, so you buy exactly that.
## Availability
Product: Available to order / Temporarily unavailable (visible, cannot be ordered) / Discontinued (hidden). Option: Available / Unavailable / Not yet checked. Stock quantity is optional; leave it blank unless you really track stock.
