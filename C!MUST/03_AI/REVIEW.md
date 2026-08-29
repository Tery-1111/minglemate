# REVIEW — Checklist (Human, Not AI)

AI doesn't get the final vote. Run this against the actual PR / running change, not against AI's own summary of it.

```
Functionality
- Does it actually solve the problem in the spec?

Architecture
- Did this introduce anything that doesn't belong (unneeded
  dependency, duplicated logic, a pattern that doesn't match the
  rest of the codebase)?

Security
- Could a user access or modify something they shouldn't
  (check RLS policies specifically if this touches Supabase)?

Data
- Could this corrupt, leak, or lose data? Is there a migration,
  and is it reversible?

UX
- Does it behave sensibly for a real user, not just the happy path?

Maintainability
- Will you understand this in six months without re-reading the
  whole PR? Would a hypothetical next developer curse whoever
  wrote this?
```

If anything here fails, it goes back to PLAN or IMPLEMENT — not straight to "fix it and merge anyway."
