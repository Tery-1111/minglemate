# Matching Reliability — Deployment Runbook

Companion to `MATCHING_RELIABILITY_RELEASE_MANIFEST.md`. Nothing here has been executed against a hosted environment: this runbook is written for the owner to run after approval.

Local development configuration referenced below comes from `supabase/config.toml` in this branch (`project_id = "minglemate"`, API `54321`, DB `54322`). Hosted identifiers are **not** hard-coded anywhere in this document: supply them through the Supabase CLI link (`supabase link`) or through a `SUPABASE_DB_URL` you export yourself. Never paste secrets into a shell history or a document.

---

## 1. Target verification (read-only, do this first)

Run against the target database, before applying anything:

```sql
-- migration history
select version, name from supabase_migrations.schema_migrations order by version;

-- do the release objects already exist?
select to_regclass('public.match_week_generations') as fence_table,
       to_regclass('public.match_generation_seq')    as generation_seq;

select p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('begin_match_generation', 'publish_week_allocation');

-- is the PT409 revision already in place?
select pg_get_functiondef(p.oid) ilike '%PT409%' as pt409_installed,
       pg_get_functiondef(p.oid) ilike '%40001%' as legacy_40001
from pg_proc p where p.proname = 'publish_week_allocation';

-- privileges
select has_function_privilege('service_role', 'public.publish_week_allocation(text,bigint,jsonb)', 'EXECUTE') as svc_exec,
       has_function_privilege('authenticated','public.publish_week_allocation(text,bigint,jsonb)', 'EXECUTE') as auth_exec,
       has_function_privilege('anon',         'public.publish_week_allocation(text,bigint,jsonb)', 'EXECUTE') as anon_exec,
       has_table_privilege('service_role',  'public.match_week_generations', 'SELECT') as svc_fence_read,
       has_table_privilege('authenticated', 'public.match_week_generations', 'SELECT') as auth_fence_read;
```

Expected before deployment: no fence objects, no RPCs (or, on a database that already ran an earlier fencing build, `pt409_installed = false` and `legacy_40001 = true`).

Also confirm the history is consistent for the 13 pre-existing migrations. `20261113120000_users_update_privilege_hardening` is expected to remain unrecorded (see the manifest, §3).

---

## 2. Migration application order

Order is mandatory; the second migration replaces the function the first one creates.

1. `20261118120000_match_generation_fencing.sql`
2. `20261119120000_match_publication_pt409.sql`

`20261116000000_account_deletion_two_phase.sql` is already part of this branch's release scope and precedes these two; do not re-apply it as part of the matching deployment.

### Option A — CLI (preferred when the target is linked)

```bash
supabase link --project-ref <owner-supplied ref>
supabase migration list --linked          # confirm what the target records
supabase db push --linked                 # applies only the unapplied migrations, in order
```

`supabase db push` refuses to run when the target history diverges; if it reports a divergence, stop and reconcile the history first (this release does not authorize repairs).

### Option B — explicit SQL (preferred when the target is a database you reach with `psql`)

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 \
  -f supabase/migrations/20261118120000_match_generation_fencing.sql
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 \
  -f supabase/migrations/20261119120000_match_publication_pt409.sql
```

Then record the two versions in the target's history so future `db push` runs stay consistent:

```sql
insert into supabase_migrations.schema_migrations (version, statements, name) values
  ('20261118120000', '{}', 'match_generation_fencing'),
  ('20261119120000', '{}', 'match_publication_pt409')
on conflict (version) do nothing;
```

Both migrations are re-runnable (`create ... if not exists`, `create or replace function`, `add column if not exists`, idempotent grants), so a partial retry is safe.

Do not drop or truncate application data, and do not reset the database.

---

## 3. Reload the PostgREST schema cache

The RPCs are new to the API surface; without a reload PostgREST answers `PGRST202` ("could not find the function").

```sql
notify pgrst, 'reload schema';
```

If the API layer does not react (some deployments disable the listener), restart the REST service through the platform's normal mechanism. Then confirm the endpoints are exposed:

```bash
curl -s -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  "$SUPABASE_URL/rest/v1/" | grep -o '/rpc/\(begin_match_generation\|publish_week_allocation\)'
```

---

## 4. Deploy the Edge Function

The generator must be deployed **after** the migrations: with the RPCs missing it fails closed (`500 publish_failed`) and writes nothing.

```bash
supabase functions deploy match-generator --project-ref <owner-supplied ref>
```

Shared imports (`_shared/matchingAllocation.ts`, `_shared/matchingEligibility.ts`) ship inside the same function bundle; no separate deployment is required. JWT verification stays enabled (no `[functions.match-generator]` override exists in `supabase/config.toml`, so the platform default applies).

Environment: no new variables. The function reads only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` provided by the platform. No schedule change is part of this release; the existing cron invocation of `match-generator` is unchanged.

---

## 5. Smoke test

Run after deployment, in this order.

1. **RPC round trip (no user data touched).**

   ```sql
   select public.begin_match_generation('SMOKE-W0');   -- returns a bigint
   select public.publish_week_allocation('SMOKE-W0', <that generation>, '[]'::jsonb);
   select public.publish_week_allocation('SMOKE-W0', <older generation>, '[]'::jsonb); -- expect PT409 stale_generation
   ```

2. **Conflict latency through the API.** Repeat the stale call over `/rest/v1/rpc/publish_week_allocation` with the service-role key. Expect HTTP 409 with body `{"code":"PT409","message":"stale_generation"}` in well under a second (measured locally: 0.018–0.5 s).

3. **Generator dry run.** Invoke the function as the cron caller (service-role key in `apikey`) for the current week and read the summary. Expect `success: true`, a generation number, `published == usersDelivered`, and `invalidQuestionnaires` reflecting reality rather than a failure.

4. **Replacement.** Invoke it a second time; the summary carries a higher generation and the week's rows are replaced, not duplicated:

   ```sql
   select week_id, latest_generation, latest_published_generation,
          (select count(*) from public.match_history h where h.week_id = g.week_id) as rows
   from public.match_week_generations g;
   ```

5. **Frontend read path.** Open the Matches screen for a user that received a pair: `match_history` is unchanged in shape, and `delivered_at` still gates visibility.

6. **Clean up only what the smoke test created** (`match_history` rows for `SMOKE-W0`, the `SMOKE-W0` fence row). Never delete rows belonging to a real week.

---

## 6. Success criteria

| Criterion | Evidence |
| --- | --- |
| Both migrations recorded in the target history | §2 query |
| `begin_match_generation` and `publish_week_allocation` exist with the expected signatures | §1 query |
| `PT409` present in the installed publication function, no `40001` | §1 query |
| `SECURITY DEFINER` + `search_path = public` on both RPCs | §1 query |
| `service_role` only: `svc_exec = true`, `auth_exec = false`, `anon_exec = false`, `auth_fence_read = false` | §1 query |
| RPCs exposed by PostgREST after the cache reload | §3 curl |
| Stale publication answers HTTP 409 within 5 s | §5 step 2 |
| A racing pair of real generator invocations yields one `200` and one `409 stale_generation`, with the winner's allocation intact | repeat §5 step 3 concurrently, twice |
| The week's rows are replaced (not duplicated) on a re-run | §5 step 4 |
| Qrashe (`matches`) and Section 2 untouched | `select count(*) from public.matches` unchanged; Section 2 isolation checks in `npm run verify` |

Local verification evidence for this package is recorded in the release report: `test:matching-allocation` 77/77, `verify-matching-publication` 66/66, `npm run verify` exit 0, five concurrency races each with one winner and one stale loser (loser 0.156–1.44 s), account-deletion UI 9/9.
