# Matching pipeline: score and count thresholds

One register of every constant in the weekly matching path that acts as a score
band, minimum, cutoff, top-N limit or count limit, so a change to the Section 1
weights can be checked against the things they interact with.

Scope: `supabase/functions/_shared/compatibilityEngine.ts` (scoring) and
`supabase/functions/match-generator/index.ts` (run, ranking, delivery).
Line numbers are as of 2026-10-21; if a file moves, re-derive them before
trusting a row.

## 1. The score scale

| Rule | Where | Value |
|---|---|---|
| Dimension score | `compatibilityEngine.ts:85` | `(matchingAnswers / answeredQuestions) * 100` — each dimension is a 0–100 percentage of the questions both users answered |
| Empty dimension floor | `compatibilityEngine.ts:79` | `return 0` when the pair shares no answers in that dimension. A dimension with no evidence contributes **0**, not a neutral 50 or the other dimensions' average |
| Answer comparison | `compatibilityEngine.ts:74` | Exact option text, trimmed and lowercased. No partial credit, no word overlap, no distance |
| Questions per dimension | `compatibilityEngine.ts:52–58` | 10 each, in order: communication 1–10, conflict 11–20, emotional 21–30, expectations 31–40, values 41–50 |
| Weight ratios | `compatibilityEngine.ts:29–35` | `communication: 3, conflict: 3, emotional: 2, expectations: 2, values: 1` (PRD §5 order) |
| Weight total | `compatibilityEngine.ts:37–38` | Derived by summing the five integers; currently 11. Never a literal |
| Weight fractions | `compatibilityEngine.ts:44–50` | `ratio / SECTION1_WEIGHT_TOTAL` — 3/11, 3/11, 2/11, 2/11, 1/11, computed, never rounded in the source |
| Overall score | `compatibilityEngine.ts:97–102` | Weighted sum of the five dimension percentages, therefore also 0–100 |
| Score rounding | `match-generator/index.ts:112` | `Math.round(result.overall)` — rounded to an integer only here, only for in-run ranking and the run summary. No per-pair score is persisted |

The overall score is **0–100**, not 0–1. Any new comparison written against it
must use that scale; a `>= 0.7` "70%" check would never fire.

## 2. What is allowed into scoring

| Rule | Where | Value |
|---|---|---|
| Eligible users | `match-generator/index.ts:42,44` | `section1_complete = true` **and** `profile_status = 'active'` |
| Answers read per user | `match-generator/index.ts:67` | Positions 1–50 of `user_responses.responses_array` |
| Pair eligibility | `_shared/matchingEligibility.ts:16–18` | Different `gender`, identical `campus_id` (two NULLs are equal, NULL vs non-NULL is not), and not in `user_blocks` in either direction |
| Both profiles exist | `match-generator/index.ts:99–101` | A pair with a missing response row is skipped |
| Pair enumeration | `match-generator/index.ts:89–90` | Every unordered pair, O(n²), with **no cap** on the number of candidates |

## 3. Selection and delivery thresholds

| Rule | Where | Value | Touches the overall score? |
|---|---|---|---|
| Highest score first | `match-generator/index.ts:147,148` | `sort((a, b) => b.score - a.score)` | Yes — ordering only |
| Top-1 / top-2 slots | `match-generator/index.ts:155,156` | `pool[0]` is Tier 1, `pool[1] ?? null` is Tier 2. Exactly two tiers; a user with one candidate gets a NULL Tier 2. **No minimum score** | Yes — selection only |
| Previous-week skip | `match-generator/index.ts:145–146` | Partners delivered last week are filtered out | No |
| Previous-week fallback | `match-generator/index.ts:148–149` | If the filtered pool is empty, the unfiltered pool is used rather than delivering nothing | No |
| No candidate at all | `match-generator/index.ts:150` | User is skipped entirely | No |
| Empty input | `match-generator/index.ts:51` | Returns `matchesProcessed: 0` without querying responses | No |
| Upsert batch | `match-generator/index.ts:161–162` | 500 rows per batch, idempotent on `(user_id, week_id)` | No |
| Week id | `match-generator/index.ts:175–183` | Calendar arithmetic (ms/day, `+7`/`-7`) | No |

Ties are broken only by the sort's stability over the order pairs were pushed,
which follows the user order returned by the `users` query — that query has no
`ORDER BY`, so equal scores have no defined partner preference.

## 4. What is deliberately absent

There is **no minimum overall score, no percentage cutoff, no score band, no
`.limit()` call, and no `gte`/`lte` filter on any score** anywhere in the weekly
path. Every eligible pair is scored, and every user with at least one candidate
receives tiers regardless of how low the best score is.

Consequences for a weight change:

- A different ratio can only **reorder** partners. It cannot newly exclude a
  pair, change how many users are delivered, or move a pair between tables.
- The visible effect is which partner lands in Tier 1 versus Tier 2; a change
  that leaves the order intact is invisible.
- A missing dimension contributes 0, so the weights are not renormalised over
  the dimensions that have evidence. With three of five dimensions answered,
  the maximum reachable overall score is `(w1 + w2 + w3) * 100`, not 100.

## 5. Changing the weights

1. Edit only the five integers at `compatibilityEngine.ts:29–35`. The total and
   the fractions follow from them; do not introduce decimal literals.
2. Keep the denominator derived — `SECTION1_WEIGHT_TOTAL` is the sum, and the
   test asserts it is 11.
3. Run `npm run verify`, which pins the integers, the total, the equal top pair,
   all-full-marks = 1.0 and only-the-weight-1-dimension = 1/11.
4. No other source file holds a copy: `scripts/e2e-matching-test.mjs` imports
   `SECTION1_DIMENSION_WEIGHTS`, and `match-generator` imports
   `calculateCompatibility`.
5. If a minimum score is ever introduced, define it on the 0–100 scale and add
   it to this table in the same change.

## 6. Regression surface

`npm run verify` runs four dependency-free checks (no database, no network):

- `scripts/verify-section1-weights.mjs` — the weights and the two scoring edge cases
- `scripts/verify-matching-eligibility.mjs` — pair eligibility
- `scripts/verify-weekly-generation-safety.mjs` — migration and generator text checks
- `scripts/verify-payment-ticket.mjs` — callback branch decisions

Not covered by that script and not runnable without a database or sandbox:
`scripts/verify-rls-closure.mjs` and `scripts/verify-entitlement-clamp.mjs`
(local Supabase), `scripts/e2e-matching-test.mjs` (staging only, never
production), `scripts/sandbox-transactionstatus.mjs` (Daraja sandbox).
