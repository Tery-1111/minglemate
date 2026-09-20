import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase } from '../supabaseClient'

// Single choke point for route authentication. Replaces the 14
// copy-pasted per-page checks that failed silently:
//  * getSession() errors were ignored (only `session` was read) —
//    a thrown/stale auth state looked identical to "logged out"
//  * some pages returned silently instead of redirecting (Photos,
//    Section1's error path) — user saw an eternal spinner or blank
//  * guards disagreed on destination: '/', '/login', or nothing
//  * no listener: token revocation mid-session left pages running
//    with dead auth, failing on every query with no feedback
export default function AuthGuard({ children }) {
  const [state, setState] = useState({ status: 'loading', error: null })
  const location = useLocation()

  useEffect(() => {
    let alive = true

    async function check() {
      // getUser() validates the token against the server (getSession
      // trusts locally-stored state, which can be expired/garbage).
      const { data, error } = await supabase.auth.getUser()

      if (!alive) return
      if (error) {
        // getUser() throws AuthSessionMissingError when no session is
        // stored at all — that is simply "logged out", not a failure.
        // Route to login instead of showing a scary error screen.
        if (/session missing/i.test(error.message || '') || error.code === 'session_missing') {
          setState({ status: 'anon', error: null })
          return
        }
        setState({ status: 'error', error: authErrorMessage(error) })
        return
      }
      if (!data?.user) {
        setState({ status: 'anon', error: null })
        return
      }
      setState({ status: 'authed', error: null })
    }

    check()

    // React to sign-outs while mounted
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (!alive) return
      if (event === 'SIGNED_OUT') {
        setState({ status: 'anon', error: null })
      }
    })

    return () => {
      alive = false
      subscription.unsubscribe()
    }
  }, [location.pathname])

  if (state.status === 'loading') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#0a0a0a', color: '#888',
        fontSize: 15, fontFamily: 'inherit'
      }}>
        Checking your session…
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12,
        background: '#0a0a0a', padding: 24, fontFamily: 'inherit'
      }}>
        <p style={{ color: '#E8416B', margin: 0, textAlign: 'center', maxWidth: 360 }}>
          {state.error}
        </p>
        <button
          onClick={() => { setState({ status: 'loading', error: null }); location.pathname && window.location.reload() }}
          style={{
            background: '#E8416B', color: '#fff', border: 'none',
            padding: '10px 24px', borderRadius: 8, fontWeight: 700, cursor: 'pointer'
          }}
        >
          Try again
        </button>
        <button
          onClick={() => window.location.assign('/login')}
          style={{
            background: 'transparent', color: '#888', border: '1px solid #333',
            padding: '10px 24px', borderRadius: 8, fontWeight: 600, cursor: 'pointer'
          }}
        >
          Go to login
        </button>
      </div>
    )
  }

  if (state.status === 'anon') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return children
}

function authErrorMessage(error) {
  const msg = error?.message || String(error)
  if (/refresh token/i.test(msg)) return 'Your session expired. Please log in again.'
  if (/network|fetch/i.test(msg)) return "Can't reach the authentication service. Check your connection."
  return 'Authentication failed: ' + msg
}
