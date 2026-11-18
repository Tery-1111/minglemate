# Matching Reliability Remediation — Investigation & Implementation Specification

**Status:** investigation only. Nothing in `supabase/`, `src/`, `scripts/` or `package.json` was
modified to produce this document.
**Worktree:** `C:\Users\oboch\minglemate-matching`
**Branch / HEAD:** `feat/matching-allocator` / `c968614904098fad9073dffb024c7a7a9a494ff7`
**Date of evidence capture:** 2026-11-18 (week id `2026-W47`)
**Scope:** four reliability risks — malformed questionnaire data, database gender constraint,
same-week rerun safety, concurrent matching runs.

---

## 0. Document control

| Field | Value |
|---|---|
| Investigation type | read-only, evidence-driven |
| Code under investigation | `supabase/functions/match-generator/index.ts` (303 lines), `supabase/functions/_shared/{matchingAllocation,matchingEligibility,maxWeightMatching,compatibilityEngine}.ts` |
| Database objects inspected | `supabase/migrations/*.sql` (13 files), `supabase/sql/production/*.sql` |
| Reproduction harness | isolated copy in `%TEMP%\ver` (fake Supabase client + the real handler, transpiled out-of-tree) |
| Production access | none (explicitly out of scope) |
| Frozen requirements | 5% floor, scoring formula, Tier 1 global matching, Tier 2 recovery, cardinality-first, repeat priorities, eligibility rules, Qrashe, Section 2 — all untouched by every proposal below |

**Classification legend:** `CONFIRMED` (reproduced here), `PARTIALLY VERIFIED` (mechanism proven,
end-to-end effect not), `NOT REPRODUCED`, `UNVERIFIED` (no evidence available in this environment).

---

## 1. Executive summary

| # | Risk | Classification | One-line finding |
|---|---|---|---|
| R1 | Malformed questionnaire data | **CONFIRMED** | One `NULL` (or legacy numeric) `responses_array` throws before allocation and **discards the entire week** — 0 rows published even though other users were perfectly matchable. |
| R2 | `users_gender_check` constraint | **CONFIRMED absent** (repo) / **UNVERIFIED** (live DB) | No gender `CHECK`, enum or trigger exists in any migration. The documented claim is false for this repository. Application-level fail-closed guard is the only real defence. **Approved scope: documentation and comment corrections only — no constraint, no data change, no migration.** |
| R3 | Same-week rerun safety | **CONFIRMED** | The generator only upserts; it never removes obsolete rows. A rerun with a changed population left **2 orphan rows and 2 broken mutual links** in the current week, visible to users immediately. |
| R4 | Concurrent matching runs | **PARTIALLY VERIFIED** | No lock, lease, run id or version predicate exists anywhere. Two publishers interleaving produce a week that is wholly one run's output plus the other run's orphans — never a merge, never detected. **Revised design: database generation fencing (§7) — a publication lock alone cannot order an older computation against a newer one.** |

**Aggregate verdict:** all four risks are real, none is caused by the allocation algorithm itself
(which remains exact), and all four have small, local fixes: **~15 lines in one function**, **two
plpgsql functions plus one small fencing table (generation begin + fenced week replacement)**, and
**three documentation corrections**. No change to the solver, the weights, the 5% floor,
Tier 1/Tier 2 semantics, eligibility predicates, Qrashe, Section 2, or the gender data model is
required or proposed.

**Implementation Specification: READY** (§16).

---

## 2. Current implementation findings

### 2.1 Execution and publication flow (exact anchors, `match-generator/index.ts`)

| Step | Lines | Behaviour |
|---|---|---|
| 1. Authorisation | 49–85 | Service role via `apikey`/`bearerRole`, otherwise `admin_users` membership; else 403 |
| 2. Eligible users | 71–76 | `users` where `section1_complete`, `status='active'`, `profile_status='active'`; error → **400, no write** |
| 3. Empty population short-circuit | 81–94 | Returns an all-zero summary; writes nothing |
| 4. Questionnaires | 96–101 | `user_responses` (`user_id, responses_array`) restricted to `userIds`; error → **400, no write** |
| 5. **Profile construction** | 106–113 | `answers[q] = response.responses_array[q-1]` — **unguarded array indexing** |
| 6. Blocks | 116–126 | `user_blocks` full scan → `blockedPairs`; error → **500, no write** |
| 7. Eligibility + scoring | 128–176 | `areEligibleCandidates` (gender + campus + blocks), `calculateCompatibility`, `Math.round`, 5% floor |
| 8. Previous week | 183–201 | `match_history` of `getPreviousWeekId`; error → **500, no write** |
| 9. Participants | 208 | `eligibleUsers` that have a profile |
| 10. Allocation | 210–218 | `allocateTiers(participants, scored, previousPartners)`; throws → **500, no write** |
| 11. Pre-publish gate | 222–256 | Re-validates population, blocks, campus, eligibility for every published pair |
| 12. Row build | 258–266 | One row per user **with a partner**; users without a partner get no row |
| 13. **Publish** | 267–277 | Single `upsert(historyRows, { onConflict: 'user_id,week_id' })` — **no delete, no lock, no version** |
| 14. Summary | 279–295 | Counts only, no user ids |

### 2.2 Database facts established from migrations

| Fact | Source |
|---|---|
| `match_history(id, user_id, week_id, tier1_match_id, tier2_match_id, delivered_at)` | `20261014150000_consolidated_schema_chain.sql:891-898` |
| `unique index match_history_user_week_uidx on (user_id, week_id)` | same file `:902-903` |
| RLS read policy is `user_id = auth.uid()` **only** — no `delivered_at` gate | same file `:907-911` |
| `authenticated` has no insert/update/delete on `match_history` | same file `:914` |
| `user_responses.responses_array` is `text[]`, **nullable** (no `not null`) | same file `:202-249` |
| Opposite-gender rule exists **only** as a read-scope predicate inside `discover_candidates()` / the users-update policy | `:1098`, `20261113120000_users_update_privilege_hardening.sql:388` |
| **No** `CHECK`, enum or trigger constrains the *value* of `users.gender` | `grep -riE "gender" supabase/migrations/*.sql \| grep -iE "check\|constraint\|enum"` → 0 matches |
| No advisory lock, `FOR UPDATE`, run id or version column anywhere in the generator path | `grep -rniE "pg_advisory\|for update"` → only unrelated policies and `complete_force_connect()` |
| `delivered_at` is written but never enforced server-side or client-side | `src/pages/Matches.jsx:34-38` filters by `user_id` + `week_id` only |

**Documentation drift noted:** `20261014150000_...:1296` still claims the generator upserts into
`matches` (Qrashe). Current code does not (§2.1, and test B8 asserts the table allow-list).

---

## 3. Evidence and exact file references

| ID | Evidence | How obtained |
|---|---|---|
| E1 | `responses_array = NULL` → `TypeError: Cannot read properties of null (reading '0')`, **0 upserts**, run aborted | harness run, 4 users, 1 bad row |
| E2 | `responses_array = [1,2,…,50]` (legacy integers) → `TypeError: answerB.trim is not a function`, **0 upserts** | harness run |
| E3 | `responses_array = []` → no exception, participant silently scores 0 against everyone ⇒ `tier1Pairs=1` instead of 2, `usersDelivered=3` of 4 | harness run |
| E4 | `responses_array` = 10 of 50 answers, or a 3-char string, or a missing row → no exception; behaviour degrades silently (partial answers score, missing row drops the participant) | harness runs |
| E5 | Zero gender `CHECK`/enum/trigger in 13 migrations + production SQL | grep, §2.2 |
| E6 | Opposite-gender enforced only in read policies (`:1098`, hardening `:388`) | source read |
| E7 | Rerun with `f0`+`m1` suspended: run 1 = 4 rows, run 2 = 2 rows, final table = **4 rows**; orphans `f0`, `m1`; **2 broken mutual links** (`f0→m0` while `m0→f1`; `m1→f1` while `f1→m0`) | harness run |
| E8 | Generator issues zero deletes: grep for `delete`/`truncate` on `match_history` → only `account_deletion_two_phase.sql:359` (per-user) and the `revoke` at `:914` | grep |
| E9 | No coordination primitive in the publish path: `upsert` with `onConflict: 'user_id,week_id'` only (`:271-272`); no `pg_advisory*`, no lease table, no version column | grep + source read |
| E10 | Interleaved publishes (A publishes last from an older snapshot) → final week = A's 4 rows; **2 rows involve a now-suspended user**; no error raised by either run | harness run |
| E11 | A `user_blocks` failure aborts with `500 restriction_query_failed` and **0 upserts** (contrast: the happy path writes once) | harness run |
| E12 | Current client read path shows current-week rows regardless of `delivered_at` and without eligibility re-check | `src/pages/Matches.jsx:34-38, 117` |
| E13 | Claimed constraint appears in `docs/MATCHING_ALLOCATION_IMPLEMENTATION.md:85` and `matchingEligibility.ts:12` | grep |

All harness runs used the repository's *real* handler and the *real* shared modules, transpiled into
`%TEMP%\ver`; no repository file was written (see §15).

---

## 4. Risk assessments

### R1 — Malformed questionnaire data — **CONFIRMED**

**Mechanism.** `index.ts:106-113` iterates `user_responses` and dereferences
`response.responses_array[questionNumber - 1]` without checking that the value is an array.
`responses_array` is a nullable `text[]` (§2.2), so `NULL` is a legal database state and the
indexing throws `TypeError` inside the request handler.

**Consequences.**
- The throw happens **before** allocation and **before** any write, so no partial publication occurs
  (good), but the run returns the platform's generic 500 rather than the project's `{error, detail}`
  JSON (bad for operators), and
- **one bad row cancels the entire week for every other user** (E1, E2). With 2 000 eligible users,
  a single `NULL` row publishes nothing.

**Severity tiers that must be distinguished**

| Tier | Example | Correct handling |
|---|---|---|
| Invalid participant data | `responses_array` NULL, not an array, all entries non-string | Skip that participant; count it; keep the run alive |
| Recoverable participant-level error | Fewer than 50 answers, blanks inside the array, legacy numeric indices stored as text | Skip only the unusable answers; score on the answers that exist (already current behaviour for short arrays) |
| Fatal matching-run error | `users` / `user_responses` / `user_blocks` / `match_history` query failure, allocation or pre-publish validation failure | Abort with 500 and zero writes (already current behaviour — E11) |

**Reproduction.** E1, E2 (fatal), E3, E4 (silent).

**Root cause.** Missing ingress validation for a nullable, externally-produced column. The code trusts
a shape it never checked, and the failure is amplified by the fact that the whole run is one
uninterrupted request with no per-participant isolation.

**Minimal correction.** Validate at the boundary (§6.1): a `responses_array` that is not an array, or
that yields zero usable string answers, marks the participant **invalid** (excluded and counted), not
fatal. Nothing else changes: no try/catch around the entire handler, no change to
`compatibilityEngine.ts`, no change to the scoring path.

---

### R2 — Database gender constraint — **CONFIRMED absent in repo / UNVERIFIED in production**

**Mechanism.** `matchingEligibility.ts:11-13` and `docs/MATCHING_ALLOCATION_IMPLEMENTATION.md:85`
both assert that production has `users_gender_check` restricting `users.gender` to
`male`/`female`, and the allocator's *bipartite* guarantee leans on that assertion. In this
repository the constraint does not exist: 13 migrations and the production SQL folder contain no
`CHECK`, no enum type, no domain and no trigger on `gender` (E5). What exists is *read-scope*
enforcement of "opposite gender" inside `discover_candidates()` and the users-update policy (E6) —
which constrains *who can see whom*, never *what value* can be stored.

**Implications if the constraint is genuinely absent**
1. The bipartite premise is **assumed, not enforced**. The allocator defends itself: unexpected
   gender values are filtered by `isMatchableGender` (`index.ts:137`, `excludedInvalidGender` in the
   summary) and any residual non-bipartite graph fails closed with `non_bipartite` inside
   `allocateTiers`. So today the *allocation* is safe.
2. The visible effect of a third value is **silent loss of coverage**: such a user is counted in
   `excludedInvalidGender` and never matched, with no operator-visible alarm.
3. The documentation currently states a fact about the database that the repository cannot prove —
   an audit-trail defect independently of the runtime risk.

**Reproduction.** E5 (absence). Not reproducible against production by design.

**Root cause.** A documented invariant was adopted as a premise and never verified against the
schema; the code path that depends on it was hardened (fail-closed) but the premise was not.

**Minimal correction (approved scope — documentation and comments only).**
- *Documentation:* `docs/MATCHING_ALLOCATION_IMPLEMENTATION.md:85` and `matchingEligibility.ts:12`
  must stop asserting the constraint exists. Replace with: gender is enforced in application code;
  the presence (or absence) of `users_gender_check` in the live database is **unverified**; the
  allocator's `non_bipartite` fail-closed guard is the binding guarantee, not any schema object.
- *Record the open question* in the implementation record: confirm against the live database with
  `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.users'::regclass and contype = 'c';`
  before any future decision about an enforced constraint.
- **Not approved / excluded:** creating a gender constraint, changing or backfilling gender values,
  and any gender migration. `isMatchableGender` (`matchingEligibility.ts:24-27`) remains the sole
  guard; it is not weakened or changed.
- Do **not** make the allocator depend on any database gender constraint.

---

### R3 — Same-week rerun safety — **CONFIRMED**

**Mechanism.** Publication is `upsert(historyRows, { onConflict: 'user_id,week_id' })`
(`index.ts:267-277`). `historyRows` contains **only users who currently have a partner**
(`:258-266`). Therefore:
- keys present in both runs are overwritten (correct),
- keys present only in the earlier run are **never removed** (defect),
- a user who loses their partner keeps last run's `tier1_match_id`/`tier2_match_id` and last run's
  `delivered_at`.

**Consequences (E7).** Run 1 (`f0,m0,f1,m1` → 2 pairs, 4 rows) followed by a run with `f0` and `m1`
suspended produced:
```
f0  tier1=m0  ORPHAN (not in run 2 payload)   -> m0 now points at f1   (broken link)
m0  tier1=f1  written by run 2
f1  tier1=m0  written by run 2
m1  tier1=f1  ORPHAN (suspended, still published) -> f1 points at m0   (broken link)
```
Two orphans, two broken mutual links, and a **suspended user shown as matched**. Because the read
path is `user_id + week_id` only (E12), the damage is immediately user-visible — `delivered_at` is
not a gate in this repository, so "re-run after release" is not protected by the timestamp either.

**Historical weeks** are *not* at risk today (the generator never deletes anything at all) — the
correction must preserve that property.

**Reproduction.** E7, E8.

**Root cause.** Publish semantics are "merge", but the domain requires "replace the current week".
The code builds the *complete* week in memory (a replace set) and then writes it with merge
semantics; there is no statement scoped to `week_id` that removes what is no longer part of the
allocation.

**Minimal correction.** Replace the merge with an atomic, week-scoped replace (§7): one RPC that
`DELETE`s `match_history` for `p_week_id` and `INSERT`s the new rows in a single transaction. The
delete predicate is exactly `week_id = p_week_id`, so historical weeks are untouched by
construction, and no cleanup happens outside the target week.

---

### R4 — Concurrent matching runs — **PARTIALLY VERIFIED**

**Mechanism.** There is no coordination of any kind in the publish path (E9): no advisory lock, no
lease/run table, no `run_id` column, no `WHERE version = …` predicate, no `pg_net`/cron-level
serialisation inside the function. Each run reads a snapshot (`users`, `user_responses`,
`user_blocks`, `match_history`), computes in memory for hundreds of milliseconds (measured earlier:
0.63 s at 400 users / 40 000 edges, 0.74 s at 2 000 users), and then publishes.

**Consequences.**
- Two concurrent runs with the *same* snapshot converge to last-writer-wins: deterministic, but
  arbitrary, and the losing run's validated result is silently discarded.
- Two runs with *different* snapshots (a pause/suspension/block landing between the reads) leave the
  earlier run's rows for the users the later run no longer writes — the same orphan/broken-link
  state as R3, and, when the older snapshot publishes last, the week is *entirely* the stale
  allocation including a suspended user (E10: 4 rows, 2 of them involving a non-active user, no
  error from either run).
- Because each run publishes in a single statement, the table never contains a half-written row;
  the inconsistency is **cross-run**, not intra-statement.
- "Separate server instances can publish concurrently" — **yes**: nothing in the function or the
  schema distinguishes instances, and the deploy topology of Edge Functions is multi-instance by
  design.

**Classification note.** The absence of the mechanism is *confirmed by inspection* (E9); the
interleaving outcome is demonstrated by deterministic simulation (E10). A live two-instance overlap
was **not** reproduced (no database access), hence PARTIALLY VERIFIED.

**Root cause.** Publication is treated as a stateless write. Correctness of the week requires that
"compute" and "publish" be ordered with respect to other publishers, which only the database can
guarantee across instances.

**Minimal correction (revised after review — generation fencing, §7).**

The review finding is accepted: *a publication lock serialises publication but does not prevent an
older computation from publishing after a newer computation.* Serialisation orders the two
publishers at the moment of the write; it cannot compare the two *computations*, which began earlier
and may be built from stale snapshots. The design therefore adds an explicit ordering signal, minted
when each run begins:

1. **Begin:** the run calls `begin_match_generation(week)` and receives a monotonic generation
   identifier `G`; the database records `latest_generation = G` for that week (§7.2).
2. **Compute** (unchanged) and **validate** (unchanged pre-publish gate, `index.ts:222-256`).
3. **Publish:** `publish_week_allocation(week, G, rows)` verifies, atomically with the replacement,
   that `G` is still the week's `latest_generation`. If a newer run began meanwhile, the call
   **rejects** with `stale_generation` and touches nothing (§7.3).
4. **Failure:** a newer run that fails or dies leaves the previously published allocation intact
   because publication is one transaction and the fencing comparison precedes the delete (§7.5).
5. **No application memory is involved:** both functions are database-backed (sequence + row lock +
   transaction), so the mechanism holds across Edge Function instances.

The result is *authorization-ordered last-writer-wins*: among competing runs, the one that began
most recently is the only one allowed to land; every older run is rejected without side effects.

The Phase 2 compute-dedup lease (§7.7) is no longer part of the correctness argument — it is purely
an optimisation if duplicate runs are observed.

---

## 5. Root causes (consolidated)

| Root cause | Risks it explains | Why it was not caught |
|---|---|---|
| Publish semantics are *merge* (upsert) while the domain is *replace the week* | R3, R4 | The merge never deletes, and a single-run test suite only exercises one run per week |
| Publication has no cross-instance ordering primitive | R4 | The function is stateless by design; single-instance testing cannot expose it |
| Untrusted external column (`responses_array`) is dereferenced without a shape check | R1 | Test fixtures always provide well-formed arrays |
| A documented schema invariant was never verified against the migrations | R2 | `NOT VALID`-style constraints are invisible to code review; the docs stated the invariant, the code relied on it |
| No publish audit trail (`run_id`, replaced-at, prior allocation) | R3, R4 (observability) | Summary counts are returned to the caller and then discarded |

---

## 6. Proposed minimal corrections

> All sketches are specifications, not applied code. Line anchors are from the current files.

### 6.1 R1 — ingress validation for questionnaires (`match-generator/index.ts:106-113`, ~15 lines)

```ts
// Replace the unguarded profile loop. Invalid rows are excluded and counted; the
// run continues. A malformed row is NEVER treated as a valid answer set.
const invalidQuestionnaires: string[] = []
const profiles = new Map<string, UserProfile>()
for (const response of responses ?? []) {
  const raw: unknown = response.responses_array
  if (!Array.isArray(raw)) { invalidQuestionnaires.push(response.user_id); continue }
  const answers: Record<number, string> = {}
  for (let questionNumber = 1; questionNumber <= 50; questionNumber++) {
    const value = raw[questionNumber - 1]
    if (typeof value === 'string' && value.trim() !== '') answers[questionNumber] = value
  }
  if (Object.keys(answers).length === 0) { invalidQuestionnaires.push(response.user_id); continue }
  profiles.set(response.user_id, { id: response.user_id, answers })
}
if (invalidQuestionnaires.length > 0) {
  console.warn('skipped malformed questionnaires', { count: invalidQuestionnaires.length, userIds: invalidQuestionnaires })
}
```

Notes for implementation:
- Add `invalidQuestionnaires: invalidQuestionnaires.length` to the JSON summary (count only; the ids
  go to the server log, consistent with the existing "no user ids in the response" policy).
- `participants` (`:208`) already filters on `profiles.has(...)`, so exclusion needs no second guard.
- No change to `compatibilityEngine.ts`; `.trim()` there is only ever reached by real strings now.
- Behavioural delta: `NULL`/non-array rows and all-non-string rows stop aborting the run; they lose
  their own eligibility only.

### 6.2 R2 — correct the misleading documentation and comments (no database change)

- `matchingEligibility.ts:12`: replace the `` `users_gender_check` `` sentence with
  "Enforced here in application code. A database CHECK on `users.gender` is **not verified** to
  exist (no such constraint exists in this repository's migrations); `isMatchableGender` is the
  guard, and any residual non-bipartite graph fails closed inside the allocator."
- `docs/MATCHING_ALLOCATION_IMPLEMENTATION.md:85`: same correction, plus one sentence recording that
  the live database state is unverified and how to check it (§4, R2).
- **Explicitly out of scope:** no `ALTER TABLE`, no constraint, no data backfill, no migration.
- No application logic changes.

### 6.3 R3 + R4 — fenced, atomic week replacement (one migration + ~12 lines in the generator)

- New database objects (§7.2): `match_generation_seq`, `match_week_generations`,
  `begin_match_generation(text)`, `publish_week_allocation(text, bigint, jsonb)`.
- `index.ts` — begin the run early, right after authorisation and before the population read, so the
  generation reflects start order:

```ts
const { data: generation, error: generationError } = await supabase
  .rpc('begin_match_generation', { p_week_id: weekId })
if (generationError || generation == null) {
  return new Response(JSON.stringify({ error: 'generation_begin_failed', detail: generationError?.message }), { status: 500 })
}
```

- `index.ts:267-277` becomes:

```ts
const { data: publishResult, error: historyError } = await supabase.rpc('publish_week_allocation', {
  p_week_id: weekId,
  p_generation: generation,
  p_rows: historyRows,
})
if (historyError) {
  const stale = historyError.message?.includes('stale_generation')
  return new Response(
    JSON.stringify({ error: stale ? 'stale_generation' : 'publish_failed', detail: historyError.message, generation }),
    { status: stale ? 409 : 500 },
  )
}
```

  The `if (historyRows.length > 0)` bypass is removed deliberately: an empty week must **clear** the
  current week (that is the R3 case where everyone lost their partner), and calling the function
  with `[]` is the way to express it. To keep that safe, log it:
  `if (historyRows.length === 0) console.warn('week cleared', { weekId, generation, participants: participants.length })`.
- The pre-publish validation gate (`:222-256`) stays exactly where it is, before publication. It is
  the guard that prevents a buggy allocation from ever reaching the replacing statement.
- The run summary gains `generation` (and `published`) for operator traceability. No user ids.
- No change to `match_history` columns or the unique index; no change to Qrashe or Section 2.

**Why a server-side function and not a client-side delete-then-upsert?** Two PostgREST calls are two
transactions: a crash or timeout between them would leave the week deleted and empty — strictly worse
than today. Only a single server-side transaction gives "either the old week or the new week, never
neither", and only a server-side comparison can see the current generation under the same lock.

---

## 7. Database transaction, generation fencing and locking design

### 7.1 Requirements

1. **Atomicity** — the week is replaced completely or not at all.
2. **Scope** — only `week_id = p_week_id` may be touched; other weeks are immutable from here.
3. **Mutual exclusion** — two publishers must not interleave. Must survive multiple Edge Function
   instances, so it must be database state, not process state.
4. **Ordering (fencing)** — a run built from an older snapshot must never be able to publish over a
   run that *began* later, even if it reaches the write first. Ordering must be established when the
   run begins, not when it writes (§7.5 explains why this is a separate requirement).
5. **Stale rejection is side-effect free** — a fenced-out run must not delete, update or insert
   anything.
6. **Failure semantics** — the lock/row-lock is released on every exit path including exceptions;
   a failed publish leaves the previous week fully intact; a newer run that dies must not damage the
   published week.
7. **Monotonicity** — generation identifiers increase strictly and are never reused, so they can be
   compared by simple `<`.
8. **Least privilege** — callable only by the service role; not by `anon`/`authenticated`.

### 7.2 Required objects (M1)

Three additive objects: one sequence, one small fencing table, two functions. Nothing in
`match_history` changes.

```sql
-- 1. Global monotonic generation counter. Never reused; gaps are acceptable.
create sequence if not exists public.match_generation_seq as bigint start 1;

-- 2. Per-week fencing state (one row per week, ~1 row per week forever).
create table if not exists public.match_week_generations (
  week_id                     text primary key,
  latest_generation           bigint not null,   -- newest AUTHORIZED (begun) run
  latest_published_generation bigint,             -- newest generation that actually replaced the week
  published_at                timestamptz,
  updated_at                  timestamptz not null default now()
);

alter table public.match_week_generations enable row level security;
revoke all on public.match_week_generations from anon, authenticated;
revoke all on sequence public.match_generation_seq from anon, authenticated;

-- 3a. Called once at the START of every run. Returns this run's generation.
create or replace function public.begin_match_generation(p_week_id text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare g bigint;
begin
  if p_week_id is null or p_week_id = '' then
    raise exception 'begin_match_generation: week id is required' using errcode = '22023';
  end if;

  g := nextval('public.match_generation_seq');

  insert into public.match_week_generations (week_id, latest_generation, updated_at)
  values (p_week_id, g, now())
  on conflict (week_id) do update
    set latest_generation = greatest(public.match_week_generations.latest_generation,
                                     excluded.latest_generation),
        updated_at = now();

  return g;
end $$;

-- 3b. Called once at the END of every run. Fenced, atomic replacement.
create or replace function public.publish_week_allocation(
  p_week_id   text,
  p_generation bigint,
  p_rows      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_generation   bigint;
  published_generation bigint;
  inserted             integer;
begin
  if p_week_id is null or p_week_id = '' then
    raise exception 'publish_week_allocation: week id is required' using errcode = '22023';
  end if;
  if p_generation is null then
    raise exception 'publish_week_allocation: generation is required' using errcode = '22023';
  end if;

  -- Serialise publishers of THIS week and read the fencing state under the lock.
  select latest_generation, latest_published_generation
    into current_generation, published_generation
  from public.match_week_generations
  where week_id = p_week_id
  for update;

  if not found then
    raise exception 'unknown_generation' using errcode = 'P0002';
  end if;

  -- FENCING: only the newest authorized run may publish. Checked BEFORE any write.
  if p_generation < current_generation then
    raise exception 'stale_generation' using errcode = '40001';
  end if;

  -- Week-scoped replace. Historical weeks are unreachable by this predicate.
  delete from public.match_history where week_id = p_week_id;

  insert into public.match_history (user_id, week_id, tier1_match_id, tier2_match_id, delivered_at)
  select (r->>'user_id')::uuid,
         p_week_id,
         nullif(r->>'tier1_match_id', '')::uuid,
         nullif(r->>'tier2_match_id', '')::uuid,
         (r->>'delivered_at')::timestamptz
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r;

  get diagnostics inserted = row_count;

  update public.match_week_generations
     set latest_published_generation = p_generation,
         published_at = now(),
         updated_at = now()
   where week_id = p_week_id;

  return jsonb_build_object('published', inserted, 'generation', p_generation);
end $$;

revoke all on function public.begin_match_generation(text) from public, anon, authenticated;
revoke all on function public.publish_week_allocation(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.begin_match_generation(text) to service_role;
grant execute on function public.publish_week_allocation(text, bigint, jsonb) to service_role;
```

Design notes that must survive review:

| Concern | Why this shape |
|---|---|
| Serialisation primitive | `select … for update` on the week's fencing row: the row lock is held until commit/rollback, so two publishers cannot both pass the fence and delete. The earlier `pg_advisory_xact_lock` is no longer needed — the row it must protect is now a real row that is read and written anyway. |
| Fence before write | The comparison precedes the `delete`. A stale run raises and rolls back having touched nothing (requirement 5). |
| Fence vs replacement atomicity | Both happen in one transaction under one lock, so no third run can observe or interleave between "is this current?" and "replace the week". |
| `nextval` semantics | Non-transactional: a rolled-back `begin` burns a number. That is harmless — identifiers only need to be monotonic and unique, not dense. |
| Concurrent `begin` | Two starts may mint 100 and 101 in either commit order; `greatest()` makes `latest_generation` 101 regardless, so the newer run always wins the fence. The older run is stale even if its `begin` committed last. |
| Equal generation is allowed | A retried publish for the *same* generation passes the fence (`<` not `<=`) and re-writes the identical payload: idempotent replay. |
| Rejection signalling | Raising with SQLSTATE `40001` aborts the transaction (nothing written) and surfaces as a PostgREST error; the generator maps the message to HTTP 409 `stale_generation`. |
| Row count | Returned as JSON so the generator can assert `published === historyRows.length` and fail loudly on a mismatch. |
| Duplicate protection | The pre-existing unique index `(user_id, week_id)` still applies to the insert (the payload has one row per user). |
| Long-term size | One fencing row per week; negligible. `match_history` shape is unchanged, so no client impact. |
| SECURITY DEFINER + pinned `search_path` | Avoids schema shadowing; execution restricted to `service_role`, which is what the generator uses. |

**Alternatives considered and rejected**

| Alternative | Why rejected |
|---|---|
| Advisory lock only (previous draft) | Serialises the write but cannot tell that one computation is older than another: a stale run simply waits its turn and then publishes. This is the review finding. |
| `lock table public.match_history` | Blocks readers and every other week; far heavier than one row lock. |
| `serializable` isolation | PostgREST gives no retry loop; failures would surface as flaky 500s. |
| Version/`run_id` column on `match_history` | Changes a client-visible table and its RLS surface for a purely operational concern. |
| In-memory mutex / instance-local flag | Does not exist across Edge Function instances; explicitly forbidden by the review. |
| Timestamp comparison (`now()` at begin) | Clock skew and coarse resolution make it non-monotonic; a sequence is exact. |

### 7.3 Generation lifecycle

| Phase | Database action | State afterwards |
|---|---|---|
| Run starts (before reading any data) | `begin_match_generation(week)` → `latest_generation = G` | Week authorized under `G`; every older in-flight run is now stale |
| Compute | none | unchanged |
| Pre-publish validation | none | unchanged |
| Publish, `G` current | `delete` + `insert` + `latest_published_generation = G` | Week = this run's allocation, atomically |
| Publish, `G` stale | `raise 'stale_generation'` | Rolled back; week **and** counters untouched |
| Publish raises for any other reason | transaction abort | Rolled back; previous allocation intact, `latest_published_generation` unchanged |
| Run dies / times out before publishing | none | Week keeps its last published allocation; `G` still fences older runs |
| Publish retried with the same `G` | second identical replace | Same final state (idempotent) |

Worked timeline (two runs, newest authorization wins):

| t | Event | `latest_generation` | `latest_published` | Week content |
|---|---|---|---|---|
| 1 | A begins | 100 | – | previous week |
| 2 | B begins | 101 | – | previous week |
| 3 | B publishes (101) | 101 | 101 | B's allocation |
| 4 | A publishes (100) → `stale_generation` | 101 | 101 | **B's allocation, untouched** |

Properties this yields:

- **`latest_published_generation` only moves forward** on a successful replace, so a failed or
  rejected newer run can never remove the previously published week.
- **A dead newest run does not strand the week.** It only fences *older* runs. The next run —
  scheduled or manual — calls `begin` again, receives a higher generation, and publishes normally.
  There is no lease to expire, no timeout to tune, and no manual unlock.
- **Rejection is total.** A stale run writes nothing: no delete, no insert, no counter update.
- **Ordering is authorization order, not write order** — which is exactly the property the earlier
  lock-only draft lacked.

### 7.4 Failure and retry behaviour

| # | Failure point | Database effect | Generator response | Operator action |
|---|---|---|---|---|
| 1 | `begin_match_generation` errors (DB unavailable) | nothing | `500 generation_begin_failed` | retry later |
| 2 | `users` / `user_responses` / `user_blocks` / `match_history` read fails | nothing (existing fail-closed paths) | existing `400`/`500` codes | retry later |
| 3 | Allocation or pre-publish validation fails | nothing | `500 allocation_failed` / `validation_failed` | investigate |
| 4 | Publish while a newer run is authorized | **nothing** (fence raises before the delete) | `409 stale_generation` | none — a later run already superseded this one |
| 5 | Publish raises inside the insert (bad payload, constraint) | full rollback; previous week intact; counters unchanged | `500 publish_failed` | investigate payload |
| 6 | Request dies between `begin` and `publish` | nothing written; older runs fenced | none (no response) | rerun when ready — the rerun gets a new generation |
| 7 | Publish times out mid-transaction | transaction aborted (same as #5) | `500` from the platform | rerun |
| 8 | Client retries the same request / same generation | idempotent replace | `200` with `published` count | none |

**Retry rules.** There is **no automatic retry loop** inside the function: a retry is a *new run* and
must therefore begin a *new generation*. Auto-retrying a `409 stale_generation` is explicitly
forbidden — the winner may still be publishing, so a retry would either loop or needlessly recompute.

**Count assertion.** The function returns the number of rows it inserted. The generator asserts
`published === historyRows.length`; a mismatch is practically unreachable (one row per user + the
unique index), but is logged and returned as `500 publish_count_mismatch` rather than ignored.

### 7.5 Caller contract (generator), in order

1. Authorise the caller (unchanged, `:49-85`).
2. **`begin_match_generation(weekId)`** — before reading any data, so the fence reflects start order.
3. Read `users`, `user_responses`, `user_blocks`, previous-week history (unchanged, fail-closed).
4. Score, allocate, run the pre-publish validation gate (unchanged).
5. Build `historyRows` for every user with a partner (unchanged).
6. **`publish_week_allocation(weekId, generation, historyRows)`** — exactly once, never in a loop.
7. Map errors: `stale_generation` → 409; anything else → 500. Include `generation` and `published`
   in the run summary for traceability (counts only, no user ids).

### 7.6 Why the publication lock alone was insufficient (accepted review finding)

A lock orders writes; it cannot compare computations. The concrete interleaving observed in E10:

```
A begins (G=100), reads snapshot S0 where m1 is active
B begins (G=101), reads snapshot S1 where m1 is suspended
B publishes(101)              -> week = B's allocation
A publishes(100)  LOCK-ONLY   -> waits for the lock, then replaces the week with S0 (E10: suspended user published)
A publishes(100)  FENCED      -> raised stale_generation, week untouched
```

The fence is what converts "last writer wins, whatever its data" into "newest authorization wins,
and older work is rejected without side effects". This is why requirement 4 of §7.1 is separate from
requirement 3.

### 7.7 Optional Phase 2 — compute lease (not part of the correctness argument)

Generation fencing already guarantees that only the newest run can publish. A lease would only save
the wasted computation of a run that is going to be fenced anyway:

```sql
create table if not exists public.match_run_leases (
  week_id text primary key,
  owner text not null,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now()
);
-- acquire: insert ... on conflict do nothing; treat a lease older than 15 min as stale (delete it first)
```

Justified only if duplicate concurrent runs are observed in practice; it adds a table, a stale-timeout
rule and a failure mode of its own, so it is deliberately **out of the minimum scope** and **not**
required for R4's guarantees.

---

## 8. Interaction between reruns and concurrent execution

Publication after the fix is a fenced, atomic, week-scoped replace: a run may only land if no newer
run has been *authorized* for that week (§7.3).

| Scenario | Today | After fix (M1 + §6.3) |
|---|---|---|
| Single run | correct | correct (unchanged behaviour) |
| Same-week rerun, identical population | rows overwritten; stale rows impossible (same key set) | identical result; `delivered_at` refreshed; `latest_published_generation` advances |
| Same-week rerun, changed population (R3) | **orphans + broken mutual links + suspended users published** (E7) | the week is exactly the new allocation; obsolete rows are gone |
| Two concurrent runs, same snapshot (R4) | last writer wins; the loser's result vanishes with no trace | newest authorization wins; the older run is rejected with `409 stale_generation` and writes nothing |
| Two concurrent runs, different snapshots (R4) | hybrid week; suspended user published (E10) | the newer run's week wins in full; the older run is fenced out **without touching the week** (the case a lock alone could not prevent) |
| Older run publishes *after* a newer run began but before it published | stale data lands, undetected | rejected (fence compares generations, not arrival time) |
| Newer run fails / dies after `begin` | n/a | previously published week intact; the week is refreshed by the next run's new generation |
| Concurrent runs on *different* weeks | unaffected | unaffected (distinct fencing rows; week-scoped delete) |
| Publish fails mid-way | single statement; a pre-existing week stays stale | transaction rolls back; previous week intact; row lock released |
| Deploy order mistake (new generator, functions absent) | n/a | `500 publish_failed` **before** any write — fails closed |

Three interaction rules the implementation must keep:

1. **The replace must never be split.** A delete + separate upsert from the Edge Function would
   reintroduce the failure mode the function exists to prevent, and would also break the atomicity of
   "fence check → replace".
2. **The generation must be minted at run start, not at publish time.** Minting late would defeat the
   ordering guarantee: two runs could compute from different snapshots and the later *mint* would
   still win on merits it does not have.
3. **Neither the fence nor the lock may be held around the compute.** Publication holds the row lock
   for milliseconds; compute-level serialisation is the optional §7.7 lease, not part of correctness.

One accepted semantic consequence, to be stated in the implementation record: a mid-week rerun
**replaces** what users already saw, and the previous allocation is not recoverable (no audit table in
the minimum scope). If that is unacceptable for operations, add an optional audit table later — it is
not needed for correctness.

---

## 9. Migration requirements

| ID | Required? | Object | Notes |
|---|---|---|---|
| **M1** | **Yes** | (a) sequence `match_generation_seq`; (b) table `match_week_generations`; (c) `begin_match_generation(text)`; (d) `publish_week_allocation(text, bigint, jsonb)` (§7.2) | Purely additive. No change to `match_history` (columns, indexes, RLS) or any other table. Execution granted to `service_role` only. |
| ~~M2~~ | **Withdrawn** | ~~`users_gender_check` CHECK constraint~~ | Not approved in review. R2 is now documentation/comment-only (§6.2). No gender constraint, no data change, no gender migration. |
| M3 | Optional (not required) | `match_run_leases` + acquire/release helpers (§7.7) | Only saves duplicate compute; generation fencing already prevents stale publication. |

**Deploy order (release checklist):**
1. Apply M1 (single migration file: sequence, table, both functions, grants).
2. Smoke-test by hand: `begin_match_generation('2999-W01')` twice (must return increasing values),
   `publish_week_allocation('2999-W01', <older>, '[]'::jsonb)` (must raise `stale_generation`),
   `publish_week_allocation('2999-W01', <newer>, '[]'::jsonb)` (must return `published: 0`), then
   delete the `2999-W01` fencing row.
3. Deploy `match-generator` (now calling both functions).
4. Trigger one manual run on a non-production week id; verify row count, `delivered_at`,
   `latest_generation`, `latest_published_generation`.

**Rollback strategy:**

| Situation | Action |
|---|---|
| New generator misbehaves | Redeploy the previous generator first. It never calls the new functions, so old code + new objects coexist harmlessly. |
| Abandon the design entirely | Only **after** the old generator is live: `drop function public.publish_week_allocation(text, bigint, jsonb); drop function public.begin_match_generation(text); drop table public.match_week_generations; drop sequence public.match_generation_seq;` |
| Partial rollback (keep fencing, revert allocation replacement) | Not supported — they share one function and one transaction by design. |
| Data rollback | None needed: `match_history` schema is untouched and the fence table holds no allocation data. Deleting the fence row for a week simply re-allows any generation to publish. |
| Never do this | Drop the functions while the new generator is deployed: every publish returns `publish_failed` and no week is delivered (fail-closed but operationally dark). |

**No migration is proposed for:** `match_history` columns/indexes/RLS, Qrashe `matches`, Section 2
tables, `users` (no gender constraint), cron jobs, environment variables. `delivered_at` is not used
as a release gate in this repository (§2.2); adding one would change product behaviour and is out of
scope.

---

## 10. Test cases and acceptance criteria

All tests below are to be added to the existing suite style
(`scripts/test-matching-allocation.mjs`, part B, harness with the fake Supabase client). Each row is
a test that must be executed, not merely authored.

### R1 — malformed questionnaire data

| ID | Input | Expected | Acceptance |
|---|---|---|---|
| T-A1 | 4 valid users + 1 row with `responses_array = null` | run survives; the null user is excluded; the other pairs publish | `status 200`, `invalidQuestionnaires === 1`, `upserts === 1`, `tier1Pairs === 2` |
| T-A2 | `responses_array = [1..50]` (numbers) | same as T-A1 (no `.trim` crash) | no exception; `invalidQuestionnaires === 1` |
| T-A3 | `responses_array = []` | participant invalid, counted, no NaN/pair attempts | `invalidQuestionnaires === 1`, no pair containing that user |
| T-A4 | `responses_array` with 10 of 50 answers | participant valid, scored on the 10 | paired by score; no exception; `invalidQuestionnaires === 0` |
| T-A5 | `responses_array` with non-string junk at some positions | junk positions ignored, valid positions used | no throw; score computed from the usable answers only |
| T-A6 | no `user_responses` row for one user | that user excluded (unchanged behaviour) | `eligibleUsers < users count`; run succeeds |
| T-A7 | **all** rows malformed | run succeeds and publishes nothing; the week is cleared by the RPC | `status 200`, `usersDelivered === 0`, RPC called once with `[]` |
| T-A8 | fully valid population (regression) | byte-identical summary to today | `tier1Pairs`, `tier2Pairs`, `usersDelivered` unchanged vs baseline |

### R2 — gender constraint (documentation-only scope)

| ID | Check | Acceptance |
|---|---|---|
| T-B1 | No gender constraint is shipped | the change set contains **no** migration touching `public.users`, and `grep -rn "ALTER TABLE public.users" <new migrations>` returns nothing |
| T-B2 | Docs and comments no longer assert the constraint exists | `grep -rn users_gender_check docs/ supabase/functions/_shared/` returns only text stating it is **unverified**/absent, never "production has" |
| T-B3 | The unverified live-DB state is recorded | the verification query is documented in both `docs/MATCHING_ALLOCATION_IMPLEMENTATION.md` and the implementation record |
| T-B4 | Application code is unchanged | `git diff --stat supabase/functions/_shared/matchingEligibility.ts` shows comment lines only; the 17 checks in `verify-matching-eligibility.mjs` and T6b/T6d still pass |
| T-B5 | The application guard still excludes third genders | a user with `gender = 'nonbinary'` is never paired and increments `excludedInvalidGender` |

### R3 — rerun safety

| ID | Scenario | Acceptance |
|---|---|---|
| T-C1 | run A (4 users) then run B with 2 users suspended | final table contains exactly B's payload; `count(*) === usersDelivered` |
| T-C2 | same as T-C1 | **0 orphan rows**: every row's `user_id` is in B's payload |
| T-C3 | same as T-C1 | **0 broken mutual links**: for every `tier1_match_id`, the partner's row points back |
| T-C4 | historical weeks: seed `week-1` rows, then rerun the current week | `week-1` rows byte-identical (count and content) |
| T-C5 | rerun where nobody matches (empty allocation) | current week cleared, `week-1` untouched, `status 200` |
| T-C6 | SQL-level assertion | the only delete executed is scoped by `week_id = $1` (test asserts the RPC argument) |
| T-C7 | delivered_at | rows carry the current run's `delivered_at`, not the previous one |

### R4 — concurrency and generation fencing

| ID | Scenario | Acceptance |
|---|---|---|
| T-D1 | two payloads for the same week applied in both orders, second generation each time | final state equals exactly one payload: no orphans, no hybrids |
| T-D2 | two concurrent publish calls, same week (real DB, test branch) | both complete serially; the older generation is rejected; final state = newest generation's payload |
| T-D3 | exception inside the insert (e.g. malformed uuid) | transaction rolls back; previous week fully intact; `latest_published_generation` unchanged; a follow-up publish succeeds immediately (no stuck lock) |
| T-D4 | two different weeks published concurrently | both succeed, neither blocks the other |
| T-D5 | functions missing (deploy-order test) | generator returns `500 publish_failed`, **0 writes** |
| T-D6 | `authenticated` / `anon` calling `begin_match_generation` or `publish_week_allocation` | permission denied (grants restricted to `service_role`) |
| T-D7 | `begin` called three times | strictly increasing generations (`G1 < G2 < G3`) |
| T-D8 | `begin` G1, `begin` G2, `publish` G1 | `stale_generation`; `match_history` for the week **unchanged**; `latest_published_generation` unchanged |
| T-D9 | continue from T-D8: `publish` G2 | week replaced; `latest_published_generation = G2`; row count matches payload |
| T-D10 | `publish` G1 again after T-D9 (stale run arriving late) | `stale_generation`; the G2 week is byte-identical afterwards |
| T-D11 | `begin` G3 then `publish` G3 with a failing payload | rolled back; week still G2's rows; `latest_published_generation` still G2 |
| T-D12 | G3 dies after `begin`; G1 (older, still in flight) tries to publish | rejected as stale (fencing is by authorization, not liveness); week unchanged |
| T-D13 | after T-D12: new `begin` G4 then publish | succeeds; week = G4's payload (the week is never stranded) |
| T-D14 | `publish` without any prior `begin` for that week (or unknown week) | `unknown_generation`; **0 writes** |
| T-D15 | high generation in week B, low generation in week A | week A publishes normally (fencing rows are per week) |
| T-D16 | `publish` the same generation twice with the same payload | identical final state; `published` count stable (idempotent) |
| T-D17 | generator receives `stale_generation` | HTTP **409**, response `{error:'stale_generation', generation}`, **0 writes**, no retry attempted |
| T-D18 | generator happy path | summary carries `generation` and `published === usersDelivered`; `latest_published_generation` equals that generation |

### Global acceptance gate (must all hold before merge)

1. `scripts/test-matching-allocation.mjs`: all existing tests still pass (baseline 47 non-mutation
   tests + 3 mutation tests run in isolation), plus T-A1…A8, T-B1…B5, T-C1…C7, T-D1…D18.
2. `verify-matching-eligibility.mjs` (17 checks), `verify-section2-isolation.mjs`,
   `verify-weekly-generation-safety.mjs`, `verify-section1-*.mjs` all green.
3. Oracle parity unchanged: 296 NetworkX graphs and 186 exhaustive graphs, 0 deviations (these
   numbers are the pre-change baseline and must not move, because the solver is not touched).
4. Rerun the R3/R4 harness scenarios and paste the final table dump **and** the generation counters
   into the PR.
5. The diff contains no change to: 5% floor, `edgeWeight`, solver, Tier 1/Tier 2 semantics,
   eligibility predicate, `calculateCompatibility`, Qrashe, Section 2, `match_history` schema,
   `users` schema.

---

## 11. Regression risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | JSON payload bug (`null` vs `""` uuids, timestamptz format) | Medium | `nullif(...,'')::uuid`; T-A1/T-C5 cover empty weeks; count assertion `published === historyRows.length` |
| 2 | Empty week wipes a good week because of an upstream bug | Low | pre-publish validation gate unchanged; explicit `console.warn` on empty publish; T-C5 pins the intended behaviour |
| 3 | Week-scoped delete accidentally widened | Low but catastrophic | predicate hard-coded in the function, never passed by the caller; T-C4/T-C6 |
| 4 | Row-lock contention on a manual rerun | Very low | lock held for milliseconds on one row; different weeks use different rows |
| 5 | Deploy order: generator before migration | Medium | every publish fails closed (`500 publish_failed`, 0 writes); checklist §9 |
| 6 | R1 validation changes the eligible population for corrupt rows | Low | only rows that previously **crashed** (null/numeric) or were already ignored change; T-A8 asserts no change on valid data |
| 7 | Someone re-hardens the functions as `security invoker` or broadens grants | Medium | T-D6 asserts the permission model |
| 8 | Documentation correction skipped, false claim propagates again | Medium | T-B2/T-B3 are grep assertions in CI |
| 9 | **Fence rejects a legitimate in-flight run** (an older run is discarded because a newer run merely *began*) | Medium (by design) | Intended semantics: authorization order wins. Operators must treat `409 stale_generation` as "superseded", not as an error; T-D17 asserts no retry loop |
| 10 | **A newer run dies after `begin`, leaving the week unrefreshed** until the next run | Low | old allocation stays published (never partial); the next scheduled/manual run mints a higher generation and publishes; T-D12/T-D13 pin this |
| 11 | `begin` succeeds but the run aborts before publishing, burning a generation | Certain, harmless | identifiers only need monotonicity (`nextval` is non-transactional by design) |
| 12 | Scheduler treats `409` as success and never retries | Low | documented in §7.4; 409 means "a newer run owns the week" |
| 13 | Fencing table grows unboundedly | Negligible | one row per week (~52/year) |
| 14 | Optional lease (M3) reintroduces a stale-lock outage | Low | out of minimum scope; fence already guarantees correctness |

**Explicitly not at risk** (no code path touched): 5% floor, `edgeWeight` encoding, card-first solver,
Tier 1/Tier 2 semantics, eligibility predicate, `calculateCompatibility`, Qrashe `matches`,
Section 2 scoring, `match_history` schema, `users` schema/gender values.

---

## 12. Implementation sequence

| Step | Change | Gate before proceeding |
|---|---|---|
| 0 | Baseline capture (branch, HEAD, status, hashes, existing test counts) | matches §15 |
| 1 | **R2 documentation/comment correction** (2 files, no migration) | T-B1…B5 pass; no test output changes |
| 2 | **M1 migration** (sequence + fence table + both functions) + manual fence smoke test on a scratch branch | `begin` twice returns increasing values; stale publish raises; current publish returns `published`; T-D6/D7/D8/D14/D15 green |
| 3 | **R1 ingress validation** in the generator + T-A1…A8 | full existing suite + new A-tests green |
| 4 | **R3/R4 generator switch** (begin early, publish fenced) + T-C1…C7, T-D1…D18 | 0 orphans, 0 broken links; stale run → 409 with 0 writes; counters correct |
| 5 | Update `docs/MATCHING_ALLOCATION_IMPLEMENTATION.md` (publication semantics, rerun, concurrency/fencing, gender claim) | doc review |
| 6 | Optional Phase 2 lease (M3) | separate review; not required for release |

Steps 1 and 3 are independent of the database work. Step 4 depends on step 2 (the generator calls
the new functions); step 1 can ship alone. **No gender migration step exists** — it was withdrawn.

---

## 13. Explicit list of files expected to change

| # | File | Change | Size |
|---|---|---|---|
| 1 | `supabase/migrations/<timestamp>_match_generation_fencing.sql` | **new**: sequence, `match_week_generations`, `begin_match_generation`, `publish_week_allocation`, grants (M1) | ~85 lines |
| 2 | `supabase/functions/match-generator/index.ts` | R1 guard (`:106-113`), R4 begin call (after `:85`), R3/R4 fenced publish (`:267-277`), summary keys | ~25 lines changed |
| 3 | `scripts/test-matching-allocation.mjs` | new T-A, T-B, T-C, T-D cases | ~260 lines added |
| 4 | `docs/MATCHING_ALLOCATION_IMPLEMENTATION.md` | publication/rerun/fencing semantics; remove the `users_gender_check` claim (`:85`) and record it as unverified | ~18 lines |
| 5 | `supabase/functions/_shared/matchingEligibility.ts` | comment correction only (`:12`); **no logic change** | 2 lines |
| 6 | `docs/MATCHING_RELIABILITY_REMEDIATION_SPEC.md` | this document (revised) | new |
| 7 | `scripts/verify-matching-publication.mjs` | **recommended new** verification script mirroring T-C/T-D incl. fence scenarios | ~150 lines |
| 8 | `supabase/migrations/<timestamp>_match_run_leases.sql` | **optional** Phase 2 M3 | ~25 lines |

**No gender migration and no `users` migration appear in this list** — R2 is documentation-only.

Deliberately **not** changed: `_shared/matchingAllocation.ts`, `_shared/maxWeightMatching.ts`,
`_shared/compatibilityEngine.ts`, `src/**`, `supabase/config.toml`, any Qrashe or Section 2 object,
`package.json` (no new dependency; `rpc()` is part of the already-used client).

---

## 14. Remaining uncertainties

| # | Uncertainty | Classification | How to close it |
|---|---|---|---|
| 1 | Whether production actually has `users_gender_check` | UNVERIFIED — **recorded as open, no action taken** | `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid='public.users'::regclass and contype='c';` |
| 2 | Whether `responses_array` NULL rows exist in production, and how many | UNVERIFIED | `select count(*) from public.user_responses where responses_array is null;` |
| 3 | Whether the unique index `match_history_user_week_uidx` is live in production | UNVERIFIED | `\d public.match_history` |
| 4 | Whether anything already schedules overlapping runs (cron + manual) | UNVERIFIED | `select * from cron.job;` — not available here |
| 5 | Live two-instance overlap behaviour | PARTIALLY VERIFIED (simulated, T-D2 pending) | T-D2 on a test branch |
| 6 | Whether the scheduler maps a `409 stale_generation` to a visible alert | UNVERIFIED | inspect the cron/webhook configuration that calls the function |
| 7 | Whether an audit/history of replaced allocations is a product requirement | OPEN | product decision; optional Phase 3 |
| 8 | Whether mid-week replacement of already-released matches is acceptable | OPEN | product decision; if not, a release gate is a product change, out of scope |

---

## 15. Preservation verification

Captured at the start and re-verified at the end of this investigation.

| Item | Value |
|---|---|
| Branch | `feat/matching-allocator` |
| HEAD | `c968614904098fad9073dffb024c7a7a9a494ff7` |
| Staged changes | none (`git diff --cached` empty) |
| Application code / migrations / config touched | **none** |
| Only file created | `docs/MATCHING_RELIABILITY_REMEDIATION_SPEC.md` (this document; the assignment's deliverable) |
| Revision 2 (this pass) | **only this document was rewritten**; no other file was read-modify-written, created or deleted |

Pre-existing working-tree state, preserved unchanged (4 modified + 7 untracked, plus this document):

```
 M package.json
 M scripts/verify-matching-eligibility.mjs
 M supabase/functions/_shared/matchingEligibility.ts
 M supabase/functions/match-generator/index.ts
?? docs/MATCHING_ALLOCATION_IMPLEMENTATION.md
?? docs/MATCHING_RELIABILITY_REMEDIATION_SPEC.md   <- created by this investigation
?? scripts/_hash.ps1
?? scripts/_nx_oracle.py
?? scripts/test-matching-allocation.mjs
?? scripts/test-max-weight-matching.mjs
?? supabase/functions/_shared/matchingAllocation.ts
?? supabase/functions/_shared/maxWeightMatching.ts
```

All reproductions ran from `%TEMP%\ver` against copies: the repository's real handler and shared
modules were imported read-only, and every write target was an in-memory fake table. No database
connection, no migration, no environment variable and no other worktree was touched.

---

## 16. Verdict

| Risk | Classification | Fix size |
|---|---|---|
| R1 malformed questionnaire | **CONFIRMED** | ~15 lines, one function |
| R2 gender constraint | **CONFIRMED absent in repo / UNVERIFIED in production** | documentation + comments only; **no migration, no constraint, no data change** |
| R3 same-week rerun | **CONFIRMED** | atomic week-scoped replace inside the fenced function |
| R4 concurrent runs | **PARTIALLY VERIFIED** | generation fencing (sequence + per-week fence row + row lock) + ~6 extra generator lines |

Nothing here touches the frozen surfaces: the 5% floor, the scoring formula, the cardinality-first
objective, the repeat priorities, Tier 1/Tier 2 semantics, the eligibility predicate and the gender
data model all remain exactly as approved. That is why the 296-graph and 186-graph optimality
evidence stays valid.

### Revision history

| Rev | Change |
|---|---|
| 1 | Initial investigation and specification (four risks, advisory-lock publication design, optional gender CHECK). |
| 2 | Accepted review findings: (a) **R2 reduced to documentation/comments only** — the `NOT VALID` gender CHECK and migration are withdrawn; live-DB state recorded as unverified. (b) **R4 redesigned around generation fencing** — monotonic generation at run start, per-week latest-authorized generation, fence check + week replacement in one transaction, stale runs rejected with zero side effects, previous allocation preserved on newer-run failure. The advisory lock is superseded by a row lock on the fence row. (c) Sections 6.3, 7 (rewritten), 8, 9, 10, 11, 12, 13 and 14 updated; new concurrency tests T-D7…T-D18 added; rollback strategy added. |
| 3 (implementation record) | Approved and implemented as a single change set. Added `20261118120000_match_generation_fencing.sql` (purely additive: `match_generation_seq`, `match_week_generations`, `begin_match_generation`, `publish_week_allocation`, service_role-only grants, no match_history/users schema change); R1 questionnaire ingress validation and R3/R4 fenced publication in `match-generator/index.ts` (generation minted before reads, malformed rows excluded + counted, publish via RPC with 409 `stale_generation` mapping, publish-count reconciliation); R2 comment/doc corrections only (`matchingEligibility.ts`, `MATCHING_ALLOCATION_IMPLEMENTATION.md`); added `scripts/verify-matching-publication.mjs` and D1…D9 / E1…E8 cases to the allocation suite. 67/67 suite tests, 36/36 SQL publication checks, all eligibility/section-2/weekly-safety verifiers pass; frozen modules byte-identical. `npm run verify` blocked only at the pre-existing `@electric-sql/pglite` resolution gap (no `node_modules` in this worktree), not by these changes. |

**IMPLEMENTATION SPECIFICATION: IMPLEMENTED** — full report in the session summary under
"Final independent verification". Awaiting owner acceptance.
