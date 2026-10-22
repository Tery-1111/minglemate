// Ticket screening and branch decisions for M-Pesa payment callbacks.
//
// Everything in this file is pure: no Deno APIs, no network, no clock of
// its own (the caller passes `now`). The rules the callback enforces are
// therefore executable — scripts/verify-payment-ticket.mjs asserts every
// branch instead of trusting a comment.
//
// The two Daraja bodies that reach payment-callback are different shapes
// and mean different things:
//
//   * STK callback — {"Body":{"stkCallback":{...}}}. Unsigned. It is the
//     ONLY thing that can authorize an unlock, and only when it presents
//     the per-intent key bound into the STK CallBackURL.
//   * transaction-status result — {"Result":{...}}, the async answer to
//     the transactionstatus query. It carries NO intent key, so it can
//     never authorize or revoke anything; it is recorded as corroboration
//     and contradictions are surfaced for a human.

export type IntentRow = {
  id: string
  status: string
  purpose?: string | null
  amount?: number | string | null
  // Deliberately absent: `expires_at`. The window's verdict is asked of
  // public.payment_intent_expiry_state() in the database and passed in as an
  // ExpiryState. Re-declaring the column here is exactly how a second copy
  // of the expiry rule would start.
  callback_key?: string | null
  unlock_state?: string | null
}

export type StkCallback = {
  kind: 'stk'
  resultCode: number
  resultDesc: string
  checkoutId: string | null
  receipt: string | null
  amount: number | null
}

export type StatusResult = {
  kind: 'status'
  resultCode: number
  resultDesc: string
  conversationId: string | null
  originatorConversationId: string | null
  transactionId: string | null
}

export type ParsedBody = StkCallback | StatusResult | { kind: 'unknown' }

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

/** Classify a callback body. Anything unrecognised is reported, not guessed. */
export function parseCallbackBody(body: any): ParsedBody {
  const stk = body?.Body?.stkCallback
  if (stk && typeof stk === 'object') {
    const items: any[] = stk?.CallbackMetadata?.Item || []
    const find = (name: string) => items.find((i) => i?.Name === name)?.Value
    return {
      kind: 'stk',
      resultCode: num(stk.ResultCode) ?? 1,
      resultDesc: String(stk.ResultDesc ?? ''),
      checkoutId: str(stk.CheckoutRequestID),
      receipt: str(find('MpesaReceiptNumber')),
      amount: num(find('Amount'))
    }
  }

  const result = body?.Result
  if (result && typeof result === 'object') {
    return {
      kind: 'status',
      resultCode: num(result.ResultCode) ?? 1,
      resultDesc: String(result.ResultDesc ?? ''),
      conversationId: str(result.ConversationID),
      originatorConversationId: str(result.OriginatorConversationID),
      transactionId: str(result.TransactionID)
    }
  }

  return { kind: 'unknown' }
}

export type TicketState = 'verified' | 'missing_key' | 'wrong_key' | 'no_key_on_intent'

export type TicketOutcome =
  | { ok: true; ticketState: 'verified' }
  | { ok: false; httpStatus: 401; ticketState: Exclude<TicketState, 'verified'>; reason: string }

/**
 * The genuineness guard, applied BEFORE any payload field is trusted and
 * applied identically on the failure branch and the success branch.
 *
 * A key that is absent, wrong, or unanswerable (the intent has no key to
 * compare against — it predates the column) all refuse. The old behaviour
 * skipped the comparison when the intent had no key, which is what made
 * the control inert on any database where harden_resilience.sql had not
 * run.
 */
export function screenTicket(intent: IntentRow, presentedKey: string | null): TicketOutcome {
  const expected = typeof intent.callback_key === 'string' && intent.callback_key.length > 0
    ? intent.callback_key
    : null

  if (!expected) {
    return {
      ok: false,
      httpStatus: 401,
      ticketState: 'no_key_on_intent',
      reason: 'intent carries no callback key to verify against'
    }
  }

  if (!presentedKey) {
    return { ok: false, httpStatus: 401, ticketState: 'missing_key', reason: 'no ?ck= presented' }
  }

  if (presentedKey !== expected) {
    return { ok: false, httpStatus: 401, ticketState: 'wrong_key', reason: '?ck= does not match' }
  }

  return { ok: true, ticketState: 'verified' }
}

/**
 * The database's verdict on the window, taken verbatim from
 * public.payment_intent_expiry_state() (supabase/sql/payment_intent_lifecycle.sql).
 *
 * This module deliberately performs no date arithmetic of its own. The window
 * (payment_intent_window), the comparison, and the meaning of a row with no
 * expiry all live in SQL, because the sweep (expire_stale_payment_intents) and
 * the audit view (payment_intent_anomalies) read the same function. One rule,
 * three callers — there is no second copy to drift out of step.
 *
 *   'expired'     — outside the window: may be recorded, never unlocked
 *   'live'        — inside the window
 *   'no_window'   — the row carries no expiry, so nothing is enforced for it
 *   'no_intent'   — the row vanished under us (a concurrent delete)
 *   'unavailable' — the database could not answer; see resolveExpiryState()
 */
export type ExpiryState = 'live' | 'expired' | 'no_window' | 'no_intent' | 'unavailable'

/**
 * Only one verdict closes the unlock path. Everything else means "not proven
 * expired", which is the behaviour the previous client-side helper had when
 * the column was absent or unparseable: record it loudly, keep the money
 * honest, and let expire_stale_payment_intents() terminalise the row.
 */
export function expiryBlocksUnlock(state: ExpiryState): boolean {
  return state === 'expired'
}

/** The amount is compared against the SERVER-set price on the intent. */
export function amountMatches(expected: unknown, presented: unknown): boolean {
  const want = num(expected)
  const got = num(presented)
  if (want === null || got === null) return false
  return Math.abs(got - want) <= 0.01
}

export type UnlockTarget = 'force_connect' | 'contact_unlock' | 'section2' | 'unknown'

/** What the money buys is decided by the intent row, never by the caller. */
export function unlockTarget(purpose: string | null | undefined): UnlockTarget {
  if (purpose === 'force_connect') return 'force_connect'
  if (purpose === 'connect_tier1' || purpose === 'connect_tier2' || purpose === 'connect_qrashe') {
    return 'contact_unlock'
  }
  if (purpose === 'section2') return 'section2'
  return 'unknown'
}

export type CacheOutcome = 'inserted' | 'duplicate' | 'error'

/**
 * The idempotency cache answers exactly one question: did this caller win
 * the race? Only a unique violation means "someone else is processing".
 * Any other failure (missing table, permissions) is an infrastructure
 * error and MUST NOT be mistaken for a race — that mistake silently
 * aborted the unlock after the payment had already been taken.
 */
export function classifyCacheError(error: any): CacheOutcome {
  if (!error) return 'inserted'
  const code = String(error.code ?? '')
  const status = Number(error.status ?? 0)
  if (code === '23505' || status === 409) return 'duplicate'
  return 'error'
}

export type VerificationState = 'confirmed' | 'contradicted'

/**
 * Map a transaction-status result onto evidence. ResultCode 0 WITH a
 * transaction id is independent confirmation that the receipt exists.
 * ResultCode 0 WITHOUT one, or any non-zero code (Daraja reports a
 * non-existent transaction this way), is a contradiction.
 */
export function verificationFromStatusResult(result: StatusResult): {
  state: VerificationState
  detail: string
} {
  const detail = `${result.resultCode}: ${result.resultDesc || 'no description'}`
  if (result.resultCode === 0 && result.transactionId) {
    return { state: 'confirmed', detail: `${detail} (txn ${result.transactionId})` }
  }
  return { state: 'contradicted', detail }
}

/** True once the paid-for effect has been recorded for this intent. */
export function unlockAlreadyApplied(intent: IntentRow): boolean {
  return intent.unlock_state === 'applied'
}

export type StkAction =
  | { type: 'reject_ticket'; httpStatus: 401; ticketState: Exclude<TicketState, 'verified'>; reason: string }
  | { type: 'record_failed'; reason: string }
  | { type: 'noop' }
  | { type: 'late_callback'; genuine: boolean; patch: Record<string, unknown> }
  | { type: 'retry_unlock' }
  | { type: 'amount_mismatch'; reason: string }
  | { type: 'process' }

/**
 * The complete ordering for an STK callback, in one place.
 *
 * index.ts performs the I/O this decides; nothing about the ordering lives
 * outside this function, so tests can walk every branch. Order matters:
 * the ticket is screened first, so an unauthenticated caller can never
 * mark an intent failed, expire it, or learn anything about it.
 *
 * The expiry verdict arrives as `expiryState` — decided by the database, not
 * here — so this function holds the *ordering* while SQL holds the *rule*.
 */
export function decideStkAction(
  intent: IntentRow,
  callback: StkCallback,
  presentedKey: string | null,
  now: Date,
  expiryState: ExpiryState
): StkAction {
  const ticket = screenTicket(intent, presentedKey)
  if (!ticket.ok) {
    return {
      type: 'reject_ticket',
      httpStatus: ticket.httpStatus,
      ticketState: ticket.ticketState,
      reason: ticket.reason
    }
  }

  // Failure / cancellation.
  if (callback.resultCode !== 0) {
    if (intent.status === 'pending') {
      return {
        type: 'record_failed',
        reason: `Daraja ${callback.resultCode}: ${callback.resultDesc}`
      }
    }
    return { type: 'noop' }
  }

  if (intent.status === 'failed') {
    return { type: 'noop' }
  }

  // Expiry — the database's verdict, passed in. A row already carrying
  // status 'expired' is the same condition, already recorded by the sweep.
  if (intent.status === 'expired' || expiryBlocksUnlock(expiryState)) {
    const genuine = amountMatches(intent.amount, callback.amount)
    const patch: Record<string, unknown> = {
      status: 'expired',
      status_reason: genuine
        ? 'genuine callback after expiry — recorded for reconciliation, not unlocked'
        : `callback after expiry with unmatching amount (${callback.amount})`
    }
    if (genuine) patch.late_callback_at = now.toISOString()
    return { type: 'late_callback', genuine, patch }
  }

  if (intent.status === 'succeeded') {
    // Consumed already. If the unlock never landed, re-apply it — both RPCs
    // are idempotent. Otherwise this is the idempotent no-op it looks like.
    return unlockAlreadyApplied(intent) ? { type: 'noop' } : { type: 'retry_unlock' }
  }

  if (!amountMatches(intent.amount, callback.amount)) {
    return {
      type: 'amount_mismatch',
      reason: `Amount mismatch (callback ${callback.amount}, intent ${intent.amount})`
    }
  }

  return { type: 'process' }
}

// ------------------------------------------------------------------
// The transactionstatus request, its ACK, and the patch it records.
// ------------------------------------------------------------------
// These sit beside the parser for the result they answer so the sandbox
// harness (scripts/sandbox-transactionstatus.mjs) can send the SAME bytes
// the callback sends and read the answer with the SAME code. A test that
// rebuilds the request by hand proves nothing about production: it keeps
// passing while the real one drifts.

/** The exact request body enqueueStatusCheck() POSTs to Daraja. */
export type TransactionStatusQuery = {
  Initiator: string
  SecurityCredential: string
  CommandID: 'TransactionStatusQuery'
  TransactionID: string
  PartyA: string
  IdentifierType: string
  ResultURL: string
  QueueTimeOutURL: string
  Remarks: string
  Occasion: string
}

export type TransactionStatusQueryInput = {
  initiator: string
  /** The RSA-encrypted initiator credential, passed through verbatim. */
  credential: string
  shortcode: string
  resultUrl: string
  /** The MpesaReceiptNumber the STK callback carried: the documented lookup key. */
  receipt: string
  /** Free text; the callback puts the intent id here so a human can reconcile. */
  remark: string
  /** IdentifierType 4 = organization shortcode, which is what PartyA is. */
  identifierType?: string
}

export function buildTransactionStatusQuery(
  input: TransactionStatusQueryInput
): TransactionStatusQuery {
  return {
    Initiator: input.initiator,
    SecurityCredential: input.credential,
    CommandID: 'TransactionStatusQuery',
    TransactionID: input.receipt,
    PartyA: input.shortcode,
    IdentifierType: input.identifierType ?? '4',
    ResultURL: input.resultUrl,
    QueueTimeOutURL: input.resultUrl,
    Remarks: input.remark,
    Occasion: 'PaymentCorroboration'
  }
}

/**
 * What the ACK means. Daraja's answer to the POST says only that the query
 * was queued: it carries the ConversationID the async result quotes back.
 * A non-zero ResponseCode is a rejection, and it is recorded as such rather
 * than left looking like a query still in flight.
 */
export type TransactionStatusAck = {
  conversationId: string | null
  originatorConversationId: string | null
  /** null when Daraja accepted the query; the rejection text otherwise. */
  rejected: string | null
}

export function readTransactionStatusAck(ack: any): TransactionStatusAck {
  const rawCode = ack?.ResponseCode
  return {
    conversationId: str(ack?.ConversationID),
    originatorConversationId: str(ack?.OriginatorConversationID),
    rejected: rawCode && String(rawCode) !== '0'
      ? `status query rejected: ${rawCode} ${str(ack?.ResponseDescription) ?? ''}`.trim()
      : null
  }
}

/** The exact patch the callback writes when an async status result arrives. */
export function statusResultPatch(result: StatusResult, at: Date): Record<string, unknown> {
  const { state, detail } = verificationFromStatusResult(result)
  return {
    verification_state: state,
    verification_detail: detail,
    verified_at: at.toISOString()
  }
}
