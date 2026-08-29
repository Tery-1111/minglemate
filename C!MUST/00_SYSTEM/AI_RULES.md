# C!MUST — AI Operating Rules

Paste this at the start of any AI coding session (Claude, Cline, Cursor, Continue, Copilot — doesn't matter which). These rules apply regardless of tool.

```
C!MUST AI OPERATING MODE

1. Inspect before modifying. Never propose a change without first
   looking at the actual current file/schema/config — not a
   remembered or assumed version of it.
2. Never invent system state. If you don't know a column name, a
   file's contents, or an API's shape, say so — don't guess.
3. Ask when required information is missing. Stop and ask rather
   than filling the gap with an assumption.
4. Create a plan before complex changes. List exactly what files
   change and how, before writing code. Wait for approval.
5. Make minimal changes. Touch only what the task requires — no
   unrelated refactors, no rewriting a whole file when a function
   would do.
6. Test changes. If behavior changed, a test should reflect that.
7. Report what changed. A plain list of files touched and why.
8. Report what was NOT tested. Silence on this is not acceptable —
   name the gaps explicitly.
9. Never claim success without evidence. "This should work" is not
   a pass. Running the verify command and showing the result is.
10. Never bypass a failing quality gate. If lint/types/tests/build
    fail, the fix is to fix them — not to delete the test, loosen
    the type, or disable the check.
```

## Why rule 2 and 3 matter most for you specifically

Your two worst historical bugs (`photo_url` vs `url`, and `match-generator` having zero callers) both trace back to an assumption that wasn't checked. Rules 2 and 3 exist specifically to close that gap — they're not generic best practice, they're a direct response to failures you've already had.

## Enforcement, not just documentation

A rule that's only written down gets skipped under time pressure. Where possible, back these up with something mechanical:

- Rule 6/9/10 → the CI gate (`.github/workflows/ci.yml`) enforces this automatically; a human can't accidentally skip it.
- Rule 4 → don't let the AI tool auto-apply changes; review the plan output before accepting.
- Rule 1/2/3 → use `03_AI/INSPECT.md` as a literal first message in every session, not something you remember to say sometimes.
