import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { parseRegNumber } from '../utils/regNumber'
import './Signup.css'

export default function Signup() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [regNumber, setRegNumber] = useState('')
  const [regError, setRegError] = useState('')
  const [requiresRegNumber, setRequiresRegNumber] = useState(false)
  const [otp, setOtp] = useState(['', '', '', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function handleEmailChange(e) {
    const val = e.target.value
    setEmail(val)
    const domain = val.split('@')[1]
    setRequiresRegNumber(domain === 'gmail.com')
    setRegNumber('')
    setRegError('')
  }

  function handleRegNumberChange(e) {
    const val = e.target.value
    setRegNumber(val)
    if (val.length > 3) {
      const result = parseRegNumber(val)
      setRegError(result.valid ? '' : result.error)
    } else {
      setRegError('')
    }
  }

  async function handleEmailSubmit() {
    setLoading(true)
    setError('')

    const domain = email.split('@')[1]

    const { data: campus } = await supabase
      .from('campuses')
      .select('id, requires_reg_number')
      .eq('email_domain', domain)
      .single()

    if (!campus) {
      setError('This email is not from a registered campus.')
      setLoading(false)
      return
    }

    if (campus.requires_reg_number) {
      const result = parseRegNumber(regNumber)
      if (!result.valid) {
        setRegError(result.error)
        setLoading(false)
        return
      }
    }

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: null
      }
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

    navigate('/profile-setup')
  }

  function handleOtpChange(value, index) {
    const newOtp = [...otp]
    newOtp[index] = value
    setOtp(newOtp)
    if (value && index < 7) {
      document.getElementById(`otp-${index + 1}`).focus()
    }
  }

  return (
    <div className="signup-container">
      <div className="signup-card">
        <h2 className="signup-title">
          {step === 1 ? 'Create Account' : 'Enter Code'}
        </h2>

        {step === 1 && (
          <>
            <p className="signup-subtitle">
              Use your university email or Gmail
            </p>
            <input
              className="signup-input"
              type="email"
              placeholder="you@university.ac.ke or you@gmail.com"
              value={email}
              onChange={handleEmailChange}
            />
            {requiresRegNumber && (
              <>
                <input
                  className={`signup-input ${regError ? 'input-error' : ''}`}
                  type="text"
                  placeholder="Registration number e.g. S17/02920/24"
                  value={regNumber}
                  onChange={handleRegNumberChange}
                />
                {regError && <p className="signup-error">{regError}</p>}
              </>
            )}
            {error && <p className="signup-error">{error}</p>}
            <button
              className="signup-btn"
              onClick={handleEmailSubmit}
              disabled={loading || !email || (requiresRegNumber && !regNumber)}
            >
              {loading ? 'Sending...' : 'Continue'}
            </button>
            <p className="signup-login">
              Already have an account?{' '}
              <span onClick={() => navigate('/login')}>Log In</span>
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <p className="signup-subtitle">
              We sent an 8-digit code to {email}
            </p>
            <div className="otp-container">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  id={`otp-${index}`}
                  className="otp-input"
                  type="text"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleOtpChange(e.target.value, index)}
                />
              ))}
            </div>
            {error && <p className="signup-error">{error}</p>}
            <button
              className="signup-btn"
              onClick={handleOtpSubmit}
              disabled={loading || otp.join('').length < 8}
            >
              {loading ? 'Verifying...' : 'Verify'}
            </button>
            <p className="signup-login">
              Wrong email?{' '}
              <span onClick={() => setStep(1)}>Go back</span>
            </p>
          </>
        )}
      </div>
    </div>
  )
}