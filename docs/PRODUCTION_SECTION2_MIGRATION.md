# Production Section 2 / Connect migration (2026-10-22)

Target: Supabase project **`minglemate`**, ref **`mhdjnhiqahsllbczbzpk`** —
the database behind the Vercel production deployment.
Staging (`minglemate-staging`, `ifiewinipbxxfvzpzezd`) was **not** modified.

## Why production needed its own migration

Staging was built from this repository's migration chain, so
`20261021120000`, `20261021130000` and `20261022130000` apply there as written.
Production was never built from that chain. A read-only capture on 2026-10-22
showed:

| Object | Production state (before) |
| --- | --- |
| `users` | legacy columns; `section2_unlocked`, `section2_free_expires_at`, `phone`, `whatsapp_number`, `display_phone`, `email`, legacy `section2_responses` array; **no** `share_*`, **no** social handles |
| `section2_responses` | 40 rows, `UNIQUE(user_id, question_number)` |
| `section2_chat_progress` | 1 row, `contacts_unlocked = true` (the 14-question reveal had fired) |
| `match_history` | 1 row, tier slots present |
| `matches` | legacy shape: `user_a_id`/`user_b_id`, `status ∈ {pending,interested,discarded,matched,ghosted}`, `is_visible`, `compatibility_score NOT NULL`; 1 row, `matched` |
| `user_blocks`, `connect_unlocks`, `payment_intents`, `conversations`, `processed_payment_callbacks` | **absent** |
| `profiles_public`, `my_profile()` | **absent** |
| reveal | `trg_contacts_unlocked → enforce_contacts_unlocked()`, `trg_auto_contact_reveal → handle_contact_reveal()`, both live |
| grants | `anon`/`authenticated` held table-level DML on every public table; every `users` row was readable in full by any signed-in user (`users` policy `Users can read matched users profiles` = `true`) |
| `supabase_migrations` | schema absent — no recorded history |
| Edge Functions | `run-weekly-matching`, `send-notification`, `intasend-webhook`, `generate-weekly-matches`, `match-generator`, `check-admin`; **no** `initiate-payment`, **no** `payment-callback` |
| secrets | `INTASEND_*`, `ONESIGNAL_*`, `ADMIN_UUID`, Supabase keys; **no** `MPESA_*` |

Replaying the chain here is unsafe: its matches-shape stage would reconcile a
live table, and `20261022130000`'s `complete_force_connect` writes
`conversations` before that table exists.

## What was applied

Two production-only files, applied transactionally through the Management API
and recorded in `supabase_migrations.schema_migrations`:

1. `supabase/sql/production/20261022150000_production_baseline_objects.sql`
   — consent + social columns, `user_blocks`, `payment_intents`,
   `processed_payment_callbacks`, `connect_unlocks`, `conversations`,
   `profiles_public`, `my_profile()`, baseline marker table.
2. `supabase/sql/production/20261022160000_production_section2_contacts.sql`
   — reveal removal and pin, `is_section2_partner()`, Section 2 policies,
   `users_are_paired()`, `complete_connect_unlock()`,
   `complete_force_connect()`, D3 `get_unlocked_contacts()`, contact-column
   privilege lockdown, unsafe-state correction.

They are **not** in `supabase/migrations/`: the chain-built databases already
carry this shape and the matches statements target production's legacy table.
`supabase/migrations/20260901000000_production_chain_replay_guard.sql` sorts
before every chain file and raises if `public.production_schema_baseline`
exists, so a `supabase db push` against production aborts before any chain
statement runs. Staging and local stacks do not have the marker and treat the
guard as a no-op.

### Production differences from the staging builds

* `matches.status` is `matched`, never `active`; `is_section2_partner()` and
  `users_are_paired()` admit `('active','matched')` and exclude the one-sided
  `interested`.
* `complete_force_connect()` writes only production columns
  (`user_a_id, user_b_id, status, is_visible, compatibility_score`), promotes
  an existing pair instead of duplicating it, and uses the active Qrashe
  conversation as the idempotency marker.
* `pin_section2_contacts_flag()` forces `contacts_unlocked = false` on INSERT
  **and** UPDATE. Staging preserves `OLD`; production still carried a `true`
  value, so preserving it would have kept the unsafe state.
* `users` table-level SELECT is replaced by per-column grants that withhold
  `phone`, `whatsapp_number`, `display_phone`, `email`, the three social
  handles and the legacy `section2_responses` array. `my_profile()` is the
  self read path; `profiles_public` is the public projection.

## Migration history reconciliation

`schema_migrations` now records:

| version | how it got there |
| --- | --- |
| `20261022150000` | executed on production |
| `20261022160000` | executed on production |
| `20261021120000` | **adopted** — complete intended effect present and verified; no staging SQL was replayed |
| `20261021130000` | **adopted** — same |
| `20261022130000` | **adopted** — same (pairing predicate + Force Connect work on the live `matches` shape) |

The remaining chain versions predate this adoption and are deliberately **not**
recorded: their effects are not fully present in production. Production is
never migrated with `supabase db push`; the replay guard makes that fail closed.

## Verification performed on production

All writes below ran inside `BEGIN … ROLLBACK`; no row, payment, block,
conversation or unlock created during testing survives. Existing counts were
compared before and after.

* **Section 2 free access** — as user B, own rows `0`, matched partner A's rows
  `20`, unpaired user C's rows `0`, progress row `1`. Free write: an insert and
  an update of an own Section 2 answer succeeded (rolled back).
* **Blocking** — after inserting a block against the matched partner, that
  partner's rows read `0` and `is_section2_partner()` returned `false`, while
  `users_are_paired()` stayed `true` (blocking denies the read, it does not
  fabricate an unmatch).
* **Question count cannot reveal** — raising `questions_discussed` did not
  change `contacts_unlocked`; a client UPDATE setting it `true` was forced back
  to `false`; no `contacts_unlocked = true` row remains.
* **Payment evidence is required** — a `pending` Connect intent produced no
  unlock; a `succeeded` Connect intent produced exactly one snapshot, one
  locked conversation and one system message; a second callback produced no
  duplicate; a `succeeded` Connect intent for an **unpaired** pair produced
  nothing.
* **Channel consent** — snapshot taken with the owner's email sharing on:
  reveal returned it; owner switched sharing off: reveal returned `null`; owner
  switched it back on: reveal returned it again.
* **Unrelated and unpaid callers** — an unrelated signed-in user calling
  `get_unlocked_contacts` got `0` rows.
* **Force Connect** — a `succeeded` force-connect intent called twice produced
  exactly one `matches` row (`status='matched'`), one active Qrashe
  conversation, one system message and one notification; `users_are_paired()`
  reported the new pair; **no** contact channel became visible.
* **Anonymous callers** — `anon` has no EXECUTE on `users_are_paired`,
  `is_section2_partner`, `complete_connect_unlock`, `complete_force_connect`,
  `get_unlocked_contacts` or `my_profile`; a client `select email from users`
  is denied by the server (`42501`).
* **Reveal removed** — zero functions and triggers named
  `enforce_contacts_unlocked` / `handle_contact_reveal`; `contacts_unlocked`
  false on the one row.
* **Data preserved** — users `3`, section2 responses `40`, progress `1`,
  matches `1`, match_history `1`, payments `1`, messages `6`,
  token_purchases `0`, reports `2` before and after. No payment record was
  deleted, re-keyed or reinterpreted.

## Edge Functions deployed

| function | version | verify_jwt |
| --- | --- | --- |
| `initiate-payment` | 1 | `true` |
| `payment-callback` | 1 | `false` (Daraja cannot present a JWT; the per-intent `ck` ticket authenticates the callback) |

Smoke tests: `initiate-payment` with no header → `401`, with a malformed
bearer → `401`; `payment-callback` with an unknown checkout id → `200 ok`.

`initiate-payment` now derives the Daraja base URL from `MPESA_ENV` (sandbox
unless `production`), closing F-45, and refuses with `503` before creating an
intent when any of `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`,
`MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL` is missing.

## Remaining production blocker (owner action)

**No `MPESA_*` secret exists on production**, so no Connect or Force Connect
purchase can complete there yet. `initiate-payment` fails closed with `503` and
creates no intent; nothing is unlocked without a verified payment. To finish
the payment path the owner must add, in Supabase → Project Settings → Edge
Functions secrets:

* `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`,
  `MPESA_PASSKEY`
* `MPESA_CALLBACK_URL` pointing at
  `https://mhdjnhiqahsllbczbzpk.supabase.co/functions/v1/payment-callback`
* `MPESA_ENV=production` (and optionally `MPESA_INITIATOR`,
  `MPESA_SECURITY_CREDENTIAL`, `SUPABASE_FUNCTION_URL` for the corroborating
  status query)

Until then a Connect purchase cannot be started, which is the fail-closed
behaviour this migration guarantees: no payment, no contact.

The legacy `intasend-webhook` is untouched and keeps settling historical
IntaSend purchases (`users.section2_unlocked`), a flag no policy, helper or UI
path reads any more. The legacy `payments` table is untouched and is never
treated as Connect evidence: it has no purpose and no recipient column.

## Product-visible caveat

All three production users have an email address and no phone/WhatsApp/social
handles, and `share_email` defaults to **off** (the app's own default). A
Connect payment therefore reveals nothing until the owner of that profile
enables at least one channel in Settings → Sharing. The reveal returns an
all-null row in that case, which the client already treats as "nothing shared".

## Repo checks

* `node scripts/verify-section2-contact-rules.mjs` → 60/60
* `node scripts/verify-section2-isolation.mjs` → pass
* `node scripts/verify-force-connect-pairing.mjs` → 17/17
* `npm run verify` → exit 0 (131 PASS lines)
* `npm run build` → exit 0 (480 modules)
* `npm run lint` → **pre-existing failure** (25 errors / 19 warnings, all
  `react-hooks/immutability`, unused-variable and exhaustive-deps findings in
  untouched code; none in the files this change edited).
