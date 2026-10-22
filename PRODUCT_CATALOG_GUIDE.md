# Product Catalogue Guide
## Your approved catalogue (2026-10-22)
`data/catalogue/approved-products.json` holds your list exactly as supplied: 100 products in 7 categories (Home and Kitchen 20, Fashion and Accessories 15, Beauty and Personal Care 15, Everyday Gadgets and Electronics 15, Baby and Kids 10, Sports and Outdoor 10, Office Accessories 15). Each has a stable code NX-001 ... NX-100 (= your list number), used as its SKU. Customers see the **Nexoraith price**; your **private market (reference) prices** are NOT in this file or in Git. They live in `data/catalogue/private/reference-prices.json` (`{"prices": {"NX-001": 6150, ...}}`), which stays only on your own computer and is ignored by Git; the import stores them as "your market cost" (Admin only). Without that file the import still works and leaves any cost already saved unchanged. Keep the repository free of margins: never add cost columns or pricing rules to committed files.
What the store shows per product: name, price, category, and only the facts in your list (brand, capacity, size, pack count, e.g. "Brand: Syinix, Capacity: 2.2 litres"), plus: "Before you pay, we confirm the exact item with you ... nothing is changed without your approval." No specifications, colours, warranties or stock figures were invented. Every product is listed as "Available to order" with one "Standard" option; with review-first payment you confirm availability before the customer pays.
To change a product: edit it in Admin (your edits are then kept even if you re-run the import). To change the list itself: edit the JSON file and run `npm run catalogue:import`.

**Before 2026-10-22 the catalogue was empty** (owner decision). There are no built-in samples and no imported products, and nothing adds products automatically (not the server start, not `npm run seed`). Until you publish a product, customers see "Our collection is being prepared. Please check back soon."

If your database still has products from an older version (DummyJSON imports or the built-in samples), remove them once with `npm run catalogue:remove-demo` or Admin > Settings > **Remove old demo catalogue** (README step 6).

## Photos
Approved-catalogue photos: put them in `public/images/products/` named `nx-001.jpg` (extra: `nx-001-2.jpg` ...) and run `npm run catalogue:import` (README 2b). Or upload photos on each product's admin page (JPG, PNG or WebP). They are stored by the store itself and served with long caching. A product without a photo shows a neutral "Image not available" picture. Prefer your own photos of the items you actually source. `npm run images:check` lists products that still need a photo.

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
