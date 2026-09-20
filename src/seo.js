import { useEffect } from 'react'

// Single source of truth for the production origin. Every SEO
// surface (canonical, OG, sitemap, JSON-LD) derives from here.
// All confirmed references to the production host in this repo
// (CORS allow-lists, OneSignal) use this same domain.
export const SITE_URL = 'https://minglemate.vercel.app'
export const SITE_NAME = 'MingleMate'

function upsertMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertLink(rel, href) {
  let el = document.head.querySelector(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

/**
 * Per-route SEO metadata. Values are plain strings (no JSX) so this
 * stays framework-simple and SSR-agnostic.
 *
 * onlyPublic: private/user routes use { robots: 'noindex, nofollow' }
 * and must never declare OG image/description that could leak content.
 */
export const ROUTE_SEO = {
  '/': {
    title: 'MingleMate — Compatibility-Based Dating for Students',
    description:
      'MingleMate matches university students by real relationship compatibility. Answer 50 guided questions, get two curated matches a week, and chat safely on campus.',
    keywords: 'compatibility dating, relationship compatibility, campus dating, relationship matching',
    ogType: 'website',
    index: true,
  },
  '/matches-info': {
    title: 'How MingleMate Matching Works — Compatibility, Not Endless Swiping',
    description:
      'See how MingleMate builds your compatibility profile from 50 questions across communication, conflict, emotional style, expectations and values — then delivers two weekly matches.',
    keywords: 'dating compatibility test, relationship compatibility quiz, compatibility matching',
    ogType: 'website',
    index: true,
  },
  '/faq': {
    title: 'MingleMate FAQ — Safety, Privacy & How Matching Works',
    description:
      'Answers to common questions about MingleMate: who can join, how matches are chosen, what it costs, and how your data and contact details stay private.',
    keywords: 'dating app safety, dating app privacy, campus dating',
    ogType: 'website',
    index: true,
  },
  '/terms': {
    title: 'MingleMate Terms of Service — User Agreement',
    description:
      'The MingleMate user agreement: eligibility, account rules, matching disclaimers, prohibited conduct, content licensing, privacy, liability, and Kenyan governing law.',
    keywords: 'terms of service, user agreement, dating app terms',
    ogType: 'website',
    index: true,
  },
  // ---- Everything below is private / user-specific: noindex, minimal metadata ----
  '/signup': { title: 'Create your MingleMate account', robots: 'noindex, nofollow', index: false },
  '/login': { title: 'Log in — MingleMate', robots: 'noindex, nofollow', index: false },
  '/profile-setup': { title: 'Profile setup — MingleMate', robots: 'noindex, nofollow', index: false },
  '/photo-upload': { title: 'Photo upload — MingleMate', robots: 'noindex, nofollow', index: false },
  '/interests': { title: 'Your interests — MingleMate', robots: 'noindex, nofollow', index: false },
  '/home': { title: 'Matches — MingleMate', robots: 'noindex, nofollow', index: false },
  '/discover': { title: 'Discover — MingleMate', robots: 'noindex, nofollow', index: false },
  '/messages': { title: 'Messages — MingleMate', robots: 'noindex, nofollow', index: false },
  '/celebration': { title: "It's a Match — MingleMate", robots: 'noindex, nofollow', index: false },
  '/match': { title: 'Open match — MingleMate', robots: 'noindex, nofollow', index: false },
  '/force-connect': { title: 'Force Connect — MingleMate', robots: 'noindex, nofollow', index: false },
  '/section1': { title: 'Compatibility questionnaire — MingleMate', robots: 'noindex, nofollow', index: false },
  '/section2': { title: 'Deeper questions — MingleMate', robots: 'noindex, nofollow', index: false },
  '/payment': { title: 'Unlock Section 2 — MingleMate', robots: 'noindex, nofollow', index: false },
  '/profile': { title: 'Your profile — MingleMate', robots: 'noindex, nofollow', index: false },
  '/matches': { title: 'Your matches — MingleMate', robots: 'noindex, nofollow', index: false },
  '/photos': { title: 'Your photos — MingleMate', robots: 'noindex, nofollow', index: false },
  '/settings': { title: 'Settings — MingleMate', robots: 'noindex, nofollow', index: false },
  '/blocked': { title: 'Blocked accounts — MingleMate', robots: 'noindex, nofollow', index: false },
  '/chat': { title: 'Chat — MingleMate', robots: 'noindex, nofollow', index: false },
  '/admin': { title: 'Admin — MingleMate', robots: 'noindex, nofollow', index: false },
}

const HEAD_TAGS = ['meta', 'link']

export function applySeo(pathname) {
  // Longest-prefix match so /chat/:matchId picks up the /chat entry
  const known = Object.keys(ROUTE_SEO)
  let seo = ROUTE_SEO[pathname]
  if (!seo) {
    const base = known
      .filter((p) => p !== '/' && pathname.startsWith(p + '/'))
      .sort((a, b) => b.length - a.length)[0]
    seo = base ? ROUTE_SEO[base] : ROUTE_SEO['/']
  }

  const url = `${SITE_URL}${pathname === '/' ? '/' : pathname}`

  // Title
  document.title = seo.title

  // Core meta
  upsertMeta('name', 'description', seo.description || 'MingleMate — compatibility-based dating for campus students.')
  if (seo.robots) upsertMeta('name', 'robots', seo.robots)
  else upsertMeta('name', 'robots', 'index, follow')
  if (seo.keywords) upsertMeta('name', 'keywords', seo.keywords)

  // Canonical
  upsertLink('canonical', url)

  // Open Graph
  upsertMeta('property', 'og:site_name', SITE_NAME)
  upsertMeta('property', 'og:title', seo.title)
  if (seo.description) upsertMeta('property', 'og:description', seo.description)
  else {
    const el = document.head.querySelector('meta[property="og:description"]')
    el?.remove()
  }
  upsertMeta('property', 'og:url', url)
  upsertMeta('property', 'og:type', seo.ogType || 'website')
  if (seo.index) {
    upsertMeta('property', 'og:image', `${SITE_URL}/og-image.png`)
    upsertMeta('property', 'og:image:width', '1200')
    upsertMeta('property', 'og:image:height', '630')
    upsertMeta('property', 'og:image:alt', 'MingleMate — compatibility-based dating')
  } else {
    // SPA navigation: clear social images a previous public page set
    // so a private page never shares with user-context imagery.
    ;['og:image', 'og:image:width', 'og:image:height', 'og:image:alt'].forEach((k) =>
      document.head.querySelector(`meta[property="${k}"]`)?.remove()
    )
  }

  // Twitter/X
  upsertMeta('name', 'twitter:card', seo.index ? 'summary_large_image' : 'summary')
  upsertMeta('name', 'twitter:title', seo.title)
  if (seo.description) upsertMeta('name', 'twitter:description', seo.description)
  else document.head.querySelector('meta[name="twitter:description"]')?.remove()
  if (seo.index) upsertMeta('name', 'twitter:image', `${SITE_URL}/og-image.png`)
  else document.head.querySelector('meta[name="twitter:image"]')?.remove()

  // Route visibility signal for bundled-page crawlers and future SSR
  document.documentElement.dataset.seoIndexable = seo.index ? 'true' : 'false'
}

/** Site-wide JSON-LD: WebSite + Organization. Public pages only. */
export function applySiteJsonLd(isIndexable) {
  const id = 'jsonld-site'
  document.getElementById(id)?.remove()
  if (!isIndexable) return

  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: SITE_NAME,
        description: 'Compatibility-based dating app for university students.',
        inLanguage: 'en-KE',
      },
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#org`,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        logo: `${SITE_URL}/favicon.svg`,
      },
    ],
  }

  const script = document.createElement('script')
  script.type = 'application/ld+json'
  script.id = id
  script.textContent = JSON.stringify(data)
  document.head.appendChild(script)
}

/** Route-specific JSON-LD (WebApplication on public marketing routes). */
export function applyWebAppJsonLd(isIndexable) {
  const id = 'jsonld-webapp'
  document.getElementById(id)?.remove()
  if (!isIndexable) return

  const data = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_NAME,
    url: `${SITE_URL}/`,
    applicationCategory: 'DatingApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'KES',
      description: 'Free to join; optional one-time unlock for deeper features.',
    },
    publisher: { '@id': `${SITE_URL}/#org` },
  }

  const script = document.createElement('script')
  script.type = 'application/ld+json'
  script.id = id
  script.textContent = JSON.stringify(data)
  document.head.appendChild(script)
}

/** Convenience hook for pages. */
export function useSeo(pathname) {
  useEffect(() => {
    applySeo(pathname)
    const indexable = ROUTE_SEO[pathname]?.index === true
    applySiteJsonLd(indexable)
    applyWebAppJsonLd(indexable)
  }, [pathname])
}

export { HEAD_TAGS }
