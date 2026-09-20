import { useNavigate, useLocation } from 'react-router-dom'
import './BottomNav.css'

// Primary navigation: Discover / Matches / Messages / Profile.
// Settings stays under Profile (not a primary nav item).
const TABS = [
  { key: 'discover', path: '/discover', icon: '🧭', label: 'Discover' },
  { key: 'matches', path: '/matches', icon: '💝', label: 'Matches' },
  { key: 'messages', path: '/messages', icon: '💬', label: 'Messages' },
  { key: 'profile', path: '/profile', icon: '👤', label: 'Profile' },
]

export default function BottomNav() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const activeKey = pathname.startsWith('/chat/') || pathname.startsWith('/match/') || pathname === '/force-connect' || pathname === '/celebration'
    ? 'matches'
    : TABS.find(t => pathname.startsWith(t.path))?.key || ''

  return (
    <nav className="bottom-nav">
      {TABS.map(tab => (
        <button
          key={tab.key}
          className={`nav-btn ${activeKey === tab.key ? 'active' : ''}`}
          onClick={() => navigate(tab.path)}
        >
          <span className="nav-icon">{tab.icon}</span>
          <span className="nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}
