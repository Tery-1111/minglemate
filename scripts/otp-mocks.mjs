// Test-only module-mocking harness for the MingleMate email-OTP flow.
//
// src/pages/{Signup,Login,VerifyCode}.jsx import a *live* `supabase` client
// (built from VITE_* env at module load), PostHog, and CSS. Under plain Node
// that would construct a real client / choke on asset imports. This harness
// mocks exactly the OTP boundaries we are asked to mock:
//
//   1. Supabase Auth client      -> fake `@supabase/supabase-js` createClient
//   2. Email-delivery boundary   -> modelled by signUp/resend resolving or
//                                   rejecting; we NEVER call the network, so no
//                                   real email can ever be sent.
//   3. PostHog analytics         -> inert stub
//   4. CSS imports               -> empty module
//
// Uses node:module registerHooks (synchronous, same realm) so the fake lives
// in this realm and tests can call into it directly. No credentials, no SMTP,
// no network.

import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as babel from '@babel/core'
import babelPluginJsx from '@babel/plugin-transform-react-jsx'

const state = {
  calls: [],           // every auth method invocation: { method, args }
  auth: {},            // per-test method implementations
  user: null,          // what getSession/getUser report
  listener: null,      // onAuthStateChange listener
}

export function getState() { return state }
export function getCalls() { return state.calls }
export function callsTo(method) { return state.calls.filter(c => c.method === method) }
export function resetCalls() { state.calls = [] }

function record(method, args) { state.calls.push({ method, args }) }

// The fake Supabase client. Only the auth surface the pages use is present.
export const fakeSupabase = {
  auth: {
    async signUp(payload) { record('signUp', payload); return state.auth.signUp ? state.auth.signUp(payload) : { data: { user: {}, session: null }, error: null } },
    async signInWithPassword(payload) { record('signInWithPassword', payload); return state.auth.signInWithPassword ? state.auth.signInWithPassword(payload) : { data: {}, error: null } },
    async verifyOtp(payload) { record('verifyOtp', payload); return state.auth.verifyOtp ? state.auth.verifyOtp(payload) : { data: {}, error: null } },
    async resend(payload) { record('resend', payload); return state.auth.resend ? state.auth.resend(payload) : { data: {}, error: null } },
    async signInWithOAuth(payload) { record('signInWithOAuth', payload); return state.auth.signInWithOAuth ? state.auth.signInWithOAuth(payload) : { error: null } },
    async getUser() { record('getUser', {}); return state.auth.getUser ? state.auth.getUser() : { data: { user: state.user }, error: null } },
    async getSession() { record('getSession', {}); return state.auth.getSession ? state.auth.getSession() : { data: { session: state.user ? { user: state.user } : null }, error: null } },
    onAuthStateChange(cb) {
      record('onAuthStateChange', {});
      state.listener = cb
      return { data: { subscription: { unsubscribe() { state.listener = null } } } }
    },
    async signOut() { record('signOut', {}); return state.auth.signOut ? state.auth.signOut() : { error: null } },
    async updateUser(payload) { record('updateUser', payload); return state.auth.updateUser ? state.auth.updateUser(payload) : { data: {}, error: null } },
  },
  // Edge Function invocation surface (Settings delete-account flow).
  functions: {
    async invoke(name, options) {
      record('functions.invoke', { name, options })
      return state.functions?.invoke
        ? state.functions.invoke(name, options)
        : { data: { success: true, pending: false }, error: null }
    },
  },
  async rpc(name, params) {
    record('rpc', { name, params })
    return state.rpc?.[name] ?? { data: null, error: null }
  },
  // Minimal query-builder: Settings reads its own row and its blocks.
  from(table) {
    record('from', { table })
    const rows = () => state.tables?.[table] ?? []
    const result = (data) => ({ data, error: null })
    const builder = {
      select() { return builder },
      eq() { return builder },
      order() { return builder },
      limit() { return builder },
      async maybeSingle() { return result(rows()[0] ?? null) },
      async single() { return result(rows()[0] ?? null) },
      then(resolve, reject) { return Promise.resolve(result(rows())).then(resolve, reject) },
    }
    return builder
  },
}

// A minimal createClient the pages call through src/supabaseClient.js.
export function createClient() { return fakeSupabase }

// ---- Module hooks -------------------------------------------------------
let installed = false
export function installOtpMocks() {
  if (installed) return { fakeSupabase, state }
  installed = true
  // Provide the fake createClient module via a data: URL held in this file.
  const supabaseStub = `export function createClient(){ return globalThis.__otpFakeClient }`
  const posthogStub = `export default { init(){}, capture(){}, identify(){}, reset(){}, register(){} }`
  // Expose the fake client globally so the data: URL module can reach it.
  globalThis.__otpFakeClient = fakeSupabase

  registerHooks({
    load(url, context, nextLoad) {
      // Provide a minimal `import.meta.env` shim for the app's own source
      // files. Vite normally injects this; plain Node leaves it undefined.
      // We deliberately supply NO real credentials — the fake createClient
      // ignores them, so no network client is ever built.
      const isAppSource = url.startsWith('file:') && /[\\/]src[\\/]/.test(url)
      if (isAppSource) {
        const path = fileURLToPath(url)
        let src = readFileSync(path, 'utf8')
        if (src.includes('import.meta.env')) {
          const envShim = '\nconst __viteEnv = { VITE_SUPABASE_URL: "mem://otp-test", VITE_SUPABASE_ANON_KEY: "test-anon", MODE: "test", VITE_POSTHOG_KEY: "", VITE_VERCEL_ENV: "test", VITE_TURNSTILE_SITE_KEY: "" };\n'
          src = envShim + src.replace(/import\.meta\.env/g, '__viteEnv')
        }
        let code = src
        if (/\.jsx?$/.test(url)) {
          const out = babel.transformSync(src, {
            filename: path,
            babelrc: false,
            configFile: false,
            plugins: [[babelPluginJsx, { runtime: 'automatic' }]],
            sourceMaps: false,
          })
          code = out.code
        }
        return { format: 'module', source: code, shortCircuit: true }
      }
      return nextLoad(url, context)
    },
    resolve(specifier, context, nextResolve) {
      if (specifier.endsWith('.css')) return { url: 'data:text/javascript,export default {}', shortCircuit: true }
      if (specifier === '@supabase/supabase-js') return { url: 'data:text/javascript,' + encodeURIComponent(supabaseStub), shortCircuit: true }
      if (specifier === 'posthog-js') return { url: 'data:text/javascript,' + encodeURIComponent(posthogStub), shortCircuit: true }
      // Vite resolves extensionless relative imports (e.g. '../supabaseClient');
      // Node does not. Try the common extensions only for relative specifiers.
      if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[cm]?[jt]sx?$|\.[cm]?js$/.test(specifier)) {
        const base = specifier
        for (const ext of ['.js', '.jsx', '.mjs', '.json']) {
          try {
            return nextResolve(base + ext, context)
          } catch { /* try next */ }
        }
      }
      return nextResolve(specifier, context)
    },
  })
  return { fakeSupabase, state }
}
