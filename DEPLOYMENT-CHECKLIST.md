# Security Remediation — Deployment Checklist

> **⚠️ Reconciliation 2026-10-14 — read this before deploying.** 7 claims below
> are false (3.3's header name, 5.1's bucket, 6.1's route, 6.2's login flow, 6.4's
> admin flow, the "eleven steps" count, the extra `SERVICE_ROLE_KEY`) and two
> conflicts must be resolved first (the project ref, the test-user email). All 33
> unchecked items are still unverified; five cannot pass as written. See
> [docs/docs-reconciliation-2026-10-14.md](docs/docs-reconciliation-2026-10-14.md) §3.

Work through these **in order**. Code changes are already in the repo; these steps activate them. There is exactly one SQL entrypoint (step 1.1) and it is idempotent, so re-running any of it is safe.

---

## 1. SQL migrations (Supabase Dashboard → SQL Editor)

Run **one file, once**:

- [ ] **1.1** `supabase/migrations/20261014150000_consolidated_schema_chain.sql`
      — the whole schema, in dependency order, in one idempotent script. Paste it
      into the SQL editor and run it (or `supabase db push`; the filename's
      timestamp sorts after everything it replaces).

      It replaces the eleven hand-ordered steps this checklist used to list: the
      profile/RLS fixes, the answers-column fix, the dead bot trigger, the
      payment-intents and messages/section2 foundations, the account-settings
      surface (blocks, deletion), the product flow (matches, conversations,
      connect_unlocks, reports, the paid-contact RPCs), the storage policies,
      the admin backend, the matches-shape reconciliation, the payment-intent
      lifecycle, and the share-toggles / entitlement-clamp migrations.

      Every object those files declared two or three times
      (`payment_intents.callback_key`, `processed_payment_callbacks`,
      `enforce_message_rate_limit`, the messages and matches policies,
      `profiles_public`, `my_profile()`, `complete_connect_unlock`,
      `get_unlocked_contacts`, `handle_new_user`, the `matches` table and its
      index, the Section 2 entitlement columns) is now defined exactly once, by
      the stage that owns it, keeping the version that was live after the old
      order had run. Three hazards the old order survived only by luck are
      fixed: `public.user_blocks` and `public.reports` now exist before the
      messages policies and `admin_reports_list()` that read them, and the
      Section 2 entitlement columns exist before the view that lists them.

      The retired files are retained under `supabase/sql/superseded/` as
      reference rather than verbatim copies: two of them (`fix_rls.sql`,
      `product_flow_bundle.sql`) carry a clarifying edit noted inline, so that a
      re-run cannot undo a fix the chain makes. **Do not run them.** Running one after the chain can
      re-open a defect the chain closes: `harden_resilience.sql`, for example,
      re-creates `enforce_message_rate_limit` counting by `messages.created_at`
      — a column that does not exist — so every message insert fails with 42703,
      and the account-settings/profile copies would re-collide on
      `profiles_public`, whose column list Postgres will not change.

      Preconditions (a normal Supabase project already has them; the chain adds
      only the columns its own scripts introduced): `auth.users`, `auth.uid()`,
      `pgcrypto`, `public.users`, `user_responses`, `messages` (with `sent_at`),
      `section2_chat_progress`, `campuses`, `notifications`, `photos`,
      `token_purchases`, `match_history` (the legacy weekly-engine table — three
      functions read it and no file in this repository creates it), and the
      `storage` schema.

      It also carries the **entitlement evidence** stage, which needs no setup of
      its own. Every server-side grant in the schema — the 14-day trial, the paid
      Section 2 unlock, the paid contact snapshot, the paid Qrashe pair, the free
      14-question contact reveal, profile pause/resume/deletion, the admin role,
      campus flags and the maintenance banner — is written to
      `public.entitlement_grants`: one append-only row per change, with the
      previous value, the new value, who did it, which role, how, and why — the
      reason either stated by the grant path or found by the database as the
      evidence (a succeeded intent). Grant paths that say nothing are still
      recorded (`reason_source = 'none'`), because the point is that no path can
      change an entitlement unrecorded, not that every path is polite.

      The ledger has no cascade delete on purpose: a record that vanished with
      its row could not describe the deletion it was meant to prove. The truth is
      re-derived rather than trusted — `public.entitlement_evidence_anomalies`
      asks whether a paid unlock has a succeeded intent behind it, whether a
      non-standard trial expiry has a grant that states a reason, whether the
      reveal disagrees with the question count, and whether anyone holds the
      admin role with no record of how. `payment_ops_tick()` raises those findings
      onto the same channel as a stuck payment (step 1.2), and section **10
      ENTITLEMENTS** of `inspect_state.sql` reports coverage, the unexplained
      grants and the live findings.

- [ ] **1.2** Give the scheduled ops tick a channel — **this is what makes a stuck unlock reach you.** The payment stage schedules `public.payment_ops_tick()` every five minutes: it expires abandoned M-Pesa pushes, raises one alert per paid-but-not-unlocked intent, raises the entitlement findings of step 1.1, and delivers them.

      a. Enable **pg_cron** and **pg_net** (Dashboard → Database → Extensions). Without pg_cron the chain still applied fine — it printed the `cron.schedule` statement for you — but nothing ticks, so nothing alerts.

      b. Store your webhook URL in Vault, in the SQL editor, so it never lands in a file:

      ```sql
      select vault.create_secret('https://hooks.slack.com/services/…', 'OPS_ALERT_WEBHOOK_URL');
      ```

      Slack, Discord and Telegram all accept the body the tick sends (the message is carried under both `text` and `content`, and each service ignores the key it does not know). For Telegram, put `?chat_id=<id>` in the URL — the sender never sees a chat id.

      **Without the secret nothing breaks and nothing is lost:** the alert is still recorded in `public.ops_alerts`, its row says why it could not be delivered, and `inspect_state.sql` reports the undelivered count as a WARN. That is deliberately a visible failure rather than a silent one — a webhook that starts rejecting alerts (404, revoked token) shows up in the same report, because the tick reads the webhook's answer back from `net._http_response` instead of assuming a POST that pg_net accepted was a message that arrived.

- [ ] **1.3** Insert yourself as admin (get your UUID from Dashboard → Authentication → Users):

      ```sql
      insert into public.admin_users (user_id) values ('YOUR-AUTH-USER-UUID');
      ```

- [ ] **1.4** `supabase/sql/inspect_state.sql` — **paste this after 1.1, and
      after every future re-run of it.** Read-only (a single `SELECT`, so it
      creates and changes nothing and is safe to re-run any number of times),
      and it answers from the live catalogs rather than from any file's comment:
        * the real columns of every table and view the app queries;
        * every policy, trigger and function, with execute grants, plus which
          required ones are simply absent;
        * whether the one entrypoint is APPLIED — one row for the whole chain,
          `<file>  [have/want objects]`, with a PARTIAL naming exactly which
          objects are missing, plus the retired files named once as retired;
        * whether a cron job runs the matcher — nothing in this repository
          schedules the matcher, so a scheduled run was created outside the
          repo — and whether the one schedule this repository does create
          (`payment-ops-tick`) exists, plus whether any alert it raised was
          actually delivered (including the entitlement findings it now
          raises);
        * section **10 ENTITLEMENTS**: how many of the seven grant paths carry
          the recorder (six plus a notice when `public.campuses` does not
          exist), how many grants the ledger holds and across how many kinds,
          how many grants have neither a reason nor evidence, and one row per
          live finding from the verdict.
      Filter to what needs work with
      `where status in ('MISSING','NOT APPLIED','PARTIAL','WARN')`.

**Verify:** after 1.1, `inspect_state.sql` (1.4) must show the chain row
`APPLIED` with `[n/n objects]` — anything less is a PARTIAL that names the
missing object. Then run `supabase/sql/audit_rls.sql`: `users` has policies
incl. `users_select_authenticated`, `user_responses` has owner-only policies,
`payment_intents` exists with zero policies, and triggers `on_auth_user_created`
and `trg_contacts_unlocked` exist. Spot checks that the chain's repairs landed:
`user_responses.responses_array` is `text[]` (it was `integer[]`, so every
answer click failed); `pg_constraint` for `public.matches` shows
`matches_status_check`, `matches_tier_check`, `matches_distinct_pair_check` and
`matches_unique_pair`, with only `matches_select_participant` (SELECT) in
`pg_policies`; `user_blocks` exists with its 3 policies;
`request_account_deletion` and `get_unlocked_contacts` appear in
`\df public.request*`; `payment_intents` carries the ticket/unlock evidence
columns (`ticket_state`, `unlock_state`, `verification_state`);
`select * from public.payment_intent_anomalies;`
expects no `paid_but_not_unlocked`; and
`select ticket_state, unlock_state from public.payment_intents order by created_at desc limit 5;`
reads back. `select * from public.entitlement_evidence_anomalies;` expects no
row (and `select count(*) from public.entitlement_grants;` counts the grants
the chain's own paths have made — a fresh database has none). Section **08
CRON** must show `payment-ops-tick schedule (expire + alert)` as `scheduled`
(not MISSING, and not WARN) and `ops alerts actually delivered` as `ok`; section
**10 ENTITLEMENTS** must show `recorder coverage (every grant path)` as `ok`
(`INFO` with a six-of-seven note is also correct on a project where
`public.campuses` does not exist — the chain reads that table but never creates
it). All of these are read-only rows, so this costs nothing to re-check.

---

## 2. Deploy edge functions (from `minglemate/`, requires `supabase login` + `supabase link --project-ref mhdjnhiqahsllbczbzpk`)

- [ ] **2.1** `npx supabase functions deploy initiate-payment` (purpose-based pricing: section2 200 / force_connect 80 / connect_tier1 70 / connect_tier2 + connect_qrashe 50 — server-enforced)
- [ ] **2.2** `npx supabase functions deploy payment-callback` (**required with 1.1**: the function now screens the ticket on the failure branch too, asks `payment_intent_expiry_state()` for the window verdict instead of reading `expires_at` itself, and records the verified unlock outcome) (dispatches by purpose: Qrashe creation + recipient push for force_connect; contact snapshot + conversation lock for connect_*)
- [ ] **2.3** `npx supabase functions deploy send-notification`
- [ ] **2.4** ~~`run-weekly-matching`~~ — **retired**: it read `section1_responses`, a table nothing writes, so it always produced zero matches; the live engine is `match-generator`. No cron or code calls it (verified repo-wide). **Undeploy:** `npx supabase functions delete run-weekly-matching`
- [ ] **2.5** `npx supabase functions deploy match-generator`

2.5 carries the pause/block enforcement from the account-settings foundation (it skips `profile_status <> 'active'` and blocked pairs). Redeploying it is **required with 1.1** — including if it was already deployed before. The matches-shape part of the chain is why: the weekly engine no longer writes `matches`, so an older deployment would keep inserting `pending` / `is_visible` rows into the Qrashe table.

**Secrets check** (`npx supabase secrets list`): must include `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL`, `ONESIGNAL_API_KEY`, `ONESIGNAL_APP_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (and `SERVICE_ROLE_KEY` for match-generator's cron path — set both spellings if needed).

`payment-callback` additionally corroborates each receipt through Daraja's transactionstatus query. That needs `MPESA_INITIATOR`, `MPESA_SECURITY_CREDENTIAL` (the RSA-encrypted initiator credential) and `SUPABASE_FUNCTION_URL` (the function's own public URL, used for both the result and queue-timeout URL). Without them the intent records `verification_state='unavailable'` naming what is missing — the unlock still happens, because the re-verify is corroboration and deliberately not a gate. `MPESA_ENV=production` switches the Daraja base URL; note `payment-callback` honours it but `initiate-payment` still posts to the sandbox host, so production currently needs that fix before real payments can work end to end.

**Verify:** `curl -X POST https://mhdjnhiqahsllbczbzpk.supabase.co/functions/v1/initiate-payment` with no auth → expect `401 Authentication required` (was: it accepted anything). Same for `match-generator` → `403 Forbidden`.

---

## 3. Frontend deploy (Vercel)

- [ ] **3.1** Merge/push this branch — Vercel auto-deploys with the new `vercel.json` headers
- [ ] **3.2** After deploy, load the site and open DevTools → Console: confirm **no CSP violations**. Known good paths: Supabase API (`*.supabase.co`), OneSignal CDN + worker, Google Fonts. If OneSignal service worker complains, add `https://minglemate-os.vercel.app` style origins per OneSignal's docs.
- [ ] **3.3** Confirm response headers in DevTools → Network → first doc request: `content-security-policy`, `x-frame-options: DENY`, `x-content-type-options: nosniff` present.

---

## 4. Rotations (burned secrets from git history)

- [ ] **4.1** Admin password `minglemate-admin-2025` — obsolete (no longer used in code); no action needed beyond history scrub decision.
- [ ] **4.2** `VITE_ADMIN_PASSWORD=TWO#0292024` — obsolete; was never read by current code.
- [ ] **4.3** The hardcoded **anon JWT** in old Admin.jsx — it's an *anon* key (public by design), but rotate anyway: Dashboard → Settings → API → **Rotate anon key**, then update `VITE_SUPABASE_ANON_KEY` in Vercel env vars.
- [ ] **4.4** If you want the history scrubbed so these strings stop being recoverable: `git filter-repo --path .env --invert-paths` + force-push (destructive — coordinate first; breaks clones).

---

## 5. Dashboard settings (no code)

- [ ] **5.1** Storage → `profile_photos` bucket → confirm the chain's `storage.objects` policies applied (public read; write/delete owner-scoped to `auth.uid()/*`).
- [ ] **5.2** Auth → Rate Limits: confirm sane OTP caps (default 30/hr/email ok to start).
- [ ] **5.3** Auth → URL Configuration: production redirect allow-list only.
- [ ] **5.4** OneSignal dashboard: confirm allowed origins = `https://minglemate.vercel.app` (localhost already there for dev).
- [ ] **5.5** Delete the abandoned test user `buffy.tester@student.university.ac.ke` (Authentication → Users).

---

## 6. Post-deploy verification (order matters)

- [ ] **6.1** **Signup:** create a fresh account → should land on `/onboarding` with NO RLS error; profile row exists in `users`.
- [ ] **6.2** **Login:** request OTP → generic "If that email is registered…" message on bad email (no enumeration); real code arrives for real users.
- [ ] **6.3** **Section 1:** answer all 50 → check `user_responses.responses_array` contains **answer text**; `users.section1_complete = true`.
- [ ] **6.4** **Matching (admin):** as admin, open `/admin` → stats load via RPC → Trigger Matching → `match_history` rows created; non-admin account gets "no access" card.
- [ ] **6.5** **Payment:** initiate STK push → `payment_intents` row appears (pending) → pay with test PIN → intent flips `succeeded`, `users.section2_unlocked = true`, one `token_purchases` row. Try replaying the callback → no duplicate.
- [ ] **6.6** **Paywall:** non-paying user chats with match → contact card absent; try `supabase.rpc('get_match_contact', ...)` manually with a non-matched UUID → empty. After 14 questions → card appears with correct contact.
- [ ] **6.7** **Push:** trigger a notification → arrives on subscribed device; confirm a non-logged-in curl to `send-notification` returns 401.
- [ ] **6.8** **Photos:** try a 10 MB upload → blocked with message; rename a `.txt` to `.jpg` → blocked by magic-byte sniff.
- [ ] **6.9** **Headers:** external scan (securityheaders.com) → grade A or better.
- [ ] **6.10** **Account settings:** Settings page loads and pause toggle flips `users.profile_status`; a blocked user cannot insert a message (RLS rejects); delete-account flow anonymizes sent messages and removes the auth user.
- [ ] **6.11** **Ops tick:** run it once by hand while you are watching the channel —
      `select public.payment_ops_tick();` returns
      `{expired, raised, dispatched}`, and
      `select kind, subject, delivered_at, delivery_error from public.ops_alerts order by created_at desc limit 5;`
      shows what was raised and whether the channel accepted it. On a healthy
      database the tick returns zeros (nothing to expire, nothing to raise); a
      `delivered_at` that stays null with a `delivery_error` is the alert
      module telling you your channel is wrong, which is exactly what it is for.
      To see a real alert without breaking anything, insert a fake stuck intent
      (see the payment stage's verification notes), run the tick, and then delete
      the intent and its alert row.

- [ ] **6.12** **Entitlement evidence:** the same question as 6.5's payment
      replay, asked of every other grant. After the account you signed up in 6.1
      and the payment in 6.5, run:

      ```sql
      -- what has been granted, and does each row say why?
      select kind, subject_table, reason_source, actor_role, reason, created_at
        from public.entitlement_grants order by created_at desc limit 20;

      -- grants nobody explained: a hand-made change, an admin action, or a
      -- client changing their own status. Recognise them or investigate them.
      select kind, subject_table, subject_id, reason, route
        from public.entitlement_grants where reason_source = 'none'
       order by created_at desc limit 20;

      -- what the database will not accept: empty is the healthy answer
      select * from public.entitlement_evidence_anomalies;
      ```

      Expect the paid unlock from 6.5 to appear as `section2_unlock_paid` with an
      evidence pointer at the M-Pesa intent (`reason_source` `declared` or
      `evidence`), the signup to appear as `section2_trial_14d`, and the anomaly
      query to return nothing. To prove the check has teeth, run
      `update public.users set section2_unlocked = true where id = '<a user who never paid>';`
      then `select * from public.entitlement_evidence_anomalies;` — it reports
      `paid_unlock_without_evidence` for that user, and the next tick posts it to
      the channel as CRITICAL. Undo with
      `update public.users set section2_unlocked = false where id = '<that user>';`
      and delete the two ledger rows and the alert row it produced.

      The same assertion runs unattended against a local stack:
      **`node scripts/verify-entitlement-clamp.mjs`** (`supabase start` first; the
      script's header says how to get the chain onto a brand-new stack). It
      creates two accounts, has one of them try to unlock itself over PostgREST
      with its own JWT, proves the attempt changes nothing and records no grant,
      proves a service-role write still unlocks and lands in the ledger pointing
      at the intent that paid for it, and checks the verdict stays quiet. Where
      the stack refuses the write for lack of a privilege, it says so and then
      grants `update` for the length of one check so the clamp itself — the thing
      this is a regression test for — is what decides, putting the grant back
      afterwards.

---

**Rollback note:** the chain is additive/idempotent — re-running is safe. The only breaking change is its profile block (it revokes the broad `users` SELECT in favour of a column list without `display_phone`); if the frontend deploys before 1.1, profile reads return nothing until the chain runs. Deploy order: **SQL first, functions second, frontend third.**
