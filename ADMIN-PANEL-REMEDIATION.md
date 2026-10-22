# Admin Panel Remediation — Runbook & Status

> **⚠️ Reconciliation 2026-10-14 — partly stale.** 5 claims here are false and 4
> stale: the `admin_overview` receipt column (it does not exist, so the stats RPC
> raises), the Tier 1/Tier 2 match filters (the table may only hold `qrashe`), the
> campus-flag claim, "every RPC guards itself" (`admin_reports_list` does not and
> is revoked from admins), and the runbook's file paths (superseded by the one
> chain). See [docs/docs-reconciliation-2026-10-14.md](docs/docs-reconciliation-2026-10-14.md) §1.

## What was built (code-complete, `npm run build` ✓)

### supabase/sql/superseded/admin_role.sql (v2 — rewritten; the live copy is folded into the consolidated chain)
| Finding | Fix |
|---|---|
| **P0 — authorization bypass** | All 3 campus mutation RPCs (`admin_add_campus`, `admin_set_campus_active`, `admin_set_campus_matching`) now verify `is_admin()` **inside the function body** and raise `Forbidden` otherwise. Verified per-function by static check — no reliance on hidden UI, route guards, or a prior `am_i_admin()` call. |
| P1 — backend not deployed | This single idempotent file creates: `admin_users`, `admin_audit_log`, `is_admin()`, `am_i_admin()`, `admin_overview()`, the 3 guarded campus RPCs, plus the new `admin_users_list()`, `admin_user_detail()`, `admin_matches_list()`. |
| P1 — payments stale | `admin_overview` payments now read **`payment_intents`** (payer name, purpose, amount, status, M-Pesa receipt). Legacy `token_purchases` rows are merged in and tagged `legacy` — history preserved, legacy write path untouched. |
| P2 — silent campus errors | Every admin action in `Admin.jsx` surfaces failures inline (`Failed to set …: <message>`), no silent swallowing. |
| P2 — no refresh | `↻ Refresh` in the header re-pulls the overview plus the active tab's list. |

### New Admin capabilities
- **Users tab** — `admin_users_list(p_q, p_status, p_sort, p_asc, p_page)`: search by name/email, status filter (active/paused/pending_deletion), newest/oldest/name-AZ/ZA sort, 25/page pagination. Non-sensitive fields only (no contacts/photos in the list).
- **User detail** — `admin_user_detail(p_user_id, p_categories, p_reason)`: profile, status, facial/full-body photos, interests, contact-sharing settings, matches. **Contacts and questionnaire answers are sensitive**: they require a reason (min 4 chars), show a confirm dialog, and write an audit row (admin id, target user, category, reason, timestamp) to `admin_audit_log` (RLS on, no client policies — only definer functions touch it).
- **Matches tab** — `admin_matches_list(p_filter, p_page)`: every match record (Tier 1 / Tier 2 / Qrashe), filterable and paginated, with conversation-existence indicator.
- **Stats** — adds `totalMatches`, `pendingPayments`, `openReports` to the existing live counters.

### Trigger Matching
Repointed to **`match-generator`** (the real 50-question engine that powers weekly Tier 1/Tier 2 delivery). It runs across all campuses — the per-campus `matching_enabled`/`is_active` flags govern the weekly cron schedule, not this manual run (note shown in the UI). `run-weekly-matching` has since been **retired and deleted** (dead engine — `section1_responses` is written by nothing; no cron or code callers found); remember to `npx supabase functions delete run-weekly-matching` so the deployed copy is removed too.

## Your steps (agent has no service key / dashboard access)
1. **This runbook's SQL is superseded.** Everything described above is now folded into one idempotent file: `supabase/migrations/20261014150000_consolidated_schema_chain.sql`. `admin_role.sql`, `remediation_bundle.sql` and the other eight bundles are retired under `supabase/sql/superseded/` — **do not run them.**
2. **Supabase Dashboard → SQL Editor** → run that one file, then `supabase/sql/inspect_state.sql` to confirm it applied (`DEPLOYMENT-CHECKLIST.md` §1.4).
3. Insert your membership:
   ```sql
   insert into public.admin_users (user_id) values ('YOUR-AUTH-USER-UUID');
   ```
4. Open **/admin** (direct URL, logged in).

## Verification status (honest)
- `npm run build` ✓ (twice, after each fix round)
- Static cross-check script: all 8 RPC names/signatures/params match JSX↔SQL; every RPC body contains its own `is_admin()` guard; balanced dollar-quotes; `photos` read via `photo_type in ('facial','full_body')`; `user_responses` read as one-row-per-user (1-based Postgres array index).
- Live probes (current DB): RPCs not yet applied → `PGRST202` on all calls, as predicted. **After you run the SQL**, the verification to expect: `am_i_admin` → true for you; every RPC returns `42501 Forbidden` for a normal user (including direct console calls); Users/Matches/Payments tabs populate with real rows.

## Notes
- Reports have no status column in the schema → the stat is "Reports Filed" (no invented open/closed lifecycle).
- If `admin_overview` errors after deployment, check the run order above (missing `payment_intents`).
