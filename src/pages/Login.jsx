import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import './Login.css'

export default function Login() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState(['', '', '', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleEmailSubmit() {
    setLoading(true)
    setError('')

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false }
    })

    if (otpError) {
      setError(otpError.message)
      setLoading(false)
      return
    }

    setStep(2)
    setLoading(false)
  }

  async function handleOtpSubmit() {
    setLoading(true)
    setError('')
    const token = otp.join('')

    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email'
    })

    if (verifyError) {
      setError('Invalid code. Please try again.')
      setLoading(false)
      return
    }

    navigate('/home')
  }

  function handleOtpChange(value, index) {
    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)
    if (value && index < 7) {
      document.getElementById(`login-otp-${index + 1}`).focus()
    }
  }

  return (
    <div className="login-container">
      <div className="login-card">
        <h2 className="login-title">
          {step === 1 ? 'Welcome Back' : 'Enter Code'}
        </h2>

        {step === 1 && (
          <>
            <p className="login-subtitle">Enter your registered email</p>
            <input
              className="login-input"
              type="email"
              placeholder="you@university.ac.ke"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            {error && <p className="login-error">{error}</p>}
            <button
              className="login-btn"
              onClick={handleEmailSubmit}
              disabled={loading || !email}
            >
              {loading ? 'Sending...' : 'Continue'}
            </button>
            <p className="login-signup">
              No account?{' '}
              <span onClick={() => navigate('/signup')}>Sign Up</span>
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <p className="login-subtitle">
              We sent an 8-digit code to {email}
            </p>
            <div className="otp-container">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  id={`login-otp-${index}`}
                  className="otp-input"
                  type="text"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleOtpChange(e.target.value, index)}
                />
              ))}
            </div>
            {error && <p className="login-error">{error}</p>}
            <button
              className="login-btn"
              onClick={handleOtpSubmit}
              disabled={loading || otp.join('').length < 8}
            >
              {loading ? 'Verifying...' : 'Log In'}
            </button>
            <p className="login-signup">
              Wrong email?{' '}
              <span onClick={() => setStep(1)}>Go back</span>
            </p>
          </>
        )}
      </div>
    </div>
  )
}