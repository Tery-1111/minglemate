import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import Turnstile from '../components/Turnstile'
import './Login.css'

// "Forgot password?" — asks for an email and sends the Supabase reset
// email (which contains a confirmation LINK, per the default template).
// Anti-enumeration: whether or not the address has an account, the same
// confirmation is shown and error.message is never surfaced (one generic
// message, like Login). Rate-limit aware: the submit button is disabled
// while a request is in flight, exactly like Login's loading pattern.
export default function ForgotPassword() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [captchaToken, setCaptchaToken] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return

    setLoading(true)
    setError('')

    // Same Turnstile pattern Login/Signup use (options.captchaToken).
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email,
      { captchaToken }
    )

    setLoading(false)

    if (resetError) {
      // Generic only — never resetError.message (could confirm which
      // emails exist / leak rate-limit internals).
      setError("Couldn't send a reset email. Please try again shortly.")
      return
    }

    // Success: show the generic confirmation (same anti-enumeration
    // principle as signup — never reveal whether the email exists).
    setSent(true)
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <h2 className="login-title">Reset Password</h2>

        {sent ? (
          <>
            <p className="login-subtitle">
              If an account exists for this email, a reset link has been sent.
            </p>
            <p className="login-subtitle">Check your inbox to set a new password.</p>
            <button
              type="button"
              className="login-btn"
              onClick={() => navigate('/login')}
            >
              Back to Log In
            </button>
          </>
        ) : (
          <>
            <p className="login-subtitle">
              Enter your registered email and we'll send you a reset link.
            </p>
            <form onSubmit={handleSubmit}>
              <input
                className="login-input"
                type="email"
                placeholder="you@university.ac.ke"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                disabled={loading}
              />

              {error && <p className="login-error">{error}</p>}

              <button
                type="submit"
                className="login-btn"
                disabled={loading || !email}
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>

              {/* Cloudflare Turnstile — token passed to
                  resetPasswordForEmail via options.captchaToken, same
                  pattern as Login/Signup. */}
              <Turnstile onToken={setCaptchaToken} />
            </form>

            <p className="login-signup">
              Remembered it?{' '}
              <span onClick={() => navigate('/login')}>Log In</span>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
