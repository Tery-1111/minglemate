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

    if (!matchHistory) {
      setLoading(false)
      return
    }

    let tier1 = null
    let tier2 = null

    if (matchHistory.tier1_match_id) {
      const { data: t1User } = await supabase
        .from('profiles_public')
        .select('id, full_name, age, bio, interests, gender, section2_unlocked')
        .eq('id', matchHistory.tier1_match_id)
        .single()

      const { data: t1Photos } = await supabase
        .from('photos')
        .select('photo_url, photo_type')
        .eq('user_id', matchHistory.tier1_match_id)
        .order('display_order')

      tier1 = { ...t1User, photos: t1Photos || [] }
    }

    if (matchHistory.tier2_match_id) {
      const { data: t2User } = await supabase
        .from('profiles_public')
        .select('id, full_name, age, bio, interests, gender, section2_unlocked')
        .eq('id', matchHistory.tier2_match_id)
        .single()

      const { data: t2Photos } = await supabase
        .from('photos')
        .select('photo_url, photo_type')
        .eq('user_id', matchHistory.tier2_match_id)
        .order('display_order')

      tier2 = { ...t2User, photos: t2Photos || [] }
    }

    setMatches({ tier1, tier2, deliveredAt: matchHistory.delivered_at })
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="matches-loading">
        <p>Loading your matches...</p>
      </div>
    )
  }

  if (!matches) {
    return (
      <div className="matches-empty">
        <div className="matches-empty-icon">💝</div>
        <h2>No matches yet</h2>
        <p>Your matches drop every Tuesday at 9 PM</p>
        <p className="matches-tip">Complete Section 1 to enter the match pool</p>
        <button className="matches-s1-btn" onClick={() => navigate('/section1')}>
          Go to Section 1 →
        </button>
      </div>
    )
  }

  return (
    <div className="matches-container">
      <h2 className="matches-heading">Your Matches This Week</h2>
      <p className="matches-week">
        Week of {new Date(matches.deliveredAt).toLocaleDateString()}
      </p>

      {matches.tier1 && (
        <MatchCard
          match={matches.tier1}
          tier="Tier 1"
          tierLabel="Similarity Match"
          tierColor="#4F2D7F"
          currentUserId={userId}
          weekId={getWeekId()}
          onChat={() => navigate(`/chat/${matches.tier1.id}`)}
        />
      )}

      {matches.tier2 && (
        <MatchCard
          match={matches.tier2}
          tier="Tier 2"
          tierLabel="Complementary Match"
          tierColor="#E8416B"
          currentUserId={userId}
          weekId={getWeekId()}
          onChat={() => navigate(`/chat/${matches.tier2.id}`)}
        />
      )}
    </div>
  )
}

function MatchCard({ match, tier, tierLabel, tierColor, currentUserId, weekId, onChat }) {
  const navigate = useNavigate()
  const [currentPhoto, setCurrentPhoto] = useState(0)
  const [promptSent, setPromptSent] = useState(false)
  const [gifting, setGifting] = useState(false)
  const [prompting, setPrompting] = useState(false)

  useEffect(() => {
    checkPromptSent()
  }, [])

  async function checkPromptSent() {
    const { data } = await supabase
      .from('payment_prompts')
      .select('id')
      .eq('sender_user_id', currentUserId)
      .eq('recipient_user_id', match.id)
      .eq('match_week_id', weekId)
      .maybeSingle()
    setPromptSent(!!data)
  }

  async function handleGift() {
    setGifting(true)
    const { error } = await supabase
      .from('gift_transactions')
      .insert({
        gifter_user_id: currentUserId,
        recipient_user_id: match.id,
        match_week_id: weekId,
        status: 'pending'
      })
    if (!error) {
      navigate('/payment?gift=true&recipientId=' + match.id)
    }
    setGifting(false)
  }

  async function handlePrompt() {
    setPrompting(true)
    await supabase
      .from('payment_prompts')
      .insert({
        sender_user_id: currentUserId,
        recipient_user_id: match.id,
        match_week_id: weekId
      })
    setPromptSent(true)
    setPrompting(false)
    alert('Payment prompt sent to your match!')
  }

  return (
    <div className="match-card">
      <div className="match-tier-badge" style={{ background: tierColor }}>
        {tier} — {tierLabel}
      </div>

      {match.photos && match.photos.length > 0 ? (
        <div className="match-photos">
          <img
            src={match.photos[currentPhoto]?.photo_url}
            alt={match.full_name}
            className="match-photo"
          />
          {match.photos.length > 1 && (
            <div className="photo-dots">
              {match.photos.map((_, i) => (
                <button
                  key={i}
                  className={`photo-dot ${i === currentPhoto ? 'active' : ''}`}
                  onClick={() => setCurrentPhoto(i)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="match-no-photo">
          <span>👤</span>
        </div>
      )}

      <div className="match-info">
        <h3 className="match-name">{match.full_name}</h3>
        <p className="match-age">{match.age} years old</p>
        <p className="match-bio">{match.bio}</p>

        {match.interests && match.interests.length > 0 && (
          <div className="match-interests">
            {match.interests.slice(0, 4).map((tag, i) => (
              <span key={i} className="match-tag">{tag}</span>
            ))}
          </div>
        )}

        <button className="match-chat-btn" onClick={onChat}>
          Start Conversation →
        </button>

        {!match.section2_unlocked && (
          <div className="match-gift-section">
            <p className="gift-label">💭 Section 2 not unlocked</p>
            <div className="gift-buttons">
              <button
                className="gift-btn"
                onClick={handleGift}
                disabled={gifting}
              >
                {gifting ? 'Processing...' : '🎁 Gift Section 2'}
              </button>
              <button
                className="prompt-btn"
                onClick={handlePrompt}
                disabled={promptSent || prompting}
              >
                {promptSent ? '✅ Prompt Sent' : prompting ? 'Sending...' : '💬 Ask Them to Unlock'}
              </button>
            </div>
          </div>
        )}

        {match.section2_unlocked && (
          <div className="match-s2-unlocked">
            ✅ Section 2 unlocked — deeper matching active
          </div>
        )}
      </div>
    </div>
  )
}