# Weekly Matching Allocator — Implementation Record

Scope: weekly Tier 1 / Tier 2 allocation in `supabase/functions/match-generator`.
No production access, no deployment, no commit, no schema change, no new dependency.

Worktree: `C:\Users\oboch\minglemate-matching`, branch `feat/matching-allocator`,
HEAD `c968614`. Only this worktree was touched.

## Files

| File | Change |
| --- | --- |
| `supabase/functions/_shared/matchingAllocation.ts` | rewritten — Tier 1 + Tier 2 recovery, D6 encoding, validation |
| `supabase/functions/_shared/matchingEligibility.ts` | **one** change — male/female gender rule (D5) |
| `supabase/functions/match-generator/index.ts` | floor, eligible population, repeat keys, run summary, pre-publish gate |
| `scripts/test-matching-allocation.mjs` | rewritten — 50 tests (oracle, objectives, floor, shape, eligibility, determinism, failures, performance, mutation) |
| `scripts/verify-matching-eligibility.mjs` | extended for the D5 gender rule (17 checks) |
| `scripts/test-max-weight-matching.mjs` | header records the D7 verdict (evidence artifact, not in the test script) |
| `docs/MATCHING_ALLOCATION_IMPLEMENTATION.md` | this file |
| `package.json` | `test:matching-allocation` script (unchanged from the starting state) |

## Decisions as implemented

### D1 — Tier 1 is one global mutual matching

Priority is strictly lexicographic: (1) maximum number of pairs, (2) maximum
total score, (3) fewest repeat pairings, (4) deterministic tie-break.

The solver sends **maximum flow** on the eligibility network (capacity 1 per
vertex), which *is* the maximum-cardinality matching, and every augmenting round
takes a shortest path, so among maximum-cardinality matchings the total weight is
maximal. Cardinality is therefore guaranteed by the algorithm, not by a bonus
term.

### D2 — Tier 2 is a recovery pass, not a second full matching

Let **U** = users with no Tier 1 partner. Tier 2 runs a second mutual matching on
this edge set only:

- every eligible pair `(a, b)` with `score >= 5`,
- where at least one of `a`, `b` is in **U**,
- and `(a, b)` is not a Tier 1 pair.

Consequences: two users who both have a Tier 1 partner never form a Tier 2 pair;
each user has at most one Tier 2 partner; a Tier 1-matched user receives a Tier 2
partner only when that partner is in U; Tier 1 is fixed before Tier 2 starts.

**Why recovery is the right shape:** after a *maximum* Tier 1 matching, the users
in U have no eligible edges left among themselves — if any two of them did, Tier 1
was not maximum. So a second full matching could only re-pair users who already
have a Tier 1 partner, which is exactly what D2 forbids. Tier 2 must therefore
pair U users against already-matched users, which is why it is a recovery pass
over a restricted edge set.

Same priority order 1–4 as Tier 1, solved independently.

### D3 — 5% floor

A pair is an edge only when `Math.round(overall) >= 5`, using the same rounded
integer the generator already computes. Sub-floor pairs are dropped while the
edge list is built and are filtered again inside the allocator, and `validateAllocation`
rejects any published pair scoring below 5 (`below_floor`).

5% is a coverage fallback, not real compatibility: it exists so that sparsely
answered questionnaires still produce a pairing rather than nothing. It is not a
claim that a 5% pair is a good match.

### D4 — repeats are a soft preference, built from both directions

A pair is a repeat if **either** user's previous-week `match_history` row lists
the other as `tier1_match_id` **or** `tier2_match_id`. The generator adds
`pairKey(row.user_id, partner_id)` for both columns, and `pairKey` is canonical
(`a < b`), so one row marks the pair for both users. The allocator also accepts
the legacy `a:b` form and canonicalises it.

Repeats never exclude an edge; they only lower its weight by one unit (D6).

### D5 — eligibility

Campus equality and block exclusion are unchanged (strict `campus_id` equality,
so `null`/`null` may pair and `null`/value may not; blank-campus accounts are not
filtered out of the run). One approved change:
`areEligibleCandidates` now requires exactly one `male` and one `female`, in
either order. `null`, empty, unknown, third-value and same-gender pairs are
rejected. The bipartite property therefore comes from this filter and from the
allocator's `non_bipartite` fail-closed guard — **not** from the database.

**Database constraint status (unverified).** Earlier revisions of this document
claimed that production has a `users_gender_check` constraint allowing only
`male`/`female`. No such constraint exists in this repository's migrations
(no `CHECK`, enum or trigger on `gender` anywhere under `supabase/`). Whether one
exists in the live database is **unverified**. To check:

```sql
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.users'::regclass and contype = 'c';
```

No gender constraint is added by this work: the approved remediation scope is
documentation only (see `docs/MATCHING_RELIABILITY_REMEDIATION_SPEC.md` R2).

`scripts/verify-matching-eligibility.mjs` covers all of these cases (17 checks).

### D6 — exact weight encoding

Let `M` = number of users in the allocation run. Integer edge weight:

```
w = score * (M + 1) + (isRepeat ? 0 : 1)
```

The old `BIG / SCORE_SCALE / REPEAT_PENALTY` encoding
(`1e11 + score*100 - (repeat ? 2e4 : 0)`) is removed.

**Proof that this encodes objectives 2 then 3 (cardinality is handled by the
solver, see D1):**

1. A matching has at most `M/2` pairs, so its non-repeat bonus totals at most
   `M/2`, which is strictly less than `M + 1` — the value of one score point.
   Hence any one-point score gain outweighs *every* bonus in the matching:
   total score dominates repeat avoidance, as required by objective 2 before 3.
2. Between two matchings of equal score total, the weight difference is exactly
   the difference in the number of non-repeat pairs, so maximising weight
   minimises repeats — and because each bonus is 1, the minimisation is exact
   (no rounding or slack).
3. Because `w` is an integer for integer inputs and the total is bounded by
   `M/2 * (100*(M+1) + 1)`, the guard below keeps every sum inside the exact
   integer range.

**Guard:** `assertWeightBudget(M)` throws `weight_overflow` and nothing is
published when `M/2 * (100*(M+1) + 1) >= 2^53` (that is `M >= ~13.42 million`).
It runs before any allocation work.

### D7 — algorithm verification: blossom port REJECTED, bipartite solver kept

`supabase/functions/_shared/maxWeightMatching.ts` is a hand port of NetworkX's
Edmonds/Galil primal-dual blossom. It was checked against the independent oracle
`scripts/_nx_oracle.py` (NetworkX 3.7, BSD-3-Clause) and against exhaustive
search, for both `maxcardinality=true` and `false`.

**It does not pass.** Evidence:

| Case | Expected | Port produced |
| --- | --- | --- |
| 6 vertices, `maxcardinality=true`, edges `(0,2,11) (0,4,3) (1,5,8) (2,4,12) (2,5,1) (3,4,0)` | a matching | `TypeError: undefined is not iterable (cannot read property Symbol(Symbol.iterator))` |
| C3 sweep case 7 (`maxcardinality=false`), odd-cycle graph | 3 pairs, weight 33 | 3 pairs, weight 20 |
| C1 NetworkX docstring example | weight 16 | assertion failure (`result contains a non-edge`) |
| C2 / C5 / C6 / C7 sweeps | oracle values | repeated `undefined is not iterable` |

Per D7 this branch was taken: no new blossom was written, and the existing
**bipartite** solver is used for both tiers with the corrected D6 encoding and
its fail-closed `non_bipartite` guard. `scripts/test-max-weight-matching.mjs` is
kept as the failing artifact (with the verdict in its header) and is deliberately
not part of `npm run test:matching-allocation`.

Provenance and licence: the port's header states the NetworkX provenance
(`networkx/algorithms/matching.py`, BSD-3-Clause) and the Edmonds/Galil
references; that attribution is preserved. No package was added to the project:
the port is local source, and the oracle runs as a separate Python process.

The *used* solver is verified instead: `T1a` compares the allocator's Tier 1
against NetworkX on 296 random bipartite graphs (cardinality and total weight,
D6 weights), with **0 mismatches**.

### D8 — determinism

Users are sorted by id; edges are canonicalised to `a < b`, de-duplicated, and
explored in `weight desc, a asc, b asc` order; output pairs are sorted by
canonical pair key. Ties are therefore resolved by the lowest canonical pair key
the solver reaches first, which is a pure function of the logical input.

Verified with 50 shuffles of a 40-user population (identical Tier 1 and Tier 2),
plus 50-shuffle tie tests for both tiers (`T2d`, `T2h`, `T8a`).

### D9 — fail closed

| Failure | Result |
| --- | --- |
| `users` query error | `400`, nothing written (unchanged) |
| `user_responses` query error | `400`, nothing written |
| `user_blocks` query error | `500 restriction_query_failed`, nothing allocated |
| previous-week `match_history` error | `500 repeat_query_failed`, nothing allocated |
| allocation error (`non_bipartite`, `weight_overflow`, …) | `500` with the error code, nothing written |
| validation failure | `500 validation_failed`, nothing written |

`validateAllocation` runs inside `allocateTiers` before the function returns, and
the generator then re-checks every published pair against the database rules:
mutual, at most one partner per user per tier, Tier 1 partner differs from Tier 2
partner, no blocked pair, every id inside the eligible population, and every
Tier 2 pair touching at least one user in U. It also proves Tier 1 was maximum
(no edge remains between two unmatched users).

### D10 — publication: fenced, atomic week replacement

Publication is one call to `public.publish_week_allocation(week_id, generation,
rows)` (migration `20261118120000_match_generation_fencing.sql`), plus one
`begin_match_generation(week_id)` call at the start of the run. Inside a single
transaction the publish function locks the week's fencing row, **rejects a stale
generation before writing anything**, replays an identical payload without
writing, rejects a changed payload under an already published generation,
deletes this week's rows only, inserts the new rows, and records the published
generation together with the exact JSONB payload it published.

Properties:

1. **Same-week re-run replaces the week.** Users who lose their partner lose
their row, so no orphan row and no broken mutual link can survive a re-run.
2. **Historical weeks are untouched** — the delete predicate is exactly
   `week_id = p_week_id` and is hard-coded in the function, never passed in.
3. **Failure preserves the previous allocation.** Any error inside the replace
   rolls the delete back; `latest_published_generation` stays where it was.
4. **A stale run cannot overwrite a newer one.** The generation is minted at run
   start, so ordering follows authorization; a rejected run writes nothing and
   the generator answers `409 stale_generation`.
5. **One generation publishes exactly one allocation.** `published_rows` stores
   the accepted payload. Repeating the same generation with the identical
   payload is a no-op replay (no write, `replayed: true`, the stored row count is
   returned); repeating it with a **different** payload raises
   `generation_conflict` (`40001`) before any write, and the generator answers
   `409 generation_conflict`. Publishers for a week are serialised by the fence
   row lock, so two conflicting replicas of one generation can never both
   succeed — the loser is the one that acquires the lock second.
6. **No audit table** (approved product decision): a successful re-run replaces
   the visible week immediately, and the replaced allocation is not recoverable.
7. **No row for a user with no partner** (unchanged), and `match_history` columns,
   indexes and RLS are unchanged, so the frontend contract is unchanged.
8. **Deploy order matters:** the migration must be applied before the new
   generator is deployed. If the functions are missing, publication fails closed
   (`500 publish_failed`) and nothing is written.
9. **A fence verdict is an intentional conflict, not a database failure.**
   `publish_week_allocation` raises both verdicts with SQLSTATE `PT409`
   (migration `20261119120000_match_publication_pt409.sql`, MM-D2), which
   PostgREST passes straight through as HTTP 409 with the message intact, so the
   generator answers `409 stale_generation` / `409 generation_conflict`
   immediately. The generator classifies **only** `code === 'PT409'` with one of
   those two exact messages; a bare `40001`, any other SQLSTATE, or a `PT409`
   with a different message stays `500 publish_failed`, so a genuine failure is
   never disguised as an expected conflict.
10. **A verdict lost in transit is recovered, but not by re-reading a verdict the
    database already sent.** If the response never arrives at all (no code, e.g.
    a gateway timeout), the generator re-reads the week's fence row (a
    service-role-only `select` granted by the migration) and classifies exactly
    as the SQL does: older generation → `409 stale_generation`, published
    generation with a different payload → `409 generation_conflict`, published
    generation with the identical payload → the idempotent replay it is
    (reported as success, nothing rewritten). A recognized `PT409` never
    performs that read (asserted in the test suite and in the PostgREST access
    log: zero fence-table reads during the concurrency trials).
11. **Measured conflict latency.** PostgREST answers a rejected publication in
    `0.018–0.35s` (was a 61s gateway timeout under `40001`), and a real
    generator invocation that loses a race returns `409 stale_generation` in
    `0.7–3.5s` end to end, in line with a winning run's duration in the same
    trial.

### D11 — run summary

The JSON response carries counts only, never ids:

```json
{
  "success": true,
  "generation": 0,
  "published": 0,
  "matchesProcessed": 0,
  "usersDelivered": 0,
  "eligibleUsers": 0,
  "tier1Pairs": 0,
  "unmatchedUsers": 0,
  "tier2Pairs": 0,
  "usersWithNoPartner": 0,
  "excludedBlankCampus": 0,
  "excludedInvalidGender": 0,
  "deliveredAt": "…"
}
```

`eligibleUsers` is the number of users in the allocation run (valid `male`/`female`
gender and a questionnaire present). `excludedInvalidGender` counts the accounts
removed **before** allocation.

`excludedBlankCampus` is **information only**: blank-campus accounts are *not*
removed from the run, because campus eligibility is the original strict equality
(`null == null` may pair, `null != value`, `'' != null`). A user with both a blank
campus and an invalid gender is counted in both fields.

## Test evidence

`npm run test:matching-allocation` → **77/77 pass**, exit 0.

| Group | Tests |
| --- | --- |
| Oracle (D7) | T1a allocator vs NetworkX on 296 graphs (0 mismatches); T1b blossom port off the active path |
| Objective order | T2a–T2d (Tier 1), T2e–T2h (Tier 2): score before repeats, repeat minimisation, one extra pair beats any score gain, full tie deterministic |
| Floor | T3a score 4 ignored, T3b score 5 accepted, T3c sub-floor never blocks a valid alternative, T3d validation rejects a below-floor pair |
| Tier 2 shape | T4a–T4c |
| Populations | T5a 59m/99f, T5b 99f/59m, T5c equal, T5d odd |
| Eligibility | T6a–T6d |
| Repeats | T7a both directions, T7b legacy keys, T7c never costs a pair |
| Determinism / validation / failures | T8a 50 shuffles; T8b–T8f validation and guards |
| Performance | T9a, T9b |
| Mutation | C1–C3 (three guards reversed, each caught, file restored, SHA unchanged) |

Generator-level (fake Supabase client, simulated fence): B1 exactly one publish
call with mutual tier1 + distinct tier2, B2 run summary + no ids + exclusions,
B3 blocks failure, B4 history failure, B5 users failure, B6 responses failure,
B7 publish failure with exactly one attempt, B8 Qrashe isolation, B9 blocked pair
end-to-end, B10 repeat from one side, B11 equal populations. R1 malformed-data
cases: D1–D8. Fenced publication: E1–E7 (rerun replacement, historical weeks,
empty week, failure preservation), E8 summary + published count, E9 payload
binding (identical replay is a no-op, a changed payload under the same
generation raises `generation_conflict`, a newer generation still replaces the
week), E10 the handler mapping that conflict to `409`, E11–E13 a verdict lost to
an unresponsive transport (stale → 409, conflict → 409, already-published →
success), and E14–E18 the MM-D2 contract (PT409 `stale_generation` → 409 with no
fence re-read, PT409 `generation_conflict` → 409 with no fence re-read, `22P02`
→ 500, a bare `40001` → 500, PT409 with an unknown message → 500). Older
numbering (monotonicity, stale rejection, unknown generation, cross-week
independence, 409 mapping) is covered by E5/E6/E8 and by the SQL script below.
SQL-level: `scripts/verify-matching-publication.mjs` executes the real migration
pair (fencing + `20261119120000_match_publication_pt409.sql`) against an
in-memory Postgres (PGlite) and asserts the fence, the payload binding
(identical replay writes nothing, changed payload rejected), the `PT409` verdicts
with exact messages, the preserved unrelated SQLSTATEs (`P0002`, `22023`,
`22P02`), the rollback and the grants — **66/66 checks**.

End-to-end against the local stack (migrations applied, PostgREST schema cache
reloaded, `match-generator` served through Kong): a generation publishes 4 rows
for the current week; a second run replaces them (3 rows, the paused user's row
gone, one tier2 recovery pair); PostgREST answers a rejected publication with
HTTP 409 in `0.018–0.35s`; five real concurrent-invocation trials each return
exactly one `200` and one `409 stale_generation` (loser latency `0.7–3.5s`),
with the winner's generation live and 4 rows intact after every trial and zero
fence-table reads in the PostgREST access log.

### Non-vacuity (mutation test)

| Mutation | Guarded result | Reversed result |
| --- | --- | --- |
| M1 `if (blocksError)` → fail-open | 500, 0 writes | detected (status changes) |
| M2 `if (lastWeekError)` → fail-open | 500, 0 writes | detected |
| M3 `if (historyError)` → fail-open | 500, 1 attempt | detected |

Each test restores `index.ts` in a `finally` block and asserts the SHA-256 is
byte-identical afterwards.

### Regression

- `node scripts/verify-matching-eligibility.mjs` → 17 checks, exit 0.
- `npm run verify` → all scripts pass until the final
  `verify-users-delete-family-revoked.mjs`, which exits 1 in this worktree with
  `ERR_MODULE_NOT_FOUND: @electric-sql/pglite`. That worktree has no
  `node_modules` (the package is declared in `package.json`, not installed), the
  script is unmodified, and installing it is out of scope for this task. This is
  an environment gap, not a regression from the allocator change.

## Remaining limitations

1. **Blank campus pairs only with the same blank value.** Campus eligibility is
   unchanged strict equality, so two `null`-campus users may still pair and a
   `null` campus never pairs with a real or whitespace campus. Blank-campus
   accounts stay in the run; `excludedBlankCampus` is reported for information
   only and never removes anyone. Consequence: a user whose campus is `null` has
   no partner unless another `null`-campus user of the opposite gender exists.
2. **Non-binary / unknown gender cannot match.** D5 restricts eligibility to
   exactly `male`/`female`. A third value fails the run loudly if it somehow
   reaches the allocator (`non_bipartite`) and is excluded earlier otherwise.
3. **Publication is deliberately destructive within the current week** (D10): a
   successful same-week re-run replaces what users already saw, the replaced
   allocation is not recoverable (no audit table, by product decision), and
   `delivered_at` is not used as a release gate anywhere in this repository.
4. **General (non-bipartite) optimum is not available.** D7 forbids writing a
   blossom implementation, and the existing port is wrong. If the gender domain
   ever widens, a correct blossom becomes a real requirement.
5. **Performance envelope.** 400 users / 40 000 edges: ~0.7 s. 2 000 users /
   50 000 edges across 20 campuses: ~0.3 s. A *single* dense 2 000-user campus
   (≈1 000 000 edges) was not measured and would be much slower — the solver is
   O(pairs × V × E) in the worst case.
6. **No real-database integration test** for the weekly job; the fake client
   covers control flow, not PostgREST semantics.
7. **Tie-break wording.** "Lowest sorted pair key" is implemented as a
   deterministic exploration order, which is permutation-invariant and verified
   by 50 shuffles; it is not a lexicographic-optimum guarantee over all optimal
   matchings.
