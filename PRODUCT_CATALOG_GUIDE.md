# Product Catalogue Guide
**Sample data** in `data/dev-catalog.json` is for testing only (SKUs start `DEV-`, flagged `is_development`). It is hidden and unbuyable in production.

## Add real products
1. Put product images (jpg/png/webp/svg) in `public/img/products/`. Images must be local paths starting `/img/` (the security policy blocks external image hosts).
2. Create a file, e.g. `my-products.json`:
```json
{
  "categories": [{ "slug": "my-category", "name": "My Category", "sort_order": 1 }],
  "products": [{
    "slug": "example-product", "name": "Example Product", "category": "my-category",
    "status": "draft", "description": "Plain-text description.",
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
Remove sample products: set them to `archived` in Admin, or delete `data/nexoraith.db` before launching and re-import (do not run `seed` in production; it refuses).
