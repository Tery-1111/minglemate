// Verifies the payment callback's branch decisions.
//
//   node scripts/verify-payment-ticket.mjs
//
// The callback's ordering lives in supabase/functions/payment-callback/
// ticket.ts as pure functions, so it can be executed here instead of being
// read out of a header comment. Node strips the types natively (22.18+/24),
// so this needs no dependencies and no build step.
//
// Each block below pins the behaviour that was previously only asserted in
// prose, including the three defects this was written for:
//   * the failure branch never checked the callback key;
//   * the async re-verify could not change any outcome;
//   * an intent had no expiry, so a stale callback could still unlock.

import { readFileSync } from 'node:fs'

import {
  amountMatches,
  buildTransactionStatusQuery,
  classifyCacheError,
  decideStkAction,
  expiryBlocksUnlock,
  parseCallbackBody,
  readTransactionStatusAck,
  screenTicket,
  statusResultPatch,
  unlockTarget,
  verificationFromStatusResult
} from '../supabase/functions/payment-callback/ticket.ts'

// Source with comment lines removed, so the drift checks at the end assert on
// code and not on the prose that deliberately names the SQL function.
function code(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return (
        !t.startsWith('//') &&
        !t.startsWith('*') &&
        !t.startsWith('/*') &&
        !t.startsWith('--')
      )
    })
    .join('\n')
}

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
}

const KEY = 'c0ffee00-1111-2222-3333-4444444444aa'
const NOW = new Date('2026-10-14T12:00:00.000Z')

function intent(overrides = {}) {
  return {
    id: 'intent-1',
    status: 'pending',
    purpose: 'section2',
    amount: 200,
    // No expires_at: the row shape no longer carries the window, because the
    // verdict comes from public.payment_intent_expiry_state() in the database.
    callback_key: KEY,
    unlock_state: null,
    ...overrides
  }
}

function stk(overrides = {}) {
  return {
    kind: 'stk',
    resultCode: 0,
    resultDesc: 'The service request is processed successfully.',
    checkoutId: 'ws_CO_123',
    receipt: 'QK12ABC34',
    amount: 200,
    ...overrides
  }
}

// ---------------------------------------------------------------- parsing
{
  const success = parseCallbackBody({
    Body: {
      stkCallback: {
        MerchantRequestID: 'm-1',
        CheckoutRequestID: 'ws_CO_123',
        ResultCode: 0,
        ResultDesc: 'ok',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 200 },
            { Name: 'MpesaReceiptNumber', Value: 'QK12ABC34' },
            { Name: 'PhoneNumber', Value: 254700000000 }
          ]
        }
      }
    }
  })
  check('parses an STK success callback', success.kind === 'stk' && success.resultCode === 0 &&
    success.checkoutId === 'ws_CO_123' && success.receipt === 'QK12ABC34' && success.amount === 200,
    JSON.stringify(success))

  const stringAmount = parseCallbackBody({
    Body: { stkCallback: { ResultCode: 0, CheckoutRequestID: 'ws', CallbackMetadata: { Item: [{ Name: 'Amount', Value: '200' }] } } }
  })
  check('accepts Amount sent as a string', stringAmount.amount === 200, JSON.stringify(stringAmount.amount))

  const failed = parseCallbackBody({
    Body: { stkCallback: { ResultCode: 1032, ResultDesc: 'Request cancelled by user', CheckoutRequestID: 'ws_CO_9' } }
  })
  check('parses a cancelled STK callback', failed.kind === 'stk' && failed.resultCode === 1032 &&
    failed.receipt === null && failed.amount === null, JSON.stringify(failed))

  const status = parseCallbackBody({
    Result: {
      ResultType: 0,
      ResultCode: 0,
      ResultDesc: 'The service request is processed successfully.',
      OriginatorConversationID: 'o-1',
      ConversationID: 'c-1',
      TransactionID: 'QK12ABC34'
    }
  })
  check('parses the async transaction-status result',
    status.kind === 'status' && status.conversationId === 'c-1' && status.transactionId === 'QK12ABC34',
    JSON.stringify(status))

  check('reports an unrecognised body instead of guessing',
    parseCallbackBody({}).kind === 'unknown' &&
    parseCallbackBody(null).kind === 'unknown' &&
    parseCallbackBody({ Body: { stkCallback: null } }).kind === 'unknown', '')
}

// ------------------------------ the sandbox's wire contract, pinned as code
// scripts/sandbox-transactionstatus.mjs sends the query this builds and reads
// the ACK and the result with these same functions, so whatever it captures
// from the real sandbox is evidence about the branch rather than about a
// replica of it. 'Occasion' is the exact spelling Daraja documents — not
// 'Occassion' — and IdentifierType 4 is the organization shortcode.
{
  const query = buildTransactionStatusQuery({
    initiator: 'testapi',
    credential: 'encrypted-credential',
    shortcode: '174379',
    resultUrl: 'https://example.test/functions/v1/payment-callback',
    receipt: 'QK12ABC34',
    remark: 'minglemate intent-1'
  })

  check('the status query carries exactly the documented fields',
    JSON.stringify(Object.keys(query).sort()) === JSON.stringify([
      'CommandID', 'IdentifierType', 'Initiator', 'Occasion', 'PartyA',
      'QueueTimeOutURL', 'Remarks', 'ResultURL', 'SecurityCredential', 'TransactionID'
    ].sort()),
    JSON.stringify(Object.keys(query)))

  check('the query looks up the receipt, runs as the shortcode, and posts both answers to the result URL',
    query.TransactionID === 'QK12ABC34' && query.PartyA === '174379' &&
    query.IdentifierType === '4' && query.CommandID === 'TransactionStatusQuery' &&
    query.ResultURL === query.QueueTimeOutURL && query.ResultURL.startsWith('https://') &&
    query.Occasion === 'PaymentCorroboration' && query.Remarks === 'minglemate intent-1' &&
    query.SecurityCredential === 'encrypted-credential',
    JSON.stringify({ ...query, SecurityCredential: '<redacted>' }))

  check('no field is sent that Daraja does not document',
    Object.entries(query).every(([, v]) => typeof v === 'string' && v.length > 0),
    'every value is a non-empty string, so nothing is silently dropped by JSON typing')

  check('the identifier type can be overridden if the sandbox insists on another value',
    buildTransactionStatusQuery({
      initiator: 'testapi', credential: 'c', shortcode: '174379',
      resultUrl: 'https://example.test/r', receipt: 'R1', remark: 'm', identifierType: '2'
    }).IdentifierType === '2', '')

  const ack = readTransactionStatusAck({
    OriginatorConversationID: '1236-7134259-1',
    ConversationID: 'AG_20210709_1234409f86436c583e3f',
    ResponseCode: '0',
    ResponseDescription: 'Accept the service request successfully.'
  })
  check('an accepted query yields the ConversationID the async result will quote back',
    ack.conversationId === 'AG_20210709_1234409f86436c583e3f' &&
    ack.originatorConversationId === '1236-7134259-1' && ack.rejected === null,
    JSON.stringify(ack))

  const ackNumberZero = readTransactionStatusAck({ ResponseCode: 0, ConversationID: 'c-9' })
  check('a ResponseCode that is the number 0 is accepted too, not read as a rejection',
    ackNumberZero.rejected === null && ackNumberZero.conversationId === 'c-9', JSON.stringify(ackNumberZero))

  const rejectedAck = readTransactionStatusAck({
    ResponseCode: '500.001.1001', ResponseDescription: 'Invalid initiator information'
  })
  check('a rejected query records the rejection verbatim, code and description together',
    rejectedAck.rejected === 'status query rejected: 500.001.1001 Invalid initiator information' &&
    rejectedAck.conversationId === null, JSON.stringify(rejectedAck))

  check('an empty or absent ACK is neither accepted nor rejected, and does not throw',
    readTransactionStatusAck({}).rejected === null &&
    readTransactionStatusAck({}).conversationId === null &&
    readTransactionStatusAck(undefined).rejected === null &&
    readTransactionStatusAck(null).conversationId === null &&
    readTransactionStatusAck('<html>gateway</html>').rejected === null, '')

  const confirmedPatch = statusResultPatch(
    { kind: 'status', resultCode: 0, resultDesc: 'ok', conversationId: 'c-1', originatorConversationId: null, transactionId: 'QK1' },
    NOW
  )
  check('a confirming result is recorded as confirmed, with the moment it was recorded',
    confirmedPatch.verification_state === 'confirmed' &&
    confirmedPatch.verification_detail === '0: ok (txn QK1)' &&
    confirmedPatch.verified_at === NOW.toISOString(), JSON.stringify(confirmedPatch))

  const contradictedPatch = statusResultPatch(
    { kind: 'status', resultCode: 1, resultDesc: 'The transaction specified does not exist', conversationId: 'c-1', originatorConversationId: null, transactionId: null },
    NOW
  )
  check('a result that contradicts the callback is recorded as contradicted, never as confirmed',
    contradictedPatch.verification_state === 'contradicted' &&
    contradictedPatch.verification_detail === '1: The transaction specified does not exist',
    JSON.stringify(contradictedPatch))

  const indexCode = code('../supabase/functions/payment-callback/index.ts')
  check('index.ts sends the builder\'s query and reads the ACK with the shared reader',
    /buildTransactionStatusQuery\(/.test(indexCode) &&
    /readTransactionStatusAck\(/.test(indexCode) &&
    /statusResultPatch\(/.test(indexCode) &&
    !/SecurityCredential/.test(indexCode) && !/Initiator/.test(indexCode),
    'no request field is spelled out in the edge function any more')
}

// ----------------------------------------------------------------- tickets
{
  check('matching key verifies', screenTicket(intent(), KEY).ok === true, '')

  const wrong = screenTicket(intent(), 'not-the-key')
  check('wrong key refuses with 401/wrong_key',
    wrong.ok === false && wrong.httpStatus === 401 && wrong.ticketState === 'wrong_key', JSON.stringify(wrong))

  const missing = screenTicket(intent(), null)
  check('absent key refuses with 401/missing_key',
    missing.ok === false && missing.ticketState === 'missing_key', JSON.stringify(missing))

  const nullKey = screenTicket(intent({ callback_key: null }), KEY)
  check('an intent with no key refuses rather than skipping the check (R1 was inert without the column)',
    nullKey.ok === false && nullKey.ticketState === 'no_key_on_intent', JSON.stringify(nullKey))

  const absentColumn = screenTicket(intent({ callback_key: undefined }), KEY)
  check('a missing callback_key column also refuses (fail-closed)',
    absentColumn.ok === false && absentColumn.ticketState === 'no_key_on_intent', JSON.stringify(absentColumn))

  const emptyKey = screenTicket(intent({ callback_key: '' }), KEY)
  check('an empty stored key refuses', emptyKey.ok === false && emptyKey.ticketState === 'no_key_on_intent', '')
}

// ------------------------------------------------ defect 1: failure branch
{
  const noKey = decideStkAction(intent(), stk({ resultCode: 1032, receipt: null, amount: null }), null, NOW, 'live')
  check('failure branch without the key cannot mark the intent failed (defect 1)',
    noKey.type === 'reject_ticket' && noKey.httpStatus === 401 && noKey.ticketState === 'missing_key',
    JSON.stringify(noKey))

  const wrongKey = decideStkAction(intent(), stk({ resultCode: 1032, receipt: null, amount: null }), 'nope', NOW, 'live')
  check('failure branch with the wrong key cannot mark the intent failed',
    wrongKey.type === 'reject_ticket' && wrongKey.ticketState === 'wrong_key', JSON.stringify(wrongKey))

  const failed = decideStkAction(intent(), stk({ resultCode: 1032, resultDesc: 'cancelled', receipt: null, amount: null }), KEY, NOW, 'live')
  check('failure branch with the key records the failure and unlocks nothing',
    failed.type === 'record_failed' && failed.reason.includes('1032'), JSON.stringify(failed))

  const late = decideStkAction(intent({ status: 'succeeded' }), stk({ resultCode: 1032, receipt: null, amount: null }), KEY, NOW, 'live')
  check('a failure arriving after the intent succeeded is a no-op',
    late.type === 'noop', JSON.stringify(late))
}

// ------------------- the window: a database verdict, not a local calculation
// The RULE lives in SQL (public.payment_intent_expiry_state); what is pinned
// here is the ORDERING — which verdicts close the unlock path — and the fact
// that no second copy of the rule exists in the edge function.
{
  const decided = (state, overrides = {}) =>
    decideStkAction(intent(overrides), stk(), KEY, NOW, state)

  const lateGenuine = decided('expired')
  check('a genuine callback after the window is recorded, not unlocked (defect 3)',
    lateGenuine.type === 'late_callback' && lateGenuine.genuine === true &&
    lateGenuine.patch.status === 'expired' && typeof lateGenuine.patch.late_callback_at === 'string',
    JSON.stringify(lateGenuine))

  const lateWrongAmount = decideStkAction(intent(), stk({ amount: 1 }), KEY, NOW, 'expired')
  check('a post-expiry callback with the wrong amount is not treated as genuine',
    lateWrongAmount.type === 'late_callback' && lateWrongAmount.genuine === false &&
    lateWrongAmount.patch.late_callback_at === undefined, JSON.stringify(lateWrongAmount))

  const alreadyExpired = decideStkAction(intent({ status: 'expired' }), stk(), KEY, NOW, 'live')
  check('a row already swept to expired never unlocks, whatever the verdict says',
    alreadyExpired.type === 'late_callback', JSON.stringify(alreadyExpired))

  check('only the expired verdict closes the unlock path',
    expiryBlocksUnlock('expired') === true &&
    ['live', 'no_window', 'no_intent', 'unavailable'].every((s) => expiryBlocksUnlock(s) === false),
    ['expired', 'live', 'no_window', 'no_intent', 'unavailable']
      .map((s) => `${s}=${expiryBlocksUnlock(s)}`).join(' '))

  const inWindow = decided('live')
  check('a callback inside the window proceeds', inWindow.type === 'process', JSON.stringify(inWindow))

  check('no window on the row is recorded as unenforced, not silently trusted',
    decided('no_window').type === 'process', JSON.stringify(decided('no_window')))

  check('a vanished row does not silently expire the payment',
    decided('no_intent').type === 'process', JSON.stringify(decided('no_intent')))

  check('an unanswerable verdict does not strand a real payment',
    decided('unavailable').type === 'process', JSON.stringify(decided('unavailable')))
}

// ----------------------------------------- the rule exists exactly once (SQL)
{
  const ticketCode = code('../supabase/functions/payment-callback/ticket.ts')
  const indexCode = code('../supabase/functions/payment-callback/index.ts')
  // The SQL these checks read is the consolidated chain — the single entrypoint,
  // and the only file the deployment applies. The bundle this block used to read
  // (supabase/sql/payment_intent_lifecycle.sql) was folded into it and moved to
  // supabase/sql/superseded/ for provenance, where it is no longer maintained:
  // asserting against a retired copy would pass while the shipping schema drifted.
  const lifecycleCode = code('../supabase/migrations/20261014150000_consolidated_schema_chain.sql')

  check('ticket.ts holds no expiry arithmetic and never reads the column',
    !/expires_at/.test(ticketCode) && !/getTime\(\)/.test(ticketCode) && !/new Date\(/.test(ticketCode),
    'expires_at / getTime() / new Date() all absent from the decision module')

  check('index.ts asks the database for the verdict',
    /rpc\(\s*'payment_intent_expiry_state'/.test(indexCode),
    'rpc(payment_intent_expiry_state) call site')

  check('index.ts passes no clock and compares no timestamps itself',
    !/expires_at\s*[<>]/.test(indexCode) && /p_intent_id/.test(indexCode),
    'no local expiry comparison; the intent id is all the database is given')

  check('the window is written down once in SQL, not twice',
    (lifecycleCode.match(/interval '30 minutes'/g) || []).length === 1,
    `${(lifecycleCode.match(/interval '30 minutes'/g) || []).length} literal window(s)`)

  check('no SQL object compares expires_at except the verdict function',
    (lifecycleCode.match(/[^_]expires_at\s*</g) || []).length === 0,
    `${(lifecycleCode.match(/[^_]expires_at\s*</g) || []).length} stray comparison(s)`)

  check('the sweep and the audit view both go through the verdict',
    (lifecycleCode.match(/public\.payment_intent_expiry_state\(/g) || []).length >= 2,
    `${(lifecycleCode.match(/public\.payment_intent_expiry_state\(/g) || []).length} callers in SQL`)
}

// --------------------------------------- replays, retries and the amount set
{
  const applied = decideStkAction(intent({ status: 'succeeded', unlock_state: 'applied' }), stk(), KEY, NOW, 'live')
  check('a redelivered callback for a completed unlock is an idempotent no-op',
    applied.type === 'noop', JSON.stringify(applied))

  const stranded = decideStkAction(intent({ status: 'succeeded', unlock_state: null }), stk(), KEY, NOW, 'live')
  check('an intent consumed without a recorded unlock retries it (previously unrecoverable)',
    stranded.type === 'retry_unlock', JSON.stringify(stranded))

  const failedUnlock = decideStkAction(intent({ status: 'succeeded', unlock_state: 'failed' }), stk(), KEY, NOW, 'live')
  check('an intent whose unlock failed retries it',
    failedUnlock.type === 'retry_unlock', JSON.stringify(failedUnlock))

  const mismatch = decideStkAction(intent(), stk({ amount: 1 }), KEY, NOW, 'live')
  check('an amount that is not the server price is refused',
    mismatch.type === 'amount_mismatch', JSON.stringify(mismatch))

  check('amount tolerance is a cent, not exact float equality',
    amountMatches(200, 200.0) === true && amountMatches(200, 200.01) === true &&
    amountMatches(200, 201) === false && amountMatches(200, null) === false &&
    amountMatches(200, '200') === true, '')

  const dead = decideStkAction(intent({ status: 'failed' }), stk(), KEY, NOW, 'live')
  check('a failed intent never unlocks on a later success callback',
    dead.type === 'noop', JSON.stringify(dead))
}

// ------------------------------------- the "someone else won" vs infra error
{
  check('no cache error means this caller won the race',
    classifyCacheError(null) === 'inserted', '')
  check('a unique violation means another caller is processing',
    classifyCacheError({ code: '23505' }) === 'duplicate' &&
    classifyCacheError({ status: 409 }) === 'duplicate', '')
  check('a missing table or permission error is NOT mistaken for a race',
    classifyCacheError({ code: '42P01', message: 'relation does not exist' }) === 'error' &&
    classifyCacheError({ code: '42501' }) === 'error' &&
    classifyCacheError({ message: 'fetch failed' }) === 'error', '')
}

// ------------------------------------------------- defect 2: the re-verify
{
  const confirmed = verificationFromStatusResult({
    kind: 'status', resultCode: 0, resultDesc: 'ok', conversationId: 'c', originatorConversationId: 'o', transactionId: 'QK1'
  })
  check('a status result with a receipt confirms the payment',
    confirmed.state === 'confirmed' && confirmed.detail.includes('QK1'), JSON.stringify(confirmed))

  const noTxn = verificationFromStatusResult({
    kind: 'status', resultCode: 0, resultDesc: 'ok', conversationId: 'c', originatorConversationId: 'o', transactionId: null
  })
  check('a status result without a receipt is a contradiction, not a confirmation',
    noTxn.state === 'contradicted', JSON.stringify(noTxn))

  const notFound = verificationFromStatusResult({
    kind: 'status', resultCode: 1, resultDesc: 'The transaction specified does not exist', conversationId: 'c', originatorConversationId: 'o', transactionId: null
  })
  check('Daraja reporting no such transaction is recorded as a contradiction',
    notFound.state === 'contradicted' && notFound.detail.includes('does not exist'), JSON.stringify(notFound))
}

// ------------------------------------------------------- the unlock targets
{
  check('purpose decides the unlock path, never the caller',
    unlockTarget('force_connect') === 'force_connect' &&
    unlockTarget('connect_tier1') === 'contact_unlock' &&
    unlockTarget('connect_tier2') === 'contact_unlock' &&
    unlockTarget('connect_qrashe') === 'contact_unlock' &&
    unlockTarget('section2') === 'section2' &&
    unlockTarget('anything-else') === 'unknown' &&
    unlockTarget(null) === 'unknown', '')
}

// ------------------------------------------- end-to-end at the decision level
{
  const purposes = ['section2', 'force_connect', 'connect_tier2']
  const walked = purposes.map((purpose) => {
    const first = decideStkAction(intent({ purpose }), stk(), KEY, NOW, 'live')
    const after = decideStkAction(intent({ purpose, status: 'succeeded', unlock_state: null }), stk(), KEY, NOW, 'live')
    const settled = decideStkAction(intent({ purpose, status: 'succeeded', unlock_state: 'applied' }), stk(), KEY, NOW, 'live')
    return { purpose, first: first.type, after: after.type, settled: settled.type }
  })
  check('every unlock purpose walks process -> retry_unlock -> noop',
    walked.every((w) => w.first === 'process' && w.after === 'retry_unlock' && w.settled === 'noop'),
    JSON.stringify(walked))
}

// ------------------------------------------------------------------- report
console.log('\n=========== PAYMENT CALLBACK BRANCH VERIFICATION ===========')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`)
}
const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
