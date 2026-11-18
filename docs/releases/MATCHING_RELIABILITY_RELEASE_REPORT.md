# Matching Reliability — Release Integration Report

Mandate: **MM-REL-EXEC-001** (controlled release integration).
Target branch: `release/account-deletion` @ `e8a7859`, worktree `C:\Users\oboch\minglemate-release`.
Source: `feat/matching-allocator` @ `c968614`, worktree `C:\Users\oboch\minglemate-matching` (read-only, untouched).
Executed on a local Supabase stack (`project_id = "minglemate"`, PostgreSQL 17.6). No hosted system was contacted.

**Release decision: RELEASE CANDIDATE — approved for owner sign-off. Not committed, not pushed, not deployed.**

---

## 1. Baseline (Stage 1)

| Item | Observed |
| --- | --- |
| Source branch / HEAD | `feat/matching-allocator` / `c968614904098fad9073dffb024c7a7a9a494ff7` — matches the mandate |
| Destination branch / HEAD | `release/account-deletion` / `e8a7859a9455fb9535899cadd7f1653457397e50` — matches the mandate |
| Destination pre-existing changes | only untracked `docs/ACCOUNT_DELETION_RELEASE_PREPARATION_REPORT.md` (preserved untouched) |
| Source worktree | not modified at any point; `git status` still shows only the accepted change set |

---

## 2. Classification of the approved change set (Stage 2)

**Transferred (9 files):** `_shared/matchingAllocation.ts`, `_shared/matchingEligibility.ts`, `match-generator/index.ts`, `20261118120000_match_generation_fencing.sql`, `20261119120000_match_publication_pt409.sql`, `test-matching-allocation.mjs`, `verify-matching-publication.mjs`, `verify-matching-eligibility.mjs`, both docs (`MATCHING_ALLOCATION_IMPLEMENTATION.md`, `MATCHING_RELIABILITY_REMEDIATION_SPEC.md`).

**Integrated rather than copied:** `package.json` (adds `test:matching-allocation`, inserts the publication verifier into the `verify` chain).

**Excluded and verified absent in the destination:** `_shared/maxWeightMatching.ts`, `test-max-weight-matching.mjs`, `_hash.ps1`. `package-lock.json` and `supabase/config.toml` unchanged (the latter differed from the source worktree only in line endings). `20261116000000_account_deletion_two_phase.sql` already existed at `e8a7859` and was not duplicated. `20261113120000_users_update_privilege_hardening.sql` untouched (see §7).

**One exception, stated plainly:** `scripts/_nx_oracle.py` is on the experimental list in the source, but test `T1a` of the accepted suite runs it to compare 300 random graphs against NetworkX. It is integrated strictly as a verification fixture (never imported by production code) so the accepted suite remains reproducible.

---

## 3. Destination preparation (Stage 3)

Destination `match-generator/index.ts` was the pre-fencing 215-line version (direct `match_history` upsert, no generation minting, no RPC). `compatibilityEngine.ts` and `verify-weekly-generation-safety.mjs` were already identical on both sides, so neither needed transfer. The destination had no `docs/releases/` directory.

---

## 4. Integration (Stage 4)

Copied with line-ending normalisation to LF (the accepted suite is line-ending sensitive — see §8 finding 1). Result: `git diff --stat` shows 4 tracked files, +341/−52; 11 new files (2 migrations, 3 shared/generator files, 3 scripts, 1 fixture, 3 docs + `docs/releases/`).

### Release behaviours preserved from the destination

Checked by diffing the destination's previous generator against the transferred one:

| Behaviour | Evidence in the transferred generator |
| --- | --- |
| JWT / service-role gate | `apikey` comparison, `bearerRole(...) === 'service_role'`, `admin_users` fallback, `403 Forbidden` |
| `delivered_at` release semantics | release-timestamp computation, `delivered_at` written on every row, RLS visibility comment retained |
| Campus-aware generation | asserted by `verify-weekly-generation-safety.mjs` (unchanged, still passing) |
| Qrashe isolation | generator reads/writes only `users`, `user_responses`, `user_blocks`, `match_history` (test `B8`) |
| Section 2 isolation | `verify-section2-isolation.mjs` — 3 matching files, 9 Section 2 identifiers absent |
| Frontend | no frontend file references the shared modules (`grep src/` → 0); `match_history` schema unchanged (7 columns) |

Internals the destination previously contained that disappeared (old greedy helpers such as `upsert`, `compatibility_score`, `user_a_id/user_b_id`) are exactly the code the accepted allocator replaces; no release-level behaviour depends on them.

---

## 5. Database validation (Stage 5, local stack only)

Applied order respected: fencing, then the `PT409` revision. No reset, drop, truncate or `db push` was used.

| Check | Result |
| --- | --- |
| `begin_match_generation(p_week_id text) → bigint` | present |
| `publish_week_allocation(p_week_id text, p_generation bigint, p_rows jsonb) → jsonb` | present |
| `match_generation_seq`, `match_week_generations`, `published_rows jsonb` | present |
| Both RPCs `SECURITY DEFINER` with `search_path=public` | yes |
| `service_role` EXECUTE both RPCs | yes |
| `authenticated` / `anon` EXECUTE | no / no |
| `service_role` SELECT on fence table | yes |
| `authenticated` SELECT on fence table | no |
| RLS enabled on fence table | yes |
| `PT409` present in the installed publication function | yes |
| legacy `40001` still raised | no |
| PostgREST schema cache reloaded | `NOTIFY pgrst, 'reload schema'` issued, RPCs reachable |

Migration history (local): 14 recorded rows, i.e. every file except the pending `20261113120000`.

---

## 6. Independent testing (Stage 7)

### 6.1 Accepted suites, run from the destination worktree

| Command | Result |
| --- | --- |
| `node scripts/test-matching-allocation.mjs` | **77/77 pass** (T1a–T9b, B1–B11, C1–C3, D1–D9, E1–E18) |
| `node scripts/verify-matching-publication.mjs` | **66/66 pass** (both migrations executed in PGlite + static checks) |
| `npm run verify` | **exit 0** — weights, 17 eligibility checks, weekly-generation safety (15 migrations TRUNCATE-free), publication 66/66, payment ticket 54/54, option bank, mapping, 718 questionnaire assertions, Section 2 isolation, 60/60 contact rules, 17/17 force-connect, 45/45 payment schema, 49 users-delete assertions |

Coverage mapping to the mandate's functional list: Tier 1 global mutual (`T1a`,`T2a–T2d`,`B1`,`B11`) · Tier 2 recovery (`T2e–T2h`,`T4a–T4c`,`T5d`) · weighting order (`T2a–T2h`) · 5 % floor (`T3a–T3d`) · eligibility, gender and campus (`T6a–T6d`,`D1`) · blocked pairs (`T6c`,`B9`) · repeats (`T7a–T7c`,`B10`) · single weekly generation / no cross-week bleed (`E1–E4`) · generation fencing (`E5–E14`) · atomic publication (`E1`,`E4`,`E9`) · summary counters (`B2`,`E8`) · fail-closed error handling (`B3–B7`,`D9`,`E16–E18`) · determinism (`T8a`) · validation rejects (`T8b–T8f`) · performance (`T9a`,`T9b`) · Qrashe/Section 2 isolation (`B8`, verifiers).

### 6.2 Real end-to-end integration (local Edge runtime + PostgREST + PostgreSQL)

Synthetic fixtures were created in a scratch campus with four users (2 female / 2 male, 50 answers each), then removed afterwards.

| Trial | Baseline single run | Winner | Loser | Live state |
| --- | --- | --- | --- | --- |
| 1 | 1.08 s | `200` gen 53, 0.65 s | `409 stale_generation`, 0.71 s | gen 53, 4 rows |
| 2 | 0.63 s | `200` gen 56, 1.67 s | `409 stale_generation`, 1.44 s | gen 56, 4 rows |
| 3 (replacement) | 0.89 s | `200` gen 68, 0.69 s | `409 stale_generation`, 0.72 s | gen 68, 4 rows, 4 mutual Tier 1 links |
| 4 | 0.57 s | `200` gen 62, 0.54 s | `409 stale_generation`, 0.16 s | gen 62, 4 rows |
| 5 | 2.40 s | `200` gen 65, 1.68 s | `409 stale_generation`, 1.41 s | gen 65, 4 rows |

Every trial: exactly one success and one conflict, the live week equals the winner's generation, mutual Tier 1 links intact, `match_history` rows = 4.

Direct `PT409` latency through PostgREST (three samples each): stale `409` in 0.055 / 0.499 / 0.437 s; conflict `409` in 0.485 / 0.035 / 0.459 s; identical replay `200 {"replayed":true,"published":1}` with `published_at` unchanged.

PostgREST access log during the races: zero `match_week_generations` reads, i.e. `PT409` verdicts are answered without the recovery read.

### 6.3 Account deletion regression (part of this branch's release scope)

`node scripts/test-account-deletion-ui.mjs` → **9/9 pass** (`DEL-01` … `DEL-09`).

---

## 7. Unresolved / carried items

1. **`20261113120000_users_update_privilege_hardening`** remains pending and unrecorded. On this database its own guard refuses to run (`authenticated does not hold table UPDATE on public.users`, column-level grants instead), and no matching code path depends on its objects (`guard_users_client_update`, `users_update_own_row`, `discover_candidates`). It is neither edited nor marked applied. Owner decision required: reconcile the grant shape, or record it as intentionally not applied for that environment.
2. **`scripts/_nx_oracle.py`** requires Python + NetworkX (`3.7` verified here) for test `T1a`. It is a verification-only dependency; the production path (`npm run verify` without the oracle, the Edge Function, the migrations) does not need it.
3. Minor cosmetic: test label `B1` still says "in ONE upsert" although publication now goes through the RPC; the assertion itself checks a single publish call. Left as-is to stay byte-identical to the accepted source.

---

## 8. Findings during integration

1. **Line endings are load-bearing for the accepted suite.** With CRLF the suite's generator loader failed (`client injection point missing`, 14 s, first assertion). The loader rewrites the generator text with `\n`-anchored regular expressions, so the transferred sources were normalised to LF; the suite then returned 77/77. Git reports `LF will be replaced by CRLF` on commit, which is the branch's existing convention.
2. **One race trial lost a caller to the local Edge sandbox**, not to the application: the edge log shows `CPU time soft limit reached: isolate …`, the corresponding curl produced an empty response, and the database still held the winner's generation with 4 intact rows. That trial was re-run cleanly (trial 3 replacement) to keep the five-trial evidence honest.
3. **A further trial showed 11.9 s for both callers** (winner and loser equally), consistent with a cold isolate in the local sandbox rather than conflict handling; warm trials measured 0.16–1.44 s for the loser. Recorded here so the figure is not hidden.

---

## 9. Release gate

| Gate | Status |
| --- | --- |
| Approved change set transferred completely | PASS |
| Excluded artifacts absent | PASS |
| Release-only behaviours preserved | PASS |
| Migrations coherent and ordered, security properties verified | PASS |
| Accepted suites (77/77, 66/66, `npm run verify` exit 0) | PASS |
| Real concurrency: one winner + one `409 stale_generation`, allocation intact | PASS (5/5, loser ≤ 1.44 s warm) |
| Account deletion regression (9/9) | PASS |
| No hosted system touched, nothing committed/pushed/deployed | PASS |

**Decision: RELEASE CANDIDATE.** Deployment is the owner's action; use `MATCHING_RELIABILITY_DEPLOYMENT_RUNBOOK.md` and, if needed, `MATCHING_RELIABILITY_ROLLBACK.md`.
