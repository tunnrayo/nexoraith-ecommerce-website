# Product Catalogue Guide
**Demo data** in `data/dev-catalog.json` is for presentation/testing only (12 products, SKUs start `DEV-`, flagged `is_development`, images labelled DEMO IMAGE). It is shown only when `DEMO_MODE` is on and is never sellable as real stock.

## Demo products from DummyJSON
`npm run import:dummyjson` (or Admin > Settings > Import demo products) loads up to 200 sample products. Options: `--limit=200`, `--rate=1500` (NGN per 1.00 of DummyJSON's sample price; an arbitrary demonstration conversion, **not** a market price), `--update` (overwrite products already imported, including your edits), `--download-images` (save copies on your server instead of linking to cdn.dummyjson.com), `--draft` (import hidden). They are demo products: review, replace or archive them before launch (Admin > Settings > Archive demo products).

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
