# Brand guidelines as implemented
Source: `Nexoraith_Brand_Identity_Style_Guide.png` (kept at `public/img/brand-style-guide-reference.png`). Owner instruction: **deep navy and champagne gold are primary; teal is for website buttons, interactive states and supporting graphics so it does not compete with the gold emblem.**
| Role | Value | Use |
|---|---|---|
| Deep navy | #0B1F2A | header, hero, footer, headings |
| Champagne gold | #D4AF7C | accents, borders, emblem; **on dark backgrounds only for text** |
| Teal (brand) | #0EA5A1 | focus rings, cart badge, graphics |
| Teal (button) | #0B7F7C (hover #086865) | buttons, links (darker than brand teal so white text passes WCAG AA ~4.8:1) |
| Ivory / beige | #FAF7F2 / #F1EBE1 | page and panel backgrounds |
| Ink / muted / line | #1F2937 / #687280 / #E5E7EB | text, secondary text, borders |
Fonts: Plus Jakarta Sans (headings), Inter (body) are named first in CSS; **not bundled**, so system fonts show until you add self-hosted font files (download from Google Fonts, put in `public/fonts`, add `@font-face`, no CSP change needed for same-origin).
Logo: `public/img/logo-dark.png` and `icon-crop.png`/`favicon.png` are **crops of the supplied style-guide image** (not redrawn or altered). They are low resolution (~600px wide). Supply the original logo files (SVG/PNG, light and dark versions) and replace them for a crisp result. The logo sits on the navy header; no light-background version was extracted.
Not used: invented slogans, "50% off"/"free delivery" banners shown in the style-guide mock-ups, the Abuja address/phone from mock-ups.
