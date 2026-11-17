# Account deletion — implementation package

Two-phase, retention-safe account deletion. Prepared for owner review; **nothing
here has been applied to production, deployed, committed, pushed or merged.**

## What was broken

`Settings.jsx` called `supabase.rpc('request_account_deletion')`. Production
(`mhdjnhiqahsllbczbzpk`) has never had that function, so PostgREST answered:

> Could not find the function public.request_account_deletion by parameters in the schema cache

Production also cannot take the chain's copy of the function: it adopted a
schema baseline and its replay guard
(`20260901000000_production_chain_replay_guard.sql`) aborts any chain replay.
The chain version also deleted immediately, and its cascading FKs would have
destroyed the payment and contact-unlock evidence the Privacy Policy says to keep.

## Files

| File | Purpose |
| --- | --- |
| `supabase/sql/production/20261116000000_production_account_deletion.sql` | The production artifact: request table, request RPC, service-role finalizer, retention FK corrections. |
| `supabase/sql/production/verify_account_deletion.sql` | Read-only post-apply check (26 assertions). No DDL/DML. |
| `supabase/migrations/20261116000000_account_deletion_two_phase.sql` | Forward migration for chain/staging. Same idempotent body. |
| `supabase/functions/request-account-deletion/index.ts` | Orchestrator (two clients, fixed order, retry-safe). |
| `supabase/functions/request-account-deletion/storage-cleanup.ts` | Storage API cleanup; dynamic buckets, UUID prefix, pagination. |
| `supabase/functions/request-account-deletion/storage-cleanup.test.ts` | 13 storage tests. |
| `supabase/config.toml` | `[functions.request-account-deletion] verify_jwt = true`. |
| `src/pages/Settings.jsx` | Calls the Edge Function; retention disclosure; retry path. |
| `scripts/test-account-deletion-ui.mjs` | 9 Settings tests. |
| `scripts/run-storage-tests.mjs` | Node runner for the storage tests (no Deno here). |
| `scripts/account-deletion-{fixture,schema,assert,negative}.sql` | Throwaway-DB harness proving the SQL. |

## Apply order (owner, controlled release)

1. **Production SQL** — run `supabase/sql/production/20261116000000_production_account_deletion.sql`
   once against production. Do **not** replay the chain.
2. **Verify** — run `supabase/sql/production/verify_account_deletion.sql`; every row must say `PASS`.
3. **Deploy the function** — `supabase functions deploy request-account-deletion`
   (JWT verification on; the `SUPABASE_SERVICE_ROLE_KEY` secret must be present,
   never in the browser).
4. **Frontend** — ship the `Settings.jsx` change.

Rollback lives in `supabase/rollback/` by convention; this package only *tightens*
FK behaviour, so a rollback would restore CASCADE and re-introduce data loss —
it should not be applied casually.

## Tests

```bash
node scripts/test-otp-flow.mjs              # 12 pass (regression)
node scripts/run-storage-tests.mjs          # 13 pass
node scripts/test-account-deletion-ui.mjs   # 9 pass
npx vite build                              # succeeds

# SQL behaviour, in a throwaway local database only:
docker exec -i supabase_db_minglemate psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q < scripts/account-deletion-fixture.sql
docker exec -i supabase_db_minglemate psql -U postgres -d acct_del_scratch -v ON_ERROR_STOP=1 -q < scripts/account-deletion-schema.sql
docker exec -i supabase_db_minglemate psql -U postgres -d acct_del_scratch -v ON_ERROR_STOP=1 -q < supabase/sql/production/20261116000000_production_account_deletion.sql
docker exec -i supabase_db_minglemate psql -U postgres -d acct_del_scratch -v ON_ERROR_STOP=1 -q < scripts/account-deletion-assert.sql     # 28 pass
docker exec -i supabase_db_minglemate psql -U postgres -d acct_del_scratch -v ON_ERROR_STOP=1 -q < scripts/account-deletion-negative.sql   # 7 pass
```

## Sequence the Edge Function enforces

1. Verify Bearer token (identity comes from here, never the body).
2. `request_account_deletion()` as the user → record, pause, mute.
3. Storage API cleanup.
4. `finalize_account_deletion(user_id)` as service role.
5. Revoke sessions, then delete the auth user — last.

A failure at any step leaves the request and the paused profile intact and
returns `{ success: false, pending: true }`. The finalizer is idempotent, so a
retry after step 4 is safe, and the auth user still exists because it is
deleted last.

## Notes for reviewers

- `payment_intents.phone` and `payments.phone_number` are NOT NULL in production.
  The finalizer redacts them to `+000000000` rather than nulling.
- `connect_unlocks` rows are retained with **both** `buyer_id` and `seller_id`
  nulled, so `get_unlocked_contacts()` (which filters on `buyer_id`) can no
  longer surface the snapshot to the remaining participant.
- Pending intents become `expired`, and `payment-callback` only consumes
  `status = 'pending'`, so a late callback cannot mint a new unlock.
