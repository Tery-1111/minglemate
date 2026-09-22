import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import Turnstile from '../components/Turnstile'
import './Login.css'

// Password-only login. There is deliberately no OTP or magic-link step
// here: the only code screen in the app is /verify-code, which handles
// the one case a password login cannot complete on its own — a correct
// password on an email that was never confirmed.
export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [captchaToken, setCaptchaToken] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return

    setLoading(true)
    setError('')

    // No `data` binding needed: success hands off to AuthGuard, which
    // re-validates the session and email confirmation server-side.
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
      // Turnstile token for the password grant (Supabase CAPTCHA).
      options: { captchaToken },
    })

    if (authError) {
      // Correct password + unconfirmed email: Supabase refuses the grant
      // with code "email_not_confirmed". Send one fresh code, then let
      // the user confirm on the code screen — same flow as signup.
      if (authError.code === 'email_not_confirmed') {
        await supabase.auth.resend({ type: 'signup', email })
        setLoading(false)
        navigate('/verify-code', { state: { email }, replace: true })
        return
      }

      // Every other failure gets one identical message so attackers can't
      // probe which campus emails have accounts.
      setError('Email or password is incorrect.')
      setLoading(false)
      return
    }

    // Success: AuthGuard additionally requires a confirmed email before
    // any app page renders. data.session/data.user are the signed-in state.
    navigate('/home')
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <h2 className="login-title">Welcome Back</h2>

        <p className="login-subtitle">Enter your registered email</p>
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
          <input
            className="login-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            disabled={loading}
          />

          {error && <p className="login-error">{error}</p>}

          <button
            type="submit"
            className="login-btn"
            disabled={loading || !email || !password}
          >
            {loading ? 'Logging In...' : 'Log In'}
          </button>

          {/* Cloudflare Turnstile — token passed to signInWithPassword via
              options.captchaToken (Supabase CAPTCHA protection). */}
          <Turnstile onToken={setCaptchaToken} />
        </form>

        <p className="login-signup">
          No account?{' '}
          <span onClick={() => navigate('/signup')}>Sign Up</span>
        </p>
      </div>
    </div>
  )
}
