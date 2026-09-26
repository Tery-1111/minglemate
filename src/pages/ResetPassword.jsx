import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import PasswordField from '../components/PasswordField'
import './Login.css'

// "Set new password" — the screen the reset email's LINK lands on.
// Supabase-js detects the recovery tokens in the URL hash at client
// init (detectSessionInUrl) and stores a session before this component
// mounts, so a valid link simply arrives here already signed in. No
// session on arrival means the link is invalid, expired, or already
// used — never error.message, one generic message (VerifyCode pattern).
export default function ResetPassword() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [hasSession, setHasSession] = useState(false)

  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setHasSession(!!data?.session)
        setChecking(false)
      }
    })
    return () => { active = false }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return

    setLoading(true)
    setError('')

    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) {
      // Generic message only — mirrors the code screen's rule of never
      // surfacing error.message. Supabase enforces its own minimum
      // password length; the user retries with a longer one.
      setError("Couldn't update the password. Try a longer one and submit again.")
      setLoading(false)
      return
    }

    // Success: end the recovery session so the user signs in fresh with
    // the new password (avoids lingering half-states in guarded pages).
    await supabase.auth.signOut()
    setLoading(false)
    setDone(true)
  }

  if (checking) {
    return (
      <div className="login-container">
        <div className="login-card">
          <h2 className="login-title">Reset Password</h2>
          <p className="login-subtitle">Checking your reset link...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <h2 className="login-title">Reset Password</h2>

        {!hasSession ? (
          <>
            <p className="login-subtitle">
              This reset link is invalid or has expired.
            </p>
            <p className="login-subtitle">Request a fresh link to continue.</p>
            <button
              type="button"
              className="login-btn"
              onClick={() => navigate('/forgot-password')}
            >
              Request New Link
            </button>
            <p className="login-signup">
              <span onClick={() => navigate('/login')}>Back to Log In</span>
            </p>
          </>
        ) : done ? (
          <>
            <p className="login-subtitle">
              Your password has been updated. Log in with the new one.
            </p>
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
            <p className="login-subtitle">Choose a new password for your account.</p>
            <form onSubmit={handleSubmit}>
              <PasswordField
                className="login-input"
                type="password"
                placeholder="New password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                disabled={loading}
              />

              {error && <p className="login-error">{error}</p>}

              <button
                type="submit"
                className="login-btn"
                disabled={loading || !password}
              >
                {loading ? 'Updating...' : 'Set New Password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
