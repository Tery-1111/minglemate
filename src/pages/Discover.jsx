import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import BottomNav from '../components/BottomNav'
import './Discover.css'

// DISCOVER: exactly 5 candidate cards (face + name + age only — no
// tier badges). Two paths: wait for the weekly mutual match, or pay
// KSh 80 to Force Connect with a selected person (creates a Qrashe
// match; the recipient is notified and cannot decline).
export default function Discover() {
  const navigate = useNavigate()
  const [candidates, setCandidates] = useState(null)
  const [photos, setPhotos] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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

  if (loading) {
    return (
      <div className="discover-page page-with-nav">
        <div className="discover-loading">Loading profiles…</div>
        <BottomNav />
      </div>
    )
  }

  return (
    <div className="discover-page page-with-nav">
      <header className="discover-header">
        <h1 className="discover-title">Discover</h1>
        <p className="discover-sub">People you may match with</p>
      </header>

      {error && <p className="discover-error">{error}</p>}

      <div className="discover-grid">
        {(candidates || []).map(c => (
          <div key={c.id} className="discover-card">
            {photos[c.id] ? (
              <img src={photos[c.id]} alt={c.full_name} className="discover-photo" />
            ) : (
              <div className="discover-photo discover-photo-empty">👤</div>
            )}
            <div className="discover-card-info">
              <span className="discover-name">{c.full_name}</span>
              <span className="discover-age">{c.age}</span>
            </div>
            <button
              className="discover-connect-btn"
              onClick={() => navigate(`/force-connect/${c.id}`)}
            >
              Force Connect · KSh 80
            </button>
          </div>
        ))}
        {candidates && candidates.length === 0 && (
          <div className="discover-empty">
            <p>No candidates right now.</p>
            <p className="discover-empty-sub">
              New classmates join every week — check back soon.
            </p>
          </div>
        )}
      </div>

      <div className="discover-paths">
        <div className="discover-path">
          <h3>Wait for a mutual match</h3>
          <p>Your weekly matches drop every Tuesday at 9 PM.</p>
        </div>
        <div className="discover-path">
          <h3>Want to connect now?</h3>
          <p>Pick a profile above and use Force Connect — KSh 80.</p>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
