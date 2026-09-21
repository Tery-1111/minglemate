import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import BottomNav from '../components/BottomNav'
import './Matches.css'

export default function Matches() {
  const navigate = useNavigate()
  const [matches, setMatches] = useState(null)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState(null)

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
      .eq('status', 'active')

    const qrasheIds = (qrasheRows || []).map(m =>
      m.user_a_id === session.user.id ? m.user_b_id : m.user_a_id
    )

    async function hydrate(id) {
      const { data: u } = await supabase
        .from('profiles_public')
        .select('id, full_name, age, bio, interests, gender, section2_unlocked')
        .eq('id', id)
        .single()
      if (!u) return null
      const { data: photos } = await supabase
        .from('photos')
        .select('photo_url, photo_type')
        .eq('user_id', id)
        .order('display_order')
      return { ...u, photos: photos || [] }
    }

    let tier1 = null
    let tier2 = null

    if (matchHistory?.tier1_match_id) tier1 = await hydrate(matchHistory.tier1_match_id)
    if (matchHistory?.tier2_match_id) tier2 = await hydrate(matchHistory.tier2_match_id)

    const qrashe = []
    for (const id of qrasheIds) {
      const q = await hydrate(id)
      if (q) qrashe.push(q)
    }

    setMatches({ tier1, tier2, qrashe, deliveredAt: matchHistory?.delivered_at })
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="matches-page">
        <p className="matches-loading loading-dots">Loading your matches</p>
        <BottomNav />
      </div>
    )
  }

  const hasAny = matches && (matches.tier1 || matches.tier2 || (matches.qrashe && matches.qrashe.length > 0))

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
          {matches.qrashe.map(q => (
            <MatchCard
              key={q.id}
              match={q}
              tier="Qrashe"
              currentUserId={userId}
              onOpen={() => navigate(`/match/${q.id}`)}
            />
          ))}
        </section>
      )}

      <BottomNav />
    </div>
  )
}

function MatchCard({ match, tier, onOpen }) {
  // Reconciliation pass: the old gift/prompt actions (gift_transactions /
  // payment_prompts) were a parallel payment path superseded by the
  // purpose-based Connect system. Removed from the card; the tables
  // remain in the DB for historical rows.

  const facial = match.photos?.find(p => p.photo_type === 'facial') || match.photos?.[0]
  const firstName = (match.full_name || '').split(' ')[0]

  return (
    <div
      className="match-card"
      role="button"
      tabIndex={0}
      aria-label={`Open match with ${match.full_name}`}
      onClick={onOpen}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
    >
      {facial ? (
        <img src={facial.photo_url} alt="" className="match-photo" loading="lazy" />
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
