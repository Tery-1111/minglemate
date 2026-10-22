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
- EVIDENCE: staged sixteen paths (`git diff --cached --name-status`), 16 files:
  `A GATES.md`, three `docs/`, three `scripts/`, three
  `supabase/migrations/`, `supabase/sql/capture_section2_contacts_state.sql`,
  `M package.json`, `M src/pages/{Chat,Matches,Payment}.jsx`, `M
  supabase/functions/initiate-payment/index.ts`. `grep -c 'supabase/.temp'`
  on the staged list returned `0`; the file remains ` M` unstaged — PASS

### Gate 31: the contact-rule verifier passes
- CHECK: `node scripts/verify-section2-contact-rules.mjs`
- EXPECT: exit 0, `60/60 checks passed`
- EVIDENCE: `CONTACT_EXIT=0`, output ends `60/60 checks passed` with
  `PASS both pending migrations declare the chain they must run after` — PASS

### Gate 32: the isolation verifier passes
- CHECK: `node scripts/verify-section2-isolation.mjs`
- EXPECT: exit 0
- EVIDENCE: `ISOLATION_EXIT=0`, `Section 2 isolation checks passed: 3
  matching files, 9 Section 2 identifiers absent` — PASS

### Gate 33: the Force Connect / pairing verifier passes
- CHECK: `node scripts/verify-force-connect-pairing.mjs`
- EXPECT: exit 0, `17/17 checks passed`
- EVIDENCE: `FORCE_EXIT=0`, `17/17 checks passed` — PASS

### Gate 34: the whole verify chain passes
- CHECK: `npm run verify`
- EXPECT: exit 0
- EVIDENCE: `VERIFY_EXIT=0`, eight sub-suites, 131 `PASS` lines, ends
  `17/17 checks passed` — PASS

### Gate 35: the app builds
- CHECK: `npm run build`
- EXPECT: exit 0
- EVIDENCE: `BUILD_EXIT=0`, `✓ 480 modules transformed`, `✓ built in 1.67s`
  (the 500 kB chunk-size notice is pre-existing advice, not an error) — PASS

### Gate 36: the commit is on the feature branch and carries only task files
- CHECK: `git show --stat --oneline HEAD` on the new commit
- EXPECT: parent `29491e3`, only task paths
- EVIDENCE: `1e9b21f Section 2 is free; contacts need Connect plus owner
  consent`, parent `29491e3`, `16 files changed, 3878 insertions(+), 184
  deletions(-)`; no `supabase/.temp/cli-latest` — PASS

### Gate 37: the feature branch is pushed and matches the local commit
- CHECK: `git rev-parse HEAD` vs `git rev-parse origin/wip/prd-compliance-2026-10-21`
- EXPECT: identical SHAs
- EVIDENCE: local `HEAD` and `origin/wip/prd-compliance-2026-10-21` both
  `1e9b21f3ca71c18ae93a51e224fda3e8a0341e4d`; push was
  `29491e3..1e9b21f` (fast-forward, no force) — PASS

### Gate 38: a pull request targets `main`
- CHECK: `gh pr list --json number,baseRefName,headRefName,state`
- EXPECT: an OPEN PR with base `main`, head the feature branch
- EVIDENCE: PR #12, base `main`, head `wip/prd-compliance-2026-10-21`,
  `mergeable=MERGEABLE`, `mergeStateStatus=CLEAN` — PASS

### Gate 39: merging to `main` triggers a production deployment (boundary check)
- CHECK: `gh api repos/Tery-1111/minglemate/deployments` plus the status of the
  deployment at `origin/main`
- EXPECT: if `main` maps to a Vercel Production environment, the merge is
  blocked by §4 of the brief
- EVIDENCE: `dae7e30` (main tip) carries `Production – minglemate-ax7f`,
  `state=success`, `environment_url`
  `https://minglemate-ax7f-mfpwux9su-tery-1111s-projects.vercel.app`; branch
  pushes get `Preview – minglemate` / `Preview – minglemate-ax7f` instead.
  `DEPLOYMENT-CHECKLIST.md:234` documents "Merge/push this branch — Vercel
  auto-deploys", so merging starts a production release — BLOCKED

### Gate 40: the merged state is not claimed
- CHECK: `git rev-parse origin/main` and `git log --oneline origin/main -1`
- EXPECT: `origin/main` is still `dae7e30`; the task commit is absent
- EVIDENCE: `origin/main` is `dae7e30022803926473efc65f176e47b9f98bf44`
  before and after this turn; `git rev-list --left-right --count
  origin/main...HEAD` is `0  19`, so main does not contain `1e9b21f` — FAIL
  (blocked, merge deliberately not performed)
## Production application and delivery (2026-10-22, resumed with production authorization)

### Gate 41: the production target is identified and captured before any change
- CHECK: read-only catalog and data reads against `minglemate`
  (`mhdjnhiqahsllbczbzpk`), plus `list_edge_functions` and `list_secrets`
  (names only)
- EXPECT: legacy shape confirmed, no writes
- EVIDENCE: 45 public tables; no `user_blocks`, `connect_unlocks`,
  `payment_intents`, `conversations`, `processed_payment_callbacks`,
  `profiles_public` or `my_profile`; no `users.share_*`; legacy
  `matches(user_a_id,user_b_id,status∈pending|interested|discarded|matched|ghosted)`;
  reveal triggers `trg_contacts_unlocked` + `trg_auto_contact_reveal` live;
  `supabase_migrations` absent; `initiate-payment`/`payment-callback` not
  deployed; no `MPESA_*` secret — PASS (captured in
  `docs/PRODUCTION_SECTION2_MIGRATION.md`)

### Gate 42: a production-compatible migration replaces blind chain replay
- CHECK: two ordered files under `supabase/sql/production/` plus a fail-closed
  replay guard, instead of applying the staging migrations
- EXPECT: production-only location, preflight, idempotent, no destructive DDL
- EVIDENCE: `20261022150000_production_baseline_objects.sql`,
  `20261022160000_production_section2_contacts.sql`,
  `supabase/migrations/20260901000000_production_chain_replay_guard.sql` — PASS

### Gate 43: the baseline objects migration applied and recorded
- CHECK: `SUPABASE_APPLY_A_MIGRATION` on `mhdjnhiqahsllbczbzpk`
- EXPECT: success; objects, columns and privileges present
- EVIDENCE: `Migration applied successfully`; `user_blocks`,
  `payment_intents`, `processed_payment_callbacks`, `connect_unlocks`,
  `conversations` (all RLS on), `profiles_public`, `my_profile()` present;
  6 `users.share_*` columns — PASS

### Gate 44: the Section 2 / contacts migration applied after one corrected failure
- CHECK: `SUPABASE_APPLY_A_MIGRATION` of the second file
- EXPECT: success only when its own post-conditions hold
- EVIDENCE: first attempt aborted with
  `P0001: contacts_unlocked is still true on a progress row` — the pin trigger
  preserved OLD, so the corrective UPDATE was reverted; the migration is
  transactional and rolled back completely (0 policies, 0 new functions, flag
  still true). `pin_section2_contacts_flag()` was changed to force `false` on
  INSERT and UPDATE, and the re-run returned
  `Migration applied successfully` — PASS (failure and fix recorded, not hidden)

### Gate 45: production migration history is reconciled, not suppressed
- CHECK: `SUPABASE_LIST_MIGRATION_HISTORY` and the migration rows
- EXPECT: executed versions match the repository filenames; adopted versions
  only where the complete intended effect is verified
- EVIDENCE: `20261022150000`, `20261022160000` (executed); `20261021120000`,
  `20261021130000`, `20261022130000` recorded as ADOPTED with the verification
  note; marker table `public.production_schema_baseline` present — PASS

### Gate 46: no production data was lost
- CHECK: row counts before vs after
- EXPECT: identical
- EVIDENCE: users 3→3, section2_responses 40→40, progress 1→1, matches 1→1,
  match_history 1→1, payments 1→1, messages 6→6, token_purchases 0→0,
  reports 2→2; new tables empty (0 rows) — PASS

### Gate 47: Section 2 is free and partner-scoped, and blocking denies the read
- CHECK: rollback-scoped `SET ROLE authenticated` reads and writes
- EXPECT: own + matched partner only; unpaired denied; writes allowed; block
  denies; pairing predicate unchanged by a block
- EVIDENCE: user B saw own 0, partner A 20, unpaired C 0, progress 1; own
  answer insert+update succeeded; after a block, partner rows 0,
  `is_section2_partner` false, `users_are_paired` true — PASS

### Gate 48: question progress and clients cannot reveal contacts
- CHECK: rollback-scoped progress bump and client flag write; catalog check
- EXPECT: `contacts_unlocked` stays false; reveal functions/triggers gone
- EVIDENCE: `questions_discussed` raised (clamped to 14) → `still_unlocked=0`;
  authenticated `UPDATE … contacts_unlocked = true` → `false`; 0 reveal
  functions, 0 reveal triggers, 0 true flags — PASS

### Gate 49: Connect requires a succeeded intent for that pair, and consent is live
- CHECK: pending/succeeded/unpaired intents, duplicate callback, per-channel
  consent toggles, unrelated caller
- EXPECT: one snapshot only from a succeeded paired intent; duplicates no-op;
  channel follows the owner's current flag; unrelated caller denied
- EVIDENCE: pending → 0 unlocks; succeeded → 1 unlock, 1 conversation, 1
  system message; second call → unchanged; unpaired → 0; email shared
  `true → false → true` across the toggles; unrelated caller → 0 rows — PASS

### Gate 50: Force Connect uses the live `matches` shape and is idempotent
- CHECK: succeeded `force_connect` intent applied twice
- EXPECT: one matched pair, one Qrashe conversation, one message/notification,
  no contact reveal
- EVIDENCE: `match_rows_for_pair=1`, `qrashe_conversations=1`,
  `force_messages=1`, `force_notifications=1`, `matched_rows_total=2` (the
  pre-existing pair plus the new one), channels after Force Connect `0`,
  `users_are_paired` true — PASS

### Gate 51: anonymous and direct-database callers cannot bypass the reveal
- CHECK: function ACLs and a client `select` of a contact column
- EXPECT: no `anon` EXECUTE on internal helpers; contact columns unreadable
- EVIDENCE: `anon_exec=false` for `users_are_paired`, `is_section2_partner`,
  `complete_connect_unlock`, `complete_force_connect`,
  `get_unlocked_contacts`, `my_profile`; `select email from users` as
  `authenticated` → `42501 permission denied` — PASS

### Gate 52: the payment/contact Edge Functions are deployed and gated
- CHECK: `supabase functions deploy … --project-ref mhdjnhiqahsllbczbzpk`,
  `list_edge_functions`, HTTP smoke tests
- EXPECT: both ACTIVE; `initiate-payment` JWT-gated; callback reachable
- EVIDENCE: `initiate-payment` v1 `verify_jwt=true`, `payment-callback` v1
  `verify_jwt=false`; no header → `401 UNAUTHORIZED_NO_AUTH_HEADER`, bad bearer
  → `401 UNAUTHORIZED_INVALID_JWT_FORMAT`; unknown callback id → `200 ok` — PASS

### Gate 53: the repository checks pass
- CHECK: `verify-section2-contact-rules`, `verify-section2-isolation`,
  `verify-force-connect-pairing`, `npm run verify`, `npm run build`
- EXPECT: exit 0
- EVIDENCE: `60/60`, isolation pass, `17/17`, `VERIFY_EXIT=0` (131 PASS),
  `BUILD_EXIT=0` (`480 modules transformed`, `built in 7.15s`) — PASS

### Gate 54: lint is a pre-existing failure, not caused by this change
- CHECK: `npm run lint`
- EXPECT: distinguish new from existing findings
- EVIDENCE: `LINT_EXIT=1`, 44 problems (25 errors) — all
  `react-hooks/immutability`, unused-variable and exhaustive-deps findings in
  lines this change did not touch; `git diff` on the three edited screens is
  limited to the `matches` status filter and its comment — FAIL (pre-existing,
  reported as a limitation)

---

# GATES — production payment-intent lifecycle compatibility (2026-10-22)

Scope: make the deployed `payment-callback`'s expiry check and bookkeeping
writes work against the production schema (`mhdjnhiqahsllbczbzpk`), without
touching the completed Section 2 / Force Connect work, without a real charge,
and without inventing entitlement.

### Gate 55: the callback's database contract is enumerated from the code, not memory
- CHECK: `for c in expires_at ticket_state status_reason verification_requested_at verification_conversation_id verification_state verification_detail verified_at unlock_state unlock_applied_at unlock_error late_callback_at; do grep -q "$c" supabase/functions/payment-callback/index.ts && echo "column:$c"; done; grep -o 'payment_intent_expiry_state' supabase/functions/payment-callback/index.ts | head -1; grep -o 'processed_payment_callbacks' supabase/functions/payment-callback/index.ts | head -1; grep -o 'complete_connect_unlock\|complete_force_connect' supabase/functions/payment-callback/index.ts | sort -u`
- EXPECT: 12 `column:` lines, one RPC name, one cache table, both unlock RPCs
- EVIDENCE: 12 `column:` lines (expires_at, ticket_state, status_reason, verification_requested_at, verification_conversation_id, verification_state, verification_detail, verified_at, unlock_state, unlock_applied_at, unlock_error, late_callback_at), `payment_intent_expiry_state`, `processed_payment_callbacks`, `complete_connect_unlock`, `complete_force_connect`, EXIT=0 — PASS

### Gate 56: production is measured before any change (columns, constraint, function, data)
- CHECK: MANUAL — read-only `information_schema` / `pg_constraint` / `pg_proc` and row counts on `mhdjnhiqahsllbczbzpk`
- EXPECT: 11 `payment_intents` columns and no `expires_at`; status CHECK admits only pending/succeeded/failed; no `payment_intent_expiry_state`; baseline counts recorded
- EVIDENCE: 11 columns (amount, callback_key, checkout_request_id, created_at, id, mpesa_transaction_id, phone, purpose, recipient_user_id, status, user_id); `payment_intents_status_check = pending|succeeded|failed`; `payment_intent_expiry_state` absent; `processed_payment_callbacks` present with RLS on; baseline users 3, section2_responses 40, progress 1, matches 1, match_history 1, payments 1, messages 6, token_purchases 0, reports 2, payment_intents 0, processed_payment_callbacks 0, connect_unlocks 0, conversations 0, user_blocks 0 — PASS

### Gate 57: the follow-up migration exists, is ordered after 20261022160000, and covers the whole contract
- CHECK: `node scripts/verify-production-payment-schema.mjs`
- EXPECT: exit 0, `N/N checks passed`
- EVIDENCE: `45/45 checks passed`, EXIT=0 (two verifier assumptions corrected: the contract spans index.ts AND ticket.ts, and `expires_at` is intentionally absent from both as code). A later CRLF checkout exposed a third: JavaScript's `.` does not match `\r`, so the SQL comment stripper left `--` lines visible and the DROP check failed 44/45. The stripper now drops the trailing `\r` first; re-run `45/45`, EXIT=0 on the merged tree — PASS

### Gate 58: rollback-scoped exercises prove the migration's behaviour on production before it is applied
- CHECK: MANUAL — one `execute_sql` transaction ending in `ROLLBACK`
- EXPECT: expiry verdicts `live` / `expired` / `no_window` / `no_intent`; `status='expired'` accepted; a bookkeeping patch accepted; bad `unlock_state` rejected; `anon` cannot execute the expiry RPC; zero residue
- EVIDENCE: the first rehearsal reported `late: "live"` because the column default is `now() + window` and backdating `created_at` alone does not move `expires_at`; the stale row was reconstructed with an explicit past `expires_at` and the rehearsal re-run. `REHEARSAL_RESULT {columns:23, live:"live", late:"expired", pinned_live:"live", pinned_future:"expired", no_intent:"no_intent", late_status:"expired", late_ticket:"verified", late_unlock:"no_effect", late_reason_present:true, bad_state:"rejected", default_expr:"(now() + payment_intent_window())", anon_exec:false, service_exec:true}`; afterwards residue columns 0, function absent, intents 0 — PASS. `no_window` is unreachable after `SET NOT NULL`; its branch is asserted statically by the verifier instead.

### Gate 59: the migration is applied to production exactly once and recorded
- CHECK: MANUAL — run `supabase/sql/production/20261022170000_production_payment_intent_lifecycle.sql`, then insert its version into `supabase_migrations.schema_migrations`
- EXPECT: no error; exactly one row `version = 20261022170000`
- EVIDENCE: `execute_sql` returned `[]` (success); the file's own post-check ran inside the same transaction; `schema_migrations` holds one row `20261022170000 | 20261022170000_production_payment_intent_lifecycle`; `notify pgrst, 'reload schema'` issued in the same transaction — PASS

### Gate 60: production postconditions match the migration
- CHECK: MANUAL — catalog query (`information_schema.columns`, `pg_constraint`, `pg_proc`, `has_function_privilege`) plus expiry verdicts
- EXPECT: 23 columns; `expires_at` default names `payment_intent_window()`; status CHECK includes `expired`; three state CHECKs; expiry function and window exist; `service_role` only
- EVIDENCE: 23 columns; the 12 new columns listed; `expires_at` NOT NULL with `(now() + payment_intent_window())`; status CHECK `pending|succeeded|failed|expired`; `payment_intents_ticket_state_check`, `payment_intents_unlock_state_check`, `payment_intents_verification_state_check`; `payment_intent_expiry_state(p_intent_id uuid, p_at timestamptz)` `secdef=false`, `volatility=s`, ACL `{postgres=X/postgres,service_role=X/postgres}`; `payment_intent_window()` immutable; verdicts `no_intent` for unknown ids — PASS

### Gate 61: the deployed callback no longer falls back to `unavailable`, and its bookkeeping writes land
- CHECK: MANUAL — HTTP POST of two synthetic callbacks (late genuine; live no-effect), read the rows, delete both test intents and their cache row
- EXPECT: `200 ok`; `ticket_state='verified'`; late row `status='expired'` + `status_reason` + `late_callback_at`, no entitlement; live row `status='succeeded'` + `unlock_state='no_effect'` + missing Daraja config named; no user/match/contact rows changed; test rows removed
- EVIDENCE: both `HTTP 200`, body `ok`. Late: `status=expired`, `ticket_state=verified`, `status_reason="genuine callback after expiry — recorded for reconciliation, not unlocked"`, `late_callback_at` set, `mpesa_transaction_id` null, unlock fields null. Live: `status=succeeded`, `ticket_state=verified`, `verification_requested_at` set, `verification_state=unavailable`, `verification_detail="not requested — missing MPESA_INITIATOR, MPESA_SECURITY_CREDENTIAL, MPESA_SHORTCODE, MPESA_CONSUMER_KEY/MPESA_CONSUMER_SECRET, SUPABASE_FUNCTION_URL"`, `unlock_state=no_effect`, `unlock_error="intent has no recipient"`, receipt `TESTLIVE01`. Reaching `status=expired` proves the RPC answered: a failed verdict would have taken the success path. Cleanup left intents 0, cache 0 — PASS

### Gate 62: the contact-rule and isolation guards still pass
- CHECK: `node scripts/verify-section2-contact-rules.mjs && node scripts/verify-section2-isolation.mjs`
- EXPECT: exit 0
- EVIDENCE: `60/60 checks passed` (CONTACT_EXIT=0); `Section 2 isolation checks passed: 3 matching files, 9 Section 2 identifiers absent` (ISOLATION_EXIT=0) — PASS

### Gate 63: the Force Connect / pairing guard still passes
- CHECK: `node scripts/verify-force-connect-pairing.mjs`
- EXPECT: exit 0, `17/17`
- EVIDENCE: `17/17 checks passed`, FORCE_EXIT=0 — PASS

### Gate 64: the whole repository verification suite passes
- CHECK: `npm run verify`
- EXPECT: exit 0
- EVIDENCE: `VERIFY_EXIT=0`; 54/54 payment-ticket, 60/60 contact-rules, 17/17 Force Connect, 45/45 production payment schema, Section 1 weights/mapping, matching eligibility, weekly-generation safety, Section 2 isolation all green — PASS

### Gate 65: the production build passes
- CHECK: `npm run build`
- EXPECT: exit 0
- EVIDENCE: `BUILD_EXIT=0`, `480 modules transformed`, `built in 1.71s` (pre-existing >500 kB chunk warning only) — PASS

### Gate 66: no production row was created, changed or lost by this work
- CHECK: MANUAL — the Gate 56 count query after the migration and the Gate 61 cleanup
- EXPECT: identical to the Gate 56 baseline
- EVIDENCE: users 3, section2_responses 40, progress 1, matches 1, match_history 1, payments 1, messages 6, token_purchases 0, reports 2, payment_intents 0, processed_payment_callbacks 0, connect_unlocks 0, conversations 0, user_blocks 0, notifications 0 — identical to baseline — PASS

### Gate 67: missing external configuration is reported separately from code/schema readiness
- CHECK: MANUAL — `supabase secrets list` (names only) and the deployed function's observed `unavailable` detail
- EXPECT: `MPESA_*` presence reported as names; no secret value printed
- EVIDENCE: the project's secret names are ADMIN_UUID, INTASEND_PUBLIC_KEY, INTASEND_SECRET_KEY, INTASEND_WEBHOOK_CHALLENGE, ONESIGNAL_API_KEY, ONESIGNAL_APP_ID, SERVICE_ROLE_KEY, SUPABASE_* — no `MPESA_*` and no `SUPABASE_FUNCTION_URL`. No digest or value is reproduced here. This is owner configuration, not a schema/code defect — PASS

### Gate 68: the change is delivered (branch, PR, merge)
- CHECK: `git log --oneline origin/main -2`, `gh pr view 13 --json state,mergedAt`
- EXPECT: PR MERGED and the migration present on `origin/main`
- EVIDENCE: PR #13 (commit c0cb260) merged at 2026-10-22T19:46:58Z as merge commit 580a476; `origin/main` contains the migration, the verifier, the doc and this ledger — PASS
