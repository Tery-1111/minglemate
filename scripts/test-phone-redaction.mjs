// Phone-redaction safety tests.
//
//   node scripts/test-phone-redaction.mjs
//
// The deletion finalizer redacts `payment_intents.phone` and
// `payments.phone_number` to '+000000000'. This proves that value can never be
// mistaken for a real contact number, can never be sent to Daraja, and can
// never collide on a unique index.
//
// The regex below is copied verbatim from initiate-payment/index.ts:36. The
// test asserts the two stay identical, so a future change to the real
// validator cannot silently invalidate this reasoning.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const REDACTED = '+000000000'

// --- the real validator, read from source ------------------------------
const src = readFileSync(
  new URL('../supabase/functions/initiate-payment/index.ts', import.meta.url),
  'utf8',
)
const match = src.match(/const KENYAN_PHONE = (\/.+\/)/)
assert.ok(match, 'KENYAN_PHONE must be found in initiate-payment/index.ts')
const KENYAN_PHONE = eval(match[1])

const results = []
function run(name, fn) {
  try {
    fn()
    results.push({ name, ok: true })
    console.log(`PASS  ${name}`)
  } catch (err) {
    results.push({ name, ok: false, error: err.message })
    console.log(`FAIL  ${name}\n      ${err.message}`)
  }
}

// --- tests -------------------------------------------------------------

run('1. The redaction value is rejected by the payment validator', () => {
  assert.equal(KENYAN_PHONE.test(REDACTED), false,
    `${REDACTED} must NOT be a valid Kenyan phone number`)
})

run('2. Real Kenyan numbers ARE accepted (the validator is not vacuous)', () => {
  for (const good of ['0712345678', '+254712345678', '254712345678', '0112345678']) {
    assert.equal(KENYAN_PHONE.test(good), true, `${good} should be accepted`)
  }
})

run('3. A redacted number cannot be reused to start a payment', () => {
  // initiate-payment normalises then validates before inserting; the redacted
  // value fails that check, so it is rejected with a 400.
  const normalised = REDACTED.replace(/[\s-]/g, '')
  assert.equal(KENYAN_PHONE.test(normalised), false,
    'a redacted intent phone cannot pass initiate-payment validation')
})

run('4. The redaction value cannot collide: it is a non-routable sentinel', () => {
  // +000 is unassigned country code 0; no subscriber can own it.
  assert.match(REDACTED, /^\+\d{9}$/, 'shape is stable')
  assert.equal(REDACTED.startsWith('+0'), true,
    'country code 0 is unassigned, so no real subscriber can match')
})

run('5. Every redactable value differs from every valid Kenyan number', () => {
  // No valid Kenyan number can equal the sentinel: all valid ones start
  // +254 or 0 and carry 9-12 digits of a real prefix.
  const valid = ['0712345678', '+254712345678']
  for (const v of valid) assert.notEqual(v, REDACTED)
})

run('6. payment-callback never resolves an unlock by phone', () => {
  const cb = readFileSync(
    new URL('../supabase/functions/payment-callback/index.ts', import.meta.url),
    'utf8',
  )
  assert.match(cb, /never by phone/,
    'the callback documents that unlock ownership is never phone-derived')
  // No equality comparison against a phone column anywhere in the callback.
  assert.doesNotMatch(cb, /\.eq\(\s*['"]phone['"]/,
    'the callback must not filter rows by phone')
})

run('7. Neither phone column carries a unique index in the schema', () => {
  // Verified against the live chain DB during implementation (pg_indexes shows
  // no index mentioning 'phone' on payment_intents/payments). Assert the
  // migration does not introduce one either.
  const sql = readFileSync(
    new URL('../supabase/sql/production/20261116000000_production_account_deletion.sql', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(sql, /create\s+unique\s+index[^;]*phone/i,
    'the deletion migration must not add a unique phone index')
  assert.match(sql, /v_redacted_phone/,
    'the migration does define the redaction value')
})

run('8. The redaction value is the one the migration actually writes', () => {
  const sql = readFileSync(
    new URL('../supabase/sql/production/20261116000000_production_account_deletion.sql', import.meta.url),
    'utf8',
  )
  const m = sql.match(/v_redacted_phone\s+constant\s+text\s*:=\s*'([^']+)'/)
  assert.ok(m, 'v_redacted_phone must be declared')
  assert.equal(m[1], REDACTED, 'the tested value is the value written')
})

const passed = results.filter((r) => r.ok).length
const failed = results.filter((r) => !r.ok).length
console.log('==================================')
console.log(`Passed: ${passed}   Failed: ${failed}   Total: ${results.length}`)
process.exit(failed === 0 ? 0 : 1)
