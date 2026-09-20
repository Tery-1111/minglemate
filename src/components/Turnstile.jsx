import { useEffect, useRef } from 'react'

// Cloudflare Turnstile (CAPTCHA) — widget wrapper.
//  • Site key is public: VITE_TURNSTILE_SITE_KEY. The secret key lives
//    ONLY in the Supabase dashboard (Authentication > Bot and Abuse
//    Protection), never in code or VITE_ vars.
//  • Renders the managed widget and lifts the token up via onToken.
//  • Without a configured site key, renders nothing and calls
//    onToken(null) once — the auth calls then go out without a
//    captchaToken, which Supabase handles per its CAPTCHA setting
//    (protection off = accepted; on = rejected until configured).
//  • The script is injected once; multiple widgets attach to its load
//    event and each renders into its own container.

export default function Turnstile({ onToken }) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  // Keep the latest callback without re-rendering the widget.
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  useEffect(() => {
    if (!siteKey) {
      onTokenRef.current?.(null)
      return
    }
    let cancelled = false

    const render = () => {
      if (cancelled || !containerRef.current) return
      if (widgetIdRef.current !== null || !window.turnstile) return
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onTokenRef.current?.(token),
        'error-callback': () => onTokenRef.current?.(null),
        'expired-callback': () => onTokenRef.current?.(null)
      })
    }

    const ensureScript = () => {
      if (window.turnstile) {
        render()
        return
      }
      let script = document.getElementById('cf-turnstile-script')
      if (!script) {
        script = document.createElement('script')
        script.id = 'cf-turnstile-script'
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
        script.async = true
        script.defer = true
        document.head.appendChild(script)
      }
      script.addEventListener('load', render)
    }

    ensureScript()

    return () => {
      cancelled = true
      if (widgetIdRef.current !== null && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* widget already gone */ }
        widgetIdRef.current = null
      }
    }
  }, [siteKey])

  return <div ref={containerRef} className="turnstile-slot" aria-label="Spam protection check" />
}
