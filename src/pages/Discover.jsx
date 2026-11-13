import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { signPhotoUrls } from '../lib/photoUrls'
import BottomNav from '../components/BottomNav'
import FadeImage from '../components/FadeImage'
import './Discover.css'

// DISCOVER: exactly 5 candidate cards (face + name + age only — no
// tier badges, no contact info). Two paths: wait for the weekly mutual
// match, or select someone and pay KSh 80 to Force Connect (creates a
// Qrashe match; the recipient is notified and cannot decline).
//
// LIVENESS: loading shows exactly 5 skeleton cards in the real grid
// (never an indeterminate blob), cards reveal progressively as their
// photos decode, selection reacts instantly, and the visit is cached
// per-session so returning from a profile restores the previous cards,
// scroll position and selection without refetching.
const CACHE_KEY = 'discover_cache_v1'

export default function Discover() {
  const navigate = useNavigate()
  const [candidates, setCandidates] = useState(null)
  const [photos, setPhotos] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [navigating, setNavigating] = useState(false)

  useEffect(() => {
    // 1. Restore the last cached board instantly (continuity: returning
    //    from a profile shows the same people in the same place, zero
    //    loading flash), then 2. refresh from the server in the
    //    background so the data stays honest.
    try {
      const cached = sessionStorage.getItem(CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (Array.isArray(parsed.candidates) && parsed.candidates.length > 0) {
          setCandidates(parsed.candidates)
          // Cached values are stored addresses; links expire, so sign them again.
          signPhotoUrls(Object.values(parsed.photos || {})).then(signed => {
            const shown = {}
            for (const [id, url] of Object.entries(parsed.photos || {})) shown[id] = signed.get(url) ?? null
            setPhotos(shown)
          })
          setLoading(false)
        }
      }
    } catch {
      // Corrupt cache — ignore, fresh load will repopulate.
    }
    load()
  }, [])

  // Preserve the exact scroll position the user left at (per-page key,
  // so /discover coming back from /match/:id restores precisely).
  useEffect(() => {
    if (loading) return
    const key = 'scroll:discover'
    const y = Number(sessionStorage.getItem(key) || 0)
    if (y) window.scrollTo(0, y)
    const save = () => sessionStorage.setItem(key, String(window.scrollY))
    window.addEventListener('scroll', save, { passive: true })
    return () => window.removeEventListener('scroll', save)
  }, [loading])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }

    const { data, error: rpcError } = await supabase.rpc('discover_candidates')
    if (rpcError) {
      // Only surface the error when we had nothing to show — a cached
      // board keeps working; refresh can retry silently next visit.
      if (!candidates) setError('Could not load profiles. Please try again.')
      setLoading(false)
      return
    }

    setCandidates(data || [])

    // Fetch facial photos for the candidate ids in one query.
    const ids = (data || []).map(c => c.id)
    const map = {}
    if (ids.length > 0) {
      const { data: photoRows } = await supabase
        .from('photos')
        .select('user_id, photo_url')
        .in('user_id', ids)
        .eq('photo_type', 'facial')
        .order('display_order')

      for (const p of photoRows || []) {
        if (!map[p.user_id]) map[p.user_id] = p.photo_url
      }
      const signed = await signPhotoUrls(Object.values(map))
      const shown = {}
      for (const [id, url] of Object.entries(map)) shown[id] = signed.get(url) ?? null
      setPhotos(shown)
    }

    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ candidates: data || [], photos: map }))
    } catch { /* storage full / private mode — non-fatal */ }
    setLoading(false)
  }

  const selected = (candidates || []).find(c => c.id === selectedId) || null

  function openForceConnect() {
    if (!selected || navigating) return
    setNavigating(true) // IMMEDIATE RESPONSE: press feedback before route change
    navigate(`/force-connect/${selected.id}`)
  }

  if (loading) {
    return (
      <div className="discover-page page-with-nav">
        <header className="discover-header">
          <div>
            <h1 className="discover-title">Discover</h1>
            <p className="discover-sub">People you may match with</p>
          </div>
          <p className="discover-cadence">
            Weekly matches drop<br /><strong>Tuesday · 9 PM</strong>
          </p>
        </header>
        {/* Exactly 5 skeletons in the real grid — the final card
            geometry (photo area + name + age), never a spinner and
            never fake data (loading must not look like empty). */}
        <div className="discover-grid" aria-busy="true" aria-label="Loading profiles">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="discover-card discover-card-skeleton">
              <div className="skeleton discover-skeleton-photo" />
              <div className="discover-skeleton-scrim" aria-hidden="true">
                <span className="skeleton discover-skeleton-name" />
                <span className="skeleton discover-skeleton-age" />
              </div>
            </div>
          ))}
        </div>
        <BottomNav />
      </div>
    )
  }

  return (
    <div className="discover-page page-with-nav">
      <header className="discover-header">
        <div>
          <h1 className="discover-title">Discover</h1>
          <p className="discover-sub">People you may match with</p>
        </div>
        <p className="discover-cadence">
          Weekly matches drop<br /><strong>Tuesday · 9 PM</strong>
        </p>
      </header>

      {error && (
        <div className="discover-error-block">
          <p className="discover-error">{error}</p>
          <button className="btn-ghost discover-retry" onClick={() => { setError(''); setLoading(true); load() }}>
            Try again
          </button>
        </div>
      )}

      <div className="discover-grid">
        {(candidates || []).map((c, i) => {
          const isSelected = c.id === selectedId
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              className={`discover-card rise-in${isSelected ? ' selected' : ''}`}
              style={{ animationDelay: `${i * 60}ms` }}
              onClick={() => setSelectedId(isSelected ? null : c.id)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSelectedId(isSelected ? null : c.id)
                }
              }}
            >
              <FadeImage
                src={photos[c.id]}
                alt={c.full_name}
                className="discover-photo-wrap"
                imgClassName="discover-photo"
                loading="lazy"
                decoding="async"
                scrim={
                  <>
                    {isSelected ? (
                      <span className="discover-fc-chip">Force Connect · KSh 80</span>
                    ) : (
                      <span className="discover-fc-hint">Force Connect</span>
                    )}
                    <div className="discover-scrim">
                      <span className="discover-name">{c.full_name}</span>
                      <span className="discover-age">{c.age}</span>
                    </div>
                  </>
                }
              />
            </div>
          )
        })}

        {candidates && candidates.length === 0 && (
          <div className="discover-empty">
            <div className="discover-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" />
              </svg>
            </div>
            <h2 className="discover-empty-title">No candidates right now</h2>
            <p>
              New members join every week. Your next window opens with the
              Tuesday match drop.
            </p>
          </div>
        )}
      </div>

      {selected && (
        <div className="discover-actionbar rise-in">
          <div className="discover-actionbar-info">
            <div className="discover-actionbar-title">
              Connect with {selected.full_name} now
            </div>
            <div className="discover-actionbar-sub">
              KSh 80 · they'll be notified and can't decline
            </div>
          </div>
          <button
            className={`discover-fc-btn${navigating ? ' is-busy' : ''}`}
            onClick={openForceConnect}
            disabled={navigating}
          >
            {navigating ? 'Opening…' : 'Force Connect'}
          </button>
        </div>
      )}

      <p className="discover-pathnote">
        Or wait for a mutual match — <strong>Tuesdays, 9 PM</strong>. Matched
        with someone? They appear under Matches, ready to chat.
      </p>

      <BottomNav />
    </div>
  )
}
