import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import BottomNav from '../components/BottomNav'
import './Messages.css'

// MESSAGES: one conversation list built from all pairing sources —
// weekly Tier 1/2 (match_history, both directions) + Qrashe
// (matches). No separate tabs; the conversation screen is shared.
export default function Messages() {
  const navigate = useNavigate()
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(true)
  const [myId, setMyId] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    load()
  }, [])

  function getWeekId() {
    const now = new Date()
    const start = new Date(now.getFullYear(), 0, 1)
    const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7)
    return `${now.getFullYear()}-W${week}`
  }

  async function load() {
    setError('')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }
    const uid = session.user.id
    setMyId(uid)

    // 1) Qrashe pairs (matches table, either side, active)
    const { data: qrasheRows } = await supabase
      .from('matches')
      .select('user_a_id, user_b_id, status')
      .or(`user_a_id.eq.${uid},user_b_id.eq.${uid}`)
      // Production stores the pair as 'matched'; 'active' is the chain label.
      .in('status', ['active', 'matched'])

    // 2) Weekly tier matches (both directions, current week)
    const weekId = getWeekId()
    const { data: myRow } = await supabase
      .from('match_history')
      .select('tier1_match_id, tier2_match_id')
      .eq('user_id', uid)
      .eq('week_id', weekId)
      .maybeSingle()
    const { data: otherRows } = await supabase
      .from('match_history')
      .select('user_id, tier1_match_id, tier2_match_id')
      .or(`tier1_match_id.eq.${uid},tier2_match_id.eq.${uid}`)
      .eq('week_id', weekId)

    let pairs = []
    const seen = new Set()

    for (const m of qrasheRows || []) {
      const otherId = m.user_a_id === uid ? m.user_b_id : m.user_a_id
      if (!seen.has(otherId)) {
        seen.add(otherId)
        pairs.push({ id: otherId, tier: 'qrashe' })
      }
    }
    if (myRow) {
      if (myRow.tier1_match_id && !seen.has(myRow.tier1_match_id)) {
        seen.add(myRow.tier1_match_id)
        pairs.push({ id: myRow.tier1_match_id, tier: 'tier1' })
      }
      if (myRow.tier2_match_id && !seen.has(myRow.tier2_match_id)) {
        seen.add(myRow.tier2_match_id)
        pairs.push({ id: myRow.tier2_match_id, tier: 'tier2' })
      }
    }
    for (const r of otherRows || []) {
      const otherId = r.tier1_match_id === uid ? r.user_id : (r.tier2_match_id === uid ? r.user_id : null)
      if (otherId && !seen.has(otherId)) {
        seen.add(otherId)
        pairs.push({ id: otherId, tier: r.tier1_match_id === uid ? 'tier1' : 'tier2' })
      }
    }

    // Hide unmatched and blocked people
    const { data: endedRows, error: endedError } = await supabase
      .from('conversations')
      .select('user_a_id, user_b_id')
      .eq('status', 'unmatched')
      .or(`user_a_id.eq.${uid},user_b_id.eq.${uid}`)
    const { data: blockedRows, error: blockedError } = await supabase
      .from('user_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${uid},blocked_id.eq.${uid}`)

    // FAIL CLOSED: when the filters cannot be read we cannot prove a
    // conversation is still legitimate, so show nothing rather than
    // risk listing a blocked or unmatched partner.
    if (endedError || blockedError) {
      console.error('Messages filter error:', endedError || blockedError)
      setItems([])
      setError('Could not load your conversations. Please try again.')
      setLoading(false)
      return
    }

    const hidden = new Set([
      ...(endedRows || []).map(r => (r.user_a_id === uid ? r.user_b_id : r.user_a_id)),
      ...(blockedRows || []).map(r => (r.blocker_id === uid ? r.blocked_id : r.blocker_id))
    ])
    pairs = pairs.filter(p => !hidden.has(p.id))

    if (pairs.length === 0) {
      setItems([])
      setLoading(false)
      return
    }

    // 3) Hydrate: profile + face photo + last message in one pass.
    const ids = pairs.map(p => p.id)
    const { data: profiles } = await supabase
      .from('profiles_public')
      .select('id, full_name, age')
      .in('id', ids)
    const { data: photos } = await supabase
      .from('photos')
      .select('user_id, photo_url')
      .in('user_id', ids)
      .eq('photo_type', 'facial')
      .order('display_order')

    // Last message per partner: fetch recent incoming+outgoing and
    // keep the newest per partner (bounded, matches chat cap).
    const { data: sent } = await supabase
      .from('messages')
      .select('sender_id, recipient_id, content, sent_at, is_bot')
      .eq('sender_id', uid)
      .in('recipient_id', ids)
      .order('sent_at', { ascending: false })
      .limit(100)
    const { data: recv } = await supabase
      .from('messages')
      .select('sender_id, recipient_id, content, sent_at, is_bot')
      .eq('recipient_id', uid)
      .in('sender_id', ids)
      .order('sent_at', { ascending: false })
      .limit(100)

    const lastMap = {}
    for (const m of [...(sent || []), ...(recv || [])]) {
      const partner = m.sender_id === uid ? m.recipient_id : m.sender_id
      if (!lastMap[partner] || new Date(m.sent_at) > new Date(lastMap[partner].sent_at)) {
        lastMap[partner] = m
      }
    }

    const photoMap = {}
    for (const p of photos || []) {
      if (!photoMap[p.user_id]) photoMap[p.user_id] = p.photo_url
    }

    const hydrated = pairs.map(p => ({
      ...p,
      profile: (profiles || []).find(x => x.id === p.id) || { id: p.id, full_name: 'Student', age: null },
      photo: photoMap[p.id] || null,
      last: lastMap[p.id] || null
    }))

    // Newest conversation first.
    hydrated.sort((a, b) => {
      const ta = a.last?.sent_at ? new Date(a.last.sent_at).getTime() : 0
      const tb = b.last?.sent_at ? new Date(b.last.sent_at).getTime() : 0
      return tb - ta
    })

    setItems(hydrated)
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="messages-page page-with-nav">
        <div className="messages-loading">Loading conversations…</div>
        <BottomNav />
      </div>
    )
  }

  return (
    <div className="messages-page page-with-nav">
      <header className="messages-header">
        <h1 className="messages-title">Messages</h1>
      </header>

      {error && (
        <div className="messages-empty">
          <div className="empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a8 8 0 0 1-8 8H5.5L3 21.5V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
            </svg>
          </div>
          <h2>Couldn't load conversations</h2>
          <p role="alert">{error}</p>
          <button
            className="btn-ghost"
            onClick={() => { setError(''); setLoading(true); load() }}
          >
            Try again
          </button>
        </div>
      )}

      {items && items.length === 0 && !error && (
        <div className="messages-empty">
          <div className="empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a8 8 0 0 1-8 8H5.5L3 21.5V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z" />
            </svg>
          </div>
          <h2>No conversations yet</h2>
          <p>Your matches will appear here.</p>
        </div>
      )}

      <div className="messages-list">
        {!error && (items || []).map(item => (
          <button
            key={item.id}
            className="message-row"
            onClick={() => navigate(`/chat/${item.id}`)}
          >
            {item.photo ? (
              <img src={item.photo} alt={item.profile.full_name} className="message-avatar" />
            ) : (
              <div className="message-avatar message-avatar-empty" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4.5 20.5c1.2-3.5 4-5.5 7.5-5.5s6.3 2 7.5 5.5" />
                </svg>
              </div>
            )}
            <div className="message-row-main">
              <div className="message-row-top">
                <span className="message-name">{item.profile.full_name}</span>
                <span className="message-time">
                  {item.last?.sent_at
                    ? new Date(item.last.sent_at).toLocaleDateString([], { month: 'short', day: 'numeric' })
                    : ''}
                </span>
              </div>
              <p className="message-preview">
                {item.last
                  ? (item.last.is_bot ? '🤖 ' : '') + (item.last.content || '').slice(0, 60)
                  : 'Matched — say hello 👋'}
              </p>
            </div>
          </button>
        ))}
      </div>

      <BottomNav />
    </div>
  )
}
