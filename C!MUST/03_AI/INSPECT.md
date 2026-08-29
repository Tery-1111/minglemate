# INSPECT — Prompt Template

Paste this (with the spec attached) as your first message for any non-trivial task.

```
Before writing any code, inspect the relevant parts of this
codebase. Do not assume file contents, schema, or API shapes —
look at what's actually there.

Produce a report with these sections:

CURRENT STATE
(What exists right now, relevant to this task)

RELEVANT FILES
(Which files/tables/functions this will touch)

KNOWN DEPENDENCIES
(What else relies on or is relied on by this)

POTENTIAL CONFLICTS
(Anything that could collide with this change)

ASSUMPTIONS
(Anything you're inferring rather than confirming — flag these
explicitly, don't bury them)

UNKNOWN INFORMATION
(Anything you need from me before you can plan this safely)

If UNKNOWN INFORMATION is non-empty, stop here and ask — don't
proceed to a plan yet.
```

## Why this exists

This is the single stage most AI coding workflows skip. Skipping it is exactly how you got the `photo_url`/`url` mismatch and the silently-uncalled `match-generator`. This step is where those get caught instead — before code is written, not after a black screen shows up.
