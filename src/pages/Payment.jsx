import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Payment.css'

// CONNECT PAYMENT: one screen serving every paid action. The
// SERVER decides the price — this copy is display-only.
const PURPOSES = {
  section2: { title: 'Unlock Section 2', sub: 'Get deeper matches with 20 reflective questions.', price: 'KES 200', back: '/section2' },
  force_connect: { title: 'Force Connect', sub: 'Creates your Qrashe match instantly after payment.', price: 'KSh 80', back: '/discover' },
  connect_tier1: { title: 'Connect — Tier 1', sub: 'Unlock contact details according to their sharing choices.', price: 'KSh 70', back: '/matches' },
  connect_tier2: { title: 'Connect — Tier 2', sub: 'Unlock contact details according to their sharing choices.', price: 'KSh 50', back: '/matches' },
  connect_qrashe: { title: 'Connect — Qrashe', sub: 'Unlock contact details according to their sharing choices.', price: 'KSh 50', back: '/matches' },
}

export default function Payment() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [userId, setUserId] = useState(null)
  const [awaitingPin, setAwaitingPin] = useState(false)

  const purpose = searchParams.get('purpose') || 'section2'
  const recipientId = searchParams.get('recipientId')
  const gift = searchParams.get('gift') === 'true'
  const meta = PURPOSES[purpose] || PURPOSES.section2

  useEffect(() => {
    getSession()
  }, [])

  async function getSession() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }
    setUserId(session.user.id)
    // PAYMENT RECOVERY: after a refresh mid-payment the intent is
    // pending server-side with no client-readable record (RLS: no
    // policies on payment_intents). We can't tell "fresh visit" from
    // "mid-push" here, so we do NOT auto-trigger anything — the user
    // re-initiates if needed (the edge function returns an
    // already-pending guard). Meanwhile the awaitingPin watcher below
    // routes them onward the moment the backend completes, so a
    // refresh never strands them on a stale screen.
    const alreadyPaid = await checkPaidState(true)
    if (alreadyPaid) setAwaitingPin(false)
  }

  function formatPhone(raw) {
    const digits = raw.replace(/\D/g, '')
    if (digits.startsWith('0')) return '254' + digits.slice(1)
    if (digits.startsWith('254')) return digits
    if (digits.startsWith('7') || digits.startsWith('1')) return '254' + digits
    return digits
  }

  async function handlePayment() {
    setError('')
    const formatted = formatPhone(phone)

    if (formatted.length !== 12) {
      setError('Enter a valid Kenyan phone number e.g. 0712345678')
      return
    }

    setLoading(true)
    setStatus('Sending payment request to your phone...')

    try {
      // C2: the client sends only phone + which product it is buying.
      // Prices, identity, pairing and amounts are enforced server-side.
      const { data, error: fnError } = await supabase.functions.invoke('initiate-payment', {
        body: {
          phone: formatted,
          purpose,
          recipientId: recipientId || undefined
        }
      })

      if (fnError) throw fnError

      if (data?.ResponseCode === '0') {
        setStatus('✅ Check your phone and enter your M-Pesa PIN to complete payment.')
        setAwaitingPin(true)
        pollForPayment()
      } else {
        setError(data?.errorMessage || data?.error || 'Payment request failed. Please try again.')
        setLoading(false)
      }
    } catch (err) {
      setError(err.message || 'Could not connect to payment service. Please try again.')
      setLoading(false)
    }
  }

  async function pollForPayment() {
    let attempts = 0
    const interval = setInterval(async () => {
      attempts++

      if (purpose === 'section2') {
        const { data: user } = await supabase
          .from('users')
          .select('section2_unlocked')
          .eq('id', userId)
          .single()
        if (user?.section2_unlocked) {
          clearInterval(interval)
          setStatus('🎉 Payment successful! Section 2 is now unlocked.')
          setLoading(false)
          setTimeout(() => navigate('/section2'), 2000)
          return
        }
      } else {
        // Connect / Force Connect: success is visible via the pairing/
        // unlock tables the server writes after the verified payment.
        const { data: { session } } = await supabase.auth.getSession()
        if (session && recipientId) {
          if (purpose === 'force_connect') {
            const { data: match } = await supabase
              .from('matches')
              .select('id')
              .or(`and(user_a_id.eq.${session.user.id},user_b_id.eq.${recipientId}),and(user_a_id.eq.${recipientId},user_b_id.eq.${session.user.id})`)
              .maybeSingle()
            if (match) {
              clearInterval(interval)
              setStatus('⚡ Force Connect complete! Your Qrashe match is ready.')
              setLoading(false)
              setTimeout(() => navigate('/matches'), 2000)
              return
            }
          } else {
            const { data: unlock } = await supabase
              .from('connect_unlocks')
              .select('id')
              .eq('buyer_id', session.user.id)
              .eq('seller_id', recipientId)
              .maybeSingle()
            if (unlock) {
              clearInterval(interval)
              setStatus('🎉 Connected! Contact details are now available.')
              setLoading(false)
              setTimeout(() => navigate(`/match/${recipientId}`), 2000)
              return
            }
          }
        }
      }

      if (attempts >= 12) {
        clearInterval(interval)
        setStatus('Payment is taking longer than expected. Check your M-Pesa messages.')
        setLoading(false)
      }
    }, 5000)
  }

  // PAYMENT RECOVERY: refresh during an STK push leaves the intent
  // pending server-side. There is no client-visible intent record
  // (RLS: zero policies on payment_intents), so we can't auto-detect
  // the pending push — but we CAN watch for its success and route
  // the user onward instead of silently re-charging them.
  useEffect(() => {
    if (!awaitingPin) return
    const watch = setInterval(() => checkPaidState(true), 5000)
    return () => clearInterval(watch)
  }, [awaitingPin, purpose, recipientId, userId])

  async function checkPaidState(silent) {
    if (!userId) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    if (purpose === 'section2') {
      const { data: user } = await supabase
        .from('users')
        .select('section2_unlocked')
        .eq('id', session.user.id)
        .single()
      if (user?.section2_unlocked) {
        setAwaitingPin(false)
        setStatus('🎉 Payment successful! Section 2 is now unlocked.')
        setLoading(false)
        setTimeout(() => navigate('/section2'), 1500)
        return true
      }
    } else if (recipientId) {
      if (purpose === 'force_connect') {
        const { data: match } = await supabase
          .from('matches')
          .select('id')
          .or(`and(user_a_id.eq.${session.user.id},user_b_id.eq.${recipientId}),and(user_a_id.eq.${recipientId},user_b_id.eq.${session.user.id})`)
          .maybeSingle()
        if (match) {
          setAwaitingPin(false)
          setStatus('⚡ Force Connect complete! Your Qrashe match is ready.')
          setLoading(false)
          setTimeout(() => navigate('/matches'), 1500)
          return true
        }
      } else {
        const { data: unlock } = await supabase
          .from('connect_unlocks')
          .select('id')
          .eq('buyer_id', session.user.id)
          .eq('seller_id', recipientId)
          .maybeSingle()
        if (unlock) {
          setAwaitingPin(false)
          setStatus('🎉 Connected! Contact details are now available.')
          setLoading(false)
          setTimeout(() => navigate(`/match/${recipientId}`), 1500)
          return true
        }
      }
    }
    return false
  }

  return (
    <div className="payment-container">
      <div className="payment-card">
        <button className="payment-back" onClick={() => navigate(meta.back)}>← Back</button>

        <div className="payment-icon">{purpose === 'section2' ? '🔓' : purpose === 'force_connect' ? '⚡' : '🤝'}</div>
        <h2 className="payment-title">{meta.title}</h2>
        <p className="payment-subtitle">{meta.sub}</p>

        <div className="payment-price">
          <span className="price-amount">{meta.price}</span>
          <span className="price-label">one-time payment</span>
        </div>

        <input
          className="payment-input"
          type="tel"
          placeholder="M-Pesa number e.g. 0712345678"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          disabled={loading}
        />

        {error && <p className="payment-error">{error}</p>}
        {status && <p className="payment-status">{status}</p>}

        <button
          className="payment-btn"
          onClick={handlePayment}
          disabled={loading || !phone}
        >
          {loading ? 'Processing...' : 'Pay with M-Pesa'}
        </button>

        <p className="payment-note">
          You will receive an M-Pesa prompt on your phone. Enter your PIN to complete.
        </p>
      </div>
    </div>
  )
}
