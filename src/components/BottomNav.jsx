import { useNavigate, useLocation } from 'react-router-dom'
import { BrandLogo, BRAND_ASSETS_READY } from './BrandLogo'
import './BottomNav.css'

// Primary navigation: Discover / Matches / Messages / Profile.
// Settings stays under Profile (not a primary nav item).
// Icons are inline SVGs stroked with currentColor so they inherit
// the emerald active state — no emoji, no off-palette glyphs.
const ICONS = {
  discover: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polygon points="14.5 9.5 13 13 9.5 14.5 11 11" />
    </svg>
  ),
  matches: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20.5c-5.2-3.5-8.5-6.6-8.5-10.2C3.5 7.6 5.6 5.5 8.2 5.5c1.5 0 2.9.7 3.8 1.9.9-1.2 2.3-1.9 3.8-1.9 2.6 0 4.7 2.1 4.7 4.8 0 3.6-3.3 6.7-8.5 10.2z" />
    </svg>
  ),
  messages: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-8 8H5.5L3 21.5V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c1.2-3.5 4-5.5 7.5-5.5s6.3 2 7.5 5.5" />
    </svg>
  ),
}

const TABS = [
  { key: 'discover', path: '/discover', label: 'Discover' },
  { key: 'matches', path: '/matches', label: 'Matches' },
  { key: 'messages', path: '/messages', label: 'Messages' },
  { key: 'profile', path: '/profile', label: 'Profile' },
]

export default function BottomNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const activeKey = pathname.startsWith('/chat/') || pathname.startsWith('/match/') || pathname === '/force-connect' || pathname === '/celebration'
    ? 'matches'
    : TABS.find(t => pathname.startsWith(t.path))?.key || ''

  return (
    <>
      {/* Brand slot: desktop-only compact header mark (renders nothing until
          brand assets land — gated on BRAND_ASSETS_READY). */}
      {BRAND_ASSETS_READY && (
        <div className="brand-header" aria-hidden="true">
          <BrandLogo variant="mark" className="brand-logo--sm" />
        </div>
      )}
      <nav className="bottom-nav">
      {TABS.map(tab => (
        <button
          key={tab.key}
          className={`nav-btn ${activeKey === tab.key ? 'active' : ''}`}
          onClick={() => navigate(tab.path)}
          aria-current={activeKey === tab.key ? 'page' : undefined}
        >
          <span className="nav-icon">{ICONS[tab.key]}</span>
          <span className="nav-label">{tab.label}</span>
        </button>
      ))}
      </nav>
    </>
  )
}
