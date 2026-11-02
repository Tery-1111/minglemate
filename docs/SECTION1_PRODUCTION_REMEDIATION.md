# Section 1 production remediation

Date: 2026-10-22, revised 2026-10-23 (second revision: locking and transaction
discipline, fail-closed cutover-marker states, effective-privilege checks,
non-vacuous access tests, recovery procedure. Third revision: explicit
NULL-count rejection and marker type/nullability structure checks in the
migration and the preflight, `row_security = off` fail-closed behaviour under
FORCE ROW LEVEL SECURITY, and a FORCE RLS decision in the preflight).
Target: project `minglemate`, ref `mhdjnhiqahsllbczbzpk` (PostgreSQL 17.6).
Status: **prepared, tested on disposable PostgreSQL 18.6 and 17.10, NOT
APPLIED. Not authorised to run.**

This is the remediation follow-up to
[SECTION1_MATCHING_VERIFICATION.md](SECTION1_MATCHING_VERIFICATION.md). The
audit findings are not repeated here; only what changed, what it does, and what
is left.

## 1. The decision this migration implements

The owner's instruction is that **existing stored Section 1 answers are
discarded, not converted**. The legacy rows were written against a retired
40-question integer set and cannot be read as answers to the current
50-question questionnaire, so the migration deletes them and every user retakes
Section 1. Nothing is reinterpreted as an answer, and no score is invented from
the old positions.

That changes the shape of the file from the earlier draft, which converted the
column element-by-element and kept the legacy rows. There is no conversion of
answers now. The column is still converted to `text[]`, because that is the
storage type the questionnaire needs.

| Aspect | Earlier draft (preserve) | This revision (discard) |
|---|---|---|
| Legacy answer rows | kept as text (`'0'`, `'1'`) | **deleted on the first successful run** |
| Legacy profile | kept incomplete, answers readable to its owner | incomplete, **answers gone** |
| Re-execution | converted again (no-op) | **refuses** to delete or reset again |
| New answers after cutover | — | preserved by the refusal |

## 2. Production vs staging (read-only, measured 2026-10-22)

Read-only catalog queries on 2026-10-22. Nothing was written to either
environment, and **no database was contacted while preparing this revision**;
the table below is the evidence snapshot the migration targets.

| Fact | Production `mhdjnhiqahsllbczbzpk` | Staging `ifiewinipbxxfvzpzezd` |
|---|---|---|
| PostgreSQL | 17.6 (17.6.1.084) | 17.6 (17.6.1.166) |
| `user_responses.responses_array` | `integer[] NOT NULL` | `text[] NOT NULL` |
| Response rows | 1 row, 40 stored slots (retired question set) | 1 row, 50 slots |
| `users` rows / `section1_complete = true` | 3 / 1 | 14 / 12 |
| Policies on `user_responses` | 2: permissive read `USING (auth.role() = 'authenticated')`; own-row `FOR ALL` | 5: the same 2 pre-rewrite policies plus the three owner policies |
| Per-user read policy present | **no** | yes (shadowed by the permissive policy) |
| Grants to `anon` | ALL | ALL |
| Triggers on `user_responses` | none | none |
| Completion checked server-side | **no** | **no** — 12 of 14 profiles are "complete", 11 with no answer row |

The expected facts are reconfirmed: production is `integer[]`, staging is
`text[]`. Production's `authenticated` role has no table-level `SELECT` on
`public.users`; Section 1 reads and writes `section1_progress`,
`section1_complete` and `section1_last_edited` through column grants, so the
screen's own-row update path survives RLS. The `users` clamp trigger returns
early for `postgres`, `service_role` and `supabase_admin` and only preserves the
two Section 2 entitlement columns, so the cutover's reset runs as the file owner.

## 3. What the migration does, in order

0. **Transaction check and locks** — refuses to run outside a single
   transaction, sets `lock_timeout = 5s`, sets `row_security = off` for the
   transaction (fail-closed under FORCE ROW LEVEL SECURITY, see §3.1), then
   takes `ACCESS EXCLUSIVE` on
   `public.user_responses` and `SHARE ROW EXCLUSIVE` on `public.users` before
   anything is deleted or altered. See §3.1.
1. **Preflight** — stops unless `public.user_responses.responses_array` exists
   and is `integer[]`, `bigint[]` or `text[]`. Anything else raises and nothing
   changes.
2. **Policy replacement** — drops every existing policy on the table by catalog
   (production's names predate the repository rewrite).
3. **One-time cutover** (`public.section1_legacy_cutover` is the marker). The
   marker and the schema have to agree; anything else is a state this file will
   not guess about:

   | Marker rows | Column | Behaviour |
   |---|---|---|
   | 0 | `integer[]`/`bigint[]` | **first run**: delete, reset, assert, record the marker |
   | 0 | `text[]` | **stop** — legacy rows cannot be told from live ones |
   | 1 | `text[] NOT NULL` | **rerun**: warn and skip the deletion and the reset |
   | 1 | `integer[]`, nullable, or any other type | **stop** — the marker contradicts the schema |
   | 1, malformed | any | **stop** — `singleton` is not `true`, `executed_at` is NULL, or a recorded count is NULL or negative |
   | any | answer rows that hold a numeric string and no nonnumeric non-NULL value (NULL elements allowed) under a marker | **stop** — those are converted legacy answers, not options |
   | any | an all-NULL answer row under a marker | not flagged — an all-NULL row cannot be told apart from legitimate untouched partial data (documented limitation) |
   | any | marker table with the wrong columns, or a marker column of the wrong type or nullability (a nullable count accepts NULL, and `NULL < 0` is NULL, not true) | **stop** — the object cannot be read as this marker |

   On the first run it `delete from public.user_responses`, then **asserts that
   no answer row survived the deletion** (`if exists (select 1 from
   public.user_responses)` raises `cutover post-check: answer rows remain after
   the legacy deletion`), then `update public.users set section1_complete =
   false, section1_progress = 0, section1_last_edited = null`, then **asserts
   that no profile escaped the reset** (`count(*)` of rows where
   `section1_complete is distinct from false or section1_progress is distinct
   from 0 or section1_last_edited is not null` must be 0, otherwise the file
   raises and the whole transaction rolls back), then inserts the marker row
   recording both counts.

   The defect this closes: the previous revision returned as soon as it saw a
   marker, *before* looking at the column. A marker left behind by a partial
   run could therefore skip the deletion, convert the surviving legacy rows to
   `text[]` and keep them. The marker path now validates the schema, the marker
   contents and the shape of the stored rows before it decides to skip.

   **Legacy rows are identified by existence, not by timestamp.** They are
   exactly the rows present immediately before the `delete`, so the emptiness
   assertion above is the only reliable test of "the cutover removed them".
   An earlier revision also asserted, in the file's post-check, that no answer
   row had `created_at < executed_at`. That was unsound and has been removed;
   both suites now prove it, by completing Section 1 with a valid answer set
   stamped a month before the marker and requiring an ordinary rerun to succeed
   with the row and its timestamp unchanged (§6).
   The reset assertion lives on the cutover path only: the marker check returns
   before it on any later execution, so a user who legitimately completes
   Section 1 after the cutover is never rejected by it.
   The delete, the reset and the marker insert are one transaction with the
   rest of the file, so a failed post-check rolls all of it back.
4. **Type** — converts `responses_array` to `text[]` when it is not already, and
   keeps `NOT NULL`. The conversion is skipped on re-execution, so it cannot
   rewrite post-cutover answers.
5. **Option bank** — `public.section1_question_options`, 200 rows (4 × 50)
   generated from `src/data/section1Questions.js`. RLS on, no client grant, no
   policy: the table is internal.
6. **Validator** — `public.section1_answers_are_complete(text[])` requires
   exactly 50 entries, none null, and each slot to hold **that question's own**
   option text. Numeric leftovers, blanks, invented strings and a real option in
   the wrong slot all fail.
7. **Guards** — `trg_section1_completion_guard` (BEFORE INSERT/UPDATE on
   `users`) validates stored answers whenever completion is claimed, and
   `trg_section1_responses_guard` (AFTER INSERT/UPDATE/**DELETE** on
   `user_responses`) removes completion when answers are replaced, invalidated
   or deleted.
8. **Access and privileges** — RLS with `responses_select_own`,
   `responses_insert_own`, `responses_update_own` (all `to authenticated`,
   scoped to `auth.uid()`). Privileges are then **made explicit instead of
   inherited** from whatever the deployed default grants happen to be:
   `revoke all ... from public, anon`, then
   `grant select, insert, update ... to authenticated`, then
   `revoke delete, truncate, references, trigger ... from authenticated`
   (TRUNCATE bypasses RLS). `PUBLIC` is revoked deliberately: every role is a
   member of `PUBLIC`, so a `PUBLIC` grant would survive the named-role revokes
   and would make `information_schema.role_table_grants` look clean while
   `has_table_privilege()` still reported access. `service_role` gets its
   `SELECT` back explicitly (guarded by `to_regrole`) so the weekly generator
   keeps reading answers. `EXECUTE` on the validator and both guard functions
   is revoked from `PUBLIC`, `anon` **and** `authenticated`: Supabase grants
   EXECUTE on new functions to the client roles directly, so `from public`
   alone would leave those grants in place. Both tables of the option bank and
   the marker are revoked from `PUBLIC` as well. The post-check verifies all of
   this with `has_table_privilege`/`has_function_privilege` and `aclexplode`
   (effective privileges, inherited included), not by assumption.
9. **Post-check** — column is `text[]` **and `NOT NULL`**; exactly three
   policies; no `auth.role()` predicate; both guards; zero `anon` grants;
   effective `authenticated` SELECT/INSERT/UPDATE present; no client
   DELETE/TRUNCATE/REFERENCES/TRIGGER; no client EXECUTE on any Section 1
   function; no effective client or `PUBLIC` access to the option bank or the
   marker; `service_role` can still read answers; zero complete-but-invalid
   profiles; bank is 200 rows / 50 questions / 4 options each; the marker
   exists exactly once and its contents are well formed (both recorded counts
   non-NULL and nonnegative). The post-check
   deliberately does **not** classify answer rows by `created_at`; the "nothing
   survived" guarantee is the emptiness assertion inside the cutover block,
   which runs against the rows that actually existed and commits atomically
   with the marker.

### 3.1 Concurrency, locking and transaction discipline

The cutover deletes rows, resets every profile and changes a column type. Two
client writes would break it if they could land in the middle:

* an answer `INSERT` between the `delete` and the `ALTER COLUMN ... TYPE` would
  be converted instead of discarded, leaving numeric garbage in `text[]`;
* a profile `UPDATE` between the reset and the postcondition could leave a user
  looking complete, so the first-run assertion would either fail spuriously or
  pass over a profile that escaped.

The file therefore opens with a transaction check and two table locks, held
until the file commits or rolls back:

| Object | Lock | Why this mode |
|---|---|---|
| `public.user_responses` | `ACCESS EXCLUSIVE` | The `ALTER COLUMN ... TYPE` needs it later anyway. Taking it first closes the delete→alter window completely, so no row can be written against the old shape and then converted. Clients cannot read the table for the milliseconds the file runs. |
| `public.users` | `SHARE ROW EXCLUSIVE` | Conflicts with `ROW EXCLUSIVE`, which every `INSERT`/`UPDATE`/`DELETE` takes, so no client write can escape the reset; it does **not** conflict with `ACCESS SHARE`, so the app can keep reading profiles. It is also the lock `CREATE TRIGGER` needs, so no statement later has to upgrade it. |
| both | `lock_timeout = 5s` | If either table is busy the run aborts instead of waiting indefinitely or queueing every client write behind a lock request. |

**Row level security fails closed.** Immediately after the transaction guard
the file runs `set local row_security = off`. That does **not** bypass RLS: for
a role that is subject to it — the table owner included, when FORCE ROW LEVEL
SECURITY is set — any statement a policy would filter raises
`query would be affected by row-level security policy` and rolls back instead
of silently affecting a subset of rows. Without it, a FORCE RLS table would
let the `delete`, the global reset, the emptiness assertion and the reset
postcondition all read the same filtered view and record a cutover that never
happened. A superuser or `BYPASSRLS` role — the supported way to run this file
— is exempt from RLS, so the setting changes nothing for it. `SET LOCAL` ends
with the file's own transaction under the documented `psql -1` run.
Regression coverage: the isolated suite's test **16b** and the staging suite's
test **2c** both run the file as a non-superuser, non-`BYPASSRLS` owner of
FORCE-RLS tables and assert the RLS refusal with no row deleted, no profile
reset and no marker recorded, and the preflight refuses the same state
(`force_rls_no_bypass`, §7.8).

Atomicity is not assumed. The file refuses to run unless it is inside one
transaction:

```sql
create temp table if not exists section1_atomicity_probe (ok boolean) on commit drop;
-- ... raise unless to_regclass('pg_temp.section1_atomicity_probe') is not null
```

Outside a transaction that table is dropped the moment its own statement
commits, so the guard fires and nothing else runs. This is why the supported
command is `psql -1` (see §8): a `psql -f` run without `-1` would otherwise
release each statement's locks as it finished.

Locks and the transaction are not cosmetic: the isolated suite proves a
statement failing *after* the cutover rolls the column type, the rows, the
flags, the marker, the option bank, the functions, the guards and a table
created earlier in the same batch back to the pre-run state (§6).

## 4. Data impact

Deleted on the first successful run: **every row of `public.user_responses`**
(on production: the single 40-slot legacy row). Users: only three columns
change — `section1_complete` → false, `section1_progress` → 0,
`section1_last_edited` → null.

`section1_last_edited` is reset on evidence, not by habit: `src/pages/Section1.jsx:120`
writes it with `new Date().toISOString()` when answers are saved, it is a
nullable `timestamptz`, and `grep -rn "last_edited" src/` finds no read of it
anywhere in the application. After the answers are deleted the stored timestamp
describes data that no longer exists, so it is cleared. No other profile column
is written.

Nothing else is referenced. The file contains no statement against `matches`,
`match_history`, `messages`, `conversations`, `section2_responses`,
`section2_chat_progress`, `payment_intents` or `connect_unlocks`; the isolated
test seeds one representative row in each and compares them byte-for-byte
before and after.

`section1_legacy_cutover` holds one row:

| Column | Meaning |
|---|---|
| `singleton` | `boolean primary key default true`, checked true — at most one row |
| `executed_at` | when the cutover ran (advisory only — nothing classifies data by it) |
| `deleted_response_rows` | how many answer rows were deleted |
| `reset_user_profiles` | how many profiles were reset |

Re-running the file is safe for the schema statements and **refuses** the
destructive ones. The only way to run the cutover again is to deliberately
delete the marker row — an owner decision, not a maintenance step.

## 5. Completion integrity and access

* Completion cannot be self-asserted: the users guard reads the stored answers
  and forces `section1_complete = false`, `section1_progress = 0` when they are
  not the current 50-answer set.
* A completed profile cannot survive its answers: replacing them with an invalid
  set, or deleting the row (owner/service_role), downgrades it.
* The progress pointer is clamped to 0–50 on every `users` write.
* Reads, inserts and updates are owner-only through RLS; `anon` has no table
  privilege; clients have no DELETE/TRUNCATE; `service_role` still bypasses RLS
  for the weekly generator.
* The validator and guards are `SECURITY DEFINER` with a fixed `search_path` and
  no client EXECUTE grant.

Residual limitations, stated rather than hidden:

* the option bank is a snapshot. A future question change needs a migration
  (`node scripts/generate-section1-option-bank.mjs --write` plus a reconciling
  body); `npm run verify` fails when the SQL copy and
  `src/data/section1Questions.js` drift.
* partial answers (fewer than 50) are stored unchecked; only completion is
  validated, because a user may save progress.
* the database proves an answer is a real option for its question, not that the
  person answered honestly.

## 6. Verification evidence (2026-10-23, third revision)

Every row below was produced **after** the fixes in this revision, from the
repository root, against the final files. Nothing in this table is carried over
from an earlier report.

| Command | Exit | Version | Result |
|---|---|---|---|
| `npm run test:section1-db` | **0** | PostgreSQL **18.6** (PGlite 0.5.11) | 180 assertions (was 160; +20 for the marker-structure refusal on nullable/wrong-type marker columns (15e, 15f) and the FORCE RLS failure (16b)) |
| `node scripts/test-section1-staging-pg17.mjs` against a disposable cluster | **0** | PostgreSQL **17.10** | 104 assertions (was 91; +13 for the FORCE RLS refusal (2c) and the NULL-count marker refusal (6b)) |
| `node scripts/verify-section1-questionnaire.mjs` | **0** | — | 718 assertions |
| `npm run verify` | **0** | — | 54/54, 60/60, 17/17, 45/45; option-bank drift check included |
| `npm run build` | **0** | — | built in 28.40 s (one pre-existing large-chunk warning) |
| `npx eslint scripts/test-section1-production-migration.mjs scripts/test-section1-staging-pg17.mjs scripts/preflight-section1-migration.mjs scripts/test-preflight-section1.mjs` | **0** | — | no findings |
| `node --check` on all four scripts | **0** | — | syntax OK |
| `git diff --check` | **0** | — | no whitespace errors |

Mutation runs prove the new assertions are load-bearing (each restores one
defect in a scratch copy of the migration; the production copy is restored and
its SHA-256 re-checked afterwards):

| Mutation | Exit | Failure |
|---|---|---|
| marker/schema refusal disabled (`if false and (...)`) | **1** | `the refusal must name the marker/schema disagreement, got "operator does not exist: integer ~ unknown"` (the `~` test now runs before `!~` because the signature predicate was reordered in §7.9) |
| both `lock table` statements removed | **1** | `the migration must lock user_responses explicitly` |

Both mutations were re-run against the final bytes of the second revision
(after the §7.9 predicate change); the migration's SHA-256 at that point was
`0abd556601826e56b9b4b9e9c3146d88cb655057841b00664ba64300d4a88425`. Two
further mutations prove this (third) revision's new assertions are load-bearing;
each was executed against the final bytes of this revision, with the production
copy restored and its SHA-256 re-checked afterwards (final:
`56ab3fc791a1b40a0e9e7a712497e96fa1d0779cf985770a500e5cfae85568c6`):

| Mutation | Exit | Failure |
|---|---|---|
| `set local row_security = off` removed | **1** | `a FORCE RLS run by a non-BYPASSRLS role must fail, not partially succeed` (test 16b sees no error: the FORCE RLS run would proceed while seeing a filtered subset) |
| marker structure check (type/nullability) disabled | **1** | `the refusal must name the marker structure mismatch, got "refusing: the cutover marker is malformed (... deleted_response_rows=<NULL> ...)"` (the row-level NULL check backstops it, but the structure refusal is what 15e pins) |
| preflight FORCE RLS decision removed | **1** | `force_rls_no_bypass: exit 4, expected 3` (the actionable FORCE stop disappears; the state degrades to missing-evidence without naming the RLS risk) |

**Preflight tooling (added after the table above, §7.8).**
`node scripts/test-preflight-section1.mjs` against a disposable PostgreSQL 17.10
cluster: exit **0**, 20 scenario checks (16 named scenarios plus the four
target refusals), 157 assertions. Each scenario also re-reads a
snapshot of the schema, answer rows, profile Section 1 state, object inventory
and grants after the preflight and fails if anything changed. Every scenario
asserts the report contains no connection string, no password and no email or
user id. `npx eslint` and `node --check` on both new scripts exit **0**. The
scenarios cover the expected legacy start, `text[]` without a marker,
marker + `integer[]`, a partially present object set, missing owner authority, a
failed connection, a genuinely migrated database (the real migration applied),
a damaged option bank, a cascading foreign key, a dependent view, two
column-privilege losses (`missing_column_priv`,
`missing_response_column_priv` — a table-level grant cannot mask a revoked
column), the NULL-tolerant converted-legacy signature (`converted_legacy_with_nulls`)
versus legitimate partial data (`legit_partial_with_nulls`), the marker with
nullable counts and a NULL row (`marker_null_counts` — refused as a stop, not
classified as a completed migration), FORCE ROW LEVEL SECURITY without
`BYPASSRLS` (`force_rls_no_bypass` — without the new decision the FORCE stop disappears
and the same state degrades to `STOP_MISSING_EVIDENCE` without naming the RLS
risk), and four
target-refusal paths that must fail before a socket is opened.

The documented manual decision query (§7 (decision query)) was also executed verbatim against
two disposable databases on that cluster — one without and one with
`public.section1_legacy_cutover`: Variant A returned
`{column_type: integer[], marker_table_present: false}` on the absent-table
database and `{column_type: text[], marker_table_present: true}` on the other;
Variant B returned `marker_rows: 1` on the present-table database and failed by
construction (`relation does not exist`) on the absent one, exactly as the
document now states.

**Isolated suite (PostgreSQL 18.6).** Builds `public.users` (Section 1 state plus
unrelated columns), `user_responses integer[] NOT NULL`, the two production
policies, full `anon`/`authenticated` grants, `auth.uid()`/`auth.role()` stubs,
four profiles (legacy complete, incomplete, forged complete, stale partial) and
representative rows in matches, match history, conversations, messages, Section 2
responses and chat progress, payment intents and connect unlocks. It asserts:

* first run: zero answer rows, `text[] NOT NULL`, all four profiles `false/0`
  with a null stamp, marker `deleted=2 reset=4`;
* unrelated tables **and** unrelated profile columns are deep-equal to the
  pre-run snapshot, on the first run and on every rerun;
* **late failure after the cutover**: the file plus `create table
  public.zz_late_probe` plus a raising `do` block runs as one batch, fails, and
  leaves the `integer[]` column, the legacy row, completion `true`, progress 39,
  the pre-existing policy, every Section 1 function, both guards, the marker,
  the option bank and the probe table exactly as they were — then migrates
  cleanly on retry;
* **inconsistent markers** (new): marker + `integer[]` is refused with the rows,
  column, flags and marker untouched; an empty marker table + `integer[]` runs
  the first cutover (documented behaviour); a marker table with the wrong shape
  is refused; marker + `text[]` + numeric-only rows (the converted-legacy
  signature) is refused and the rows are preserved; `text[]` without a marker is
  still refused;
* **lock strategy**: `lock_timeout` is `5s`, `user_responses` is held
  `AccessExclusiveLock`, `users` `ShareRowExclusiveLock`, both taken **before**
  the legacy delete and the reset (asserted on the file's ordering, because the
  `ALTER COLUMN` and `CREATE TRIGGER` would take the same modes later anyway);
* **effective privileges**: `has_table_privilege()` (inherited `PUBLIC` included)
  matches the intended set for `anon`/`authenticated`, and `aclexplode` finds no
  `PUBLIC` grant on the response table, the option bank or the marker;
* first-run postconditions are load-bearing: a statement trigger that restores
  progress, or one that re-inserts a legacy row, makes the file raise the named
  post-check and leave every object and flag untouched;
* completion integrity: forged completion, partial 50-slot arrays, 50 × `'0'`,
  50 × `'Not a real option'`, a real option in the wrong slot and an out-of-range
  pointer are all corrected/clamped; 50 valid options complete with progress 50;
  replacing them or deleting the row downgrades; a backdated valid answer
  survives a rerun with its `created_at` intact;
* access: three owner policies, no `auth.role()`, zero `anon` grants, no client
  DELETE/TRUNCATE/REFERENCES/TRIGGER, no client EXECUTE on the three functions,
  option bank and marker unreadable to clients, cross-user read/update denied,
  cross-user **INSERT** refused specifically by RLS (`WITH CHECK`, not a
  duplicate-key error), anon read/write denied;
* static scope: exactly one `delete from public.user_responses`, no TRUNCATE, no
  `DROP TABLE`, no reference to Section 2 / payments / Connect / matches /
  messages outside the generated option text, no scoring change.

**PostgreSQL 17.10 cluster (rolled back).** `scripts/test-section1-staging-pg17.mjs`
needs a Supabase-shaped database, so it ran against a throwaway **17.10**
cluster (`embedded-postgres` 17.10.0-beta.17, installed outside the repository,
TLS with a self-signed certificate, data directory deleted on exit).
`SECTION1_STAGING_DB_URL` was **not** set; no hosted database was contacted.
Inside its rolled-back transaction it builds the real pre-migration shape
(copy the live rows to a temp table, empty the table, `alter column ... type
integer[]`, assert `integer[] NOT NULL` from the catalog), inserts legacy
integer rows and applies the migration verbatim. It asserts:

* **late failure after the cutover** inside a savepoint: column type and NOT NULL
  restored, both deleted rows back, marker/option bank/probe table absent, all
  functions and both guards gone, progress 39 restored;
* **FORCE RLS without `BYPASSRLS` (new, test 2c)**: inside a savepoint the
  tables are owned by a created non-superuser, non-`BYPASSRLS` role with FORCE
  ROW LEVEL SECURITY enabled, and the file is applied as that role. It must
  fail with the row-level security refusal; the savepoint rollback then proves
  the column is still `integer[]`, both legacy rows are still there, no marker
  exists, the profile flags are untouched, the FORCE flags and the original
  owner are restored — no subset of rows was deleted or reset;
* **NULL-count marker refusal (new, test 6b)**: the marker columns are made
  nullable and a marker row with NULL counts is inserted over `text[]`; the
  run must refuse with the marker-structure error, leaving every answer row and
  every profile flag byte-identical, after which the marker table is restored
  to the empty, correctly-shaped state the script expects;
* the first-run cutover, the global reset and the marker counts;
* a **second connection** (outside the migration transaction) attempting an
  answer `INSERT` is canceled by `lock_timeout` instead of landing a row — the
  concurrent-write path, executed rather than argued. The probe runs in its own
  always-rolled-back transaction, so a probe that got through could not commit;
* rerun preservation: answers, a backdated `created_at`, flags and marker are
  byte-identical after a second application;
* `text[]`-without-marker refusal;
* cross-user read and update against **B's existing row** (not an empty table),
  cross-user INSERT refused by RLS, `anon` read/write denied, option bank and
  marker denied to both client roles;
* effective privileges and the absence of `PUBLIC` grants;
* rollback of the *complete* pre-test state: column type and NOT NULL, a digest
  of every answer row including metadata, a digest of every user's Section 1
  flags, every policy definition with roles, the pre-existing grants and
  triggers, and no migration-created object.

**Not run, and why:** production (unauthorised), the hosted staging project (no
credentials), PostgREST/JWT writes (need an applied schema), a browser
walkthrough (needs a live backend and accounts), and any backup restore (needs
an owner-authorised recovery target — §9.3).

**Environment limits, stated rather than hidden.** The cluster is 17.10 while
production reports 17.6: same major version, different patch release, and the
cluster has no Supabase platform objects (`supabase_admin`, PostgREST, the
deployed default privileges). PGlite is 18.6 and single-connection, so the
isolated suite cannot exercise concurrency at all; only the 17.10 run has a real
second session. No `psql` binary exists in this environment (the embedded
distribution ships `postgres`/`pg_ctl` only), so the `psql -1` command itself was
not executed — the suites run the same file as one simple-query batch, which
PostgreSQL executes in one implicit transaction, and the file's own transaction
guard was verified through the mechanism it uses (the `on commit drop` probe
table is gone after a standalone statement).

## 7. Production preflight (read-only, before authorisation)

Run these against production with a read-only connection. Do not reuse the
2026-10-22 counts in §2; they are history, not current state. Replace nothing in
the file based on them, but do note the actual numbers in the authorisation
record, because the first run deletes exactly those rows and resets exactly
those profiles.

```sql
-- 7.1 identity and version
select current_database(), current_user, current_setting('server_version');
select inet_server_addr(), inet_server_port();   -- match the project out-of-band

-- 7.2 the column the whole cutover depends on
select format_type(a.atttypid, a.atttypmod) as type,
       a.attnotnull as not_null
  from pg_attribute a
 where a.attrelid = 'public.user_responses'::regclass
   and a.attname = 'responses_array'
   and not a.attisdropped;

-- 7.3 marker and option bank: absent, empty or populated?
select to_regclass('public.section1_legacy_cutover')  as marker_table,
       to_regclass('public.section1_question_options') as option_bank;
select * from public.section1_legacy_cutover;         -- only if the table exists

-- 7.4 current data (the destructive scope the owner is authorising)
select count(*) as response_rows from public.user_responses;
select count(*) as profiles,
       count(*) filter (where section1_complete) as complete,
       count(*) filter (where section1_progress <> 0) as mid_questionnaire,
       count(*) filter (where section1_last_edited is not null) as stamped
  from public.users;

-- 7.5 policies, and effective privileges (not just the direct grants)
select polname, polcmd,
       pg_get_expr(polqual, polrelid) as using_expr,
       pg_get_expr(polwithcheck, polrelid) as check_expr
  from pg_policy
 where polrelid = 'public.user_responses'::regclass order by 1;

-- service_role exists on Supabase; drop that column on a cluster without it
select has_table_privilege('anon','public.user_responses','SELECT')          as anon_select,
       has_table_privilege('authenticated','public.user_responses','SELECT') as auth_select,
       has_table_privilege('authenticated','public.user_responses','INSERT') as auth_insert,
       has_table_privilege('authenticated','public.user_responses','UPDATE') as auth_update,
       has_table_privilege('authenticated','public.user_responses','DELETE') as auth_delete,
       has_table_privilege('service_role','public.user_responses','SELECT')  as service_select;

select grantee, privilege_type, is_grantable
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'user_responses'
 order by 1, 2;
-- Read this list before authorising. The file revokes PUBLIC, anon and the
-- client DELETE/TRUNCATE/REFERENCES/TRIGGER, re-grants authenticated
-- select/insert/update, and re-grants service_role SELECT. A direct grant to any
-- OTHER role survives; a privilege that role held only through PUBLIC does not.
-- If such a role exists (a reporting user, dashboard_user, an integration),
-- confirm how it is granted before running the file.

-- Column privileges are NOT implied by the table-level list above in the
-- reverse direction: a column-level grant can exist without the table-level
-- one and vice versa. The deployed Section 1 client reads and writes these
-- exact columns (src/pages/Section1.jsx), so check each one with
-- has_column_privilege(), which counts inherited and table-level grants too:
with required(name, privilege) as (values
  ('id', 'SELECT'),
  ('section1_complete', 'SELECT'),
  ('section1_progress', 'SELECT'),
  ('section1_complete', 'UPDATE'),
  ('section1_progress', 'UPDATE'),
  ('section1_last_edited', 'UPDATE'))
select r.name, r.privilege,
       has_column_privilege('authenticated', 'public.users', r.name, r.privilege) as allowed
  from required r order by 1, 2;
-- All six must be true. section1_last_edited is UPDATE-only: the client writes
-- it on every save and never selects it. Any 'false' means the deployed client
-- cannot save or resume Section 1 after the cutover — stop and investigate.

-- 7.6 triggers and the functions behind them, on BOTH tables
select t.tgname, t.tgenabled, p.proname, pg_get_triggerdef(t.oid) as definition
  from pg_trigger t join pg_proc p on p.oid = t.tgfoid
 where t.tgrelid = 'public.users'::regclass and not t.tgisinternal order by 1;

select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as definition
  from pg_trigger t
 where t.tgrelid = 'public.user_responses'::regclass and not t.tgisinternal;

-- Any trigger function that names a Section 1 column can defeat the reset
-- postcondition: inspect the bodies, do not assume.
select p.proname
  from pg_proc p
 where p.oid in (select t.tgfoid from pg_trigger t
                  where t.tgrelid in ('public.users'::regclass,
                                      'public.user_responses'::regclass)
                    and not t.tgisinternal)
   and pg_get_functiondef(p.oid) ~* 'section1_(complete|progress|last_edited)';

-- 7.7 foreign keys, rules and the Section 1 objects
select conname, conrelid::regclass as table_name, confrelid::regclass as referenced,
       pg_get_constraintdef(oid) as definition
  from pg_constraint
 where confrelid in ('public.user_responses'::regclass, 'public.users'::regclass)
   and contype = 'f';

select r.rulename, c.relname
  from pg_rewrite r join pg_class c on c.oid = r.ev_class
 where c.oid in ('public.users'::regclass, 'public.user_responses'::regclass)
   and r.rulename <> '_RETURN';
```

### 7.7a The decision query (manual fallback)

The decision query. **The executable preflight in §7.8 is the authoritative
record**: it runs these reads inside one read-only transaction, classifies the
state, and writes a fileable report. The SQL below is a conditional manual
fallback for when the script cannot be run, and it is split into two variants
because a single query that counts from `public.section1_legacy_cutover` fails
with `relation does not exist` when the marker table is absent — which is a
valid first-run state, not an error.

Variant A is always safe, marker table or not:

```sql
select (select format_type(a.atttypid, a.atttypmod)
          from pg_attribute a
         where a.attrelid = 'public.user_responses'::regclass
           and a.attname = 'responses_array') as column_type,
       to_regclass('public.section1_legacy_cutover') is not null as marker_table_present,
       (select count(*) from public.user_responses) as response_rows;
```

Variant B — only run this when Variant A returned `marker_table_present = true`;
it errors on an absent table by construction:

```sql
select count(*) as marker_rows from public.section1_legacy_cutover;
```

Interpretation:

| `column_type` | `marker_table_present` | `marker_rows` | Meaning | Action |
|---|---|---|---|---|
| `integer[]` | false | n/a (table absent) | the expected first-run state | authorise |
| `integer[]` | true | 0 | also first-run: the file will create the marker row | authorise |
| `text[]` | false | n/a (table absent) | no marker, column already converted — unknowable | **stop**, inspect by hand |
| `text[]` | true | 1 | a completed cutover already happened | rerun is a no-op for data; decide whether that is what you wanted |
| `integer[]` | true | 1 | marker contradicts the schema (partial run) | **stop**, inspect by hand |
| any | true | > 1, or the row fails §7.3's shape check | unreadable state | **stop**, inspect by hand |

A pre-existing `BEFORE UPDATE` trigger on `public.users` that writes any
`section1_*` column would make the first run fail its reset postcondition (and
roll back). That is the intended fail-closed behaviour, but it is better found
in the preflight (§7.6) than during the run.

### 7.8 Executable preflight (`scripts/preflight-section1-migration.mjs`)

The SQL above stays as the manual fallback. The script is the supported path: it
runs the same catalogue reads, classifies the state, and writes a report that can
be filed with the authorisation record. It is read-only by construction, not by
discipline:

* one transaction, opened `isolation level repeatable read read only`, and always
  rolled back. If the session cannot prove `transaction_read_only = on`, the
  script records missing evidence and stops. Every inspection statement is a
  `SELECT` or a catalogue read; the only other statements are transaction control
  (`BEGIN`, `SET LOCAL`, `SAVEPOINT`). It never calls the migration and never
  writes.
* the connection string is read only from `SECTION1_PREFLIGHT_DATABASE_URL`.
  There is no fallback to `DATABASE_URL`, and the string is never printed.
* the target has to be confirmed twice before a socket is opened: the project
  reference must appear in the connection host or username, and
  `SECTION1_PREFLIGHT_CONFIRM_PROJECT` must equal `mhdjnhiqahsllbczbzpk`.
* no email, name, user id or answer text is printed. Counts and object metadata
  only.

```powershell
# In the repository root. Paste the connection string only into the variable:
# Supabase Dashboard -> project mingleMate -> Settings -> Database ->
#   Connection string (session pooler or direct).
$env:SECTION1_PREFLIGHT_DATABASE_URL  = '<connection string from the dashboard>'
$env:SECTION1_PREFLIGHT_CONFIRM_PROJECT = 'mhdjnhiqahsllbczbzpk'
node scripts/preflight-section1-migration.mjs --out "preflight-section1-$(Get-Date -Format yyyyMMdd-HHmmss).txt"
```

Then clear the variable (`Remove-Item Env:SECTION1_PREFLIGHT_DATABASE_URL`) and
keep the report file. The command prints the report and writes the same text to
the `--out` file.

`SECTION1_PREFLIGHT_ALLOW_LOCAL=1` exists for the disposable local test harness
only (`scripts/test-preflight-section1.mjs`). It must never be set for a
production run; a loopback host is refused without it.

The harness reads `SECTION1_PREFLIGHT_TEST_ADMIN_URL` and needs a throwaway
cluster whose password is at least 12 characters. The suite asserts that no
report contains the password, and a short or default password (`postgres`) is
indistinguishable from the database name, the executing role and the table owner
that the report legitimately prints; the harness refuses such a URL with exit 2
instead of failing the assertion for the wrong reason.

**How the owner confirms the project.** The script's identity check is an
operator assertion, not proof: it can show that the ref appears in the host or
username you supplied, and that the Supabase scheme markers (`auth.uid()`,
`auth.users`) exist, but only the dashboard knows which project that host is.
Confirm in the dashboard that the connection string was copied from the project
whose reference is `mhdjnhiqahsllbczbzpk`, and record that confirmation next to
the report. A report whose identity tier is `OPERATOR_SUPPLIED_REF_MATCH` still
says so on every line that matters.

**Output categories.** The script prints one category and exits with a matching
code:

| Category | Exit | Meaning | Action |
|---|---|---|---|
| `MATCHES_EXPECTED_STARTING_STATE` | 0 | `integer[]` (or `bigint[]`) `NOT NULL`, no cutover marker, no Section 1 objects, sufficient authority, and every column privilege the Section 1 client needs on `public.users` and `public.user_responses` | authorise, after the backup check below |
| `STOP_ALREADY_MIGRATED` | 5 | `text[] NOT NULL` with one valid marker and the full post-cutover object set | nothing left to cut over; confirm that is the intended state, do not expect a first-run reset |
| `STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED` | 3 | marker/schema disagreement, `text[]` without a marker, a marker column of the wrong type or nullability or a NULL recorded count, FORCE ROW LEVEL SECURITY on `public.user_responses`/`public.users` while the executing role is neither superuser nor `BYPASSRLS`, a partially present object set, a policy or privilege from a half-finished run, a missing column privilege for a client Section 1 operation, converted-legacy answer rows (numeric strings, NULLs allowed) under a marker, a foreign key that would cascade, or a view/trigger that would block or fight the change | stop, do not run the migration, investigate by hand |
| `STOP_MISSING_EVIDENCE` | 4 | a required check could not run (no owner authority, missing role, no `auth.uid()`, standby, connection/query failure) | stop; the report is incomplete and cannot authorise anything |
| `REFUSED_TARGET_OR_USAGE` | 2 | the URL was not supplied, the ref was not confirmed, or the host does not match the ref | nothing was connected; fix the variables |
| `INTERNAL_ERROR` | 1 | the tool itself failed | report it; do not treat the run as evidence |

A `STOP` is never a licence to edit the database by hand. The migration also
fails closed on the same states; the preflight exists so the owner finds them
before authorising a destructive run. File the report, inspect the named object,
and re-run the preflight after the cause is resolved.

**What to keep for the authorisation record.**

* the full report file from `--out`, unedited, including the generated timestamp;
* the dashboard confirmation of the project reference and host;
* the `first-run footprint` line, which is the exact number of answer rows the
  run will delete and profiles it will reset — not the 2026-10-22 history in §2;
* the timestamp and scope of the backup/PITR recoverability check (below).

**What the successful report does not do.** It does not apply the migration, it
does not authorise it, and it does not prove a restore works. Execution stays in
§8 and still needs the owner's explicit authorisation. Before running it, confirm
that the Supabase project has PITR (or a recent verified backup) and that a
recovery target exists: the preflight cannot test a restore, and §9.2's restore
path depends on that capability. A clean preflight followed by an unrestorable
backup is not a safe position.

### 7.9 The converted-legacy signature tolerates NULL elements

Both the migration (§3, marker branch) and the preflight scan use the same
predicate for "these rows look like converted legacy answers":

* the row has at least one element that is a numeric string (`^-?[0-9]+$`), and
* the row has **no** non-NULL element that is not a numeric string.

Earlier revisions required *every* element to be non-NULL and numeric, so a
converted legacy row that was sparse (numeric strings plus NULLs) slipped
through and would have been preserved as if it were a live answer. NULL
elements no longer clear the suspicion: only real option text does.

Two behaviours follow, and both are pinned by regression tests
(`npm run test:section1-db` sections 15b–15d, and the preflight scenarios
`converted_legacy_with_nulls` / `legit_partial_with_nulls`):

* a marker plus `['0', null, '1', null, '3']` is **refused** in both the
  migration and the preflight, and the refusal leaves answers, profile state,
  the column type and the marker row byte-identical;
* a marker plus `[<option text>, null, <option text>, null, null]` — the normal
  shape of an in-progress or partially answered questionnaire — is **not**
  flagged; the rerun proceeds as the legitimate no-op it is.

**Stated limitation.** An all-NULL answer row cannot be distinguished from
legitimate untouched partial data, so the predicate deliberately does not flag
it. Not every conceivable legacy remnant is therefore detectable: a row that
was converted from legacy and later had every element nulled looks exactly like
a row nobody has answered. Nothing infers legacy-ness from timestamps —
`created_at` and `updated_at` are client-influenced and were deliberately kept
out of the decision (§3). If the owner wants all-NULL rows treated as suspect,
that is a separate, explicitly destructive decision, not something this file
assumes.

## 8. Execution procedure (the only supported one)

```powershell
psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 `
  -f supabase/sql/production/20261022180000_production_section1_responses.sql
```

All three parts are required:

* `-1` wraps the whole file in one transaction. Without it every statement
  commits on its own, a failed post-check leaves a partial migration, and each
  statement's locks are released before the next one runs.
* `-v ON_ERROR_STOP=1` makes psql stop at the first error. With it off, psql
  reports the error and continues to the next statement — inside a `-1`
  transaction that aborts anyway, but outside one it keeps damaging.
* the file path is the repository file, unedited. Do not paste it into the
  Supabase SQL editor: that path's transaction semantics are undocumented, and
  this file's guarantee depends on the whole thing being one transaction.

Do **not** add `begin;`/`commit;` to the file. Combined with `-1` the `begin`
only warns but the `commit` ends the transaction early, and every later
statement then runs on its own. The file instead detects that it is inside a
transaction and refuses otherwise (§3.1).

Do **not** use `supabase db push`: this file is deliberately outside
`supabase/migrations`.

Expected behaviour during the run:

* `ACCESS EXCLUSIVE` on `user_responses` and `SHARE ROW EXCLUSIVE` on `users`
  are taken first. Clients can still read profiles; they cannot read or write
  answers, and cannot write profiles, until the transaction ends.
* If either table is busy (a client transaction holding a conflicting lock), the
  run aborts after 5 s with `canceling statement due to lock timeout`. Nothing
  is left behind: the whole transaction rolls back. Re-run when the table is
  quiet; do not retry in a loop.
* On a one-row table the whole migration takes well under a second, so the
  client-visible pause is the time to acquire two locks, not the duration of a
  table rewrite.
* The reset invalidates every user's Section 1 state. If someone is answering
  the questionnaire at that moment, their save either blocks until the
  migration commits (and then succeeds against the new schema) or fails and is
  retried by the screen. Prefer a low-traffic window for that reason, not for
  correctness.

Post-migration verification (run immediately afterwards):

```sql
select format_type(atttypid, atttypmod) as type, attnotnull
  from pg_attribute
 where attrelid = 'public.user_responses'::regclass and attname = 'responses_array';
-- text[] | t

select count(*) from public.user_responses;                 -- 0
select * from public.section1_legacy_cutover;               -- 1 row, counts match preflight
select count(*) from public.section1_question_options;      -- 200

select polname from pg_policy
 where polrelid = 'public.user_responses'::regclass order by 1;
-- responses_insert_own, responses_select_own, responses_update_own

select count(*) from pg_trigger
 where tgrelid in ('public.users'::regclass, 'public.user_responses'::regclass)
   and not tgisinternal and tgname like 'trg_section1%';    -- 2

select count(*) from public.users
 where section1_complete is distinct from false
    or section1_progress is distinct from 0
    or section1_last_edited is not null;                    -- 0

select id, section1_complete, section1_progress, section1_last_edited
  from public.users order by id;                            -- false / 0 / null

select has_table_privilege('anon','public.user_responses','SELECT'),        -- f
       has_table_privilege('authenticated','public.user_responses','DELETE') -- f
```

If psql reports a statement error (any `ERROR:` line, non-zero exit),
PostgreSQL rolled the whole transaction back: nothing was applied. Confirm with
the post-run queries in §8 — the column is still `integer[]`, no marker row, the
legacy rows are present, and the profiles still read as before. A marker row
without `text[]` cannot happen from a failed run — that combination is exactly
what §3 refuses.

If psql instead dies with a connection-level failure (network drop, laptop
sleep, tunnel reset, `server closed the connection unexpectedly`) and you cannot
tell from its output whether the `COMMIT` was reached and acknowledged, the
outcome is **ambiguous** and §9.1a applies: do not assume the rollback above.

Re-running a completed migration is a no-op for data: it warns, skips the
cutover and re-asserts the post-checks. If it stops with *"responses_array is
already text[] and no cutover marker exists"* or *"a cutover marker exists but
responses_array is integer[]"*, stop and inspect — do not create or delete a
marker by hand.

## 9. Recovery

Two different failures need two different answers. Do not conflate them.

### 9.1 The migration did not commit (transactional rollback)

If psql reports any error, PostgreSQL rolled the whole transaction back. There
is nothing to restore: the column type, every answer row, every profile field,
the policies, the grants and the trigger set are as they were. Confirm with the
post-run queries in §8 and fix the cause (most likely a lock timeout, or a
`users` trigger the preflight missed) before retrying.

This path is executed evidence, not an assumption: both suites run the file plus
a deliberately failing statement and assert the complete pre-run state returns
(§6).

The statement "psql printed an error, so it rolled back" is only sound while the
client and the server still agree about what happened. If the connection was
lost before an outcome was acknowledged, see §9.1a instead.

### 9.1a The commit outcome is unknown (lost connection / no acknowledgement)

A `psql -1` run can end without a trustworthy answer: the tunnel drops, the
laptop sleeps, the SSH session dies, or the server restarts mid-run. psql then
exits non-zero with a connection error and **you cannot tell from its output
whether the transaction rolled back or committed**. The server finishes what it
was doing independently of the dead client: the transaction may already have
committed, still be running, or have rolled back on its own.

In that state, all of the following are unknown: the column type, whether the
legacy rows were deleted, whether profiles were reset, whether the marker row
was written.

**Required procedure — establish the state before doing anything else:**

1. Open a **fresh connection** (a new psql session, or the executable preflight
   in §7.8 with `SECTION1_PREFLIGHT_DATABASE_URL`). Do not reuse the dead
   session's shell variables as if they carried state; nothing about the run is
   known yet.
2. Run the read-only state inspection: the §7 decision-query variants (safe on
   both marker-absent and marker-present states), or better the preflight, which
   classifies the state and writes a report.
3. Decide from what the database actually says:
   * `integer[]`, no marker row, legacy rows still present, profiles unchanged →
     the transaction rolled back; it is safe to retry after fixing the cause
     that killed the connection.
   * `text[]`, exactly one marker row whose counts match the pre-run counts,
     option bank present, both guards present → the transaction **committed**.
     The migration is complete; do not re-run it, and do not treat the unknown
     as a failure. Re-verify with the §8 post-migration queries instead.
   * anything else (e.g. `text[]` with no marker, `integer[]` with a marker,
     rows half-deleted) → **stop**. That combination cannot be produced by this
     file's single transaction, so something else has been at work: investigate
     by hand and plan recovery per §9.2 before touching anything.
4. Only after step 3 gives the first answer is a retry authorised.

**Never re-run the destructive file just to see what happens.** A blind retry
against an actually-committed database takes the marker branch and re-asserts
post-checks (a no-op for data), but a blind retry against a database in the
unknown middle of concurrent activity, or a blind "clean up" by hand, can
destroy the very evidence that distinguishes the three outcomes above. The
state inspection is read-only and takes seconds; there is no scenario in which
skipping it is the safer choice.

The same rule applies to any wrapper that supervises the run (a CI job, a
tunnel, a `Invoke-Command`): a supervisor that reports "failed" on a connection
error and automatically re-runs the file must be disabled for this migration.

### 9.2 The migration committed and has to be undone

Then the only sound recovery is **a database restore into a recovery target**,
not a table dump:

* Supabase PITR / daily backup, restored to a **new** project (the dashboard's
  restore does not overwrite the production project), then reconciled;
* or `pg_dump` of the whole database taken **before** the run, restored into an
  empty database, from which the two affected tables are copied back.

A data-only dump of `public.users` and `public.user_responses` is **not** a
recovery plan, and the earlier revision of this document was wrong to suggest
it. Restoring those two tables alone leaves the migration's own objects in
place — the cutover marker, the option bank, the validator, both guards, the new
policies and the revoked grants — and the guards then act on the restored rows:
a restored `section1_complete = true` whose answers do not satisfy
`section1_answers_are_complete()` is downgraded to `false / 0` on the spot, and
the answers restore as `text[]` even when the pre-migration column was
`integer[]`. The result is a half-migrated database that looks restored.

If a table-level restore is nevertheless all that is available, the marker row
and both Section 1 guard triggers must be dropped in the same transaction as the
restore, and the column must be converted back — which is only meaningful before
anyone has saved text answers.

### 9.3 What has actually been drilled

**Nothing.** No backup has been restored, in this environment or any other.
`docs/BACKUP_PREFLIGHT_REPORT.md` records the backup/PITR posture; a restore
drill is an **owner-operated prerequisite**, not something this work can claim:

1. confirm PITR is enabled (or take a fresh logical dump) and record the
   timestamp of the restore point;
2. restore it into a scratch project;
3. run the §8 post-migration queries against the restore to confirm it predates
   the migration;
4. record the wall-clock restore time — that is the real recovery objective.

Until step 3 has been done once, "we can restore" is a plan, not a fact.

## 10. Rollout order, matching behaviour and other consumers

### 10.1 Client and migration order

The deployed client writes **option text** (`Section1.jsx` upserts
`responses_array: updatedAnswers`, and `src/data/section1Questions.js` holds
option text). Against today's `integer[]` column every such write fails with
`22P02`, which is the defect this file fixes. Consequences:

| Order | Result |
|---|---|
| migration first, current client unchanged | the existing client starts working as soon as the transaction commits; **no client deploy is required** |
| client first, migration later | no change: the client already writes option text and still fails until the column is `text[]` |
| both at once | safe, but unnecessary |

So there is no ordering hazard between the deployed client and the migration,
and no maintenance window is required for correctness. A low-traffic window is
still recommended: `ACCESS EXCLUSIVE` on `user_responses` blocks answer reads
for the duration, and any in-flight answer save is either delayed or has to be
retried by the screen.

The one interaction worth knowing: `Section1.jsx` saves in two statements
(upsert the answers, then update the profile). If the migration commits between
them, the profile update still runs — the answers are already the new shape, so
the completion guard validates them normally.

### 10.2 Matching after the reset

`supabase/functions/match-generator/index.ts` selects
`.eq('section1_complete', true)` and returns early when there are none:

```ts
if (userIds.length === 0) {
  return new Response(JSON.stringify({ success: true, matchesProcessed: 0 }), { status: 200 })
}
```

After the cutover every profile is incomplete, so the first run of the week is
that early return. It writes no `match_history` rows, computes no scores and —
because this function sends no notifications at all — cannot send an empty or
misleading match. Pairing is by complete-graph iteration, so a single eligible
user produces no pairs and `pool.length === 0` skips the history row for that
user; there is no "you have a match" message with no partner.

The function reads `responses_array[questionNumber - 1]` and the engine compares
option text, so it works against `text[]` and silently scored nothing against
`integer[]`.

### 10.3 Existing matches

The migration never references `matches`, `match_history`, `conversations` or
`messages`, and the generator only upserts the current week's `match_history`
rows. Last week's matches therefore stay visible on the Matches screen while
every profile reads incomplete. That is a **product decision, not a bug**:
nothing is deleted, but the pairs shown were computed from answers that no
longer exist. Options are to leave them (they expire naturally as new weeks
arrive) or to hide them behind a UI note; this migration does neither without
the owner's instruction.

### 10.4 Other consumers of `responses_array`

| Consumer | Effect of `integer[] → text[]` |
|---|---|
| `src/pages/Section1.jsx` | writes option text; currently fails, works after the migration |
| `src/lib/section1.js` (`normalizeStoredAnswers`) | already drops numbers and out-of-bank strings, so a legacy row renders as unanswered |
| `src/pages/Admin.jsx` (`answerText`) | handles a number (legacy) and a string (current); `admin_user_detail` returns `responses_array[qn.qn]`, i.e. a scalar that is text after the migration |
| `supabase/functions/match-generator` | reads text, correct after the migration |
| `supabase/functions/_shared/compatibilityEngine.ts` | string comparison, correct after the migration |
| `scripts/e2e-matching-test.mjs` | REST writes of option text, correct after the migration |
| `public.calculate_compatibility` / `get_bulk_compatibility_scores` | integer-based, dead code (not called from `src/`); after the migration they would fail **if** anything called them. Removing them is a separate decision and is not in this file |

Not established from the repository: any deployed view, report, export,
analytics job or Edge Function that exists in the Supabase project but not in
this checkout. The preflight in §7.7 lists the database objects; anything
outside the repository has to be found in the dashboard.

### 10.5 Option bank

`public.section1_question_options` is generated from
`src/data/section1Questions.js` by `scripts/generate-section1-option-bank.mjs`.
`npm run verify` runs the generator in `--check` mode and fails if the SQL copy
drifts; it passed in this revision (§6). The comparison is on the parsed values,
so it does not depend on how the file was copied or on its line endings. No
extra checksum is needed.

## 11. Post-cutover verification checklist

To be observed by the owner (or whoever the owner nominates) **immediately after
the migration commits**, with two real signed-in accounts and no payments:

| # | Check | Stop the rollout if… |
|---|---|---|
| 1 | Section 1 opens at question 1 with nothing preselected, including on the legacy account | the legacy answers are still shown, or the screen errors |
| 2 | Answering question 1 stores the option **text** at slot 1 (`select responses_array from user_responses`) | the write fails or a number is stored |
| 3 | The second account's `select * from user_responses` returns only its own row | any other user's row is visible |
| 4 | Completing all 50 sets `section1_complete = true`, `section1_progress = 50` | completion stays false with 50 valid answers |
| 5 | Claiming completion without answers leaves it `false / 0` | a claim sticks without answers |
| 6 | Signup and a profile edit still save (they pass the same `users` triggers) | signup or profile save fails |
| 7 | A manual `match-generator` invocation returns `matchesProcessed: 0` with no history rows while nobody is complete | it errors, or writes rows for incomplete users |
| 8 | The Matches screen still renders last week's pairs, and Section 2 still loads | either errors |

Items 1–5 exercise the new policies and guards; 6 exercises `public.users`
triggers around the two the migration adds; 7–8 cover the reset's blast radius.
There is no background monitoring in this repository, and none is claimed.

## 12. Remaining blockers and unknowns

Confirmed defects corrected in this revision (each has a test, §6):

1. **Concurrent writes could corrupt the cutover.** No locks, so an answer
   `INSERT` could land between the `delete` and the `ALTER COLUMN ... TYPE` and
   be converted instead of discarded; a profile `UPDATE` could escape the reset.
   Fixed with a transaction guard, `ACCESS EXCLUSIVE`/`SHARE ROW EXCLUSIVE`
   taken before any destructive statement, and a 5 s `lock_timeout`.
2. **A marker present with `integer[]` skipped the cutover.** The marker path
   returned before the column check, so a partial run's marker could preserve
   converted legacy rows. The marker path now validates schema, marker contents
   and row shape, and stops on any disagreement.
3. **Two PostgreSQL 17 access tests were vacuous.** They read and updated a row
   the cutover had already deleted, so an empty result proved nothing. They now
   act on an existing row, and the cross-user INSERT asserts the RLS error
   specifically instead of any "violates".
4. **Rollback was documented as a data-only dump restore**, which leaves the
   migration's objects and guards in place. §9 now separates transactional
   rollback from committed-migration recovery, and marks the restore drill as
   not performed.
5. **Privileges were assumed, not established.** `PUBLIC` was never revoked and
   `authenticated` was never explicitly granted, so the post-check could pass
   while the deployed defaults differed. Privileges are now explicit, and
   checked effectively (inherited `PUBLIC` included).

Still open, and not fixable from this repository:

1. **Owner authorisation to apply** — required, and not implied by this report.
   The destructive scope is "every row in `public.user_responses` plus the
   Section 1 state of every profile", with the actual counts taken from §7.4.
2. **Deployed `public.users` triggers.** The repository knows of the Section 2
   clamp trigger only. A `BEFORE UPDATE` trigger that writes `section1_*` in
   production would make the first run fail (safely, with a rollback). §7.6 is
   the check; the answer is UNKNOWN until the owner runs it.
3. **Deployed response policies and effective grants.** The repository's copy is
   pre-rewrite; §7.5 establishes the live set. The file replaces policies by
   catalog, so unknown names are handled, but unknown *roles* are not.
4. **Backup restore drill** — §9.3, owner-operated, not performed.
5. **Existing matches** — visible after the reset; product decision in §10.3.
6. **Adjacent, out of scope:** `public.discover_candidates()` is absent in
   production (`Discover.jsx` errors on that RPC); RLS is disabled on
   `public.campuses`; the integer-based scoring helpers are dead code that would
   fail if called after the type change; the PRD's "emotional + space ×2" versus
   the named relationship-expectations dimension is still an open product
   decision.
7. **Independent review** — this revision was produced and tested by the same
   agent that wrote it. Self-verification is not independent review; the diff is
   left uncommitted for a reviewer, per §13.

## 13. Repository state

| Item | Value |
|---|---|
| Branch | `agent/discard-section1-legacy-answers` (local, not pushed) |
| Review baseline | `0ea99ce64454298d203de3135d73f43ed2a41760` (PR #16 head), present in the repository |
| Migration | 1157 lines, SHA-256 `2771357cf94393976ff52f7f7420d0375c2e5e86af89bf71e8d4fc114b057bc0` (edited after the 2026-10-23 mutation runs recorded in §6, which ran against `56ab3fc791a1b40a0e9e7a712497e96fa1d0779cf985770a500e5cfae85568c6`) |
| Changed files | the migration, `scripts/test-section1-production-migration.mjs`, `scripts/test-section1-staging-pg17.mjs`, `scripts/preflight-section1-migration.mjs` (new), `scripts/test-preflight-section1.mjs` (new), `GATES.md` (gate ledger, see below), this report |
| Uncommitted | yes — all seven files; nothing was committed, pushed or deployed |
| Untouched | `supabase/.temp/cli-latest` (pre-existing user change) and two stray untracked files (`e = 0ea99ce…`, `t <non-ascii>Saved diff<non-ascii>`) left by an earlier shell redirect in a previous session |

**`GATES.md` scope decision (documented deliverable).** The review diff
appended gate sections to `GATES.md`. They are kept deliberately: the
ledger-first workflow that governs this workstream requires a gate ledger in
the project root, and gates 69–99 record this review cycle's checks and their
executed evidence. The historical content (gates 1–68) is preserved
byte-for-byte; only sections were appended. This is reported as an extra
tracked change beyond the migration and its two test suites, not an unrelated
edit.

Stages, kept distinct — only the first three are true:

| Stage | State |
|---|---|
| Code remediation | complete |
| Automated verification | complete on disposable PostgreSQL 18.6 and 17.10 |
| Preflight tooling | complete; 20 scenario checks (16 named + 4 refusals) on disposable PostgreSQL 17.10, 157 assertions, `node scripts/test-preflight-section1.mjs` |
| Independent review | **outstanding** |
| Production preflight | **not run** (the tool is ready; it needs the owner's connection string) |
| Owner execution authorisation | **not given** |
| Production migration executed and verified | **no** |

**Verdict: READY FOR INDEPENDENT REVIEW AND OWNER PREFLIGHT; NOT AUTHORISED TO
APPLY.** The file is atomic under the documented command, locks out concurrent
writers before it destroys anything, refuses every inconsistent marker state it
can recognise (including NULL or negative recorded counts and marker columns
of the wrong type or nullability), fails closed under FORCE ROW LEVEL SECURITY
via `row_security = off`, keeps both first-run postconditions, preserves
post-cutover answers on rerun, and makes its own privileges explicit and
checkable. The preflight classifies a NULL-count marker and a FORCE-RLS
state with a non-bypassing role as stops rather than acceptable. It has run
against PostgreSQL 18.6 (180 assertions) and a disposable PostgreSQL 17.10
cluster (104 staging assertions, 157 preflight assertions), and both
suites fail on the assertions covering the defects fixed here. It has **not**
run against production or hosted staging, no backup has been restored, and the
deployed trigger and grant inventory is still UNKNOWN.
