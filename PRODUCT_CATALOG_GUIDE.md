# Product Catalogue Guide
**Built-in samples** in `data/dev-catalog.json` (12 illustrations, SKUs `DEV-`) are for offline testing only (`npm run seed -- --samples`); they are hidden automatically once the DummyJSON catalogue is imported.

## Your catalogue comes from DummyJSON
`npm run seed`, `npm run import:dummyjson`, Admin > Settings > **Import catalogue**, or the automatic first-start import load up to 200 products into your database as normal catalogue products. Price = DummyJSON price (USD) x NGN 1,500 exactly (change with `--rate=` / the admin field / `IMPORT_NGN_PER_USD`). The source price is shown to you on each product's admin page. These are not verified Nigerian market prices: edit any price, name, description or photo in Admin; edited products are never overwritten by re-imports. `--update` (or "Refresh imported products I have not edited") refreshes only products you have not edited. Re-imports never change availability or visibility, and never touch orders or payments. Products that DummyJSON renames are matched by their DummyJSON id, so no duplicates are created.
Ratings, reviews, stock numbers and shipping/warranty/return text from DummyJSON are never imported or shown.

## Images
Cards use the small thumbnail; product pages use the full photos. `npm run images:download` saves permanent copies (add `--to-repo` to keep them in Git), `npm run images:check` verifies every image and lists products that need one. Products without a working image show a category placeholder until you upload a photo in Admin.

## Easiest way: Admin
Admin > Products > **+ Add product** (name, short description, description, category, first option and price), then upload photos on the product page and add more options. Leave status `draft` until checked, then `published`.

## Add real products
1. Put product images (jpg/png/webp/svg) in `public/img/products/` (or upload them in Admin). Images must be local paths starting `/img/` or `/uploads/` (the security policy blocks external image hosts).
2. Create a file, e.g. `my-products.json`:
```json
{
  "categories": [{ "slug": "my-category", "name": "My Category", "sort_order": 1 }],
  "products": [{
    "slug": "example-product", "name": "Example Product", "category": "my-category",
    "status": "draft", "summary": "One line for product cards (max 160).", "description": "Plain-text description.",
    "images": [{ "url": "/img/products/example.jpg", "alt": "Describe the picture" }],
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
Remove demo products: set them to `archived` in Admin, or simply set `DEMO_MODE=false`, which hides and blocks them. Do not run `seed` on the live store.

## Options customers choose
Each option (variant) is one exact item: give it a clear name (e.g. "Black, size 42") and fill Colour / Size / Model where relevant. Customers see these values and they are saved on the order, so you buy exactly that.
## Availability
Product: Available to order / Temporarily unavailable (visible, cannot be ordered) / Discontinued (hidden). Option: Available / Unavailable / Not yet checked. Stock quantity is optional; leave it blank unless you really track stock.
