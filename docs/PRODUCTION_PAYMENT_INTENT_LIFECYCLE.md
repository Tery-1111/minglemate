# Production payment-intent lifecycle

Target: `minglemate`, ref `mhdjnhiqahsllbczbzpk`.
Migration: [20261022170000_production_payment_intent_lifecycle.sql](../supabase/sql/production/20261022170000_production_payment_intent_lifecycle.sql)

## The defect

The deployed `payment-callback` (v1, `verify_jwt=false`) was written against the
staging lifecycle schema:

- `rpc('payment_intent_expiry_state', { p_intent_id })` — the expiry verdict;
- `payment_intents.expires_at`;
- ticket / verification / unlock bookkeeping columns;
- `status = 'expired'`.

Production had none of these. `payment_intent_expiry_state` did not exist, so
`resolveExpiryState()` returned `'unavailable'` — logged, but not an enforced
expiry. `status` admitted only `pending|succeeded|failed`, so a late callback's
`status='expired'` write failed too, and every `record()` update named columns
that did not exist. The callback's own design (record a late genuine callback,
name the unlock outcome) was therefore inert on production.

The Edge Function code was already correct and is matched byte-for-byte by the
repository source. **Only the schema was missing; no Edge Function redeploy
was required.**

## What was applied

Additive only, no table or column dropped, no delete:

1. `public.payment_intent_window()` = 30 minutes, the one window definition.
2. `payment_intents.expires_at timestamptz not null default (now() + payment_intent_window())`;
   existing rows backfilled from `created_at` (never `now()`).
3. `payment_intents_status_check` now admits `expired`.
4. Twelve bookkeeping columns: `ticket_state`, `status_reason`,
   `verification_requested_at`, `verification_conversation_id`,
   `verification_state`, `verification_detail`, `verified_at`, `unlock_state`,
   `unlock_applied_at`, `unlock_error`, `late_callback_at` (plus `expires_at`).
5. Three state CHECKs matching exactly the values the callback writes.
6. `public.payment_intent_expiry_state(uuid, timestamptz default now())` —
   `SECURITY INVOKER`, `STABLE`, one comparison, `no_intent` for a missing row.
   Revoked from `anon`, `authenticated` and `PUBLIC`; granted to `service_role`
   only (the role the callback uses).
7. A post-check inside the same transaction: missing columns, status CHECK,
   column default, the function's own verdict, and the function ACL all raise,
   which rolls the whole file back.

Deliberately **not** included: `expire_stale_payment_intents()` and the
`payment_intent_anomalies` view. Nothing in production calls them; the callback
does not need them. They are a separate, operator-facing change.

## Verification (rollback-scoped, then live)

Rehearsed as one transaction ending in a forced exception, so nothing committed:

- verdicts `live`, `expired` (stale row), `live`/`expired` under a pinned
  `p_at`, `no_intent` for an unknown id;
- a full bookkeeping write (`status='expired'`, ticket, verification, unlock,
  late callback) landed; `unlock_state='bogus'` was rejected;
- 23 columns, status CHECK includes `expired`, default is
  `(now() + payment_intent_window())`;
- `anon` EXECUTE false, `service_role` EXECUTE true.

After applying, through the **real deployed function over HTTP** (synthetic
intents, amount 1, no charge, no real receipt):

| case | result |
| --- | --- |
| stale intent, genuine amount | `200 ok`; `status=expired`, `ticket_state=verified`, `status_reason` set, `late_callback_at` set, `mpesa_transaction_id` null, no unlock fields |
| live intent, no recipient | `200 ok`; `status=succeeded`, `ticket_state=verified`, `verification_state=unavailable` naming the missing Daraja config, `unlock_state=no_effect`, `unlock_error='intent has no recipient'` |

No user, match, conversation, unlock, notification or purchase row changed.
Both test intents and their idempotency cache row were deleted; row counts are
identical to the pre-change baseline (users 3, section2_responses 40, progress 1,
matches 1, match_history 1, payments 1, messages 6, token_purchases 0, reports 2,
payment_intents 0, processed_payment_callbacks 0, connect_unlocks 0,
conversations 0, user_blocks 0).

A late callback reaching `status=expired` is itself the proof that the verdict
RPC answered: had it failed, the callback would have treated the row as live and
taken the success path.

## Owner configuration still missing (reported, not a code defect)

The synthetic success callback recorded
`verification_state='unavailable'` with
`not requested — missing MPESA_INITIATOR, MPESA_SECURITY_CREDENTIAL,
MPESA_SHORTCODE, MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET,
SUPABASE_FUNCTION_URL`.

That is the async transaction-status corroboration path only; it does not gate
an unlock. Live payments additionally still need the Connect price and STK push
configuration used by `initiate-payment` (`MPESA_CONSUMER_KEY`,
`MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`,
`MPESA_CALLBACK_URL`, `MPESA_ENV=production`). Until those secrets exist,
Connect fails closed with 503 and creates no intent — no payment, no contact.
No secret value is recorded here or in the repository.
