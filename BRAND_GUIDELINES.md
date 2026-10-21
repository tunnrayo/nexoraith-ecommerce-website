# Brand guidelines as implemented
Source: `Nexoraith_Brand_Identity_Style_Guide.png` (kept at `brand-assets/brand-style-guide-reference.png`, deliberately NOT in `public/` because its mock-ups contain an unconfirmed address and phone). Owner instruction: **deep navy and champagne gold are primary; teal is for website buttons, interactive states and supporting graphics so it does not compete with the gold emblem.**
| Role | Value | Use |
|---|---|---|
| Deep navy | #0B1F2A (deep #07131D for header/footer, matches the logo background) | header, hero, footer, headings, step numbers |
| Champagne gold | #D4AF7C | accents, borders, emblem; **on dark backgrounds only for text** |
| Teal (brand) | #0EA5A1 | focus rings, cart badge, graphics |
| Teal (button) | #0B7F7C (hover #086865) | buttons, links (darker than brand teal so white text passes WCAG AA ~4.8:1) |
| Ivory / beige / sand | #FBF8F3 / #F3ECE1 / #E9DFCF | page, page-heading and panel backgrounds |
| Ink / muted / line | #1F2937 / #5F6B76 / #E5E1DA | text, secondary text, borders |
| Gold (dark, text on light) | #8A6A3A | small uppercase labels (kickers, category names) on light backgrounds |
Fonts: Plus Jakarta Sans (headings) and Inter (body), **self-hosted** in `public/fonts` (latin, variable weight, SIL Open Font Licence files included).
Logo: `public/img/logo-dark.png` and `icon-crop.png`/`favicon.png` are **crops of the supplied style-guide image** (not redrawn or altered). They are low resolution (~600px wide). Supply the original logo files (SVG/PNG, light and dark versions) and replace them for a crisp result. The logo sits on the deep-navy header/footer with softly faded edges (CSS mask; the file itself is unchanged); no light-background version exists yet.
Demo product images (`public/img/products/demo-*.svg`, made by `scripts/make-placeholders.js`) are simple navy/gold illustrations, each labelled DEMO IMAGE. They are not product photos and must be replaced.
Tone: friendly, clear, honest (style guide Do/Don't). No aggressive sales language, no false promises, no fake urgency.
Not used: invented slogans, "50% off"/"free delivery" banners shown in the style-guide mock-ups, the Abuja address/phone from mock-ups.
