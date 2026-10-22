import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { track } from '../lib/analytics';
import Turnstile from '../components/Turnstile';
import PasswordField from '../components/PasswordField';
import GoogleButton from '../components/GoogleButton';

export default function Signup() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [captchaToken, setCaptchaToken] = useState(null);

  const handleSignup = async (e) => {
    e.preventDefault();
    if (loading) return;

    // Analytics: the person pressed Sign Up (no email or password is sent).
    track('signup_started');

    setLoading(true);
    setError(null);

    try {
      // 1. Create the credentials account in auth.users
      // 1. Create the credentials account in auth.users. The Turnstile
      // token rides along per Supabase's CAPTCHA protection setting.
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { captchaToken },
      });

      if (authError) throw authError;

      // 2. Profile row: handle_new_user() — the SECURITY DEFINER trigger on
      // auth.users — creates the public.users row at signup, with the
      // server's own created_at and the 14-day trial. Nothing is written from
      // here any more: the old upsert, and the update-by-id restamp that
      // replaced it (which only rewrote the row's own creation timestamp),
      // are both gone, because created_at is server-owned and is no longer in
      // the client's UPDATE grant. A failure here could never block the code
      // screen anyway — the auth account and the emailed code already exist
      // at this point — so there is nothing left to fall back to.

      // 3. Email confirmation flow: no session exists yet, so we do NOT
      // navigate into the app. The user verifies a 6-digit code next.
      // With "Confirm email" on, an ALREADY-REGISTERED address returns
      // the same shape (a user with an empty identities array), so both
      // cases take this exact same path — the response never reveals
      // whether an email exists.
      track('signup_code_sent');
      navigate('/verify-code', { state: { email } });
    } catch (err) {
      // Newer GoTrue versions reject an already-registered address with a
      // 422 "user_already_exists" instead of the silent empty-identities
      // 200 response. Treat it exactly like the silent case: show the
      // code screen so the response never reveals which emails exist.
      // No signup_code_sent here: no code was actually sent on this path.
      if (err?.code === 'user_already_exists') {
        navigate('/verify-code', { state: { email } });
        return;
      }

      // Analytics: signup failed (no error text is sent, it could hold personal data).
      track('signup_failed');
      setError(err.message || 'An error occurred during account registration.');
      console.error('Signup pipeline error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.logoContainer}>
          {/* Brand mark: serif-M monogram roundel — never an emoji heart. */}
          <span style={styles.logoMark}>M</span>
          <h1 style={styles.title}>Create Account</h1>            <p style={styles.subtitle}>Join the student matching network</p>
        </div>

        {error && <div style={styles.errorBox}>{error}</div>}

        <form onSubmit={handleSignup} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Campus Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@student.university.ac.ke"
              required
              disabled={loading}
              style={styles.input}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Password</label>
            <PasswordField
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={loading}
              style={styles.input}
            />
          </div>

          {/* Electronic acceptance per Terms clause 29: a recorded,
              affirmative action. Native `required` blocks submission
              until checked. */}
          <label style={styles.termsRow}>
            <input
              type="checkbox"
              required
              disabled={loading}
              style={styles.checkbox}
            />
            <span>
              I am 18+ and agree to the{' '}
              <Link to="/terms" target="_blank" style={styles.link}>
                Terms of Service
              </Link>{' '}and{' '}
              <Link to="/privacy" target="_blank" style={styles.link}>
                Privacy Policy
              </Link>
            </span>
          </label>          <button
            type="submit"
            disabled={loading}
            style={{
              ...styles.submitBtn,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? 'not-allowed' : 'pointer'
            }}
          >
            {loading ? 'Creating Profile...' : 'Sign Up'}
          </button>

          {/* Google OAuth — the one-tap alternative to the email form.
              Same-window redirect; session is picked up by
              detectSessionInUrl on return and AuthGuard routes the user
              in — a first-time Google user never sees /verify-code. */}
          <GoogleButton onError={() => setError("Couldn't start Google sign-in. Please try again.")} />

          {/* Cloudflare Turnstile — token passed to signUp via
              options.captchaToken (Supabase CAPTCHA protection). */}
          <Turnstile onToken={setCaptchaToken} />
        </form>

        <div style={styles.footer}>
          Already have an account?{' '}
          <Link to="/login" style={styles.link}>
            Log In
          </Link>
        </div>
      </div>
    </div>
  );
}

// Inline styles designed to blend perfectly with your midnight theme
const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    padding: '20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '16px',
    padding: '32px 24px',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  },
  logoContainer: {
    textAlign: 'center',
    marginBottom: '28px',
  },
  logoMark: {
    width: '56px',
    height: '56px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 8px auto',
    background: 'var(--accent-soft)',
    border: '1.5px solid var(--border-champagne)',
    borderRadius: '50%',
    fontFamily: 'var(--font-display)',
    fontSize: '28px',
    fontWeight: 600,
    color: 'var(--champagne)',
  },
  title: {
    color: 'var(--text-primary)',
    fontSize: '24px',
    fontWeight: '800',
    margin: '0 0 6px 0',
  },
  subtitle: {
    color: 'var(--text-muted)',
    fontSize: '14px',
    margin: 0,
  },
  errorBox: {
    background: 'var(--danger-soft)',
    border: '1px solid var(--danger)',
    color: 'var(--danger)',
    padding: '12px',
    borderRadius: '8px',
    fontSize: '14px',
    marginBottom: '20px',
    lineHeight: '1.4',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    color: 'var(--text-secondary)',
    fontSize: '13px',
    fontWeight: '500',
  },
  input: {
    background: 'var(--surface-raised)',
    border: '1px solid var(--border-strong)',
    borderRadius: '10px',
    padding: '14px',
    color: 'var(--text-primary)',
    fontSize: '15px',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  submitBtn: {
    background: 'var(--accent)',
    color: 'var(--text-on-accent)',
    border: 'none',
    borderRadius: '10px',
    padding: '14px',
    fontSize: '16px',
    fontWeight: '700',
    marginTop: '10px',
    transition: 'opacity 0.2s',
  },
  termsRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    fontSize: '13px',
    color: 'var(--text-muted)',
    lineHeight: 1.5,
    marginTop: '4px',
  },
  checkbox: {
    marginTop: '2px',
    accentColor: 'var(--accent)',
    width: '16px',
    height: '16px',
    flexShrink: 0,
    cursor: 'pointer',
  },
  footer: {
    textAlign: 'center',
    marginTop: '24px',
    color: 'var(--text-muted)',
    fontSize: '14px',
  },
  link: {
    color: 'var(--champagne)',
    textDecoration: 'none',
    fontWeight: '600',
  },
};