# Section 2 — live-schema reconciliation (Step 1 deliverable)

**Date:** 2026-10-22
**Scope:** reconcile the two pending Section 2 migrations with the live findings
A–F reported against `minglemate-staging`.
**Result (updated after the read-only capture):** findings A–F were taken from
the organization's **other** project. The target is schema-compatible and the
migrations need no rewrite; section 0 records the correction and section 3 is
kept only as history.

**Nothing in this file was applied, deployed or committed.**

---

## 0. Capture result (2026-10-22) — section 3's verdict, corrected

The live facts are in [LIVE_SECTION2_SCHEMA.md](LIVE_SECTION2_SCHEMA.md)
(read-only catalog queries, `supabase_read_only_user`).

| | `minglemate-staging` (target) | `minglemate` (source of A–F) |
|---|---|---|
| Ref | `ifiewinipbxxfvzpzezd` | `mhdjnhiqahsllbczbzpk` |
| `connect_unlocks`, `payment_intents`, `user_blocks`, `conversations` | all present | all absent |
| `users.share_*` | present | absent |
| `payments` | present, legacy, read by nothing here | present, legacy |
| `users` SELECT | column-scoped; contact columns not granted | table-wide, plus permissive policies |
| Migration history | `20260927120000` only | none recorded |
| Findings A–F | **do not apply** | match the report |

**Corrected verdict.** `minglemate` is not the output of this repository's
migration chain, and it was never the target of the pending migrations.
`minglemate-staging` is substantially the chain's output: its Section 2 tables,
`connect_unlocks`, `payment_intents`, `user_blocks`, `conversations`, the
`share_*` columns, `complete_connect_unlock()` and the reveal triggers are all
present, and both Stage 0 preflights pass. The one structural divergence that
matters to these files is `matches`: the target's `matches_status_check` admits
`pending|interested|discarded|matched|ghosted` (no `'active'`), the table has
no `tier` or `created_by` column, and both live rows are `'matched'`.
`is_section2_partner()` therefore admits `('active','matched')`; `'interested'`
stays excluded because it is one-sided (D2).

**What replaces section 5's Path A / Path B choice.** There is no lineage
decision left for the target. The schema is compatible and the migrations are
not rewritten. The owner authorized application on 2026-10-22; both files were
applied in one transaction each and their versions recorded (evidence in
[GATES.md](../GATES.md)). Two bookkeeping facts remain:

1. migration history records only `20260927120000`, so `supabase db push`
   would try to replay the chain — apply the two files by explicit SQL and
   record their versions afterwards;
2. the two defects the capture exposed, fixed separately after these
   migrations: `complete_force_connect()` inserted `matches(tier, created_by)`
   (columns this table lacks) and `users_are_paired()` could not see a
   `'matched'` row. Both were replaced and applied on 2026-10-22 in
   `20261022130000_fix_force_connect_and_pairing_status.sql`.

---

## 1. Evidence levels used here

| Tag | Meaning |
|---|---|
| `OWNER-REPORTED` | The owner ran ad-hoc queries and reported the results in conversation. Testimony, not a stored artifact, not re-verified by this repository. |
| `E2` | Repository source, quoted with file and line. |
| `E3` | Executed in this workspace (a check that actually ran). |
| `E0` | Inference. Labelled as such wherever it appears. |

Findings A–F arrive as `OWNER-REPORTED`. The chain facts are `E2`. The lineage
conclusion in section 3 is `E0` unless a capture confirms it — it is an
explanation that fits every reported fact, not an observation.

---

## 2. Findings A–F, verdict by verdict

Each finding gets: what it establishes, what it does **not** establish, and
which artifact closes it.

### Finding A — `public.users` contact columns are readable by client roles

**Reported:** `anon` and `authenticated` hold table-level `SELECT` on
`public.users`, plus column-level `SELECT` on `display_phone`, `email`, `phone`,
`whatsapp_number`. Policies include a public-read policy (active profiles or own
row), an `authenticated ... USING (true)` policy, and an own-profile policy.

**Establishes:** on the captured configuration, the approved contact rule is not
enforced by the database. Permissive policies OR together, so the table-wide
grant plus any permissive policy exposes those columns for every row the policy
admits.

**Does not establish:** that anyone read them; that the policy expressions are
exactly as summarised; whether `relforcerowsecurity` is set.

**Closed by:** the chain, not by a new migration. `20261014150000_consolidated_schema_chain.sql`
already carries this exact fix, with a comment saying why:

```sql
-- E1: the live project's grants on public.users are TABLE-WIDE (F4), which
-- is what made a column-scoped read impossible to express: a table grant that
-- survives alongside a column grant is the wider of the two. Both blanket
-- grants are therefore revoked here, immediately before the column grant that
-- replaces them ...
revoke all on table public.users from anon;              -- line 2041
revoke all on table public.users from authenticated;     -- line 2042
grant select (id, full_name, age, gender, bio, ...) on public.users to anon, authenticated;  -- 2044-2050
```

and, further down, `revoke select (display_phone) on public.users from anon, authenticated;`
(line 2113). The chain's own comment records that the live project's grants were
table-wide **before** this chain existed. The report is therefore a re-observation
of a known, already-written-fix condition, not a new defect.

**Client impact of applying it:** none from `src/`. Every client read of
`public.users` names its columns (`full_name`, `profile_status`,
`section1_complete`, `section1_progress`, `interests`, `notifications_enabled`);
no `select('*')` on `users` exists, and the own-row consent flags are read
through the `my_profile()` RPC (`src/pages/Profile.jsx:76`), not the base table.

### Finding B — no `share_*` columns on `public.users`

**Reported:** the share-consent probe returned no rows.

**Establishes:** the columns D3's second condition reads are not present on the
captured schema.

**Consequence, and it is severe:** `src/pages/Profile.jsx:95-100` renders the
toggles from `my_profile()` and defaults each flag with `!== false`, so with the
columns absent the UI shows every channel as *shared* and the save at line 207
writes columns that do not exist. On that schema **no owner can withdraw
consent**, so D3's "the owner currently permits disclosure" condition cannot be
satisfied by construction — not by a function, and not by a policy.

**Closed by:** the chain. `20261014150000_..._chain.sql:785-789` adds them
(`add column if not exists share_phone boolean not null default true`, …,
`share_email … default false`), which is why they are documented in
[LIVE_SECTION2_SCHEMA.md](LIVE_SECTION2_SCHEMA.md) row 8 as part of the chain's
output.

### Finding C — the 14-question reveal is live

**Reported:** triggers `trg_auto_contact_reveal → handle_contact_reveal()` and
`trg_contacts_unlocked → enforce_contacts_unlocked()` on
`section2_chat_progress`, both setting `contacts_unlocked` at
`questions_discussed >= 14`, neither checking payment or consent.

**Establishes:** the product rule "Section 2 progress never reveals contacts" is
violated live.

**Closed by:** `20261021120000_section2_free_access_and_contacts.sql`, stage 1,
which drops both triggers by those exact names, sweeps any other trigger on the
table that calls either function, drops both functions by OID-derived signature,
and pins `contacts_unlocked` with `trg_pin_contacts_flag` so no later writer can
flip it.

**But it is gated:** that migration's Stage 0 aborts the whole file if
`public.user_blocks` is absent — see Finding D. On the captured schema the
trigger fix **cannot run** until the schema question is settled. That ordering
is the single most important sentence in this document.

### Finding D — `connect_unlocks`, `payment_intents`, `user_blocks`, `conversations` are absent

**Reported:** those four tables are not in the inspected `public` schema.

**Establishes:** the schema the two pending migrations were written against is
not the schema live is running.

**Closed by:** lineage, not by a patch. All four are created by the chain:
`payment_intents` (line 302), `user_blocks` (line 492), `connect_unlocks`
(line 922), `conversations` (line 955). See section 3.

**Two live consequences follow by inference (`E0`), and they are testable:**

1. `supabase/functions/initiate-payment/index.ts:168-176` inserts into
   `payment_intents` and reads it at `:154-157` for the rate limit. If the table
   is absent, **every** Connect purchase fails server-side today.
2. `get_unlocked_contacts(uuid)` — both evidenced revisions read
   `connect_unlocks` ([LIVE_SECTION2_SCHEMA.md](LIVE_SECTION2_SCHEMA.md) item 6).
   If the table is absent, the RPC the chat screens call
   (`src/pages/Chat.jsx`, `src/pages/MatchDetail.jsx`) **fails every time**.

Both readings are consistent with the owner's earlier observation that a
completed payment sits at `unlock_status = 'pending'`: nothing on that schema
can complete an unlock. They are inference until the catalog capture is run;
if the capture shows the tables present, the inference is wrong and the schema
is simply mis-summarised.

### Finding E — `payments` has no way to say what was bought

**Reported:** `public.payments` has `id`, `user_id`, `intasend_invoice_id`,
`amount`, `status` (observed `completed`), `match_id`, `unlock_status` (observed
`pending`), `unlock_triggered_at`, `unlock_failed`.

**Establishes:** a payment row can be tied to a match, but not to a *purpose*.
`status = 'completed'` plus `match_id` cannot distinguish a Connect purchase
from anything else bought for the same pair, which is exactly what D3's "a
succeeded Connect payment covers that specific pair" forbids treating as proof.

**Decisive repository fact:** **The repository chain never creates
`public.payments`.** `grep -rn "public\.payments" supabase/` returns only two
comments — `20261019190000_retire_generate_tuesday_matches.sql:9` and the D3
migration's own provenance note. No `create table`, no `alter table`, no policy,
no grant. The table is a legacy object owned outside this repository's migration
chain, and `payments.unlock_status` / `unlock_triggered_at` / `unlock_failed`
appear nowhere else in the tree.

**Closed by:** nothing, on purpose. The D3 migration reads `connect_unlocks`
only. It is **not** rewritten to read `payments`, because doing so would have to
invent the purpose/recipient mapping that the capture says is missing — the one
thing the brief and the stop condition both forbid.

**Consequence for historical purchases:** live `payments` rows cannot authorize
a reveal under D3. Any legacy Connect purchase recorded only there stays
unrevealable after this change until the owner decides refund/retirement — which
is already open item 2 of [OWNER_DECISIONS_SECTION2_CONTACTS.md](OWNER_DECISIONS_SECTION2_CONTACTS.md).

### Finding F — Section 2 tables have RLS, policies still unverified

**Reported:** RLS enabled on `section2_responses` and
`section2_chat_progress`; the response-reading policy references `matches` and
admits `matched` or `interested` states; progress policies let participants
select and update.

**Establishes:** row access is relation-scoped, and the live response policy
treats `interested` as sufficient — a one-sided expression of interest, not a
match.

**Closed by:** 120000 stage 3, which replaces the policies wholesale (drops every
existing policy by name from `pg_policies`, so a live policy cannot linger) with
own-or-`is_section2_partner` reads and own-row writes.

**Open sub-decision:** the helper's `matches` leg currently requires
`m.status = 'active'`. The chain's own `CHECK` admits
`active|unmatched|pending|interested|discarded|matched|ghosted`, and the live
policy reportedly admits `matched`. If live rows are written as `matched`, an
`'active'`-only predicate denies **every** live matched pair its Section 2
reads. Two candidate allowlists:

- `('active', 'matched')` — what I recommend: both are two-sided match states,
  and including `matched` cannot widen beyond the live policy that already
  grants it.
- `('active')` as written — narrowest, but risks breaking the feature on live.

Either way `interested` is deliberately excluded: it is one-sided, and D2 says
an eligible partner is a match, not an expression of interest. That is a
narrowing relative to the live policy, so it cannot widen access.

---

## 3. The lineage verdict

Every finding is explained by one statement: **`minglemate-staging` is not the
output of this repository's migration chain.** (`E0` — an inference that fits all
six findings; the capture in section 6 would confirm or refute it.)

| Reported live fact | In the repository chain? | Where |
|---|---|---|
| `users` has table-wide `SELECT` for `anon`/`authenticated` | the chain exists specifically to remove exactly that, and says so | `20261014150000...:2041-2042`, comment "E1: the live project's grants … are TABLE-WIDE (F4)" |
| `users` has no `share_*` | chain adds them if missing | `:785-789` |
| `connect_unlocks` absent | chain creates it | `:922` |
| `payment_intents` absent | chain creates it | `:302` |
| `user_blocks` absent | chain creates it | `:492` |
| `conversations` absent | chain creates it | `:955` |
| `trg_auto_contact_reveal` / `handle_contact_reveal` present | chain never creates them; the 2026-10-15 chain dump does not contain them either | only dropped by `20261021120000...` |
| `payments(match_id, unlock_status, …)` present | chain never creates `payments` at all | no `create table` in the tree |
| `section2_responses` present with `matches`-based policy | chain never creates the table (provider-created) | documented as provider-created in `BACKUP_PREFLIGHT_REPORT.md` |

Two rows are the proof that this is a *lineage* problem rather than a missing
patch:

- the chain's comment **already names** the live condition it is there to fix
  ("the live project's grants … are TABLE-WIDE") — the condition predates the
  chain and has survived it, and
- `public.payments` is a live object the chain neither creates nor drops, so the
  chain's own author treated live as having objects outside the chain.

The chain also contains convergence stages for pre-existing tables
(`matches`, `conversations` — e.g. `:969` "Convergence for databases that
already had a conversations table"), which is evidence it was written to be
applied *onto* an existing database rather than only to a fresh one. That is
evidence of intent (`E1`), not proof that applying it to `minglemate-staging`
will succeed.

---

## 4. What this does to the two pending migrations

**Nothing is rewritten.** Reasons, in order of weight:

1. Both are written against the **post-chain** schema, and the chain is the
   artifact the repository owns (`E2`). Rewriting them against `payments` would
   encode a legacy table the chain does not manage and cannot verify.
2. The D3 body's paid-pair source (`connect_unlocks`) is the one shape the
   repository, the 2026-10-15 chain dump and the earlier live observation all
   agree on. `payments` has no purpose column, so substituting it would mean
   guessing.
3. Their Stage 0 preflights already do the right thing on the captured live
   schema: they **abort before changing anything** and name the missing objects.
   A fail-safe abort is the correct behaviour for a security migration meeting
   an unexpected schema — not a defect to route around.

What *is* added is a declaration of the precondition, so an operator cannot
apply either file to a pre-chain database and read the abort as a bug:

```
-- MUST RUN AFTER 20261014150000
```

(Task-level, in both files' headers.)

The one consequence to state plainly: **Finding C is not fixed until the schema
question is settled.** The 14-question reveal stays live until 120000 can pass
its own preflight.

---

## 5. The decision this creates (owner, Class 3)

Both paths are migrations; neither is a cosmetic choice.

| | Path A — bring live to the chain | Path B — write live-specific migrations |
|---|---|---|
| Shape | Apply `20261014150000_consolidated_schema_chain.sql` (or the reconciled subset it needs) to `minglemate-staging`, verify, then apply 120000 → 130000 | Leave live's legacy schema, write a new migration set against `payments(match_id, …)` + the absent `share_*`, and keep the repo chain for fresh rebuilds |
| Matches deployed code? | Yes — `initiate-payment` already writes `payment_intents`, the chat RPCs already call `get_unlocked_contacts`, `Section2.jsx` already upserts `section2_responses` | No — a second schema lineage to maintain, and `initiate-payment` would still be broken unless also changed |
| Consent (Finding B) | Solves it (`share_*` added) | Needs the columns added anyway; then it is Path A with extra steps |
| Contact exposure (A) | Solves it (grants + `display_phone` revoke) | Needs the same two `revoke all on table` statements |
| Legacy `payments` | Untouched; rows keep their meaning, none deleted | Same |
| Risk | The chain is large and must be applied to a database that already diverged; a dry run is required | Higher long-term: two schemas, and the repo's guards no longer describe production |
| Blocked on | A capture proving the chain applies (or the diffs that block it) | The payment-purpose mapping, which does not exist in either schema |

**Recommendation (`E0`, stated as a recommendation, not a finding):** Path A.
The deployed code already targets the chain's objects, so Path B means
maintaining a schema the application does not use. The chain also already
contains the two fixes findings A and B need.

**What I will not do without an explicit decision:** apply, rewrite, or delete
anything on the strength of it.

---

## 6. What is still unverified, and what closes it

| Fact | Status | Closes it |
|---|---|---|
| Does `public.payments` actually lack a purpose/recipient column, and is `match_id` an FK to `matches(id)`? | `OWNER-REPORTED` list, not the constraint list | capture `10-payment-constraints` |
| Are `connect_unlocks` / `payment_intents` / `user_blocks` / `conversations` truly absent (the name search may have been scoped)? | `OWNER-REPORTED`, and the report itself calls it a strong hint rather than proof | capture `1-columns` + `0b-connect-candidates` |
| Live `matches.status` values actually written, and the `CHECK` that admits them | not established | capture `1b-matches-status-enum` |
| Live `users` policies/grants, including `relforcerowsecurity` and whether `display_phone` is granted | `OWNER-REPORTED` summary only | capture `9b-users-access` |
| Whether the chain applies cleanly to `minglemate-staging` | not established, and not answerable from the repository | a dry run on a copy, after the capture |
| Whether `get_unlocked_contacts` exists live at all | conflicting: name search found nothing, an earlier investigation observed it | capture `7-functions`, `7b-function-overloads`, `7c-contact-function-bodies` |

The capture file is unchanged by this turn: it already covers every row above,
and re-issuing the same request is what the brief forbids. What changed is that
its output now has a named destination — this table — and a decision attached to
it.

---

## 7. Verification performed for this reconciliation

- `E2` — every chain citation above was read from
  `supabase/migrations/20261014150000_consolidated_schema_chain.sql` and
  `20261019190000_retire_generate_tuesday_matches.sql`, and every "chain never
  creates it" claim was checked with `grep -rn "public\.payments" supabase/`
  (two comments, no DDL).
- `E2` — client impact of the `users` grant change was checked by enumerating
  every `.from('users')` call in `src/` (12 call sites, all column-named except
  the `my_profile()` RPC path).
- `E3` — `node scripts/verify-section2-contact-rules.mjs` and `npm run verify`
  were re-run after this document was added, with the new reconciliation checks
  described in section 8.

Not performed, and not claimed: any query against the project database, any
migration application, any deployment.

---

## 8. What the guard now enforces

`scripts/verify-section2-contact-rules.mjs` gained four checks, so this analysis
cannot rot silently:

1. this file exists and covers findings A–F;
2. it records the lineage verdict with the decisive facts (no `public.payments`
   DDL in the tree; the four chain-created tables);
3. neither pending migration is rewritten against the legacy `payments` shape;
4. both pending migrations declare `MUST RUN AFTER 20261014150000`.

---

## 9. Ordered next actions

1. **Owner decides Path A or Path B** (section 5). Everything below assumes A.
2. Record the capture into [LIVE_SECTION2_SCHEMA.md](LIVE_SECTION2_SCHEMA.md)
   (one row, one JSON cell) — this now also settles whether the "tables absent"
   report was a search artifact.
3. Dry-run the chain against a copy of live; list every conflicting object.
4. On the dry run: apply chain → 120000 → 130000; verify triggers gone
   (`8-triggers`), contact columns unreadable (`9b-users-access`), and
   `connect_unlocks.phone` not selectable by `authenticated`.
5. Re-run the full suite, then the live checks in Step 8 of the brief.
6. Separately decide the two sub-questions: the `matches.status` allowlist, and
   refund/retirement of legacy `payments` rows.
