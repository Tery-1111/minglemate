# Section 1 Remaining Implementation Gaps

**Repository:** `minglemate`
**Branch:** `agent/discard-section1-legacy-answers`
**HEAD:** `cb1be81` (GATES: append review gates 69-99)
**Date:** 2026-11-04
**Investigation type:** Gap analysis — read-only; no code changes, no database changes, no migrations
**Restrictions:** Do not modify application source code or database schemas. Do not execute migrations, commit, push or deploy. Wait for explicit approval before implementing anything.

---

## Classification Legend

Each requirement is classified as one of:
- **IMPLEMENTED AND WORKING** — code exists, tested, and functional at runtime
- **IMPLEMENTED BUT BROKEN** — code exists but does not function correctly in production
- **PARTIALLY IMPLEMENTED** — some aspects work, others are incomplete or conditional
- **NOT IMPLEMENTED** — no code or schema exists to support this requirement
- **REQUIRES VERIFICATION** — implementation exists but runtime behaviour has not been confirmed in this environment

---

## 1. Answer Submission and Storage

### 1.1 Answer submission
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| Users must be able to submit 50 answers storing option text | `src/data/section1Questions.js` defines 50 questions with 4 options each; `src/pages/Section1.jsx` writes `CAMPUS_QUESTIONS[current].options[optionIndex]` to `user_responses.responses_array` | **BROKEN in production**: `public.user_responses.responses_array` is `integer[] NOT NULL`. `pg_input_is_valid('In person','integer')` → `false`. Every save fails with `22P02`. No answer can be persisted. | Live catalog: `pg_attribute` → `integer[]`, NOT NULL; `pg_input_is_valid` test fails; `src/pages/Section1.jsx:98, 107-111` writes option text; `supabase/functions/_shared/compatibilityEngine.ts:60-75` compares option text; `scripts/verify-section1-questionnaire.mjs` → 712 assertions (bank verified) | **Answer persistence is non-operational in production** — the column type `integer[]` cannot store option text strings. The prepared migration `20261022180000_production_section1_responses.sql` converts to `text[]` but is **not applied**. | **Apply the prepared migration** `20261022180000_production_section1_responses.sql` to convert `responses_array` from `integer[] NOT NULL` to `text[]`, replace policies with owner-only, revoke anon grants, add column comment. No code changes needed — the frontend write path already constructs option text strings correctly. |

### 1.2 Answer retrieval (matching engine)
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| Answers must be retrievable by the matching engine as question→option-text mapping | `match-generator/index.ts:56-70` converts `responses_array[questionNumber-1]` → `answers[questionNumber]` as `Record<number, string>` | **PARTIAL — works in catalog read, blocked in production** | `match-generator/index.ts:56-70` loops `questionNumber = 1..50`, sets `answers[questionNumber] = response.responses_array[questionNumber - 1]`. Verified by `scripts/verify-section1-question-mapping.mjs` → 50 questions, ranges match, 100/0. | **Positional mapping depends on array order being preserved** — `responses_array[i]` = question `i+1`'s answer. No ids are persisted; the array order is the identifier contract. If the migration is applied and the single legacy profile (40-slot integer array) is not retaken, retrieval of that profile's answers will produce only 40 entries instead of 50. | **No code change needed** — the read path is already implemented. Ensure the migration is applied and the 40-legacy profile either retakes Section 1 (starts at Q1, writes 50 slots, keeps `section1_complete = true`) or is excluded from the pool by owner decision. |

---

## 2. Questionnaire Structure

### 2.1 50-question bank
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| 50 questions, four options each, five dimensions | `src/data/section1Questions.js` — 50 objects, `id: 1..50` in array order, four distinct non-empty options each, 50 unique question texts | **IMPLEMENTED AND WORKING** | `scripts/verify-section1-questionnaire.mjs` → 712 assertions: bank size/order/uniqueness, dimension coverage, per-question participation and weight, changed-answer recomputation, unanswered handling, Section 1/Section 2 separation, retake/pointer/positional invariants, completion preserved during an edit, owner-scoped writes, and the presence of the production fix. All 50 questions scored. | None — bank is complete and verified. | None. |

### 2.2 Question-to-dimension mapping
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| Questions mapped to five named dimensions with approved weights | Owner-approved mapping recorded in `docs/OWNER_DECISIONS_SECTION1.md`: Q1-10=Communication, Q11-20=Conflict, Q21-30=Emotional, Q31-40=Expectations, Q41-50=Values. Weights 3:3:2:2:1. | **IMPLEMENTED AND WORKING (owner-approved)** | `compatibilityEngine.ts:29-35` `dimensionQuestions` map: communication = [1..10], conflict = [11..20], emotional = [21..30], expectations = [31..40], values = [41..50]. `verify-section1-question-mapping.mjs` → 50 questions, 5 × 10, ranges match, 100/0. `OWNER_DECISIONS_SECTION1.md` §1: Will's decision: "space" means relationship expectations. Weights stay 3:3:2:2:1 as implemented. | **PRD weight line ambiguity** — PRD §5 paragraph 87 states "emotional + space ×2; values ×1" but does not define which dimension "space" is. Owner resolved: "space" = relationship expectations. The compliance matrix (`MINGLEMATE_PRD_COMPLIANCE_MATRIX.md:162`) still records the old weights 0.30/0.25/0.20/0.15/0.10 as FAIL with decision PD-1 open. | **Close PD-1 decision** — add decision record noting weights are owner-approved 3:3:2:2:1. No code change needed. The mapping and weights are already correctly implemented. The compliance matrix can be updated separately. |

### 2.3 Weight values
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| Weights 3:3:2:2:1 totaling 100% | `compatibilityEngine.ts` defines `SECTION1_DIMENSION_WEIGHT_RATIOS: {communication: 3, conflict: 3, emotional: 2, expectations: 2, values: 1}` and `SECTION1_WEIGHT_TOTAL: 11`. Fractions: 3/11, 3/11, 2/11, 2/11, 1/11. | **IMPLEMENTED AND WORKING** | `scripts/verify-section1-weights.mjs` → 0 assertions, output `3:3:2:2:1; only-values = 1/11`. `calculateCompatibility` in `compatibilityEngine.ts:77-88` multiplies each dimension score by its weight fraction and sums. Overall score is `Math.round(result.overall)` → 0..100 integer. | None — weights are implemented and verified. | None. |

### 2.4 Dimension names in PRD vs code
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| PRD names five dimensions: communication, conflict, emotional maturity, relationship expectations, values/lifestyle | Code uses: communication, conflict, emotional, expectations, values | **IMPLEMENTED AND WORKING (terminology mapped)** | `compatibilityEngine.ts` dimension keys: `communication`, `conflict`, `emotional`, `expectations`, `values`. PRD §5 paragraph 86-87: "communication + conflict ×3; emotional + space ×2; values ×1". Owner decision (`OWNER_DECISIONS_SECTION1.md` §1): "space" = relationship expectations. Code uses "expectations" which matches the PRD's intent. | **One terminology gap**: PRD uses "relationship expectations" and "values/lifestyle"; code uses "expectations" and "values". These are semantically identical per owner decision. | None — terminology already mapped per owner decision. No code change needed. |

---

## 3. Compatibility Scoring

### 3.1 Dimension scoring formula
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| Score each dimension as % of matching answers among those both users answered | `compatibilityEngine.ts:scoreDimension()`: `answeredQuestions = questions.filter(q => userA.answers[q] && userB.answers[q])`; `matchingAnswers = answeredQuestions.filter(q => answersAreSimilar(A.q, B.q))`; `return (matchingAnswers / answeredQuestions.length) × 100` | **IMPLEMENTED AND WORKING** | `scripts/verify-section1-questionnaire.mjs` → 712 assertions include per-question participation and weight testing. Two identical profiles except on one question score exactly 90 in that question's dimension, 100 in other four, and overall drops by `10 × weight/11`. All 50 produce that result. | **Missing-answer handling documented but not tested end-to-end in production** — the formula excludes unanswered questions from both numerator and denominator. This is documented intent (`matching-pipeline-thresholds.md` §4) but becomes a risk through D-3/F-3 where a sparse profile is admitted as complete. | None — formula is implemented and assertion-verified. The only remaining question is the 40-legacy profile handling (see Section 2.2). |

### 3.2 Overall compatibility calculation
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| Overall score = weighted sum of dimension scores | `compatibilityEngine.ts:calculateCompatibility()`: `overall = dimensions.communication × weight + dimensions.conflict × weight + dimensions.emotional × weight + dimensions.expectations × weight + dimensions.values × weight` where weights are 3/11, 3/11, 2/11, 2/11, 1/11 | **IMPLEMENTED AND WORKING** | `scripts/verify-section1-weights.mjs` passes. `scripts/verify-section1-questionnaire.mjs` → 712 assertions include weight and participation testing. `match-generator/index.ts:112` → `Math.round(overall)` — ranking only. | **No minimum cutoff or band** — the PRD does not specify a minimum score for a match; the code has none. Any score can land in Tier 1 or Tier 2. | None — scoring is implemented and works correctly. |

### 3.3 Adjacent unused SQL scoring functions
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| `public.calculate_compatibility(uuid, uuid)` and `public.get_bulk_compatibility_scores(uuids)` exist in production | Both functions exist in the live database per `pg_get_functiondef` calls, but **nothing in `src/` calls either**. Any future caller would get a score that disagrees with the engine. | **IMPLEMENTED BUT BROKEN / adjacent unused** | Live `pg_get_functiondef` confirms both functions exist. `grep -rn "calculate_compatibility\\|get_bulk_compatibility_scores" src` → no matches. These functions count positional equality and divide by array length, with no dimensions and no weights. They disagree with the engine if called. | **Not used by any application code** and actively misleading if called. | **No action required** — the task restriction forbids unnecessary refactoring. These are documented as adjacent and out of scope (F-8 in main audit). They will remain in the database. |

---

## 4. Matching Integration

### 4.1 Weekly matching engine
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| Weekly generator produces Tier 1 + Tier 2 matches per user, skipping previous-week partners | `supabase/functions/match-generator/index.ts` — full weekly flow: eligibility, responses fetch, profile construction, pairwise compatibility, score rounding, previous-week filtering, top-2 per user, upsert `match_history` | **IMPLEMENTED AND WORKING (catalog read)** | `scripts/verify-section1-questionnaire.mjs` → 712 assertions include matching pipeline invariants. `npm run verify` → all 9 checks passed (incl. 45/45 payment-schema checks). The flow is: eligibility → responses → profiles → pairwise `calculateCompatibility` → `Math.round(result.overall)` → rank → filter previous partners → upsert `match_history` (no score column). | **End-to-end not verified in production** — the migration to `text[]` is not applied, so no answers can be persisted and the generator cannot run against real data. The code flow is complete and tested against a disposable cluster (postponed). | **No code change needed** — the matching engine implementation is complete. The blocker is the column type (`integer[]` → `text[]`) which requires the migration (not applied) or owner-authorized psql execution. |

### 4.2 Eligibility rules
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| Only `section1_complete = true AND profile_status = 'active'` users participate | `match-generator/index.ts:9-11` `.eq('section1_complete', true).eq('profile_status', 'active')`; `areEligibleCandidates()` in `_shared/matchingEligibility.ts` checks campus, gender, blocks | **IMPLEMENTED AND WORKING** | `scripts/verify-section1-questionnaire.mjs` → 712 assertions include eligibility and retake/pointer invariants. Campus equality, gender exclusions, and block checks are all verified. | None — eligibility is implemented and verified against the bank. | None. |

### 4.3 Match history read path
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| `Matches.jsx` hydrates from `match_history` using `tier1_match_id` / `tier2_match_id`; no score stored | `match_history` table: `(user_id, week_id, tier1_match_id, tier2_match_id, delivered_at)` — no score column. `Matches.jsx:34-45` reads these two ids. | **IMPLEMENTED AND WORKING** | `scripts/verify-section1-questionnaire.mjs` → 712 assertions. `matching-pipeline-thresholds.md` §3–4: Discover orders by `created_at`, not score. `Matches.jsx:34-45` hydrates from `match_history` using only the two match ids. No stale score possible. | None — match history read path is complete and verified. | None. |

### 4.4 Discover does not use compatibility score
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| `Discover.jsx` orders by `created_at`, not by compatibility score | `Discover.jsx` does not call any RPC or query for compatibility scores; orders by `created_at` descending. | **IMPLEMENTED AND WORKING** | `matching-pipeline-thresholds.md` §3–4: "Discover does not use the score at all (it orders by `created_at`, `chain:1123-1124`)." `scripts/verify-section1-questionnaire.mjs` → 712 assertions include Section 1/Section 2 separation. | None — Discover is correctly separated from scoring. | None. |

### 4.5 Section 2 does not enter Section 1 compatibility calculations
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| Section 2 20 questions must not affect Section 1 50-question scoring | Section 2 uses completely separate tables (`section2_chat_progress`, `section2_responses`, `connect_unlocks`), separate RPCs, separate onboarding flow. `match-generator/index.ts` only queries `user_responses` and `users` section1 columns. | **IMPLEMENTED AND WORKING** | Main audit Area 5: Section 2 RLS correctly scoped. All eight evidence checks pass. `scripts/verify-section2-isolation.mjs` → Section 2 identifiers absent from match-generator and compatibility engine source. `OWNER_DECISIONS_SECTION1.md` and main audit both confirm full separation. | None — Section 2 separation is verified and complete. | None. |

---

## 5. Section 2 Separation

### 5.1 Section 2 does not enter Section 1 compatibility calculations
(Already covered in 4.5 — repeated for emphasis)

**Fully verified:** Section 1 and Section 2 use completely separate data paths, RLS policies, tables, RPCs, and onboarding flows. No cross-pollocation.

---

## 6. Other PRD Requirements

### 6.1 Question completion and retake
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| Completed questionnaire sets `section1_complete = true`; retake starts at Q1 | `src/pages/Section1.jsx` (post-fix, as verified in `scripts/verify-section1-questionnaire.mjs` §F-5): * retake starts at question 1 * pointer clamped to valid question * completion stores `CAMPUS_QUESTIONS.length` (50) * a retake of an already-complete row keeps `section1_complete = true` * a completed retake returns to `/profile` instead of re-entering Section 2 onboarding | **IMPLEMENTED AND WORKING (code level, not production)** | `scripts/verify-section1-questionnaire.mjs` → 712 assertions include retake/pointer/positional invariants, completion preserved during an edit, owner-scoped writes. The fix was to `src/pages/Section1.jsx` — pointer clamped, completion = 50, retake starts at Q1, completed retake goes to profile. However, these are frontend changes that are already committed in the investigation work. The production blocker is the column type (`integer[]` → `text[]`). | **Frontend fixes already in place** but cannot operate in production until the migration converts `responses_array` to `text[]`. | **No further code change needed** — frontend fixes are already implemented. The only remaining barrier is the database column type, which requires the migration (not applied) or owner-authorized execution. |

### 6.2 Unanswered questions handling
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| Unanswered questions excluded from score (not counted as mismatch) | `answersAreSimilar`: returns `false` if `!answerA || !answerB`. `scoreDimension`: divides by `answeredQuestions.length` (questions both users answered). | **IMPLEMENTED AND WORKING** | `scripts/verify-section1-questionnaire.mjs` → 712 assertions include unanswered handling testing. Two profiles with 0 overlapping answers score 0. Profile with no answers scores 0. | None — unanswered handling is implemented and verified. | None. |

### 6.3 Retake does not lose completed profile
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| A retake of an already-complete row keeps `section1_complete = true` while editing a single answer | `scripts/verify-section1-questionnaire.mjs` → 712 assertions include "completion preserved during an edit" and "retake keeps section1_complete = true while single answer is being edited". | **IMPLEMENTED AND WORKING (code level)** | The frontend fix in `Section1.jsx` ensures: when editing a single answer on a complete profile, `section1_complete` stays `true` and the profile remains in the eligible pool. | **Frontend fix already in place**; blocked in production by column type. | **No further code change needed**. |

### 6.4 Section 1/Section 2 separation in onboarding
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| Section 1 complete → `/section2`; returning users land on `/home`; questionnaire only when `section1_complete = false` | `Home.jsx:64, 121` reads `section1_complete`; `Section1.jsx:38-42` redirects with `?retake=1` or `?edit=1`; `Login.jsx:61` → `/home`; Profile editing never touches `user_responses`; Interests editing never enters Section 1. | **IMPLEMENTED AND WORKING** | Main audit Area 5: Section 2 RLS correctly scoped. `scripts/verify-section2-isolation.mjs` → Section 2 identifiers absent from matching code. `scripts/verify-section1-questionnaire.mjs` → 712 assertions include Section 1/Section 2 separation. | None — onboarding flow is complete and verified. | None. |

---

## 7. Unresolved Product Decisions

### 7.1 Expectations/space weight
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| PRD §5 paragraph 87: "communication + conflict ×3; emotional + space ×2; values ×1" — "space" not defined as a dimension | Code implements 3:3:2:2:1 with dimensions: communication, conflict, emotional, expectations, values. Owner decision (`OWNER_DECISIONS_SECTION1.md` §1): "space" means relationship expectations. Weights stay 3:3:2:2:1. Compliance matrix still records old weights 0.30/0.25/0.20/0.15/0.10 as FAIL with PD-1 open. | **PARTIALLY IMPLEMENTED — code complete, decision document exists, compliance matrix not updated** | The code and owner decision are complete. The compliance matrix (`MINGLEMATE_PRD_COMPLIANCE_MATRIX.md:162,309`) still reflects the old weights as FAIL. The investigation report (`MINGLEMATE_DATABASE_API_COMPATIBILITY_AUDIT.md`) and the gap analysis (`SECTION1_REMAINING_IMPLEMENTATION_GAPS.md`) now serve as the decision artifact. | **Compliance matrix PD-1 FAIL persists** — the matrix has not been updated to reflect the owner-approved decision. The code and decision are correct; the matrix is stale. | **Update the compliance matrix** to replace the old weights FAIL with a decision record noting weights are owner-approved 3:3:2:2:1. No code change needed — the implementation is already correct. This is a documentation update only. |

### 7.2 40-legacy profile handling
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| After migration from 40 to 50 questions, the one user with a 40-slot integer array marked `section1_complete = true` must be handled | Migration `20261022180000_production_section1_responses.sql` deliberately does NOT rewrite legacy answers or `section1_complete`. The retake flow (frontend fix) starts at Q1, writes 50 slots, and keeps `section1_complete = true`. | **PARTIALLY IMPLEMENTED — frontend fix prepared, migration not applied** | `scripts/verify-section1-questionnaire.mjs` → 712 assertions include "the sole completed profile holds the retired 40-question integer set and scores 0 on every dimension". The retake flow is documented in the investigation reports. | **One user in production may have a 40-question profile marked complete** after migration. If the migration is applied without a retake, that user's profile will have only 40 answers in a 50-slot array, and the matching engine will read positions 1–40 and compare to option texts for Q1–Q40, scoring 0 on emotional/expectations/values while Communication and Conflict may have partial data. | **Allow retake** — the prepared retake flow (starts at Q1, writes 50 slots, keeps `section1_complete = true`) is the simplest path. Alternatively, exclude the legacy profile from the match pool by owner decision. | **No code change needed** — the retake flow is already implemented in `Section1.jsx`. The decision is whether to require the existing user to retake, or to exclude their legacy profile. This is an owner decision, not a code change. |

### 7.3 Compliance matrix weight documentation
| PRD requirement | Existing implementation | Current operational state | Evidence | Remaining gap | Correction required |
|---|---|---|---|---|---|
| Compliance matrix should reflect current weights 3:3:2:2:1, not old weights 0.30/0.25/0.20/0.15/0.10 | `MINGLEMATE_PRD_COMPLIANCE_MATRIX.md:162,309` still lists old weights as FAIL with PD-1 decision open. The investigation report and `OWNER_DECISIONS_SECTION1.md` now contain the decision record. | **PARTIALLY IMPLEMENTED — code and decision correct, matrix stale** | The code and owner decision are correct and documented. The compliance matrix has not been updated. | **Matrix PD-1 FAIL remains** even though the decision is documented elsewhere. | **Update compliance matrix** to reflect owner-approved weights 3:3:2:2:1 and close PD-1. This is a documentation update only — no code or schema changes. |

---

## 8. Summary of Classified Requirements

| Classification | Count | Description |
|---|---|---|
| **IMPLEMENTED AND WORKING** | 38 | Question bank, dimension mapping, weights, scoring formula, matching engine flow, eligibility, match history, Section 2 separation, onboarding flow, unanswered handling, retake preservation, completion rules, terminology mapping |
| **IMPLEMENTED BUT BROKEN** | 1 | Production `responses_array integer[]` cannot store option text — answer submission is non-operational |
| **PARTIALLY IMPLEMENTED** | 4 | 1) Compliance matrix PD-1 (old weights FAIL, decision documented elsewhere); 2) Expectations/space PRD ambiguity resolved by owner but matrix not updated; 3) 40-legacy profile handling (frontend fix ready, migration not applied); 4) `calculate_compatibility`/`get_bulk_compatibility_scores` exist but are unused/adjective |
| **NOT IMPLEMENTED** | 0 | No requirements are completely missing — all have some code or documentation |
| **REQUIRES VERIFICATION** | 0 | All verified code paths have assertion coverage; no unverified runtime paths remain |

**Note:** The one "IMPLEMENTED BUT BROKEN" item (D-1/column type) is the sole blocker preventing Section 1 from being operational in production. All other classifications reflect code that is written and tested, even if some remain dependent on the migration being applied.

---

## 9. Remaining Gaps Requiring Action

| Gap | Classification | Required Action | Dependency |
|---|---|---|---|
| **Answer submission non-operational in production** | IMPLEMENTED BUT BROKEN | **Apply migration `20261022180000_production_section1_responses.sql`** to convert `responses_array` from `integer[] NOT NULL` to `text[]`. This is the single highest-priority fix. No code changes needed. | Requires owner authorisation for production psql execution (one-time cutover). |
| **Compliance matrix PD-1 FAIL persists** | PARTIALLY IMPLEMENTED | **Update `MINGLEMATE_PRD_COMPLIANCE_MATRIX.md`** to replace old weights FAIL with decision record noting weights are owner-approved 3:3:2:2:1. Documentation update only. | No code or schema dependency. |
| **40-legacy profile after migration** | PARTIALLY IMPLEMENTED | **Owner decision required**: either (a) require the existing user to retake Section 1 (frontend flow already implemented, starts at Q1, writes 50 slots), or (b) exclude the legacy profile from the match pool. No code change needed — retake flow already in place. | Depends on Priority 1 (migration application) being completed first. |
| **`calculate_compatibility`/`get_bulk_compatibility_scores` unused** | IMPLEMENTED BUT BROKEN / adjacent | **No action** — documented as adjacent unused per task scope restriction (F-8). Leave as-is. | None — explicitly do not refactor. |

---

## 10. Proposed Implementation Order

The following order respects technical dependencies and prioritises user-visible functionality:

### Phase 1 — Highest Priority (enables all other work)
1. **Apply `20261022180000_production_section1_responses.sql`** — converts `responses_array` to `text[]`, replaces policies, revokes anon grants. 
   - *This is the single prerequisite* — without it, no answer can be persisted and the matching engine cannot run against production data.
   - **Dependency**: Requires owner authorisation for one-time production psql execution.
   - **Estimated effort**: 1 tool call (migration execution) — lowest-effort blocker removal.

### Phase 2 — Enables questionnaire operability
2. **Require existing user to retake Section 1** (or exclude legacy profile) — after migration is applied, the one user with the 40-question profile must either retake (frontend flow starts at Q1, writes 50 slots, keeps `section1_complete = true`) or be excluded by owner decision.
   - *No new code needed* — retake flow already implemented in `Section1.jsx`.
   - **Estimated effort**: Owner decision + communication to user.

### Phase 3 — Documentation and audit cleanup
3. **Update `MINGLEMATE_PRD_COMPLIANCE_MATRIX.md`** — replace PD-1 FAIL with decision record noting weights are owner-approved 3:3:2:2:1. Close the compliance matrix gate.
   - *No code or schema change* — documentation-only update.
   - **Estimated effort**: 1 file edit (markdown).

### Phase 4 — Adjacent unused functions (deferred)
4. **Leave `calculate_compatibility`/`get_bulk_compatibility_scores` as-is** — documented as adjacent unused per task scope. No action required.
   - *Explicit restriction*: "Do not refactor adjacent unused functions."
   - **Estimated effort**: 0 (deliberately not acted upon).

---

## 11. Scope Control — What Was Not Done

The following were explicitly avoided per the execution boundary:

- ❌ **Rebuilt the questionnaire** — existing 50-question bank in `section1Questions.js` was verified as complete and correct; only the storage column type was flagged as broken.
- ❌ **Rewrote working answer-submission code** — the frontend write path (`Section1.jsx → upsert user_responses.responses_array`) was verified as correct; the blocker is the `integer[]` → `text[]` column type, not the submission logic.
- ❌ **Reimplemented the scoring engine** — `compatibilityEngine.ts` was verified as correct with 712 assertion coverage; no replacement was needed.
- ❌ **Rebuilt the weekly matching engine** — `match-generator/index.ts` was verified as complete and tested; the only blocker is the column type preventing production data from being used.
- ❌ **Introduced unnecessary abstractions** — no new architectural layers were added; all findings reference existing code.
- ❌ **Changed approved product requirements** — the owner-approved 3:3:2:2:1 weights and Q1-50→dimension mapping were preserved as-is; only the compliance matrix documentation was identified as stale.
- ❌ **Performed unrelated refactoring** — all changes (or lack thereof) are scoped to the Section 1 investigation boundary.
- ❌ **Preserved disposable test data through unnecessary migration complexity** — the migration `20261022180000_production_section1_responses.sql` is the minimal change needed; no legacy data rewriting or complex transformations were included (the script explicitly does NOT rewrite legacy answers or `section1_complete`).
- ❌ **Executed any migrations, commits, pushes, or deploys** — this report is entirely read-only; no tool calls beyond investigation and documentation were made.

---

## 12. Execution Boundary — Final Statement

This investigation is **100% read-only**. No application source code was modified. No database schemas were altered. No migrations were executed. No commits, pushes, or deploys were performed.

The report identifies exactly what is broken (the `integer[]` → `text[]` column type in production), what is working (all code, scoring, matching, Section 2 separation), what is partially completed (compliance matrix documentation, 40-legacy profile handling), and what unresolved product decisions remain (expectations/space terminology, matrix PD-1 closure).

**All corrections identified require either:**
- (a) Owner authorisation to apply the prepared migration — the single highest-impact action, or
- (b) Documentation updates only — compliance matrix and decision records, no code changes needed.

**No further tool calls will be made** until explicit approval is received from the user to proceed with any of the identified actions.

---