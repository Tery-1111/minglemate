# Brand assets — drop zone + activation spec

This directory is the production home for brand identity assets. It is
**intentionally empty of image files**: no vector sources exist (the only
reference material is a mockup collage that cannot yield production marks).
Everything else is already wired — the moment the three files below land,
flip one flag and the entire brand layer goes live. No other code changes.

## Required files (exact names)

| File | Used by | Spec |
|---|---|---|
| `minglemate_mark.svg` | `BrandLogo variant="mark"` — nav header slot, auth header, questionnaire headers, settings/profile watermarks; favicon + manifest after PNG exports | Vector, square viewBox, transparent background, clean at 24px |
| `minglemate_mark_192.png` / `minglemate_mark_512.png` | manifest maskable icons + apple-touch-icon source | 192×192 / 512×512 PNG |
| `minglemate_logo_lockup.webp` | `BrandLogo variant="lockup"` — auth header branding, (og/twitter after an OG card exists) | Horizontal wordmark + mark, transparent background, legible at 32px height, ≤ 100 KB |
| `minglemate_logo_3d.webp` | `BrandLogo variant="3d"` — /celebration hero | Transparent background, ≤ 150 KB, 2× high-DPI (128px render → ~256px+ export) |

## Wired touchpoints (all gated on BRAND_ASSETS_READY)

- `src/components/BottomNav.jsx` — desktop-only compact header slot (`.brand-header`, ≥768px, matches the floating-dock breakpoint)
- `src/pages/Login.jsx` — auth form branding header (`brand-logo--auth`)
- `src/pages/Section1.jsx` / `Section2.jsx` — questionnaire header marks
- `src/pages/MatchCelebration.jsx` — hero graphic above the heart (`brand-logo--hero`, replaces the legacy heart's position; heart kept)
- `src/pages/Settings.jsx` / `Profile.jsx` — footer watermarks (`brand-logo--watermark`)

## Activation procedure (when assets land)

1. Drop the files into this directory with the exact names above.
2. In `src/components/BrandLogo.jsx` set `BRAND_ASSETS_READY = true`.
3. In `index.html` apply the favicon / apple-touch-icon / og:image swap lines
   already written as comments at each tag.
4. In `public/manifest.json` apply the `_brand_swap` icons array.
5. `npm run build`, visual check at 375px + 1440px (CLS, header collisions,
   48px targets untouched), commit.

Until step 2, every touchpoint renders **nothing** — no broken images, no
layout shift — because BrandLogo returns null while gated.

## Metadata state (audited)

The current favicon (`public/favicon.svg`, purple bolt) and OG image
(`public/og-image.png`, unbranded gradient) predate the Emerald Ink UI
system and do not match it. They stay live until the swap points above fire;
real brand assets from *any* palette restore consistency rather than break
it. The in-app mark meanwhile remains the typographic `.brand-roundel`
(Home, Matches empty states).

## Explicitly out of scope until a product decision

Adopting the "Nexus Verus" exploration (pink/purple 3D identity) reverses
the ratified Emerald Ink + Champagne system. The component is asset-agnostic;
the identity swap is a separate, deliberate act requiring the vector sources
above.
