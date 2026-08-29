# C!MUST v0.1 — Workflow

This is the only loop that matters right now. Nothing else gets implemented until this is bulletproof.

```
SPECIFY
   ↓
INSPECT
   ↓
PLAN            ← you approve here, before code is written
   ↓
IMPLEMENT
   ↓
LOCAL VERIFY    (lint + typecheck + test + build)
   ↓
GIT / PR
   ↓
CI GATE         ← GitHub blocks the merge if this fails
   ↓
MERGE
```

Deliberately **not** in v0.1: preview environments, staging, monitoring, caching, deployment automation. Those come in later phases, once this loop stops producing surprises.

## What each stage means in practice

| Stage | Who does it | Output |
|---|---|---|
| Specify | You (with AI's help drafting) | A filled-in `01_SPECIFICATION/FEATURE.md` or `BUG.md` |
| Inspect | AI, before writing any code | A short report: current state, relevant files, assumptions, unknowns |
| Plan | AI | A numbered list of exact changes — you read it and say go/no |
| Implement | AI | Actual code, scoped to the plan only |
| Local Verify | You (one command) | Pass/fail on lint, types, tests, build |
| Git/PR | You | A branch + pull request, never a direct push to main |
| CI Gate | GitHub Actions | Same verify command, run independently of your machine |
| Merge | You | Only after CI is green |

## The one rule that matters most

> No code gets written until INSPECT and PLAN have happened. If AI is missing information at INSPECT, it stops and asks — it does not guess.

This single rule is what eliminates the class of bugs you've hit before (assuming a column name, assuming a file's contents, assuming an API shape).

## How to run a task end to end

1. Fill out a spec (`01_SPECIFICATION/FEATURE.md` template, or `BUG.md` for a fix).
2. Paste it to your AI tool along with `03_AI/INSPECT.md` as the instruction.
3. Review the inspection report. Answer any questions it raises.
4. Ask for the plan (`03_AI/PLAN.md` instruction). Approve or push back.
5. Let it implement.
6. Run `npm run verify` (or your stack's equivalent — see `QUALITY_GATES.md`) locally.
7. Commit to a feature branch, open a PR using `09_TEMPLATES/PR.md`.
8. Let CI run. Fix anything it flags.
9. Merge once green.

Once this is smooth on one real project, move to Phase 2 (branch protection + PR discipline is already baked in above) and eventually Phase 5 (preview/staging), which you already have free-tier options for (Vercel previews + a second free Supabase project).
