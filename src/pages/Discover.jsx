import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import BottomNav from '../components/BottomNav'
import './Discover.css'

// DISCOVER: exactly 5 candidate cards (face + name + age only — no
// tier badges, no contact info). Two paths: wait for the weekly mutual
// match, or select someone and pay KSh 80 to Force Connect (creates a
// Qrashe match; the recipient is notified and cannot decline).
export default function Discover() {
  const navigate = useNavigate()
  const [candidates, setCandidates] = useState(null)
  const [photos, setPhotos] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }

    const { data, error: rpcError } = await supabase.rpc('discover_candidates')
    if (rpcError) {
      setError('Could not load profiles. Please try again.')
      setLoading(false)
      return
    }

    setCandidates(data || [])

    // Fetch facial photos for the candidate ids in one query.
    const ids = (data || []).map(c => c.id)
    if (ids.length > 0) {
      const { data: photoRows } = await supabase
        .from('photos')
        .select('user_id, photo_url')
        .in('user_id', ids)
        .eq('photo_type', 'facial')
        .order('display_order')

      const map = {}
      for (const p of photoRows || []) {
        if (!map[p.user_id]) map[p.user_id] = p.photo_url
      }
      setPhotos(map)
    }
    setLoading(false)
  }

  const selected = (candidates || []).find(c => c.id === selectedId) || null

  if (loading) {
    return (
      <div className="discover-page page-with-nav">
        <div className="discover-loading loading-dots">Loading profiles</div>
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

      {error && <p className="discover-error">{error}</p>}

      <div className="discover-grid">
        {(candidates || []).map(c => {
          const isSelected = c.id === selectedId
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              className={`discover-card${isSelected ? ' selected' : ''}`}
              onClick={() => setSelectedId(isSelected ? null : c.id)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSelectedId(isSelected ? null : c.id)
                }
              }}
            >
              {photos[c.id] ? (
                <img
                  src={photos[c.id]}
                  alt={c.full_name}
                  className="discover-photo"
                  loading="lazy"
                />
              ) : (
                <div className="discover-photo discover-photo-empty">👤</div>
              )}
              {isSelected ? (
                <span className="discover-fc-chip">Force Connect · KSh 80</span>
              ) : (
                <span className="discover-fc-hint">Force Connect</span>
              )}
              <div className="discover-scrim">
                <span className="discover-name">{c.full_name}</span>
                <span className="discover-age">{c.age}</span>
              </div>
            </div>
          )
        })}

        {candidates && candidates.length === 0 && (
          <div className="discover-empty">
            <div className="discover-empty-icon">🌙</div>
            <h2 className="discover-empty-title">No candidates right now</h2>
            <p>
              New members join every week. Your next window opens with the
              Tuesday match drop.
            </p>
          </div>
        )}
      </div>

      {selected && (
        <div className="discover-actionbar">
          <div className="discover-actionbar-info">
            <div className="discover-actionbar-title">
              Connect with {selected.full_name} now
            </div>
            <div className="discover-actionbar-sub">
              KSh 80 · they'll be notified and can't decline
            </div>
          </div>
          <button
            className="discover-fc-btn"
            onClick={() => navigate(`/force-connect/${selected.id}`)}
          >
            Force Connect
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
