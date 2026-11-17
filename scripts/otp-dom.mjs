// Shared DOM/render helpers for the email-OTP tests.
//
// Mounts a React page into a jsdom document using react-dom/client + act(),
// so we exercise the real component code (state, handlers, effects) against
// the mocked Supabase/PostHog/CSS boundaries installed by otp-mocks.mjs.
//
// Also provides a MemoryRouter for pages that call navigate()/useLocation().

import { JSDOM } from 'jsdom'

// Install jsdom globals once, before React loads.
export function setupDom() {
  if (globalThis.__otpDomReady) return globalThis.__otpDomReady
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  const set = (name) => {
    if (name in globalThis) return
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true })
  }
  // Globals React + our components touch.
  ;['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'CustomEvent',
    'KeyboardEvent', 'MouseEvent', 'getComputedStyle', 'requestAnimationFrame',
    'cancelAnimationFrame', 'localStorage', 'sessionStorage', 'MutationObserver', 'location'].forEach(set)
  // IS_REACT_ACT_ENVIRONMENT tells React 19 that act() is legal here.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.__otpDomReady = { window, dom }
  return globalThis.__otpDomReady
}

export function cleanupDom() {
  const ready = globalThis.__otpDomReady
  if (ready) {
    ready.window.document.body.innerHTML = '<div id="root"></div>'
  }
}

export function getBodyText() {
  return globalThis.document.body.textContent || ''
}

export function findByText(re) {
  return Array.from(globalThis.document.querySelectorAll('*')).filter(
    (el) => el.children.length === 0 && re.test(el.textContent || '')
  )
}

export function queryBySelector(sel) {
  return globalThis.document.querySelector(sel)
}
