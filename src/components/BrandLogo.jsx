import React from 'react';
import './BrandLogo.css';

/**
 * BrandLogo — Centralized brand asset component.
 *
 * Single source of truth for brand imagery so pages never hand-roll <img>
 * tags. Plain-CSS size classes replace the Tailwind-style h-6/h-8 utilities
 * (this repo does not use Tailwind).
 *
 * @param {'icon' | 'horizontal' | 'hero3d'} variant - Asset variant to render
 * @param {'sm' | 'md' | 'lg' | 'xl'} size - Pre-defined height constraint
 * @param {string} className - Optional custom CSS classes
 * @param {string} alt - Accessibility label
 *
 * NOTE (asset availability): the production brand assets under
 * /assets/brand/ (logo-mark.svg, logo-horizontal.svg, logo-3d-hero.webp)
 * do not exist yet — vector sources are pending from the brand design.
 * Until they land, `variant="icon"` falls back to the shipped favicon.svg
 * so nothing renders broken. horizontal/hero3d are not consumed anywhere
 * yet; introduce them only together with real assets.
 */
const BRAND_ASSETS_READY = false;

const assetMap = {
  icon: '/assets/brand/logo-mark.svg',
  horizontal: '/assets/brand/logo-horizontal.svg',
  hero3d: '/assets/brand/logo-3d-hero.webp',
};

const fallbackMap = {
  icon: '/favicon.svg',
};

export default function BrandLogo({
  variant = 'icon',
  size = 'md',
  className = '',
  alt = 'MingleMate',
}) {
  const sizeClass = `brand-logo--${size}`;
  const resolved =
    BRAND_ASSETS_READY || fallbackMap[variant]
      ? (fallbackMap[variant] || assetMap[variant])
      : assetMap[variant];

  return (
    <img
      src={resolved}
      alt={alt}
      className={`brand-logo ${sizeClass} ${className}`.trim()}
      loading={variant === 'hero3d' ? 'lazy' : 'eager'}
      decoding="async"
      draggable={false}
    />
  );
}
