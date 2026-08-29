# PLAN — Prompt Template

Use after INSPECT has come back clean (no open unknowns).

```
Based on the inspection, produce an implementation plan. Do not
write code yet.

PLAN
1.
2.
3.
...

Files to create:
Files to modify:
Files to delete:
Database changes (if any):
API changes (if any):
Tests required:
Risks:
Rollback strategy:
```

You read this and either approve it, or push back on anything that looks wrong. The rule: **AI proposes, you authorize, AI implements** — never AI proposes-and-implements-and-declares-success in one pass. That second pattern is how technical debt gets manufactured at machine speed.
