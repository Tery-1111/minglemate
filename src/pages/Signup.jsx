import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { track, identifyUser } from '../lib/analytics';
import Turnstile from '../components/Turnstile';

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
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { captchaToken },
      });

      if (authError) throw authError;

      if (authData?.user) {
        // 2. Profile row: the DB trigger (fix_rls.sql) already creates it
        // via SECURITY DEFINER. This upsert is a fallback for setups
        // without the trigger — e.g. email-confirmation-disabled flows
        // where the client DOES have a session here. If it fails with
        // RLS (session-less confirmation flow), the trigger has it
        // covered, so treat that specific case as success.
        const { error: profileError } = await supabase
          .from('users')
          .upsert({
            id: authData.user.id,
            email: email,
            section2_unlocked: false,
            created_at: new Date().toISOString(),
          });

        const isRlsSessionless =
          profileError &&
          /row-level security/i.test(profileError.message || '');

        if (profileError && !isRlsSessionless) throw profileError;

        // Analytics: account created. Only the user ID is shared, never the email.
        identifyUser(authData.user.id);
        track('signup_completed');

        // 3. Navigation is safe: auth user exists, profile row exists
        // (created by trigger if the upsert above was skipped).
        navigate('/profile-setup');
      }
    } catch (err) {
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
            <input
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