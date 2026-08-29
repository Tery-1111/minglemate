# IMPLEMENT — Prompt Template

Use once the plan is approved.

```
Implement exactly the approved plan. Scope rules:

DO:
- make the smallest change necessary
- preserve existing behavior outside the plan's scope
- follow existing architecture and naming conventions
- reuse existing abstractions instead of inventing new ones
- create a migration for any schema change
- add or update tests alongside any behavior change
- explain any destructive change (deletions, drops, overwrites)
  before making it

DO NOT:
- rewrite entire files when a targeted edit would do
- introduce a new framework/library without saying why
- invent an API shape or database column that hasn't been confirmed
- touch files or components outside the plan's stated scope
- remove validation or error handling just because it's inconvenient
- delete or skip a failing test instead of fixing the underlying issue
- claim a test passed without actually having run it
```

After implementation, require a report: what changed, and — just as important — what was NOT tested. Silence on the second half is not acceptable; if something wasn't tested, say so explicitly rather than letting it pass unmentioned.
