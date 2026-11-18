# Matching Reliability — Rollback

Companion to `MATCHING_RELIABILITY_RELEASE_MANIFEST.md` and `MATCHING_RELIABILITY_DEPLOYMENT_RUNBOOK.md`.

The change set has two halves and they roll back independently: the **Edge Function** (fully revertible, no data impact) and the **database objects** (forward-only, deliberately conservative). No step in this document deletes user data, deletes `match_history`, or drops a published allocation.

---

## 1. Revert the Edge Function only (fastest, safest)

Use this when the function misbehaves and the database state is trustworthy.

1. Restore the previous generator from this branch's history:

   ```bash
   git show e8a7859:supabase/functions/match-generator/index.ts > /tmp/match-generator.previous.ts
   ```

2. Redeploy that artifact with the branch's deployment procedure (`supabase functions deploy match-generator --project-ref <ref>`) from a checkout that contains only the previous file.

3. Consequence: the previous generator writes `match_history` directly and does not mint generations. The fencing tables and RPCs stay in place, unused, which is harmless. `match_week_generations` simply stops advancing.

4. Verify: the Matches screen still renders for users with an existing allocation, and the manual/cron invocation returns the previous summary shape (no `generation` field).

**Do not** drop the fencing objects during a function rollback: they are never read by the previous generator, and dropping them would make a later re-deploy of the fenced generator fail its pre-flight.

---

## 2. Restore the pre-MM-D2 verdicts (database, forward-only)

If the `PT409` mapping has to be withdrawn while keeping the fencing behaviour, publish a **new** migration that recreates `public.publish_week_allocation(text, bigint, jsonb)` with the previous `raise exception` SQLSTATEs (`40001`, messages `stale_generation` / `generation_conflict`), keeping every other property: signature, `for update` lock, fence-before-write, payload comparison, replay no-op, week-scoped replace, `SECURITY DEFINER`, `search_path = public`, and the ACLs.

Rules:

* Never edit `20261119120000_match_publication_pt409.sql` after it has been applied anywhere — add a new forward migration instead.
* Redeploy the matching generator version that classifies on the restored codes, otherwise conflicts surface as `500 publish_failed` (the current generator deliberately promotes only `PT409` + exact message to 409).
* Consequence of restoring `40001`: PostgREST drops the connection for that SQLSTATE, so a losing concurrent run waits for the gateway timeout (~61 s) instead of receiving 409. The allocation itself remains correct; only the response is degraded.

---

## 3. Withdraw the fencing build entirely (last resort, ordered)

Only if the fencing infrastructure itself must be removed. The generator must be rolled back first (§1), otherwise publication fails closed.

```sql
-- 1. remove the RPCs
drop function if exists public.publish_week_allocation(text, bigint, jsonb);
drop function if exists public.begin_match_generation(text);

-- 2. remove the fence table and sequence
drop table if exists public.match_week_generations;
drop sequence if exists public.match_generation_seq;
```

Then remove the two versions from the target's migration history **only if** they are being re-applied later; leaving them recorded is the safer default. `match_history` — the source of truth for published pairs — is never touched: the last published week stays visible to users exactly as delivered.

---

## 4. Recovering from a failed or interrupted publication

| Situation | Action |
| --- | --- |
| Stale run rejected (`409 stale_generation`) | None. Nothing was written; the live allocation is intact. Re-run the generator to mint a new generation. |
| Payload conflict (`409 generation_conflict`) | None. The generation already published a different allocation; re-run the generator for a fresh one. |
| Transport failure with no response code | The generator performs one recovery read of the fence row and reports the true state. No retry, no partial write. |
| Publication aborted mid-way | The RPC is a single transaction: the week-scoped `delete` + `insert` rolled back, the previous week's rows survive. Confirm with `select count(*) from public.match_history where week_id = '<week>'` and the fence row's `latest_published_generation`. |
| Week must be regenerated | Re-run the generator. It mints a higher generation and replaces that week atomically. Never `delete from match_history` by hand. |

---

## 5. Things not to do

* Do not delete `match_week_generations` rows for a real week; the fence is what prevents an older run from overwriting a newer allocation.
* Do not lower the generation sequence or write `latest_published_generation` by hand.
* Do not retry a conflicting publication in a loop: the generator is intentionally non-retrying so that losers of a race never overwrite the winner.
* Do not roll back by resetting the database or truncating tables.
* Do not revert `matchingAllocation.ts` / `matchingEligibility.ts` / `match-generator/index.ts` independently; the generator requires both shared modules and its error classification assumes the `PT409` RPC.
