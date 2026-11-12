import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import FadeImage from '../components/FadeImage'
import Section2Comparison from '../components/Section2Comparison'
import './MatchDetail.css'

// OPEN MATCH: same experience for Tier 1 / Tier 2 / Qrashe.
// Full-body photo first, then bio, conversation access, connect
// actions. Connect is available WITHOUT completing the guided
// questions (Path B); the guided conversation remains Path A.
export default function MatchDetail() {
  const navigate = useNavigate()
  const { userId: matchId } = useParams()
  const [profile, setProfile] = useState(null)
  const [bodyPhoto, setBodyPhoto] = useState(null)
  const [facePhoto, setFacePhoto] = useState(null)
  const [tier, setTier] = useState(null)          // 'tier1' | 'tier2' | 'qrashe'
  const [unlock, setUnlock] = useState(null)      // my paid unlock row, if any
  const [contacts, setContacts] = useState(null)  // revealed contacts
  const [loading, setLoading] = useState(true)
  const [myId, setMyId] = useState(null)
  const [actionMsg, setActionMsg] = useState('')
  // Safety actions are state-machined: idle → busy(name) → done/error.
  // The clicked button enters a visible busy state immediately (no
  // frozen click, no double submit) and reports its outcome in text.
  const [busyAction, setBusyAction] = useState(null) // null | 'unmatch' | 'block' | 'report'
  const [convStatus, setConvStatus] = useState('')
  // The conversation status gate decides whether Unmatch may be offered.
  // Until the query actually succeeds we do NOT know the status, so the
  // action stays hidden (fail closed) instead of assuming "no status".
  const [convStatusKnown, setConvStatusKnown] = useState(false)

  useEffect(() => {
    load()
  }, [matchId])

  async function load() {
    // Navigating between matches must not carry the previous match's
    // conversation status across while this load is in flight.
    setConvStatus('')
    setConvStatusKnown(false)

    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }
    const uid = session.user.id
    setMyId(uid)

    // Profile (public columns only) + photos (face for header, body primary)
    const { data: u } = await supabase
      .from('profiles_public')
      .select('id, full_name, age, bio, interests')
      .eq('id', matchId)
      .single()
    setProfile(u || null)

    const { data: photos } = await supabase
      .from('photos')
      .select('photo_url, photo_type')
      .eq('user_id', matchId)
      .order('display_order')
    setBodyPhoto((photos || []).find(p => p.photo_type === 'full_body')?.photo_url || null)
    setFacePhoto((photos || []).find(p => p.photo_type === 'facial')?.photo_url || null)

    // Tier: Qrashe pair (matches) or weekly tier (match_history, both directions)
    const { data: qrashe } = await supabase
      .from('matches')
      .select('id')
      .or(`and(user_a_id.eq.${uid},user_b_id.eq.${matchId}),and(user_a_id.eq.${matchId},user_b_id.eq.${uid})`)
      // 'active' is the chain label; production stores the pair as 'matched'.
      .in('status', ['active', 'matched'])
      .maybeSingle()

    let t = null
    if (qrashe) {
      t = 'qrashe'
    } else {
      function getWeekId() {
        const now = new Date()
        const start = new Date(now.getFullYear(), 0, 1)
        const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7)
        return `${now.getFullYear()}-W${week}`
      }
      const weekId = getWeekId()
      const { data: mine } = await supabase
        .from('match_history')
        .select('tier1_match_id, tier2_match_id')
        .eq('user_id', uid)
        .eq('week_id', weekId)
        .maybeSingle()
      if (mine?.tier1_match_id === matchId) t = 'tier1'
      else if (mine?.tier2_match_id === matchId) t = 'tier2'
      else {
        const { data: theirs } = await supabase
          .from('match_history')
          .select('user_id, tier1_match_id, tier2_match_id')
          .eq('user_id', matchId)
          .eq('week_id', weekId)
          .maybeSingle()
        if (theirs?.tier1_match_id === uid) t = 'tier1'
        else if (theirs?.tier2_match_id === uid) t = 'tier2'
      }
    }
    setTier(t)

    // Paid unlock state: hides Connect and enables the contact card.
    const { data: unlockRow } = await supabase
      .from('connect_unlocks')
      .select('id')
      .eq('buyer_id', uid)
      .eq('seller_id', matchId)
      .maybeSingle()
    setUnlock(unlockRow)

    if (unlockRow) {
      const { data: c } = await supabase.rpc('get_unlocked_contacts', { other_user_id: matchId })
      setContacts(c?.[0] || null)
    }

    // Read conversation status (sorted pair, same orientation as Chat)
    const first = uid < matchId ? uid : matchId
    const second = uid < matchId ? matchId : uid
    const { data: convRow, error: convError } = await supabase
      .from('conversations')
      .select('status')
      .eq('user_a_id', first)
      .eq('user_b_id', second)
      .maybeSingle()
    if (convError) {
      // Unknown status: leave the status empty and keep the gate closed.
      // A subsequent successful load can still open it.
      setConvStatus('')
      setConvStatusKnown(false)
    } else {
      setConvStatus(convRow?.status || '')
      setConvStatusKnown(true)
    }

    setLoading(false)
  }

  function connectPurpose() {
    if (tier === 'tier1') return { purpose: 'connect_tier1', price: 'KSh 70' }
    if (tier === 'tier2') return { purpose: 'connect_tier2', price: 'KSh 50' }
    return { purpose: 'connect_qrashe', price: 'KSh 50' }
  }

  function goConnect() {
    const { purpose } = connectPurpose()
    navigate(`/payment?purpose=${purpose}&recipientId=${matchId}`)
  }

  async function handleUnmatch() {
    if (busyAction) return
    if (!confirm('Unmatch? This ends the conversation. This cannot be done after Connect.')) return
    setBusyAction('unmatch')
    const { error } = await supabase.rpc('unmatch_conversation', { other_user_id: matchId })
    setActionMsg(error ? (error.message || 'Could not unmatch.') : 'Unmatched.')
    setBusyAction(null)
    if (!error) setTimeout(() => navigate('/matches'), 800)
  }

  async function handleBlock() {
    if (busyAction) return
    if (!confirm('Block this person? You will not be able to message each other.')) return
    setBusyAction('block')
    const { error } = await supabase
      .from('user_blocks')
      .insert({ blocker_id: myId, blocked_id: matchId })
    setActionMsg(error ? (error.message || 'Could not block.') : 'Blocked.')
    setBusyAction(null)
    if (!error) setTimeout(() => navigate('/matches'), 800)
  }

  async function handleReport() {
    if (busyAction) return
    const reason = prompt('What is the problem with this profile?')
    if (!reason) return
    setBusyAction('report')
    const { error } = await supabase
      .from('reports')
      .insert({ reporter_id: myId, reported_id: matchId, reason })
    setActionMsg(error ? (error.message || 'Could not report.') : 'Report sent. Thank you.')
    setBusyAction(null)
  }

  if (loading) {
    return <div className="md-page"><p className="md-loading loading-dots">Loading</p></div>
  }

  if (!profile) {
    return (
      <div className="md-page">
        <div className="md-missing">
          <h2 className="display">Profile not found</h2>
          <p>This match may have ended or the profile is no longer available.</p>
          <button className="btn-ghost md-missing-btn" onClick={() => navigate('/matches')}>
            Back to Matches
          </button>
        </div>
      </div>
    )
  }

  const { price } = connectPurpose()
  const firstName = profile.full_name.split(' ')[0]

  return (
    <div className="md-page">
      <div className="md-card">
        <button className="md-back" onClick={() => navigate(-1)} aria-label="Go back">←</button>

        {/* Full-body photo is the hero; facial remains the card photo.
            CONTINUITY: the photo fades in over its own box (no pop, no
            layout shift) — the same box the skeleton occupied. */}
        {bodyPhoto || facePhoto ? (
          <FadeImage
            src={bodyPhoto || facePhoto}
            alt={profile.full_name}
            className="md-photo-wrap"
            imgClassName="md-photo"
            decoding="async"
          />
        ) : (
          <div className="md-photo md-photo-empty" aria-hidden="true">{firstName.charAt(0).toUpperCase()}</div>
        )}
        <div className="md-info">
          <div className="md-id rise-in">
            <h1 className="md-name display">{profile.full_name}, {profile.age}</h1>
          </div>

          {profile.bio && <p className="md-bio rise-in" style={{ animationDelay: '80ms' }}>{profile.bio}</p>}

          {profile.interests && profile.interests.length > 0 && (
            <div className="md-interests rise-in" style={{ animationDelay: '140ms' }}>
              {profile.interests.slice(0, 6).map(tag => (
                <span key={tag} className="md-tag">{tag}</span>
              ))}
            </div>
          )}

        </div>
        <Section2Comparison
          partnerId={matchId}
          myId={myId}
          partnerName={firstName}
        />
        <div className="md-side">

          {!unlock && (
            <div className="md-cta-block rise-in" style={{ animationDelay: '180ms' }}>
              <button className="btn-ghost md-btn md-btn-connect" onClick={goConnect}>
                Connect with {firstName} · {price}
              </button>
              <p className="md-connect-note">
                Connect unlocks their contact details according to their sharing choices.
              </p>
            </div>
          )}

          {unlock && (
            <div className="md-unlocked">
              <p className="md-unlocked-label">Connected</p>
              {contacts && (
                <div className="md-contacts">
                  {contacts.phone && (
                    <div className="md-contact-row"><span className="md-contact-kind">Phone</span><span className="md-contact-val">{contacts.phone}</span></div>
                  )}
                  {contacts.whatsapp_number && (
                    <div className="md-contact-row"><span className="md-contact-kind">WhatsApp</span><span className="md-contact-val">{contacts.whatsapp_number}</span></div>
                  )}
                  {contacts.email && (
                    <div className="md-contact-row"><span className="md-contact-kind">Email</span><span className="md-contact-val">{contacts.email}</span></div>
                  )}
                  {contacts.social_instagram && (
                    <div className="md-contact-row"><span className="md-contact-kind">Instagram</span><span className="md-contact-val">@{contacts.social_instagram}</span></div>
                  )}
                  {contacts.social_x && (
                    <div className="md-contact-row"><span className="md-contact-kind">X</span><span className="md-contact-val">@{contacts.social_x}</span></div>
                  )}
                  {contacts.social_tiktok && (
                    <div className="md-contact-row"><span className="md-contact-kind">TikTok</span><span className="md-contact-val">@{contacts.social_tiktok}</span></div>
                  )}
                  {!contacts.phone && !contacts.whatsapp_number && !contacts.email &&
                    !contacts.social_instagram && !contacts.social_x && !contacts.social_tiktok && (
                      <p className="md-contacts-none">They haven't enabled any contact sharing yet.</p>
                    )}
                </div>
              )}
              <button className="btn-ghost md-btn" onClick={() => navigate(`/chat/${matchId}`)}>
                Open Conversation
              </button>
              <p className="md-connect-note">The conversation is read-only now that you're connected.</p>
            </div>
          )}

          <div className="md-actions">
            {!unlock && convStatusKnown && convStatus !== 'locked' && convStatus !== 'unmatched' && (
              <button className="md-action md-action-warn" onClick={handleUnmatch} disabled={!!busyAction} aria-busy={busyAction === 'unmatch'}>
                {busyAction === 'unmatch' ? 'Unmatching…' : 'Unmatch'}
              </button>
            )}
            <button className="md-action" onClick={handleBlock} disabled={!!busyAction} aria-busy={busyAction === 'block'}>
              {busyAction === 'block' ? 'Blocking…' : 'Block'}
            </button>
            <button className="md-action" onClick={handleReport} disabled={!!busyAction} aria-busy={busyAction === 'report'}>
              {busyAction === 'report' ? 'Sending…' : 'Report'}
            </button>
          </div>

          {actionMsg && <p className="md-action-msg" role="status">{actionMsg}</p>}
        </div>
      </div>
    </div>
  )
}
