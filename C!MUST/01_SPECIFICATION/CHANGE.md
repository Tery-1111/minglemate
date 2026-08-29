# Change / Refactor Template

For changes that aren't a new feature or a bug fix — config changes, dependency updates, refactors, schema tweaks.

```
Change:

Why now:

What triggers it:
(New feature / bug fix / refactor / database change / config change / dependency update)

Current state:

Desired state:

Blast radius:
(What else touches this? What could break?)

Rollback plan:
(If this goes wrong in production, what's the fastest way back?)
```

Skip a full FEATURE.md spec for small mechanical changes (e.g. bumping a dependency) — but still fill in "blast radius" and "rollback plan". Those two questions catch the most damage for the least effort.
