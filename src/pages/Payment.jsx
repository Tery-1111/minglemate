import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Payment.css'

export default function Payment() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [userId, setUserId] = useState(null)

  useEffect(() => {
    getSession()
  }, [])

  async function getSession() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate('/'); return }
    setUserId(session.user.id)
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
      // C2: only the phone is sent — amount and user identity are
      // server-derived (price constant + JWT).
      const { data, error: fnError } = await supabase.functions.invoke('initiate-payment', {
        body: { phone: formatted }
      })

      if (fnError) throw fnError

      if (data?.ResponseCode === '0') {
        setStatus('✅ Check your phone and enter your M-Pesa PIN to complete payment.')
        pollForPayment()
      } else {
        setError('Payment request failed. Please try again.')
        setLoading(false)
      }
    } catch (err) {
      setError('Could not connect to payment service. Please try again.')
      setLoading(false)
    }
  }

  async function pollForPayment() {
    let attempts = 0
    const interval = setInterval(async () => {
      attempts++
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
      }

      if (attempts >= 12) {
        clearInterval(interval)
        setStatus('Payment is taking longer than expected. Check your M-Pesa messages.')
        setLoading(false)
      }
    }, 5000)
  }

  return (
    <div className="payment-container">
      <div className="payment-card">
        <button className="payment-back" onClick={() => navigate('/section2')}>← Back</button>

        <div className="payment-icon">🔓</div>
        <h2 className="payment-title">Unlock Section 2</h2>
        <p className="payment-subtitle">
          Get deeper matches with 20 reflective questions.
        </p>

        <div className="payment-price">
          <span className="price-amount">KES 99</span>
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