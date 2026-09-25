import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { track, identifyUser } from '../lib/analytics'
import './Login.css'

// One-time code screen for email signup. Reachable from Signup (after
// signUp succeeds) and from Login (when the password is right but the
// email is not confirmed yet). Reuses the login page styling.
export default function VerifyCode() {
  const navigate = useNavigate()
  const location = useLocation()
  const email = location.state?.email || ''

  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')

  // Resend: at most 3 per visit, 60s cooldown after each click.
  const [resendLeft, setResendLeft] = useState(0)
  const [resending, setResending] = useState(false)
  const [resendsUsed, setResendsUsed] = useState(0)
  const [tooMany, setTooMany] = useState(false)
  // Seeded when the caller (Login) already tried to send a code and it
  // failed — the user must know none is on its way. Same message the
  // screen's own resend button shows on failure.
  const [resendError, setResendError] = useState(
    location.state?.resendFailed ? "Couldn't send a new code. Please try again shortly." : ''
  )

  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  // 60-second countdown, one tick per second.
  useEffect(() => {
    if (resendLeft <= 0) return
    const id = setInterval(() => setResendLeft((n) => n - 1), 1000)
    return () => clearInterval(id)
  }, [resendLeft])

  async function handleVerify(e) {
    e.preventDefault()
    if (verifying || code.length !== 6) return

    setVerifying(true)
    setError('')

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: 'signup',
    })

    if (verifyError) {
      track('otp_failed')
      // Never surface error.message — it must not confirm which emails exist.
      setError("That code didn't work. Check it or request a new one.")
      setVerifying(false)
      return
    }

    // Same destination a successful signup used to navigate to.
    track('otp_verified')
    identifyUser(data?.user?.id)
    track('signup_completed')
    navigate('/profile-setup')
  }

  async function handleResend() {
    if (tooMany || resendLeft > 0 || resending || !email) return

    setResending(true)
    setResendError('')

    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
    })

    setResending(false)

    if (resendError) {
      setResendError("Couldn't send a new code. Please try again shortly.")
      return
    }

    track('otp_resent')

    const used = resendsUsed + 1
    setResendsUsed(used)
    setResendLeft(60)
    if (used >= 3) setTooMany(true)
  }

  const canVerify = code.length === 6 && !verifying

  return (
    <div className="login-container">
      <div className="login-card">
        <h2 className="login-title">Check your email</h2>
        <p className="login-subtitle">
          {email
            ? `We sent a 6-digit code to ${email}. Enter it below.`
            : 'We sent a 6-digit code to your email. Enter it below.'}
        </p>

        <form onSubmit={handleVerify}>
          <input
            ref={inputRef}
            className="login-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ''))
              setError('')
            }}
            style={{ letterSpacing: '8px', textAlign: 'center' }}
          />

          {error && <p className="login-error">{error}</p>}

          <button
            type="submit"
            className="login-btn"
            disabled={!canVerify}
          >
            {verifying ? 'Verifying...' : 'Verify'}
          </button>
        </form>

        <button
          className="login-btn"
          style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--border)' }}
          onClick={handleResend}
          disabled={tooMany || resendLeft > 0 || resending || !email}
        >
          {resending
            ? 'Sending...'
            : resendLeft > 0
              ? `Resend in ${resendLeft}s`
              : 'Resend code'}
        </button>

        {resendError && <p className="login-error">{resendError}</p>}
        {tooMany && resendLeft <= 0 && (
          <p className="login-error">
            You've requested too many codes. Please wait a few minutes and try again.
          </p>
        )}

        <p className="login-signup">
          Wrong email?{' '}
          <span onClick={() => navigate('/signup')}>Go back</span>
        </p>
      </div>
    </div>
  )
}
