import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Chat.css'

export default function Chat() {
  const navigate = useNavigate()
  const { matchId } = useParams()
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [matchUser, setMatchUser] = useState(null)
  const [meetupConfirmed, setMeetupConfirmed] = useState(false)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    loadChat()
  }, [matchId])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  async function loadChat() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }
    setCurrentUser(session.user.id)

    // Load match user profile
    const { data: matchData } = await supabase
      .from('users')
      .select('id, full_name, interests')
      .eq('id', matchId)
      .single()
    setMatchUser(matchData)

    // Load existing messages
    const { data: msgs } = await supabase
      .from('messages')
      .select('*')
      .or(`and(sender_id.eq.${session.user.id},recipient_id.eq.${matchId}),and(sender_id.eq.${matchId},recipient_id.eq.${session.user.id})`)
      .order('sent_at', { ascending: true })
    setMessages(msgs || [])

    // Mark messages as read
    await supabase
      .from('messages')
      .update({ read: true })
      .eq('recipient_id', session.user.id)
      .eq('sender_id', matchId)

    // Check engagement metrics for meetup
    const weekId = getWeekId()
    const { data: engagement } = await supabase
      .from('engagement_metrics')
      .select('meetup_confirmed')
      .eq('user_id', session.user.id)
      .eq('week_id', weekId)
      .single()
    setMeetupConfirmed(engagement?.meetup_confirmed || false)

    setLoading(false)

    // Subscribe to realtime messages
    const channel = supabase
      .channel('messages')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `recipient_id=eq.${session.user.id}`
      }, (payload) => {
        if (payload.new.sender_id === matchId) {
          setMessages(prev => [...prev, payload.new])
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }

  function getWeekId() {
    const now = new Date()
    const start = new Date(now.getFullYear(), 0, 1)
    const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7)
    return `${now.getFullYear()}-W${week}`
  }

  async function handleSend() {
    if (!newMessage.trim() || sending) return
    setSending(true)

    const { data } = await supabase
      .from('messages')
      .insert({
        sender_id: currentUser,
        recipient_id: matchId,
        content: newMessage.trim()
      })
      .select()
      .single()

    setMessages(prev => [...prev, data])
    setNewMessage('')

    // Update engagement metrics
    const weekId = getWeekId()
    await supabase.from('engagement_metrics').upsert({
      user_id: currentUser,
      week_id: weekId,
      messages_sent: 1
    }, { onConflict: 'user_id,week_id', ignoreDuplicates: false })

    setSending(false)
  }

  async function handleMeetupConfirm() {
    const weekId = getWeekId()
    await supabase.from('engagement_metrics').upsert({
      user_id: currentUser,
      week_id: weekId,
      meetup_confirmed: true
    }, { onConflict: 'user_id,week_id' })
    setMeetupConfirmed(true)
  }

  function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (loading) {
    return (
      <div className="chat-loading">
        <p>Loading chat...</p>
      </div>
    )
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <button className="chat-back" onClick={() => navigate('/home')}>←</button>
        <div className="chat-match-info">
          <h3 className="chat-match-name">{matchUser?.full_name}</h3>
          <p className="chat-match-sub">Your match this week</p>
        </div>
        {!meetupConfirmed && (
          <button className="meetup-btn" onClick={handleMeetupConfirm}>
            🤝 Met Up
          </button>
        )}
        {meetupConfirmed && (
          <span className="meetup-confirmed">✅ Met Up!</span>
        )}
      </div>

      {matchUser?.interests && (
        <div className="chat-icebreakers">
          <p className="icebreaker-label">💡 Talk about:</p>
          <div className="icebreaker-tags">
            {matchUser.interests.slice(0, 3).map((tag, i) => (
              <span key={i} className="icebreaker-tag">{tag}</span>
            ))}
          </div>
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>No messages yet.</p>
            <p>Say hello! 👋</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`message ${msg.sender_id === currentUser ? 'sent' : 'received'}`}
          >
            <p className="message-text">{msg.content}</p>
            <p className="message-time">
              {new Date(msg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          className="chat-input"
          placeholder="Type a message..."
          value={newMessage}
          onChange={e => setNewMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          rows={1}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!newMessage.trim() || sending}
        >
          {sending ? '...' : '➤'}
        </button>
      </div>
    </div>
  )
}