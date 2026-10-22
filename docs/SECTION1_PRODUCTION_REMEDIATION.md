# Section 1 production remediation

Date: 2026-10-22
Target: project `minglemate`, ref `mhdjnhiqahsllbczbzpk` (PostgreSQL 17.6).
Status: **prepared, tested, NOT APPLIED.**

This is the remediation follow-up to [SECTION1_MATCHING_VERIFICATION.md](SECTION1_MATCHING_VERIFICATION.md).
The audit findings are not repeated here; only what changed, what it does, and
what is left.

## 1. Production vs staging, re-read from the databases

Read-only catalog queries on 2026-10-22. Nothing was written to either
environment (the staging probe ran inside a transaction that was rolled back;
see §6).

| Fact | Production `mhdjnhiqahsllbczbzpk` | Staging `ifiewinipbxxfvzpzezd` |
|---|---|---|
| PostgreSQL | 17.6 (17.6.1.084) | 17.6 (17.6.1.166) |
| `user_responses.responses_array` | `integer[] NOT NULL` | `text[] NOT NULL` |
| Response rows | 1 row, 40 stored slots (retired question set) | 1 row, 50 slots |
| `users` rows / `section1_complete = true` | 3 / 1 | 14 / 12 |
| Policies on `user_responses` | 2: permissive read `USING (auth.role() = 'authenticated')`; own-row `FOR ALL` | 5: the same 2 pre-rewrite policies plus `responses_select_own`, `responses_insert_own`, `responses_update_own` |
| Per-user read policy present | **no** | **yes** (but shadowed by the permissive policy) |
| Grants to `anon` | ALL (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) | ALL |
| Triggers on `user_responses` | none | none |
| Triggers on `users` | `trg_clamp_user_protected_cols`, `trg_grant_initial_free_trial` | same two |
| Completion checked server-side | **no** | **no** — 12 of 14 profiles are "complete", 11 of them with no answer row at all |
| `section1_question_options` | absent | absent |

The expected facts are reconfirmed: production is `integer[]`, staging is
`text[]`. Production also has only the two pre-rewrite policies, while staging
carries the three owner policies **and** the permissive read policy, so the
permissive policy wins there as well. Both environments accept client-asserted
completion, and in staging that has already produced eleven completed profiles
with no stored answers.

Two adjacent production facts the migration depends on were also checked:
`authenticated` has **no table-level SELECT** on `public.users`; Section 1
reads and writes `section1_progress`, `section1_complete` and
`section1_last_edited` through column-level grants, which are present, so the
screen's own-row update path survives RLS. The `users` clamp trigger
(`clamp_user_protected_columns`) returns early for `postgres`, `service_role`
and `supabase_admin` and only preserves the two Section 2 entitlement columns,
so the migration's reset runs as the file owner and the app's Section 1 writes
are not blocked.

## 2. Files changed

| File | Change |
|---|---|
| `supabase/sql/production/20261022180000_production_section1_responses.sql` | Rewritten. Adds the generated option bank, the completion validator, two guards, the legacy reset and a post-check on top of the type conversion and owner-only policies. Still not applied. |
| `scripts/generate-section1-option-bank.mjs` | New. Owns the generated option-bank block inside the migration; `--check` fails when it drifts from `src/data/section1Questions.js`, `--write` regenerates it. |
| `src/lib/section1.js` | New. `normalizeStoredAnswers(stored, questions)` projects a stored row onto one slot per question and keeps only that question's own option text. |
| `src/pages/Section1.jsx` | Uses the normaliser instead of the string-only check, so legacy `'0'/'1'` values (now text) restore as unanswered. (The retake/pointer fixes from the audit remain.) |
| `scripts/test-section1-production-migration.mjs` | New. Runs the migration twice against an isolated PostgreSQL (PGlite) and exercises every access and completion case, including option membership. |
| `scripts/test-section1-staging-pg17.mjs` | New, optional. Runs the migration verbatim against a supplied `SECTION1_STAGING_DB_URL` inside a rolled-back transaction; refuses the production ref. |
| `scripts/verify-section1-questionnaire.mjs` | Extended with executed normaliser checks (718 assertions total). |
| `package.json` / `package-lock.json` | Adds `@electric-sql/pglite` as a devDependency and `npm run test:section1-db`; `npm run verify` still includes the questionnaire script plus the bank drift check. |
| `docs/SECTION1_MATCHING_VERIFICATION.md` | Audit left as the evidence snapshot, with a pointer here. |

No Edge Function, Section 2, payment, contact-unlock or matching-weight file
was changed.

## 3. Migration changes and data preservation

The file now performs, in order:

1. **Preflight** — refuses unless `public.user_responses.responses_array`
   exists and is `integer[]`, `bigint[]` or `text[]`; anything else stops the
   whole transaction.
2. **Policy replacement** — drops every existing policy on the table by
   catalog (production's names predate the repository rewrite), then installs
   `responses_select_own`, `responses_insert_own`, `responses_update_own`, all
   `to authenticated` and scoped to `user_id = auth.uid()`.
3. **Type conversion** — `alter column responses_array type text[] using
   responses_array::text[]`. This is an element-wise cast, not a rewrite or a
   delete: every stored integer survives as its exact decimal text.
4. **Option bank** — `public.section1_question_options`, 200 rows (4 options ×
   50 questions) generated from `src/data/section1Questions.js`. RLS is on,
   `anon` and `authenticated` hold no privilege, and no client policy exists,
   so the bank is internal. `npm run verify` fails if the SQL copy drifts from
   the question file.
5. **Completion validator** — `public.section1_answers_are_complete(text[])`:
   exactly 50 entries, none null, and **each slot must hold that question's own
   option text** (`question_number = slot`). Legacy integers (`'0'/'1'`),
   blanks, invented strings and an option placed in the wrong question's slot
   all fail.
6. **Guards** — see §5.
7. **Legacy reset** — sets `section1_complete = false` and
   `section1_progress = 0` for every profile whose stored answers are not a
   valid current set. The answer row itself is untouched.
8. **Anon revocation** — `revoke all on table public.user_responses from anon`.
9. **Post-check** — column is `text[]`; exactly three policies; no
   `auth.role()` policy; both guards present; zero anon grants; zero
   complete-but-invalid profiles; the bank holds 200 rows, 50 questions and
   exactly 4 options per question; no client role can read it; reports
   preserved non-current rows.

The production shape was re-read immediately before this file was finalised
(PostgreSQL 17.6, see §1): `responses_array` is `integer[] NOT NULL`; `anon`
holds all table privileges; the two pre-rewrite policies are still in place;
there is one response row (40 slots) and three users, exactly one of whom is
`section1_complete = true`.

**Data-preservation assessment.** On production the response table has one row
and `public.users` has three. The migration:

* converts that row in place (40 integers → 40 text values, same order);
* deletes no row, table, column or match;
* changes exactly two columns (`section1_complete`, `section1_progress`) and
  only for the one profile whose answers are the retired 40-answer set (the
  other two are already incomplete);
* leaves `user_responses.created_at/updated_at`, every other user column,
  `matches`, `match_history`, Section 2, payments and unlocks untouched.

**Idempotence.** The PGlite test applies the file twice; the second run changes
nothing (verified by comparing the stored rows before and after). The option
insert is `on conflict do nothing`, the policies are re-created after the
catalog drop, the triggers are dropped if present, and the validator/guards are
`create or replace`.

## 4. How legacy responses are excluded

Three independent layers, so the exclusion does not depend on one of them:

1. **Data layer.** The migration marks the legacy profile incomplete and
   resets its pointer to 0. `match-generator` selects only
   `section1_complete = true`, so the profile is not paired, not delivered and
   not scored. No score is invented and no integer position is reinterpreted.
2. **Server layer.** Even if that profile's flag were set true again, the users
   guard validates the stored answers against the option bank: 40 entries →
   false → the claim is discarded. A 50-slot array of `'0'` values fails
   because `'0'` is no question's option.
3. **Client layer.** `normalizeStoredAnswers` accepts a stored value only when
   it is exactly one of that question's options. The legacy `'0'/'1'` values,
   now strings after the column cast, restore as unanswered, so a retake shows
   all 50 questions unanswered and writes a clean 50-answer set.

The user keeps their answer row until they start the current questionnaire;
nothing is silently converted into an answer.

## 5. Private-response access and completion integrity

**Owner-only access (enforced by RLS, not by the UI).**

* `select` returns only the caller's row; there is no role-wide policy left.
* `insert` requires `user_id = auth.uid()`, so a client cannot create another
  user's answers.
* `update` requires the old row and the new row to belong to the caller, so an
  update cannot move a row to another user.
* `anon` holds no table privilege at all; the three policies are granted only
  to `authenticated`.
* `service_role` still bypasses RLS, which the weekly generator needs.

**Completion integrity (server-side, fail-closed).**

* `trg_section1_completion_guard` (BEFORE INSERT/UPDATE on `public.users`)
  reads `user_responses` whenever a row claims `section1_complete = true`.
  * valid 50 current answers → completion kept, `section1_progress = 50`;
  * anything else → completion forced to false and progress to 0.
  * the pointer is clamped to 0–50 on every write.
* `trg_section1_responses_guard` (AFTER INSERT/UPDATE on
  `public.user_responses`) downgrades a completed profile when its answers are
  replaced by an incomplete or invalid set, so completion cannot survive the
  data it was based on.
* Both functions are `SECURITY DEFINER` with a fixed `search_path`, and
  `EXECUTE` is revoked from `public`; they are reachable only as triggers.
* The app's write order (answers first, then the users row) is what the guard
  validates; no client-supplied score is involved.

**Option membership.** A completed submission is now checked against the
question bank, not against a "nonblank string" heuristic. Because the bank is
generated from the same module the screen renders, an answer that is not one of
the rendered options for that question cannot become a completed Section 1
submission. The table is a reference copy, not a second source of truth: the
drift check in `npm run verify` fails the build when the question file and the
SQL block disagree, and the migration's post-check fails if the table is not
200 rows / 50 questions / 4 options each.

Residual limitations, stated rather than hidden:

* the copy is a snapshot taken at migration time. A future question change
  requires a migration (`node scripts/generate-section1-option-bank.mjs --write`
  plus a body that reconciles removed/renamed options); the drift check forces
  that work rather than letting the database silently accept stale text.
* partial answers (fewer than 50) are stored unchecked; only completion is
  validated. That is deliberate — a user may save progress — and the engine
  only scores completed profiles.
* a user who submits 50 valid options has, by definition, answered the
  questionnaire; the database is not trying to prove the answers are honest,
  only that they are real options for those questions.

## 6. Test evidence

### 6.1 Commands run on 2026-10-22 from the repository root

| Command | Exit | Result |
|---|---|---|
| `npm run test:section1-db` | 0 | `48 assertions` — migration applied twice against isolated PostgreSQL 18.6 (PGlite 0.5.11); type conversion, value preservation, owner read/write, cross-user read/update/insert denial, anon denial, option-bank count (200/50) and client denial, legacy reset, blank/numeric/out-of-bank/wrong-slot rejection, valid completion, downgrade guard, progress clamp, zero eligible legacy profiles |
| `node scripts/verify-section1-questionnaire.mjs` | 0 | `718 assertions` — includes executed checks that legacy `'0'` values normalise to unanswered, shifted options are rejected, and real stored options survive |
| `npm run verify` | 0 | all checks passed, 0 FAIL lines (includes `generate-section1-option-bank.mjs --check` and 45/45 payment-schema checks) |
| `npm run build` | 0 | `481 modules transformed`, built in 1.78 s (one pre-existing >500 kB chunk warning) |
| `npm run lint` | 1 | `43 problems (25 errors, 18 warnings)` — the same pre-existing rule classes as before this change; no finding in `Section1.jsx`, `src/lib/section1.js` or the new scripts (targeted `npx eslint` on those five files: exit 0) |

**What the database test actually does.** It builds a disposable database with
`public.users`, `public.user_responses integer[] NOT NULL`, RLS on, the two
production policies, full anon/authenticated grants, `auth.uid()`/`auth.role()`
stubs, and the legacy 40-integer completed row plus two forged completions. It
then applies the file, applies it again, and asserts every behaviour above
through `SET ROLE authenticated` / `SET ROLE anon`.

### 6.2 PostgreSQL 17.6 (staging), rolled back

Because production must not be touched and staging is real PostgreSQL 17.6,
a focused script was executed against staging through the project's SQL
channel. It ran as one transaction ending in `ROLLBACK`, with fixture users
that had no answer rows.

Exercised on 17.6 with the shipped function bodies and the shipped policy DDL:

* `integer[] → text[]` on a temp table: row count and every value preserved
  (`{0,0,0,1}` → `{'0','0','0','1'}`);
* policy replacement: the pre-rewrite permissive policy dropped, exactly 3
  owner policies left, no `auth.role()` predicate;
* `anon` denied on `user_responses`; `authenticated` owner read succeeds and a
  cross-user read returns 0 rows; cross-user update affects 0 rows; the option
  bank is denied to `authenticated`;
* legacy 40 × `'0'` profile reset to incomplete / progress 0, values preserved;
* forged completion with no answers reset;
* valid 50-option set completes with progress 50;
* 50 × `'Not a real option'` rejected, and an already-completed profile is
  downgraded when its answers are replaced by that invalid set.

Result row: `{pg: "17.6", ok: true, policies: 3, guards: 2, option_rows: 50}`.
A post-rollback re-read confirmed nothing survived: `text[]` unchanged, 5
policies still present, `anon` grants unchanged, no `trg_section1_*` triggers,
no `section1_question_options` table, 1 response row, 14 users / 12 complete.

Because the transaction used only one option per question (50 of 200 rows) to
keep the script small, the 200-row post-check, the full-file idempotence run
and the verbatim file were **not** executed on 17.6; those ran on PGlite 18.6.
The staging test therefore proves the DDL/trigger/policy semantics on the same
major version as production, not the full migration file against Supabase's
`auth` schema and PostgREST.

**Not run, and why:**

* production (the task forbids applying it);
* `scripts/test-section1-staging-pg17.mjs` (verbatim file): no staging database
  password is available in this environment, and the harness needs a direct
  connection string. It is kept for the owner to run with
  `SECTION1_STAGING_DB_URL`; it refuses the production ref and rolls back;
* a browser walkthrough of the questionnaire (would need real accounts and a
  live backend);
* PostgREST-level writes (the JWT/API layer), which need an applied schema.

## 7. Remaining blockers and adjacent issues

1. **Owner authorisation to apply** the migration (this task's gate).
2. **Scoring-dimension decision (unchanged).** The PRD names relationship
   expectations but weights “emotional + space ×2”; the code keeps
   `expectations: 2`. No weight or mapping was touched. This remains a product
   decision, separate from the schema fix.
3. **Adjacent, out of scope — `public.discover_candidates()` is still absent**
   in production, so `Discover.jsx` errors on that RPC. Not fixed here.
4. **Adjacent, out of scope — RLS is disabled on `public.campuses`.** Not
   changed here: access requirements (public reference data vs restricted) must
   be established before adding a policy, and a generic `USING (true)` policy
   would not be a fix.
5. **Adjacent, out of scope — dead SQL scoring helpers.** The unused
   integer-based `calculate_compatibility` / `get_bulk_compatibility_scores`
   remain. After the type change they would fail if called; nothing in `src/`
   calls them.

## 8. Production execution steps (for owner authorisation)

1. **Back up first.** Supabase dashboard → Database → Backups (confirm a
   recent/on-demand backup or PITR), or take a logical copy:
   `pg_dump "$DATABASE_URL" --data-only -t public.users -t public.user_responses > section1_pre_migration.sql`.
2. **Record the before-state** (read-only):
   ```sql
   select count(*) from public.user_responses;                                  -- 1
   select count(*) from public.users;                                           -- 3
   select id, section1_complete, section1_progress from public.users order by id;
   select user_id, cardinality(responses_array), responses_array[1:5] from public.user_responses;
   ```
3. **Apply the file as one transaction.** Paste
   `supabase/sql/production/20261022180000_production_section1_responses.sql`
   into the Supabase SQL editor and run it (the editor sends the batch as one
   transaction), or with psql:
   `psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/sql/production/20261022180000_production_section1_responses.sql`.
   `-1` is required: without it psql commits each statement and a failed
   post-check would leave the conversion applied. Do not use `supabase db
   push`: the file is intentionally outside `supabase/migrations`.
4. **Verify the postconditions:**
   ```sql
   select format_type(atttypid, atttypmod)
     from pg_attribute
    where attrelid = 'public.user_responses'::regclass and attname = 'responses_array';  -- text[]

   select polname from pg_policy
    where polrelid = 'public.user_responses'::regclass order by 1;                        -- 3 owner policies

   select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'user_responses' and grantee = 'anon'; -- 0

   select count(*) from public.section1_question_options;                                 -- 200

   select tgname from pg_trigger
    where tgrelid in ('public.users'::regclass, 'public.user_responses'::regclass)
      and not tgisinternal and tgname like 'trg_section1%';                               -- 2 guards

   select id, section1_complete, section1_progress from public.users order by id;          -- legacy false / 0
   select count(*) from public.user_responses;                                            -- still 1
   ```
5. **Smoke test, with two real signed-in accounts** (no new charges):
   * the legacy account opens Section 1 and starts at question 1 with no option
     preselected;
   * answering question 1 succeeds and `user_responses.responses_array` holds
     the option text at slot 1;
   * the second account's `select * from user_responses` returns only its own
     row (and `anon` is denied);
   * completing all 50 sets `section1_complete = true` and
     `section1_progress = 50`;
   * setting `section1_complete = true` through the API without 50 answers
     leaves it false, and so does a 50-slot array of invented strings.
6. **Rollback.** Before any text answers exist, restore the two tables from the
   step-1 dump and re-run the pre-state queries. Once users have saved text
   answers, casting back to `integer[]` is not meaningful; restore the tables
   from the backup instead. The completion flags cannot be forced back to true
   while their answers are invalid — the guard rejects that by design.

**Verdict: READY FOR PRODUCTION AUTHORIZATION.** The prepared migration fixes
the type mismatch and the cross-user read, installs owner-only access, excludes
the legacy 40-answer profile from matching without inventing answers, and makes
completion a server-validated state whose answers must belong to the current
question bank. It passes 48 behavioural assertions on an isolated PostgreSQL,
the same policy/trigger logic passes on real PostgreSQL 17.6 staging inside a
rolled-back transaction, and `npm run verify` / `npm run build` pass. The
unresolved scoring-dimension decision is untouched and remains the only product
blocker.
