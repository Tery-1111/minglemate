import { useState } from 'react'

// FADEIMAGE — shared image-state primitive (liveness §23, loading-spec §8).
// Full state model per image:
//   placeholder → loading → loaded   (fade-in, dimensions reserved)
//   placeholder → failed → fallback  (retryable — never a broken rectangle)
// The skeleton shows while the image decodes; the photo then fades in
// in place of it (same box, no layout shift, no generic spinner).
// Parent-rendered scrims/names sit ON TOP of the placeholder so they
// never blink during loading.
//
// Props:
//   src, alt, className  — passed to the img
//   skeletonClassName    — class for the placeholder box (gets .skeleton)
//   imgClassName         — class for the img (gets .img-reveal + .is-loaded)
//   scrim                — optional node rendered above the placeholder
//   fallback             — optional node for the failed state (default: icon)
//   onRetry              — optional; when provided the failed state shows Retry
//   ...rest              — img attributes (loading, decoding, etc.)
export default function FadeImage({
  src,
  alt,
  className = '',
  skeletonClassName,
  imgClassName,
  scrim,
  fallback,
  onRetry,
  ...rest
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  if (failed || !src) {
    return (
      <div className={`${skeletonClassName || ''} img-failed ${className}`.trim()}>
        {scrim}
        <div className="img-failed-body" role={src ? 'status' : undefined}>
          {fallback || (
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2.5" />
              <circle cx="9" cy="10" r="1.8" />
              <path d="M4 18l5-5 4 4 3-3 4 4" />
            </svg>
          )}
          {src && onRetry && (
            <button className="img-retry" onClick={() => { setFailed(false); setAttempt(a => a + 1) }}>
              Retry
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={className} style={{ position: 'relative' }}>
      {!loaded && (
        <div
          className={`skeleton ${skeletonClassName || ''}`}
          style={{ position: 'absolute', inset: 0 }}
          aria-hidden="true"
        />
      )}
      {/* key={attempt} forces a fresh fetch on retry */}
      <img
        key={attempt}
        src={src}
        alt={alt}
        className={`img-reveal ${loaded ? 'is-loaded' : ''} ${imgClassName || ''}`.trim()}
        style={loaded ? undefined : { opacity: 0 }}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        {...rest}
      />
      {scrim}
    </div>
  )
}
