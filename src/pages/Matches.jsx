import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { signPhotoUrls } from '../lib/photoUrls'
import BottomNav from '../components/BottomNav'
import './Matches.css'

export default function Matches() {
  const navigate = useNavigate()
  const [matches, setMatches] = useState(null)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    loadMatches()
  }, [])

  function getWeekId() {
    const now = new Date()
    const start = new Date(now.getFullYear(), 0, 1)
    const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7)
    return `${now.getFullYear()}-W${week}`
  }

  async function loadMatches() {
    setError('')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }
    setUserId(session.user.id)

    const weekId = getWeekId()

    const { data: matchHistory } = await supabase
      .from('match_history')
      .select('tier1_match_id, tier2_match_id, delivered_at')
      .eq('user_id', session.user.id)
      .eq('week_id', weekId)
      .maybeSingle()

    // Qrashe matches (Force Connect pairs, both sides)
    const { data: qrasheRows } = await supabase
      .from('matches')
      .select('user_a_id, user_b_id')
      .or(`user_a_id.eq.${session.user.id},user_b_id.eq.${session.user.id}`)
      // 'active' is the chain label; the production schema stores every
      // live pair as 'matched' (matches_status_check). Admit both so a
      // Force Connect pair is recognised on either database.
      .in('status', ['active', 'matched'])

    const qrasheIds = (qrasheRows || []).map(m =>
      m.user_a_id === session.user.id ? m.user_b_id : m.user_a_id
    )

    // Hide unmatched and blocked people
    const { data: endedRows, error: endedError } = await supabase
      .from('conversations')
      .select('user_a_id, user_b_id')
      .eq('status', 'unmatched')
      .or(`user_a_id.eq.${session.user.id},user_b_id.eq.${session.user.id}`)
    const { data: blockedRows, error: blockedError } = await supabase
      .from('user_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${session.user.id},blocked_id.eq.${session.user.id}`)

    // FAIL CLOSED: if either filter could not be read we cannot prove a
    // person is unmatched/blocked, so we show no potentially hidden
    // partner rather than silently treating the failed query as empty.
    if (endedError || blockedError) {
      console.error('Matches filter error:', endedError || blockedError)
      setMatches(null)
      setError('Could not load your matches. Please try again.')
      setLoading(false)
      return
    }

    const hidden = new Set([
      ...(endedRows || []).map(r => (r.user_a_id === session.user.id ? r.user_b_id : r.user_a_id)),
      ...(blockedRows || []).map(r => (r.blocker_id === session.user.id ? r.blocked_id : r.blocker_id))
    ])

    async function hydrate(id) {
      const { data: u } = await supabase
        .from('profiles_public')
        .select('id, full_name, age, bio, interests, gender')
        .eq('id', id)
        .single()
      if (!u) return null
      const { data: photos } = await supabase
        .from('photos')
        .select('photo_url, photo_type')
        .eq('user_id', id)
        .order('display_order')
      const photoRows = photos || []
      const signed = await signPhotoUrls(photoRows.map(p => p.photo_url))
      return {
        ...u,
        photos: photoRows
          .map(p => ({ ...p, photo_url: signed.get(p.photo_url) ?? null }))
          .filter(p => p.photo_url)
      }
    }

    let tier1 = null
    let tier2 = null

    if (matchHistory?.tier1_match_id && !hidden.has(matchHistory.tier1_match_id)) tier1 = await hydrate(matchHistory.tier1_match_id)
    if (matchHistory?.tier2_match_id && !hidden.has(matchHistory.tier2_match_id)) tier2 = await hydrate(matchHistory.tier2_match_id)

    const qrashe = []
    for (const id of qrasheIds) {
      if (hidden.has(id)) continue
      const q = await hydrate(id)
      if (q) qrashe.push(q)
    }

    setMatches({ tier1, tier2, qrashe, deliveredAt: matchHistory?.delivered_at })
    setLoading(false)
  }

  if (loading) {
    // SECTION-SHAPED LOADING (loading-spec §13): the three sections keep
    // their intended structure (label + card geometry) while resolving.
    // No fake counts, no invented users, never "loading forever".
    return (
      <div className="matches-page" aria-busy="true">
        <header className="matches-header">
          <h1 className="matches-title display">Matches</h1>
        </header>
        {['Tier 1 · Similarity', 'Tier 2 · Complementary', 'Qrashe · Force Connect'].map(label => (
          <section key={label} aria-hidden="true">
            <p className="section-label">{label}</p>
            <div className="skeleton match-card-skeleton" />
          </section>
        ))}
        <BottomNav />
      </div>
    )
  }

  const hasAny = matches && (matches.tier1 || matches.tier2 || (matches.qrashe && matches.qrashe.length > 0))

  if (error) {
    return (
      <div className="matches-page">
        <div className="matches-empty">
          <div className="brand-roundel">M</div>
          <h2 className="matches-empty-title display">Couldn't load matches</h2>
          <p role="alert">{error}</p>
          <button
            className="btn-accent matches-cta"
            onClick={() => { setError(''); setLoading(true); loadMatches() }}
          >
            Try again
          </button>
        </div>
        <BottomNav />
      </div>
    )
  }

  if (!hasAny) {
    return (
      <div className="matches-page">
        <div className="matches-empty">
          <div className="brand-roundel">M</div>
          <h2 className="matches-empty-title display">No matches yet</h2>
          <p>Your matches drop every <strong>Tuesday at 9 PM</strong></p>
          <p className="matches-tip">Complete Section 1 to enter the match pool</p>
          <button className="btn-accent matches-cta" onClick={() => navigate('/discover')}>
            Explore Discover
          </button>
        </div>
        <BottomNav />
      </div>
    )
  }

  // ONE screen, three sections: Tier 1 / Tier 2 / Qrashe. No tabs.
  return (
    <div className="matches-page">
      <header className="matches-header">
        <h1 className="matches-title display">Matches</h1>
        {matches.deliveredAt && (
          <p className="matches-week">Delivered {new Date(matches.deliveredAt).toLocaleDateString('en-KE', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
        )}
      </header>

      {matches.tier1 && (
        <section>
          <p className="section-label">Tier 1 · Similarity</p>
          <MatchCard
            match={matches.tier1}
            tier="Tier 1"
            currentUserId={userId}
            onOpen={() => navigate(`/match/${matches.tier1.id}`)}
          />
        </section>
      )}

      {matches.tier2 && (
        <section>
          <p className="section-label">Tier 2 · Complementary</p>
          <MatchCard
            match={matches.tier2}
            tier="Tier 2"
            currentUserId={userId}
            onOpen={() => navigate(`/match/${matches.tier2.id}`)}
          />
        </section>
      )}

      {matches.qrashe && matches.qrashe.length > 0 && (
        <section>
          <p className="section-label">Qrashe · Force Connect</p>
          {matches.qrashe.map((q, i) => (
            <MatchCard
              key={q.id}
              match={q}
              tier="Qrashe"
              currentUserId={userId}
              enterDelay={i * 80}
              onOpen={() => navigate(`/match/${q.id}`)}
            />
          ))}
        </section>
      )}

      <BottomNav />
    </div>
  )
}

function MatchCard({ match, tier, enterDelay = 0, onOpen }) {
  // Reconciliation pass: the old gift/prompt actions (gift_transactions /
  // payment_prompts) were a parallel payment path superseded by the
  // purpose-based Connect system. Removed from the card; the tables
  // remain in the DB for historical rows.

  const facial = match.photos?.find(p => p.photo_type === 'facial') || match.photos?.[0]
  const firstName = (match.full_name || '').split(' ')[0]

  return (
    <div
      className="match-card rise-in"
      style={enterDelay ? { animationDelay: `${enterDelay}ms` } : undefined}
      role="button"
      tabIndex={0}
      aria-label={`Open match with ${match.full_name}`}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
    >
      {facial ? (
        <img src={facial.photo_url} alt="" className="match-photo" loading="lazy" decoding="async" />
      ) : (
        <div className="match-photo match-photo-empty" aria-hidden="true">
          {firstName ? firstName.charAt(0).toUpperCase() : (
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4.5 20.5c1.2-3.5 4-5.5 7.5-5.5s6.3 2 7.5 5.5" />
            </svg>
          )}
        </div>
      )}

      {/* Cards show the FACIAL photo; full-body is shown on the opened
          match screen. Name sits on a scrim, exactly like Discover. */}
      <div className="match-scrim">
        <span className="match-name">{match.full_name}</span>
        <span className="match-age">{match.age}</span>
      </div>

      <span className={`match-tier-chip match-tier-${tier.toLowerCase()}`}>{tier}</span>

      <span className="match-open-hint">Open →</span>
    </div>
  )
}
