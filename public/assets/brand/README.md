# Brand assets — drop zone + spec

This directory is the production home for brand identity assets. It is
**intentionally empty of image files** right now: the only source material
available (a 1400px mockup collage with baked-in shadows) cannot yield
production-quality marks, so vector sources must come from the brand design
first. `BrandLogo` (src/components/BrandLogo.jsx) already points here and
falls back gracefully until the files exist.

## Required files

| File | Used by | Spec |
|---|---|---|
| `logo-mark.svg` | `BrandLogo variant="icon"` (tight UI: mobile headers, avatar fallbacks) | Vector, square viewBox, transparent background, ~24–64px render target, strokes/fills self-contained |
| `logo-mark.png` | `apple-touch-icon` (180x180) + manifest fallback | 180×180 PNG, no transparency (iOS composites on black), flatten on brand surface color |
| `logo-horizontal.svg` | `BrandLogo variant="horizontal"` (primary headers/footers) | Vector, lockup = mark + wordmark, safe clear space, legible at 32px height |
| `logo-3d-hero.webp` | `BrandLogo variant="hero3d"` (celebration screen, landing hero) | WebP, ≤ 150 KB, 2× high-DPI (render ~640px+, export ~1280px), transparent or known-composited background |

## Consumption swap-points (already wired)

- `index.html` — `<link rel="icon">` comment marks the favicon swap point.
- `index.html` — `apple-touch-icon` is deliberately absent until `logo-mark.png` exists.
- `index.html` — `og:image` keeps the existing unbranded gradient placeholder until a 1200×630 raster is exported from the new vectors (OG must be raster; SVG is ignored by crawlers).
- `public/manifest.json` — icons point at `/favicon.svg`; swap to `logo-mark.png` (+ 192/512 PNGs) when available.
- `src/components/BrandLogo.jsx` — flip `BRAND_ASSETS_READY` to `true` once the files above exist; the icon variant then serves `logo-mark.svg`.

## Current state of the asset layer (audited)

The existing brand surfaces predate the Emerald Ink UI system and do not
match it: `public/favicon.svg` is a purple gradient bolt (fill `#863bff`)
and `public/og-image.png` is an unbranded purple gradient with no mark or
wordmark. The in-app brand mark is the typographic `.brand-roundel` (Home,
Matches). Any real brand assets — from any palette — therefore *restore*
consistency rather than break it. Until then the swap points above keep
serving these files so nothing 404s.

## Explicitly out of scope until a product decision

The "Nexus Verus" exploration (pink/purple 3D gradient identity) reverses the
ratified Emerald Ink + Champagne design system (PR #11). These files must not
ship without an explicit rebrand decision and palette integration plan — the
component and metadata are asset-agnostic, but the visual identity swap is a
separate, deliberate act.
