# MingleMate — Prioritized Gap Register

**Prepared:** 2026-10-21
**Repository:** `C:\Users\oboch\minglemate`, branch `fix/review-2026-10-15`, HEAD `dfad576`
**Companion document:** [MINGLEMATE_PRD_COMPLIANCE_MATRIX.md](MINGLEMATE_PRD_COMPLIANCE_MATRIX.md)
**Requirement source:** `MingleMate_Master_Product_Specification.docx` v1.0 (27 September 2026)
**Implementation evidence:** [MINGLEMATE_CURRENT_STATE_INVESTIGATION.md](MINGLEMATE_CURRENT_STATE_INVESTIGATION.md) plus the targeted source reads recorded in the matrix.

**Status:** evidence and sequencing only. Nothing in this register is authorized for implementation. No code, migration, test, configuration, database or deployment was changed.

---

## 0. How this register was built

### 0.1 Scope

This register contains **26 root-cause gaps** derived from the 109 requirements in the compliance matrix. It deliberately does not restate the full investigation. Each gap cites the matrix requirements it affects and the investigation finding IDs / source references that support it.

### 0.2 Priority scale

| Priority | Definition |
|---|---|
| **P0** | Security, privacy, financial integrity, or risk of unrecoverable data loss. |
| **P1** | Core matching, eligibility, scoring, payment correctness, or governance integrity. |
| **P2** | Critical user journey or interaction failure (a required path is missing or materially misleading). |
| **P3** | Deployment, automation, monitoring or operational reliability. |
| **P4** | Visual quality, accessibility and usability. |
| **P5** | Nonessential cleanup and documentation. |

Priority reflects impact and urgency, not implementation effort. A P0 classification is not a claim that exploitation has occurred; it is a claim that the evidence supports a privacy/financial/data-loss risk that must be closed or disproved before further product work.

### 0.3 Evidence rules and notation

- `chain` means `supabase/migrations/20261014150000_consolidated_schema_chain.sql` in the current working tree.
- `§G-n` refers to the investigation's verification table (report section G), **not** to a gap ID. Gap IDs are always two digits (`G-01`…`G-26`).
- `F-nn` and `D-n` refer to the investigation's finding and discrepancy IDs. Product decisions in this register use the `PD-n` prefix (`PD-1`…`PD-9`, §7.1) so they cannot be confused with investigation discrepancy `D-n`.
- `FAIL` requires a cited contradiction between the requirement and the artifact.
- A missing repository object never establishes production absence; such items are `BLOCKED` with the exact missing evidence named.
- A passing script is scoped to what it exercises.
- No production system was contacted. No migration was applied. No product test was executed for this register.

### 0.4 Register summary

| Priority | Gaps | IDs |
|---|---:|---|
| P0 | 4 | G-01 … G-04 |
| P1 | 9 | G-05 … G-13 |
| P2 | 5 | G-14 … G-18 |
| P3 | 3 | G-19 … G-21 |
| P4 | 3 | G-22 … G-24 |
| P5 | 2 | G-25 … G-26 |
| **Total** | **26** | |

| Classification | Gaps |
|---|---:|
| FAIL — Confirmed gap | 10 |
| PARTIAL | 8 |
| BLOCKED | 4 |
| UNVERIFIED | 1 |
| DECISION REQUIRED | 2 |
| NOT IMPLEMENTED | 1 |

---

## 1. P0 — Security, privacy, financial integrity and data loss

### G-01 — Contact-reveal RPC bypasses the Connect payment condition and owner sharing controls

| Field | Detail |
|---|---|
| **Related requirements** | PRF-07, PAY-02, PAY-03 (also PRD §6, §7, §25(6)) |
| **Investigation findings** | F-40, F-50, F-51; D-3 (no caller) |
| **Evidence and source references** | `supabase/migrations/20261014150000_consolidated_schema_chain.sql:1808-1864` defines `get_match_contact(match_user_id)` as `SECURITY DEFINER`, requires only a weekly `match_history` pairing, and returns `display_phone, phone, whatsapp_number, email` when either (a) a `connect_unlocks` row exists **or (b) the caller has any succeeded `payment_intents` row with `purpose='section2'`**. It never consults `share_phone`, `share_whatsapp`, `share_email` or the paid snapshot columns. It is granted to `authenticated` (`:1864`). No repository caller exists (D-3), but the grant makes it directly callable through PostgREST. `complete_connect_unlock` (F-40) is the only path that honours owner share flags. |
| **Classification** | FAIL — Confirmed gap |
| **Impact** | A user who is weekly-paired with someone and has paid for Section 2 (a different product) can retrieve that person's raw phone, WhatsApp, e-mail and `display_phone` — even when the owner disabled sharing, and without any Connect purchase. This violates both the payment condition and consent. It is a direct privacy breach path and a product-policy breach. |
| **Priority and rationale** | **P0.** Personal contact data is the product's most sensitive asset; the defect is reachable by any authenticated paired user with a Section 2 purchase. Financial harm is indirect (Connect revenue bypassed), privacy harm is direct. |
| **Dependencies** | Decision PD-4 (confirm Section 2 must never reveal contacts); deployment evidence G-02 (the same grant must be verified live); staging accounts for a two-user test. |
| **Proposed resolution** | Remove the Section 2 branch and all share-flag-blind column returns. Either (a) revoke/drop `get_match_contact` after confirming no external caller, keeping `get_unlocked_contacts` as the single reveal path, or (b) rewrite it to read only the `connect_unlocks` snapshot for `(buyer=auth.uid(), seller=target)` and return only snapshot fields that were enabled at purchase. Do not accept client-supplied identity. Re-run the schema-chain static check. |
| **Required acceptance test** | (1) Paired user with a succeeded Section 2 intent calls `get_match_contact` → zero rows. (2) Paired user with no unlock calls it → zero rows. (3) Paired buyer with a Connect unlock where seller enabled only phone → response contains phone and no WhatsApp/e-mail/social. (4) Seller with all sharing off → no contact fields via any RPC. (5) Direct `select phone/display_phone` as another authenticated user is denied. |
| **Decision / access needed** | Product decision PD-4. Staging database and two test accounts for execution. |

### G-02 — Contact-privacy enforcement is not proven in the deployed database

| Field | Detail |
|---|---|
| **Related requirements** | PRF-07, PAY-02, PAY-03 |
| **Investigation findings** | F-50, F-51, F-60, F-74; D-9; investigation D-11 |
| **Evidence and source references** | Column-scoped `users` grants, `profiles_public` and `my_profile()` are defined in the working-tree chain (F-50), but that file is modified/uncommitted. `20261015120000_rls_closure_precondition_tables.sql` (notifications/photos/token_purchases/campuses) is untracked. No live catalog, grant, policy or view was inspected (investigation §D preamble; F-74). The PRD itself records that a contact-privacy SQL fix had been written but not applied to the live DB (§6, §17). A repository migration is not evidence of application (task rule 5). |
| **Classification** | BLOCKED |
| **Impact** | If the live `users` table still carries a blanket SELECT grant, any authenticated user can read every profile's `display_phone`/phone regardless of front-end hiding. That would be a P0 privacy exposure affecting all users. The current evidence cannot confirm or exclude it. |
| **Priority and rationale** | **P0.** The requirement is explicitly database-enforced privacy; the deployment state is unknown, and the PRD's own audit found the fix unapplied at the time it was written. |
| **Dependencies** | Backup/restore readiness G-04 before any DDL; read-only production/staging access; investigation D-11 checklist reconciliation (G-26). |
| **Proposed resolution** | Run the repository's read-only `supabase/sql/inspect_state.sql` against the target and record grants, policies and views. If the closure is absent, apply the chain + closure migrations in the documented order after G-04, then run `scripts/verify-rls-closure.mjs` against a local stack. Do not infer application from Git. |
| **Required acceptance test** | `inspect_state.sql` shows no blanket `users` SELECT; `display_phone` absent from anon/authenticated column grants; `profiles_public` omits contact columns; an unrelated authenticated user selecting `display_phone`/`phone` fails; `verify-rls-closure.mjs` exits 0 on the applied schema. |
| **Decision / access needed** | Read-only database access (production or an exact staging clone). Backup prerequisite. |

### G-03 — Section 2 response and engagement tables have no defined ownership enforcement

| Field | Detail |
|---|---|
| **Related requirements** | S2-03, PRF-07 |
| **Investigation findings** | F-26, F-27, F-36; D-9 |
| **Evidence and source references** | `section2_responses` is written by `Section2.jsx` and read by `Chat.jsx`; `engagement_metrics` is also client-read/written. No file under `supabase/migrations/` or non-superseded `supabase/sql/` creates either table, defines columns, enables RLS or declares a policy (grep-verified, F-27/D-9). `inspect_state.sql` lists `section2_responses` only as an expected object. The matrix's S2-03 row therefore cannot establish owner-only access. |
| **Classification** | BLOCKED |
| **Impact** | Section 2 answers are free-text disclosures about relationships, fears and personal challenges. If the table lacks RLS, any authenticated (or anon, depending on grants) client could read or alter other users' answers. This is a P0 privacy risk and a data-integrity risk for guided conversations. |
| **Priority and rationale** | **P0.** Private free-text data with unknown authorization. The absence of repository DDL is not proof of absence in production, so it must be inspected rather than patched blindly. |
| **Dependencies** | G-04 backup; read-only catalog access; G-02 inspection run (same session). |
| **Proposed resolution** | Inspect live columns, grants and RLS for both tables. If missing, add an owner-only policy (`user_id = auth.uid()` for select/insert/update), revoke anon, add the `(user_id, question_number)` uniqueness/foreign key if absent, and record the DDL in a tracked migration. Update `inspect_state.sql` to assert it. |
| **Required acceptance test** | User B cannot select, insert for, or update user A's `section2_responses`; spoofed `user_id` insert is rejected; owner read/write and upsert still work; `engagement_metrics` obeys the same ownership rule; inspect tool reports the expected policies. |
| **Decision / access needed** | Read-only database access; backup prerequisite; no product decision unless the table is intentionally shared. |

### G-04 — No recoverable production data backup exists, and recovery is untested

| Field | Detail |
|---|---|
| **Related requirements** | OPS-01, OPS-03 (the PRD states no backup mechanism or RPO; assessed against the task's backup/recovery scope and the P0 data-loss rule — see matrix §3.7) |
| **Investigation findings** | F-77; `audit-out/plan-production-migration-2026-10-15/RECOVERY-READINESS.md` §1–§4 |
| **Evidence and source references** | `.github/workflows/weekly-db-backup.yml` is `workflow_dispatch` only, with the weekly schedule commented out (`:28-31`). The recovery review records: no workflow run ever, zero Actions artifacts, `SUPABASE_DB_POOLER_URL` absent, no platform backup/PITR on the free plan as recorded on 2026-10-16 (not re-checked for this document), no data-bearing dump anywhere, and a schema-only artifact that restores 0 rows. The workflow's own guard exits 1 without the secret. |
| **Classification** | FAIL — Confirmed gap |
| **Impact** | Any destructive migration, bad deploy or data corruption is unrecoverable. The product's user, match, message and payment metadata would be lost. This blocks safe execution of every other database change in this register. |
| **Priority and rationale** | **P0.** Risk of data loss is explicit in the P0 definition. It is also a hard prerequisite for applying G-01/G-02/G-03 fixes and the admin deployment. |
| **Dependencies** | Production pooler credential (entered by the owner, never pasted into chat); a restore target (isolated Postgres); decision PD-5 on retention/RPO/RTO. |
| **Proposed resolution** | Add `SUPABASE_DB_POOLER_URL` as an Actions secret; run the workflow manually; confirm the artifact is data-bearing (`COPY`/`INSERT` for `public.*`); restore it into an isolated Postgres and compare counts; move the artifact off Actions (S3/R2) with a retention policy; only then enable the schedule. Document the restore drill. |
| **Required acceptance test** | Dump contains data for `public.users`, `user_responses`, `matches`, `match_history`, `messages`, `payment_intents`; restore into a clean database succeeds with matching row counts; a scheduled run produces a new artifact; restore steps are timed and recorded. |
| **Decision / access needed** | Credential and offsite storage authorization; PD-5 retention/RPO decision. This is an owner/infrastructure action, not a code change. |

---

## 2. P1 — Core correctness, scoring, payments and governance

### G-05 — Section 1 dimension weights contradict the PRD

| Field | Detail |
|---|---|
| **Related requirements** | S1-03 |
| **Investigation findings** | F-29 |
| **Evidence and source references** | `supabase/functions/_shared/compatibilityEngine.ts:65-69` computes `communication*0.30 + conflict*0.25 + emotional*0.20 + expectations*0.15 + values*0.10`. PRD §5 requires communication + conflict ×3, emotional + "space" ×2, values ×1 — normalised 3:3:2:2:1 (0.273/0.273/0.182/0.182/0.091). The implemented ratios are 3:2.5:2:1.5:1. |
| **Classification** | FAIL — Confirmed gap |
| **Impact** | Every compatibility score and therefore every weekly ranking is produced under a different policy than the PRD states. Conflict and expectations are under-weighted relative to the specified model. Two users can receive different Tier 1/Tier 2 outcomes than the approved model would produce. |
| **Priority and rationale** | **P1.** Scoring is the core matching mechanic; the discrepancy is deterministic and affects all users, though it is not a security or data-loss issue. |
| **Dependencies** | Decision PD-1 (which weighting is authoritative, and what "space" means); G-06 verification harness to prove the change. |
| **Proposed resolution** | Product owner confirms the intended weights and the fourth dimension's label. Change the five constants (or the normalisation) in one place, keep them summing to 1.0, update any comments/docs, and add fixed-vector tests. Do not change the question-to-dimension mapping. |
| **Required acceptance test** | Known answer vectors produce the expected per-dimension and overall scores; weights sum to 1.0; a user with all-communication agreement and no other agreement scores exactly the communication weight; ranking fixtures match the approved model. |
| **Decision / access needed** | Decision PD-1. No database access required for the code change. |

### G-06 — The 50-question pipeline has no dedicated correctness proof

| Field | Detail |
|---|---|
| **Related requirements** | S1-04, S1-05 |
| **Investigation findings** | F-29, F-37; §G-9 (e2e NOT RUN), §G-11 (count only) |
| **Evidence and source references** | The only executed question-bank check imports `src/data/section1Questions.js` and counts 50×4 (§G-11). No test asserts that answer 17 changes only the conflict dimension, that all 50 answers persist, or that a full run produces a score. `scripts/e2e-matching-test.mjs` exists but was not run (no staging credentials, §G-9). The PRD explicitly requires this proof (§5, §25(2)). |
| **Classification** | FAIL — Confirmed gap |
| **Impact** | The PRD explicitly requires this proof, and it does not exist. The product cannot truthfully claim that all 50 answers reach the intended dimensions. A future edit to question order/options or to the positional mapping could silently corrupt every match, and no test would catch it. |
| **Priority and rationale** | **P1.** Core scoring integrity. This is a missing-proof gap rather than a known wrong score, but it blocks any release claim about matching. |
| **Dependencies** | G-05 decision (weights) so fixtures encode the approved model; staging/local Supabase for persistence/e2e. |
| **Proposed resolution** | Add a deterministic test that, for each of the 50 questions, changes only that answer and asserts only its dimension changes; add a persistence test for all 50 positions; add an e2e staging run that ingests two fixture users and asserts `match_history` output matches the expected ranking. Extend `check-schema-chain.mjs` or add a dedicated script, using the repository's existing Node-script style (no new framework). |
| **Required acceptance test** | 50/50 per-question dimension assertions pass; a 50-answer round-trip preserves order; e2e creates the expected tier assignments for two fixture users; the suite fails if a question is reordered or its dimension changes. |
| **Decision / access needed** | Staging URL + anon key for e2e (`E2E_SUPABASE_URL`, `E2E_SUPABASE_ANON_KEY`). No product decision beyond PD-1. |

### G-07 — Weekly matching has no repository schedule and its live automation is unknown

| Field | Detail |
|---|---|
| **Related requirements** | MTM-08, ADM-10, ADM-17 |
| **Investigation findings** | F-33, F-35, F-75, F-76; D-10; §G-3 |
| **Evidence and source references** | Nothing in the repository schedules `match-generator`; the chain creates only `payment-ops-tick` (`*/5`). The retirement migration `20261019190000_retire_generate_tuesday_matches.sql` is untracked and its header asserts a production cron `calculate-weekly-matches` calling the legacy TRUNCATE engine; it replaces that function with a raising stub. Live cron names, schedules and run history cannot be read from source (D-10). |
| **Classification** | BLOCKED |
| **Impact** | If no production cron targets `match-generator`, weekly matches only appear when an admin presses "Run Matching Now". If the legacy cron still targets the retired function, weekly runs fail or produce zero matches. Users may see no new matches, which is the product's central promise. |
| **Priority and rationale** | **P1.** Automatic weekly matching is core product behavior; the current evidence cannot establish whether it runs. |
| **Dependencies** | Read-only live cron/function inspection; G-04 backup before any SQL change; deployment of `match-generator` (G-09 adjacent). |
| **Proposed resolution** | Inspect `cron.job`, `cron.job_run_details`, deployed Edge Function list/versions and recent `match_history` delivery. Decide the scheduler (pg_cron + pg_net to the function, or an external scheduler with the service key). Point it at `match-generator`, remove/retire the legacy job, and add a run-health signal. |
| **Required acceptance test** | A scheduled run creates `match_history` rows for eligible users; rerunning the same week is idempotent; a run with no eligible users returns success 0; the legacy job is absent or provably redirected; run failures are visible in monitoring. |
| **Decision / access needed** | Live database/function access; scheduler ownership decision (platform cron vs external). |

### G-08 — Production payment initiation is hardcoded to the Daraja sandbox

| Field | Detail |
|---|---|
| **Related requirements** | PAY-09, MTM-02, MTM-03 |
| **Investigation findings** | F-45; D-7; `DEPLOYMENT-CHECKLIST.md` §2 |
| **Evidence and source references** | `supabase/functions/initiate-payment/index.ts` builds both the OAuth token URL and the STK URL against `https://sandbox.safaricom.co.ke` unconditionally. Only `payment-callback/index.ts` switches base URLs on `MPESA_ENV`. The deployment checklist records this as a known production gap. |
| **Classification** | FAIL — Confirmed gap |
| **Impact** | With production credentials, no STK push reaches a real phone; Connect, Force Connect and Section 2 purchases cannot complete in production. If sandbox credentials are used in production, no money moves and users see failure. Either way, paid product paths are unusable. |
| **Priority and rationale** | **P1.** Financial product correctness. It does not by itself mischarge users, so it is not P0, but it blocks all revenue and all paid unlock journeys. |
| **Dependencies** | Production Daraja credentials and shortcode/passkey; G-13 end-to-end verification; PD-2 for Qrashe price. |
| **Proposed resolution** | Derive the Daraja base URL from `MPESA_ENV` in `initiate-payment` exactly as the callback does; fail closed if the environment is unset or unknown; keep sandbox for local/staging. Verify the callback URL uses the deployed function origin and the per-intent ticket. |
| **Required acceptance test** | Staging with sandbox: STK received and callback applied. Production smoke with a minimal amount: request goes to `api.safaricom.co.ke`, STK arrives, callback verifies, intent succeeds once, unlock applied once. Unknown `MPESA_ENV` returns a configuration error and creates no intent. |
| **Decision / access needed** | Production M-Pesa credentials and a controlled live smoke authorization. |

### G-09 — Admin backend deployment and live authorization are unverified

| Field | Detail |
|---|---|
| **Related requirements** | ADM-02, ADM-04, ADM-06, ADM-07, ADM-14, ADM-15; OPS-04 |
| **Investigation findings** | F-65, F-66, F-67, F-68, F-74; investigation D-11 |
| **Evidence and source references** | `admin_users`, `admin_audit_log`, `is_admin()`, `am_i_admin()` and nine admin RPCs are defined in the working-tree consolidated chain (F-65/F-66), which is uncommitted; the precondition-table closure migration is untracked. `ADMIN-PANEL-REMEDIATION.md` records that live probes returned `PGRST202` before the SQL was run and that the runbook is partly stale, while its banner says several claims are false. No live function/migration catalog was read. |
| **Classification** | BLOCKED |
| **Impact** | If the admin chain is not applied, every admin screen fails (RPC not found), and if it is applied without review, authorization behaviour is unproven. Governance capabilities and audit records cannot be relied on. |
| **Priority and rationale** | **P1.** Admin controls protect users and payments; deployment is the gate for all admin requirements. |
| **Dependencies** | G-04 backup; read-only migration/function inspection; an admin test account; G-12 audit fix. |
| **Proposed resolution** | Read `supabase_migrations.schema_migrations`, the function catalog and `admin_users` membership. Apply the chain in the documented order only after G-04, then run the repository's static cross-check and live permission probes. Record exactly which objects exist. |
| **Required acceptance test** | All admin RPCs resolve; a non-admin direct call to each mutation returns 42501; `am_i_admin()` is true only for members; admin UI tabs load real rows; `admin_user_detail` writes one audit row per sensitive read. |
| **Decision / access needed** | Live database access, admin account, backup prerequisite. |

### G-10 — Required governance capabilities are absent from the admin surface

| Field | Detail |
|---|---|
| **Related requirements** | ADM-03, ADM-05, ADM-08, ADM-11, ADM-12, ADM-13, ADM-18 |
| **Investigation findings** | F-65, F-66, F-67; `ADMIN-PANEL-REMEDIATION.md`; direct inspection of `Admin.jsx` |
| **Evidence and source references** | `Admin.jsx:68-225` calls only `am_i_admin`, `admin_overview`, `admin_reports_list`, `admin_users_list`, `admin_matches_list`, `admin_user_detail`, `admin_add_campus`, and the campus toggles. The chain defines the same set (`:3092-3577`) plus `admin_set_maintenance_message`. There is no suspend/unsuspend/ban RPC or control, no report status/resolution/moderation action, no campus removal, no admin-role management, no audit-log read RPC/UI, no health/alert view, and no admin conversation/message access. |
| **Classification** | NOT IMPLEMENTED |
| **Impact** | Admins cannot suspend a abusive account, review who accessed sensitive data, see system health, delegate/revoke admin rights, or investigate a conversation for a safety/dispute case. The PRD's governance model is only partially operable, pushing moderation into manual dashboard/SQL work. |
| **Priority and rationale** | **P1.** These are explicit governance capabilities, not polish. Missing suspension and audit review directly affect user safety and accountability. |
| **Dependencies** | G-09 deployment; PD-7 decisions on status vocabulary, ban semantics and audit retention; G-12 audit coverage. |
| **Proposed resolution** | Define the minimum governance set with the owner, then implement server-guarded RPCs + UI: user status transitions (pause/suspend/ban) with reason and audit; report status/resolution; campus removal; admin membership add/remove; audit search/read; health/alerts read; read-only conversation access with reason + audit. Do not add a routine matching/payment control. |
| **Required acceptance test** | Each action works for an admin, returns 42501 for a normal user, refuses self-lockout, writes an audit row, and is reversible where specified. Audit search filters by admin/target/date. Conversation access requires a reason and logs it. |
| **Decision / access needed** | PD-7 product decisions; implementation authorization (not granted by this document). |

### G-11 — Campus/institution matching controls do not govern the real engine

| Field | Detail |
|---|---|
| **Related requirements** | ADM-08, ADM-09 |
| **Investigation findings** | F-33, F-66; §G-3 |
| **Evidence and source references** | `supabase/functions/match-generator/index.ts:40-43` selects every user with `section1_complete=true` and `profile_status='active'`; it never reads `campuses.matching_enabled` or `campuses.is_active`. Campus equality is enforced at pairing (`:94-96`), but the admin toggles have no effect on eligibility. The static safety check (§G-3) confirms only that campus equality exists, not that the toggles are honoured. |
| **Classification** | FAIL — Confirmed gap |
| **Impact** | An admin who disables matching for an institution or deactivates a campus still sees its users matched. The control presents a false assurance about who can be matched, which is especially sensitive for institution-scoped safety decisions. |
| **Priority and rationale** | **P1.** Eligibility is core matching correctness; the control is explicitly required by the PRD (§15, §17). |
| **Dependencies** | Decision PD-6 on semantics (does `matching_enabled=false` exclude users entirely, or only weekly delivery? Does an inactive campus exclude already-registered users?); G-07 scheduler so scheduled and manual runs behave identically. |
| **Proposed resolution** | Join `campuses` in the engine's eligible-user query and apply the approved semantics; apply the same filter to manual and scheduled runs; surface skipped counts; add fixtures for active/inactive/matching-disabled campuses and null campus. |
| **Required acceptance test** | Users on an inactive campus are excluded from pairing and delivery; `matching_enabled=false` excludes them per the approved semantics; null-campus users follow the stated rule; manual and scheduled runs produce identical eligibility; the admin UI states what the toggle affects. |
| **Decision / access needed** | PD-6. No database access for the code change; staging for execution. |

### G-12 — Administrative mutations other than sensitive reads are not audited

| Field | Detail |
|---|---|
| **Related requirements** | ADM-15, ADM-16 |
| **Investigation findings** | F-66, F-68; direct inspection |
| **Evidence and source references** | The only `insert into public.admin_audit_log` in the chain is at `:3491`, inside `admin_user_detail`. `admin_add_campus`, `admin_set_campus_active`, `admin_set_campus_matching` (`:3181-3222`) and `admin_set_maintenance_message` (`:655-686`) contain no audit write. PRD §16 and §19 require sensitive access and administrative actions to be attributable and auditable. |
| **Classification** | FAIL — Confirmed gap |
| **Impact** | Campus activation/matching changes and maintenance banners — actions that change who can be matched and what all users see — leave no record of who did them. Incident review and accountability are incomplete. |
| **Priority and rationale** | **P1.** Governance integrity; low direct user harm but high accountability impact and explicitly required. |
| **Dependencies** | G-09 admin deployment; PD-7 audit retention model; G-10 audit read UI. |
| **Proposed resolution** | Add a single audited-mutation helper (admin id from `auth.uid()`, action, target, before/after, reason where required, timestamp) and call it from every privileged admin mutation. Keep the table server-only. Do not log secrets or full contact values. |
| **Required acceptance test** | Each admin mutation writes exactly one audit row with actor/action/target/timestamp; a failed mutation writes no success row; a non-admin call writes nothing and returns 42501; audit rows are readable only through the guarded admin RPC. |
| **Decision / access needed** | PD-7 (retention/fields). Implementation authorization required. |

### G-13 — Paid flows have never been exercised end-to-end

| Field | Detail |
|---|---|
| **Related requirements** | PAY-06, PAY-07, PAY-10, PAY-12, MTM-04 |
| **Investigation findings** | F-44–F-49; §G-2, §G-10 |
| **Evidence and source references** | `verify-payment-ticket.mjs` passes 54/54 pure-decision checks (§G-2), establishing ticket screening, expiry ordering, amount matching, cache classification and the `process → retry_unlock → noop` walk. It executes no Deno runtime, no HTTP request, no Daraja call and no database write. `sandbox-transactionstatus.mjs` was not run (no M-Pesa credentials, §G-10). No STK push, callback delivery, duplicate callback, late callback or unlock read-back was observed. |
| **Classification** | UNVERIFIED |
| **Impact** | The difference between correct decision logic and a correct payment system is exactly the untested I/O: function deployment, environment secrets, callback URL reachability, database transactions and Daraja behaviour. A failure here can mean a charged user without an unlock or a false success. |
| **Priority and rationale** | **P1.** Financial integrity and the core paid journey. Not P0 because no defect is confirmed; it is an evidence gap with material financial consequence. |
| **Dependencies** | Staging project; Daraja sandbox credentials; G-08 environment fix; G-04 backup; deployed functions. |
| **Proposed resolution** | Execute a scripted matrix on staging: successful STK, wrong amount, failed STK, forged callback (no/incorrect ticket), duplicate callback, late callback after expiry, callback for an expired intent, unlock RPC decline, and Daraja redelivery. Record DB state after each. |
| **Required acceptance test** | Exactly one intent status transition per scenario; exactly one unlock/match row for success; no unlock on failure/late/forged; duplicate callback leaves one effect; `unlock_state` recorded; no charge without a corresponding effect. |
| **Decision / access needed** | Sandbox credentials, staging access, a test phone/SIM. |

---

## 3. P2 — Critical user journeys

### G-14 — Discover candidates cannot open Match Detail

| Field | Detail |
|---|---|
| **Related requirements** | DSC-04, DSC-05 |
| **Investigation findings** | F-32; direct inspection |
| **Evidence and source references** | `src/pages/Discover.jsx:105` is the only candidate navigation: `navigate('/force-connect/' + selected.id)`. There is no `/match/:userId` navigation and no profile preview. The action bar only offers "Force Connect". The PRD requires each candidate to lead to Match Detail and offers a normal wait path alongside Force Connect (§3). |
| **Classification** | FAIL — Confirmed gap |
| **Impact** | A user cannot inspect a candidate's full-body photo, bio or interests before deciding, and is steered straight into an KSh 80 paid action. The normal (free) path is reduced to explanatory text. This is a core Discover journey failure and a dark-pattern risk. |
| **Priority and rationale** | **P2.** Critical journey and product-fairness issue; no security or financial-integrity defect. |
| **Dependencies** | None for the UI change; MatchDetail already resolves a candidate by id (including Qrashe/weekly tier; for an unpaired candidate it will show a null tier, which needs a defined display). |
| **Proposed resolution** | Make the card open `/match/:userId` (or a candidate detail route) and move Force Connect to an explicit secondary action; ensure Match Detail handles a candidate who is not yet a match: no Connect or "Start Conversation" CTA until paired, no tier/contact exposure, and Force Connect remains the only paid action. Keep the five-card grid and cached board. |
| **Required acceptance test** | Tapping a card opens the correct candidate's detail; back returns to the same board/scroll; Force Connect remains reachable and distinct; no tier/contact is shown; a candidate with no tier renders correctly and exposes no Connect/Start Conversation action; a paired user still sees the normal Connect path. |
| **Decision / access needed** | Browser execution only. Possible small product decision on the exact candidate-detail CTA layout. |

### G-15 — Weekly match delivery sends no notification

| Field | Detail |
|---|---|
| **Related requirements** | NTF-02, ADM-17 |
| **Investigation findings** | F-58, F-59, F-61 |
| **Evidence and source references** | `match-generator` writes `match_history` only (F-33). No `src/` or `supabase/functions/` code calls `send-notification` (grep, F-61). `complete_force_connect` is the only `notifications` writer (F-60). The OneSignal function exists and resolves player IDs server-side, but nothing invokes it for weekly delivery. |
| **Classification** | FAIL — Confirmed gap |
| **Impact** | Users are not told that their weekly matches arrived; they must open Matches unprompted. This undermines the weekly cadence and the PRD's expectation that notifications run automatically without an administrator. |
| **Priority and rationale** | **P2.** Core engagement journey; not a correctness/security defect. |
| **Dependencies** | G-07 (a reliable weekly run to notify from); notification content/preference decision; OneSignal secrets. |
| **Proposed resolution** | After a successful delivery batch, insert one in-app notification per user (idempotent per week) and invoke the push path for users with `notifications_enabled`; cap and dedupe; do not put names or message content in push payloads beyond what the PRD permits. |
| **Required acceptance test** | One weekly run produces exactly one notification per delivered user; rerun produces none; disabled preference suppresses push; in-app row exists; failure to push does not fail matching delivery. |
| **Decision / access needed** | OneSignal credentials; content/copy approval; G-07 execution. |

### G-16 — Qrashe recipient notification has no push delivery path

| Field | Detail |
|---|---|
| **Related requirements** | NTF-01, NTF-03, MTM-05 |
| **Investigation findings** | F-39, F-58, F-59, F-60, F-61 |
| **Evidence and source references** | `complete_force_connect` inserts a `notifications` row and a bot system message (F-39), and `Home.jsx` subscribes to Realtime inserts (F-58). No code invokes `send-notification` after Qrashe creation. The OneSignal function is auth-gated and resolves recipients server-side, but is not wired to this event. |
| **Classification** | PARTIAL |
| **Impact** | A recipient sees the Qrashe only while the app is open (or on next load via the in-app row). If they are away, the paid, non-declinable connection is silent — a poor and potentially distressing experience. |
| **Priority and rationale** | **P2.** Required notification behavior, but an in-app record already exists; the missing piece is delivery. |
| **Dependencies** | OneSignal secrets; notification preference; G-09 (function deployment). |
| **Proposed resolution** | Invoke push after the Qrashe transaction commits (from the callback or a queued dispatch), respecting `notifications_enabled`; keep the in-app row as the durable record; add a retry/outbox so a push failure does not roll back the paid match. |
| **Required acceptance test** | Recipient with notifications enabled receives one push and one in-app row; disabled receives only the in-app row; duplicate callbacks produce one notification; push failure does not affect the match. |
| **Decision / access needed** | OneSignal credentials; copy approval. |

### G-17 — Read state cannot persist, and the PRD is silent on read receipts

| Field | Detail |
|---|---|
| **Related requirements** | CNV-07 (task brief area; no PRD clause) |
| **Investigation findings** | F-55, D-2 |
| **Evidence and source references** | `Chat.jsx:202-205` runs `.from('messages').update({ read: true })` for incoming messages. The consolidated chain defines only `messages_insert_own_sender` and `messages_select_participants` policies (`:1037-1082`); there is no UPDATE policy. Under RLS the update matches zero rows and fails silently. The PRD's conversation section does not mention read receipts. |
| **Classification** | DECISION REQUIRED |
| **Impact** | If read receipts are a product expectation, they are broken today. If they are not, the dead write and `read` column are misleading dead code and a latent source of confusion. |
| **Priority and rationale** | **P2.** User-visible messaging behavior, but the product requirement is undefined; it cannot be a confirmed PRD failure. |
| **Dependencies** | Decision PD-3 (are receipts in scope?); migration ownership review. |
| **Proposed resolution** | If in scope: add a narrowly scoped UPDATE policy allowing a recipient to set `read=true` only on messages addressed to them, with a column grant limited to `read`, and verify sender visibility. If out of scope: remove the update call and any read-receipt UI, and document the decision. |
| **Required acceptance test** | In scope: recipient marks only their incoming messages read; cannot alter content/sender; sender sees the state; unrelated user cannot update. Out of scope: no update call remains and the UI makes no receipt claim. |
| **Decision / access needed** | PD-3 product decision; staging for RLS execution. |

### G-18 — The Qrashe Connect price is undefined by the PRD

| Field | Detail |
|---|---|
| **Related requirements** | PAY-11 (PRD §4, §7) |
| **Investigation findings** | F-42, F-44 |
| **Evidence and source references** | `MatchDetail.jsx` maps tier1→KSh 70, tier2→KSh 50, and any other tier (including Qrashe) → `connect_qrashe` at KSh 50; `initiate-payment` prices `connect_qrashe` at 50. The PRD prices Force Connect at KSh 80 and says Qrashe uses the same downstream Connect architecture, but never states a Qrashe Connect price. |
| **Classification** | DECISION REQUIRED |
| **Impact** | Revenue and user expectations for the Qrashe follow-on unlock are unspecified. Two Qrashe users can pay KSh 80 to connect and then KSh 50 to reveal contact, but whether that is intended cannot be answered from the PRD. |
| **Priority and rationale** | **P2.** Paid journey and pricing consistency; the implementation is not demonstrably wrong, so it cannot be `FAIL`. |
| **Dependencies** | PD-2; G-08 production payment; copy in MatchDetail/Payment/PRD. |
| **Proposed resolution** | Owner confirms 50, 70, 80 or another value. Align server `PRICES`, client display, PRD text and tests in one change. |
| **Required acceptance test** | The intent amount and purpose match the approved value for both buyer directions; client copy matches; a price-change test fails if client and server diverge. |
| **Decision / access needed** | PD-2. |

---

## 4. P3 — Deployment, automation, monitoring and reliability

### G-19 — Lint fails with 25 errors

| Field | Detail |
|---|---|
| **Related requirements** | OPS-06 |
| **Investigation findings** | §G-5, D-12 |
| **Evidence and source references** | `npm run lint` exit 1: 44 problems (25 errors, 19 warnings) across 20 files (investigation §G-5). Errors include `react-hooks/immutability` findings in `Chat.jsx` (5), `Payment.jsx` (3), `Settings.jsx` (2), `Messages.jsx` (2), plus unused variables and `no-undef` for the vendored OneSignal worker. Whether the hook findings are real render-phase defects was not diagnosed (D-12). |
| **Classification** | FAIL — Confirmed gap |
| **Impact** | The repository has no green quality gate; real render-phase bugs may be hidden among rule findings; contributors cannot distinguish new regressions. |
| **Priority and rationale** | **P3.** Reliability/quality, not a direct product failure. Some hook findings could later prove user-visible. |
| **Dependencies** | None. |
| **Proposed resolution** | Triage each error: fix real defects; for the vendored worker, scope the config rather than disabling the rule globally; remove genuinely unused variables; do not add blanket suppressions. Re-run lint and build. |
| **Required acceptance test** | `npm run lint` exits 0 with no new suppressions; `npm run build` still exits 0; the changed hooks paths pass a manual smoke test. |
| **Decision / access needed** | None. |

### G-20 — Health/monitoring depends on an undefined RPC and is not end-to-end proven

| Field | Detail |
|---|---|
| **Related requirements** | OPS-02 |
| **Investigation findings** | F-73, D-8, F-75 |
| **Evidence and source references** | `supabase/functions/health/index.ts` calls `admin_stats_counts` and falls back to an `app_settings` read. `admin_stats_counts` is defined nowhere in the repository (grep, D-8). The ops tick dispatches alerts through pg_net to a Vault webhook, but delivery depends on configuration and `net._http_response`. No monitoring run was performed. |
| **Classification** | PARTIAL |
| **Impact** | Health may report `ok` on the fallback while the statistics path is broken, and alert delivery may silently fail. Operators could miss a payment or entitlement incident. |
| **Priority and rationale** | **P3.** Operational detection, not direct user-facing correctness. |
| **Dependencies** | Live deployment; Vault webhook; alert destination. |
| **Proposed resolution** | Either define `admin_stats_counts` in a tracked migration or remove the dependency and make `health` assert the real critical tables; add an explicit failure when the stats call errors; verify one dispatched alert is received and recorded. |
| **Required acceptance test** | Health returns 200 with real counts; returns 503 when a critical dependency fails; a synthetic `paid_but_not_unlocked` condition produces one received alert with delivery state recorded. |
| **Decision / access needed** | Deployment access and alert destination. |

### G-21 — Critical flows lack automated regression coverage, and existing suites were not run

| Field | Detail |
|---|---|
| **Related requirements** | OPS-07 |
| **Investigation findings** | §B.2, §G-7 … §G-10 |
| **Evidence and source references** | No unit-test framework is installed. The verification surface is eight `scripts/*.mjs` files. Four passed (schema chain, payment decisions, weekly safety, eligibility); RLS and entitlement-clamp scripts exited 2 with no local stack; the staging matcher e2e and M-Pesa harness were not run. There is no CI job that runs any of them. |
| **Classification** | PARTIAL |
| **Impact** | Security, payment and matching behavior can regress without detection; the same gaps will recur each release. Several P0/P1 claims remain unverifiable because the harness cannot run. |
| **Priority and rationale** | **P3.** Enables verification of higher-priority work; does not itself break the product. |
| **Dependencies** | Local Supabase stack; staging credentials; G-04 backup for safe fixture data. |
| **Proposed resolution** | Add a CI workflow that runs build, lint (after G-19), static suites, and a local-stack RLS/clamp suite; add a staging-only e2e job with secrets; keep the production-ref refusal. No new framework needed. |
| **Required acceptance test** | CI fails on any static-suite failure; local RLS/clamp suites run green; staging e2e produces expected matches; artifacts/logs are retained. |
| **Decision / access needed** | CI credentials/secrets; staging project. |

---

## 5. P4 — Visual quality, accessibility and usability

### G-22 — Loading/transition specification is only partly implemented

| Field | Detail |
|---|---|
| **Related requirements** | DSC-06, UIX-03, UIX-04, PAY-01 |
| **Investigation findings** | F-32, F-71 |
| **Evidence and source references** | Discover has five skeleton cards and selection feedback, but no card-exit/reposition/replacement transition (the board is only replaced by a full reload). `MatchDetail.jsx:156-157` returns a page-level `<p>Loading</p>` instead of a profile-shaped skeleton; `Section2.jsx` also uses a page-level loading line. In `Chat.jsx:662-671` the Connect CTA is above the message history rather than at the end of the conversation (PAY-01). PRD §13 requires destination-specific skeletons and localized loaders; PRD §7 requires the end-of-conversation placement. |
| **Classification** | PARTIAL |
| **Impact** | The product feels less continuous than specified; profile opening flashes a blank shell; Discover cannot express a candidate legitimately leaving the set. This is quality/perception, not a blocked journey. |
| **Priority and rationale** | **P4.** Explicit UI/UX requirements, no correctness or security effect. |
| **Dependencies** | G-14 (candidate detail route) for the replacement/transition work. |
| **Proposed resolution** | Add a Match Detail skeleton matching the final photo/bio/CTA geometry; add exit/reposition/enter transitions for a candidate removal with reduced-motion fallback; keep the five-card geometry stable; move or duplicate the in-conversation Connect CTA to the end of the message history without removing the Match Detail placement. |
| **Required acceptance test** | Opening a profile shows structure, then content, with no blank page; removing a candidate animates exit/reposition/entry or instantly updates under reduced motion; no layout shift; CLS not regressed. |
| **Decision / access needed** | Browser verification. |

### G-23 — Reduced-motion coverage is incomplete

| Field | Detail |
|---|---|
| **Related requirements** | UIX-09 |
| **Investigation findings** | Direct inspection |
| **Evidence and source references** | `@media (prefers-reduced-motion: reduce)` exists in `src/pages/Landing.css`, `src/pages/MatchCelebration.css` and `src/styles/tokens.css`, but `src/pages/Payment.css` contains animation declarations and no reduced-motion block. PRD §12 requires reduced motion to be respected. |
| **Classification** | PARTIAL |
| **Impact** | Users who request reduced motion still see payment-state animations, which can cause vestibular discomfort. |
| **Priority and rationale** | **P4.** Accessibility compliance for an explicit PRD requirement. |
| **Dependencies** | None. |
| **Proposed resolution** | Add a reduced-motion block to `Payment.css` (and audit every animation/transition source, including inline `style` animations in JSX) to disable nonessential motion while preserving state clarity. |
| **Required acceptance test** | With `prefers-reduced-motion: reduce` emulated, no nonessential animation runs on Payment, Celebration, Landing or shared components; state changes remain visible; normal mode is unchanged. |
| **Decision / access needed** | Browser verification. |

### G-24 — The intended visual system has not been reviewed as a whole

| Field | Detail |
|---|---|
| **Related requirements** | IDN-04, UIX-07, UIX-08 |
| **Investigation findings** | F-70; `src/styles/tokens.css` |
| **Evidence and source references** | Semantic tokens and component classes exist, and responsive rules exist in seven stylesheets (F-70). No rendered review was performed (investigation §C.17); no audit of hard-coded colours, typography hierarchy or cross-screen consistency was recorded. |
| **Classification** | PARTIAL |
| **Impact** | The PRD's central visual requirement — a coherent, non-AI-looking system — is unproven. Inconsistent palettes or decorative motion could undermine trust, especially around money and contact reveal. |
| **Priority and rationale** | **P4.** Visual quality and brand coherence; not functional. |
| **Dependencies** | Browser/device access; G-22/G-23 changes to avoid duplicate review. |
| **Proposed resolution** | Capture every required route at mobile and desktop widths; audit token usage vs hard-coded values; check typography, spacing, contrast, motion semantics and photography hierarchy against PRD §14/§23/§24; fix the deltas in one design pass. |
| **Required acceptance test** | A screen-by-screen checklist signed against the PRD; no off-token colours; one coherent palette; reduced motion honoured; no decorative perpetual animation; key CTAs visually distinct. |
| **Decision / access needed** | Browser access; possible design-owner sign-off. |

---

## 6. P5 — Cleanup and documentation

### G-25 — Duplicated policy constants can diverge silently

| Field | Detail |
|---|---|
| **Related requirements** | S2-01, MTM-08 (implementation integrity) |
| **Investigation findings** | D-4, D-5 |
| **Evidence and source references** | `getWeekId()` is duplicated in `match-generator` and six pages with identical logic (D-4); the 20 Section 2 questions are duplicated verbatim in `Section2.jsx` and `Chat.jsx` (D-5). No test pins either copy. |
| **Classification** | PARTIAL |
| **Impact** | A timezone or copy change in one copy can desynchronize week IDs (hiding matches) or change the guided questions for one surface only. This is a latent correctness risk, not a current failure. |
| **Priority and rationale** | **P5.** Maintainability; no current user-visible defect evidenced. |
| **Dependencies** | G-06 test harness to pin behavior. |
| **Proposed resolution** | Extract one shared week-id module and one shared Section 2 question module; import them everywhere (including the Deno function via a shared file or generated constant); add equality tests. |
| **Required acceptance test** | One definition per constant; all surfaces import it; a test fails if the week-id algorithm or question list changes without updating the fixture. |
| **Decision / access needed** | None. |

### G-26 — Operational documentation contradicts the current schema and runbook

| Field | Detail |
|---|---|
| **Related requirements** | OPS-04 (deployment readiness) |
| **Investigation findings** | investigation D-11; `ADMIN-PANEL-REMEDIATION.md` banner |
| **Evidence and source references** | `DEPLOYMENT-CHECKLIST.md` carries a banner stating 7 claims are false and 2 conflicts are unresolved (investigation D-11); `ADMIN-PANEL-REMEDIATION.md` says 5 claims are false and 4 stale and points to `docs/docs-reconciliation-2026-10-14.md`. The admin runbook still contains a "Your steps" section that refers to superseded SQL. |
| **Classification** | PARTIAL |
| **Impact** | An operator following the runbook may run retired SQL, believe admin behavior is deployed when it is not, or trust a false deployment claim — increasing the chance of a production incident during the P0 remediation. |
| **Priority and rationale** | **P5.** Documentation hygiene with operational risk; lower than the code/deployment gaps it describes. |
| **Dependencies** | G-09 (know what is actually deployed) so the docs can be made true. |
| **Proposed resolution** | After G-09/G-04, rewrite one canonical deployment runbook from verified state; mark all superseded files; remove contradictory claims; link the verification scripts and their expected outputs. |
| **Required acceptance test** | Every command in the runbook has been executed on a non-production target; every claim matches the verified state; no superseded SQL is referenced as current; the reconciliation banner is removed only after sign-off. |
| **Decision / access needed** | Verified deployment state; documentation owner. |

---

## 7. Phase E — Decisions, verification blockers and no-further-work items

### 7.1 Product decisions requiring owner approval

| ID | Decision | Why it cannot be inferred | Blocks | Recommended default (for discussion only) |
|---|---|---|---|---|
| **PD-1** | Section 1 weights and the meaning of the fourth dimension. PRD says communication + conflict ×3, emotional + "space" ×2, values ×1; implementation uses 0.30/0.25/0.20/0.15/0.10. | "Space" maps to no named dimension, and the PRD's arithmetic differs from code. | G-05, G-06 | Adopt the PRD's 3:3:2:2:1 with "relationship expectations" as the fourth dimension, unless the owner confirms the current model is newer. |
| **PD-2** | Qrashe Connect/contact-unlock price after a KSh 80 Force Connect. | PRD prices only Force Connect. | G-18, G-08 | Confirm KSh 50 (current) or align to another value. |
| **PD-3** | Are read receipts in scope? | PRD is silent; code attempts them. | G-17 | Decide explicitly; if out of scope, remove the dead update. |
| **PD-4** | May a Section 2 payment ever reveal contacts? | PRD §6–§7 says Connect payment; `get_match_contact` says yes. | G-01 | No. Section 2 is a separate product; contact reveal requires Connect. |
| **PD-5** | Backup retention, offsite destination, RPO/RTO. | The PRD is silent on backup/recovery and sets no targets; current artifacts retain 7 days. | G-04 | Data-bearing daily or weekly dump, offsite encryption, 30–90 day retention, restore drill each quarter. |
| **PD-6** | What do campus `is_active` and `matching_enabled` mean for eligibility and for already-registered users? | PRD requires "matching controls" but not their semantics. | G-11 | Inactive campus excludes new matching; matching-disabled excludes all pairing; manual and scheduled runs identical. |
| **PD-7** | Admin enforcement model: suspend vs ban states, who can grant/revoke admin, audit retention and conversation-access policy. | PRD requires the capabilities but not the policy. | G-10, G-12 | Minimum: suspend (reversible), ban (terminal), admin grant/revoke with audit, 1-year audit retention, reason required for conversation access. |
| **PD-8** | What Discover shows when fewer than five eligible candidates exist. | PRD requires exactly five cards, but eligibility can yield fewer; the implementation caps at five and can render fewer. | DSC-01 | Show the eligible cards honestly, state the cadence, and open the next window; do not pad with ineligible users or fabricate profiles. |
| **PD-9** | Is Section 2 free, or a KSh 200 product with a guided-chat paywall? | The PRD describes Section 2 as guided/display and does not specify payment; the implementation contains a KSh 200 `section2` purpose and gates guided questions behind it. | S2-03, CNV-01 | Keep the questionnaire free to answer; if the paywall is intentional, state it in the PRD and make the paywall copy explicit. |

### 7.2 Runtime verification requiring staging or database access

| ID | Evidence needed | Resolves | Minimum acceptable evidence |
|---|---|---|---|
| **B-1** | Read-only live catalog: tables, columns, grants, policies, views, functions, triggers, cron, migration history. | G-02, G-03, G-07, G-09; many `UNVERIFIED` rows | `inspect_state.sql` output plus `cron.job`/`cron.job_run_details` and deployed function list, captured read-only with a timestamp. |
| **B-2** | A local Supabase stack with the chain applied. | G-02, G-03, CNV-04/05, ADM-14 | `verify-rls-closure.mjs` and `verify-entitlement-clamp.mjs` exit 0; cross-user probes denied. |
| **B-3** | Staging project + anon keys. | G-06, G-13, G-21 | `e2e-matching-test.mjs` completes and asserts expected `match_history`; no production ref used. |
| **B-4** | Daraja sandbox credentials + test SIM. | G-13 | Successful, failed, duplicate, late and forged callback scenarios each produce the expected DB state. |
| **B-5** | Deployed Edge Function versions and secret names. | G-07, G-08, G-09 | Function list with versions/timestamps; secret names present (values never printed); `MPESA_ENV` and callback URL inspected. |
| **B-6** | Admin account + deployed admin RPCs. | G-09, G-10, G-12 | Non-admin 42501 probes; admin panel loads; audit rows written. |
| **B-7** | Browser/device session. | G-14, G-16, G-22, G-23, G-24 | Route-level checks at mobile and desktop; reduced-motion emulation; screenshot/record evidence. |
| **B-8** | Backup target and isolated restore environment. | G-04 | Data-bearing dump + successful restore with matching counts. |

### 7.3 Deployment / credential dependencies

- `SUPABASE_DB_POOLER_URL` (Actions secret; owner-entered, never in chat) — G-04.
- Production/staging Supabase URL + anon key — B-1/B-3.
- M-Pesa consumer key/secret, shortcode, passkey, initiator credentials — G-08/G-13.
- OneSignal app ID + REST key — G-15/G-16.
- Admin membership row for a controlled test account — G-09/B-6.
- Vault `OPS_ALERT_WEBHOOK_URL` and a receiving endpoint — G-20.
- A private repository (required by the backup workflow's own header) — G-04.

### 7.4 Requirements needing no further work (sufficient evidence exists)

These are the matrix's `PASS — Verified` rows. "No further work" means no further **evidence** is needed for the requirement as stated; it does not waive runtime testing of adjacent behavior, and it does not authorize a deployment.

| Area | Requirements | Evidence basis |
|---|---|---|
| Institution independence | IDN-01, IDN-02, IDN-03 | Repository-wide absence check + configurable campuses; no product-file institution reference. |
| Interests/retake journeys | ONB-05, ONB-06 | Route logic and Profile links inspected; edit path does not enter Section 1. |
| Two-photo model | PRF-01, PRF-02, PRF-03 | Two fixed slots, submit guard, full-body hero. |
| Section 1 inventory and mapping | S1-01, S1-02 | 50×4 executed import; 10-per-dimension data labels aligned with engine ranges and index mapping. |
| Section 2 structure | S2-01, S2-02, S2-04 | 20 questions counted; separate table; no engine reference. |
| Discover card content | DSC-02, DSC-03 | Only name/age/facial photo rendered; no tier/contact fields fetched. |
| Match model and navigation | MTM-01, MTM-06, MTM-07, MTM-10, NAV-01, NAV-02, NAV-03, NAV-04 | Distinct tables, three sections, same detail path, executed eligibility assertions, four-tab nav, Profile/Settings links. |
| Connect surface and price authority | PAY-05, PAY-08 | Distinct purposes; server `PRICES` only. (PAY-01 moved to PARTIAL because the in-conversation CTA is above the message history.) |
| Build | OPS-05 | `npm run build` exit 0. |

**Caveats:** PASS for ONB-05/06, PRF-01…03, NAV-01…04 is based on deterministic source/route inspection, not a browser session. PASS for IDN-01/02/03 is a content-absence check over tracked product files, not a rendered or deployed-site crawl. PASS for MTM-10 and S1-01 is executed-script evidence. None of these authorizes a claim that the deployed site behaves the same.

---

## 8. Phase F — Proposed implementation order (not authorized)

Each package is intentionally small. No package may begin without explicit owner authorization; packages that touch the database also require G-04 (backup/restore) to be complete. All acceptance tests are mandatory exit criteria, not suggestions.

### WP-01 — Read-only evidence baseline

| Field | Detail |
|---|---|
| **Scope / requirements** | Establish the facts currently marked `BLOCKED`: PRF-07, PAY-02/03, S2-03, MTM-08, ADM-02…ADM-18, OPS-04. |
| **Gaps addressed** | G-02, G-03, G-07, G-09 (classification only). |
| **Prerequisites** | Read-only production or exact staging access; no writes. |
| **Expected changes** | None to product code or data. Produce an evidence sheet: catalog objects, grants, policies, cron jobs, function versions, migration history, secret names, admin membership. |
| **Acceptance tests** | Every `BLOCKED` row is reclassified with a timestamped artifact; no write statement executed; evidence stored with the register. |
| **Regression risks** | None (read-only); risk is misreading a staging project as production — name the project ref explicitly. |
| **Rollback / recovery** | Not applicable. |
| **Exit criteria** | A reviewed evidence annex exists and the matrix is updated; no claim remains based on inference. |

### WP-02 — Recoverable backup and tested restore

| Field | Detail |
|---|---|
| **Scope / requirements** | OPS-01, OPS-03. |
| **Gaps addressed** | G-04. |
| **Prerequisites** | Production pooler credential; isolated Postgres; PD-5 retention decision. |
| **Expected changes** | Secret configured; manual data-bearing dump; restore into isolation; offsite retention; schedule enabled only after a successful drill. |
| **Acceptance tests** | Dump contains data; restore row counts match; a scheduled run produces a new artifact; restore steps timed and recorded. |
| **Regression risks** | Dump may contain personal data — repository must stay private; artifact access restricted; no secret in logs. |
| **Rollback / recovery** | Keep the previous artifact; do not delete any backup until a newer restore is proven. |
| **Exit criteria** | One verified data-bearing backup + documented restore, approved by the owner. |

### WP-03 — Contact-reveal containment

| Field | Detail |
|---|---|
| **Scope / requirements** | PRF-07, PAY-02, PAY-03; S2-03. |
| **Gaps addressed** | G-01 (fix), G-02/G-03 (verify and, if needed, apply ownership enforcement). |
| **Prerequisites** | WP-01, WP-02, PD-4. |
| **Expected changes** | Remove/rewrite `get_match_contact`; make `get_unlocked_contacts` the sole reveal path; enforce share-flag snapshots; add/verify owner-only RLS for Section 2 tables; update `inspect_state.sql` assertions. |
| **Acceptance tests** | The five tests in G-01; cross-user Section 2 denial; `verify-rls-closure.mjs` and `verify-entitlement-clamp.mjs` pass on a local stack; no contact field readable without a Connect snapshot. |
| **Regression risks** | Legitimate buyers lose contact display if the snapshot query is wrong; Chat/Match Detail contact card breaks; migration ordering affects profile reads. |
| **Rollback / recovery** | Revert the function to the previous definition (behind an approved change record); restore from WP-02 if a data change is involved. Never re-open the Section 2 branch. |
| **Exit criteria** | P0 privacy tests green on staging + local stack; deployment verified; matrix rows updated. |

### WP-04 — Production payment environment

| Field | Detail |
|---|---|
| **Scope / requirements** | PAY-06, PAY-07, PAY-09, PAY-10, PAY-12, MTM-02/03. |
| **Gaps addressed** | G-08, G-13; G-18 after PD-2. |
| **Prerequisites** | WP-02; PD-2; M-Pesa sandbox + production credentials; staging deployment. |
| **Expected changes** | Environment-derived Daraja base URL with fail-closed config; unified OAuth/STK/callback base handling; scripted scenario harness. |
| **Acceptance tests** | Sandbox success/failure/duplicate/late/forged/amount-mismatch matrix; one effect per success; no effect on failure; production smoke under controlled authorization. |
| **Regression risks** | Wrong environment selection could send live traffic to sandbox or vice versa; callback URL/ticket mismatch; duplicate charges if the consume guard is altered. |
| **Rollback / recovery** | Feature flag/env revert to last known configuration; no schema rollback expected; refunds handled operationally if a live smoke misfires. |
| **Exit criteria** | Documented scenario results, one controlled production smoke, no double charge, P1 payment gap closed. |

### WP-05 — Section 1 weighting and 50-question proof

| Field | Detail |
|---|---|
| **Scope / requirements** | S1-03, S1-04, S1-05. |
| **Gaps addressed** | G-05, G-06. |
| **Prerequisites** | PD-1; WP-02; staging for e2e. |
| **Expected changes** | Approved weight constants in one place; per-question dimension tests; 50-answer persistence test; staging e2e ranking fixture. |
| **Acceptance tests** | 50/50 dimension assertions; weights sum to 1; two-user fixture yields the expected tier ordering; test fails on reorder. |
| **Regression risks** | All rankings and tier assignments shift; historical matches remain but new ones differ; communicated as a planned product change. |
| **Rollback / recovery** | Revert constants; keep tests; no data migration required (scores are recomputed per run). |
| **Exit criteria** | Approved weights implemented and proven; matrix S1 rows move to PASS/verified. |

### WP-06 — Admin deployment, authorization and audit completeness

| Field | Detail |
|---|---|
| **Scope / requirements** | ADM-02…ADM-16, ADM-18; OPS-04. |
| **Gaps addressed** | G-09, G-10, G-12 (and G-26 partially). |
| **Prerequisites** | WP-01, WP-02; PD-7; admin test account. |
| **Expected changes** | Apply the admin chain (after backup); add audit writes to every privileged mutation; add the approved governance capabilities (status actions, role membership, audit read, health view, reason-gated conversation read); update the runbook. |
| **Acceptance tests** | Non-admin 42501 on every mutation; admin actions succeed; one audit row per action; audit search works; suspension reversible; conversation access reason-logged; admin UI loads live data. |
| **Regression risks** | Over-broad admin RPCs could expose data; status transitions could lock out legitimate users; audit writes could fail a mutation if not isolated. |
| **Rollback / recovery** | Revert the migration (idempotent chain) and restore from WP-02 if data changed; keep audit rows append-only. |
| **Exit criteria** | Governance requirements verified on staging with two roles; deployment state documented. |

### WP-07 — Weekly matching schedule and notifications

| Field | Detail |
|---|---|
| **Scope / requirements** | MTM-08, MTM-09, NTF-01/02/03, ADM-17. |
| **Gaps addressed** | G-07, G-15, G-16; G-11 after PD-6. |
| **Prerequisites** | WP-02, WP-04 (deployed functions), WP-06 (admin/monitoring), PD-6. |
| **Expected changes** | Scheduler targeting `match-generator`; campus filters per PD-6; per-week notification insert + push dispatch with idempotency; health/run log; legacy job removal. |
| **Acceptance tests** | Scheduled run delivers expected `match_history`; rerun idempotent; one notification per user; disabled preference suppresses push; no legacy job invocation; failure visible. |
| **Regression risks** | A bad schedule could spam or double-deliver; campus filter could exclude too many users; notification failure could affect delivery. |
| **Rollback / recovery** | Disable the schedule; revert to manual trigger; notifications are append-only and can be soft-disabled. |
| **Exit criteria** | One unattended weekly cycle observed end-to-end with evidence. |

### WP-08 — Discover → Match Detail journey

| Field | Detail |
|---|---|
| **Scope / requirements** | DSC-04, DSC-05, DSC-06. |
| **Gaps addressed** | G-14; G-22 partially. |
| **Prerequisites** | Browser access; no database change. |
| **Expected changes** | Card opens candidate detail; Force Connect becomes an explicit secondary action; candidate detail handles no-tier state; preserve cache/scroll. |
| **Acceptance tests** | Card → correct detail; back restores board; Force Connect still works; no contact/tier leak; keyboard activation works. |
| **Regression risks** | A candidate detail route could expose data not intended for non-matches; ensure it uses only `profiles_public` fields and photos. |
| **Rollback / recovery** | Revert the route change; no data impact. |
| **Exit criteria** | The PRD path works in a browser on mobile and desktop. |

### WP-09 — Conversation read-state decision and lifecycle verification

| Field | Detail |
|---|---|
| **Scope / requirements** | CNV-04, CNV-05, CNV-07, CNV-08. |
| **Gaps addressed** | G-17; lifecycle rows remain `UNVERIFIED` until B-2. |
| **Prerequisites** | PD-3; WP-02; local stack. |
| **Expected changes** | Either a scoped UPDATE policy + column grant and receipt UI, or removal of the dead update; local-stack tests for lock/archive/visibility. |
| **Acceptance tests** | Chosen read-state behavior passes; locked pair cannot insert; messages older than 7 days hidden; rows retained; participant-only select. |
| **Regression risks** | A broad UPDATE policy could let users alter message content; restrict columns and rows. |
| **Rollback / recovery** | Drop the policy/column grant; revert UI; no data loss. |
| **Exit criteria** | Decision implemented and tested; CNV rows updated. |

### WP-10 — Quality gates, loading, reduced motion and visual coherence

| Field | Detail |
|---|---|
| **Scope / requirements** | OPS-06, UIX-03/04/07/08/09, DSC-06, IDN-04. |
| **Gaps addressed** | G-19, G-22, G-23, G-24. |
| **Prerequisites** | WP-08; browser access. |
| **Expected changes** | Lint fixes; profile skeleton; card exit/replacement; Payment reduced-motion; token/colour audit; cross-screen design pass. |
| **Acceptance tests** | Lint 0; build 0; reduced-motion verification; no layout shift; design checklist signed; no off-token colours. |
| **Regression risks** | Broad lint autofixes can change behaviour; animation changes can affect perceived performance. |
| **Rollback / recovery** | Revert per-file; visual changes are code-only. |
| **Exit criteria** | Green gates and approved visual review. |

### WP-11 — Documentation and duplicated-constant cleanup

| Field | Detail |
|---|---|
| **Scope / requirements** | OPS-04, S2-01, MTM-08 (integrity). |
| **Gaps addressed** | G-25, G-26. |
| **Prerequisites** | WP-06 verified deployment state. |
| **Expected changes** | One canonical runbook; superseded docs marked; shared week-id and Section 2 question modules; tests. |
| **Acceptance tests** | Runbook commands executed on a non-production target; one definition per constant; tests pass. |
| **Regression risks** | Extracting shared modules into Deno edge code can break imports; verify bundling. |
| **Rollback / recovery** | Revert modules; docs are versioned. |
| **Exit criteria** | Docs match verified state; duplication removed with tests. |

### 8.1 Dependency order

```
WP-01 (read-only baseline) ─┬─► WP-03 (privacy containment) ─► WP-09 (conversation)
WP-02 (backup/restore) ─────┘        ▲
                                     │ PD-4
WP-04 (payments) ◄── PD-2            │
WP-05 (scoring) ◄── PD-1             │
WP-06 (admin) ◄── PD-7 ──────────────┘
WP-07 (schedule/notifications) ◄── WP-04, WP-06, PD-6
WP-08 (Discover journey) — independent
WP-10 (quality/visual) ◄── WP-08
WP-11 (docs/cleanup) ◄── WP-06
```

**First package:** WP-01, because four P0/P1 gaps cannot be classified without it and it changes nothing. **First change-adjacent package:** WP-02, because every database change (including the P0 privacy fixes) must be preceded by a proven restore.

---

## 9. Document control

- Gap IDs are stable; requirement IDs match the compliance matrix exactly.
- One gap per root cause. Related symptoms (for example the Section 2 payment branch and the share-flag bypass) are linked under G-01 rather than split.
- No gap record asserts runtime behavior that was not observed; `BLOCKED`/`UNVERIFIED` are used where evidence is missing.
- No implementation is authorized. No code, migration, test, configuration, database or deployment was changed in producing this register.
