// Email-OTP flow tests for MingleMate — mock-based, no network, no email.
//
//   node scripts/test-otp-flow.mjs
//
// Confirmed from source (see report): MingleMate has NO passwordless
// `signInWithOtp` flow. The email code is a *signup confirmation* OTP:
//   Signup.handleSignup  -> supabase.auth.signUp            (OTP-01/02/03/04)
//   VerifyCode (screen)  -> supabase.auth.verifyOtp(type:'signup')
//   VerifyCode (screen)  -> supabase.auth.resend
//   Login.email_not_confirmed -> supabase.auth.resend, then /verify-code
//   AuthGuard            -> requires email_confirmed_at before app pages
//
// Everything is driven against the fake Supabase client in otp-mocks.mjs.
// We assert on the *recorded calls* and on the rendered DOM text, never on
// the real SDK. No defense-in-depth claim is made about live email.

import assert from 'node:assert/strict'
import { installOtpMocks, getState, getCalls, callsTo, fakeSupabase } from './otp-mocks.mjs'
import { setupDom, cleanupDom, getBodyText } from './otp-dom.mjs'

// ---- Harness -----------------------------------------------------------
setupDom()
const { } = installOtpMocks()

const SARIF = { passed: 0, failed: 0, results: [] }
function scenario(id, name, fn) {
  return { id, name, fn }
}

const results = []
const ONLY = process.env.OTP_ONLY ? process.env.OTP_ONLY.split(',') : null
async function run(id, name, fn) {
  if (ONLY && !ONLY.includes(id)) return
  // Fresh state for every scenario.
  getState().calls = []
  getState().auth = {}
  getState().user = null
  getState().listener = null
  await unmountCurrent()
  cleanupDom()
  try {
    await fn()
    results.push({ id, name, ok: true })
    SARIF.passed += 1
  } catch (err) {
    results.push({ id, name, ok: false, error: err.message })
    SARIF.failed += 1
  }
}

// React + act must be imported AFTER the DOM globals exist and after the
// module hooks are registered, so that `@supabase/supabase-js`, css and
// posthog resolve to the fakes inside the component modules.
const React = (await import('react')).default
const { act } = await import('react')
const ReactDOMClient = await import('react-dom/client')
const { createRoot } = ReactDOMClient
const { MemoryRouter, Routes, Route } = await import('react-router-dom')

// Import the real pages (they resolve supabase -> fake).
const { default: Signup } = await import('../src/pages/Signup.jsx')
const { default: Login } = await import('../src/pages/Login.jsx')
const { default: VerifyCode } = await import('../src/pages/VerifyCode.jsx')
const { default: AuthGuard } = await import('../src/components/AuthGuard.jsx')

// Let pending promises, microtasks and one macrotask tick resolve inside act.
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    await Promise.resolve()
  })
}

// ---- Render helpers ----------------------------------------------------
// A stable marker element every navigation lands on, so a redirecting page
// (AuthGuard -> /login) does not remount the component under test forever.
const STABLE = React.createElement('div', null, 'ROUTER-STABLE')

// Track the currently mounted root so a second render() in one scenario
// unmounts the first instead of leaving two roots fighting over #root.
let currentRoot = null

async function unmountCurrent() {
  if (currentRoot) {
    const r = currentRoot
    currentRoot = null
    await act(async () => { r.unmount() })
  }
}
async function render(element, { route = '/', at } = {}) {
  await unmountCurrent()
  const container = globalThis.document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  currentRoot = root
  // `at` lets a scenario mount the element under test at a specific path
  // (e.g. '/verify-code') while redirect targets stay on the stable marker.
  const atEl = at || null
  await act(async () => {
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [route] },
        React.createElement(
          Routes,
          null,
          // Mount the element under test at both '/' and the route it expects.
          // Redirect targets (/login, /verify-code) resolve to a stable marker
          // so a redirecting component does not remount in a loop.
          React.createElement(Route, { path: '/', element }),
          React.createElement(Route, { path: '/home', element }),
          React.createElement(Route, { path: '/verify-code', element: atEl || STABLE }),
          React.createElement(Route, { path: '/profile-setup', element: STABLE }),
          React.createElement(Route, { path: '/login', element: STABLE }),
          React.createElement(Route, { path: '*', element: STABLE })
        )
      )
    )
  })
  await settle()
  return {
    text: () => getBodyText(),
    root,
    unmount: async () => { await unmountCurrent() },
  }
}

// Fire a React input change the way React 19 listens for it.
async function typeInto(input, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.window.HTMLInputElement.prototype, 'value'
    ).set
    setter.call(input, value)
    input.dispatchEvent(new globalThis.window.Event('input', { bubbles: true }))
  })
}

async function submitForm(form) {
  await act(async () => {
    form.dispatchEvent(new globalThis.window.Event('submit', { bubbles: true, cancelable: true }))
  })
  // Let the async handler's microtasks settle.
  await settle()
}

function buttonByText(re) {
  return Array.from(globalThis.document.querySelectorAll('button')).find(
    (b) => re.test((b.textContent || '').trim())
  )
}

async function click(btn) {
  await act(async () => {
    btn.dispatchEvent(new globalThis.window.Event('click', { bubbles: true, cancelable: true }))
  })
  await settle()
}

// ======================================================================
// Scenarios
// ======================================================================

// OTP-01 — valid email submitted -> OTP request (signUp) initiated.
await run('OTP-01', 'Valid email submitted initiates the OTP (signUp) request', async () => {
  getState().auth.signUp = async () => ({ data: { user: { id: 'u1', email_confirmed_at: null }, session: null }, error: null })
  await render(React.createElement(Signup))
  // Fill required fields.
  const inputs = globalThis.document.querySelectorAll('input')
  const emailInput = inputs[0]
  const pwInput = Array.from(inputs).find((i) => i.type === 'password')
  const checkbox = globalThis.document.querySelector('input[type="checkbox"]')
  await typeInto(emailInput, 'student@university.ac.ke')
  await typeInto(pwInput, 'password123')
  await act(async () => { checkbox.click() })
  await submitForm(globalThis.document.querySelector('form'))
  const signUps = callsTo('signUp')
  assert.equal(signUps.length, 1, 'exactly one signUp call')
  assert.equal(signUps[0].args.email, 'student@university.ac.ke')
  assert.equal(signUps[0].args.password, 'password123')
})

// OTP-02 - Supabase accepts the request -> actual successful signup behaviour.
await run('OTP-02', 'Accepted request reaches /verify-code with the submitted email', async () => {
  getState().auth.signUp = async () => ({ data: { user: { id: 'u1' }, session: null }, error: null })
  // Render so that navigating to /verify-code mounts the real VerifyCode screen
  // and redirect targets resolve to the stable marker.
  const view = await render(React.createElement(Signup), { at: React.createElement(VerifyCode) })
  const inputs = globalThis.document.querySelectorAll('input')
  const emailInput = inputs[0]
  const pwInput = Array.from(inputs).find((i) => i.type === 'password')
  const checkbox = globalThis.document.querySelector('input[type="checkbox"]')
  const submittedEmail = 'student@university.ac.ke'
  await typeInto(emailInput, submittedEmail)
  await typeInto(pwInput, 'password123')
  await act(async () => { checkbox.click() })
  await submitForm(globalThis.document.querySelector('form'))

  const signUps = callsTo('signUp')
  assert.equal(signUps.length, 1, 'signUp() is called once on successful submit')
  // Confirmation screen reached: VerifyCode UI is rendered at /verify-code.
  assert.ok(/Check your email/.test(view.text()), 'confirmation screen is reached')
  assert.ok(view.text().includes(submittedEmail), 'submitted email is passed to the verification screen')
  // Navigation target is /verify-code and no failure/success-misrepresentation state.
  assert.equal(view.text().includes('ROUTER-STABLE'), false, 'navigated to /verify-code (not a fallback target)')
  assert.ok(!/couldn't create your account|error occurred/i.test(view.text()), 'failure is not represented as success with an error')
})

// OTP-03 - Supabase rejects delivery -> safe user-facing messaging, no raw provider leak.
await run('OTP-03', 'Rejected delivery shows safe messaging without raw provider details', async () => {
  const providerDetail = 'Email signups are disabled: SMTP 554 5.7.1 via Resend upstream rejected'
  const err = Object.assign(new Error(providerDetail), { code: 'email_provider_disabled', message: providerDetail })
  getState().auth.signUp = async () => ({ data: {}, error: err })
  const view = await render(React.createElement(Signup))
  const inputs = globalThis.document.querySelectorAll('input')
  const emailInput = inputs[0]
  const pwInput = Array.from(inputs).find((i) => i.type === 'password')
  const checkbox = globalThis.document.querySelector('input[type="checkbox"]')
  await typeInto(emailInput, 'student@university.ac.ke')
  await typeInto(pwInput, 'password123')
  await act(async () => { checkbox.click() })
  await submitForm(globalThis.document.querySelector('form'))

  const safeMessage = "We couldn't create your account right now. Please try again."
  assert.ok(view.text().includes(safeMessage), 'a safe, understandable user-facing failure message is displayed')
  assert.ok(!view.text().includes(providerDetail), 'raw provider error details are not rendered')
  assert.ok(!/SMTP|Resend|email_provider_disabled|supabase/i.test(view.text()), 'SMTP/Resend/infrastructure details are not exposed')
  assert.ok(!/Check your email/.test(view.text()), 'failure is not represented as successful registration')
  assert.equal(view.text().includes('ROUTER-STABLE'), false, 'user remains on the signup screen (no navigation to /verify-code)')
})

// OTP-04 - Network failure -> useful but safe error shown (no raw provider/infrastructure leak).
await run('OTP-04', 'A network failure shows a useful safe error', async () => {
  getState().auth.signUp = async () => { throw new TypeError('Failed to fetch') }
  const view = await render(React.createElement(Signup))
  const inputs = globalThis.document.querySelectorAll('input')
  const emailInput = inputs[0]
  const pwInput = Array.from(inputs).find((i) => i.type === 'password')
  const checkbox = globalThis.document.querySelector('input[type="checkbox"]')
  await typeInto(emailInput, 'student@university.ac.ke')
  await typeInto(pwInput, 'password123')
  await act(async () => { checkbox.click() })
  await submitForm(globalThis.document.querySelector('form'))
  const safeMessage = "We couldn't create your account right now. Please try again."
  assert.ok(view.text().includes(safeMessage), 'a safe, understandable failure message is visible to the user')
  assert.ok(!/Failed to fetch/i.test(view.text()), 'raw network error details are not rendered')
  assert.ok(!/Check your email/.test(view.text()), 'failure is not represented as successful registration')
})

// OTP-05 - Invalid email -> actual invalid-form submission is prevented.
await run('OTP-05', 'Invalid email form submission does not call Supabase signUp or navigate', async () => {
  const view = await render(React.createElement(Signup), { at: React.createElement(VerifyCode) })
  const inputs = globalThis.document.querySelectorAll('input')
  const emailInput = inputs[0]
  const pwInput = Array.from(inputs).find((i) => i.type === 'password')
  const checkbox = globalThis.document.querySelector('input[type="checkbox"]')
  await typeInto(emailInput, 'not-an-email')
  await typeInto(pwInput, 'password123')
  await act(async () => { checkbox.click() })

  assert.equal(emailInput.checkValidity(), false, 'native validation rejects malformed email')
  const form = globalThis.document.querySelector('form')
  assert.equal(form.checkValidity(), false, 'form is invalid before submission')

  // Exercise actual form submission: browsers block invalid native forms via
  // constraint validation, so no submit handler should run and no network/auth
  // request should be initiated.
  await act(async () => {
    if (typeof form.requestSubmit === 'function') {
      try {
        form.requestSubmit()
      } catch {
        // jsdom may throw on invalid forms; submission must still be blocked.
      }
    } else {
      // Fallback: only dispatch submit when valid (mirrors browser behavior).
      if (form.checkValidity()) {
        form.dispatchEvent(new globalThis.window.Event('submit', { bubbles: true, cancelable: true }))
      }
    }
  })
  await settle()

  assert.equal(callsTo('signUp').length, 0, 'invalid email prevents submission: Supabase signUp() is not called')
  assert.ok(!/Check your email/.test(view.text()), 'no successful signup navigation to the confirmation screen occurs')
  assert.equal(view.text().includes('ROUTER-STABLE'), false, 'user remains on signup (no /verify-code navigation)')
})

// OTP-06 — Correct OTP -> verification succeeds, session established.
await run('OTP-06', 'A correct OTP verifies successfully', async () => {
  let navigated = null
  getState().auth.verifyOtp = async () => ({ data: { session: { access_token: 'tok' }, user: { id: 'u1', email_confirmed_at: 'now' } }, error: null })
  const view = await render(React.createElement(VerifyCode), { route: '/verify-code', at: React.createElement(VerifyCode) })
  // Seed email: VerifyCode reads location.state.email; with MemoryRouter the
  // state is empty, so the generic "your email" copy renders. We still exercise
  // the code path with the component's own state.
  const codeInput = globalThis.document.querySelector('input[inputmode="numeric"]')
  assert.ok(codeInput, '6-digit code input is present')
  await typeInto(codeInput, '123456')
  await submitForm(globalThis.document.querySelector('form'))
  const calls = callsTo('verifyOtp')
  assert.equal(calls.length, 1, 'verifyOtp was called once')
  assert.equal(calls[0].args.token, '123456')
  assert.equal(calls[0].args.type, 'signup')
  // No verification error is shown on success.
  assert.ok(!/didn't work/i.test(view.text()), 'no failure message on a successful verify')
})

// OTP-07 — Incorrect OTP -> verification fails with generic copy.
await run('OTP-07', 'An incorrect OTP fails verification with non-enumerating copy', async () => {
  const err = Object.assign(new Error('invalid token'), { code: 'otp_expired', message: 'Token has expired or is invalid' })
  getState().auth.verifyOtp = async () => ({ data: {}, error: err })
  const view = await render(React.createElement(VerifyCode), { route: '/verify-code', at: React.createElement(VerifyCode) })
  const codeInput = globalThis.document.querySelector('input[inputmode="numeric"]')
  await typeInto(codeInput, '000000')
  await submitForm(globalThis.document.querySelector('form'))
  assert.ok(/That code didn't work/.test(view.text()), 'generic failure message is shown')
  // Must not echo server truth about account existence.
  assert.ok(!/invalid token|Token has expired/i.test(view.text()), 'raw server error is not surfaced')
})

// OTP-08 — Expired OTP -> verification fails (same generic copy).
await run('OTP-08', 'An expired OTP fails verification', async () => {
  const err = Object.assign(new Error('Token has expired'), { code: 'otp_expired', message: 'Token has expired' })
  getState().auth.verifyOtp = async () => ({ data: {}, error: err })
  await render(React.createElement(VerifyCode), { route: '/verify-code', at: React.createElement(VerifyCode) })
  const codeInput = globalThis.document.querySelector('input[inputmode="numeric"]')
  await typeInto(codeInput, '123456')
  await submitForm(globalThis.document.querySelector('form'))
  assert.ok(/That code didn't work/.test(getBodyText()), 'expired token produces the generic failure copy')
})

// OTP-09 — Repeated request -> rate-limit response handled.
await run('OTP-09', 'A rate-limited resend is surfaced as a failure', async () => {
  const err = Object.assign(new Error('For security purposes, you can only request this once every 60 seconds'), { status: 429, code: 'over_email_send_rate_limit' })
  getState().auth.resend = async () => ({ data: {}, error: err })
  // VerifyCode seeds email via location.state; use a route with state.
  const view = await renderWithState(React.createElement(VerifyCode), { route: '/verify-code', state: { email: 'student@university.ac.ke' } })
  // Click Resend code (cooldown starts at 0).
  const btn = buttonByText(/Resend code/i)
  assert.ok(btn, 'resend button is present')
  await click(btn)
  assert.equal(callsTo('resend').length, 1, 'a resend was attempted')
  assert.ok(/Couldn't send a new code/.test(view.text()), 'rate-limit failure is shown to the user')
})

// OTP-10 — Resend OTP -> new request handled correctly.
await run('OTP-10', 'A resend issues a new request and starts the cooldown', async () => {
  getState().auth.resend = async () => ({ data: {}, error: null })
  const view = await renderWithState(React.createElement(VerifyCode), { route: '/verify-code', state: { email: 'student@university.ac.ke' } })
  const btn = buttonByText(/Resend code/i)
  await click(btn)
  const calls = callsTo('resend')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].args.type, 'signup')
  assert.equal(calls[0].args.email, 'student@university.ac.ke')
  // After a successful resend the button enters a 60s cooldown.
  assert.ok(/Resend in \d+s/.test(view.text()), 'cooldown countdown is displayed after a successful resend')
})

// OTP-11 — Session returned -> session established (AuthGuard lets user in).
await run('OTP-11', 'A returned confirmed session lets the user through AuthGuard', async () => {
  getState().auth.getUser = async () => ({ data: { user: { id: 'u1', email: 's@u.ac.ke', email_confirmed_at: '2024-01-01T00:00:00Z' } }, error: null })
  const view = await render(
    React.createElement(AuthGuard, null, React.createElement('div', null, 'PROTECTED-CONTENT'))
  )
  assert.ok(/PROTECTED-CONTENT/.test(view.text()), 'confirmed user reaches protected content')
})

// OTP-12 — No session returned -> app does NOT falsely authenticate.
await run('OTP-12', 'Without a confirmed session the app does not falsely authenticate', async () => {
  // AuthGuard is mounted at /home (a distinct path) so that its redirect to
  // /login resolves to the STABLE marker and does not remount in a loop.
  // Case A: no session at all -> redirected away from protected content.
  getState().auth.getUser = async () => {
    const e = Object.assign(new Error('Auth session missing!'), { code: 'session_missing' })
    return { data: { user: null }, error: e }
  }
  const view = await render(
    React.createElement(AuthGuard, null, React.createElement('div', null, 'PROTECTED-CONTENT')),
    { route: '/home' }
  )
  assert.equal(view.text().includes('PROTECTED-CONTENT'), false, 'protected content is NOT rendered for an anonymous user')
  assert.ok(/ROUTER-STABLE/.test(view.text()), 'anonymous user is redirected (to /login)')

  // Case B: an *unconfirmed* email session -> bounced to the code screen, not app.
  getState().auth.getUser = async () => ({ data: { user: { id: 'u1', email: 's@u.ac.ke', email_confirmed_at: null } }, error: null })
  const view2 = await render(
    React.createElement(AuthGuard, null, React.createElement('div', null, 'PROTECTED-CONTENT')),
    { route: '/home' }
  )
  assert.equal(view2.text().includes('PROTECTED-CONTENT'), false, 'unconfirmed email does NOT reach protected content')
  assert.ok(/ROUTER-STABLE/.test(view2.text()), 'unconfirmed user is redirected (to /verify-code)')
})

// ======================================================================
// Router with seedable location.state (for VerifyCode email/resendFailed)
// ======================================================================
async function renderWithState(element, { route, state }) {
  await unmountCurrent()
  const container = globalThis.document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  currentRoot = root
  // MemoryRouter supports initialEntries with a location object { pathname, state }.
  await act(async () => {
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [{ pathname: route, state }] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, { path: '/verify-code', element }),
          React.createElement(Route, { path: '/profile-setup', element: STABLE }),
          React.createElement(Route, { path: '*', element: STABLE })
        )
      )
    )
  })
  await settle()
  return { text: () => getBodyText(), root }
}

// ---- Report ------------------------------------------------------------
console.log('\nEmail-OTP mock-based test run\n' + '='.repeat(34))
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}  ${r.name}`)
  if (!r.ok) console.log(`      -> ${r.error}`)
}
console.log('='.repeat(34))
console.log(`Passed: ${SARIF.passed}   Failed: ${SARIF.failed}   Total: ${results.length}`)
process.exitCode = SARIF.failed === 0 ? 0 : 1
