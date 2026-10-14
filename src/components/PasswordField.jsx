import { useState } from 'react'

// Password input with a Show/Hide toggle. Pure frontend: switches the
// input's type between "password" and "text". Text toggle because no
// icon library exists in this app. Styling is inline so the component
// overlays identically on the CSS-class pages (Login/VerifyCode and the
// reset screens) and the inline-styled Signup page.
//
// All other input props (className, style, placeholder, disabled,
// autoComplete, required, ...) pass straight through to the <input>.
export default function PasswordField({ value, onChange, ...inputProps }) {
  const [visible, setVisible] = useState(false)

  return (
    <div style={{ position: 'relative', display: 'block' }}>
      <input
        {...inputProps}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        // Keep typed characters clear of the toggle button. A caller's
        // own style wins for everything except this padding.
        style={{ paddingRight: 64, ...inputProps.style }}
      />
      <button
        type="button"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        style={{
          position: 'absolute',
          right: 12,
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          padding: '4px',
          color: 'var(--accent, #d4af37)',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}
