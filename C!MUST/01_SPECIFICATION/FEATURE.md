# Feature Specification Template

Copy this, fill it in, then hand it to your AI tool as the starting point for INSPECT.

```
Feature:

Why:
(What problem does this solve? For whom?)

User / problem:

Expected behavior:
(Step by step, what should happen)

Inputs:

Outputs:

Constraints:
(Performance, security, existing architecture it must respect)

Dependencies:
(Other features, tables, services this touches or relies on)

Acceptance criteria:
- 
- 
- 

Risks:
(What could this break? What's the blast radius?)
```

## Example (filled in)

```
Feature: User notifications

Why:
Users currently have no way to know a match happened without
checking the app manually.

User / problem:
Any authenticated user with at least one match.

Expected behavior:
1. Create notification when match-generator inserts a new match.
2. Persist notification in a notifications table.
3. Deliver via OneSignal push.
4. Mark delivery state (sent / failed / pending).
5. User can view notification in-app.
6. Handle delivery failure without losing the notification record.

Inputs: match_id, user_id (both sides of the match)
Outputs: notification row, push delivery attempt

Constraints:
Must respect existing RLS pattern — a user can only read their own
notifications.

Dependencies:
match-generator Edge Function, OneSignal integration, notifications
table (new).

Acceptance criteria:
- Notification is created exactly once per match, per user.
- Unauthorized users cannot read another user's notifications.
- A failed push delivery is retryable, not silently dropped.
- Existing match flow is untouched.

Risks:
Touches match-generator, which has broken silently before
(zero callers bug). Inspect that function fully before editing it.
```
