# Documentation reconciliation — 2026-10-14

**What this is.** `ADMIN-PANEL-REMEDIATION.md`, `DEPLOYMENT-CHECKLIST.md` and
`SECURITY-REPORT.md` checked against the code as it is now: every claim marked,
every still-unchecked deployment item named. The three documents themselves get
a one-line banner pointing here; the detail lives here rather than as inline
edits, because the corrections cross document boundaries.

**Method.** Claims were read against `supabase/migrations/20261014150000_consolidated_schema_chain.sql`
(the single SQL entrypoint, cited as `chain:NNNN`), `src/`, `supabase/functions/`,
`supabase/sql/`, `vercel.json`, the git history, and — where a live answer was
cheap — the local stack (PostgREST + SQL as of today). `npm run build` was run
again (exit 0). Nothing here is inferred from a document: every verdict names the
line that decides it.

**Legend**

| mark | meaning |
|---|---|
| ✅ TRUE | verified now |
| 🕗 STALE | was true (or was a prediction); the code has moved on |
| ❌ FALSE | contradicts the code as it is |
| ❓ UNVERIFIED | needs the deployed project / dashboard / vendor console |

**Headline counts** — ADMIN-PANEL: 5 false, 4 stale, 2 unverified ·
SECURITY-REPORT: 4 false, 14 stale, 2 unverified · DEPLOYMENT-CHECKLIST: 7 false
(one of them partial), 2 conflicting, and all 33 unchecked items still
unverified — five of which cannot pass as written (3.3, 5.1, 6.1, 6.2, 6.4).

---

## 1. `ADMIN-PANEL-REMEDIATION.md`

| # | line | claim (short quote) | mark | evidence / correction |
|---|---|---|---|---|
| A1 | 3 | "code-complete, `npm run build` ✓" | ✅ | Re-run today: `npm run build` exit 0 (vite build, 44.6 s). |
| A2 | 5 | "`supabase/sql/admin_role.sql` (v2 — rewritten)" | 🕗 | File now at `supabase/sql/superseded/admin_role.sql`; folded into the chain (`chain:2762`). |
| A3 | 7 | "All 3 campus mutation RPCs … verify `is_admin()` inside the function body" | ✅ | `chain:2916` (`admin_add_campus`), `chain:2936` (`admin_set_campus_active`), `chain:2958` (`admin_set_campus_matching`) — each starts with `if not public.is_admin() then raise exception 'Forbidden'`. |
| A4 | 8 | "This single idempotent file creates: `admin_users` … `admin_matches_list()`" | 🕗 | The file is retired; every named object now exists in the chain (`admin_users` `chain:2790`, `admin_audit_log` `chain:2804`, `is_admin()` `chain:2820`, `am_i_admin()` `chain:2828`, `admin_overview()` `chain:2836`, `admin_users_list()` `chain:2978`, `admin_user_detail()` `chain:3068`, `admin_matches_list()` `chain:3245`). |
| A5 | 9 | "`admin_overview` payments now read **`payment_intents`** (… M-Pesa receipt)" | ❌ | The function selects `pi.mpesa_receipt` (`chain:2880`), but **no file in this repository creates that column**: the chain's table has `mpesa_transaction_id text unique` (`chain:296`), as does the superseded original (`superseded/remediation_bundle.sql:19`). Live proof: `select pi.mpesa_receipt from public.payment_intents limit 1;` → `ERROR: column pi.mpesa_receipt does not exist` (42703). `admin_overview()` therefore raises at call time — see §4.1. The legacy-merge half of the claim (tagged `legacy`) is ✅ (`chain:2890-2905`). |
| A6 | 10–11 | inline errors on admin actions; "↻ Refresh" | ✅ | `Admin.jsx:229` (`Failed to set ${label}: …`), `Admin.jsx:286` (`↻ Refresh`). |
| A7 | 13–14 | Users tab / user detail shapes | ✅ | `admin_users_list` 25/page + name/email search + sort (`chain:2978-3060`); detail requires a ≥4-char reason and writes `admin_audit_log` (`chain:3068-3145`). |
| A8 | 15 | "Matches tab — every match record (Tier 1 / Tier 2 / Qrashe)" | ❌ | `matches_tier_check` allows only `tier is null or tier = 'qrashe'` (`chain:1237-1238`), so the UI's Tier 1 / Tier 2 filters (`Admin.jsx:522`) can never return a row. Weekly Tier 1/Tier 2 live in `match_history` (written by `match-generator`), not `matches`. |
| A9 | 16 | stats add `totalMatches`, `pendingPayments`, `openReports` | ✅ | Keys exist (`chain:2845-2860`) — but unreachable while A5 holds. |
| A10 | 20 | "Repointed to `match-generator` … the per-campus `matching_enabled`/`is_active` flags govern the weekly cron schedule, not this manual run (note shown in the UI)" | ❌ | Repoint ✅ (`Admin.jsx:241` `functions.invoke('match-generator')`). Flags: **no code reads `matching_enabled`/`is_active` for matching** — they are written by the admin RPCs (`chain:2953`, `chain:2973`) and recorded by the ledger trigger, and read by the admin UI only. The UI hint says merely "Covers all campuses" (`Admin.jsx:356-360`); `inspect_state.sql:540` states the matcher's schedule is external to the repo. And a second defect (§4.3): `match-generator` has **no CORS/OPTIONS handling**, so the browser call from the admin panel fails preflight — "Run Matching Now" cannot work as shipped. |
| A11 | 21 | "`run-weekly-matching` … retired and deleted … no cron or code callers found" | ✅ / ❓ | In-repo ✅: the only mentions are `inspect_state.sql`'s retired-job check (`:540-542`, `:788-810`); nothing in `src/` or `supabase/functions/` calls it. The *deployed* copy ❓ (checklist 2.4). |
| A12 | 23–26 | runbook order: run `remediation_bundle.sql`, then `admin_role.sql` | 🕗 | Both are in `superseded/` and the checklist now *forbids* running them (`DEPLOYMENT-CHECKLIST.md:37-42`). The entrypoint is the chain. The precondition it states (payment_intents must exist before the admin stage) is real and satisfied by the chain's own ordering (table at `chain:276`, admin stage at `chain:2762`). |
| A13 | 29–30 | "Static cross-check script: all 8 RPC names/signatures/params match JSX↔SQL; every RPC body contains its own `is_admin()` guard" | ❌ | No such script is in `scripts/` (5 files, none checking JSX↔SQL). And the "every RPC guards" claim is false for `admin_reports_list` (`chain:642-676`): its body has **no** `is_admin()` guard, and its EXECUTE is revoked from `authenticated` (`chain:677`), yet `Admin.jsx:117` calls it with the admin's own session → `42501` (see §4.2). |
| A14 | 31 | "Live probes (current DB): RPCs not yet applied → `PGRST202` on all calls, as predicted" | 🕗 | Historical. The RPCs exist now; the local stack converges from the chain (`check-schema-chain.mjs` 86/86, `verify-entitlement-clamp.mjs` 13/13 today). |
| A15 | 32 | "`photos` read via `photo_type in ('facial','full_body')`; `user_responses` read as one-row-per-user (1-based index)" | ✅ | `chain:3131`; `user_responses.responses_array` is `text[]` (verified live). |
| A16 | 37 | "If `admin_overview` errors after deployment, check the run order above (missing `payment_intents`)" | ❌ | Misdiagnosis: the table exists; the error is the missing `mpesa_receipt` column (A5). |
| A17 | 38 | "Reports have no status column → the stat is 'Reports Filed'" | ✅ / ❓ | Label ✅ (`Admin.jsx:583`); but the reports *list* that the tab loads cannot be read by an admin session (A13/§4.2), so the tab is non-functional. |

---

## 2. `SECURITY-REPORT.md`

| # | line | claim (short quote) | mark | evidence / correction |
|---|---|---|---|---|
| S1 | 5–7 | "run the 4 SQL files, redeploy 5 edge functions" | 🕗 | One SQL entrypoint (the chain) and four deploys + one deletion (`DEPLOYMENT-CHECKLIST.md:11`, `:150-154`). |
| S2 | C1 (39-41) | hardcoded admin password | ✅ code / 🕗 status | No `ADMIN_PASSWORD`, `minglemate-admin-2025` or JWT literal in `src/`, `index.html` or `vercel.json` (grep empty). "SQL must still be run" → the SQL exists as the chain; deployment ❓. |
| S3 | C2 | "client-set price ✅ Fixed" | ✅ | `PRICES` map server-side (`initiate-payment/index.ts:23-31`), amount sent to Daraja from it (`:230`). |
| S4 | C3 | "phone-keyed unlock ✅ Fixed" | ✅ / 🕗 path | Callback keys on the intent, not the payer's phone (`payment-callback/index.ts:100-130`); the named file is superseded. |
| S5 | C4 | "unauthenticated STK spam ✅ Fixed" | ✅ | JWT required (`initiate-payment/index.ts:41-58`), 5 pushes/hour/user (`:33-34`, `:158-168`), Kenyan phone regex (`:35`, `:74-81`). |
| S6 | C5 | "broken signup ✅ Client fixed — pending SQL trigger"; body: "login is OTP-only with `shouldCreateUser:false`" | 🕗 / ❌ | Trigger is in the chain (`handle_new_user` `chain:2023` + `on_auth_user_created` `chain:2048`), so "pending SQL" is stale, and `Signup.jsx:46-60` already tolerates the duplicate upsert (logged, never blocking) ✅. But the login description is **false now**: login is `signInWithPassword` + Turnstile (`Login.jsx:31-56`), with a resend-then-verify path for unconfirmed emails (`:38-48`) and one generic failure message (`:50-53`). Note: that fallback upsert writes `created_at` from the browser (`Signup.jsx:53`) — relevant to the audit's F6. |
| S7 | H1 (67-71) | "✅ Fixed — `harden_profile_reads.sql` (`get_match_contact`), `Chat.jsx`, `Matches.jsx`" | 🕗 + overstated | File superseded; the chain carries the grants and RPCs (`chain:1634`, `chain:1881-1898`, `chain:1541`). `get_match_contact` is more correct than when written (`chain:1664`) but is **called by nothing in `src/`** — the pages use `get_unlocked_contacts` (`Chat.jsx:196`, `MatchDetail.jsx:104`). And "Fixed" overstates: for a matched pair, contacts are still obtainable by fabricating `questions_discussed` (audit F3). |
| S8 | H2 (74-80) | table "✅ Fixed (JWT + server-side player lookup)"; body "`send-notification` **still needs** an auth check" | 🕗 (self-contradiction) | The code has the auth check and the server-side lookup (`send-notification/index.ts:31-72`) — the body text is stale. Residual not in the report: no caller-recipient relationship check, so any authenticated user can push to any 10 users (audit, "Adjacent"). |
| S9 | H3 | "✅ Removed from code — token burned in history, rotate" | ✅ / ❓ | Code clean (see S2). Rotation state ❓ (checklist 4.3). |
| S10 | H4 | "`.env` in history ⚠️ deferred … verify names match the deployed env" | ✅ | Still deferred. The named-env concern resolves: code reads `VITE_SUPABASE_ANON_KEY` (`src/supabaseClient.js:4`) and `.env` defines exactly that name; its value is an `sb_publishable_*` key, which the REST/auth endpoints accept. |
| S11 | H5 (91-96) | "✅ Fixed — admin/service guard in **both** functions" | ✅ / 🕗 | Guard ✅ (`match-generator/index.ts:12-34`: service key, else admin membership). "Both" is stale — only `match-generator` exists. |
| S12 | H6 | "dead unsafe util ✅ Deleted" | ✅ | `src/utils/` contains only `imageResize.js`. |
| S13 | H7 | "spoofable chat sender … ✅ **Pending SQL**" | 🕗 | SQL now exists: `messages_insert_own_sender` requires `sender_id = auth.uid()` (`chain:886-905`). Residual (audit F5): the policy constrains the *sender* only — `recipient_id` may be any non-blocked user. |
| S14 | H8 | "self-granted unlock … ✅ **Pending SQL**" | 🕗 | SQL exists: `enforce_contacts_unlocked` re-derives `contacts_unlocked` (`chain:369-396`). Residual (audit F3): the number it derives from, `questions_discussed`, is client-written. |
| S15 | M1 | "photo upload limits ✅ Fixed — `Photos.jsx` (magic bytes + 5 MB cap)" | ✅ / ❌ as "finding closed" | True in `Photos.jsx` (`:59-61` magic bytes, `:68` 5 MB cap). The **onboarding** upload path, `PhotoUpload.jsx` (reached from `ProfileSetup.jsx:109`), has neither a size cap nor a sniff (only `console.error`, `:72`) — the finding is half closed. |
| S16 | M2 | "No rate limiting anywhere beyond Supabase auth defaults" | 🕗 | Messages 60/h (`chain:528-556`), payment intents 30/h (`chain:566-580`), STK 5/h (`initiate-payment/index.ts:33-34`, `:158-168`). |
| S17 | M3 | "both matching functions verify admin" | 🕗 | One exists (S11). |
| S18 | M4 | "callback replay ✅ … unique txn constraints" | ✅ | `payment_intents.mpesa_transaction_id text unique` (`chain:296`), `token_purchases_txn_unique` (`chain:320`), `processed_payment_callbacks` (`chain:2160`). |
| S19 | M5 | "all-rows users SELECT ✅ Column grants applied in SQL" | ✅ / 🕗 path | Grants in the chain (`chain:1634` revoke, `chain:1881-1898` column list, `display_phone` revoked at `:1900`). No page reads another user's contact columns (grep). |
| S20 | M6 | "account enumeration ✅ Fixed — `Login.jsx` generic OTP message" | ✅ / 🕗 wording | Generic message ✅ (`Login.jsx:50-53`). The flow it describes (OTP request) is the pre-change one — login is password-based now; the code screen the report means is `VerifyCode.jsx` for signup confirmation. |
| S21 | M7 | "CORS `*` ✅ Fixed — per-origin CORS in **all** client-facing functions" | ❌ | Only `initiate-payment` (`:6-20`, `:35`) and `send-notification` (`:5-19`, `:26`) handle CORS/OPTIONS. **`match-generator` has none** (no OPTIONS branch, no `Access-Control-Allow-*` — grep empty) and is called from the browser by `Admin.jsx:241`. `health` has none too. `payment-callback` is server-to-server, so it is correctly exempt. |
| S22 | L1 | "console.log of storage paths ✅ Fixed" | ✅ | No `console.*` in `Photos.jsx`. |
| S23 | L2 | "security headers ✅ Fixed — `vercel.json` (CSP + XFO + nosniff)" | ❌ (CSP half) | XFO / nosniff / Referrer-Policy / Permissions-Policy ✅ (`vercel.json:10-13`), but the CSP is emitted as **`Content-Security-Policy-Report-Only`** (`vercel.json:15`), not `Content-Security-Policy` — nothing is enforced, and checklist 3.3's expectation of a `content-security-policy` header can never be met as written. |
| S24 | table, last row | "Storage bucket policies ⚠️ Dashboard setting — verify `auth.uid()/*` scoping manually" | 🕗 + wrong object | The chain defines the policies it asks you to verify — for bucket **`profile_photos`** (`chain:3303`, `:3308-3338`). The app reads and writes **`user-photos`** (`PhotoUpload.jsx:68`, `Photos.jsx:88-101`). The manual check as written would verify a bucket the product does not use (audit F9). |
| S25 | 21-24 | "Authentication is functionally broken … masks the worse issues" | 🕗 | Predates the chain's trigger/policies; the signup path is exercised by `verify-entitlement-clamp.mjs` (accounts created, profile rows granted the trial). |
| S26 | 130-141 | priority order naming `fix_rls.sql`, `harden_profile_reads.sql`, `admin_role.sql`, "both matching functions" | 🕗 | All superseded paths. |
| S27 | 143 | "demo user `buffy.tester@student.egerton.ac.ke` … safe to delete" | ❓ + conflict | The checklist names `buffy.tester@student.university.ac.ke` (`:189`) — the two documents disagree on the domain, and neither can be checked from here (the local stack's leftovers are `otptest1-3@example.com`). |

---

## 3. `DEPLOYMENT-CHECKLIST.md`

### 3a. Claims in the checklist

| # | line | claim (short quote) | mark | evidence / correction |
|---|---|---|---|---|
| D1 | 5 | "exactly one SQL entrypoint … idempotent" | ✅ | One file in `supabase/migrations/`; `check-schema-chain.mjs` 86/86; applied live today. |
| D2 | 16 | "It replaces the **eleven** hand-ordered steps this checklist used to list" | ❌ | The previous version (git `HEAD:DEPLOYMENT-CHECKLIST.md`) lists **nine** SQL/admin steps (1.1–1.9), and the paragraph's own enumeration spans **15** retired files — the chain carries 15 `folded from` blocks (`grep -c "folded from" chain` = 15). |
| D3 | 22-33 | "Every object those files declared two or three times … is now defined exactly once" | ✅ (named objects) | Counts in the chain = 1 for `matches`, `enforce_message_rate_limit`, `processed_payment_callbacks`, `my_profile()`, `profiles_public`, `handle_new_user()`. Nuance: the same section still repeats two RLS enables (`user_responses` `chain:148`/`242`, `matches` `chain:790`/`1340`) — harmless, but "exactly once" is not literal. |
| D4 | 34-41 | "`user_blocks` and `public.reports` now exist before the messages policies and `admin_reports_list()`" | ✅ | Tables + enables at `chain:423-480`; `admin_reports_list()` at `chain:642`; messages policies at `chain:886`. |
| D5 | 44-49 | preconditions list; "`match_history` … three functions read it and no file in this repository creates it" | ✅ | Readers `chain:967` (`discover_candidates`), `chain:985` (`users_are_paired`), `chain:1690` (`get_match_contact`); plus `match-generator`. No `create table … match_history` outside the scratch fixture. |
| D6 | 37-42 | "`harden_resilience.sql` … re-creates `enforce_message_rate_limit` counting by `messages.created_at` — a column that does not exist — so every message insert fails with 42703" | ✅ | `superseded/harden_resilience.sql:51-62` counts `m.created_at`; the chain counts `m.sent_at` (`chain:538`); `messages` has no `created_at`. The instruction "do not run them" is well founded. |
| D7 | 52-90 | entitlement-evidence stage description | ✅ | Verified live today: recorder on all seven paths, ledger rows with reasons, anomaly view; `verify-entitlement-clamp.mjs` 13/13, exit 0. |
| D8 | 75-88 | ops tick / Vault / `net._http_response` read-back | ✅ | `cron.schedule('payment-ops-tick', '*/5 * * * *', …)` with the pg_cron-missing notice (`chain:2746`, `:2751`); delivery read-back in `dispatch_ops_alerts()`. |
| D9 | 95-119 | `inspect_state.sql` is read-only and answers from catalogs | ✅ | No DDL/DML statement starts in the file; `08 CRON` row at `inspect_state.sql:817`; matcher jobs at `:540`. |
| D10 | 120-143 | the verify block's spot checks | ✅ | Live: `responses_array` is `text[]`; `matches` has `matches_status_check`/`matches_tier_check`/`matches_distinct_pair_check`/`matches_unique_pair` with only `matches_select_participant` in `pg_policies`; `payment_intents` has zero policies; `on_auth_user_created` + `trg_contacts_unlocked` exist; the ticket/unlock columns and `payment_intent_anomalies` are present. Not covered by this block: `admin_overview()` and `admin_reports_list()` (see §4). |
| D11 | 148, 162 | "requires … `supabase link --project-ref mhdjnhiqahsllbczbzpk`"; curl against that ref | 🕗 **conflict** | `supabase/.temp/linked-project.json` says the CLI is linked to **`ifiewinipbxxfvzpzezd`** (`minglemate-staging`), while `.env` and this checklist point at `mhdjnhiqahsllbczbzpk`. One of the two is the wrong target — resolve before deploying anything (see §5). |
| D12 | 150-160 | deploy steps 2.1-2.5 and their code claims | ✅ / ❓ | Prices ✅ (`initiate-payment/index.ts:23-31`); expiry verdict via RPC ✅ (`payment-callback/index.ts:170`); pause/block enforcement ✅ (`match-generator/index.ts:44-48`); deployed state ❓. |
| D13 | 166-168 | secrets "must include … (and `SERVICE_ROLE_KEY` for match-generator's cron path — set both spellings if needed)" | ❌ | No code reads `SERVICE_ROLE_KEY`; the only spelling used is `SUPABASE_SERVICE_ROLE_KEY` (`initiate-payment:51`, `match-generator:7,17`, `payment-callback:74`, `health:14`). |
| D14 | 170-174 | Daraja corroboration secrets; `MPESA_ENV` asymmetry | ✅ | `payment-callback/index.ts:77`, `:144`, `:194`, `:221-231`; `initiate-payment` still hardcodes the sandbox host (`:190`, `:206`) — the documented required fix is still required. |
| D15 | 170 | "3.3 … confirm `content-security-policy` … present" | ❌ | The header is `Content-Security-Policy-Report-Only` (`vercel.json:15`). Expecting `content-security-policy` will always fail until the key is renamed. |
| D16 | 185 | "5.1 Storage → **`profile_photos`** bucket → confirm the chain's policies applied" | ❌ | Wrong bucket: the app uploads/reads/deletes in **`user-photos`** (`PhotoUpload.jsx:68`, `Photos.jsx:88-101`); the chain's policies cover `profile_photos` only (`chain:3303-3338`). As written the check cannot protect the app's objects (audit F9). |
| D17 | 189 vs `SECURITY-REPORT.md:143` | test user to delete | ❓ conflict | `buffy.tester@student.university.ac.ke` vs `buffy.tester@student.egerton.ac.ke`. |
| D18 | 195-261 | post-deploy verification 6.1-6.12 | ❓ | All still unverified — itemised in 3b. |

### 3b. The 33 unchecked deployment items, and what they still need

Every `- [ ]` in the file is still unchecked. "Repo-verifiable" means the answer
does not depend on the deployed project.

| item | can it be verified from here? | notes |
|---|---|---|
| 1.1 run the chain | partly ✅ | Applied to the local stack today; `inspect_state.sql` APPLIED state on the target ❓. |
| 1.2 pg_cron/pg_net + Vault secret | ❓ | Needs the project's extensions + Vault. Code side ✅. |
| 1.3 insert admin row | ❓ | Needs your auth UUID. |
| 1.4 run `inspect_state.sql` | ❓ | Read-only; must run on the target. |
| 2.1-2.3, 2.5 deploy functions | ❓ | Code verified; deployment needs CLI access. |
| 2.4 delete `run-weekly-matching` | ❓ | Repo has no copy; the deployed copy must be deleted. |
| 3.1-3.2 push / console CSP violations | ❓ | 3.2's "no CSP violations" is moot while the CSP is Report-Only. |
| **3.3 header** | ❌ **cannot pass as written** | Expect `content-security-policy-report-only`, or change `vercel.json` to the enforcing key. |
| 4.1-4.2 obsolete secrets | ✅ | No code references either string. |
| 4.3 rotate anon key | ❓ | Dashboard. |
| 4.4 history scrub | ❓ (decision) | Destructive; not attempted. |
| **5.1 bucket** | ❌ **checks the wrong bucket** | Re-point to `user-photos` (and see audit F9 for the `photos` row policies). |
| 5.2-5.4 dashboard settings | ❓ | Auth limits, redirect allow-list, OneSignal origins. |
| 5.5 delete test user | ❓ conflict | See D17. |
| **6.1 signup → `/onboarding`** | ❌ **no such route** | Routes are `/profile-setup` → `/photo-upload` (`App.jsx:106-107`; `VerifyCode.jsx:66`). The substance (no RLS error, profile row exists) is testable once deployed/local-app. |
| **6.2 "request OTP"** | ❌ **stale flow** | Login is password + Turnstile with a single generic failure message (`Login.jsx:31-56`); the code screen belongs to signup confirmation. |
| 6.3 Section 1 / answer text | ❓ | `responses_array` is `text[]` ✅; end-to-end needs the app. |
| **6.4 admin stats + Trigger Matching** | ❌ **cannot pass** | Stats: `admin_overview()` raises 42703 (§4.1). Trigger: browser call to `match-generator` fails CORS (§4.3), and `admin_reports_list` is 42501 (§4.2). |
| 6.5 payment end-to-end | ❓ | Needs Daraja sandbox + PIN; code paths verified separately (54/54 ticket tests; 13/13 clamp/ledger). |
| 6.6 paywall / 14 questions | ❓ | `get_match_contact` exists but is unused by the UI (S7); the UI path is `get_unlocked_contacts`. |
| 6.7 push + 401 | partly ✅ | 401 without auth ✅ by code; delivery ❓. |
| **6.8 photo caps** | partly ❌ | Caps exist in `Photos.jsx` only; the onboarding upload (`PhotoUpload.jsx`) is uncapped — the check as written would pass while that path stays open. |
| 6.9 securityheaders grade A | ❓ | Also blocked by the Report-Only CSP (S23) if a grader counts enforcement. |
| 6.10 account settings / blocked insert | ❓ | SQL side ✅ (`request_account_deletion`; blocks in the messages policy). |
| 6.11 ops tick by hand | ❓ | Code ✅; needs the project (and a channel). |
| 6.12 entitlement evidence | ✅ **script** | `node scripts/verify-entitlement-clamp.mjs` → 13/13 today. Its described "grants `update` for the length of one check … putting the grant back" is now accurate — before this session's repair the script revoked the grant permanently (see the audit doc §5). The manual SQL on the target ❓. |

### 3c. Action items outside the checklist that remain unverified

| item | where | status | notes |
|---|---|---|---|
| Insert the admin row | ADMIN-PANEL step 3 | ❓ | Needs the deployed project's auth UUID (checklist 1.3). |
| Open `/admin` and confirm the tabs | ADMIN-PANEL step 4 | ❓ **blocked** | Stats and Reports cannot render until §4.1/§4.2 are fixed; the tab code itself is present. |
| `npx supabase functions delete run-weekly-matching` | ADMIN-PANEL / checklist 2.4 | ❓ | The repo holds no copy (verified); the deployed copy must be deleted. |
| "After you run the SQL … `am_i_admin` → true, every RPC returns 42501 for a normal user" | ADMIN-PANEL verification status | ❓ on target | The clamp/ledger half is proven on the local stack (13/13); note `admin_reports_list` is not callable by an admin at all (§4.2). |
| Rotate the burned anon JWT | SECURITY-REPORT H3 / checklist 4.3 | ❓ | Dashboard action; no literal remains in the code (verified). |
| History scrub (`.env`, `VITE_ADMIN_PASSWORD`) | SECURITY-REPORT H4 / checklist 4.4 | ❓ decision | Destructive; not attempted. `.env` is untracked and ignored (`.gitignore:27`) ✅. |
| Storage policies verified in the dashboard | SECURITY-REPORT storage row / checklist 5.1 | ❓ + wrong bucket | See D16/S24. |
| OneSignal allowed origins | checklist 5.4 | ❓ | Dashboard. |

Three `SECURITY-REPORT.md` INFO claims re-checked and **still true**: the OneSignal
app ID is public in `index.html:51` (expected), no `dangerouslySetInnerHTML`/
`innerHTML` exists in `src/`, and `.env` is untracked and ignored.

---

## 4. Defects found while reconciling (not documented anywhere)

1. **`admin_overview()` raises 42703** — selects `pi.mpesa_receipt` (`chain:2880`),
   a column no file creates. Breaks the admin panel's whole stats card
   (`Admin.jsx:94`). Fix: either select `pi.mpesa_transaction_id` (the column that
   exists, `chain:296`) or add the column where the legacy receipt text is meant
   to live.
2. **`admin_reports_list()` is unreachable for admins** — no internal `is_admin()`
   guard (`chain:642-676`) and EXECUTE revoked from `authenticated`
   (`chain:677`), while `Admin.jsx:117` calls it under the admin's session.
   Either give it the guard the other admin RPCs have and grant it to
   `authenticated`, or have the panel use a different path.
3. **`match-generator` cannot be called from the browser** — no CORS/OPTIONS
   handling in the function, invoked from `Admin.jsx:241`. The admin "Run
   Matching Now" button fails preflight.
4. **Tier 1 / Tier 2 filters are dead** — `matches` may only hold `qrashe`
   (`chain:1237-1238`), yet `Admin.jsx:522` offers both filters.
5. **Onboarding photo uploads are uncapped** — `PhotoUpload.jsx:62-87` accepts any
   size/type; the magic-byte + 5 MB checks live only in `Photos.jsx`.
6. **`/onboarding` does not exist** — checklist 6.1's expected landing page is
   `/profile-setup`.

## 5. Conflicts to resolve before the next deploy

| conflict | A side | B side | consequence |
|---|---|---|---|
| Project ref | `.env` `VITE_SUPABASE_URL` and checklist §2/§3 target `mhdjnhiqahsllbczbzpk` | `supabase/.temp/linked-project.json` → `ifiewinipbxxfvzpzezd` (`minglemate-staging`) | Deploying or verifying against the wrong project. Decide which is production before step 2. |
| Storage bucket | checklist 5.1 + the chain protect `profile_photos` | the app uses `user-photos` | Either the app or the policies are pointed at the wrong bucket; audit F9. |
| Test user email | `SECURITY-REPORT.md:143` `student.egerton.ac.ke` | `DEPLOYMENT-CHECKLIST.md:189` `student.university.ac.ke` | One of the two is wrong; neither is verifiable here. |

## 6. Ready-to-apply corrections

If you want the three documents edited rather than annotated, the minimal set is:

* `ADMIN-PANEL-REMEDIATION.md`: A2/A12 (paths → chain), A5/A16 (delete the
  `mpesa_receipt` claim or fix the function), A8 (matches tab holds Qrashe only),
  A10 (drop the flag-scheduling sentence; add the CORS gap), A13 (replace the
  "static cross-check script" sentence).
* `SECURITY-REPORT.md`: S1 (1 SQL / 4 deploys), S6 (login is password-based),
  S7 (name `get_unlocked_contacts`), S8 (delete the body's stale sentence),
  S11/S17 ("both" → one), S13/S14 (pending SQL → SQL in the chain, deployment
  unverified), S21 (add match-generator/health), S23 (Report-Only), S24 (bucket).
* `DEPLOYMENT-CHECKLIST.md`: D2 (nine steps, 15 files), D11 (pick the ref),
  D13 (drop `SERVICE_ROLE_KEY`), D15/D16/6.1/6.2/6.4/6.8 (rewrite as above),
  6.12 (note the repaired restore semantics).

## 7. Cross-reference: the schema's missing RLS

`DEPLOYMENT-CHECKLIST.md:44-49` lists `users`, `campuses`, `notifications`,
`photos`, `token_purchases` and `match_history` as **preconditions** — tables the
chain reads but never creates. The chain also never enables RLS on any of them
(`docs/client-writable-truth-audit.md` §1), so on a database that reaches the
chain without that state, every policy on those tables is inert and clients write
freely — verified live (cross-row writes, an anonymous `section2_unlocked`, a
client-written campus flag). Any deployment verification that touches these
tables (5.1, 6.4, 6.10) should include their RLS state; the audit's §3 query list
is the read-only way to check.
