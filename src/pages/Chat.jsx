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
  // PERF: unbounded history grows forever per match; load the most
  // recent 200 (fetched desc, then reversed for display order).
  const { data } = await supabase
    .from('messages')
    .select('*')
    .or(`and(sender_id.eq.${userId},recipient_id.eq.${matchId}),and(sender_id.eq.${matchId},recipient_id.eq.${userId})`)
    .order('sent_at', { ascending: false })
    .limit(200)
  return (data || []).reverse()
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
  const [unmatched, setUnmatched] = useState(false)
  const [unlockInfo, setUnlockInfo] = useState(null)
  const [meetupConfirmed, setMeetupConfirmed] = useState(false)
  const [sendError, setSendError] = useState('')
  const [s2Progress, setS2Progress] = useState(null)
  const [bothUnlocked, setBothUnlocked] = useState(false)
  const [contactsRevealed, setContactsRevealed] = useState(false)
  const [matchContact, setMatchContact] = useState(null)
  const [sendingBot, setSendingBot] = useState(false)
  const [isBlocked, setIsBlocked] = useState(false)
  const [blockedByMe, setBlockedByMe] = useState(false)
  const [blockedByThem, setBlockedByThem] = useState(false)
  // Conversation lifecycle: active → locked (paid connect) → archived
  // (7 days after lock; messages hidden by RLS but rows remain).
  const [conversationStatus, setConversationStatus] = useState('active')
  const [conversationArchived, setConversationArchived] = useState(false)
  const messagesEndRef = useRef(null)
  const currentUserRef = useRef(null)
  // Realtime channel must be cleaned up by the effect itself. Returning a
  // cleanup from async loadChat() is swallowed by React — channels would
  // leak on every conversation switch.
  const channelRef = useRef(null)

  useEffect(() => {
    loadChat()
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
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
      .select('id, full_name, interests, section2_unlocked, section2_free_expires_at')
      .eq('id', matchId)
      .single()
    setMatchUser(matchData)

    // Safety: does a block exist between me and this match (either
    // direction)? Either side blocks the whole conversation.
    const { data: blockRows } = await supabase
      .from('user_blocks')
      .select('blocker_id, blocked_id')
      .or(`and(blocker_id.eq.${session.user.id},blocked_id.eq.${matchId}),and(blocker_id.eq.${matchId},blocked_id.eq.${session.user.id})`)
    setBlockedByMe(blockRows?.some(b => b.blocker_id === session.user.id) || false)
    setBlockedByThem(blockRows?.some(b => b.blocker_id === matchId) || false)

    // Lifecycle row for this pair (stored ordered: a=least, b=greatest).
    // Check the canonical orientation first — querying both arms of an
    // ordered unique pair is unnecessary and error-prone.
    const [pa, pb] = [session.user.id, matchId].sort()
    const { data: convo } = await supabase
      .from('conversations')
      .select('status, locked_at')
      .eq('user_a_id', pa)
      .eq('user_b_id', pb)
      .maybeSingle()
    const status = convo?.status || 'active'
    setConversationStatus(status)
    setUnmatched(status === 'unmatched')
    setConversationArchived(
      status === 'locked' && convo?.locked_at &&
      new Date(convo.locked_at) < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    )

    // Paid-unlock state drives the in-chat Connect CTA (Path A):
    // before Connect, offer "Connect with [Name]" below the conversation.
    const { data: unlockRow } = await supabase
      .from('connect_unlocks')
      .select('id, tier')
      .eq('buyer_id', session.user.id)
      .eq('seller_id', matchId)
      .maybeSingle()
    setUnlockInfo(unlockRow || null)

    const now = new Date()
    const myAccess = meData?.section2_unlocked ||
      (meData?.section2_free_expires_at && new Date(meData.section2_free_expires_at) > now)
    const matchAccess = matchData?.section2_unlocked ||
      (matchData?.section2_free_expires_at && new Date(matchData.section2_free_expires_at) > now)
    setBothUnlocked(myAccess && matchAccess)

    // Server-side contact reveal: paid snapshot first, then the
    // guided-conversation free path. The RPC enforces pairing +
    // unlock in the database — the client can never fake this.
    const { data: contactRows } = await supabase
      .rpc('get_unlocked_contacts', { other_user_id: matchId })
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
    setContactsRevealed(currentProgress?.contacts_unlocked || !!contactRows?.[0])

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

    // Realtime — only for incoming messages from match (not bot).
    // Stored in a ref; the effect above owns the cleanup.
    channelRef.current = supabase
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
  }

  async function sendBotQuestion(questionNumber, progress, userId, recipientId) {
    if (questionNumber > section2Questions.length) return
    if (sendingBot) return
    setSendingBot(true)

    const question = section2Questions[questionNumber - 1]
    const content = `Question ${questionNumber} of 20:\n\n"${question}"`
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

  async function handleBlock() {
    if (blockedByMe) {
      // Unblock
      const { error } = await supabase
        .from('user_blocks')
        .delete()
        .eq('blocker_id', currentUser)
        .eq('blocked_id', matchId)
      if (!error) setBlockedByMe(false)
    } else {
      // Block — DB policy restricts to blocker=me; messages policy
      // immediately stops either side from sending.
      const { error } = await supabase
        .from('user_blocks')
        .insert({ blocker_id: currentUser, blocked_id: matchId })
      if (!error) setBlockedByMe(true)
    }
  }

  // Report: lightweight moderation entry (reports table, RLS-insert own).
  async function handleReport() {
    const reason = prompt('What is the problem with this conversation?')
    if (!reason) return
    const { error } = await supabase
      .from('reports')
      .insert({ reporter_id: currentUser, reported_id: matchId, reason })
    if (!error) alert('Report sent. Thank you.')
  }

  // Unmatch: pre-connect only (RPC enforces; raises after Connect).
  async function handleUnmatch() {
    if (!confirm('Unmatch? This ends the conversation.')) return
    const { error } = await supabase
      .rpc('unmatch_conversation', { other_user_id: matchId })
    if (error) {
      alert(error.message || 'Could not unmatch.')
    } else {
      setUnmatched(true)
    }
  }

  async function handleSend() {
    if (!newMessage.trim() || sending) return
    setSending(true)

    const weekId = getWeekId()
    const text = newMessage.trim()
    const hasContact = containsContact(text)

    // OPTIMISTIC SEND (safe for messages): render the bubble instantly
    // as `pending`, reconcile with the insert. On failure the bubble
    // flips to `failed` with a Retry action — never silently dropped,
    // never shown as delivered.
    const clientId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const optimistic = {
      id: clientId,
      sender_id: currentUser,
      recipient_id: matchId,
      content: text,
      sent_at: new Date().toISOString(),
      is_bot: false,
      _pending: true,
    }
    setMessages(prev => [...prev, optimistic])
    setNewMessage('')
    setSendError('')

    const { data, error: sendError } = await supabase
      .from('messages')
      .insert({
        sender_id: currentUser,
        recipient_id: matchId,
        content: text,
        match_week_id: weekId,
        has_contact_info: hasContact,
        is_bot: false
      })
      .select()
      .single()

    // Reconcile: replace the optimistic bubble with the real row.
    setMessages(prev => {
      const withoutTmp = prev.filter(m => m.id !== clientId)
      if (sendError) {
        // Keep it visible as failed — user can retry or dismiss.
        return [...withoutTmp, { ...optimistic, _pending: false, _failed: true }]
      }
      if (!data) return withoutTmp
      const exists = withoutTmp.find(m => m.id === data.id)
      if (exists) return withoutTmp
      return [...withoutTmp, data]
    })

    // Database-side rate limit (messages_rate_limit trigger) — the
    // limit is enforced for every insert path, not just this UI.
    if (sendError) {
      setSendError(
        sendError.message === 'RATE_LIMITED'
          ? 'You are sending messages too quickly. Please take a short break.'
          : ''
      )
      setSending(false)
      return
    }

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

  async function retryMessage(failedMsg) {
    // Retry a failed send through the same optimistic path, but
    // reusing the original text (it was never lost).
    setMessages(prev => prev.filter(m => m.id !== failedMsg.id))
    setNewMessage(failedMsg.content)
  }

  function discardMessage(failedMsg) {
    setMessages(prev => prev.filter(m => m.id !== failedMsg.id))
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
              <p className="paywall-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
              </p>
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

    // OPTIMISTIC RECONCILIATION VISIBLE: pending bubbles show "Sending…"
    // in the timestamp slot; failed ones show an inline Retry/Discard.
    // These states ride the same bubble so the text never moves.
    const stateNote = msg._failed
      ? 'Not sent'
      : msg._pending
        ? 'Sending…'
        : null

    return (
      <div key={msg.id || index} className={`message msg-in ${isMe ? 'sent' : 'received'}`}>
        {shouldBlur && (
          <p className="blur-warning">⚠️ Contact info hidden until 14 questions are discussed</p>
        )}
        <p className="message-text">{displayContent}</p>
        {stateNote ? (
          <span className={`message-state${msg._failed ? ' message-state-failed' : ''}`}>
            {stateNote}
            {msg._failed && (
              <>
                <button className="message-retry" onClick={() => retryMessage(msg)}>Retry</button>
                <button className="message-retry message-retry-dim" onClick={() => discardMessage(msg)}>Discard</button>
              </>
            )}
          </span>
        ) : (
          <p className="message-time">
            {new Date(msg.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>
    )
  }

  if (loading) {
    // CONVERSATION-SHAPED LOADING (loading-spec §16): header, question
    // block and message-row skeletons in the eventual layout — never a
    // bare "Loading messages...". Pure CSS, no extra requests.
    return (
      <div className="chat-container" aria-busy="true">
        <div className="chat-header">
          <div className="skeleton chat-sk-back" aria-hidden="true" />
          <div className="chat-match-info">
            <span className="skeleton chat-sk-name" aria-hidden="true" />
            <span className="skeleton chat-sk-sub" aria-hidden="true" />
          </div>
        </div>
        <div className="skeleton chat-sk-progress" aria-hidden="true" />
        <div className="chat-messages">
          <div className="bot-message" aria-hidden="true">
            <div className="skeleton chat-sk-bot" />
          </div>
          <div className="message sent" aria-hidden="true">
            <div className="skeleton chat-sk-msg-r" />
          </div>
          <div className="message received" aria-hidden="true">
            <div className="skeleton chat-sk-msg-l" />
          </div>
        </div>
        <div className="chat-input-area">
          <div className="skeleton chat-sk-input" aria-hidden="true" />
          <div className="skeleton chat-sk-send" aria-hidden="true" />
        </div>
      </div>
    )
  }

  return (
    <div className="chat-container">
      <div className="chat-header">
        <button className="chat-back" onClick={() => navigate('/messages')}>←</button>
        <div className="chat-match-info">
          <h3 className="chat-match-name">{matchUser?.full_name || 'Your Match'}</h3>
          <p className="chat-match-sub">
            {s2Progress ? `${s2Progress.questions_discussed || 0}/20 questions` : 'Guided conversation'}
          </p>
        </div>
        <div className="chat-header-actions">
          {!meetupConfirmed && !blockedByMe && !blockedByThem && conversationStatus === 'active' && (
            <button className="meetup-btn" onClick={handleMeetupConfirm}>Met Up</button>
          )}
          {meetupConfirmed && <span className="meetup-confirmed">Met Up ✓</span>}
          <button className="meetup-btn" onClick={handleBlock} title={blockedByMe ? 'Unblock' : 'Block'}>
            {blockedByMe ? 'Unblock' : 'Block'}
          </button>
          <button className="meetup-btn" onClick={handleReport} title="Report">🚩</button>
          {!unmatched && !blockedByMe && !blockedByThem && conversationStatus === 'active' && (
            <button className="meetup-btn" onClick={handleUnmatch} title="Unmatch">Unmatch</button>
          )}
        </div>
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
          <h3>Contact Details Unlocked</h3>
          <p>You have discussed 14+ questions together.</p>
          <div className="contact-grid">
            <div className="contact-person">
              <p className="contact-name">{matchUser.full_name}</p>
              {matchContact.phone && <p>Phone · {matchContact.phone}</p>}
              {matchContact.whatsapp_number && <p>WhatsApp · {matchContact.whatsapp_number}</p>}
              {matchContact.email && <p>Email · {matchContact.email}</p>}
              {matchContact.social_instagram && <p>Instagram · @{matchContact.social_instagram}</p>}
              {matchContact.social_x && <p>X · @{matchContact.social_x}</p>}
              {matchContact.social_tiktok && <p>TikTok · @{matchContact.social_tiktok}</p>}
            </div>
            <div className="contact-person">
              <p className="contact-name">You</p>
              <p>Phone · {currentUserData.display_phone || currentUserData.phone}</p>
              <p>WhatsApp · {currentUserData.whatsapp_number}</p>
              <p>Email · {currentUserData.email}</p>
            </div>
          </div>
        </div>
      )}

      {blockedByThem && (
        <div className="chat-blocked-notice">
          Conversation unavailable.
        </div>
      )}

      {conversationArchived && (
        <div className="chat-blocked-notice">
          This conversation is archived. History is read-only and no new messages can be sent.
        </div>
      )}
      {!conversationArchived && conversationStatus === 'locked' && (
        <div className="chat-blocked-notice">
          Conversation locked after Connect — continue using the revealed contact details.
        </div>
      )}
      {!unlockInfo && conversationStatus === 'active' && matchUser && (
        <button
          className="chat-connect-cta"
          onClick={() => navigate(`/match/${matchId}`)}
        >
          Connect with {matchUser.full_name.split(' ')[0]} →
        </button>
      )}

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>
              {sendingBot
                ? 'Preparing your first question…'
                : "Waiting for your match to join the conversation — they haven't responded yet."}
            </p>
          </div>
        )}
        {messages.map((msg, i) => renderMessage(msg, i))}
        {sendingBot && messages.length > 0 && (
          <div className="bot-message">
            <div className="bot-bubble bot-typing" aria-live="polite">
              <span className="bot-tag">MingleMate</span>
              <p>Thinking of the next question…</p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {blockedByMe ? (
        <div className="chat-input-area chat-input-blocked">
          <span>You blocked this match.</span>
          <button className="chat-unblock-btn" onClick={handleBlock}>Unblock</button>
        </div>
      ) : blockedByThem ? (
        <div className="chat-input-area chat-input-blocked">
          <span>Messaging is unavailable.</span>
        </div>
      ) : conversationStatus !== 'active' ? (
        <div className="chat-input-area chat-input-blocked">
          <span>
            {conversationStatus === 'locked'
              ? 'Conversation locked — use the revealed contact details.'
              : 'This match has ended.'}
          </span>
        </div>
      ) : (
      <div className="chat-input-area">
        {sendError && (
          <div className="chat-error" role="alert">{sendError}</div>
        )}
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
      )}
    </div>
  )
}