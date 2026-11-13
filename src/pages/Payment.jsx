import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { signPhotoUrl } from '../lib/photoUrls'
import './Payment.css'

// CONNECT PAYMENT: one screen serving every paid action. The
// SERVER decides the price — this copy is display-only.
// Section 2 is deliberately absent: it is free (D1/D5), so there is no
// purchase to offer. Only Connect and Force Connect remain.
const PURPOSES = {
  force_connect: { title: 'Force Connect', sub: 'Creates your Qrashe match instantly after payment.', price: 'KSh 80', what: 'They are notified and a Qrashe match is created. They cannot decline.', back: '/discover', eyebrow: 'Force Connect' },
  connect_tier1: { title: 'Connect — Tier 1', sub: 'See how to reach them, on their terms.', price: 'KSh 70', what: 'Their chosen contact details are revealed in your conversation.', back: '/matches', eyebrow: 'Connect · Tier 1' },
  connect_tier2: { title: 'Connect — Tier 2', sub: 'See how to reach them, on their terms.', price: 'KSh 50', what: 'Their chosen contact details are revealed in your conversation.', back: '/matches', eyebrow: 'Connect · Tier 2' },
  connect_qrashe: { title: 'Connect — Qrashe', sub: 'See how to reach them, on their terms.', price: 'KSh 50', what: 'Their chosen contact details are revealed in your conversation.', back: '/matches', eyebrow: 'Connect · Qrashe' },
}

export default function Payment() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  // Payment state machine (loading-spec §22): idle → initiating →
  // processing (awaiting PIN) → success | pending | failed. 'pending'
  // is NOT success — it means the STK push timed out client-side but
  // the payment may still complete server-side (recovery). 'failed'
  // is a definitive negative result. Both preserve context and offer
  // the correct next action without re-charging blind.
  const [phase, setPhase] = useState('idle') // idle | pushing | success | pending | failed
  const [error, setError] = useState('')
  const [userId, setUserId] = useState(null)
  const [awaitingPin, setAwaitingPin] = useState(false)
  const [recipient, setRecipient] = useState(null)

  const purpose = searchParams.get('purpose') || ''
  const recipientId = searchParams.get('recipientId')
  const gift = searchParams.get('gift') === 'true'
  const meta = PURPOSES[purpose] || null

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

    // TRUST: show who this payment is about (Connect / Force Connect).
    // Photo is best-effort — RLS may hide it, the name is what matters.
    if (recipientId) {
      const { data: person } = await supabase
        .from('users')
        .select('full_name')
        .eq('id', recipientId)
        .maybeSingle()
      if (person?.full_name) {
        const { data: photo } = await supabase
          .from('photos')
          .select('photo_url')
          .eq('user_id', recipientId)
          .eq('photo_type', 'facial')
          .limit(1)
          .maybeSingle()
        setRecipient({ name: person.full_name, photo: await signPhotoUrl(photo?.photo_url) })
      }
    }
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
    setPhase('pushing')

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
        setStatus('Check your phone and enter your M-Pesa PIN to complete payment.')
        setAwaitingPin(true)
        setPhase('pushing')
        pollForPayment()
      } else {
        setError(data?.errorMessage || data?.error || 'Payment request failed. Please try again.')
        setPhase('idle')
        setLoading(false)
      }
    } catch (err) {
      setError('Could not reach the payment service. Check your connection and try again.')
      setPhase('idle')
      setLoading(false)
    }
  }

  async function pollForPayment() {
    let attempts = 0
    const interval = setInterval(async () => {
      attempts++

      // Connect / Force Connect: success is visible via the pairing /
      // unlock tables the server writes after a verified payment. There is
      // no Section 2 branch any more — that purchase does not exist.
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
            setStatus('Force Connect complete — your Qrashe match is ready.')
            setPhase('success')
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
            setStatus('Connected — contact details are now available.')
            setPhase('success')
            setLoading(false)
            setTimeout(() => navigate(`/match/${recipientId}`), 2000)
            return
          }
        }
      }

      if (attempts >= 12) {
        clearInterval(interval)
        // PENDING ≠ SUCCESS: the push wasn't confirmed in the polling
        // window. The awaitingPin watcher below keeps watching and
        // routes onward if the backend completes it — so the user is
        // never stranded and never double-charged by re-initiating.
        setStatus('Payment is still pending. Check your M-Pesa messages — we keep watching and will route you onward if it completes.')
        setPhase('pending')
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
    if (recipientId) {
      if (purpose === 'force_connect') {
        const { data: match } = await supabase
          .from('matches')
          .select('id')
          .or(`and(user_a_id.eq.${session.user.id},user_b_id.eq.${recipientId}),and(user_a_id.eq.${recipientId},user_b_id.eq.${session.user.id})`)
          .maybeSingle()
        if (match) {
          setAwaitingPin(false)
          setStatus('Force Connect complete — your Qrashe match is ready.')
          setPhase('success')
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
          setStatus('Connected — contact details are now available.')
          setPhase('success')
          setLoading(false)
          setTimeout(() => navigate(`/match/${recipientId}`), 1500)
          return true
        }
      }
    }
    return false
  }

  // Section 2 is free (D1/D5): a stale ?purpose=section2 link must not
  // render a purchase screen. All hooks above have already run.
  if (!meta) {
    return (
      <div className="payment-container">
        <div className="payment-card">
          <button className="payment-back" onClick={() => navigate('/matches')}>← Back</button>
          <h2 className="payment-title">Nothing to pay for</h2>
          <p className="payment-subtitle">
            Section 2 and its twenty questions are free. Contact details are
            unlocked with Connect from one of your matches.
          </p>
          <button className="pay-btn" onClick={() => navigate('/section2')}>
            Go to Section 2
          </button>
        </div>
      </div>
    )
  }

  // ---------- States: pushing / success / pending / failed ----------
  if (phase === 'pushing' || phase === 'success' || phase === 'pending' || phase === 'failed') {
    return (
      <div className="payment-container">
        <div className="payment-card">
          <button className="payment-back" onClick={() => navigate(meta.back)}>← Back</button>

          {phase === 'pushing' && (
            <div className="pay-state" role="status">
              <div className="pay-pulse" aria-hidden="true"><span /></div>
              <h2 className="pay-state-title">Check your phone</h2>
              <p className="pay-state-sub">
                We sent an M-Pesa request for <strong>{meta.price}</strong>.
                Enter your PIN to approve it.
              </p>
              {status && <p className="pay-state-note">{status}</p>}
              <div className="pay-receipt">
                {recipient && (
                  <div className="pay-receipt-row">
                    <span>For</span>
                    <strong>{recipient.name}</strong>
                  </div>
                )}
                <div className="pay-receipt-row">
                  <span>Amount</span>
                  <strong>{meta.price}</strong>
                </div>
                <div className="pay-receipt-row">
                  <span>Paying with</span>
                  <strong>M-Pesa{phone ? ` · ${formatPhone(phone)}` : ''}</strong>
                </div>
              </div>
              <p className="pay-note">
                Left this screen by accident? Come back — we detect the
                payment automatically and won't charge you twice.
              </p>
            </div>
          )}

          {phase === 'success' && (
            <div className="pay-state pay-state-success" role="status">
              <div className="pay-check" aria-hidden="true">✓</div>
              <h2 className="pay-state-title">Payment confirmed</h2>
              <p className="pay-state-sub">{status}</p>
              <p className="pay-state-note">Taking you there…</p>
            </div>
          )}

          {phase === 'pending' && (
            <div className="pay-state pay-state-pending" role="status">
              <div className="pay-waiticon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 3" />
                </svg>
              </div>
              <h2 className="pay-state-title">Payment pending</h2>
              <p className="pay-state-sub">{status}</p>
              {/* Recovery actions: wait (watcher keeps running) or
                  start over — never an automatic re-charge. */}
              <button
                className="pay-btn"
                onClick={() => { setPhase('idle'); setStatus(''); setLoading(false); setAwaitingPin(false) }}
              >
                Start a new payment
              </button>
            </div>
          )}

          {phase === 'failed' && (
            <div className="pay-state pay-state-failed" role="alert">
              <div className="pay-waiticon pay-failed-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M9 9l6 6M15 9l-6 6" />
                </svg>
              </div>
              <h2 className="pay-state-title">Payment failed</h2>
              <p className="pay-state-sub">{status || 'The payment did not go through. Nothing has been unlocked.'}</p>
              <p className="pay-state-note">
                Your request: <strong>{meta.title}</strong> · {meta.price} — nothing was charged unless M-Pesa confirms otherwise.
              </p>
              <button className="pay-btn" onClick={() => { setPhase('idle'); setStatus(''); setLoading(false) }}>
                Try payment again
              </button>
              <button className="pay-cancel-link" onClick={() => navigate(meta.back)}>
                Back to Matches
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---------- Default: purchase summary + form ----------
  return (
    <div className="payment-container">
      <div className="payment-card">
        <button className="payment-back" onClick={() => navigate(meta.back)}>← Back</button>

        <p className="pay-eyebrow">{meta.eyebrow}</p>
        <h2 className="payment-title">{meta.title}</h2>
        <p className="payment-subtitle">{meta.sub}</p>

        {recipient && (
          <div className="pay-recipient">
            {recipient.photo ? (
              <img src={recipient.photo} alt="" className="pay-recipient-photo" />
            ) : (
              <span className="pay-recipient-photo pay-recipient-initial" aria-hidden="true">
                {recipient.name.charAt(0)}
              </span>
            )}
            <div>
              <span className="pay-recipient-name">{recipient.name}</span>
              <span className="pay-recipient-sub">This payment is for your connection with {recipient.name.split(' ')[0]}.</span>
            </div>
          </div>
        )}

        <div className="pay-receipt" aria-label="Purchase summary">
          <div className="pay-receipt-row pay-receipt-total">
            <span>You pay</span>
            <strong className="pay-amount">{meta.price}</strong>
          </div>
          <div className="pay-receipt-row">
            <span>You get</span>
            <strong>{meta.what}</strong>
          </div>
          <div className="pay-receipt-row">
            <span>Charged</span>
            <strong>Once · via M-Pesa</strong>
          </div>
        </div>

        <label className="pay-label" htmlFor="pay-phone">M-Pesa phone number</label>
        <input
          id="pay-phone"
          className={`payment-input${error ? ' has-error' : ''}`}
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="0712 345 678"
          value={phone}
          onChange={e => { setPhone(e.target.value); if (error) setError('') }}
          disabled={loading}
        />

        {error && <p className="payment-error" role="alert">{error}</p>}

        <button
          className="pay-btn"
          onClick={handlePayment}
          disabled={loading || !phone}
        >
          {loading ? 'Sending request…' : `Pay ${meta.price} with M-Pesa`}
        </button>

        <p className="pay-note">
          You'll get an M-Pesa prompt — approve it with your PIN. The price is
          set by MingleMate and can't be altered. Payment is verified before
          anything is unlocked.
        </p>
      </div>
    </div>
  )
}
