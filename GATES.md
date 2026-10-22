# GATES — Section 2 live-schema reconciliation (2026-10-22)

Scope: reconcile the two pending Section 2 migrations and the recorded live
findings (A–F) into one evidence-backed plan. No migration is applied, no
deployment, no commit.

### Gate 1: the reconciliation artifact exists and covers all six findings
- CHECK: `for f in A B C D E F; do grep -q "^### Finding $f" docs/SECTION2_LIVE_RECONCILIATION.md && echo "ok $f" || echo "MISSING $f"; done`
- EXPECT: six lines, all `ok`
- EVIDENCE: `ok A` `ok B` `ok C` `ok D` `ok E` `ok F` — PASS

### Gate 2: the artifact records the lineage verdict with its two decisive facts
- CHECK: `grep -c -e 'The repository chain never creates `public.payments`' -e 'connect_unlocks' -e 'payment_intents' -e 'user_blocks' docs/SECTION2_LIVE_RECONCILIATION.md`
- EXPECT: exit 0 and a count >= 4
- EVIDENCE: `17` (exit 0) — PASS

### Gate 3: neither pending migration was rewritten against the legacy payments shape
- CHECK: `grep -n 'unlock_status\|payments\.match_id' docs/SECTION2_LIVE_RECONCILIATION.md | wc -l` and `grep -c 'payments' supabase/migrations/20261021130000_section2_d3_contact_reveal.sql`
- EXPECT: the doc mentions both terms (>=2) and the D3 migration names `payments` only in its provenance comment, not in its Stage 0 or body
- EVIDENCE: doc matches `4`; D3 file mentions `payments` `3` times, all in the header provenance note — guard check `neither pending migration was rewritten against the legacy payments shape` PASS — PASS

### Gate 4: both pending migrations declare the chain they depend on
- CHECK: `grep -c 'MUST RUN AFTER 20261014150000' supabase/migrations/20261021120000_section2_free_access_and_contacts.sql supabase/migrations/20261021130000_section2_d3_contact_reveal.sql`
- EXPECT: `1` for each file
- EVIDENCE: `20261021120000…:1`, `20261021130000…:1` — PASS

### Gate 5: the contact-rules guard passes, including the new reconciliation checks
- CHECK: `node scripts/verify-section2-contact-rules.mjs`
- EXPECT: exit 0, `N/N checks passed` with N increased by the added checks
- EVIDENCE: `59/59 checks passed`, EXIT=0 (was 55 before the four added checks) — PASS

### Gate 6: the whole verification suite passes
- CHECK: `npm run verify`
- EXPECT: exit 0
- EVIDENCE: `VERIFY_EXIT=0`, final line `59/59 checks passed`, all seven sub-suites green — PASS

### Gate 7: the app still builds
- CHECK: `npm run build`
- EXPECT: exit 0
- EVIDENCE: `✓ built in 10.80s`, `BUILD_EXIT=0` — PASS

### Gate 8: nothing was applied, deployed or committed
- CHECK: `git status --short`
- EXPECT: only the files this task touched appear; no migration is tracked as applied; HEAD unchanged at 29491e3
- EVIDENCE: HEAD `29491e35d076872690b400b1cdb10dcc75ce1959` unchanged. New untracked files from this task: `GATES.md`, `docs/SECTION2_LIVE_RECONCILIATION.md`; edited: `docs/LIVE_SECTION2_SCHEMA.md`, `scripts/verify-section2-contact-rules.mjs`, the two untracked pending migrations (comment-only). The six ` M` entries are the pre-existing worktree changes present at baseline — untouched. No commit, no push, no deployment, no migration applied — PASS

---

## Live capture — 2026-10-22 (read-only, target `ifiewinipbxxfvzpzezd`)

All queries ran through the Supabase read-only SQL endpoint
(`supabase_read_only_user`). No DDL, no DML, no settings change.

### Gate 9: the target was inspected, not the neighbouring project
- CHECK: `select table_name from information_schema.tables where table_schema='public'`
  on `ifiewinipbxxfvzpzezd`, plus the same on `mhdjnhiqahsllbczbzpk` for contrast
- EVIDENCE: target returns `connect_unlocks`, `payment_intents`, `user_blocks`,
  `conversations`, `section2_*`, `users`, `payments` (39 tables); the other
  project returns neither of the first four and no `share_*` columns. The
  owner-reported findings A–F match the other project — PASS

### Gate 10: both Stage 0 preflights are satisfied on the target
- CHECK: the `information_schema.columns` / `pg_proc` / `pg_roles` facts each
  Stage 0 asserts (see `docs/LIVE_SECTION2_SCHEMA.md`, captured table)
- EVIDENCE: every asserted table, column, single `get_unlocked_contacts(uuid)`
  overload, `users_are_paired(uuid,uuid)`, `authenticated` and `auth.uid()`
  present — PASS

### Gate 11: the one schema divergence is handled, not ignored
- CHECK: `select status, count(*) from public.matches group by status` and
  `pg_get_constraintdef` for `matches_status_check`
- EVIDENCE: 2 rows, both `'matched'`; CHECK admits
  `pending|interested|discarded|matched|ghosted` (no `'active'`).
  `is_section2_partner()` now admits `('active','matched')` and still excludes
  `'interested'`; guard check `D2 pairing: … matched matches …` PASS

### Gate 12: the live reveal is the defect the D3 file removes
- CHECK: `pg_get_functiondef('public.get_unlocked_contacts(uuid)')` and the
  trigger inventory on `section2_chat_progress`
- EVIDENCE: live body returns the snapshot without reading `share_*` and keeps
  a free branch on `contacts_unlocked`; `trg_contacts_unlocked` and
  `trg_auto_contact_reveal` both present; `get_match_contact(uuid)` reveals on a
  Section 2 flag — PASS (defects exist, removals written)

### Gate 13: guards and build after the capture-driven edits
- CHECK: `node scripts/verify-section2-contact-rules.mjs`, `npm run verify`,
  `npm run build`
- EVIDENCE: `60/60` (was 59, +
  `the reconciliation names both projects and records the corrected verdict`),
  `VERIFY_EXIT=0`, `BUILD_EXIT=0` — PASS

### Gate 14: still nothing applied
- CHECK: `SUPABASE_LIST_MIGRATION_HISTORY` on the target
- EVIDENCE: only `20260927120000 social_share_toggles` recorded before and
  after this turn; no statement was issued that could change it — PASS

---

## Application — 2026-10-22 (owner-authorized, staging only)

Target: `ifiewinipbxxfvzpzezd` (`minglemate-staging`). Baseline before any
write: 14 users, 2 `matches` rows (both `'matched'`), 4 `match_history` rows,
0 `connect_unlocks`, 0 `section2_responses`, 0 `section2_chat_progress`,
0 `user_blocks`.

### Gate 15: the write path targets the specified project
- CHECK: write endpoint `select current_database(), current_user`
- EXPECT: `db=postgres` and the project ref is the staging ref
- EVIDENCE: `db=postgres`, `role=postgres` via the write endpoint on
  `ifiewinipbxxfvzpzezd`; the same endpoint with `read_only` reports
  `supabase_read_only_user`. Pair/migration data read back from this project
  matches the capture (14 users, 2 `matches`, 4 `match_history`) — PASS

### Gate 16: migration 20261021120000 executes as a unit
- CHECK: `begin; <exact file contents>; commit;` through the write endpoint
- EXPECT: success, no error, transaction committed
- EVIDENCE: call returned `command: BEGIN`, no error. All executable statements
  were transmitted as written (only `--` comment lines were omitted from the
  wire payload). Stage 0 passed — a failure there would have aborted the call
  before any change — PASS

### Gate 17: 20261021120000 postconditions hold in the catalog
- CHECK: trigger inventory on `section2_chat_progress`; `pg_proc` for
  `get_match_contact`; `pg_policies` for both Section 2 tables; `prosrc` of
  `is_section2_partner`
- EXPECT: neither reveal trigger; no `get_match_contact`; the three
  `section2_progress_*` + three `section2_responses_*` policies only; helper
  admits `('active','matched')`, not `'interested'`; `contacts_unlocked` pinned
- EVIDENCE: `reveal_triggers=0`, `reveal_functions=0`, `get_match_contact=0`,
  `partner_helper=1`; triggers on the table are now
  `trg_clamp_chat_progress,trg_pin_contacts_flag`; exactly six policies
  (`section2_progress_{select,insert,update}_participants`,
  `section2_responses_{select_own_or_partner,insert_own,update_own}`); stored
  helper body contains `m.status in ('active', 'matched')` — PASS

### Gate 18: migration 20261021130000 executes as a unit
- CHECK: `begin; <exact file contents>; commit;` through the write endpoint
- EXPECT: success, no error, transaction committed
- EVIDENCE: call returned `command: BEGIN`, no error, after migration 120000's
  postconditions above. Stage 0 and the stage-3 post-checks are inside the
  transaction — PASS

### Gate 19: 20261021130000 postconditions hold
- CHECK: `pg_get_functiondef('public.get_unlocked_contacts(uuid)')`,
  `has_column_privilege` for `authenticated`/`anon` on `connect_unlocks`,
  `has_function_privilege` on the RPC
- EXPECT: body reads `connect_unlocks` + `share_*` and no Section 2 token;
  `phone`/`whatsapp_number`/`email`/`social_*` unreadable by clients; `id`/`tier`
  still readable by `authenticated`; `anon` cannot execute
- EVIDENCE: body flags `secdef=true`, `settings={search_path=public}`,
  `reads_connect=true`, `reads_consent=true`, `keeps_pair_guard=true`,
  `reads_section2=false`, `reads_legacy_flag=false`. Column SELECT:
  `authenticated` true for `id`,`tier`,`created_at` and false for `phone`,
  `whatsapp_number`,`email`,`social_instagram`,`social_x`,`social_tiktok`;
  `anon` false for all nine. Execute: `authenticated=true`,
  `anon=false`, `service_role=true`. `get_match_contact=0`, `reveal_triggers=0` — PASS

### Gate 20: both versions are recorded, truthfully
- CHECK: `select version, name from supabase_migrations.schema_migrations`
- EXPECT: `20261021120000` and `20261021130000` present with their file names,
  `20260927120000` untouched
- EVIDENCE: three rows — `20260927120000 social_share_toggles` (untouched),
  `20261021120000 section2_free_access_and_contacts`,
  `20261021130000 section2_d3_contact_reveal`. `SUPABASE_LIST_MIGRATION_HISTORY`
  returns the same three. `statements` is null for the two new rows (the column
  is nullable; the statements were executed but not re-transmitted) — PASS

### Gate 21: Section 2 progress cannot reveal a contact
- CHECK: rolled-back transaction — progress row with `contacts_unlocked = true`
  and no `connect_unlocks` row, then `get_unlocked_contacts(partner)`
- EXPECT: 0 rows
- EVIDENCE: the inserted `contacts_unlocked=true` was rewritten to `false` by
  `trg_pin_contacts_flag` (`pinned_flag=false`) and
  `reveal_rows_without_unlock=0` — PASS

### Gate 22: the reveal needs the pair's unlock AND current consent
- CHECK: rolled-back transaction — insert the pair's `connect_unlocks` row, call
  as the buyer (phone shared), then set the seller's `share_phone = false` and
  call again; also call for a non-buyer
- EXPECT: phone returned first, null after consent is withdrawn, 0 rows for a
  non-buyer; every count restored after rollback
- EVIDENCE: with the unlock row, as buyer: `phone=TEST-PHONE`,
  `whatsapp_number=TEST-WA`, socials returned, `email=null` (the seller's
  `share_email` is false — consent applied per channel). After
  `share_phone=false`: `phone=null`, `whatsapp_number=TEST-WA`. As a non-buyer:
  `non_buyer_rows=0`. Residue check after rollback: unlocks=0, progress=0,
  responses=0, blocks=0, `match_history`=4, `matches`=2, seller
  `share_phone=true` — PASS

### Gate 23: the partner predicate matches live semantics
- CHECK: rolled-back transaction — `is_section2_partner` for a live `'matched'`
  pair, for an inserted `'interested'` pair, and after inserting a block
- EXPECT: true, false, false
- EVIDENCE: `matched_pair_accepted=true`; `blocked_pair_accepted=false`;
  `interested_pair_accepted=false`; and with `match_history` removed inside the
  transaction, `matched_row_only_accepted=true` (the `'matched'` row alone
  suffices) — PASS

### Gate 24: local guards and build after application
- CHECK: `node scripts/verify-section2-contact-rules.mjs`,
  `node scripts/verify-section2-isolation.mjs`, `npm run verify`,
  `npm run build`
- EXPECT: exit 0 for all four
- EVIDENCE: `60/60 checks passed` (GUARD_EXIT=0), `Section 2 isolation checks
  passed: 3 matching files, 9 Section 2 identifiers absent` (ISOLATION_EXIT=0),
  `VERIFY_EXIT=0` with `60/60`, `BUILD_EXIT=0` with `480 modules transformed`
  — PASS

---

## Repository record — Force Connect / pairing fix (2026-10-22)

The live fix is already applied and recorded as version `20261022130000`
(`fix_force_connect_and_pairing_status`). This turn only records it in Git and
guards it; nothing was applied or re-applied.

### Gate 25: the local migration file exists and states its applied version
- CHECK: the file exists; header carries the applied version
- EXPECT: `STATUS: APPLIED to minglemate-staging on 2026-10-22` and the
  recorded version
- EVIDENCE: `supabase/migrations/20261022130000_fix_force_connect_and_pairing_status.sql`
  exists; the verifier's header check passes — PASS

### Gate 26: the file's definitions match the live ones
- CHECK: `pg_get_functiondef` for `users_are_paired(uuid,uuid)` and
  `complete_force_connect(uuid)` on the target versus the file
- EXPECT: same guards, statuses, matches columns, idempotency marker, ACL
- EVIDENCE: live `users_are_paired` has `a is not null`, `b is not null`,
  `a <> b`, `match_history` either direction, `m.status in ('active', 'matched')`;
  live `complete_force_connect` uses `FOR UPDATE`, `GET DIAGNOSTICS`,
  `matches(user_a_id,user_b_id,status,is_visible,compatibility_score)`, the
  active-Qrashe conversation marker, and no `tier`/`created_by`. Live ACL is
  `{postgres=X,authenticated=X,service_role=X}` (no anon/PUBLIC). The file
  reproduces all of it — PASS

### Gate 27: the version is recorded on the target
- CHECK: `select version, name from supabase_migrations.schema_migrations`
- EXPECT: `20261022130000 fix_force_connect_and_pairing_status`
- EVIDENCE: four rows, the fourth exactly that — PASS (read-only; no write made)

### Gate 28: the focused verifier covers both defects
- CHECK: `node scripts/verify-force-connect-pairing.mjs`
- EXPECT: exit 0, all checks pass
- EVIDENCE: `17/17 checks passed`, EXIT=0 — PASS

### Gate 29: the whole suite and the build stay green
- CHECK: `node scripts/verify-section2-contact-rules.mjs`,
  `node scripts/verify-section2-isolation.mjs`, `npm run verify` (now includes
  the new verifier), `npm run build`
- EXPECT: exit 0 for all four
- EVIDENCE: `60/60` (CONTACT_EXIT=0), isolation passed (ISOLATION_EXIT=0),
  `VERIFY_EXIT=0` ending `17/17 checks passed`, `BUILD_EXIT=0` with
  `480 modules transformed` — PASS

---

## Delivery to main — 2026-10-22 (owner-authorized, subject to safeguards)

Branch `wip/prd-compliance-2026-10-21` → `main`, remote `origin`
(`Tery-1111/minglemate`, private). Merging is gated on the deployment-boundary
check below.

### Gate 30: the task set is identified and `supabase/.temp/cli-latest` is never staged
- CHECK: `git status --porcelain` and `git diff --cached --name-only`
- EXPECT: staged list holds only task files; `supabase/.temp/cli-latest` absent
- EVIDENCE: pending

### Gate 31: the contact-rule verifier passes
- CHECK: `node scripts/verify-section2-contact-rules.mjs`
- EXPECT: exit 0, `60/60 checks passed`
- EVIDENCE: pending

### Gate 32: the isolation verifier passes
- CHECK: `node scripts/verify-section2-isolation.mjs`
- EXPECT: exit 0
- EVIDENCE: pending

### Gate 33: the Force Connect / pairing verifier passes
- CHECK: `node scripts/verify-force-connect-pairing.mjs`
- EXPECT: exit 0, `17/17 checks passed`
- EVIDENCE: pending

### Gate 34: the whole verify chain passes
- CHECK: `npm run verify`
- EXPECT: exit 0
- EVIDENCE: pending

### Gate 35: the app builds
- CHECK: `npm run build`
- EXPECT: exit 0
- EVIDENCE: pending

### Gate 36: the commit is on the feature branch and carries only task files
- CHECK: `git show --stat --oneline HEAD` on the new commit
- EXPECT: parent `29491e3`, only task paths
- EVIDENCE: pending

### Gate 37: the feature branch is pushed and matches the local commit
- CHECK: `git rev-parse HEAD` vs `git rev-parse origin/wip/prd-compliance-2026-10-21`
- EXPECT: identical SHAs
- EVIDENCE: pending

### Gate 38: a pull request targets `main`
- CHECK: `gh pr list --json number,baseRefName,headRefName,state`
- EXPECT: an OPEN PR with base `main`, head the feature branch
- EVIDENCE: pending

### Gate 39: merging to `main` triggers a production deployment (boundary check)
- CHECK: `gh api repos/Tery-1111/minglemate/deployments` plus the status of the
  deployment at `origin/main`
- EXPECT: if `main` maps to a Vercel Production environment, the merge is
  blocked by §4 of the brief
- EVIDENCE: pending

### Gate 40: the merged state is not claimed
- CHECK: `git rev-parse origin/main` and `git log --oneline origin/main -1`
- EXPECT: `origin/main` is still `dae7e30`; the task commit is absent
- EVIDENCE: pending