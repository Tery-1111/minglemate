# Security Remediation — Deployment Checklist

Work through these **in order**. Code changes are already in the repo; these steps activate them. Every SQL file is idempotent (safe to re-run).

---

## 1. SQL migrations (Supabase Dashboard → SQL Editor)

Run in this exact order:

- [ ] **1.1** `supabase/sql/fix_rls.sql`
      Profile-creation trigger (fixes signup) + `users` RLS policies.
- [ ] **1.2** `supabase/sql/harden_profile_reads.sql`
      Column-level grants on `users`, `profiles_public` view, `my_profile()` + `get_match_contact()` RPCs.
- [ ] **1.3** `supabase/sql/admin_role.sql`
      `admin_users` table + admin RPCs (`am_i_admin`, `admin_overview`, campus mutations).
- [ ] **1.4** `supabase/sql/remediation_bundle.sql`
      `payment_intents` table, txn idempotency constraint, `messages` + `section2_chat_progress` RLS, `contacts_unlocked` trigger.
- [ ] **1.5** Insert yourself as admin (get your UUID from Dashboard → Authentication → Users):
      ```sql
      insert into public.admin_users (user_id) values ('YOUR-AUTH-USER-UUID');
      ```

**Verify:** run `supabase/sql/audit_rls.sql` — check `users` has policies incl. `users_select_authenticated`, `user_responses` has owner-only policies, `payment_intents` exists with zero policies, trigger `on_auth_user_created` and `trg_contacts_unlocked` exist.

---

## 2. Deploy edge functions (from `minglemate/`, requires `supabase login` + `supabase link --project-ref mhdjnhiqahsllbczbzpk`)

- [ ] **2.1** `npx supabase functions deploy initiate-payment`
- [ ] **2.2** `npx supabase functions deploy payment-callback`
- [ ] **2.3** `npx supabase functions deploy send-notification`
- [ ] **2.4** `npx supabase functions deploy run-weekly-matching`
- [ ] **2.5** `npx supabase functions deploy match-generator`

**Secrets check** (`npx supabase secrets list`): must include `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL`, `ONESIGNAL_API_KEY`, `ONESIGNAL_APP_ID`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (and `SERVICE_ROLE_KEY` for run-weekly-matching — set both spellings if needed).

**Verify:** `curl -X POST https://mhdjnhiqahsllbczbzpk.supabase.co/functions/v1/initiate-payment` with no auth → expect `401 Authentication required` (was: it accepted anything). Same for `run-weekly-matching` → `403 Forbidden`.

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

- [ ] **5.1** Storage → `profile_photos` bucket → Policies: confirm **write** scoped to `auth.uid()/*` path prefix and owner-only delete; public read is fine for profile pics.
- [ ] **5.2** Auth → Rate Limits: confirm sane OTP caps (default 30/hr/email ok to start).
- [ ] **5.3** Auth → URL Configuration: production redirect allow-list only.
- [ ] **5.4** OneSignal dashboard: confirm allowed origins = `https://minglemate.vercel.app` (localhost already there for dev).
- [ ] **5.5** Delete the abandoned test user `buffy.tester@student.egerton.ac.ke` (Authentication → Users).

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

---

**Rollback note:** all SQL is additive/idempotent — re-running is safe. The only breaking change is `harden_profile_reads.sql` (revokes broad `users` SELECT); if the frontend deploys before the SQL, profile reads fail until 1.2 runs. Deploy order: **SQL first, functions second, frontend third.**
