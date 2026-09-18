import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Chat.css'

const section2Questions = [
  "If we were matched by the algorithm, what would you hope to learn about me before meeting in person?",
  "What do you feel are your strongest traits that a partner should know about, and what are your weaknesses they should understand?",
  "If you could wake up tomorrow with one new ability or quality, what would it be and why?",
  "What's something you've always wanted to try on campus but haven't, and what's stopping you?",
  "What does a perfect day on campus look like for you? Include academics, social life, and personal time.",
  "How do you define friendship at this stage of your life, and what role does it play in your relationships?",
  "Take four minutes and tell your life story — what do you think is most important for me to know about you?",
  "If you could have dinner with anyone — a professor, celebrity, historical figure, or family member — who would it be and why?",
  "What are the three things you think we have in common right now?",
  "What's something you are most grateful for in your life at this moment?",
  "If you knew you had only one year to live, what would you change about how you're living on campus?",
  "What roles do love and affection play in your life right now — romantic, platonic, or familial?",
  "Share one embarrassing moment from your student life that still makes you cringe or laugh.",
  "What, if anything, is too serious to joke about? Where's your boundary?",
  "When did you last cry — alone or in front of someone else — and what did you learn about yourself?",
  "Tell me one thing you genuinely like about me from what you know so far.",
  "What are your personal non-negotiables in a relationship, if any, and why?",
  "Of all the people in your life, whose absence would affect you most deeply, and why?",
  "Share a personal challenge you're facing right now — academic, emotional, or social — and how you cope with it.",
  "If we were to become closer, what's one thing you think I should understand about you to build a stronger connection?"
]

const FREE_QUESTIONS = 4
const UNLOCK_THRESHOLD = 14

const CONTACT_PATTERNS = [
  /(\+?254|0)[17]\d{8}/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  /@[A-Za-z0-9_.]{2,}/g,
  /wa\.me\/\d+/gi,
  /whatsapp\s*me/gi,
  /snap(chat)?\s*:?\s*@?[A-Za-z0-9_.]{2,}/gi,
  /tiktok\s*:?\s*@?[A-Za-z0-9_.]{2,}/gi,
  /insta(gram)?\s*:?\s*@?[A-Za-z0-9_.]{2,}/gi,
]

function containsContact(text) {
  return CONTACT_PATTERNS.some(pattern => {
    pattern.lastIndex = 0
    return pattern.test(text)
  })
}

function blurContactInfo(text) {
  let result = text
  CONTACT_PATTERNS.forEach(pattern => {
    pattern.lastIndex = 0
    result = result.replace(pattern, (match) => '█'.repeat(match.length))
  })
  return result
}

async function reloadMessages(userId, matchId) {
  const { data } = await supabase
    .from('messages')
    .select('*')
    .or(`and(sender_id.eq.${userId},recipient_id.eq.${matchId}),and(sender_id.eq.${matchId},recipient_id.eq.${userId})`)
    .order('sent_at', { ascending: true })
  return data || []
}

export default function Chat() {
  const navigate = useNavigate()
  const { matchId } = useParams()
  const [messages, setMessages] = useState([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [currentUserData, setCurrentUserData] = useState(null)
  const [matchUser, setMatchUser] = useState(null)
  const [meetupConfirmed, setMeetupConfirmed] = useState(false)
  const [s2Progress, setS2Progress] = useState(null)
  const [bothUnlocked, setBothUnlocked] = useState(false)
  const [contactsRevealed, setContactsRevealed] = useState(false)
  const [matchContact, setMatchContact] = useState(null)
  const [sendingBot, setSendingBot] = useState(false)
  const messagesEndRef = useRef(null)
  const currentUserRef = useRef(null)

  useEffect(() => {
    loadChat()
  }, [matchId])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  function getWeekId() {
    const now = new Date()
    const start = new Date(now.getFullYear(), 0, 1)
    const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7)
    return `${now.getFullYear()}-W${week}`
  }

  async function loadChat() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }
    setCurrentUser(session.user.id)
    currentUserRef.current = session.user.id

    // Own row via RPC: full column access to MY data only
    const { data: meRows } = await supabase.rpc('my_profile')
    const meData = meRows?.[0] || null
    setCurrentUserData(meData)

    // Match row via hardened view: no sensitive columns exist here
    const { data: matchData } = await supabase
      .from('profiles_public')
      .select('id, full_name, interests, section2_unlocked, section2_free_expires_at, display_phone')
      .eq('id', matchId)
      .single()
    setMatchUser(matchData)

    const now = new Date()
    const myAccess = meData?.section2_unlocked ||
      (meData?.section2_free_expires_at && new Date(meData.section2_free_expires_at) > now)
    const matchAccess = matchData?.section2_unlocked ||
      (matchData?.section2_free_expires_at && new Date(matchData.section2_free_expires_at) > now)
    setBothUnlocked(myAccess && matchAccess)

    // Server-side paywall: RPC returns contact info ONLY when the
    // real unlock + pairing conditions hold in the database.
    const { data: contactRows } = await supabase
      .rpc('get_match_contact', { match_user_id: matchId })
    setMatchContact(contactRows?.[0] || null)

    const msgs = await reloadMessages(session.user.id, matchId)
    setMessages(msgs)

    await supabase
      .from('messages')
      .update({ read: true })
      .eq('recipient_id', session.user.id)
      .eq('sender_id', matchId)

    const sortedIds = [session.user.id, matchId].sort()
    const { data: progress } = await supabase
      .from('section2_chat_progress')
      .select('*')
      .eq('user_id_a', sortedIds[0])
      .eq('user_id_b', sortedIds[1])
      .maybeSingle()

    let currentProgress = progress
    if (!progress) {
      const { data: newProgress } = await supabase
        .from('section2_chat_progress')
        .insert({
          user_id_a: sortedIds[0],
          user_id_b: sortedIds[1],
          questions_discussed: 0,
          last_question_sent: 0
        })
        .select()
        .single()
      currentProgress = newProgress
    }

    setS2Progress(currentProgress)
    setContactsRevealed(currentProgress?.contacts_unlocked || false)

    const weekId = getWeekId()
    const { data: engagement } = await supabase
      .from('engagement_metrics')
      .select('meetup_confirmed')
      .eq('user_id', session.user.id)
      .eq('week_id', weekId)
      .maybeSingle()
    setMeetupConfirmed(engagement?.meetup_confirmed || false)

    setLoading(false)

    // Send first question if no bot messages exist yet
    const hasBotMessages = msgs.some(m => m.is_bot)
    if (!hasBotMessages && !currentProgress?.last_question_sent) {
      setTimeout(() => {
        sendBotQuestion(1, currentProgress, session.user.id, matchId)
      }, 800)
    }

    // Realtime — only for incoming messages from match (not bot)
    const channel = supabase
      .channel(`chat-${session.user.id}-${matchId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages'
      }, async (payload) => {
        if (
          payload.new.recipient_id === currentUserRef.current &&
          !payload.new.is_bot
        ) {
          setMessages(prev => {
            const exists = prev.find(m => m.id === payload.new.id)
            if (exists) return prev
            return [...prev, payload.new]
          })
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }

  async function sendBotQuestion(questionNumber, progress, userId, recipientId) {
    if (questionNumber > section2Questions.length) return
    if (sendingBot) return
    setSendingBot(true)

    const question = section2Questions[questionNumber - 1]
    const content = `💬 Question ${questionNumber} of 20:\n\n"${question}"`
    const weekId = getWeekId()

    const { error } = await supabase.from('messages').insert({
      sender_id: userId,
      recipient_id: recipientId,
      content,
      match_week_id: weekId,
      is_bot: true
    })

    if (error) {
      console.error('Bot message error:', error)
      setSendingBot(false)
      return
    }

    // Reload all messages fresh — single source of truth
    const updated = await reloadMessages(userId, recipientId)
    setMessages(updated)

    const sortedIds = [userId, recipientId].sort()
    const shouldUnlock = questionNumber >= UNLOCK_THRESHOLD

    const { data: updatedProgress } = await supabase
      .from('section2_chat_progress')
      .update({
        last_question_sent: questionNumber,
        questions_discussed: questionNumber,
        contacts_unlocked: shouldUnlock,
        updated_at: new Date().toISOString()
      })
      .eq('user_id_a', sortedIds[0])
      .eq('user_id_b', sortedIds[1])
      .select()
      .single()

    setS2Progress(updatedProgress)
    if (shouldUnlock) setContactsRevealed(true)
    setSendingBot(false)
  }

  async function handleSend() {
    if (!newMessage.trim() || sending) return
    setSending(true)

    const weekId = getWeekId()
    const hasContact = containsContact(newMessage)

    const { data } = await supabase
      .from('messages')
      .insert({
        sender_id: currentUser,
        recipient_id: matchId,
        content: newMessage.trim(),
        match_week_id: weekId,
        has_contact_info: hasContact,
        is_bot: false
      })
      .select()
      .single()

    if (data) {
      setMessages(prev => {
        const exists = prev.find(m => m.id === data.id)
        if (exists) return prev
        return [...prev, data]
      })
    }

    setNewMessage('')

    await supabase.from('engagement_metrics').upsert({
      user_id: currentUser,
      week_id: weekId,
      messages_sent: 1
    }, { onConflict: 'user_id,week_id' })

    setSending(false)

    // Check if we should send next question
    if (s2Progress && !sendingBot) {
      const nextQ = (s2Progress.last_question_sent || 0) + 1
      const isFreeQ = nextQ <= FREE_QUESTIONS
      const lastBotIdx = messages.map(m => m.is_bot).lastIndexOf(true)
      const msgsSinceBot = lastBotIdx === -1
        ? messages.filter(m => !m.is_bot).length
        : messages.slice(lastBotIdx + 1).filter(m => !m.is_bot).length

      if ((isFreeQ || bothUnlocked) && msgsSinceBot >= 1) {
        setTimeout(() => {
          sendBotQuestion(nextQ, s2Progress, currentUser, matchId)
        }, 1000)
      }
    }
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

  function renderMessage(msg, index) {
    const isMe = msg.sender_id === currentUser
    const isBot = msg.is_bot

    if (isBot) {
      const qNum = s2Progress?.last_question_sent || 0
      const isPaywallPoint = qNum >= FREE_QUESTIONS && !bothUnlocked

      return (
        <div key={msg.id || index} className="bot-message">
          {isPaywallPoint ? (
            <div className="paywall-card">
              <p className="paywall-icon">🔒</p>
              <h3>Unlock Section 2 to continue</h3>
              <p>You have completed the 4 free questions. Both users must unlock Section 2 to continue.</p>
              <button className="paywall-btn" onClick={() => navigate('/payment')}>
                Unlock with M-Pesa
              </button>
            </div>
          ) : (
            <div className="bot-bubble">
              <span className="bot-tag">MingleMate</span>
              <p>{msg.content}</p>
            </div>
          )}
        </div>
      )
    }

    const shouldBlur = !isMe && containsContact(msg.content) && !contactsRevealed
    const displayContent = shouldBlur ? blurContactInfo(msg.content) : msg.content

    return (
      <div key={msg.id || index} className={`message ${isMe ? 'sent' : 'received'}`}>
        {shouldBlur && (
          <p className="blur-warning">⚠️ Contact info hidden until 14 questions are discussed</p>
        )}
        <p className="message-text">{displayContent}</p>
        <p className="message-time">
          {new Date(msg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    )
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
          <h3 className="chat-match-name">{matchUser?.full_name || 'Your Match'}</h3>
          <p className="chat-match-sub">
            {s2Progress ? `${s2Progress.questions_discussed || 0}/20 questions` : 'Section 2 Chat'}
          </p>
        </div>
        {!meetupConfirmed ? (
          <button className="meetup-btn" onClick={handleMeetupConfirm}>🤝 Met Up</button>
        ) : (
          <span className="meetup-confirmed">✅ Met Up!</span>
        )}
      </div>

      {s2Progress && (
        <div className="s2-progress-bar-container">
          <div
            className="s2-progress-bar-fill"
            style={{ width: `${((s2Progress.questions_discussed || 0) / 20) * 100}%` }}
          />
        </div>
      )}

      {contactsRevealed && matchUser && currentUserData && matchContact && (
        <div className="contact-reveal-card">
          <h3>🎉 Contact Details Unlocked!</h3>
          <p>You have discussed 14+ questions together.</p>
          <div className="contact-grid">
            <div className="contact-person">
              <p className="contact-name">{matchUser.full_name}</p>
              <p>📱 {matchContact.display_phone || matchContact.phone}</p>
              <p>💬 {matchContact.whatsapp_number}</p>
              <p>📧 {matchContact.email}</p>
            </div>
            <div className="contact-person">
              <p className="contact-name">You</p>
              <p>📱 {currentUserData.display_phone || currentUserData.phone}</p>
              <p>💬 {currentUserData.whatsapp_number}</p>
              <p>📧 {currentUserData.email}</p>
            </div>
          </div>
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Starting your guided conversation...</p>
          </div>
        )}
        {messages.map((msg, i) => renderMessage(msg, i))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          className="chat-input"
          placeholder="Type your answer..."
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