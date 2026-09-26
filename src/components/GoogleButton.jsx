import { useState } from 'react'
import { supabase } from '../supabaseClient'

// "Continue with Google". Text-only because the project ships no Google
// "G" asset (public/icons.svg has bluesky/discord/github/x only) — a
// brand-logo button would be a nice-to-have, not required now.
//
// Clicking opens Google's consent screen in the same window:
//   supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })
// GoTrue returns the user to redirectTo with #access_token=… on success
// or #error=… on decline. No dedicated callback route is needed:
// supabase-js's detectSessionInUrl picks the session up on whatever page
// loads (client init runs before any component renders). redirectTo is
// /home, not the origin root, so a successful Google user lands INSIDE
// the app via AuthGuard instead of on the marketing page while signed
// in — and a declined consent (#error) falls through AuthGuard to
// /login as a normal logged-out visit. Google users always have
// email_confirmed_at set, so they never see /verify-code.
export default function GoogleButton({ onError }) {
  const [starting, setStarting] = useState(false)

  async function handleClick() {
    if (starting) return
    setStarting(true)

    // Same-origin redirect pattern (never a hardcoded URL) — matches the
    // reset-password fix. The origin must be allow-listed in Supabase's
    // URL Configuration or GoTrue rejects the round-trip.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/home` },
    })

    if (error) {
      // Only local failures land here (network, provider misconfig).
      // A user declining Google's consent comes back as #error=… on the
      // redirect and is handled by the app as a normal logged-out visit.
      onError?.(error)
      setStarting(false)
      return
    }
    // On success the browser navigates away to Google — nothing to reset.
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={starting}
      style={{
        width: '100%',
        padding: 14,
        background: '#ffffff',
        color: '#1f1f1f',
        border: '1px solid var(--border-strong, #dadce0)',
        borderRadius: 10,
        fontSize: 15,
        fontWeight: 600,
        cursor: starting ? 'wait' : 'pointer',
        marginBottom: 16,
      }}
    >
      {starting ? 'Opening Google...' : 'Continue with Google'}
    </button>
  )
}
