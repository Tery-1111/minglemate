import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
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
      <div className="matches-loading">
        <p>Loading your matches...</p>
      </div>
    )
  }

  const hasAny = matches && (matches.tier1 || matches.tier2 || (matches.qrashe && matches.qrashe.length > 0))

  if (!hasAny) {
    return (
      <div className="matches-empty">
        <div className="matches-empty-icon">💝</div>
        <h2>No matches yet</h2>
        <p>Your matches drop every Tuesday at 9 PM</p>
        <p className="matches-tip">Complete Section 1 to enter the match pool</p>
        <button className="matches-s1-btn" onClick={() => navigate('/discover')}>
          Explore Discover →
        </button>
      </div>
    )
  }

  // ONE screen, three sections: Tier 1 / Tier 2 / Qrashe. No tabs.
  return (
    <div className="matches-container">
      {matches.tier1 && (
        <section>
          <h2 className="matches-section-title" style={{ color: '#4F2D7F' }}>Tier 1 Matches</h2>
          <MatchCard
            match={matches.tier1}
            tier="Tier 1"
            tierLabel="Similarity Match"
            tierColor="#4F2D7F"
            currentUserId={userId}
            weekId={getWeekId()}
            onOpen={() => navigate(`/match/${matches.tier1.id}`)}
          />
        </section>
      )}

      {matches.tier2 && (
        <section>
          <h2 className="matches-section-title" style={{ color: '#E8416B' }}>Tier 2 Matches</h2>
          <MatchCard
            match={matches.tier2}
            tier="Tier 2"
            tierLabel="Complementary Match"
            tierColor="#E8416B"
            currentUserId={userId}
            weekId={getWeekId()}
            onOpen={() => navigate(`/match/${matches.tier2.id}`)}
          />
        </section>
      )}

      {matches.qrashe && matches.qrashe.length > 0 && (
        <section>
          <h2 className="matches-section-title" style={{ color: '#b794f6' }}>Qrashe Matches</h2>
          {matches.qrashe.map(q => (
            <MatchCard
              key={q.id}
              match={q}
              tier="Qrashe"
              tierLabel="Force Connect"
              tierColor="#6b46c1"
              currentUserId={userId}
              weekId={getWeekId()}
              onOpen={() => navigate(`/match/${q.id}`)}
            />
          ))}
        </section>
      )}
    </div>
  )
}

function MatchCard({ match, tier, tierLabel, tierColor, onOpen }) {
  // Reconciliation pass: the old gift/prompt actions (gift_transactions /
  // payment_prompts) were a parallel payment path superseded by the
  // purpose-based Connect system. Removed from the card; the tables
  // remain in the DB for historical rows.

  return (
    <div className="match-card">
      <div className="match-tier-badge" style={{ background: tierColor }}>
        {tier} — {tierLabel}
      </div>

      {match.photos && match.photos.length > 0 ? (
        <div className="match-photos">
          {/* Cards show the FACIAL photo; full-body is shown on the
              opened match screen. */}
          <img
            src={(match.photos.find(p => p.photo_type === 'facial') || match.photos[0]).photo_url}
            alt={match.full_name}
            className="match-photo"
          />
        </div>
      ) : (
        <div className="match-no-photo">
          <span>👤</span>
        </div>
      )}

      <div className="match-info">
        <h3 className="match-name">{match.full_name}</h3>
        <p className="match-age">{match.age} years old</p>

        <button className="match-chat-btn" onClick={onOpen}>
          Open Match →
        </button>
      </div>
    </div>
  )
}