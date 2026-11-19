# Production ↔ Repository Parity Report — Matching Reliability

**Stage:** 3 of 4 (destination preparation and integration mapping)
**Revision:** 2 — reconciled against the complete supplied production evidence (evidence collection closed)
**Date:** 2026-11-19
**Repository:** `C:\Users\oboch\minglemate-release` · branch `release/account-deletion` · HEAD `0e2c6a7acaaeee0df4ad018234d024edfd6e4af0`
**Production project (evidence source, never connected to from this host):** `mhdjnhiqahsllbczbzpk`

**Decision: READY FOR REVIEW** — see §10. Behavioural parity is fully reconciled; the supporting-object unknowns of revision 1 are closed except two that do not affect the RPC text (§7). The migration text is to be authored from the itemised authoritative definitions supplied by the owner, not from guessed SQL; §2.3 records the one predicate that is fixed by the foreign-key evidence.

### Revision changelog (revision 1 → 2)

| Area | Revision 1 | Revision 2 | Why |
|---|---|---|---|
| `match_history` RLS policy | UNKNOWN (divergence suspected from `index.ts:35-37`) | **DIFFERENT — confirmed** | production policy returns `auth.uid() = user_id AND delivered_at <= now()` |
| `match_history` unique index | UNKNOWN | **MATCH** | production has `UNIQUE(user_id, week_id)`; chain has `match_history_user_week_uidx` |
| Fence-table RLS | UNKNOWN | **MATCH** | production: RLS enabled, no policies — identical to the chain |
| Sequence ACL | UNKNOWN | **DIFFERENT (low)** | production grants `service_role` sequence privileges; chain grants none |
| `week_id SET NOT NULL` safety | Risk R3, unquantified | **SAFE** | production holds 1 row, 0 NULL `week_id`, 0 NULL `delivered_at` |
| Activity predicate | UNKNOWN, "cannot be written" | **Constrained and confirmed** (§2.3) | FK delete rules establish exactly what the check must inspect |
| Activity tables in the chain | MISSING / structure UNKNOWN | **MISSING (confirmed), and now a data-loss risk, not just a parity gap** | cascade semantics (§4, §8) |

All revision-1 findings that remain valid are preserved verbatim in §4–§5; the six behavioural gaps D1–D6 and the three schema gaps D7–D9 are unchanged.

---

## 1. Execution baseline

| Item | Value |
|---|---|
| Working directory | `C:\Users\oboch\minglemate-release` |
| Branch | `release/account-deletion` — matches the expectation |
| HEAD | `0e2c6a7acaaeee0df4ad018234d024edfd6e4af0` — matches the expectation |
| Staged | none; no commits created |
| Tracked modifications (pre-existing, preserved) | `docs/releases/MATCHING_RELIABILITY_DEPLOYMENT_RUNBOOK.md`, `…RELEASE_MANIFEST.md`, `…RELEASE_REPORT.md`, `…ROLLBACK.md`, `scripts/test-matching-allocation.mjs`, `supabase/functions/match-generator/index.ts` |
| Untracked (pre-existing, preserved) | `docs/ACCOUNT_DELETION_RELEASE_PREPARATION_REPORT.md`, `docs/releases/MATCHING_RELIABILITY_PRODUCTION_PREFLIGHT.md`, `…PREFLIGHT_2.md`, `…PRODUCTION_LINEAGE_COMPATIBILITY.md`, `…PRODUCTION_READ_ONLY_VERIFICATION.md`, `docs/releases/prod-preflight.sql`, `docs/releases/production-lineage-migration-proposal/` |

Relevant migrations (immutable historical content, read only):

| File | SHA256 | Role |
|---|---|---|
| `supabase/migrations/20261118120000_match_generation_fencing.sql` | `f1955ef8…b687349` | sequence, fence table, `begin_match_generation`, original publisher (40001 form), ACLs |
| `supabase/migrations/20261119120000_match_publication_pt409.sql` | `6cfb272a…de510b` | publisher recreated with `PT409` verdicts, ACLs restated |
| `supabase/migrations/20261014150000_consolidated_schema_chain.sql:891-914` | (chain file, not the production lineage) | `public.match_history` in the repository chain |

Accepted Stage 1 findings preserved unchanged: source review **ACCEPTED**; `node scripts/test-matching-allocation.mjs` **80/80**; `node scripts/verify-matching-publication.mjs` **66/66**. No test was re-run for this revision — no source changed.

---

## 2. Production evidence inventory

### 2.1 RPC definitions (authoritative, supplied in full and itemised by the owner)

| Function | Established facts |
|---|---|
| `public.begin_match_generation(p_week_id text) → bigint` | PL/pgSQL, SECURITY DEFINER, owner `postgres`, **empty search path**, uses `public.match_generation_seq`, rejects null/empty week id, upserts `public.match_week_generations`, monotonic `latest_generation`, updates `updated_at`; ACL `{postgres=X/postgres, service_role=X/postgres}` |
| `public.publish_week_allocation(p_week_id text, p_generation bigint, p_rows jsonb) → jsonb` | PL/pgSQL, SECURITY DEFINER, owner `postgres`, **empty search path**; validates week id, generation, JSON array, required user ids and delivery timestamps; locks the generation record; unknown generation rejected; **future → `22023 invalid_generation`**; older → `PT409 stale_generation`; same-generation identical payload → replay without rewriting; same-generation different payload → `PT409 generation_conflict`; **locks the target week's `match_history` rows before the activity checks**; activity checked in `match_signals`, `match_behavior`, `tier1_interaction`, `tier2_interaction`; **activity present → `PT409 week_in_use`**; replaces only the target week; explicit `delivered_at`; updates publication metadata; returns count, generation, replay status; ACL `{postgres=X/postgres, service_role=X/postgres}` |

### 2.2 Supporting objects

| Object | Established facts |
|---|---|
| `public.match_history` (columns) | `id uuid NOT NULL default gen_random_uuid()`, `user_id uuid NULL`, `week_id text NOT NULL`, `tier1_match_id uuid NULL`, `tier2_match_id uuid NULL`, `tier1_interaction boolean NULL default false`, `tier2_interaction boolean NULL default false`, `delivered_at timestamptz NULL default now()` |
| `public.match_history` (constraints) | **`UNIQUE(user_id, week_id)`** |
| `public.match_history` (RLS) | enabled; `authenticated` SELECT only where **`auth.uid() = user_id AND delivered_at <= now()`** |
| `public.match_history` (data) | **1 row; 0 NULL `week_id`; 0 NULL `delivered_at`** |
| `public.match_signals` | exists; **FK to `match_history` with `ON DELETE CASCADE`**; ACL: broad table privileges, subject to RLS |
| `public.match_behavior` | exists; **FK to `match_history` with no cascade** (delete is refused, not propagated); **RLS enabled, no policies**; ACL: broad table privileges, subject to RLS |
| `public.match_week_generations` | **RLS enabled, no policies** |
| `public.match_generation_seq` | owned by `postgres`; grants `postgres` and **`service_role`** sequence privileges |

### 2.3 Activity predicate — confirmed

The predicate was revision 1's largest unknown. It is now fixed by the FK delete rules and the itemised definition:

```text
target rows := the match_history rows of p_week_id (already locked FOR UPDATE)

week_in_use is raised when ANY of the following is true:
  (a) a row in public.match_signals references any target row          -- i.e. its match_history FK value
  (b) a row in public.match_behavior references any target row         -- same linkage, different delete rule
  (c) any target row has tier1_interaction = true
  (d) any target row has tier2_interaction = true
```

Why the predicate cannot be anything else: the only column linkage the supplied evidence establishes between these tables and `match_history` is the foreign key in each activity table (`match_signals` cascades on delete, `match_behavior` does not). A week-scoped check that did not follow that linkage could neither protect the cascading rows nor prevent the non-cascading FK failure. The `tier1_interaction` / `tier2_interaction` arms come directly from the definition and from the production columns' existence with `default false`.

This is a reconstruction from authoritative facts, **not a quotation of the production body**. The migration author is expected to write it in this form; no other form is consistent with the evidence.

### 2.4 Deletion risks — confirmed

| # | Risk | Consequence without the check |
|---:|---|---|
| 1 | `match_signals` cascades from `match_history` | a plain `delete from public.match_history where week_id = p_week_id` **silently destroys user signal history**. Irreversible. This is the concrete reason the production publisher locks and inspects before replacing, and raises `week_in_use` instead |
| 2 | `match_behavior` does **not** cascade | the same delete raises a **foreign-key violation (23503)** and aborts the transaction. The Edge Function would report `500 publish_failed` with a raw FK message instead of a clean `409 week_in_use` |
| 3 | Both effects are invisible in development | a chain-built database has neither table (§4), so the destructive/failing path cannot be reproduced without them |

The repository chain — as it stands — has the **first** risk and the **second** failure mode, undetected by any local test, because the two activity tables do not exist in the chain at all.

### 2.5 Delivery-gate verification

The accepted Edge Function states that production releases matches by stamping `delivered_at` and that "match_history RLS only exposes rows whose `delivered_at <= now()`" (`supabase/functions/match-generator/index.ts:35-37`, and `releaseTimestamp()` selects 18:00 UTC). The supplied policy confirms the mechanism exactly: `auth.uid() = user_id AND delivered_at <= now()`. The chain's policy (`20261014150000…:907-911`) implements only the first half — so on a chain-built database, a published week is visible immediately, and the release-time behaviour the function was designed around does not exist. Confirmed **DIFFERENT**.

Corollary: with the production predicate, a row whose `delivered_at` is NULL is never visible to a client. Production has 0 such rows, consistent with `delivered_at NOT NULL` in practice though the column is declared nullable with `default now()`.

### 2.6 `week_id NOT NULL` migration safety

Production holds **1 row, 0 NULL `week_id`, 0 NULL `delivered_at`**, so `alter table public.match_history alter column week_id set not null` cannot fail on the production data set. On a *fresh* database built from the repository chain the table is created empty and the alteration is trivially safe. The only database that could fail is a long-lived local/chain instance that already holds rows with a NULL `week_id` — i.e. rows written by the interim generator under a lower-fidelity history, not by this release. Classification: **SAFE**, with a documented caveat rather than a blocker.

---

## 3. Function parity

### 3.1 `public.publish_week_allocation(text, bigint, jsonb)`

| # | Item | Production | Repository | Classification | Difference / action |
|---:|---|---|---|---|---|
| 1 | Signature, return type | `(text,bigint,jsonb) → jsonb` | `20261119120000…:20-25` | **MATCH** | — |
| 2 | Language, SECURITY DEFINER | PL/pgSQL, definer | `:26-27` | **MATCH** | — |
| 3 | Search path | empty | `set search_path = public` `:28` | **DIFFERENT** | redefine with `set search_path = ''`; all relation references already schema-qualified |
| 4 | validation: week id / generation / JSON array | validated | `22023` on null/empty week and null generation (`:30-35`); `p_rows` defaulted (`:31`) | **MATCH** (shape) | keep |
| 5 | validation: required user ids + `delivered_at` | validated per row | absent — `(r->>'delivered_at')::timestamptz` yields NULL for a missing key (`:84`) | **DIFFERENT** | add the per-row requirement; the production wording/errcode is not quoted, so the author must state the intent in the migration comment |
| 6 | generation record lock | locks the record | fence row `for update` `:36-41` | **MATCH** | preserve |
| 7 | unknown generation | rejected | `P0002 unknown_generation` `:44-46` | **MATCH** | preserve |
| 8 | future generation | `22023 invalid_generation` | **absent**; absorbed by `greatest(...)` `:95-98` | **MISSING** | add before the stale check |
| 9 | stale generation | `PT409 stale_generation` | `:53-55` | **MATCH** | preserve |
| 10 | replay / payload conflict | identical → replay, no rewrite; different → `PT409 generation_conflict` | `:60-71` | **MATCH** | preserve |
| 11 | history row locking | target-week rows locked before activity checks | **absent** — only the fence row is locked | **MISSING** | `select … from public.match_history where week_id = p_week_id for update`, before the activity check |
| 12 | activity checks | four sources (§2.3) | **absent** | **MISSING** | add per §2.3 |
| 13 | `week_in_use` | `PT409` / `week_in_use` | absent | **MISSING** | add; the verdict string is exact and is the contract with the accepted Edge Function |
| 14 | replacement scope, atomicity | target week only, atomic | `delete … where week_id` `:77` + insert `:79-86` | **MATCH** | preserve |
| 15 | explicit `delivered_at` insertion | yes | `:84` | **MATCH** | preserve; add validation (#5) |
| 16 | metadata update | yes | `:88-98` | **MATCH** | preserve |
| 17 | return values / SQLSTATEs | count, generation, replay; `22023`, `P0002`, `PT409`×3 | `:70`, `:100`, `:53`, `:60`, `:68` | **DIFFERENT** | two verdicts missing (#8, #13) |

### 3.2 `public.begin_match_generation(text)`

| # | Item | Production | Repository | Classification | Difference / action |
|---:|---|---|---|---|---|
| 1 | Signature, return | `(text) → bigint` | `20261118120000…:65-66` | **MATCH** | — |
| 2 | Language, SECURITY DEFINER | PL/pgSQL, definer | `:67-68` | **MATCH** | — |
| 3 | Search path | empty | `set search_path = public` `:69` | **DIFFERENT** | redefine with empty path; body already qualifies `public.match_generation_seq` (`:75`) and `public.match_week_generations` (`:79-83`) |
| 4 | Validation, sequence, monotonicity, `updated_at` | all confirmed | `:72-84` | **MATCH** | preserve |
| 5 | Owner + ACL | `postgres`; `{postgres=X, service_role=X}` | ACL statements `:178`, `:181` produce exactly that shape | **MATCH** | restate ACLs in the new migration |

---

## 4. Supporting object parity

| Object / aspect | Repository chain | Production | Classification |
|---|---|---|---|
| `match_history` existence | created at `20261014150000…:891` (chain file, not the production lineage) | exists | **MATCH** |
| `id` | `uuid primary key default gen_random_uuid()` `:892` | `uuid NOT NULL default gen_random_uuid()` | **MATCH** |
| `user_id` | `uuid references public.users(id) on delete cascade` `:893` | `uuid NULL` | **MATCH** on type/nullability; FK on production side not established (does not affect the RPCs) |
| `week_id` | `text` **nullable** `:894` | `text NOT NULL` | **DIFFERENT** — safe to align (§2.6) |
| `tier1_match_id`, `tier2_match_id` | `uuid` `:895-896` | `uuid NULL` | **MATCH** |
| `tier1_interaction`, `tier2_interaction` | **absent everywhere** (0 references in `supabase/`, `scripts/`) | `boolean NULL default false` | **MISSING** |
| `delivered_at` | `timestamptz`, no default `:897`, `:900` | `timestamptz NULL default now()` | **DIFFERENT** (default) |
| unique `(user_id, week_id)` | `match_history_user_week_uidx` `:902-903` | **present** | **MATCH** |
| RLS policy (`authenticated` SELECT) | `user_id = auth.uid()` **only** `:907-911` | `auth.uid() = user_id AND delivered_at <= now()` | **DIFFERENT** — the delivery gate is missing (§2.5) |
| table ACLs | `revoke all … from anon`; `revoke insert, update, delete … from authenticated` `:913-914` | not supplied | **UNKNOWN** (does not affect RPC parity) |
| `match_week_generations` | table + RLS enabled, no policies, client roles revoked, `select` to `service_role` (`20261118120000…:34-56`) | RLS enabled, **no policies** | **MATCH** (RLS state); column-level DDL not supplied, and the repository's own definition is what the RPCs require |
| `match_generation_seq` | sequence, client roles revoked, **no `service_role` grant** `:32`, `:49` | owner `postgres`, grants `postgres` **and `service_role`** | **DIFFERENT (low)** — a privilege the repository withholds. Harmless to the definer-owned RPCs; align for exactness |
| `match_signals` | **no DDL in the chain**; existence-guarded delete in account deletion (`20261116000000…:325-326`); shape unknown (test fixture only: `scripts/account-deletion-schema.sql:117-121`) | exists; FK → `match_history` **`ON DELETE CASCADE`**; broad ACL subject to RLS | **MISSING (confirmed)** |
| `match_behavior` | **no DDL in the chain**; existence-guarded delete (`:328-329`); fixture `scripts/account-deletion-schema.sql:106-112` | exists; FK → `match_history`, **no cascade**; RLS enabled, **no policies**; broad ACL subject to RLS | **MISSING (confirmed)** |
| Function ACLs | `revoke all … from public, anon, authenticated` + `grant execute … to service_role` (`20261118120000…:178-182`, `20261119120000…:109-110`) | `{postgres=X/postgres, service_role=X/postgres}` | **MATCH** |
| Qrashe `public.matches` | untouched by both migrations | not in scope | **MATCH** (no interaction) |

---

## 5. Confirmed differences

| # | Difference | Evidence |
|---:|---|---|
| D1 | Publisher `search_path` `public` → **empty** | `20261119120000…:28`; production definition |
| D2 | `begin_match_generation` `search_path` `public` → **empty** | `20261118120000…:69`; production definition |
| D3 | No future-generation rejection | `invalid_generation` appears nowhere in the repository; production raises `22023` |
| D4 | No `match_history` week-row lock | repository locks only the fence row `:36-41`; production locks target-week history rows |
| D5 | No activity protection, no `week_in_use` | 0 references to `match_signals` / `match_behavior` / interaction columns in repository SQL; production checks four sources (§2.3) |
| D6 | No per-row validation of user ids or `delivered_at` | `:77-88`; production validates both |
| D7 | `tier1_interaction` / `tier2_interaction` absent from the chain | 0 hits; production has both, `default false` |
| D8 | `week_id` nullable in the chain, `NOT NULL` in production | `:894`; production columns |
| D9 | `delivered_at` has no default in the chain, `default now()` in production | `:897`; production columns |
| **D10** | **`match_history` RLS policy has no `delivered_at <= now()` gate** | chain `:907-911`; production policy confirmed |
| **D11** | **No `service_role` grant on `match_generation_seq`** | chain `:32`, `:49`; production sequence privileges |
| **D12** | **`match_signals` and `match_behavior` are not represented in the chain at all — including their FK delete rules** | no DDL anywhere; production FK rules confirmed (§2.4) |

Not differences (explicitly checked): signatures, return types, PL/pgSQL, SECURITY DEFINER, fence locking, unknown/stale/conflict/replay semantics, week-scoped atomic replacement, explicit `delivered_at` insertion, metadata update, return shape, function ACLs, unique index, fence-table RLS state.

---

## 6. Integration map

### A. Correct — preserve without changes

| Object / file | Note |
|---|---|
| `supabase/functions/match-generator/index.ts` | maps `stale_generation` / `generation_conflict` / `week_in_use` to 409 (`:398-404`) and always sends `user_id`, `week_id`, both tier slots and `delivered_at` (`:347-359`). Production's new validation is satisfied by what it already sends — **no Edge Function change required** |
| `scripts/test-matching-allocation.mjs` | six publication outcomes (E14–E19), count-only logging (D10), mutation guard (C4). Accepted, unchanged |
| Fence table + RLS state `20261118120000…:34-56` | matches production's RLS-enabled / no-policy state |
| Replay, stale, conflict, replacement, metadata logic `20261119120000…:47-101` | reproduce verbatim |
| Unique index `match_history_user_week_uidx` | matches production's `UNIQUE(user_id, week_id)` |

### B. Missing — required integration absent

| Object | Change | Dependency | Reason |
|---|---|---|---|
| new migration: `public.match_history` | `add column if not exists tier1_interaction boolean default false`, same for `tier2_interaction` | must precede the publisher redefinition | D7 |
| new migration: `public.publish_week_allocation` | future-generation rejection; week-row lock; four-source activity check; `week_in_use`; per-row validation; empty search path | columns above; `match_signals` / `match_behavior` existing | D1, D3–D6 |
| new migration: `public.begin_match_generation` | empty search path | none | D2 |
| new migration: `public.match_history` | `alter column week_id set not null`; `alter column delivered_at set default now()` | safe (§2.6) | D8, D9 |
| new migration: `public.match_history` policy | recreate `match_history_select_own` with `auth.uid() = user_id AND delivered_at <= now()` | none | D10 |
| new migration: `match_generation_seq` | `grant usage, select on sequence public.match_generation_seq to service_role` | none | D11 |
| new migration (or explicit owner decision to exclude): `match_signals`, `match_behavior` | represent the two tables with their FK delete rules (`cascade` / no cascade) and RLS state | owner scope decision — they are legacy production objects | D12 |

### C. Conflicting — repository differs from production

| Object | Conflict | Action |
|---|---|---|
| `20261118120000…` / `20261119120000…` bodies | D1–D6 | **never edit**; supersede from the new migration |
| chain `match_history` definition | D8, D9, D10 | correct forward-only; the historical chain file stays untouched |

### D. Unknown — insufficient evidence (does not block the RPC text)

| Item | Impact |
|---|---|
| `match_history` table ACLs | none on the RPCs (definer-owned, and the chain already withholds client writes) |
| `match_signals` RLS policies (only `match_behavior` and the fence table were reported as having none) | none on the RPCs (definer-owned) |
| `match_history.user_id` FK in production | none on the RPCs |
| Whether the new publisher tolerates absent `match_signals` / `match_behavior` | only matters if those tables are excluded from the chain |

---

## 7. Remaining unknowns

Two, both non-blocking for authoring, both consequences of an owner scope decision rather than of missing evidence:

1. **Whether the chain should create `match_signals` and `match_behavior`.** Production has them with specific FK delete rules and RLS; the chain has neither. A fresh database built from the chain alone cannot exercise the new activity check. This is a scope decision (represent legacy objects in a migration, or document them as pre-existing), not an evidence gap.
2. **`match_signals` RLS policy text and `match_history` table ACLs.** Neither affects the RPC bodies; both would only matter for a broader security-parity claim, which is out of this task's scope.

Everything else that revision 1 marked UNKNOWN is now established (§2.2).

---

## 8. Risks

| # | Risk | Status | Mitigation |
|---:|---|---|---|
| R1 | Activity predicate guessed | **CLOSED** — predicate fixed by the FK evidence and the itemised definition (§2.3) | author it exactly as §2.3 |
| R2 | Columns created after the function | open (ordering) | in the new migration: columns → policy → functions → ACLs |
| R3 | `week_id SET NOT NULL` fails | **CLOSED** for production (0 NULLs) and for fresh databases; only a stale local chain instance could fail | acceptable; a guard is optional, not required |
| R4 | Empty search path breaks unqualified references | **CLOSED** — current bodies reference `public.*` schemas and `pg_catalog` built-ins only | verify in the migration review |
| R5 | Chain RLS lacks the delivery gate while the function assumes it | **CLOSED as a finding, now actionable** (D10) | include the policy recreation |
| R6 | Activity tables absent from the chain → the destructive path cannot be reproduced locally | **OPEN — owner scope decision** (§7.1) | decide before Stage 4 authoring |
| **R7** | **Silent data loss**: without the activity check, a week-scoped delete cascades away `match_signals` rows | **CONFIRMED, highest severity** | covered by D5; must never be deployed without the check |
| **R8** | **Opaque 500 instead of 409**: without the check, `match_behavior` FK refuses the delete and the caller sees `publish_failed` | **CONFIRMED** | covered by D5 |

---

## 9. Stage 4 readiness

| Question | Answer |
|---|---|
| 1. Is the destination repository correctly identified? | **Yes** |
| 2. Is the Git state understood and preserved? | **Yes** — 6 tracked modifications, 7 untracked paths, all pre-existing, none touched |
| 3. Are production function definitions reconciled with the repository? | **Yes** — 17 + 5 behaviour items classified; six behavioural differences and one validation difference identified |
| 4. Are the required supporting objects understood? | **Yes** — columns, unique index, FK delete rules, RLS states, sequence privileges; only table ACLs and `match_signals` policies remain open and neither affects the RPCs |
| 5. Are all necessary integration files identified? | **Yes** — one new migration under `supabase/migrations/` later than `20261119120000`; no Edge Function, test or documentation change |
| 6. Are the exact changes sufficiently specified? | **Yes** — twelve differences (D1–D12) with the exact object, the required change and its dependency |
| 7. Are there unresolved dependencies that could cause destructive or inconsistent integration? | **One scope decision** (R6): whether the two activity tables enter the chain. The destructive behaviour itself is fully characterised (R7, R8) |
| 8. Can Stage 4 proceed without assumptions? | **Yes, for everything that touches the RPCs and `match_history`.** The single remaining item is a scope decision, not a technical unknown |

**Stage 4 readiness: READY FOR REVIEW** (subject to the R6 decision).

---

## 10. Final decision

**READY FOR REVIEW.**

Stage 3 is complete on the supplied evidence. The repository must receive exactly one new forward-only migration that, in this order:

1. adds `match_history.tier1_interaction` and `tier2_interaction`;
2. aligns `match_history` — `week_id SET NOT NULL`, `delivered_at SET DEFAULT now()`, and the `auth.uid() = user_id AND delivered_at <= now()` SELECT policy;
3. grants `service_role` sequence privileges on `match_generation_seq`;
4. redefines `begin_match_generation` with an empty search path;
5. redefines `publish_week_allocation` with an empty search path, future-generation rejection, the target-week `FOR UPDATE` lock, the four-source activity check and `PT409 week_in_use`, per-row validation, and every other behaviour reproduced verbatim from the accepted form;
6. restates the function ACLs.

The one open question is an owner decision, not engineering work: whether `match_signals` and `match_behavior` — which the chain has never represented — are to be added to the migration history or documented as pre-existing production objects (R6).

**Stage 4 remains unauthorised.** No migration was created, no source or test file was changed, nothing was staged, committed, pushed, applied or deployed by this revision.
---

# 11. Stage 4 — Transfer and Integration (implementation record)

**Authorisation:** Stage 4 as scoped for this mandate — one forward-only migration, focused tests, this section, a Git preservation report and an acceptance table. Production SQL execution, Edge Function deployment, staging, commits, pushes and merges remain prohibited and none occurred.

**Revision note:** §§1–10 are preserved byte-for-byte as the Stage 3 record and are not restated or corrected here. Where Stage 4 had to resolve something Stage 3 left open, the resolution is recorded in §11.4 and flagged as an engineering decision awaiting owner ratification.

## 11.1 Artefacts created

| # | Path | SHA256 | Size |
|---:|---|---|---|
| 1 | `supabase/migrations/20261120120000_match_publication_activity_protection.sql` | `6f82643f27f3f4bce5a2be79f8d06786c2d2bab4101f679ec2f3af63f66aba5b` | 480 lines |
| 2 | `scripts/verify-matching-parity-alignment.mjs` | `48e2f4125211bfe100a60125cd3dc1dcf5b0790a5df28e77def929ac1a07fcef` | 699 lines |
| 3 | `package.json` — one added script, `test:parity-alignment` | — (single-line addition) | — |

Unchanged, re-hashed after the work:

| File | SHA256 | Expected | Result |
|---|---|---|---|
| `supabase/migrations/20261118120000_match_generation_fencing.sql` | `f1955ef8…b687349` | `f1955ef8…b687349` | **identical** |
| `supabase/migrations/20261119120000_match_publication_pt409.sql` | `6cfb272a…de510b` | `6cfb272a…de510b` | **identical** |
| `supabase/functions/match-generator/index.ts` | `8b5234e6…f71e7c1` | `8b5234e6…f71e7c1` | **identical** |
| `scripts/test-matching-allocation.mjs` | `9bc2ba89…c79427a0e1` | `9bc2ba89…c79427a0e1` | **identical** |

No historical migration was edited. No Edge Function was changed — the deployed generator already answers `week_in_use` with 409 (`index.ts:395-421`), so this migration is what makes that arm reachable.

## 11.2 What the migration does, in order

The order is deliberate: every object a function body references exists before the function is replaced (Stage 3 §8, R2), and every destructive statement is preceded by the check that may refuse it.

| § | Statement block | Difference closed | Notes |
|---:|---|---|---|
| 1 | `create extension if not exists "uuid-ossp"` | D12 (activity tables) | needed only by `match_behavior.id`; a no-op when already installed, which production proves it is (its default is `uuid_generate_v4()`) |
| 2a | `match_signals` — create with production shape, PK `(id)`, three FKs (`match_history` **CASCADE**, `users` **CASCADE** ×2), `UNIQUE(match_history_id, sender_id)`, RLS on, one participant policy, broad table grants | D12 | existing table reconciled, never dropped (§11.3) |
| 2b | `match_behavior` — create with production shape, PK, FK to `match_history` **NO ACTION**, FK to `users`, RLS on, **no policies** | D12 | the NO ACTION rule is the reason the publisher must check activity before deleting (§11.5) |
| 3a | `match_history.tier1_interaction`, `tier2_interaction` `boolean default false` | D7 | added only when absent; a non-boolean existing column raises |
| 3b | `match_history.week_id SET NOT NULL` | D8 | guarded: raises with the row count if any row has a NULL week, instead of failing mid-migration |
| 3c | `match_history.delivered_at SET DEFAULT now()` | D9 | existing timestamps untouched |
| 3d | `match_history` SELECT policy → `auth.uid() = user_id and delivered_at <= now()` | D10 | policy recreated, not duplicated |
| 4 | sequence ACL: `revoke all … from public, anon, authenticated` then `grant usage, select, update … to service_role` | D11 | production holds `{postgres, service_role}`; the Supabase bootstrap grants to client roles are removed rather than merely overridden |
| 5 | `begin_match_generation` — same body, `set search_path = ''` | D2 | body diff versus `20261118120000` is exactly that one line |
| 6 | `publish_week_allocation` — `set search_path = ''` (D1), `invalid_generation` for `p_generation > latest_generation` (D3), week `FOR UPDATE` lock on the target week's history rows (D4), four-source activity check raising `PT409 week_in_use` (D5), per-row `user_id`/`delivered_at`/tier-id validation before any lock or delete (D6), replay binding and atomic week-scoped replace preserved verbatim with empty search path qualifying every reference | D1, D3–D6 | publisher diff versus `20261119120000` is purely additive: no removed statement, no changed message, no changed column list |
| 7 | ACL restatement: `revoke … from public, anon, authenticated` + `grant execute … to service_role` on both functions; `grant select on public.match_week_generations to service_role`; `comment on function` | execution surface (A4) | production ACL is `{postgres=X/postgres, service_role=X/postgres}`; the fence row is readable by `service_role` so a transport failure can be diagnosed, and by no client role |

Verified by diff, not by description:

- `begin_match_generation` body: **one** differing line (`set search_path = public` → `set search_path = ''`).
- `publish_week_allocation` body: the seven intended additions only — input-shape check, `invalid_generation`, validation loop, week `FOR UPDATE`, three activity checks, section comments. Nothing was deleted or reworded.

## 11.3 Reconciling an existing object instead of recreating it

The Stage 3 constraint was that a partially existing incompatible object must fail loudly rather than pass through a broad `if not exists`. Implemented as: if the table is absent, create it exactly; if present, verify the required column set and the FK delete rule, and `raise exception` naming everything that is missing. The migration never drops and recreates `match_signals`/`match_behavior`, so no activity history can be destroyed by applying it.

## 11.4 Engineering decisions taken in Stage 4 (require owner ratification)

| # | Decision | Why | Alternative rejected |
|---:|---|---|---|
| E1 | **R6 resolved by representing both activity tables in the chain**, reconciled rather than created blindly | the publisher reads both tables; a chain-only database could not exercise the check, and the dataloss risk (R7) would stay unverifiable | documenting them as "pre-existing production objects" leaves the chain unable to represent the destructive path at all |
| E2 | `week_id SET NOT NULL` guarded by an explicit NULL count + `raise exception` | a raw `alter` would abort with a bare constraint error and leave the operator to discover which rows are affected | unconditional `alter` (Stage 3 §8 R3 called a guard "optional") |
| E3 | Sequence privileges **revoked** from `public, anon, authenticated` before granting to `service_role` | a Supabase database grants sequences by default privileges; without the revoke the chain would keep client USAGE that production does not have | grant-only (which would have left `authenticated` with USAGE in a real database) |
| E4 | `match_signals` policy authored with evidence-based semantics under a chosen name `match_signals_participant_access` | Stage 3 established the predicate `(auth.uid() = sender_id) OR (auth.uid() = receiver_id)` but not the production policy *name*; a policy without a name cannot be created | leaving RLS on with no policy would have made the table unreadable to participants, contradicting the evidence |

## 11.5 Why the activity check must run before the delete

| Activity source | Consequence of a week-scoped delete without the check |
|---|---|
| `match_signals` row referencing a target-week history row | **silent, irreversible loss** — the FK cascades, so user signal history disappears with no error (R7) |
| `match_behavior` row referencing a target-week history row | the FK does **not** cascade, so PostgreSQL raises `23503` and the whole publication aborts as an opaque `500 publish_failed` (R8) |
| `tier1_interaction` / `tier2_interaction` set on a target-week row | the user has already answered; replacing the pair destroys the record the flags describe |

All four funnel into one answerable verdict, `PT409 week_in_use`, which the deployed generator already maps to HTTP 409 with `error: "week_in_use"`.

## 11.6 Test evidence

Command: `npm run test:parity-alignment` (`node scripts/verify-matching-parity-alignment.mjs`).

Method: the script creates a **disposable** database inside the running local Supabase Postgres container (`supabase_db_minglemate`, PostgreSQL 17.6), builds the state a chain database is in *before* this migration (roles, `auth.uid()` stub, `users`, `match_history` exactly as `20261014150000_consolidated_schema_chain.sql:891-914` including the old policy, plus the Supabase bootstrap default privileges so every object is born broadly granted), applies `20261118120000` and `20261119120000` verbatim, then applies the migration under test inside **one transaction**. It records each assertion with its observed value and drops only the database it created.

Result: **24/24 checks passed, exit 0** (`parity alignment: all checks passed`).

| ID | Requirement | Status | Observed |
|---|---|---|---|
| T01 | A normal publication writes the rows with `week_id` and `delivered_at`, and does not trust a client-supplied `week_id` | **VERIFIED** | `ok`, 2 rows, 2 stamps |
| T02 | An identical replay writes nothing (row ids unchanged, `replayed: true`) | **VERIFIED** | `replayed: true`, ids unchanged |
| T03 | The same generation with a different payload is refused | **VERIFIED** | `PT409 generation_conflict` |
| T04 | An older generation cannot overwrite a newer one | **VERIFIED** | `PT409 stale_generation` |
| T05 | A generation that was never authorised is refused as a caller error | **VERIFIED** | `22023 invalid_generation` |
| T06 | Activity in `match_signals` blocks publication and preserves the allocation | **VERIFIED** | `PT409 week_in_use`, 2 rows kept |
| T07 | Activity in `match_behavior` blocks publication (also exercises `uuid_generate_v4()`) | **VERIFIED** | `PT409 week_in_use`, 2 rows kept |
| T08 | `tier1_interaction = true` blocks publication | **VERIFIED** | `PT409 week_in_use` |
| T09 | `tier2_interaction = true` blocks publication | **VERIFIED** | `PT409 week_in_use` |
| T10 | A missing or malformed `user_id` is refused, nothing written | **VERIFIED** | `22023` ×2, 0 rows |
| T11 | A missing or malformed `delivered_at` is refused, nothing written | **VERIFIED** | `22023` ×2, 0 rows |
| T12 | A refused publication replaces nothing and does not advance the fence | **VERIFIED** | ids unchanged, `published_generation` = g1 |
| T13 | Publishing one week never touches another | **VERIFIED** | both `ok`, first week's ids unchanged |
| T14 | A row whose `delivered_at` is in the future is invisible to its owner | **VERIFIED** | 0 rows |
| T15 | A released row is visible to its owner | **VERIFIED** | 1 row |
| T16 | Another user's released row stays invisible | **VERIFIED** | 0 rows |
| T17 | Both functions: `SECURITY DEFINER`, empty `search_path`, owner `postgres`, EXECUTE only for `service_role` | **VERIFIED** | `service=true authenticated=false anon=false definer=2 wrong_search_path=0 wrong_owner=0` |
| T18 | Sequence: `service_role` has USAGE/SELECT/UPDATE, client roles have none | **VERIFIED** | `clients_denied=true` |
| T19 | `match_history`: `week_id` NOT NULL, `delivered_at` defaults to `now()`, single delivery-gated policy | **VERIFIED** | policy count 1, gate present |
| T20 | Activity tables: CASCADE / NO ACTION delete rules, unique `(match_history_id, sender_id)`, RLS states, participant policy | **VERIFIED** | `signals=cascade`, `behavior=no-action`, `behavior_policies=0` |
| T21 | An incomplete existing `match_signals` stops the migration and changes nothing | **VERIFIED** | raises naming the missing columns; `match_behavior` absent afterwards |
| T22 | An existing cascading `match_behavior` stops the migration and changes nothing | **VERIFIED** | raises on the delete rule; `match_signals` absent afterwards (transaction rolled back) |
| T23 | An empty allocation is a valid publication | **VERIFIED** | `published: 0`, fence advanced |
| — | The migration is idempotent (a second application is a no-op) | **VERIFIED** | exit 0 |

Regression, unchanged by this work:

| Suite | Result |
|---|---|
| `npm run test:matching-allocation` | **80/80 passed** |
| `node scripts/verify-matching-publication.mjs` | **66/66 checks passed** |
| `npm run verify` | **45/45 checks + 49 D-1 assertions** |
| earlier migration proposal T1–T8 (Stage 3) | unchanged; not re-run, not needed |

### NOT VERIFIED — stated plainly

| Item | Why it could not be verified here |
|---|---|
| Execution against the hosted production database | no authorised access to `mhdjnhiqahsllbczbzpk` (EXEC-005/007 blockers stand); the migration was applied only to disposable local databases |
| The production `match_signals` policy **name** | Stage 3 established the predicate but not the identifier; the name in E4 is chosen, the semantics are from the evidence |
| Production's exact `match_history` table ACLs | Stage 3 §7.2 left them open; this migration does not restate them, so nothing was invented |
| Concurrent publishers of the same week (two sessions) | asserted by the fence row lock and the week `FOR UPDATE`, but the single-session harness cannot schedule the second session deterministically; the lock order is unchanged from the accepted `20261119120000` form |
| End-to-end `PT409 → HTTP 409` against a hosted PostgREST | the Edge Function verdict is verified at unit level (80/80); no hosted endpoint is reachable |
| Applying this migration to the existing local dev database | deliberately not done: the mandate covers disposable verification only, and the local database is the shared `postgres` database of the running stack |

## 11.7 Git preservation report

| Item | Value |
|---|---|
| Working directory | `C:\Users\oboch\minglemate-release` |
| Branch | `release/account-deletion` |
| HEAD before / after | `0e2c6a7acaaeee0df4ad018234d024edfd6e4af0` / **identical** |
| Staged files | **none** (0) |
| Commits created | **none** |
| Pushes / merges / rebases / resets / stashes / branch switches | **none** |
| Tracked modifications | 6, all pre-existing to Stage 4, byte-identical: `MATCHING_RELIABILITY_DEPLOYMENT_RUNBOOK.md`, `…RELEASE_MANIFEST.md`, `…RELEASE_REPORT.md`, `…ROLLBACK.md`, `scripts/test-matching-allocation.mjs`, `supabase/functions/match-generator/index.ts` — plus `package.json`, this mandate's single-line script addition |
| Untracked additions this mandate | `supabase/migrations/20261120120000_match_publication_activity_protection.sql`, `scripts/verify-matching-parity-alignment.mjs`, and this section's edit to `docs/releases/PRODUCTION_REPOSITORY_PARITY_REPORT.md` |
| Protected worktrees | `C:\Users\oboch\minglemate` and `C:\Users\oboch\minglemate-matching` — not read from, written to, or run in |
| Disposable databases used | `minglemate_parity_scratch`, `minglemate_parity_scratch_neg1`, `minglemate_parity_scratch_neg2` — all dropped by the script |

## 11.8 Acceptance table

| Mandate requirement | Verdict | Evidence |
|---|---|---|
| One forward-only migration, later than `20261119120000`, no historical edit | **VERIFIED** | artefact 1; historical hashes identical |
| Closes D1–D12 | **VERIFIED** | §11.2 table; diff of both function bodies |
| `match_signals`/`match_behavior` never dropped and recreated; incompatible objects fail loudly | **VERIFIED** | §11.3, T21, T22 |
| Every destructive statement preceded by its check | **VERIFIED** | T06–T12; §11.5 |
| Focused tests for the migration | **VERIFIED** | T01–T23, 24/24, exit 0 |
| No production SQL execution | **VERIFIED** | disposable databases only; §11.6 |
| No Edge Function deployment | **VERIFIED** | `index.ts` hash unchanged, nothing deployed |
| Nothing staged, committed, pushed, merged | **VERIFIED** | §11.7 |
| Report section added without rewriting §§1–10 | **VERIFIED** | this section is append-only |
| Behaviour verified on real PostgreSQL rather than a substitute for `uuid_generate_v4()` | **VERIFIED** | container has `uuid-ossp` 1.1; T07 uses the column default |
| Hosted behaviour parity with production | **NOT VERIFIED** | no authorised access |

## 11.9 Residual risk after integration

| # | Risk | Level | Note |
|---:|---|---|---|
| R9 | The migration must be applied **before** the generator that depends on it is deployed | high if reversed | the interim deployed upsert needs the `(user_id, week_id)` unique index; the 409 arm needs the `week_in_use` string this migration raises |
| R10 | Applying this migration to a database that already has an incompatible activity object | low | refuses loudly and changes nothing (T21/T22); the operator sees the missing columns or the delete rule to reconcile |
| R11 | A stale local chain database with NULL `week_id` rows | low | refuses with the row count instead of a bare constraint error |
| R12 | `create extension "uuid-ossp"` unavailable | very low | production already depends on `uuid_generate_v4()` in `match_behavior`, so the extension is present there; standard on Supabase |
| R7, R8 | data loss / opaque 500 | **CLOSED by this migration** | verified by T06/T07 |

## 11.10 Recommendation

**ACCEPT** the integration, subject to owner ratification of E1–E4 in §11.4 and to the deployment ordering in R9 (migration first, generator second).

No production effect has occurred: nothing was applied to the hosted project, nothing was deployed, nothing was staged or committed.
