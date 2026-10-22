# Live Section 2 schema — CAPTURED

**Status: CAPTURED (live) — read-only, 2026-10-22, against project
`ifiewinipbxxfvzpzezd` (`minglemate-staging`).** Every fact below was read
from the catalog through the Supabase read-only SQL endpoint
(`supabase_read_only_user`); no statement wrote anything. The owner-reported
subsets that follow are kept for provenance and because they are the reason
for the correction in this section: they describe a **different project** in
the same organization, not this target.

## Captured live evidence — 2026-10-22 (the target)

| Fact | Captured value |
|---|---|
| Project | `ifiewinipbxxfvzpzezd` · `minglemate-staging` · eu-west-1 · Postgres 17.6.1.166 · status ACTIVE_HEALTHY |
| `connect_unlocks` | present — `id, buyer_id, seller_id, tier, amount, payment_intent_id, phone, whatsapp_number, email, social_instagram, social_x, social_tiktok, created_at`; `UNIQUE(buyer_id, seller_id)`; 0 rows |
| `payment_intents` | present — `id, user_id, phone, amount, status, checkout_request_id, mpesa_transaction_id, created_at, callback_key, purpose` (default `'section2'`), `recipient_user_id`; 0 rows |
| `user_blocks` | present — `blocker_id, blocked_id, created_at`; 0 rows |
| `conversations` | present — `user_a_id, user_b_id, match_tier, status, locked_at, created_at` |
| `users.share_*` | present — `share_phone`, `share_whatsapp`, `share_social_*` default true; `share_email` default false |
| `section2_responses` | present — `id, user_id, question_number, answer_text, created_at`; `UNIQUE(user_id, question_number)`; 0 rows |
| `section2_chat_progress` | present — `user_id_a, user_id_b, questions_discussed, contacts_unlocked, last_question_sent, created_at, updated_at, last_bot_question_at, is_archived`; 0 rows |
| `match_history` | present — `user_id, week_id, tier1_match_id, tier2_match_id, …`; 4 rows |
| `matches` | present — `user_a_id, user_b_id, status, is_visible, …`; 2 rows, both `status = 'matched'`; `matches_status_check` admits `pending, interested, discarded, matched, ghosted` — **no `'active'`** |
| `get_unlocked_contacts(uuid)` | exactly one overload; `TABLE(phone, whatsapp_number, email, social_instagram, social_x, social_tiktok)`; SECURITY DEFINER; `search_path=public` |
| live reveal body | paid branch returns the snapshot **without** reading `share_*`; second branch returns live contact values when the pair's `contacts_unlocked` is true and `users_are_paired()` passes |
| `get_match_contact(uuid)` | present; returns `display_phone, phone, whatsapp_number, email` when either side holds `section2_unlocked` or a live trial |
| `users_are_paired(uuid,uuid)` | present; `match_history` either direction, or `matches.status = 'active'` |
| `complete_connect_unlock(uuid)` | present; requires a succeeded intent and `users_are_paired()`, then writes the share-filtered snapshot |
| reveal triggers | `trg_contacts_unlocked` (BEFORE INSERT OR UPDATE → `enforce_contacts_unlocked`), `trg_auto_contact_reveal` (BEFORE UPDATE → `handle_contact_reveal`) |
| `users` grants | **no table-level SELECT** for `anon`/`authenticated`; SELECT is column-scoped and excludes `phone`, `whatsapp_number`, `email`, `display_phone`, `social_*` |
| `connect_unlocks` grants | full `arwdDxtm` to `anon` and `authenticated` — every snapshot column is directly selectable |
| live `section2_responses` SELECT policy | `Users can read matched section2 responses` (roles `{public}`), admits `matches.status IN ('matched','interested')` |
| migration history | only `20260927120000 social_share_toggles` is recorded |

**What the capture refutes.** Findings A–F (below) were taken against the
organization's other project, `minglemate` (`mhdjnhiqahsllbczbzpk`). That
project has no `connect_unlocks`, `payment_intents`, `user_blocks` or
`conversations`, no `users.share_*` columns, a legacy
`payments(match_id, unlock_status)`, and an empty migration history. None of
those absences is true of the target, so they are not used by either pending
migration.

**What it settles for the migrations.**

- Both Stage 0 preflights pass on this schema: every table, column, function
  overload and role they assert was read back.
- `is_section2_partner()` admits `('active','matched')` because this schema
  cannot store `'active'` and every live pair is `'matched'`. `'interested'`
  stays excluded: it is one-sided (D2), narrower than the live policy.
- The D3 replacement is required, not optional: the live function ignores
  consent and keeps the 14-question free branch. Its signature matches, so
  `create or replace` is safe.
- Stage 2b of the D3 file is required: `connect_unlocks` currently lets a
  buyer read their own snapshot columns directly.

**What the capture exposed, and what was fixed.**

- `matches` records the two live pairs as `'matched'`, while
  `users_are_paired()` and `complete_force_connect()` assumed the chain's
  `'active'` label and a `tier`/`created_by` column this table does not have.
  Both were replaced and applied on 2026-10-22 in
  `20261022130000_fix_force_connect_and_pairing_status.sql`, which is the
  repository record of the live definitions: the predicate now accepts
  `('active','matched')`, and Force Connect writes the live `matches` shape and
  is idempotent per pair.
- Migration history was behind the schema: the chain's objects existed, but
  only `20260927120000` was recorded. The four migrations since —
  `20260927120000`, `20261021120000`, `20261021130000`, `20261022130000` — are
  now recorded; the chain file itself still is not, so a CLI `db push` would
  try to replay it. Applying files by explicit SQL and recording versions is
  the safe path.

## Historical: owner-reported subsets (superseded — different project)

Recorded verbatim below, marked `OWNER-REPORTED`, because the correction
above is only meaningful next to them.

## Owner-reported live evidence — 2026-10-22

Reported by the owner against `minglemate-staging`. Not independently
re-verified by this repository; treat as testimony, not artifact.

**Confirmed present** (`OWNER-REPORTED`):

- `public.section2_responses` — columns `id`, `user_id`, `question_number`,
  `answer_text`, `created_at`. The report lists these five; it does not claim
  the list is exhaustive.
- `public.section2_chat_progress` — columns `user_id_a`, `user_id_b`,
  `questions_discussed`, `last_question_sent`, `contacts_unlocked`,
  `created_at`, `updated_at`, `last_bot_question_at`, `is_archived`.
- Roles `anon`, `authenticated`, `service_role`; function `auth.uid()`.
- A name search for tables containing `unlock`, `payment` or `match` returned
  exactly: `match_behavior`, `match_history`, `match_interactions`,
  `match_queue`, `match_signals`, `matches`, `payment_prompts`, `payments`.

**Not established — mark `UNKNOWN`, do not read as absence:**

- `public.connect_unlocks`, or any other object that records which pair a
  successful Connect payment covered and the contact snapshot it bought.
  `connect_unlocks` contains the substring `unlock`, so the search above would
  have returned it if it were a table in the searched schema. It did not. That
  is a strong hint, **not proof**: the search may have been scoped to one
  schema, to `BASE TABLE`s, or to a different name pattern. It remains
  `UNKNOWN`.
- `payment_intents` / `payments` columns and constraints beyond the four named
  in the second report (
  [below](#owner-reported-live-evidence--2026-10-22-second-report)), and
  therefore whether a Connect purchase can be told apart from any other payment
  on the same match.
- Columns of `match_history`, `matches`, `user_blocks`; the `matches.status`
  labels.
- Existence of `users_are_paired(uuid, uuid)`, `complete_connect_unlock(...)`,
  `get_unlocked_contacts(uuid)`, `get_match_contact(uuid)`.
- Whether `users.share_phone|share_whatsapp|share_email|share_social_*` exist.
- The `(user_id, question_number)` unique constraint on `section2_responses`.
  This is a functional dependency, not a migration one: `Section2.jsx` calls
  `upsert(..., { onConflict: 'user_id,question_number' })`, which fails without
  it. It is in the capture's `2-constraints` section.
- All live RLS flags, policy names and expressions, table and column grants,
  triggers and function bodies.

## Owner-reported live evidence — 2026-10-22, second report

Same provenance: testimony from the owner's own ad-hoc queries against
`minglemate-staging`, not a stored artifact. It narrows the blocker without
closing it.

**Confirmed present** (`OWNER-REPORTED`):

- Contact details are stored in **`public.users`** (`phone`,
  `whatsapp_number`, `email`). The reveal therefore also depends on who may
  `SELECT` those columns — a grant question, not only a function question.
- **`public.payments` has a `match_id` column**, plus a `status` column with an
  observed value `completed` and an `unlock_status` column with an observed
  value `pending`. This is the first reported object that links a payment to a
  specific match — the shape D3 needs, if `match_id` is a foreign key to
  `matches(id)` and if a Connect purchase is distinguishable from other
  purchases on the same table.
- A search of `pg_proc` for function names matching `%unlocked_contact%` or
  `%match_contact%` returned **no rows**.

**The two findings that need care**

1. **The app calls a function that the search did not find.**
   [Chat.jsx](../src/pages/Chat.jsx) and
   [MatchDetail.jsx](../src/pages/MatchDetail.jsx) call
   `rpc('get_unlocked_contacts')`. An empty result for that name pattern is
   consistent with "the RPC fails and no contact is ever revealed today", but
   it is **not proof**: the search is a name ILIKE, a narrowed or filtered
   query can miss rows, and the earlier investigation did observe a
   `get_unlocked_contacts` body live. Treat the live function as `UNKNOWN` and
   settle it from the catalog: `7-functions`, `7b-function-overloads`, and the
   new `7c-contact-function-bodies`, which searches function **bodies** so a
   differently-named reveal path still shows up.
2. **`status = 'completed'` with `unlock_status = 'pending'`.** On the one row
   the owner inspected, a completed payment did not carry an unlocked state.
   Either `unlock_status` is vestigial, or the historical path never granted the
   unlock it was paid for. Both readings mean the same thing here: entitlement
   must be derived from the payment **and its pair**, never from
   `unlock_status`, and the historical-payment path must keep settling without
   being redefined by this change.

**Consequence for the two pending migrations**

| Migration | Cleared by the owner report? |
|---|---|
| `20261021120000_section2_free_access_and_contacts.sql` | **Partially.** Its Stage 0 Section 2 table checks are satisfied by the two column lists above. It still asserts `match_history(user_id,tier1_match_id,tier2_match_id)`, `matches(user_a_id,user_b_id,status)` and `user_blocks(blocker_id,blocked_id)`, which the owner has not reported — those remain unverified. |
| `20261021130000_section2_d3_contact_reveal.sql` | **No, but narrower.** `connect_unlocks` is still `UNKNOWN` and `users.share_*` / `users_are_paired` are still unreported. The second report adds a plausible alternative home for the paid pair — `payments(match_id, status, unlock_status)` — which the migration would have to be rewritten against, not merely enabled by. Its Stage 0 remains unsatisfied. |

Nothing here may be cited as the project database's current state, and a line
that says "observed" refers to the earlier investigation, not to a stored
capture.

## Owner-reported live evidence — 2026-10-22, third report (findings A–F)

Same provenance again: testimony from the owner's own queries against
`minglemate-staging`, this time a structured set of six findings. Still not a
stored artifact, so it is recorded as `OWNER-REPORTED` and nothing here is
promoted to live fact on its strength alone.

Summarised (the reconciliation, verdict by verdict, is
[SECTION2_LIVE_RECONCILIATION.md](SECTION2_LIVE_RECONCILIATION.md)):

- **A — `public.users` contact columns are readable.** Table-level `SELECT` for
  `anon` and `authenticated`, plus column grants on `display_phone`, `email`,
  `phone`, `whatsapp_number`; policies include an `authenticated … USING (true)`
  one. Permissive policies OR together, so the grant plus a permissive policy
  exposes those columns.
- **B — no `share_*` columns on `public.users`.** With the columns absent, the
  consent condition in D3 cannot be satisfied at all: `src/pages/Profile.jsx`
  defaults every flag to "shared" and writes columns that do not exist.
- **C — the 14-question reveal is live.** Triggers `trg_auto_contact_reveal →
  handle_contact_reveal()` and `trg_contacts_unlocked →
  enforce_contacts_unlocked()` on `section2_chat_progress`, both setting
  `contacts_unlocked` at `questions_discussed >= 14`, neither checking payment
  or consent.
- **D — `connect_unlocks`, `payment_intents`, `user_blocks`, `conversations`
  absent** from the inspected `public` schema.
- **E — `payments` cannot say what was bought.** Columns `id`, `user_id`,
  `intasend_invoice_id`, `amount`, `status`, `match_id`, `unlock_status`,
  `unlock_triggered_at`, `unlock_failed` — no purpose and no recipient, so a
  completed row cannot be attributed to Connect.
- **F — Section 2 has RLS**, with a response policy that references `matches`
  and admits `matched` or `interested`, and participant-scoped progress
  policies. RLS being on is not proof the expressions are right.

### What the third report changes

**The lineage verdict.** Every one of the six findings is explained by one
statement: the inspected schema is not the output of this repository's chain
(`E0` — an inference that fits all six, not an observation). The decisive
repository facts are that

- the chain **creates** `connect_unlocks` (`:922`), `payment_intents` (`:302`),
  `user_blocks` (`:492`) and `conversations` (`:955`), all reported absent, and
- the chain **never creates** `public.payments`, the one table reported present
  with a legacy shape (`grep -rn "public\.payments" supabase/` → two comments,
  no DDL), and
- the chain's own stage E1 exists to revoke exactly the table-wide `users`
  grants finding A re-observes, with a comment naming that live condition.

**Consequence for the two pending migrations**

| Migration | Effect of the third report |
|---|---|
| `20261021120000_section2_free_access_and_contacts.sql` | **Unchanged, and correct.** On the reported schema its Stage 0 aborts before any change and names `public.user_blocks`. That abort is the correct behaviour: making the block table optional would create `is_section2_partner()` without its block clause. Finding C's fix therefore **stays gated** behind the lineage decision — the 14-question reveal remains live until then. |
| `20261021130000_section2_d3_contact_reveal.sql` | **Not rewritten.** `public.payments` has no purpose/recipient column, so it cannot be the paid-pair evidence D3 needs, and substituting it would invent the mapping. Stage 0 keeps aborting on a schema without `connect_unlocks`. |

Findings A and B are **not** closed by either pending migration: the chain's
stage E1 fixes A, and the chain's `add column if not exists share_*` fixes B.
That is why the reconciliation recommends applying the chain before either
migration, and why it puts the choice to the owner.

**Still `UNKNOWN` after this report:** the `payments` constraints, whether the
absent-table search was scoped, the live `matches.status` values actually
written, `relforcerowsecurity` on `users`, whether the chain applies cleanly to
this database, and whether `get_unlocked_contacts` exists live at all (the second
report's name search and the earlier investigation disagree). All six are in the
capture's sections — the open question has not grown, only sharpened.

## Why this file exists, and the stop condition

Step 1 of the Section 2 brief requires the live objects (columns, RLS status,
policy names, grants, function bodies, triggers) to be recorded before a
migration is written. The file did not exist when the task began on 2026-10-21.

The 2026-10-15 dump reconciles the migrations against the **repository chain**,
not the live database. That is why the capture at the top of this file was
taken read-only from the target on 2026-10-22: it is now the authority for the
live objects, and the Step 2 stop condition for these two files is cleared.
Both files were applied to the target on 2026-10-22 in one transaction each,
with versions `20261021120000` and `20261021130000` recorded in
`supabase_migrations.schema_migrations`, after the capture below satisfied both
Stage 0 preflights. The verification output is in [GATES.md](../GATES.md).

## Provenance of the 2026-10-15 dump — what it is, and what it is not

- **File:** `audit-out/verify-2026-10-15/dumps/A.norm.sql` (386 KB, written
  2026-10-15 12:49), a `pg_dump --schema-only` from **PostgreSQL 17.6**. The
  same body set appears in `audit-out/verify-2026-10-15/40-schema-for-probes.txt`
  under `=== get_unlocked_contacts body ===`.
- **Source:** the **local Supabase stack** (`supabase start`, Docker) used by
  the 2026-10-15 verification audit, after `supabase/.temp/preconditions.sql`
  and the repository chain were applied to it. Evidence in the same directory:
  `18-step5a-dbstate.txt` prints `public tables present in the LOCAL db` with the
  same table list; `40-schema-for-probes.txt` quotes `preconditions.sql`, whose
  header reads `-- LOCAL ONLY — scratch, never applied to a deployed project.`;
  `19-dump-before-reset.txt` records the pre-reset local dump and
  `20-step5a-db-reset.txt` shows the local reset applying the chain.
- **Proof it is not the project database** (three independent differences):
  1. It lacks `handle_contact_reveal()` and `trg_auto_contact_reveal`, which the
     earlier investigation observed **live** on
     `section2_chat_progress`.
  2. It lacks `public.section2_responses` entirely, while
     `src/pages/Section2.jsx` reads and upserts that table.
  3. Its `get_unlocked_contacts` is an **older chain revision** than the current
     `20261014150000_consolidated_schema_chain.sql`, whose stage 8f is already
     `PAID ONLY (F1)`; the dump still has the 14-question legacy branch.

**Conclusion:** it records what `preconditions.sql` + the chain of that date
produced locally. It can reconcile the migrations against the deployment path.
It cannot establish any live object, grant, policy or body.

## Offline reconciliation — fact by fact

| # | Required fact | Evidenced by the 2026-10-15 chain dump | Live |
|---|---|---|---|
| 1 | Columns of `section2_chat_progress` | `id uuid`, `user_id_a uuid`, `user_id_b uuid`, `questions_discussed integer DEFAULT 0`, `contacts_unlocked boolean DEFAULT false`, `created_at timestamptz` — all four Stage 0 columns present | `OWNER-REPORTED`: all four Stage 0 columns named exist. Types, defaults and the policy surface are still `UNKNOWN` |
| 2 | Columns of `section2_responses` | **Absent from the dump**: the chain never creates it (provider-created, per `BACKUP_PREFLIGHT_REPORT.md`), so the dump has no columns, policies or grants for it | `OWNER-REPORTED`: table exists with `id, user_id, question_number, answer_text, created_at` — the three columns the policy stage names are all present. RLS/grants `UNKNOWN` |
| 3 | Columns of `connect_unlocks` | `id`, `buyer_id`, `seller_id`, `tier`, `amount`, `payment_intent_id`, `phone`, `whatsapp_number`, `email`, `social_instagram`, `social_x`, `social_tiktok`, `created_at`; `CHECK (buyer_id <> seller_id)`; `CHECK (tier IN ('tier1','tier2','qrashe'))`; `UNIQUE (buyer_id, seller_id)`; FKs to `users` | **`UNKNOWN`** — existence itself is not established. The owner's name search did not return it (see above); `payments` did. Until a capture proves the paid pair is recorded somewhere, **D3 cannot be applied** |
| 4 | RLS status and every policy on both Section 2 tables | RLS **enabled** on `section2_chat_progress`; policies `progress_select_participants`, `progress_insert_participants`, `progress_update_participants`, all participant-scoped (`user_id_a = auth.uid() OR user_id_b = auth.uid()`). No `section2_responses` table, therefore no policies for it | **NOT CAPTURED** (live policy names/expressions, and `relforcerowsecurity`) |
| 5 | Table/column grants for `anon`, `authenticated`, `service_role`, `PUBLIC` | `GRANT ALL ON TABLE` to **`anon`, `authenticated` and `service_role`** on both `section2_chat_progress` and `connect_unlocks` (no column-level grants there, so RLS alone constrains rows). `users` carries the chain's column-scoped grants. `get_unlocked_contacts`: `REVOKE ALL … FROM PUBLIC`, grants to `authenticated` + `service_role` | **NOT CAPTURED** — live grants may differ, and an `anon` table grant matters wherever RLS is off or bypassed. The D3 migration now revokes SELECT on the six snapshot contact columns and grants `authenticated` only `id, buyer_id, seller_id, tier, created_at` |
| 6 | `get_unlocked_contacts(uuid)`: existence, body, grants | Exists with the six-column `TABLE` signature; body is the **older** revision (paid snapshot **or** 14-question legacy branch); ACL as in row 5 | **NOT CAPTURED**; an earlier live search did not find it (not proof of absence) |
| 7 | `get_match_contact(uuid)`: existence and grants | Exists, returns `TABLE(display_phone, phone, whatsapp_number, email)`, granted to `anon`, `authenticated` and `service_role` | **NOT CAPTURED** |
| 8 | `users.share_*` columns | `share_phone`, `share_whatsapp`, `share_email`, `share_social_instagram`, `share_social_x`, `share_social_tiktok`, all `boolean NOT NULL` (`share_email` defaults `false`, the rest `true`) | **NOT CAPTURED** |
| 9 | Trigger inventory on `section2_chat_progress`; contact triggers elsewhere | `trg_contacts_unlocked` BEFORE INSERT OR UPDATE → `enforce_contacts_unlocked()`; `entitlement_evidence_section2_chat_progress` AFTER INSERT OR UPDATE → `record_entitlement_evidence()`. **No** `trg_auto_contact_reveal`/`handle_contact_reveal` (live observed them). No contact-related trigger on `connect_unlocks` or `users` beyond the entitlement-evidence one | **NOT CAPTURED** — live may attach the reveal at more points |
| 10 | `connect_unlocks` buyer/seller/payment constraints; `payment_intents.purpose` | `UNIQUE (buyer_id, seller_id)`; `payment_intents_purpose_check` allows `section2`, `connect_tier1`, `connect_tier2`, `connect_qrashe`, `force_connect`; `payment_intents_status_check` allows `pending`, `succeeded`, `failed`, `expired` | **NOT CAPTURED** |
| 11 | Columns of `match_history`, `matches`, `user_blocks`; `matches.status` labels | `match_history(user_id, tier1_match_id, tier2_match_id)`; `matches(user_a_id, user_b_id, status text DEFAULT 'active' NOT NULL, tier, …)` with `CHECK (status IN ('active','unmatched','pending','interested','discarded','matched','ghosted'))`; `user_blocks(blocker_id, blocked_id)` | **NOT CAPTURED** |
| 12 | Roles and `auth.uid()` | `auth.uid()` exists (`COMMENT … 'Deprecated. Use auth.jwt() -> ''sub'' instead.'`); ACLs name `anon`, `authenticated`, `service_role`, so they exist in the local stack | `OWNER-REPORTED`: all three roles and `auth.uid()` exist |
| 13 | Any live `is_section2_partner(uuid, uuid)` / `pin_section2_contacts_flag()` | **Absent** — both are introduced by this change set | **NOT CAPTURED**; a non-boolean live `is_section2_partner` would fail `CREATE OR REPLACE` (safe abort) |

## What the reconciliation confirms, and what it cannot

Confirmed against the deployment path (and therefore the assumptions both
migrations encode):

- Stage 0's required columns on `section2_chat_progress`, `match_history`,
  `matches`, `user_blocks` exist exactly as named.
- `matches.status` accepts `'active'`, so the `matches` leg of
  `is_section2_partner()` can match.
- `connect_unlocks` has every column the D3 preflight and body name, plus a
  unique `(buyer_id, seller_id)` key, so "that specific match" is well defined.
- `users` has all six `share_*` columns the D3 body reads.
- `get_match_contact(uuid)` exists in the deployment path with grants to
  `anon`, which is why D5 revokes before dropping.
- The chain's own Section 2 progress policies are participant-only and are
  replaced wholesale by the base migration.

Cannot be established from it:

- Whether `public.section2_responses` exists live, and with which columns,
  policies and grants — the table the D2 response policy is written for.
- The live policy names/expressions and `relforcerowsecurity` on either table,
  and the live table/column grants for the client roles.
- The live `get_unlocked_contacts` body, signature and ACL — the whole point of
  item 6. Two revisions are evidenced (the older chain in the dump, the current
  chain in the repository); the live one may be either or neither.
- The live trigger inventory, including whether the reveal is attached at
  additional points beyond the two observed names.
- The live `payment_intents` constraints and roles.

## Item 6 — the body D3 replaces (evidenced, not captured live)

Signature and ACL are the same in both evidenced revisions:

```sql
public.get_unlocked_contacts(other_user_id uuid)
  RETURNS TABLE(phone text, whatsapp_number text, email text,
                social_instagram text, social_x text, social_tiktok text)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- REVOKE ALL ... FROM PUBLIC; GRANT ... TO authenticated, service_role;
```

**Older revision** (dump, `A.norm.sql` lines 1879–1918): paid snapshot first,
then a legacy branch returning live contact values when
`section2_chat_progress.contacts_unlocked` was true.

**Current revision** (`20261014150000_consolidated_schema_chain.sql`, stage 8f
"Contact reveal — PAID ONLY (F1)"): the legacy branch is gone and the caller
must be paired, but the paid branch still returns the snapshot without
consulting the owner's current `share_*` choice:

```sql
select * into unlocked from public.connect_unlocks cu
where cu.buyer_id = me and cu.seller_id = other_user_id;
if found then
  return query select unlocked.phone, unlocked.whatsapp_number, unlocked.email,
    unlocked.social_instagram, unlocked.social_x, unlocked.social_tiktok;
end if;
```

Under the older revision D3 fails twice (free reveal, ignored consent); under
the current one it fails once (ignored consent). The D3 migration replaces
either, keeps the current revision's pairing guard so the result is never
wider, and aborts if the live return type differs.

## Verification performed

- **Executed** `20261021130000_section2_d3_contact_reveal.sql` on PGlite
  (PostgreSQL compiled to WebAssembly) with a stubbed `auth.uid()`,
  `users_are_paired()` and `anon`/`authenticated` roles — **15/15 checks**:
  idempotent apply; SECURITY DEFINER + `search_path`; no Section 2 input in the
  stored body; ACL; snapshot contact columns unreadable directly by the client
  roles while `id` stays readable; paid row + consent reveals shared channels; `share_email`
  false hides email; withdrawn consent hides only that channel; paid row with
  no pairing reveals nothing; completed progress with no payment reveals
  nothing; another user's purchase reveals nothing; drifted return type aborts
  before any change.
- This proves the SQL parses and enforces D3 on a real Postgres engine. It does
  **not** prove the project database matches, and it is not a live test.

## The single missing fact

**Which live object records a successful Connect payment against the specific
pair — and can a Connect purchase be told apart from any other purchase on it?**

The owner's second report makes this question concrete and small:

- If the answer is `public.connect_unlocks` with the eleven columns in row 3,
  D3 is applicable as written.
- If the answer is `payments(match_id, status, …)`, D3's body and preflight must
  be **rewritten** against that shape: `payments.match_id` must resolve to a
  pair (`matches.user_a_id/user_b_id`), and a Connect purchase must be
  distinguishable from every other payment row — otherwise a non-Connect
  payment for the same match would grant contact details, which the brief
  forbids. The migration must not invent `connect_unlocks`.
- If both exist, `payments` is the payment of record and `connect_unlocks` holds
  the snapshot; D3 then needs to say which one is authoritative.
- If neither can express it, **D3 cannot be implemented as specified** and that
  gap goes back to the owner: the brief forbids weakening the
  pair-plus-consent rule (or substituting `unlock_status`, which the second
  report shows can stay `pending` on a completed payment) to make a migration
  pass.

A second question is independent of the first and matters just as much: **can
the client roles read `users.phone` / `users.whatsapp_number` / `users.email`
directly?** If a permissive `users` policy plus a column grant lets
`authenticated` select them, contacts are exposed whatever any reveal function
does, and that is a live finding to fix rather than a migration detail. Neither
question is answerable from this repository.

## How to close this file and unblock application

One action, one query, one row:

1. Supabase dashboard → project `minglemate-staging` → **SQL Editor** → **New
   query**.
2. Paste the whole of [`supabase/sql/capture_section2_contacts_state.sql`](../supabase/sql/capture_section2_contacts_state.sql). It
   is a single read-only `SELECT` over catalog views; it returns one row with
   one `section2_capture` JSON cell. (The earlier multi-statement version is
   why only the last result set was visible — the editor renders only the final
   one.)
3. Run it, copy the JSON cell, and paste it back.

Then compare each section with the reconciliation above and, in particular:

- `0b-connect-candidates` — this decides [the single missing fact](#the-single-missing-fact).
  It matches both by name (`unlock|connect|contact|reveal|purchase`) and by
  column shape (`buyer_id`, `seller_id`, `payment_intent_id`, `match_id`,
  `whatsapp_number`, `social_instagram`) in every non-system schema, so a
  differently-named join table still appears (`match_id` was added after the
  owner reported `payments.match_id`).
- `9b-users-access` — whether the contact columns themselves are readable by
  `anon`/`authenticated`: the `users` RLS flag, every policy on it, table
  grants, and the column grants naming phone/whatsapp/email/social/share.
- `7c-contact-function-bodies` — functions whose **body** mentions a contact
  token, i.e. the reveal path that the name search missed.
- `1-columns` / `1b-partner-columns` / `9-share-columns` — rows 1–3 and 8, 11.
- `3-rls-status`, `4-policies`, `5-table-grants`, `5-column-grants` — rows 4–5.
- `6-function-grants`, `7-functions`, `7b-function-overloads` — rows 6, 7, 13,
  and any second reveal path.
- `8-triggers`, `8b-contact-triggers` — row 9.
- `10-payment-constraints` — row 10.
- `11-platform` — row 12.

The capture sections named here are recorded at the top of this file: every
one of them was read back on 2026-10-22, so the base migration's header changed
from evidence-blocked to captured-but-not-applied, and the D3 file's Stage 0
assertions are all satisfied on the target. Application itself remains an
owner-authorized action.
