import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import App from './App.jsx'
import { initSentry, Sentry } from './lib/sentry'

// Start error tracking before anything else runs.
initSentry()

// Shown instead of a blank white screen if the app crashes.
function CrashScreen() {
  return (
    <div
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: '48px 24px',
        textAlign: 'center',
        fontFamily: 'sans-serif',
      }}
    >
      <h2>Something went wrong</h2>
      <p>We've been notified and will look into it. Please try again.</p>
      <button
        onClick={() => window.location.reload()}
        style={{ padding: '12px 24px', fontSize: 16, cursor: 'pointer' }}
      >
        Reload
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<CrashScreen />}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)