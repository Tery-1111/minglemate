import React from 'react';
import './BrandLogo.css';

/**
 * BrandLogo — Centralized brand asset component.
 *
 * @param {'mark' | '3d' | 'lockup'} variant - Brand asset variant to render
 * @param {string} className - Custom styling (size classes below; the brief's
 *   Tailwind-style h-6/h-8 utilities are mapped to plain-CSS classes in
 *   BrandLogo.css because this repo does not use Tailwind)
 * @param {string} alt - Accessible image description
 *
 * ACTIVATION GATE — the three production assets under /assets/brand/
 * (minglemate_mark.svg, minglemate_logo_3d.webp, minglemate_logo_lockup.webp)
 * do not exist yet; vector sources are pending from brand design. While
 * BRAND_ASSETS_READY is false, every wired touchpoint renders nothing at all
 * (no <img>, no broken-image icon, zero layout impact). Flip the flag to
 * true once the files land and every touchpoint goes live simultaneously —
 * no further code changes required. See public/assets/brand/README.md.
 */
export const BRAND_ASSETS_READY = true;

const assets = {
  mark: '/assets/brand/minglemate_mark.svg',
  '3d': '/assets/brand/minglemate_logo_3d.webp',
  lockup: '/assets/brand/minglemate_logo_lockup.webp',
};

export function BrandLogo({
  variant = 'lockup',
  className = '',
  alt = 'MingleMate Logo',
}) {
  if (!BRAND_ASSETS_READY) return null;

  const src = assets[variant] || assets.lockup;
  const sizeClass = className
    ? className
    : variant === '3d'
      ? 'brand-logo--hero'
      : variant === 'mark'
        ? 'brand-logo--sm'
        : 'brand-logo--md';

  return (
    <img
      src={src}
      alt={alt}
      className={`brand-logo ${sizeClass}`.trim()}
      loading={variant === '3d' ? 'lazy' : 'eager'}
      decoding="async"
      draggable={false}
    />
  );
}

export default BrandLogo;
