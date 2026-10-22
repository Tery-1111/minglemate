# Client-writable columns that server-side code treats as truth

**What this is.** An audit of the class of bug behind the Section 2 entitlement
fix: a column a client can write, whose value server-side code then reads as
fact. It lists every such column found, names the code that trusts it, records
what was reproduced on a live stack, and gives the fix for each — so the class
can be closed in one pass rather than one column at a time.

**How it was produced.** The local Supabase stack (the consolidated chain applied
to a database carrying the app's base tables — the git-ignored scratch fixture
`supabase/.temp/preconditions.sql`) was inspected for effective write access
(`information_schema.column_privileges`, `pg_class.relacl`,
`pg_class.relrowsecurity`, `pg_policies`, trigger definitions), and every
candidate was then exercised through PostgREST with a real user JWT and with the
anon key — the same interface the browser uses. **11/11 observations matched**
(`probe-writable-truth.mjs`, scratch, not committed); the anonymous-unlock probe
is quoted in F1. Findings that could not be reproduced on this stack are marked
**unverified — check on the target**.

---

## 1. The three layers, and where this class lives

A client write passes three independent gates:

| layer | what it is | how it fails |
|---|---|---|
| **GRANT** | table/column privileges (`grant all on all tables in schema public to anon, authenticated` is the Supabase default) | missing `revoke` leaves the write legal |
| **RLS on** | `alter table … enable row level security` | **if RLS is off, every policy on the table is inert** and the GRANT alone decides |
| **policy / trigger** | `create policy …`, `before … trigger`, `security definer` RPC | a policy cannot restrict *columns*; a trigger can |

The Section 2 fix lived at layer 3 (the `clamp_user_protected_columns` trigger,
`supabase/migrations/20261014150000_consolidated_schema_chain.sql:1969-2013`).
The findings below are mostly layer 2 (RLS never enabled for six tables the
chain touches) and layer 3 applied to the *wrong column set* (the clamp covers
two columns; the table has a dozen that server code trusts).

The chain enables RLS for fifteen tables — seventeen statements, since 242 and
1340 repeat 148 and 790 (lines 148, 242, 300, 329, 342, 423, 459, 597, 790,
830, 858, 1340, 2160, 2517, 2795, 2808, 3434) — and **never** for
`users`, `campuses`, `notifications`, `photos`, `match_history` or
`token_purchases`. On this stack those six report `relrowsecurity = f`.

## 2. What a client can write today (verified)

| table | writable columns | gated by |
|---|---|---|
| `users` | **every non-clamped column of every row** while RLS is off (below); own row only if RLS is on | RLS *off*; `clamp_user_protected_columns` rewrites only `section2_unlocked`, `section2_free_expires_at` |
| `user_responses` | own answers (`responses_array`, `question_number`, `created_at`) | own-row policy — correct |
| `section2_chat_progress` | both participant columns, `questions_discussed`, `contacts_unlocked` | participant policy; `contacts_unlocked` is re-derived, the counter is not |
| `messages` | `sender_id` (own), `recipient_id` (anyone unblocked), `content`, `is_bot`, `sent_at` | sender policy; no pairing requirement, no column guard |
| `reports` | own report rows, any `reported_id`, free-text `reason` | own-row policy |
| `user_blocks` | own blocks | own-row policy — correct |
| `campuses`, `photos`, `notifications`, `match_history`, `token_purchases` | **all columns, any row** (RLS off on this stack) | nothing |

---

## F1 (critical) — `public.users`: RLS is never enabled, so any client writes any row

**Writable:** all of `users` while RLS is off — `bio`, `phone`, `email`,
`display_phone`, `profile_status`, `section1_complete`, `section1_progress`,
`campus_id`, `share_*`, `social_*`, `notifications_enabled`, `created_at`,
`onesignal_player_id`, … on **any** row, and for `anon` as well as
`authenticated`.

**Trusted by:** essentially everything that reads a profile: `discover_candidates()`
(`chain:940-960`), `match-generator` (`supabase/functions/match-generator/index.ts:44-48`),
`handle_new_user`/signup, `get_match_contact()` (`chain:1702-1703`),
`admin_users_list()`/`admin_overview()`, `record_entitlement_evidence()`.

**Reproduced (authenticated):** subject PATCHed the *other* test user's row
(`bio`, `section1_complete`) → `204`, and the victim's row changed. Enabling
`alter table public.users enable row level security` and repeating the identical
PATCH → `204` again but **zero rows matched**, victim unchanged. That is the
proof of cause: the enable is what closes it.

**Reproduced (anonymous):** with the anon key (no user JWT at all):

```
PATCH /rest/v1/users?id=eq.<victim>   {"section2_unlocked":true,
                                       "section2_free_expires_at":"2099-01-01T00:00:00Z"}
-> 204     row after: {"section2_unlocked":true,
                       "section2_free_expires_at":"2099-01-01T00:00:00+00:00",
                       "bio":"ANON-WROTE-THIS"}
```

Note what this says about the clamp: `clamp_user_protected_columns` treats a
write as a client write only when `auth.uid()` is not null (`chain:1987`),
so an **anonymous** write is not clamped, and with RLS off there is no policy to
stop it either. The two protections the section2 fix relies on are both absent
for `anon`.

One mitigating note, and it is the ledger doing its job: the anonymous write
*went on the record* — `entitlement_grants` gained a `section2_unlock_paid` row
with `reason_source = 'none'`, exactly the shape
`entitlement_evidence_anomalies` flags as `paid_unlock_without_evidence`
(`chain:3825-3843`). Detection worked; prevention did not. (The row only lives
as long as the user row; deleting the account takes the evidence with it.)

**Fix.** `alter table public.users enable row level security;` in the chain
(with the own-row policies already present at `chain:121-141`, which then govern:
own row writable, other rows not), and re-run the entitlement verifier. The
chain's own text states the intent — "INSERT/UPDATE/DELETE grants stay
table-wide; RLS policies gate them to own-row writes"
(`chain:1627-1628`) — it just never switches RLS on.

## F2 (critical) — `public.campuses`: clients write the table that decides campus membership

**Writable:** all of it — `name`, `email_domain`, `is_active`, `matching_enabled`
— by any anon/authenticated client while RLS is off (`GRANT ALL` on the table).

**Trusted by:** `ProfileSetup.jsx:44-48` resolves the user's institution from
their email domain with `select id, name from campuses where email_domain = <domain>`,
the client then stores `campus_id` on its own row (`ProfileSetup.jsx:82-96`), and
`discover_candidates()` scopes discovery by campus equality (`chain:952`). The
admin RPCs `admin_add_campus` / `admin_set_campus_active` /
`admin_set_campus_matching` exist precisely to own this table.

**Reproduced:** client PATCH of a campus → `204`, `is_active` and
`matching_enabled` both flipped to `false`; client POST of a new campus with
`email_domain: gmail.com` → `201`; then the client set its own `users.campus_id`
to that new campus → `204`.

**Fix.** The chain already carries the fix as a comment
(`chain:3275-3282`): enable RLS, add the read-all policy, send all writes
through the `admin_*` functions. Do that, and derive `users.campus_id`
server-side from the verified auth email rather than accepting it from the
client (see F7).

## F3 (high) — `section2_chat_progress.questions_discussed`: the free contact reveal trusts a client counter

**Writable:** the two participant columns and `questions_discussed` by either
participant (`progress_update_participants`, `chain:361`).

**Trusted by:** `enforce_contacts_unlocked()` re-derives
`contacts_unlocked := (questions_discussed >= 14)` (`chain:380-388`), and
`get_unlocked_contacts()` releases the partner's phone/WhatsApp/email on
`contacts_unlocked = true` when the pair is paired (`chain:1541`, `chain:1578`).
The verdict view re-checks the same client number:
`chat_unlock_without_questions … where contacts_unlocked and questions_discussed < 14`
(`chain:3912`).

**Reproduced:** a fabricated progress row (`questions_discussed: 14`, zero
messages in the conversation) was accepted (`201`), stored with
`contacts_unlocked = true`, and `get_unlocked_contacts(<partner>)` returned the
partner's phone and email (`200`). The anomaly view returned **zero rows** —
because the value it checks is the one the client wrote. The evidence check is
circular.

**Fix.** Either own the counter server-side — an RPC that increments it and
writes the bot question itself, so `messages`/progress are written by the
same path that can prove a question happened — or stop recording it as a
verified grant: today the ledger says "the 14th question for this pair was
discussed" (`chain:381-385`) about a number nobody checked. At minimum, the
anomaly should compare against something not writable by the party who benefits.

## F4 (medium-high) — `messages.sent_at`: the rate limiter counts a client-set timestamp

**Writable:** `sent_at` on insert (`messages_insert_own_sender`, `chain:886`;
the client sets it in `Chat.jsx:383`).

**Trusted by:** `enforce_message_rate_limit()` counts
`m.sent_at > now() - interval '1 hour'` for the sender (`chain:538`, trigger
`chain:554`); chat ordering and "last message" previews sort on it
(`Chat.jsx:66`, `Messages.jsx:108-121`).

**Reproduced:** control — with `sent_at = now`, the 60-message window is real:
59 more accepted and the next write refused `400` with `RATE_LIMITED`
(`P0001`). Bypass — 65 messages written with `sent_at` three hours in the past
were **all accepted (65/65)**; the limiter sees none of them.

**Fix.** Count on a column the client cannot write — e.g. add
`created_at timestamptz default now()` to `messages` and count that in the
trigger, or compare against a server timestamp captured in the row. Keep
`sent_at` for display only.

## F5 (medium) — `messages.is_bot` and `messages.recipient_id`: system-message impersonation to any user

**Writable:** `is_bot` and `recipient_id` (any recipient who is not blocked and
with whom there is no `locked`/`unmatched` conversation — the policy never
requires an actual pairing, `chain:886-905`).

**Trusted by:** the UI renders `is_bot` rows as bot/system bubbles
(`Chat.jsx:441-444`, `Chat.jsx:484`, `Messages.jsx:204`) and `Messages.jsx:105`
reads them as the conversation's own messages.

**Reproduced:** a client POSTed `{sender_id: self, recipient_id: <stranger>,
is_bot: true, content: "MingleMate: verify your account at …"}` → `201`, stored
with `is_bot = true`, i.e. a forged platform message delivered to an arbitrary
user.

**Fix.** Clamp `is_bot` to `false` for client inserts (the
`clamp_user_protected_columns` pattern), mint true bot rows only from
server-side code, and require a real pairing for `recipient_id` (the same
`users_are_paired`/conversation condition the paid paths use).

## F6 (medium) — `users.created_at`: a client-writable timestamp is the trial's reference point

**Writable:** `users.created_at` (owner write; and cross-row while RLS is off).

**Trusted by:** the entitlement verdict's `trial_unexplained` case compares the
trial expiry against `u.created_at + interval '14 days'` (`chain:3854`,
`chain:3862`), i.e. the row's own timestamp is the evidence standard. Admin
views order by it, and the trial grant is "created_at + 14 days" by design
(`handle_new_user`, `chain:2023-2050`).

**Reproduced:** not exercised (it would only manufacture a false verdict; the
write itself is covered by F1). **Verified statically**: the column is in the
client-writable set and the view reads it as the baseline.

**Fix.** Compare against the ledger's own `section2_trial_14d` grant
`created_at` (or `auth.users.created_at`) rather than the profile row, and put
`created_at` in the clamp's protected set.

## F7 (medium-high) — the onboarding gates `section1_complete`, `profile_status`, `gender`, `campus_id`

**Writable:** owner write (`users_update_own`) — all four are set by the client
(`Section1.jsx:103-108`, `Settings.jsx:57-61`, `ProfileSetup.jsx:78-96`); cross-row
while RLS is off.

**Trusted by:**
* `discover_candidates()` — `profile_status = 'active'`, `section1_complete = true`,
  `gender <>` mine, campus equality (`chain:944-952`);
* `match-generator` — `.eq('section1_complete', true)`, `.eq('profile_status','active')`
  and opposite-gender pairing (`match-generator/index.ts:44-48, 98`);
* `admin_overview()`/`admin_users_list()` statistics ("section1Complete", "activeUsers");
* the ledger's profile-status classifier (`profile_status_paused/resumed/pending_deletion`).

**Consequence:** a profile appears in discovery and in the weekly match pool
without completing Section 1, asserts its own campus and gender, and can flip
`paused` back to `active` — the column that is supposed to mean "this account is
paused".

**Fix.** Treat these as *derived* where a derivation exists:
`section1_complete` from `user_responses` (≥50 answers), `campus_id` from the
verified email domain at signup (server-side, not from the client), and
`profile_status` as an allowlist with transitions the server owns (the ledger
already names them). Where a value must stay client-set, stop reading it as a
gate.

## F8 (high) — `match_history`, `notifications`, `token_purchases`: RLS off in the chain

Same root cause as F1: no `enable row level security` anywhere in the chain for
these three (nor in the superseded files that were folded into it). On this
stack, and on any database built from the chain without a pre-existing RLS
state, any client writes any row.

**What that buys an attacker:**
* `match_history` is the pairing truth for `users_are_paired()` and
  `get_match_contact()`/`get_unlocked_contacts()` (`users_are_paired()` at
  `chain:978`, `get_unlocked_contacts()` at `chain:1541`, `get_match_contact()`
  at `chain:1664`):
  a forged row (`user_id: me, tier1_match_id: <victim>`) makes the server treat a
  stranger as a match, which — combined with F3 — releases their contact
  details for free, and removes the victim from that client's discovery.
* `notifications` — forged system notifications to any user
  (`send-notification` also writes these with the service role).
* `token_purchases` — the legacy "transactions" list an admin sees in
  `admin_overview()` can be fabricated row by row.

**Also worth knowing (legacy state, unverified here):** `Projects/minglemate/schema_only.sql`
(the older hosted dump) carries permissive legacy policies that the chain does
not drop: `"System can insert notifications" … WITH CHECK (true)` (line 1838),
`"Allow authenticated users to read any response matrix for match"` (line 1790),
`"Allow users to modify their own specific profile rows"` (line 1810). If those
still exist on the target, notification inserts by any client, and any
authenticated user's read of anyone's questionnaire, are live today. Check them
with the queries in §4.

**Fix.** Add the three `enable row level security` statements and explicit
policies: `match_history` read-own only (writes stay service-role), `notifications`
read-own, `token_purchases` read-own and no client insert.

## F9 (high, unverified — check on the target) — `photos` has no write policy, and the storage policies guard a different bucket

**Writable:** `public.photos` is written directly by the app
(`PhotoUpload.jsx:68, 82-87`: upload to `${userId}/…` in bucket **`user-photos`**,
then `upsert` `public.photos` with `user_id`, `photo_url`, `photo_type`,
`display_order`). The chain enables no RLS on `public.photos` and defines no
policy for it, so on a database in that state any client writes any user's photo
rows. In the legacy hosted state (`schema_only.sql:2044` enables RLS, policy
`"Users can read all photos" … FOR SELECT` only, line 1886) the same upsert is
refused for *everyone* — the app's own upload cannot work there.

**Storage:** the chain's bucket/policies are for **`profile_photos`**
(`chain:3303`, `chain:3308-3338`) while the app reads and writes **`user-photos`**
(`PhotoUpload.jsx:68`, `Photos.jsx:86-101`). The BOLA the chain's comment
describes ("any authenticated user could overwrite or delete another user's
photos") is therefore closed for a bucket the app does not use, and open (or
closed by unrelated policies) for the one it does.

**Why unverified:** this stack's `photos` table came from the scratch
preconditions with a different column (`slot` instead of `display_order`), so
the app's exact upsert could not be replayed here. **Check on the target** with
§4 and align the bucket names before assuming either state.

## Adjacent, same spirit (not a column)

* `send-notification` (`supabase/functions/send-notification/index.ts:31-72`):
  any authenticated user may supply up to 10 arbitrary `recipientIds` with
  free-form `heading`/`message`; the function resolves player IDs server-side
  (good) but never checks the caller's relationship to the recipients. Any user
  can push a spoofed notification to any ten users per call.
* `users.share_phone`/`share_email`/`share_social_*` and the `phone`/`email`
  columns are self-asserted by the owner and are the payload of the paid connect
  snapshot (`complete_connect_unlock`). That is a product decision, not a bug —
  but it means a paid "contact unlock" is a claim about the seller, never a
  verified channel.
* `onesignal_player_id` is owner-written and read by `send-notification`
  (`index.ts:69-72`) — fine as long as the caller check above is added.

---

## 3. What must be checked on the deployed project

Everything below was verified against the *chain's* state. A hosted database
carries its own history, so run these on it (read-only):

```sql
-- 1. RLS state of every public table (expect 'on' everywhere)
select c.relname, c.relrowsecurity as rls_on
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
 order by c.relrowsecurity, c.relname;

-- 2. Every policy, with its row checks
select tablename, policyname, cmd, roles::text, qual, with_check
  from pg_policies where schemaname = 'public' order by tablename, cmd;

-- 3. What each client role can actually reach (privileges are necessary, not sufficient)
select table_name, column_name, privilege_type
  from information_schema.column_privileges
 where grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE')
   and table_schema = 'public' order by table_name, column_name;

-- 4. The legacy permissive policies named in F8 (empty is the answer you want)
select tablename, policyname, cmd, with_check from pg_policies
 where schemaname = 'public' and policyname in
   ('System can insert notifications','Users can insert own token purchases',
    'Allow users to modify their own specific profile rows',
    'Allow authenticated users to read any response matrix for match',
    'Users can insert own s2 progress','Users can update own s2 progress');

-- 5. Storage: buckets and the policies that actually guard them
select id, public from storage.buckets order by id;
select policyname, cmd, qual, with_check from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and (policyname like 'profile_photos%' or coalesce(qual,'') like '%user-photos%'
        or coalesce(with_check,'') like '%user-photos%');
select bucket_id, count(*) from storage.objects group by 1 order by 2 desc;
```

## 4. The one-pass fix order

1. **Enable RLS** in the chain for `users`, `campuses`, `notifications`,
   `photos`, `match_history`, `token_purchases` (one line each, next to the
   fifteen that already do it). This is what closes F1, F8 and the writable half
   of F2.
2. **Campuses**: uncomment the block at `chain:3275-3282`; writes go through
   `admin_*`. Then derive `users.campus_id` server-side from the verified email
   domain (F2/F7).
3. **Extend the clamp** (`chain:1969-2013` already proves the pattern) to the
   columns whose owner-writes are not legitimate: `created_at`, `campus_id`,
   and `section1_complete` if it is to remain a gate (F6/F7).
4. **The question counter** (F3): own it server-side, or restate what the ledger
   claims — the anomaly must not validate a value written by the party who
   benefits.
5. **Messages** (F4/F5): count the rate limit on a server timestamp; clamp
   `is_bot`; require pairing for `recipient_id`.
6. **Photos/storage** (F9): give `public.photos` (RLS on) owner-scoped
   insert/update/delete policies and move the storage policies to the bucket the
   app actually uses — or move the app to `profile_photos`. Pick one; today they
   disagree.
7. **Re-verify**: `node scripts/check-schema-chain.mjs`,
   `node scripts/verify-entitlement-clamp.mjs`, `node scripts/verify-payment-ticket.mjs`,
   plus §3 on the target.

## 5. Repairs made while producing this audit

* `scripts/verify-entitlement-clamp.mjs` — its cleanup unconditionally ran
  `revoke update on public.users from authenticated`, which left the stack in a
  state the chain does not define (the chain keeps table-wide INSERT/UPDATE/DELETE
  and gates rows with the own-row policy). It now snapshots the privilege and
  restores exactly what it found, and its comment no longer claims the chain
  withholds UPDATE.
* The local stack's `users` UPDATE grant was restored to the chain's documented
  state after an earlier probe had left it revoked.
