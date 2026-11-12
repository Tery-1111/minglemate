# Section 1 — matching engine verification

Date: 2026-10-22
Scope: the 50-question Section 1 questionnaire, its persistence, the
compatibility engine, and how the score reaches Matches. Section 2, payments
and contact unlock were read only where a boundary had to be proved.

> **Remediation status (2026-10-22):** the schema, privacy, legacy-answer and
> completion-integrity fixes are prepared and tested, but **not applied**. The
> follow-up report also closes the option-validation gap recorded in §4 of that
> report: completion is now checked against a generated copy of the question
> bank, not merely against non-blank strings. See
> [SECTION1_PRODUCTION_REMEDIATION.md](SECTION1_PRODUCTION_REMEDIATION.md) for
> the migration, the production/staging schema comparison, the PostgreSQL 17.6
> staging evidence and the production execution gate. The findings below remain
> the evidence snapshot for the live database.

## 1. Baseline

| Item | Value |
|---|---|
| Branch | `main` |
| Starting commit | `bad4201` (Merge PR #15, verifier CRLF fix) |
| Working tree at start | clean except `supabase/.temp/cli-latest` (pre-existing, untouched) |
| Production project | `minglemate`, ref `mhdjnhiqahsllbczbzpk` |
| Runtime used | Node v24.14.0 (native TypeScript type-stripping for the engine import) |

## 2. Findings

| # | Status | Finding | Evidence |
|---|---|---|---|
| F-1 | **CONFIRMED — blocker** | Production `user_responses.responses_array` is `integer[] NOT NULL`. The screen writes the chosen **option text** (`'In person'`), and Postgres cannot store that in an integer array. Every Section 1 answer save fails with `22P02`, so nobody can complete the questionnaire in production. | Live catalog: `pg_attribute` → `integer[]`, NOT NULL; `select pg_input_is_valid('In person','integer')` → `false`; `src/pages/Section1.jsx:98, 107-111` writes `CAMPUS_QUESTIONS[current].options[optionIndex]` into `user_responses`; `supabase/functions/_shared/compatibilityEngine.ts:60-75` compares option text. |
| F-2 | **CONFIRMED — privacy defect** | Production `user_responses` carries `"Allow authenticated users to read any response matrix for match"` with `USING (auth.role() = 'authenticated')`, so any signed-in user can read every other user's 50 answers. The repository's owner-only policies were never applied to this database. | Live `pg_policy`; `supabase/migrations/20261014150000_consolidated_schema_chain.sql:162-185` declares the owner-only set. |
| F-3 | **CONFIRMED** | The only `section1_complete = true` row holds a 40-slot **integer** array (the retired 40-question set) and `section1_progress = 39`. The 50-question engine reads positions 1–40, compares them as text to option strings, and therefore scores that profile 0 on every dimension — while still treating it as an eligible, completed profile. | Live rows: one response row, `cardinality = 40`, sample `{0,0,0,1,…}`, `section1_complete = true`; `match-generator/index.ts:40-47, 62-70`; `compatibilityEngine.ts:60-88`. |
| F-4 | **CONFIRMED** | `section1_complete` and `section1_progress` are self-asserted by the browser: they are in the client UPDATE grant and the user's own UPDATE policy, and the production clamp protects only the Section 2 entitlement columns. No trigger requires 50 answers. A client can enter the match pool without a questionnaire. (Scores are still computed server-side from stored answers, so this is admission integrity, not score forgery.) | `…consolidated_schema_chain.sql:151-155` (own-row update), `:2090-2096` (grant), `:2268` (clamp trigger); production `pg_get_functiondef('clamp_user_protected_columns')` shows only `section2_unlocked` / `section2_free_expires_at`. |
| F-5 | **CONFIRMED — fixed** | Five defects in the Section 1 screen: a completed row saved `section1_progress = 49` (the last index) instead of 50; a retake therefore opened on **Q50**; a stored row was restored at its own length, so a short/legacy row was re-saved with shifted or missing slots; editing one answer on a retake set `section1_complete = false` and dropped the profile out of the pool; and a completed retake re-entered the Section 2 onboarding chain instead of returning to Profile. | `src/pages/Section1.jsx` before this change: `section1_progress: isSurveyFinished ? current : nextStepIndex`, `setCurrent(progressPointer)`, `responseRow.responses_array.map(...)`, `section1_complete: isSurveyFinished`, `navigate('/section2')`. |
| F-6 | **UNKNOWN — product decision** | The PRD names five dimensions — communication, conflict, emotional maturity, **relationship expectations**, values/lifestyle — but its weight line names only four of them plus “space”: “communication + conflict ×3; emotional + space ×2; values ×1”. “Space” is not one of the five named dimensions; personal space appears only as content inside Q33 and Q39. The code assigns `expectations: 2`. Whether that is the PRD's intended mapping is not established by the document. | Master PRD §5, plain-text lines 86–87; `compatibilityEngine.ts:29-35`. |
| F-7 | **CONFIRMED — untraceable authorisation** | The 3:3:2:2:1 weights were introduced in commit `302b1ca` (2026-10-21, “WIP…”), replacing `0.30/0.25/0.20/0.15/0.10` (ratios 3 : 2.5 : 2 : 1.5 : 1). `scripts/verify-section1-question-mapping.mjs:1` calls the mapping “OWNER-APPROVED (Will, 2026-10-21)”, but the repository holds no signed approval, and `docs/MINGLEMATE_PRD_COMPLIANCE_MATRIX.md:162` still records the old weights as **FAIL** with decision **PD-1** open. | `git log -p -- supabase/functions/_shared/compatibilityEngine.ts`; matrix line 162 and its decision list line 309. |
| F-8 | **CONFIRMED — adjacent, unused** | Production still carries a second, flat scoring implementation: `public.calculate_compatibility(uuid,uuid)` counts positional equality and divides by array length, with no dimensions and no weights; `get_bulk_compatibility_scores` wraps it. Nothing in `src/` calls either, so no screen shows its result — but any future caller would get a score that disagrees with the engine. | Live `pg_get_functiondef`; `grep -rn "calculate_compatibility\|get_bulk_compatibility_scores" src` → no matches. |
| F-9 | **CONFIRMED — adjacent** | `public.discover_candidates()` does not exist in production, so `Discover.jsx:66` (`supabase.rpc('discover_candidates')`) returns a missing-function error. This is the Discover path, not Section 1 scoring; reported, not changed. | Live `pg_proc` lookup for the name → no row. |
| F-10 | **UNVERIFIED** | Question wording and option sets cannot be checked against the PRD: the PRD specifies the questionnaire's size, dimensions and weights but contains no question text. The bank is internally consistent and is the only source of truth for wording. | Master PRD §5; `src/data/section1Questions.js` (50 texts, all unique). |
| F-11 | **CONFIRMED** | Returning users are not forced through onboarding: login lands on `/home` (`Login.jsx:61`), which reads the stored `section1_complete` and only offers the questionnaire when it is false (`Home.jsx:64, 121`); a completed user opening `/section1` is redirected to `/discover` unless `?retake=1` (`Section1.jsx:38-42`). Editing interests uses `?edit=1`, writes only `users.interests`, and returns to Profile (`Interests.jsx:22, 71-84`) — it never enters Section 1. Profile editing writes only the profile row and never touches `user_responses` (`Profile.jsx:173, 207`). | Source, as cited. No live session was run. |

## 3. Question audit

Bank: `src/data/section1Questions.js` — 50 objects, `id` 1…50 in array order
(`:3` … `:297`), four distinct non-empty options each, 50 unique question texts,
no duplicate option inside a question, no gaps or duplicate ids.

| Dimension | Bank category | Questions | Engine range | Weight | Participation |
|---|---|---|---|---|---|
| Communication | `Communication` | 1–10 | `index + 1` (`compatibilityEngine.ts:53`) | 3/11 | 10/10 |
| Conflict handling | `Conflict` | 11–20 | `index + 11` (`:54`) | 3/11 | 10/10 |
| Emotional maturity | `Emotional` | 21–30 | `index + 21` (`:55`) | 2/11 | 10/10 |
| Relationship expectations | `Expectations` | 31–40 | `index + 31` (`:56`) | 2/11 *(see F-6)* | 10/10 |
| Values and lifestyle | `Values` | 41–50 | `index + 41` (`:57`) | 1/11 | 10/10 |

Participation was measured, not assumed: for each of the 50 questions, two
profiles identical except on that question score exactly **90** in that
question's dimension, **100** in the other four, and the overall drops by
`10 × weight/11`. All 50 produce that result, so every question reaches the
scoring pipeline and every question carries its dimension's declared weight.
The engine's five ranges cover 1–50 exactly once.

Storage is **positional**: `user_responses.responses_array[i]` is question
`i + 1`. The ids are not persisted, so array order is the identifier contract —
now asserted explicitly (the previous mapping test only sorted the ids, which
would not catch a reordering).

## 4. Scoring trace

```
section1Questions.options  →  Section1.jsx:84-90
  answers[index] = option text
  upsert user_responses.responses_array          (one row per user)
  update users.section1_progress / section1_complete / section1_last_edited

match-generator/index.ts:40-47   eligible users: section1_complete = true AND profile_status = 'active'
match-generator/index.ts:56-70   responses_array positions 1..50 → answers[1..50]
match-generator/index.ts:99-106  every unordered eligible pair → calculateCompatibility(A, B)

compatibilityEngine.ts:77-88     dimension = matches / questions-both-answered × 100
compatibilityEngine.ts:60-75     a match = exact option text, trimmed + lowercased
compatibilityEngine.ts:97-102    overall = Σ dimension × weight  (0–100)
match-generator/index.ts:112     Math.round(overall) — ranking only
match-generator/index.ts:141-165 sort desc → tier1 = best, tier2 = next → upsert match_history
```

Consumption: `match_history` stores `tier1_match_id` / `tier2_match_id` and has
no score column, so no stale score can be displayed. `Matches.jsx:34-45`
hydrates those two ids; `Discover.jsx` does not use the score at all (it orders by `created_at`, `chain:1123-1124`). The score's entire product effect is which
partner lands in Tier 1 versus Tier 2. There is no minimum score, cutoff or
band anywhere in the path (`docs/matching-pipeline-thresholds.md` §3–4).

Missing-answer handling: `scoreDimension` divides by the questions **both**
users answered, so an unanswered question is excluded rather than counted as a
mismatch, and a profile with no answers scores 0. That is documented intent
(`matching-pipeline-thresholds.md` §4). It becomes a live risk only through
F-3/F-4, where a sparse profile is admitted as complete.

## 5. Defects corrected

1. **`src/pages/Section1.jsx`** — retake and pointer defects (F-5):
   * a stored row is projected onto exactly 50 slots, so a short/legacy row
     cannot shift an answer onto another question when re-saved;
   * a retake starts at question 1 (it previously opened on Q50, because a
     completed row's pointer was the last index);
   * the pointer is clamped to a valid question, so an out-of-range legacy
     value cannot render a blank card;
   * completion stores `CAMPUS_QUESTIONS.length` (50), not the last index;
   * a retake of an already-complete row keeps `section1_complete = true`
     while a single answer is being edited (the full answer set is still
     there), instead of dropping the profile out of the pool;
   * a completed retake returns to `/profile` instead of re-entering the
     Section 2 onboarding chain;
   * the effect now lists `isRetake` in its dependencies.

2. **`scripts/verify-section1-questionnaire.mjs`** (new, wired into
   `npm run verify`) — 712 assertions: bank size/order/uniqueness, dimension
   coverage, per-question participation and weight, changed-answer
   recomputation, unanswered handling, Section 1/Section 2 separation,
   retake/pointer/positional invariants, completion preserved during an edit,
   owner-scoped writes, and the presence of the production fix.

3. **`supabase/sql/production/20261022180000_production_section1_responses.sql`**
   (new, **not applied**) — converts `responses_array` to `text[]` preserving
   every stored value, replaces all existing policies with owner-only
   select/insert/update, revokes the anon grants, adds the column comment, and
   post-checks the type and policy set. It deliberately does not rewrite the
   legacy answers or `section1_complete`, and does not drop the unused SQL
   scoring functions.

No scoring formula, question wording, dimension assignment, Section 2 code,
payment code or database object was changed.

## 6. Remaining blockers

1. **Apply the prepared migration (owner authorisation required).** Until
   `user_responses.responses_array` is `text[]`, Section 1 cannot save a single
   answer and the engine has no real answers to score. The task forbade
   production database changes, so the file is prepared and unapplied.
2. **Decide the `expectations` weight (F-6).** The PRD's “space ×2” does not
   name a dimension. No scoring change was made; the code keeps 2 until the
   owner confirms whether personal space is the ×2 dimension or is content
   inside relationship expectations.
3. **Record the weight authorisation (F-7).** The 3:3:2:2:1 change exists only
   in a WIP commit and a script comment; the compliance matrix still records
   the older weights as failing. Either a decision record should be added or
   the weights should be revisited once (2) is decided.
4. **Server-derive completion (F-4).** Needs a migration or a generator change;
   both change production behaviour and need approval.
5. **The legacy completed profile (F-3).** It should retake Section 1 after the
   migration (the retake now starts at Q1 and writes 50 slots), or be excluded
   from the pool by an explicit owner decision. The migration does not touch it.
6. **Discover’s missing RPC (F-9)** and the unused SQL scoring functions (F-8)
   are adjacent and out of this task’s scope.

## 7. Verification results

| Command | Exit | Result |
|---|---|---|
| `node scripts/verify-section1-questionnaire.mjs` | 0 | `712 assertions, 50/50 questions scored, retake/pointer/positional storage verified` |
| `node scripts/verify-section1-weights.mjs` | 0 | 3:3:2:2:1; only-values = 1/11 |
| `node scripts/verify-section1-question-mapping.mjs` | 0 | 50 questions, 5 × 10, ranges match, 100/0 |
| `npm run verify` | 0 | all nine checks passed (incl. 45/45 payment-schema checks) |
| `npm run build` | 0 | 480 modules transformed, built in under 1 s |
| `npm run lint` | 1 | 43 problems (25 errors), all in the rule classes already recorded as pre-existing in `GATES.md` Gate 54; **`Section1.jsx` appears nowhere in the output** |
| Read-only production probes | — | column type, constraints, policies, grants, triggers, clamp body, `pg_input_is_valid`, function definitions, non-existent `discover_candidates`; no writes, no migrations |
| `scripts/e2e-matching-test.mjs` | **not run** | needs staging credentials (`E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`); refuses production by design |
| Live answer write | **not attempted** | the task forbids altering live data; the write is proven impossible by the column type + `pg_input_is_valid` |

Limitations, stated rather than papered over: the production defects are proven
by catalog/read-only evidence, not by a live questionnaire run; the app-side
fixes are covered by executed unit-level checks and a successful build, not by
a browser session (no test account was created, as instructed).

## 8. Final verdict

**HOLD.**

The scoring implementation itself is sound and traceable: all 50 questions map
to exactly one dimension, every question measurably moves the score by its
dimension's weight, the answer comparison is exact option text, Section 2 is
fully separate, and the score's only effect is tier ordering. But Section 1 is
**not operational in production**: its answers cannot be persisted
(`integer[]` vs option text), every signed-in user can read every other user's
answers, and the sole completed profile holds the retired 40-question integer
set. The PRD also leaves the `expectations`/`space` weight unresolved. ACCEPT
would require at least the prepared migration to be applied and the weight
question decided.
