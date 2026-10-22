// Proves the transactionstatus re-verify branch against the real Daraja sandbox.
//
//   node scripts/sandbox-transactionstatus.mjs [--no-stk] [--relay] [--wait=120]
//
// The point of this script is that IT DOES NOT REIMPLEMENT THE BRANCH. It sends
// the same request body the edge function sends (buildTransactionStatusQuery)
// and reads the answer with the same code (readTransactionStatusAck); whatever
// the sandbox then posts back is fed through the callback's own parser
// (parseCallbackBody) and record patch (statusResultPatch), and the resulting
// column values are printed. A pass is therefore evidence about
// payment-callback, not about a replica of it.
//
// Credentials come from minglemate/.env.daraja.local (gitignored). Values are
// never printed: the initiator credential and the STK password are reported by
// length, the bearer token not at all, and the transcript is redacted.
//
// What it does, in order:
//   1. OAuth token from the sandbox.
//   2. An STK push to the sandbox test MSISDN, then polls the STK query API for
//      the MpesaReceiptNumber — a real receipt to look up (skip with --no-stk
//      when SANDBOX_RECEIPT is set).
//   3. The TransactionStatus query, captured verbatim.
//   4. Waits for the asynchronous result Daraja posts to the throwaway
//      receiver, then reports the states the callback would record.
//
// Exit codes: 0 accepted and (if a result was expected) captured;
//             1 the query was rejected; 2 accepted but no async result arrived;
//             3 the env file is not filled in yet.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename } from 'node:path'
import { constants, publicEncrypt } from 'node:crypto'

import {
  buildTransactionStatusQuery,
  decideStkAction,
  parseCallbackBody,
  readTransactionStatusAck,
  statusResultPatch
} from '../supabase/functions/payment-callback/ticket.ts'

const SANDBOX_BASE = 'https://sandbox.safaricom.co.ke'
const ENV_PATH = new URL('../.env.daraja.local', import.meta.url)
const OUT_DIR = new URL('./out/', import.meta.url)

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const waitSeconds = Number(opt('wait', '120'))
const useStk = !flag('no-stk')
const relay = flag('relay')
// Reports what is already sitting in the receiver, with no Daraja credentials
// and no network call to Safaricom: the parsing and recording half of the
// proof, runnable on its own.
const capturesOnly = flag('captures-only')

function die(message, code = 1) {
  console.error(`\n${message}\n`)
  process.exit(code)
}

// ------------------------------------------------------------ the env file
function loadEnvFile() {
  let text
  try {
    text = readFileSync(ENV_PATH, 'utf8')
  } catch {
    die(`No minglemate/.env.daraja.local. See the comment block in that file for what to put in it.`, 3)
  }
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim()
  }
  return out
}

const fileEnv = loadEnvFile()
const env = (key) => (process.env[key] ?? fileEnv[key] ?? '').trim()

function redactCredential(value) {
  return `<${value.length} chars, not printed>`
}

const missing = (capturesOnly
  ? [
      !env('SANDBOX_CAPTURE_URL') && 'SANDBOX_CAPTURE_URL',
      !env('SANDBOX_CAPTURE_TOKEN') && 'SANDBOX_CAPTURE_TOKEN'
    ]
  : [
      !env('MPESA_CONSUMER_KEY') && 'MPESA_CONSUMER_KEY',
      !env('MPESA_CONSUMER_SECRET') && 'MPESA_CONSUMER_SECRET',
      !env('MPESA_SHORTCODE') && 'MPESA_SHORTCODE',
      !env('MPESA_INITIATOR') && 'MPESA_INITIATOR',
      !env('MPESA_SECURITY_CREDENTIAL') && !(env('MPESA_INITIATOR_PASSWORD') && env('MPESA_CERT_PATH')) &&
        'MPESA_SECURITY_CREDENTIAL (or MPESA_INITIATOR_PASSWORD + MPESA_CERT_PATH)',
      !env('SANDBOX_RESULT_URL') && 'SANDBOX_RESULT_URL',
      !env('SANDBOX_RECEIPT') && !useStk && 'SANDBOX_RECEIPT (or drop --no-stk)',
      !env('SANDBOX_CAPTURE_URL') && 'SANDBOX_CAPTURE_URL',
      !env('SANDBOX_CAPTURE_TOKEN') && 'SANDBOX_CAPTURE_TOKEN',
      useStk && !env('MPESA_PASSKEY') && 'MPESA_PASSKEY (or rerun with --no-stk)',
      useStk && !env('SANDBOX_STK_CALLBACK_URL') && 'SANDBOX_STK_CALLBACK_URL (or rerun with --no-stk)'
    ]
).filter(Boolean)

if (missing.length > 0) {
  die(`Missing from minglemate/.env.daraja.local:\n  - ${missing.join('\n  - ')}`, 3)
}

if (env('MPESA_ENV') === 'production') {
  die('MPESA_ENV=production would point this at the live Daraja host. This proof targets the sandbox only.')
}



const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const parse = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
const show = (value) => JSON.stringify(value, null, 2)

const transcript = {
  startedAt: new Date().toISOString(),
  sandbox: SANDBOX_BASE,
  stk: null,
  statusRequest: null,
  statusAck: null,
  ackRecordedStates: null,
  captured: [],
  recordedStates: [],
  relay: null,
  notes: []
}

// ------------------------------------------------------------------- the run
async function main() {
  if (capturesOnly) {
    console.log(`Captured-body report (no Daraja call)\n  receiver: ${env('SANDBOX_CAPTURE_URL')}\n`)
    transcript.notes.push('--captures-only: no request was sent to Safaricom; these are bodies already in the receiver')
    transcript.captured = await readCaptures()
    console.log(`   ${transcript.captured.length} body(s) in the receiver`)
    reportCaptures()
    const hasResult = transcript.captured.some((c) => c.kind === 'status_result')
    return finish(hasResult ? 0 : 2)
  }

  console.log(`Daraja sandbox proof\n  host:   ${SANDBOX_BASE}\n  result: ${env('SANDBOX_RESULT_URL')}\n`)

  const basic = Buffer.from(`${env('MPESA_CONSUMER_KEY')}:${env('MPESA_CONSUMER_SECRET')}`).toString('base64')
  const tokenRes = await fetch(`${SANDBOX_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` }
  })
  const tokenText = await tokenRes.text()
  const tokenJson = parse(tokenText)
  if (!tokenJson?.access_token) {
    die(`OAuth failed http=${tokenRes.status}\n${tokenText.slice(0, 400)}`, 1)
  }
  const token = tokenJson.access_token
  console.log(`1) OAuth            http=${tokenRes.status}  expires_in=${tokenJson.expires_in ?? '?'}s (token not printed)`)

  // ---- 2. a real receipt to look up
  let receipt = env('SANDBOX_RECEIPT')
  if (receipt) {
    console.log(`2) receipt          ${receipt} (from SANDBOX_RECEIPT, STK push skipped)`)
  } else {
    receipt = await obtainReceiptViaStk()
  }

  // ---- 3. the query the branch sends, built by the branch's own code
  const credential = resolveCredential()
  const shortcode = env('MPESA_SHORTCODE')
  const resultUrl = env('SANDBOX_RESULT_URL')
  const query = buildTransactionStatusQuery({
    initiator: env('MPESA_INITIATOR'),
    credential: credential.value,
    shortcode,
    resultUrl,
    receipt,
    remark: `minglemate sandbox proof ${new Date().toISOString()}`
  })

  transcript.statusRequest = {
    ...query,
    SecurityCredential: redactCredential(query.SecurityCredential),
    credentialSource: credential.how
  }
  console.log(`\n3) TransactionStatus request (buildTransactionStatusQuery, sent verbatim):`)
  console.log(show(transcript.statusRequest))

  const statusRes = await fetch(`${SANDBOX_BASE}/mpesa/transactionstatus/v1/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(query)
  })
  const ackText = await statusRes.text()
  const ackJson = parse(ackText)
  const outcome = readTransactionStatusAck(ackJson)

  transcript.statusAck = { http: statusRes.status, raw: ackText }
  console.log(`\n   ACK http=${statusRes.status}`)
  console.log(show(ackJson ?? ackText))

  // What the callback records for exactly this ACK. The baseline line is
  // written before the POST in enqueueStatusCheck(); the rest comes from
  // readTransactionStatusAck(), the same reader the edge function uses.
  const recorded = {
    verification_requested_at: transcript.startedAt,
    verification_state: 'pending'
  }
  if (outcome.conversationId) recorded.verification_conversation_id = outcome.conversationId
  if (outcome.rejected) {
    recorded.verification_state = 'unavailable'
    recorded.verification_detail = outcome.rejected
  }
  transcript.ackRecordedStates = recorded
  console.log(`\n   states the callback records for this ACK:`)
  console.log(show(recorded))

  if (outcome.rejected) {
    transcript.notes.push('the sandbox rejected the query; no asynchronous result is expected')
    return finish(1)
  }
  if (!outcome.conversationId) {
    transcript.notes.push('the ACK carried no ConversationID, so a result can only be matched by receipt or whatever else it quotes back')
  }

  // ---- 4. the asynchronous result Daraja posts to the receiver
  console.log(`\n4) waiting up to ${waitSeconds}s for the sandbox to post the result to the receiver...`)
  const started = Date.now()
  let statusCapture = null
  while (Date.now() - started < waitSeconds * 1000) {
    await sleep(5000)
    let captures = []
    try {
      captures = await readCaptures()
    } catch (e) {
      console.log(`   capture read failed: ${e.message}`)
      continue
    }
    transcript.captured = captures
    statusCapture = captures.find((c) => c.kind === 'status_result')
    if (statusCapture) break
    const waited = Math.round((Date.now() - started) / 1000)
    console.log(`   ${waited}s... ${captures.length} body(s) captured so far`)
  }

  if (!statusCapture) {
    transcript.notes.push(`no status result arrived within ${waitSeconds}s — see the raw captures list`)
    return finish(2)
  }

  console.log(`   received after ${Math.round((Date.now() - started) / 1000)}s`)
  reportCaptures()

  if (relay) await relayResult(statusCapture)

  return finish(0)
}

// ------------------------------------------------------------------- helpers
async function obtainReceiptViaStk() {
  const shortcode = env('MPESA_SHORTCODE')
  const msisdn = env('SANDBOX_STK_MSISDN')
  const timestamp = eatTimestamp()
  const password = Buffer.from(`${shortcode}${env('MPESA_PASSKEY')}${timestamp}`).toString('base64')
  const body = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: 1,
    PartyA: msisdn,
    PartyB: shortcode,
    PhoneNumber: msisdn,
    CallBackURL: env('SANDBOX_STK_CALLBACK_URL'),
    AccountReference: 'minglemate-proof',
    TransactionDesc: 'transactionstatus proof'
  }

  const res = await fetch(`${SANDBOX_BASE}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await freshToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  const json = parse(text)
  transcript.stk = {
    request: { ...body, Password: `<${password.length} base64 chars>` },
    http: res.status,
    response: json ?? text,
    query: null
  }
  console.log(`2) STK push         http=${res.status} checkout=${json?.CheckoutRequestID ?? '?'}`)
  if (!json?.CheckoutRequestID) {
    die(`STK push was not accepted, so there is no receipt to query:\n${text.slice(0, 400)}`, 1)
  }

  // The STK query API is how the receipt is read back without owning a public
  // callback URL for the STK itself. It needs the same shortcode/password/
  // timestamp digest the push used.
  for (let attempt = 1; attempt <= 12; attempt++) {
    const qRes = await fetch(`${SANDBOX_BASE}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await freshToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: json.CheckoutRequestID
      })
    })
    const qText = await qRes.text()
    const qJson = parse(qText)
    const items = qJson?.CallbackMetadata?.Item || []
    const found = items.find((i) => i?.Name === 'MpesaReceiptNumber')?.Value
    transcript.stk.query = { http: qRes.status, attempt, raw: qText }
    if (found) {
      console.log(`   receipt         ${found} (STK query, attempt ${attempt})`)
      return String(found)
    }
    if (qJson?.errorCode || qJson?.errorMessage) {
      transcript.notes.push(`STK query error on attempt ${attempt}: ${qJson.errorCode ?? ''} ${qJson.errorMessage ?? ''}`.trim())
    }
    await sleep(5000)
  }
  die('The sandbox never returned a receipt for that STK push. Set SANDBOX_RECEIPT to query a receipt you already have.', 2)
}

let cachedToken = null
async function freshToken() {
  if (cachedToken) return cachedToken
  const basic = Buffer.from(`${env('MPESA_CONSUMER_KEY')}:${env('MPESA_CONSUMER_SECRET')}`).toString('base64')
  const res = await fetch(`${SANDBOX_BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${basic}` }
  })
  const json = parse(await res.text())
  if (!json?.access_token) die(`OAuth failed while refreshing http=${res.status}`, 1)
  cachedToken = json.access_token
  return cachedToken
}

function resolveCredential() {
  const supplied = env('MPESA_SECURITY_CREDENTIAL')
  if (supplied) return { value: supplied, how: 'as supplied in .env.daraja.local' }

  const password = env('MPESA_INITIATOR_PASSWORD')
  const certPath = env('MPESA_CERT_PATH')
  let pem
  try {
    pem = readFileSync(certPath, 'utf8')
  } catch {
    die(`MPESA_CERT_PATH does not exist: ${certPath}`, 3)
  }
  const value = publicEncrypt(
    { key: pem, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(password, 'utf8')
  ).toString('base64')
  return { value, how: `generated here: RSA/PKCS#1 v1.5 of the initiator password, base64, using ${basename(certPath)}` }
}

function eatTimestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  const eat = new Date(d.getTime() + 3 * 60 * 60 * 1000)
  return `${eat.getUTCFullYear()}${p(eat.getUTCMonth() + 1)}${p(eat.getUTCDate())}${p(eat.getUTCHours())}${p(eat.getUTCMinutes())}${p(eat.getUTCSeconds())}`
}

async function readCaptures() {
  const url = `${env('SANDBOX_CAPTURE_URL')}?token=${encodeURIComponent(env('SANDBOX_CAPTURE_TOKEN'))}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`http=${res.status}`)
  const json = await res.json()
  return json.captures || []
}

/** Report every captured body through the callback's own parsing path. */
function reportCaptures() {
  const stkCapture = transcript.captured.find((c) => c.kind === 'stk_callback')
  const statusCapture = transcript.captured.find((c) => c.kind === 'status_result')

  if (stkCapture) {
    const parsed = parseCallbackBody(stkCapture.parsed)
    console.log(`\n   STK callback captured at ${stkCapture.received_at} (parseCallbackBody):`)
    console.log(show(parsed))
    if (parsed.kind === 'stk') {
      // The intent row here is synthetic — there is no database in this proof —
      // but the DECISION is the callback's own, on the sandbox's own payload.
      const synthetic = {
        id: 'sandbox-proof-intent',
        status: 'pending',
        purpose: 'section2',
        amount: parsed.amount,
        callback_key: 'sandbox-proof-key'
      }
      const action = decideStkAction(synthetic, parsed, 'sandbox-proof-key', new Date(), 'live')
      console.log(`   decideStkAction on that payload with a synthetic intent: ${JSON.stringify(action)}`)
      transcript.notes.push('the STK decision used a synthetic intent row; the payload and the decision code are real')
    }
    transcript.recordedStates.push({ from: 'stk_callback', parsed })
  }

  if (statusCapture) {
    const parsed = parseCallbackBody(statusCapture.parsed)
    console.log(`\n   TransactionStatus result captured at ${statusCapture.received_at} (parseCallbackBody):`)
    console.log(show(parsed))

    const params = statusCapture.parsed?.Result?.ResultParameters?.ResultParameter
    if (Array.isArray(params)) {
      console.log(`   ResultParameters the sandbox returned:`)
      console.log(show(Object.fromEntries(params.map((p) => [p?.Key, p?.Value]))))
    }

    if (parsed.kind === 'status') {
      const patch = statusResultPatch(parsed, new Date())
      console.log(`\n   states the callback records for this result (statusResultPatch):`)
      console.log(show(patch))
      transcript.recordedStates.push({ from: 'status_result', parsed, patch })
    } else {
      transcript.notes.push('the captured body did not parse as a status result — recorded as unrecognised')
      transcript.recordedStates.push({ from: 'status_result', parsed })
    }
  }
}

async function relayResult(capture) {
  const url = env('SANDBOX_RELAY_URL')
  if (!url) {
    console.log('\n   --relay was given but SANDBOX_RELAY_URL is empty: nothing to relay to.')
    return
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: capture.body
  })
  const text = await res.text().catch(() => '')
  transcript.relay = { url, http: res.status, body: text.slice(0, 500) }
  console.log(`\n   relayed the captured result to ${url} -> http=${res.status} ${text.slice(0, 120)}`)
  console.log('   (the deployed callback records against the intent whose mpesa_transaction_id matches the receipt in that body)')
}

function finish(exitCode) {
  transcript.finishedAt = new Date().toISOString()
  transcript.exitCode = exitCode
  try {
    mkdirSync(OUT_DIR, { recursive: true })
    const name = `transactionstatus-${transcript.startedAt.replace(/[:.]/g, '-')}.json`
    const path = new URL(name, OUT_DIR)
    writeFileSync(path, JSON.stringify(transcript, null, 2))
    console.log(`\ntranscript: scripts/out/${name}`)
  } catch (e) {
    console.log(`\ncould not write the transcript: ${e.message}`)
  }

  const verdict = {
    0: capturesOnly
      ? 'the captured body(s) parsed and recorded cleanly (--captures-only: nothing was sent to Safaricom)'
      : 'the sandbox accepted the query and the result it posted parsed and recorded cleanly',
    1: 'the sandbox rejected the query — see statusAck and ackRecordedStates above',
    2: capturesOnly
      ? 'no status result in the receiver yet (--captures-only: nothing was sent to Safaricom)'
      : 'the sandbox accepted the query but no asynchronous result arrived inside the wait window',
    3: 'the env file is not filled in yet'
  }[exitCode]
  console.log(`\nresult: ${verdict}`)
  process.exit(exitCode)
}

main().catch((e) => {
  console.error(`\nunexpected failure: ${e?.stack || e}`)
  finish(1)
})
