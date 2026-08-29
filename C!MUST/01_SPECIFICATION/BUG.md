# Bug Report Template

```
Bug:

Observed behavior:

Expected behavior:

Steps to reproduce:
1.
2.
3.

Where it likely lives:
(File/function/table if known — otherwise say "unknown, needs inspection")

Severity:
(Tier 1 money/security/data — Tier 2 core function — Tier 3 supporting — Tier 4 cosmetic)

Regression risk:
(Was this working before? What changed recently nearby?)
```

## Non-negotiable rule for bug fixes under C!MUST

Every bug fix gets a regression test that would have caught it, before the fix is considered done. If you can't write a test for it, you don't fully understand the bug yet — go back to INSPECT.
