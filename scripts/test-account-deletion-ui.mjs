// Settings delete-account tests — mock-based, no network, no real deletion.
//
//   node scripts/test-account-deletion-ui.mjs
//
// Exercises src/pages/Settings.jsx against the fake Supabase client in
// otp-mocks.mjs. Asserts on rendered DOM and on the recorded calls:
// that the Edge Function is invoked (not the old direct RPC), that the exact
// DELETE confirmation gates the action, that double submits are impossible,
// that cancel works, that success signs out and routes to '/', that an
// incomplete deletion stays retryable without a false sign-out, and that raw
// infrastructure errors are never shown to the user.

import assert from 'node:assert/strict'
import { installOtpMocks, getState, getCalls, callsTo } from './otp-mocks.mjs'
import { setupDom, cleanupDom, getBodyText } from './otp-dom.mjs'

setupDom()
installOtpMocks()

const React = (await import('react')).default
const { act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { MemoryRouter, Routes, Route } = await import('react-router-dom')

const { default: Settings } = await import('../src/pages/Settings.jsx')

async function settle() {
  await act(async () => {
    await Promise.resolve()
    await new Promise((r) => setTimeout(r, 0))
    await Promise.resolve()
  })
}

let currentRoot = null
const STABLE = React.createElement('div', null, 'ROUTER-STABLE')

async function unmountCurrent() {
  if (currentRoot) {
    const r = currentRoot
    currentRoot = null
    await act(async () => { r.unmount() })
  }
}

async function renderSettings() {
  await unmountCurrent()
  const container = globalThis.document.getElementById('root')
  container.innerHTML = ''
  const root = createRoot(container)
  currentRoot = root
  await act(async () => {
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/settings'] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, { path: '/settings', element: React.createElement(Settings) }),
          React.createElement(Route, { path: '/', element: STABLE }),
          React.createElement(Route, { path: '*', element: STABLE }),
        ),
      ),
    )
  })
  await settle()
  return { text: () => getBodyText(), root }
}

function buttonByText(re) {
  return Array.from(globalThis.document.querySelectorAll('button')).find(
    (b) => re.test((b.textContent || '').trim()),
  )
}

async function click(btn) {
  assert.ok(btn, 'button to click must exist')
  await act(async () => {
    btn.dispatchEvent(new globalThis.window.Event('click', { bubbles: true, cancelable: true }))
  })
  await settle()
}

async function typeInto(input, value) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      globalThis.window.HTMLInputElement.prototype, 'value',
    ).set
    setter.call(input, value)
    input.dispatchEvent(new globalThis.window.Event('input', { bubbles: true }))
  })
  await settle()
}

// Open the modal and return its input.
async function openModal() {
  await click(buttonByText(/Delete Account/i))
  const input = globalThis.document.querySelector('.delete-input')
  assert.ok(input, 'delete confirmation input should be visible')
  return input
}

function resetState(overrides = {}) {
  getState().calls = []
  getState().auth = {}
  getState().user = { id: 'u-1', email: 'a@b.test' }
  getState().tables = {
    users: [{ id: 'u-1', profile_status: 'active', notifications_enabled: true }],
    user_blocks: [],
  }
  getState().functions = {}
  Object.assign(getState(), overrides)
}

const results = []
async function run(id, name, fn) {
  resetState()
  await unmountCurrent()
  cleanupDom()
  try {
    await fn()
    results.push({ id, name, ok: true })
    console.log(`PASS  ${id}  ${name}`)
  } catch (err) {
    results.push({ id, name, ok: false, error: err.message })
    console.log(`FAIL  ${id}  ${name}`)
    console.log(`      ${err.message}`)
  }
}

// ======================================================================

await run('DEL-01', 'The Edge Function is invoked instead of the old direct RPC', async () => {
  await renderSettings()
  const input = await openModal()
  await typeInto(input, 'DELETE')
  await click(buttonByText(/Delete my account/i))

  const invokes = callsTo('functions.invoke')
  assert.equal(invokes.length, 1, 'exactly one Edge Function invocation')
  assert.equal(invokes[0].args.name, 'request-account-deletion')
  // my_profile() is Settings' own page load; the *deletion* RPC must be gone.
  const deletionRpcs = callsTo('rpc').filter(
    (c) => c.args?.name === 'request_account_deletion',
  )
  assert.equal(deletionRpcs.length, 0, 'the old direct deletion RPC is never called')
})

await run('DEL-02', 'Exact DELETE confirmation is enforced', async () => {
  await renderSettings()
  const input = await openModal()
  const confirm = buttonByText(/Delete my account/i)
  assert.ok(confirm.disabled, 'confirm disabled while empty')

  await typeInto(input, 'delete')
  assert.ok(buttonByText(/Delete my account/i).disabled, 'lowercase is not accepted')
  assert.equal(callsTo('functions.invoke').length, 0, 'nothing invoked yet')

  await typeInto(input, 'DELETEX')
  assert.ok(buttonByText(/Delete my account/i).disabled, 'extra characters are not accepted')

  await typeInto(input, 'DELETE')
  assert.ok(!buttonByText(/Delete my account/i).disabled, 'exact DELETE enables confirm')
})

await run('DEL-03', 'Double submission is prevented', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  resetState()
  getState().functions = {
    invoke: async () => {
      await gate
      return { data: { success: true, pending: false }, error: null }
    },
  }

  await renderSettings()
  const input = await openModal()
  await typeInto(input, 'DELETE')

  const confirm = buttonByText(/Delete my account/i)
  await act(async () => {
    confirm.dispatchEvent(new globalThis.window.Event('click', { bubbles: true, cancelable: true }))
    confirm.dispatchEvent(new globalThis.window.Event('click', { bubbles: true, cancelable: true }))
    confirm.dispatchEvent(new globalThis.window.Event('click', { bubbles: true, cancelable: true }))
  })
  await settle()

  assert.equal(callsTo('functions.invoke').length, 1, 'only one invocation despite three clicks')
  release()
  await settle()
})

await run('DEL-04', 'Cancel closes the modal and invokes nothing', async () => {
  await renderSettings()
  const input = await openModal()
  await typeInto(input, 'DELETE')
  await click(buttonByText(/^Cancel$/i))

  assert.equal(globalThis.document.querySelector('.delete-input'), null, 'modal is closed')
  assert.equal(callsTo('functions.invoke').length, 0, 'nothing invoked')
})

await run('DEL-05', 'Success signs out and navigates to /', async () => {
  resetState()
  getState().functions = {
    invoke: async () => ({ data: { success: true, pending: false }, error: null }),
  }

  await renderSettings()
  const input = await openModal()
  await typeInto(input, 'DELETE')
  await click(buttonByText(/Delete my account/i))

  assert.equal(callsTo('functions.invoke').length, 1, 'invoked once')
  assert.equal(callsTo('signOut').length, 1, 'signed out after success')
  assert.match(getBodyText(), /ROUTER-STABLE/, 'navigated away to /')
})

await run('DEL-06', 'Incomplete deletion keeps retry and does NOT sign out', async () => {
  resetState()
  getState().functions = {
    invoke: async () => ({ data: { success: false, pending: true }, error: null }),
  }

  await renderSettings()
  const input = await openModal()
  await typeInto(input, 'DELETE')
  await click(buttonByText(/Delete my account/i))

  assert.equal(callsTo('signOut').length, 0, 'must not sign out on an incomplete deletion')
  const text = getBodyText()
  assert.match(text, /still in progress/i, 'tells the user deletion is incomplete')
  assert.match(text, /profile is hidden/i, 'tells the user the profile is hidden')

  // Retry is available: the confirm button is usable again.
  const confirm = buttonByText(/Delete my account/i)
  assert.ok(confirm && !confirm.disabled, 'retry path stays available')
})

await run('DEL-07', 'Raw infrastructure errors are not exposed', async () => {
  resetState()
  getState().functions = {
    invoke: async () => ({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "users_pkey"' },
    }),
  }

  await renderSettings()
  const input = await openModal()
  await typeInto(input, 'DELETE')
  await click(buttonByText(/Delete my account/i))

  const text = getBodyText()
  assert.doesNotMatch(text, /duplicate key/i, 'no SQL detail leaks')
  assert.doesNotMatch(text, /constraint/i, 'no constraint detail leaks')
  assert.doesNotMatch(text, /users_pkey/i, 'no internal identifier leaks')
  assert.match(text, /try again/i, 'shows a generic, actionable message')
})

await run('DEL-08', 'An expired session asks the user to sign in again', async () => {
  resetState()
  getState().functions = {
    invoke: async () => ({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context: { status: 401 } },
    }),
  }

  await renderSettings()
  const input = await openModal()
  await typeInto(input, 'DELETE')
  await click(buttonByText(/Delete my account/i))

  assert.match(getBodyText(), /session has expired/i, 'asks for re-authentication')
  assert.equal(callsTo('signOut').length, 0, 'does not fake sign-out')
})

await run('DEL-09', 'The modal discloses retention of payment and unlock records', async () => {
  await renderSettings()
  await openModal()
  const text = getBodyText()
  assert.match(text, /cannot be undone/i, 'still warns deletion is irreversible')
  assert.match(text, /payment/i, 'mentions payment records')
  assert.match(text, /contact-unlock/i, 'mentions contact-unlock records')
  assert.match(text, /Privacy Policy/i, 'references the Privacy Policy')
})

await unmountCurrent()

const passed = results.filter((r) => r.ok).length
const failed = results.filter((r) => !r.ok).length
console.log('==================================')
console.log(`Passed: ${passed}   Failed: ${failed}   Total: ${results.length}`)
process.exit(failed === 0 ? 0 : 1)
