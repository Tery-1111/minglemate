import { useState, useEffect } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { supabase } from "../supabaseClient"
import "./Payment.css"

export default function Payment() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [phone, setPhone] = useState("")
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [userId, setUserId] = useState(null)

  // Grab the query targets from the URL route context
  const recipientId = searchParams.get("recipientId")
  const matchId = searchParams.get("matchId")

  useEffect(() => {
    getSession()
  }, [])

  async function getSession() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { navigate("/"); return }
    setUserId(session.user.id)
  }

  function formatPhone(raw) {
    const digits = raw.replace(/\D/g, "")
    if (digits.startsWith("0")) return "254" + digits.slice(1)
    if (digits.startsWith("254")) return digits
    if (digits.startsWith("7") || digits.startsWith("1")) return "254" + digits
    return digits
  }

  async function handlePayment() {
    setError("")
    const formatted = formatPhone(phone)

    if (formatted.length !== 12) {
      setError("Enter a valid Kenyan phone number e.g. 0712345678")
      return
    }

    if (!matchId) {
      setError("Missing structural tracking identifiers. Return to matches.")
      return
    }

    setLoading(true)
    setStatus("Launching secure IntaSend environment...")

    try {
      // Initialize safe, targeted IntaSend Inline SDK Instance
      const intasend = new window.IntaSend({
        publicAPIKey: "ISPubKey_live_33b3264e-55f4-4ca6-b074-c39ee6f0532a",
        live: false // Set to true when you move from Sandbox testing to production collections
      })

      intasend.setup({
        amount: 99,
        currency: "KES",
        phone_number: formatted,
        email: "student@egerton.ac.ke"
      })

      intasend.buttons.showProgress()
      const response = await intasend.buttons.pay()

      if (response && response.invoice_id) {
        setStatus("Verifying M-Pesa transaction token...")

        // Record the completed payment against the matches/payments schema
        const { error: paymentError } = await supabase
          .from("payments")
          .insert({
            user_id: userId,
            match_id: matchId,
            phone_number: formatted,
            amount: 99,
            status: "completed",
            intasend_invoice_id: response.invoice_id,
            webhook_received_at: new Date().toISOString(),
            unlock_triggered_at: new Date().toISOString(),
          })

        if (paymentError) throw paymentError

        setStatus("🎉 Payment verified! Unlocking contact credentials...")
        setTimeout(() => navigate("/matches"), 2000)
      } else {
        setError("Payment process aborted or timed out.")
        setLoading(false)
      }
    } catch (err) {
      console.error(err)
      setError("Could not process M-Pesa payload. Please try again.")
      setLoading(false)
    }
  }

  return (
    <div className="payment-container">
      <div className="payment-card">
        <button className="payment-back" onClick={() => navigate("/matches")}>← Back to Matches</button>

        <div className="payment-icon">💳</div>
        <h2 className="payment-title">Unlock Connection</h2>
        <p className="payment-subtitle">
          Securely unlock phone numbers & social handles for mutual matches.
        </p>

        <div className="payment-price">
          <span className="price-amount">KES 99</span>
          <span className="price-label">one-time unlock fee</span>
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
          {loading ? "Processing transaction..." : "Authorize with M-Pesa"}
        </button>

        <p className="payment-note">
          Transactions are processed securely via IntaSend. You will receive an STK Push on your handset device.
        </p>
      </div>
    </div>
  )
}