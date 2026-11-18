# Matching Reliability — Release Manifest

Release branch: `release/account-deletion`
Integration source: `feat/matching-allocator` @ `c968614904098fad9073dffb024c7a7a9a494ff7`
Integration base (destination HEAD before this work): `e8a7859a9455fb9535899cadd7f1653457397e50`
Status of this package: **integrated and verified locally; not committed, not pushed, not deployed.**

---

## 1. Included features

| Feature | Description |
| --- | --- |
| Tier 1 global mutual allocation | One global matching on the whole eligible population, maximum cardinality first, then maximum compatible weight. |
| Tier 2 recovery allocation | Second pass over users left unpaired by Tier 1, maximising additional pairs with a distinct partner. |
| Cardinality-first objective | One extra pair always beats any compatibility gain; weights encode this exactly (`w = score*(M+1) + (isRepeat ? 0 : 1)`). |
| Repeats as a soft preference | Previous partners are avoided when an alternative exists, never at the cost of a pair. |
| 5 % floor | `MIN_ELIGIBLE_SCORE = 5`, sub-floor pairs are never published. |
| Unchanged scoring weights | Communication ×3, Conflict ×3, Emotional maturity ×2, Expectations ×2, Values/lifestyle ×1 (`calculateCompatibility` untouched). |
| Eligibility | Opposite gender limited to `male`/`female`, strict campus equality (`null == null` may pair, `null != value` may not), blocked pairs excluded. |
| Sample-data resilience (R1) | Malformed, empty or non-string `responses_array` never aborts a run: the participant is excluded and counted. |
| Generation fencing (R4) | Monotonic generation minted before any data read; a stale run cannot publish and writes nothing. |
| Payload binding (D-1) | One generation publishes exactly one allocation: identical replay is a no-op (`replayed: true`), a different payload raises `generation_conflict`. |
| Immediate conflicts (MM-D2) | Both intentional verdicts are raised as `PT409`, so PostgREST answers HTTP 409 in well under a second instead of dropping the connection. |
| Atomic week replacement (R3) | Week-scoped `delete` + `insert` in one transaction inside the RPC; other weeks are unreachable, a failure rolls back completely. |
| Qrashe / Section 2 isolation | `matches` is never written by the generator; Section 2 tables/functions are not referenced. |

Frozen values verified unchanged during integration: weights 3:3:2:2:1, 5 % threshold, Tier 1 global mutual, Tier 2 recovery, strict campus equality, opposite-gender rule, blocked pairs, previous-week soft preference, Section 2 unused, Qrashe separate.

---

## 2. Integrated files

Transferred from `feat/matching-allocator`, all at LF endings:

| File | Status in destination | Role |
| --- | --- | --- |
| `supabase/functions/_shared/matchingAllocation.ts` | new | Tier 1 + Tier 2 allocator, weight encoding, validation, `non_bipartite` fail-closed guard |
| `supabase/functions/_shared/matchingEligibility.ts` | replaced | male/female-only gender rule, `pairKey`, strict campus equality (previous release version compared genders loosely) |
| `supabase/functions/match-generator/index.ts` | replaced | fenced run: begin generation → read → validate → allocate → gate → publish via RPC; `PT409` classification |
| `supabase/migrations/20261118120000_match_generation_fencing.sql` | new | sequence, fence table + `published_rows`, `begin_match_generation`, first `publish_week_allocation` |
| `supabase/migrations/20261119120000_match_publication_pt409.sql` | new | forward-only: same RPC with `PT409` verdicts, ACLs restated |
| `scripts/test-matching-allocation.mjs` | new | 77-test suite (oracle, objective order, floor, tiers, determinism, malformed data, fence, `PT409`, mutation guards) |
| `scripts/verify-matching-publication.mjs` | new | static checks + real `plpgsql` execution of both migrations in PGlite (66 checks) |
| `scripts/verify-matching-eligibility.mjs` | replaced | 17 eligibility checks (was 8) |
| `scripts/_nx_oracle.py` | new | NetworkX reference used by test `T1a` (verification fixture, **not** production code) |
| `docs/MATCHING_ALLOCATION_IMPLEMENTATION.md` | new | implementation record (D1–D11, test evidence) |
| `docs/MATCHING_RELIABILITY_REMEDIATION_SPEC.md` | new | remediation specification referenced by generator comments |
| `package.json` | edited | adds `test:matching-allocation`; inserts `verify-matching-publication.mjs` into the `verify` chain |

No dependency changes: `@electric-sql/pglite` and `postgres` are already devDependencies in this branch, `package-lock.json` is byte-identical, and `supabase/config.toml` is unchanged (its only difference from the source worktree was line endings).

### Included by exception

`scripts/_nx_oracle.py` is listed as experimental in the source worktree, but test `T1a` of the accepted suite executes it to compare the allocator against NetworkX. Without it the accepted suite cannot run, so it is integrated strictly as a verification fixture.

---

## 3. Migration sequence

Apply in this order, after the 13 migrations already in this branch:

1. `20261116000000_account_deletion_two_phase.sql` — **already in this branch** at `e8a7859`; do not re-integrate.
2. `20261118120000_match_generation_fencing.sql` — creates `match_generation_seq`, `match_week_generations` (with `published_rows`), `begin_match_generation(text)`, `publish_week_allocation(text, bigint, jsonb)`.
3. `20261119120000_match_publication_pt409.sql` — replaces the publication RPC so both intentional verdicts raise `PT409`; it depends on the fencing objects and must run after them.

`20261113120000_users_update_privilege_hardening.sql` stays pending and out of scope: its guard fails on a database whose `authenticated` role holds column-level (not table-level) `UPDATE` on `public.users`, and no matching code path depends on its objects (`guard_users_client_update`, `users_update_own_row`, `discover_candidates` body). It is not edited, not marked applied and not executed.

---

## 4. Database requirements

| Requirement | Detail |
| --- | --- |
| `match_generation_seq` | Sequence for generation minting. |
| `match_week_generations` | `week_id` (pk), `latest_generation`, `latest_published_generation`, `published_rows jsonb`, `published_at`, `updated_at`; RLS enabled. |
| `begin_match_generation(text)` | `SECURITY DEFINER`, `search_path = public`, returns `bigint`. |
| `publish_week_allocation(text, bigint, jsonb)` | `SECURITY DEFINER`, `search_path = public`, row lock, fence, payload binding, week-scoped replace. |
| Privileges | `service_role` may execute both functions and `select` the fence table; `anon`/`authenticated`/`public` may do neither. |
| Untouched | `match_history` schema/RLS, `users`, `matches` (Qrashe), all Section 2 objects. |

PostgREST requirement: the API layer must pass a custom `PT409` SQLSTATE through as HTTP 409 with the body intact (verified on the local PostgREST used by the stack). If the API layer were to remap it, the generator would still answer correctly because it classifies on the error `code`/`message` it receives, but the latency guarantee assumes pass-through.

---

## 5. Edge Function requirements

* `supabase/functions/match-generator/index.ts` with the `../_shared/matchingAllocation.ts` and `../_shared/matchingEligibility.ts` imports; both shared files must be deployed with it.
* JWT verification stays **on** (no `[functions.match-generator]` override in `supabase/config.toml`, so the platform default `verify_jwt = true` applies). The handler additionally requires either the service-role key in `apikey`, a `service_role` bearer token, or an `admin_users` member.
* Runtime environment: only the platform-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are read. No new secrets, variables or schedules.
* Contract: begin generation → read users → read responses → validate → allocate → pre-publication eligibility gate → fenced publish → reconciled summary (`success`, `generation`, `published`, `matchesProcessed`, `usersDelivered`, `eligibleUsers`, `tier1Pairs`, `unmatchedUsers`, `tier2Pairs`, `usersWithNoPartner`, `excludedBlankCampus`, `excludedInvalidGender`, `invalidQuestionnaires`, `deliveredAt`).
* Error contract: `PT409` + `stale_generation` → 409, `PT409` + `generation_conflict` → 409, any other `PT409` message → 500, bare `40001` → 500, other database error → 500, identical replay → success.

---

## 6. Known exclusions

| Excluded | Reason |
| --- | --- |
| `supabase/functions/_shared/maxWeightMatching.ts` | Withdrawn blossom port; the allocator is bipartite and the suite asserts neither the allocator nor the generator references it. |
| `scripts/test-max-weight-matching.mjs` | Test of the withdrawn port; known non-defect (`C7` hangs) and never imported. |
| `scripts/_hash.ps1` | Local debugging helper. |
| `package-lock.json` | Unchanged: no dependency was added or upgraded. |
| `supabase/config.toml` | Unchanged: content is identical to the source worktree. |
| `20261116000000_account_deletion_two_phase.sql` | Already present in this branch. |
| `20261113120000_users_update_privilege_hardening.sql` | Pending, unrelated to matching; see §3. |
