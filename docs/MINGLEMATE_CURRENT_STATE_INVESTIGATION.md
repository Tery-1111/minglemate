# MingleMate — Current-State Investigation Report

**Date of investigation:** 2026-10-19
**Repository:** `C:\Users\oboch\minglemate` (branch `fix/review-2026-10-15`, HEAD `dfad57673d149a2bbea08b69b481d179999dc0ce`)
**Nature of this report:** Evidence-only description of what exists in the repository and what was actually verified to work. No comparison with any product requirement document, no recommendations, no fixes. Runtime behavior was only verified where a safe local check could be executed; everything else stops at the last verified point and says so.

---

## A. Executive summary

MingleMate is a Vite + React 19 single-page application backed by Supabase (Auth, Postgres/PostgREST, Edge Functions, Storage, Realtime), with M-Pesa (Safaricom Daraja) payments, OneSignal web push, PostHog analytics, Sentry error tracking, and Vercel hosting. The repository is on a working branch carrying **uncommitted prior work**: 10 modified files and 7 untracked files (all listed in §B), none of which was touched by this investigation.

**What was verified to work in this session (all local, all read-only or pure-execution):**

- The consolidated schema chain passes its own static integrity check: `node scripts/check-schema-chain.mjs` → **113/113 checks passed** (exit 0).
- The payment-callback branch logic passes its pure-function test: `node scripts/verify-payment-ticket.mjs` → **54/54 checks passed** (exit 0).
- The weekly-generation safety regression check passes: `node scripts/verify-weekly-generation-safety.mjs` → exit 0 (4 migrations TRUNCATE-free; retirement migration DML-free; legacy edge engines absent; match-generator campus-aware).
- The shared matching-eligibility helper passes its assertions: `node scripts/verify-matching-eligibility.mjs` → **8/8 checks passed** (exit 0).
- The production build succeeds: `npm run build` → exit 0 (Vite/rolldown, ~5 s; one chunk-size warning).
- The Section 1 question bank loads as code: 50 questions × 4 options (verified by importing `src/data/section1Questions.js` in Node).

**What was checked and FAILED:**

- `npm run lint` → **exit 1** with 44 problems (25 errors, 19 warnings) across 20 files. Details in §G.

**What could NOT be run (recorded as NOT RUN, never as passing):**

- `scripts/verify-rls-closure.mjs` and `scripts/verify-entitlement-clamp.mjs` — exit 2, no local Supabase stack running (port 54321 closed).
- `scripts/e2e-matching-test.mjs` — exit 1 by design without `E2E_SUPABASE_URL`/`E2E_SUPABASE_ANON_KEY` (staging-only script).
- `scripts/sandbox-transactionstatus.mjs` — exit 3 without M-Pesa sandbox credentials.
- No live database (local or remote) was inspected. Every schema/policy/function statement in this report comes from repository files (migrations, SQL helpers), never from a live catalog.

**Overall:** the application is fully *implemented* in source across all 22 scope areas. The database schema, RLS posture, payment verification chain, matching pipeline, and admin surface are all present and unusually well-documented in-file. Runtime correctness against a real database, real auth session, real M-Pesa push, and real cron execution remains **unverified by this investigation** — the checks that would verify it require a running stack, staging credentials, or production access that were not available here.

---

## B. Repository and architecture inventory

### B.1 Protection record (taken before any work)

| Item | Value |
|---|---|
| Working directory | `C:\Users\oboch\minglemate` |
| Branch | `fix/review-2026-10-15` |
| HEAD | `dfad57673d149a2bbea08b69b481d179999dc0ce` — "Fix signup upsert under column grants, add notifications_enabled grant, fix clamp script cleanup" |
| Staged files | none |
| Modified (unstaged), 10 | `DEPLOYMENT-CHECKLIST.md`, `scripts/check-schema-chain.mjs`, `src/pages/Chat.jsx`, `src/pages/Faq.jsx`, `src/pages/HowItWorks.jsx`, `src/pages/Signup.jsx`, `supabase/.temp/cli-latest`, `supabase/functions/match-generator/index.ts`, `supabase/migrations/20261014150000_consolidated_schema_chain.sql`, `supabase/sql/inspect_state.sql` |
| Untracked, 7 | `scripts/verify-matching-eligibility.mjs`, `scripts/verify-rls-closure.mjs`, `scripts/verify-weekly-generation-safety.mjs`, `supabase/functions/_shared/matchingEligibility.ts`, `supabase/migrations/20261015120000_rls_closure_precondition_tables.sql`, `supabase/migrations/20261015160000_photos_unique_per_user_and_type.sql`, `supabase/migrations/20261019190000_retire_generate_tuesday_matches.sql` |
| Local-only, git-ignored | `.env`, `.env.local`, `.env.daraja.local` (exist; **never read or printed**), `dist/`, `dev-server.log`, `vite.log`, `node_modules/`, `scripts/out/` |
| Tooling | Node v24.14.0, npm 11.16.0, `node_modules` installed |
| Prior 5 commits | dfad576 (above), 65b5eb3 (users grant hardening + payment-only contact gate), 161fe66 (review fixes D-3/D-2i/D-2ii), 632447f (inspect photos.display_order fix), 2851d74 (conversations table convergence) |

No file was created, modified, staged, committed, pushed, or deployed by this investigation. Existing uncommitted work was read only.

### B.2 Package scripts and tooling (`package.json`)

| Script | Command | Notes |
|---|---|---|
| `dev` | `vite` | dev server |
| `build` | `vite build` | **verified passing** (§G-6) |
| `lint` | `eslint .` | **verified failing**, exit 1 (§G-5) |
| `preview` | `vite preview` | not run |

Dependencies: `@supabase/supabase-js` ^2.100.0, `react`/`react-dom` ^19.2.4, `react-router-dom` ^7.18.4, `@sentry/react` ^10.75.0, `posthog-js` ^1.434.2, `date-fns` ^4.1.0. Dev: Vite 8, ESLint 9 flat config (`eslint.config.js`, ignores `dist/`, applies `react-hooks` v7 recommended incl. `immutability` rules and `react-refresh/vite`).

There is **no unit-test framework** (no vitest/jest in dependencies). The repository's verification surface is the eight `scripts/*.mjs` files plus lint/build (§G).

### B.3 Structure

```
minglemate/
├── index.html                    # OneSignal SDK bootstrap, SEO/OG meta, noscript
├── vercel.json                   # SPA rewrite + security headers + CSP (Report-Only)
├── vite.config.js                # react plugin only
├── eslint.config.js
├── src/
│   ├── main.jsx                  # Sentry.ErrorBoundary + initSentry/initAnalytics
│   ├── App.jsx                   # all 30 routes, AuthGuard wrapper, maintenance banner, SeoManager
│   ├── supabaseClient.js         # createClient(url, anon key); saveOneSignalPlayerId()
│   ├── seo.js                    # per-route SEO metadata + JSON-LD
│   ├── components/               # AuthGuard, BottomNav, FadeImage, GoogleButton,
│   │                             # MaintenanceBanner, PasswordField, Turnstile
│   ├── data/section1Questions.js # 50 questions × 4 options (verified count)
│   ├── lib/                      # analytics.js (PostHog), sentry.js, profile.js (validation)
│   ├── pages/                    # 30 page components (see §B.4)
│   └── utils/imageResize.js      # client-side 1200px / JPEG q0.85 resize
├── supabase/
│   ├── config.toml               # local stack config; [functions.payment-callback] verify_jwt=false
│   ├── functions/                # health, initiate-payment, match-generator,
│   │                             # payment-callback (+ticket.ts), send-notification
│   │   └── _shared/              # compatibilityEngine.ts, matchingEligibility.ts
│   ├── migrations/               # 4 timestamped files (see §D.1)
│   ├── sql/                      # inspect_state.sql, audit_rls.sql, seed_test_sessions.sql
│   │   └── superseded/           # 15 retired scripts (provenance only; header says do not run)
│   └── .temp/                    # CLI state: linked project ref, preconditions.sql, versions
├── scripts/                      # check-schema-chain, e2e-matching-test, sandbox-transactionstatus,
│                                 # verify-entitlement-clamp, verify-matching-eligibility,
│                                 # verify-payment-ticket, verify-rls-closure,
│                                 # verify-weekly-generation-safety
├── docs/                         # product-spec.md, docs-reconciliation-2026-10-14.md,
│                                 # client-writable-truth-audit.md
└── .github/workflows/weekly-db-backup.yml  # manual-trigger only; schedule commented out
```

Top-level operational documents: `README.md`, `DEPLOYMENT-CHECKLIST.md` (carries a reconciliation banner stating 7 of its claims are false and 2 conflicts must be resolved), `SECURITY-REPORT.md`, `ADMIN-PANEL-REMEDIATION.md`.

### B.4 Routes (`src/App.jsx`, all verified present in source)

Public: `/`, `/matches-info`, `/faq`, `/terms`, `/privacy`, `/signup`, `/login`, `/verify-code`, `/forgot-password`, `/reset-password`.
AuthGuard-wrapped (19): `/profile-setup`, `/photo-upload`, `/interests`, `/home`, `/discover`, `/messages`, `/celebration`, `/match/:userId`, `/force-connect/:userId`, `/section1`, `/section2`, `/payment`, `/profile`, `/chat/:matchId`, `/matches`, `/admin`, `/photos`, `/settings`, `/blocked`. The 19 authenticated routes are `React.lazy` code-split; marketing routes are eager. Route-level SEO applied on every navigation by `SeoManager`.

---

## C. Feature-by-feature findings

Finding IDs are unique. Statuses are used exactly as defined (§J maps each to a scope area).

### C.1 Project structure, dependencies, architecture — **IMPLEMENTED; build VERIFIED**

- **F-01** — SPA + BFF-less architecture: all data access from the browser goes through PostgREST (Supabase client with anon key) or five Deno Edge Functions. Evidence: `src/supabaseClient.js`, `supabase/functions/*`. Verified: static; build passes.
- **F-02** — Global error surface: `src/main.jsx` wraps the app in `Sentry.ErrorBoundary` with a `CrashScreen` fallback; Sentry/PostHog initialize only when `VITE_SENTRY_DSN` / `VITE_POSTHOG_KEY` are set, otherwise stay off without breaking (`src/lib/sentry.js`, `src/lib/analytics.js`).
- **F-03** — Maintenance banner: `App.jsx` reads `app_settings.maintenance_message` (id=1) on load and renders a dismissible banner. DB side: `app_settings` table + `admin_set_maintenance_message()` RPC (is_admin-guarded) in the schema chain. Runtime effect UNVERIFIED.

### C.2 Authentication, sessions, access control — **IMPLEMENTED — UNVERIFIED**

- **F-04** — Signup (`src/pages/Signup.jsx`): `supabase.auth.signUp` with Turnstile `captchaToken`; on success navigates to `/verify-code` with no session (email confirmation on). A `user_already_exists` 422 is routed to the same code screen so responses never reveal account existence. No client write to `public.users` — the profile row is created server-side by the `on_auth_user_created` trigger (`handle_new_user()` in the chain), which also grants the 14-day Section 2 trial and declares an entitlement-ledger context.
- **F-05** — OTP verification (`src/pages/VerifyCode.jsx`): `verifyOtp({type:'signup'})`, generic error text, resend capped at 3 per visit with 60 s cooldown; success routes to `/profile-setup`. Verification via `identifyUser`/`track` (PostHog).
- **F-06** — Login (`src/pages/Login.jsx`): `signInWithPassword` with Turnstile token. `email_not_confirmed` → resend code + route to `/verify-code`; all other failures show one generic message (anti-enumeration).
- **F-07** — Google OAuth (`src/components/GoogleButton.jsx`): `signInWithOAuth({provider:'google', redirectTo: origin + '/home'})`; same-window redirect; session picked up by `detectSessionInUrl`. Google users have `email_confirmed_at` set and skip `/verify-code`. Requires the origin to be allow-listed in Supabase URL Configuration (config item, not verified).
- **F-08** — Route guard (`src/components/AuthGuard.jsx`): single choke point; uses `auth.getUser()` (server-validated) rather than `getSession()`; treats session-missing as logged-out; bounces unconfirmed emails to `/verify-code`; listens for `SIGNED_OUT`; has error/retry UI. Replaces 14 previously copy-pasted per-page checks (per in-file comment; old code not present at HEAD to confirm).
- **F-09** — Client auth configuration (`src/supabaseClient.js`): `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)` — no persistSession/URL overrides; also exports `saveOneSignalPlayerId(userId)` which updates `users.onesignal_player_id` for the signed-in user (column is in the client UPDATE grant, chain ~L2090).
- **F-10** — Captcha: `src/components/Turnstile.jsx` (Cloudflare Turnstile) wired into both Signup and Login. Functional behavior at runtime UNVERIFIED (depends on site key + Supabase CAPTCHA setting).
- **Limitation:** no auth flow was executed end-to-end (no live project access, no test accounts created in this investigation). Statuses: IMPLEMENTED — UNVERIFIED.

### C.3 Onboarding and returning-user behavior — **IMPLEMENTED — UNVERIFIED**

- **F-11** — Onboarding order implemented in code: Signup → `/verify-code` → `/profile-setup` → `/photo-upload` → `/interests` (≥3) → `/section1` (50 Q) → `/section2` (20 Q) → `/discover`. Each page navigates to the next on success (`ProfileSetup.handleSubmit`, `PhotoUpload.handleSubmit`, `Interests.handleSubmit`, `Section1.handleSelectOption`, `Section2.handleSave`).
- **F-12** — ProfileSetup (`src/pages/ProfileSetup.jsx`): derives campus from email domain via `campuses` table lookup (`email_domain` match); any other domain leaves `campus_id` null (unaffiliated user). Writes via `update` (not upsert) on own `users` row: full_name, age, gender, campus_id, residence_type, bio, phone, whatsapp_number, display_phone, social handles. Client-side validation: required fields, bio ≥ 50 chars, age ≥ 18, phone + WhatsApp required. `section2_free_expires_at` deliberately not sent (server-owned; clamp discards client writes).
- **F-13** — Returning users: `Home.jsx` reads own `users` row; if `section1_complete` it renders the `Matches` component; if this week's `match_history` row exists and `sessionStorage 'celebrated_week' !== weekId`, it redirects to `/celebration` once per week. Section1 restores `section1_progress` and previously saved answers; completed users are bounced to `/discover` unless `?retake=1`.

### C.4 Profiles, profile editing, interests — **IMPLEMENTED — UNVERIFIED**

- **F-14** — Profile read: own row via `my_profile()` RPC (SECURITY DEFINER, `auth.uid()`-derived, returns full row). Evidence: `Profile.jsx loadProfile`, `Chat.jsx`, `Settings.jsx`; function defined in the chain (composed profile block).
- **F-15** — Profile edit (`Profile.jsx handleSave`): bio, residence_type, looking_for, interests (≤15), profile_prompts (≤3, answers ≤280 chars, library-referenced ids only) — validated client-side by `src/lib/profile.js` and server-side by DB constraints `bio_max_300` and `prompts_shape` (chain).
- **F-16** — Contact-sharing controls (`Profile.jsx handleSharingSave`): six `share_*` toggles plus three social handle values written to own row; these columns are in the client UPDATE grant. Affect future Connect snapshots only (snapshot semantics live in `complete_connect_unlock`, §C.10).
- **F-17** — Interests (`Interests.jsx`): 30-tag vocabulary defined locally in the page (duplicated in `Profile.jsx` — same array in both files); onboarding requires ≥3, edit mode allows 0; writes `users.interests`.
- **F-18** — `looking_for` options and prompt library centralized in `src/lib/profile.js`; DB column `users.looking_for` granted for select/update.

### C.5 Photo uploads, storage, references, display — **IMPLEMENTED; migration present, UNVERIFIED at runtime**

- **F-19** — Two upload paths, both writing bucket `user-photos` at `${userId}/…` and upserting a `photos` row on `(user_id, photo_type)`:
  - `PhotoUpload.jsx` (onboarding): exactly two slots (`facial`, `full_body`), resize via `src/utils/imageResize.js` (1200px, JPEG q0.85).
  - `Photos.jsx` (management): same two slots; adds **magic-byte sniffing** (JPEG/PNG/WebP) and a **5 MB cap** — `PhotoUpload.jsx` has neither (discrepancy D-6, §I).
- **F-20** — Storage policies: chain stage 5 creates public-read + owner-scoped insert/update/delete policies for **both** buckets (`profile_photos` and the `user-photos` bucket the app actually writes). Path scoping: `(storage.foldername(name))[1] = auth.uid()`.
- **F-21** — Untracked migration `20261015160000_photos_unique_per_user_and_type.sql` adds `photos_user_id_photo_type_key unique (user_id, photo_type)`; refuses (raises) if duplicate pairs exist, deletes nothing. Rationale in header: without it both upsert paths fail with 42P10. Static check by `check-schema-chain.mjs` (part of the 113 passing checks). Not applied to any database by this investigation.
- **F-22** — Display: Discover/Messages/Payment/ForceConnect read `photo_type='facial'`; MatchDetail prefers `full_body`; ordering by `display_order` (chain converges `photos.display_order` with `add column if not exists`).

### C.6 Section 1 & Section 2 questionnaires — **IMPLEMENTED — UNVERIFIED persistence at runtime**

- **F-23** — Section 1: 50 multiple-choice questions × 4 options in `src/data/section1Questions.js` (**verified by import: 50×4**). `Section1.jsx` writes the **chosen option text** (not an index) positionally into `user_responses.responses_array` (one upsert per answer, `onConflict: 'user_id'`) and advances `users.section1_progress / section1_complete / section1_last_edited`. Optimistic UI with error-preserving rollback.
- **F-24** — Column type: the chain converts legacy `responses_array integer[] → text[]` (guarded `do` block) — evidence the deployed column was once integer; the compatibility engine and Admin both tolerate legacy numeric rows (mapped to null / index lookup).
- **F-25** — RLS on `user_responses`: owner-only select/insert/update (`responses_*_own` policies, chain stage 1). Matching reads bypass RLS via service role (match-generator).
- **F-26** — Section 2: 20 open-text questions, **duplicated verbatim** in `Section2.jsx` and `Chat.jsx` (same array in both files; discrepancy D-5). Answers upsert into `section2_responses (user_id, question_number, answer_text)` with `onConflict: 'user_id,question_number'`. Completing Section 2 grants **no entitlement** — `section2_unlocked` is server-owned; the clamp trigger `clamp_user_protected_columns` discards client writes (chain stage 3; in-file comment in `Section2.jsx` states this).
- **F-27** — `section2_responses` is a **precondition table**: no file under `supabase/migrations/` or non-superseded `supabase/sql/` creates it (grep-verified); `inspect_state.sql` lists it as expected. Its RLS policies were not inspected anywhere in the repository (gap G-3, §I).
- **F-28** — Guided-chat question flow (client-side bot): `Chat.jsx sendBotQuestion` inserts a message row (`is_bot: true`, `match_week_id`) and updates `section2_chat_progress (last_question_sent, questions_discussed, contacts_unlocked:false)`. DB trigger `trg_contacts_unlocked` (`enforce_contacts_unlocked()`, chain) pins `contacts_unlocked` for client writes and derives the 14-question reveal server-side, recording an entitlement context. The legacy DB trigger `trg_auto_bot_question` was dropped by the chain (it referenced a non-existent column and broke every insert).

### C.7 Compatibility scoring and its actual inputs — **VERIFIED — WORKING (pure logic)**

- **F-29** — `supabase/functions/_shared/compatibilityEngine.ts`: scores = fraction of questions where both users chose the **exact same option text** (trim + lowercase), per 10-question dimension; overall = `0.30·communication + 0.25·conflict + 0.20·emotional + 0.15·expectations + 0.10·values`. Inputs: `user_responses.responses_array` positions 1–50, loaded by match-generator via service role.
- **F-30** — Eligibility helper `supabase/functions/_shared/matchingEligibility.ts` (untracked file): `areEligibleCandidates` = opposite gender **and** strict campus equality (null campus pairs only with null campus — mixed pairs excluded) **and** pair not in the blocked set (direction-agnostic `pairKey`). **Verified: 8/8 assertions pass** (`scripts/verify-matching-eligibility.mjs`, exit 0).

### C.8 Discover candidate retrieval and display — **IMPLEMENTED — UNVERIFIED at runtime**

- **F-31** — `discover_candidates()` RPC (chain stage 2, SECURITY DEFINER, granted to `authenticated`): `u.id <> auth.uid()`, `profile_status='active'`, `section1_complete`, opposite gender, campus match-or-both-null, no block either direction, never paired in `matches` nor previously in `match_history`, `ORDER BY created_at LIMIT 5`.
- **F-32** — `Discover.jsx`: calls the RPC, then fetches facial photos for the returned ids in one `.in('user_id', ids)` query; renders exactly 5 skeleton cards while loading; caches board + photos in `sessionStorage` per visit; selection opens `/force-connect/:userId`. Error path only surfaces when no cache exists.

### C.9 Scheduled matching, eligibility, history, release — **IMPLEMENTED — UNVERIFIED; schedule not in repo**

- **F-33** — Weekly engine = Edge Function `match-generator` (`supabase/functions/match-generator/index.ts`):
  - Auth: `apikey` header must equal `SUPABASE_SERVICE_ROLE_KEY`, **or** a presented JWT must resolve to a user listed in `admin_users`; otherwise 403.
  - Inputs: all users with `section1_complete=true AND profile_status='active'`; their `user_responses`; all `user_blocks` rows.
  - Pairing: O(n²) over eligible pairs, `calculateCompatibility`, pair stored in memory only.
  - Delivery: per user, ranks partners by score, **excludes previous-week partners when alternatives exist** (falls back to full pool), writes `match_history` upsert on `(user_id, week_id)` in batches of 500 via service role; returns `{matchesProcessed, usersDelivered}`.
  - **It writes only `match_history`**, never `matches` (in-file rationale: `matches` is the paid-Qrashe table).
- **F-34** — Week id format `YYYY-Www` computed by an inline `getWeekId()`; the same function is **duplicated** in `match-generator`, `Matches.jsx`, `MatchDetail.jsx`, `MatchCelebration.jsx`, `Home.jsx`, `Messages.jsx`, `Chat.jsx` (identical implementation in each; discrepancy D-4).
- **F-35** — Nothing in the repository schedules `match-generator`. The chain schedules only `payment-ops-tick` (`*/5 * * * *`, conditional on pg_cron). `inspect_state.sql` section 08 CRON reports whether a matcher cron exists at runtime. The untracked migration `20261019190000_retire_generate_tuesday_matches.sql` documents (in its header) a production cron `calculate-weekly-matches` that calls the legacy TRUNCATE-based `generate_tuesday_matches()`; the migration replaces that function's body with a raise-exception stub and re-revokes EXECUTE from public/anon/authenticated. **This migration is not applied to any database by being in Git** (its own header says so). Its static safety properties are verified by `scripts/verify-weekly-generation-safety.mjs` (exit 0).
- **F-36** — Weekly delivery surfaces: `Matches.jsx` (tier1/tier2 from `match_history` for the *client-computed* current week + Qrashe from `matches`), `MatchCelebration.jsx`, `Messages.jsx` (both directions), `MatchDetail.jsx` (tier resolution checks both users' `match_history` rows).
- **F-37** — `match-generator`'s deployed content cannot be verified from the repository; `scripts/e2e-matching-test.mjs` exists to verify it against **staging only** (it hard-refuses the production ref) but requires `E2E_SUPABASE_URL`/`E2E_SUPABASE_ANON_KEY` — NOT RUN here.

### C.10 Tier 1 / Tier 2 / Qrashe / Connect / Force Connect — **IMPLEMENTED — UNVERIFIED**

- **F-38** — Product tiers as implemented: Tier 1 = highest overall compatibility; Tier 2 = next-best distinct partner (both delivered weekly into `match_history`); Qrashe = paid Force Connect pair stored in `matches` (`tier='qrashe'`). `matches` table shape is canonicalized by the chain + the matches-shape stage: participant FKs cascade, `matches_unique_pair`, `matches_distinct_pair_check`, status check superset, participant-only SELECT policy, **no client write** (revoked), creation only via `complete_force_connect`.
- **F-39** — Force Connect completion `complete_force_connect(intent_id)` (chain, SECURITY DEFINER, **granted to service_role only**): validates the intent is `purpose='force_connect'` + `status='succeeded'` + has recipient; idempotent (existing pair returns early); records entitlement context; inserts `matches` (ordered pair), upserts `conversations` to active/qrashe, inserts a bot system message, inserts a `notifications` row for the recipient.
- **F-40** — Paid contact unlock `complete_connect_unlock(intent_id)` (service_role only): validates intent purpose ∈ {connect_tier1, connect_tier2, connect_qrashe} + succeeded; **re-checks pairing** via `users_are_paired`; snapshots only the seller's *then-enabled* share flags into `connect_unlocks` (unique per buyer/seller); on first insert locks the conversation (`status='locked', locked_at=now()`) and sends a system message. Repeated callbacks are no-ops.
- **F-41** — `users_are_paired(a,b)` (SECURITY DEFINER): true if either user's `match_history` tier slots name the other, or an **active** `matches` row holds the pair. This is the pairing predicate used by the unlock RPCs and by `initiate-payment`'s pre-checks.
- **F-42** — Frontend: `MatchDetail.jsx` maps detected tier → purpose/price (tier1→connect_tier1 KSh 70, tier2→connect_tier2 KSh 50, else connect_qrashe KSh 50) and routes to `/payment`; `ForceConnect.jsx` shows the KSh 80 receipt screen; `Discover.jsx` action bar offers Force Connect.
- **F-43** — Unmatch `unmatch_conversation(other_user_id)` (granted to `authenticated`, uid server-derived): refuses when any `connect_unlocks` row exists in either direction ("Cannot unmatch after Connect"); sets `conversations.status='unmatched'` and `matches.status='unmatched'` for active rows the caller participates in.

### C.11 Payment initiation, provider integration, verification, failure handling — **IMPLEMENTED; decision logic VERIFIED; runtime UNVERIFIED**

- **F-44** — `initiate-payment` (Edge Function): identity from JWT only; server-price table (section2 200 / force_connect 80 / connect_tier1 70 / connect_tier2 50 / connect_qrashe 50); Kenyan phone validation + MSISDN normalization; for connect purposes validates recipient exists, is not self, `users_are_paired` holds, no prior `connect_unlocks` row (force-connect: no existing `matches` pair); section2 short-circuits if already unlocked; rolling rate limit 5 pushes/hour counted from `payment_intents`; inserts a `pending` intent (purpose + recipient + server price); performs the Daraja OAuth + STK push; appends a **per-intent callback key** (`crypto.randomUUID()`) to the `CallBackURL` as `?intent=<id>&ck=<key>`; records `checkout_request_id`/`callback_key` or marks the intent `failed` when no `CheckoutRequestID` is returned.
- **F-45** — ⚠️ `initiate-payment` posts to `https://sandbox.safaricom.co.ke/...` **unconditionally** (both OAuth and STK endpoints hardcode the sandbox host); only `payment-callback` honours `MPESA_ENV=production`. This is stated in `DEPLOYMENT-CHECKLIST.md` §2 as a known production gap. Evidence: `initiate-payment/index.ts` token + STK fetch URLs; `payment-callback/index.ts` `MPESA_ENV` switch.
- **F-46** — `payment-callback` (Edge Function, `verify_jwt=false` in `config.toml` — required because Daraja calls it): decision ordering lives in pure module `payment-callback/ticket.ts`; `index.ts` performs only the I/O the decisions call for. Order: classify body (STK vs async status result vs unknown) → resolve intent (by `?intent=` or `checkout_request_id`) → ask the **database** for the expiry verdict (`payment_intent_expiry_state` RPC; the function never compares timestamps itself) → `decideStkAction`:
  1. **Ticket first** (`screenTicket`): intent must carry a `callback_key` and the caller must present it as `?ck=`; absent/wrong/no-key-on-intent → 401 with `ticket_state` recorded. Applied on the failure branch too.
  2. Daraja `ResultCode ≠ 0` → `record_failed` (pending only).
  3. Expired (DB verdict or status='expired') → `late_callback`: records `late_callback_at` + reason, unlocks nothing.
  4. Already succeeded → `noop` if unlock applied, else `retry_unlock` (both RPCs idempotent).
  5. Amount mismatch vs intent → `amount_mismatch` → failed.
  6. Else `process`: idempotency insert into `processed_payment_callbacks` (only a unique violation counts as "someone else won"; any other cache error logs and continues); enqueue Daraja transactionstatus re-verify (**corroboration only**, recorded as `verification_state`, never gates the unlock; requires MPESA_INITIATOR/MPESA_SECURITY_CREDENTIAL/SUPABASE_FUNCTION_URL, otherwise records `unavailable` naming what is missing); **consume the intent first** (`pending→succeeded` guarded update + receipt id); then apply the unlock and **read back the effect** (`matches` row / `connect_unlocks` row / `section2_unlocked` + `token_purchases`), recording `unlock_state ∈ {applied, failed, no_effect}`; `failed` → HTTP 500 so Daraja redelivers; `no_effect` is surfaced, not looped.
- **F-47** — `scripts/verify-payment-ticket.mjs` **verified: 54/54 checks pass** (exit 0), including the end-to-end decision walk `process → retry_unlock → noop` for every unlock purpose, ticket screening on both branches, expiry-state handling, amount matching, cache-error classification, and transactionstatus request/ACK/patch shapes. This establishes the *decision logic*; it does not execute Deno, HTTP, or a database.
- **F-48** — Payment lifecycle SQL (chain stage 4): `expires_at` default `now() + payment_intent_window()` (one 30-minute definition); status vocabulary gains `expired`; evidence columns (`ticket_state`, `status_reason`, `verification_*`, `unlock_*`, `late_callback_at`) with CHECK constraints; `payment_intent_expiry_state()` (SECURITY INVOKER, service_role only); `expire_stale_payment_intents()` sweep; `payment_intent_anomalies` view (`security_invoker`); `payment_ops_tick()` scheduled every 5 minutes by the chain when pg_cron exists (expire → raise payment alerts → raise entitlement alerts → dispatch via pg_net to a Vault-stored `OPS_ALERT_WEBHOOK_URL`, with delivery read back from `net._http_response`).
- **F-49** — Frontend `Payment.jsx`: purpose-driven receipt UI (display-only prices); phases `idle → pushing → success | pending | failed`; polls every 5 s up to 12 attempts for the server-side effect (`section2_unlocked`, `matches` row, or `connect_unlocks` row); a `pending` phase keeps an `awaitingPin` watcher so a refresh mid-STK never re-charges blindly (no client-readable intent exists — RLS has zero policies on `payment_intents`).

### C.12 Contact privacy and authorization — **IMPLEMENTED — UNVERIFIED**

- **F-50** — Column-scoped privacy (chain stage 3): blanket `users` SELECT revoked; column grant to anon/authenticated covers public-profile fields **without** `display_phone`; separate `notifications_enabled` select grant; INSERT/UPDATE grants enumerate exactly the columns the app writes; `profiles_public` view (`security_invoker=on`) exposes the public subset; `my_profile()` returns the caller's full row.
- **F-51** — Reveal paths: `get_unlocked_contacts(other_user_id)` (granted to authenticated) — requires pairing, then returns only the **paid snapshot** row for this buyer/seller; no reading of questions/trial state. `get_match_contact(match_user_id)` — requires weekly pairing **and** (paid snapshot OR a succeeded section2 intent). **No caller of `get_match_contact` exists in `src/` or `supabase/functions/`** (grep-verified; only `check-schema-chain.mjs` references it for assertions) — see discrepancy D-3.
- **F-52** — Client-side contact blurring: `Chat.jsx` masks phone/email/handle patterns in incoming messages unless `contactsRevealed` (which is set from the paid snapshot or the server-derived `contacts_unlocked` flag). This is display-layer only; the DB does not blur.

### C.13 Conversations, guided questions, messaging, retries, archival — **IMPLEMENTED — UNVERIFIED at runtime**

- **F-53** — `conversations` lifecycle (chain stage 2): per ordered user pair, `active → locked (paid connect; read-only) → hidden after 7 days` plus `unmatched`. Convergence ALTERs handle legacy tables; pair uniqueness enforced by columns-tested constraint.
- **F-54** — `messages` policies (chain): INSERT requires `sender_id = auth.uid()`, no block either direction, and no `locked`/`unmatched` conversation for the pair; SELECT is participant-only and hides messages of conversations locked **more than 7 days ago** (rows retained). Rate limit trigger `messages_rate_limit` raises `RATE_LIMITED` at 60 messages/hour counted on `messages.sent_at` (the corrected column; the retired definition counted a non-existent `created_at` and broke every insert).
- **F-55** — **No UPDATE policy exists on `public.messages`** (grep over the chain: only insert/select policies). `Chat.jsx` (loadChat) performs `.from('messages').update({ read: true })` for incoming messages; under RLS with no UPDATE policy this statement matches zero rows (silent no-op). The `read` column is also not in `inspect_state.sql`'s required-columns list for messages. See discrepancy D-2.
- **F-56** — `Chat.jsx` behavior: loads own row (`my_profile`), match row (`profiles_public`), block state, conversation status, paid unlock, contacts (`get_unlocked_contacts`), last 200 messages (desc + reverse), marks-read (D-2), progress row (creates on first visit), engagement row; auto-sends question 1 when no bot message exists; opens a Realtime channel on `messages` filtered to incoming non-bot rows with dedupe; optimistic send with `pending/failed` states, Retry/Discard actions, and `RATE_LIMITED` surfaced as text; bot-question cadence: free questions ≤ 4, paywall card beyond unless **both** users have Section 2 access (`section2_unlocked` or live trial, read from own row and `profiles_public`); header actions Met Up / Block / Report / Unmatch with busy states; archived/locked/unmatched banners; contact-reveal card when unlocked.
- **F-57** — `Messages.jsx`: unified conversation list from both pairing sources (Qrashe `matches` rows + current-week `match_history` both directions), hydrated with profile, facial photo, and last message (bounded 100+100 fetch), sorted newest-first.

### C.14 Notifications and delivery mechanisms — **IMPLEMENTED — UNVERIFIED**

- **F-58** — In-app: `Home.jsx` subscribes to Realtime `notifications` inserts filtered `user_id=eq.<self>` and `alert()`s the message when `users.notifications_enabled` is true (ref read at load).
- **F-59** — Push: `saveOneSignalPlayerId` stores the OneSignal player id on the user's row; `send-notification` Edge Function requires a valid JWT, caps recipients at 10 and message at 500 chars, restricts browser origins to the production origin + localhost, resolves player IDs **server-side** from the `users` table (never from the request), and calls the OneSignal REST API with `ONESIGNAL_API_KEY`/`ONESIGNAL_APP_ID`.
- **F-60** — `notifications` table writer: only `complete_force_connect` (definer). Untracked migration `20261015120000_rls_closure_precondition_tables.sql` brings `notifications` under RLS with an own-rows SELECT policy, drops the legacy `"System can insert notifications" WITH CHECK (true)` policy, and revokes client writes — statically checked by `check-schema-chain.mjs`. Not applied to any database by this investigation.
- **F-61** — No client code path sends the weekly "New Match" push; the only client-triggered send surface found is the Edge Function itself (auth-gated). Whether anything invokes it in production is UNKNOWN.

### C.15 Blocking, reporting, safety controls — **IMPLEMENTED — UNVERIFIED**

- **F-62** — `user_blocks` (chain): composite PK, self-block CHECK, three policies (select involved / insert own / delete own); enforced in `messages` INSERT policy (both directions), `discover_candidates`, and the matching eligibility helper (service-role load of all blocks).
- **F-63** — `reports` (chain): insert own / select own; `admin_reports_list()` SECURITY DEFINER with internal `is_admin()` guard raising 42501 (the `language plpgsql` conversion is what allows the conditional raise).
- **F-64** — UI: `Blocked.jsx` lists blocks (embedded `users` name join) with Unblock; `Chat.jsx` and `MatchDetail.jsx` offer Block/Report/Unmatch with confirmations and busy states; `MatchDetail` unmatch button hidden after Connect.

### C.16 Administrative interfaces, authorization, auditability — **IMPLEMENTED — UNVERIFIED**

- **F-65** — Admin membership: `admin_users` table (RLS on, **no client policies**); `is_admin()` / `am_i_admin()` helpers; every `admin_*` RPC re-checks `is_admin()` internally and raises `42501 Forbidden` (including the campus mutations, which previously relied on GRANT alone per the in-file v2 note).
- **F-66** — Admin RPCs (chain stage 5): `admin_overview` (campuses, stats incl. pending intents/open reports, last 100 `payment_intents` + legacy `token_purchases`), `admin_users_list` (paged 25, search name/email, status filter, sort), `admin_user_detail` (profile/status/photos/questionnaire/contacts/matches; **sensitive categories require ≥4-char reason and are written to `admin_audit_log`**), `admin_matches_list`, `admin_reports_list`, `admin_add_campus`, `admin_set_campus_active`, `admin_set_campus_matching`, `admin_set_maintenance_message`.
- **F-67** — `Admin.jsx` client: verifies `am_i_admin` on mount (non-admins get a locked card); tabs Campuses/Users/Matches/Stats/Payments/Reports; "Run Matching Now" invokes the `match-generator` function with the user's session (function-side admin check applies) and reports `matchesProcessed/usersDelivered`.
- **F-68** — `admin_audit_log` table exists (RLS on, no client policies). Whether admins actually use the panel, and whether audit rows are written in production, is UNKNOWN (no runtime access).

### C.17 Routes, navigation, responsive behavior, interface states — **IMPLEMENTED — UNVERIFIED visually**

- **F-69** — `BottomNav` present on Home/Discover/Messages/Profile (4-tab nav); Profile back-navigates to Home; Settings reached from Profile.
- **F-70** — Responsive CSS: `@media` rules exist in 7 stylesheets (`Discover.css`, `Landing.css`, `MatchCelebration.css`, `Matches.css`, `Payment.css`, `tokens.css`, plus an asset). No visual/runtime check was performed (no browser session against a dev server in this investigation).
- **F-71** — Interface states are systematically implemented: skeleton loading (Discover 5 cards, Matches sections, Chat layout), empty states (Discover, Matches, Messages, Blocked), error + retry (Discover, Section1, Section2, Payment phases, Chat failed-bubble Retry/Discard), busy states on every action button pattern.

### C.18 Database schema, relationships, constraints, indexes, functions, triggers, policies — see §D; summary **IMPLEMENTED — UNVERIFIED against live DB**

### C.19 Backend services, Edge Functions, shared helpers — **IMPLEMENTED — UNVERIFIED (deployment state unknown)**

- **F-72** — Five functions in repo: `health`, `initiate-payment`, `payment-callback`, `send-notification`, `match-generator`. Shared: `compatibilityEngine.ts`, `matchingEligibility.ts`, `ticket.ts`. `config.toml` sets `verify_jwt = false` **only** for `payment-callback`.
- **F-73** — `health`: calls `admin_stats_counts` RPC and falls back to an `app_settings` read; 200 `{"ok":true}` / 503. **`admin_stats_counts` is not defined in any repository file** (grep-verified) — on a database without it, health still returns ok via the fallback (gap G-2).
- **F-74** — Which functions are actually deployed to the Supabase project, at which versions, and with which secrets, cannot be determined from the repository. `supabase/.temp/` shows the project is CLI-linked; `DEPLOYMENT-CHECKLIST.md` §2 lists the required secrets and the `--no-verify-jwt` requirement. UNKNOWN at runtime.

### C.20 Scheduled jobs, background processes, cleanup — **IMPLEMENTED — UNVERIFIED**

- **F-75** — DB-side: `payment-ops-tick` cron (chain, `*/5`), guarded creation with a printed statement when pg_cron is absent; `expire_stale_payment_intents()` swept by the tick (previously existed with no caller, per chain comment).
- **F-76** — Legacy `generate_tuesday_matches()` retirement: untracked migration `20261019190000` (F-35) — in-repo only; production cron repointing is a production action, not performed.
- **F-77** — GitHub Actions `weekly-db-backup.yml`: `workflow_dispatch` only; the weekly `schedule` is commented out; requires `SUPABASE_DB_POOLER_URL` secret; refuses to run silently without it (explicit error); artifact retention 7 days; header warns the repo must be private.

### C.21 Error handling, duplicate requests, partial failures — **IMPLEMENTED**

- **F-78** — Duplicate-submit guards on every mutating UI path (`if (loading) return` patterns in Signup, Login, VerifyCode, Section1, Section2, Profile, Payment, Chat).
- **F-79** — Server-side idempotency: `processed_payment_callbacks` unique cache; `connect_unlocks` unique (buyer, seller) with `on conflict do nothing`; `matches_unique_pair`; `match_history` upsert on (user, week); `token_purchases` unique on receipt; payment intent consume is a status-guarded UPDATE.
- **F-80** — Partial-failure posture in `payment-callback`: bookkeeping writes log loudly but never fail a paid unlock; only unlock-infra `failed` triggers Daraja redelivery; unlock effects are read back before being recorded as applied.
- **F-81** — Client failure UX: optimistic writes reconciled against the server row (Chat messages), save-state machines preserving user input on error (Section1/Section2/Profile), payment recovery watcher (F-49).

### C.22 Tests, build, lint, deployment configuration, verification limitations — **VERIFIED (build), FAILED (lint), NOT RUN (DB/staging scripts)** — see §G for exact commands and outputs.

---

## D. Database schema and relationship inventory

> **Access limitation, stated up front:** no live database was inspected — not a local stack (nothing listening on 127.0.0.1:54321) and not the linked remote project. Everything below is derived from repository files only. Live catalogs, live policies, live cron state, and live data remain unverified; `supabase/sql/inspect_state.sql` is the repository's own read-only tool for establishing that on a real project, and it was not executed here.

### D.1 Migration files (all under `supabase/migrations/`, all idempotent by construction)

| File | Tracked | Role |
|---|---|---|
| `20261014150000_consolidated_schema_chain.sql` (4,356 lines) | modified (uncommitted diff) | The single schema entrypoint. Six stages: (1) users/user_responses RLS + responses_array migration + dead trigger drop + payment_intents + token_purchases + reports + user_blocks + rate-limit triggers + app_settings + admin_reports_list; (2) product flow: share columns, matches (canonical Qrashe shape + reconciliation), match_history, connect_unlocks, conversations, messages policies, discover_candidates/users_are_paired/complete_force_connect/unmatch RPCs, share toggles, complete_connect_unlock, storage policies for both photo buckets; (3) profile reads (column grants, profiles_public, my_profile, get_match_contact), account settings (profile_prompts, bio cap, request_account_deletion), entitlement clamp + handle_new_user; (4) payment lifecycle (window, evidence columns, expiry verdict, sweep, anomalies view, ops tick + cron); (5) admin role v2 (admin_users, audit log, admin RPCs); (6) entitlement evidence (ledger, registry, recorder trigger on 9 paths, verdict view, alerting) |
| `20261015120000_rls_closure_precondition_tables.sql` | untracked | RLS closure for the four precondition tables photos / notifications / token_purchases / campuses; retires the legacy forgeable notification policy; deliberately leaves the anon campuses read policy and `users.campus_id` alone (documented open decisions) |
| `20261015160000_photos_unique_per_user_and_type.sql` | untracked | Unique `(user_id, photo_type)` on `photos`; refuses (raises, deletes nothing) if duplicates exist |
| `20261019190000_retire_generate_tuesday_matches.sql` | untracked | Replaces `generate_tuesday_matches()` with a raise-exception stub; zero DML; re-revokes EXECUTE from public/anon/authenticated |

`supabase/sql/superseded/` holds 15 retired scripts (retained for provenance; the chain header and `inspect_state.sql` label them retired and warn that re-running them can re-open defects).

### D.2 Tables and their observed posture (from the chain + closure migration)

**Created by the chain:** `payment_intents` (RLS on, zero client policies), `processed_payment_callbacks` (RLS on, zero policies), `reports` (+2 policies), `user_blocks` (+3 policies), `app_settings` (+public read policy; writes only via definer RPC), `matches` (+participant SELECT; all client writes revoked), `match_history` (+read-own; client writes revoked), `connect_unlocks` (+buyer SELECT; no client writes), `conversations` (+participant SELECT), `ops_alerts` (server-only), `entitlement_grants` (append-only, server-only), `entitlement_grant_kinds` (registry, service_role select), `admin_users` / `admin_audit_log` (no client policies).

**Precondition tables the chain reads but does not create** (chain header, cross-checked against `inspect_state.sql` and grep): `auth.users`, `public.users`, `public.user_responses`, `public.messages` (with `sent_at`), `public.section2_chat_progress`, `public.campuses`, `public.notifications`, `public.photos`, `public.token_purchases`, `public.match_history` *(note: the chain's stage 2 does contain a `create table if not exists public.match_history` block; the header's "no file creates it" text refers to the pre-chain state — the create is present in the current working-tree version)*, `public.section2_responses`, `public.engagement_metrics`, and the `storage` schema.

### D.3 Key columns added/owned by the chain

- `users`: `section2_unlocked`, `section2_free_expires_at`, `share_phone/whatsapp/email`, `share_social_*`, `social_*`, `profile_prompts` (≤3, JSON array), `notifications_enabled`, `reg_number`, `reputation_score`, `status`, `section2_responses` (legacy int array), plus column-scoped grants (no `display_phone` in the public grant; deliberate INSERT/UPDATE lists).
- `payment_intents`: `purpose` (CHECK over 5 values), `recipient_user_id`, `callback_key`, `expires_at` (default via `payment_intent_window()`), `ticket_state`/`verification_state`/`unlock_state` (+CHECKs), `status_reason`, `verification_*`, `unlock_*`, `late_callback_at`; unique `checkout_request_id`, unique `mpesa_transaction_id`; index on `(user_id, created_at desc)`.
- `matches`: canonical shape + retained legacy columns; constraints `matches_unique_pair`, `matches_distinct_pair_check`, `matches_status_check` (7 values), `matches_tier_check`; index `idx_matches_user_b`.
- `match_history`: `user_id`, `week_id`, `tier1_match_id`, `tier2_match_id`, `delivered_at`; unique `(user_id, week_id)`.
- `connect_unlocks`: snapshot columns (phone/whatsapp/email/socials), `payment_intent_id`, unique `(buyer_id, seller_id)`.
- `conversations`: convergence ALTERs + column-tested pair uniqueness; index on `(user_a_id, user_b_id)`.
- `photos.display_order`: converged `add column if not exists` (chain stage 5, admin_user_detail dependency).

### D.4 Functions (all `security definer` unless noted)

| Function | Grant posture (as written in repo) |
|---|---|
| `handle_new_user()` (trigger on `auth.users`) | signup path; writes users row + 14-day trial, declares entitlement context |
| `clamp_user_protected_columns()` (trigger on `users`) | discards client writes to entitlement/server-owned columns; preserves `pending_deletion` |
| `enforce_contacts_unlocked()` (trigger on `section2_chat_progress`) | pins `contacts_unlocked` for client writes; derives 14-question reveal |
| `enforce_message_rate_limit()` / `enforce_intent_rate_limit()` (triggers) | 60 msg/h and 30 intent/h backstops |
| `record_entitlement_evidence()` (triggers on 9 paths) | append-only ledger writer |
| `discover_candidates()` | execute → authenticated |
| `users_are_paired(uuid,uuid)` | used by definer functions and `initiate-payment` (service role) |
| `complete_force_connect(uuid)` / `complete_connect_unlock(uuid)` | execute → **service_role only** |
| `unmatch_conversation(uuid)` / `request_account_deletion()` | execute → authenticated (uid server-derived) |
| `my_profile()` / `get_unlocked_contacts(uuid)` / `get_match_contact(uuid)` | execute → authenticated |
| `payment_intent_window()` (immutable, invoker) | internal |
| `payment_intent_expiry_state(uuid,timestamptz)` (invoker, stable) | service_role only |
| `expire_stale_payment_intents()` / `payment_ops_tick()` / `raise_*_alerts()` / `dispatch_ops_alerts()` | service_role only |
| `set_entitlement_context(...)` | service_role only (transaction-local context) |
| `is_admin()` / `am_i_admin()` | `am_i_admin` → authenticated |
| `admin_overview`, `admin_users_list`, `admin_user_detail`, `admin_matches_list`, `admin_reports_list`, `admin_add_campus`, `admin_set_campus_active`, `admin_set_campus_matching`, `admin_set_maintenance_message` | execute → authenticated, all with internal `is_admin()` raise-42501 guards |
| `generate_tuesday_matches()` | after untracked retirement migration: raise-exception stub, EXECUTE revoked from public/anon/authenticated (not applied anywhere yet) |

### D.5 Views and storage

- `profiles_public` (`security_invoker=on`): public profile subset, no `display_phone`; select → anon, authenticated.
- `payment_intent_anomalies` / `entitlement_evidence_anomalies` (`security_invoker=true`): select → service_role only.
- Storage: buckets `profile_photos` and `user-photos` (both public-read), four owner-scoped policies each on `storage.objects`.

---

## E. Evidence-based workflow maps (traced in source; runtime unverified unless noted)

**E.1 Signup → onboarding:** `Signup.handleSignup` → `auth.signUp` (+Turnstile) → GoTrue creates `auth.users` → trigger `on_auth_user_created` → `handle_new_user()` inserts `public.users` (+ trial, ledger context) → `/verify-code` → `verifyOtp` → AuthGuard passes confirmed user → `ProfileSetup` (campuses lookup, `users` update by id) → `PhotoUpload` (storage upload + `photos` upsert ×2) → `Interests` (≥3) → `Section1` (50 × upsert `user_responses` + progress) → `Section2` (20 × upsert `section2_responses`) → `/discover`.

**E.2 Weekly matching:** *trigger not in repo* → (admin invokes `match-generator` via `Admin.jsx`, or an external cron) → auth gate (service key or admin JWT) → load eligible users (service role) → load responses + blocks → pairwise eligibility (gender/campus/blocks) → `calculateCompatibility` (exact-option match, weighted) → per-user ranking with previous-week avoidance → upsert `match_history` (batch 500) → `Matches.jsx`/`MatchCelebration.jsx` read own `match_history` row + `profiles_public` + `photos` under RLS.

**E.3 Force Connect:** Discover select → `ForceConnect.jsx` receipt → `/payment?purpose=force_connect` → `initiate-payment` (JWT auth, pairing/duplicate checks server-side, intent row, STK push with `?intent&ck`) → user pays → Daraja POST → `payment-callback` (ticket → DB expiry verdict → consume intent → `complete_force_connect` → read back `matches` row → record `unlock_state`) → recipient gets `notifications` row (Realtime alert in `Home.jsx`) + bot system message + active conversation → both sides see Qrashe card in `Matches`/`Messages`.

**E.4 Paid Connect (contact unlock):** MatchDetail/Chat → `/payment?purpose=connect_tier*` → `initiate-payment` (requires `users_are_paired`, no prior unlock) → callback → `complete_connect_unlock` (pairing re-check → snapshot with live share flags → conversation `locked` + system message) → `get_unlocked_contacts` reveals snapshot to the buyer while paired; `unmatch_conversation` refuses afterwards.

**E.5 Guided chat:** open `/chat/:id` → progress row ensure → bot question 1 → user messages insert (RLS: sender-only, unblocked, conversation active; rate-limit trigger) → next bot question after ≥1 human message for the first 4 questions; paywall card beyond unless both unlocked → at 14 questions the DB trigger may set `contacts_unlocked` (recorded in ledger); contact card renders only with the paid snapshot from `get_unlocked_contacts`.

**E.6 Failure paths traced:** STK failure → `record_failed`; forged callback → 401 + `ticket_state`; late callback → recorded, not unlocked; duplicate callback → idempotency cache / status-guarded consume; unlock RPC declines → `no_effect` recorded; Daraja redelivery on `failed` unlocks; abandoned push → swept to `expired` by the 5-minute tick; stuck paid unlock → `paid_but_not_unlocked` alert (10-minute grace) → Vault webhook or recorded-undelivered.

---

## F. Cross-component dependency and data-flow map

```
Browser (anon key + user JWT)
 ├─ Auth (GoTrue) ──────────────► auth.users ──trigger──► public.users (+trial, ledger)
 ├─ PostgREST/RLS
 │   users(profiles_public/my_profile) ◄── column grants, clamp trigger, ledger recorder
 │   user_responses (own) ◄── Section1          photos (own write / auth read)
 │   section2_responses (own?) ── Section2      [RLS state unknown — precondition table]
 │   section2_chat_progress (pair) ◄── Chat     trigger: contacts_unlocked @14
 │   messages (participants) ◄── Chat           trigger: 60/h rate limit
 │   conversations (participant read) ◄── Chat  status gates message INSERT
 │   match_history (read-own) ◄── Matches/MatchCelebration/Messages/MatchDetail
 │   matches (read-participant) ◄── same        writes: complete_force_connect only
 │   connect_unlocks (buyer read) ◄── MatchDetail/Chat/Payment
 │   user_blocks / reports (own)                campuses (auth read)
 │   app_settings (public read) ◄── App banner
 ├─ Edge Functions (service role)
 │   initiate-payment ◄── Payment.jsx           ──► payment_intents + Daraja STK
 │   payment-callback ◄── Daraja (unsigned)     ──► intents, unlocks, matches, conversations,
 │   match-generator ◄── admin UI / (external cron)   notifications, token_purchases, ledger
 │   send-notification ◄── (any authed caller)  ──► OneSignal REST
 │   health ◄── uptime monitor                  ──► admin_stats_counts (absent) / app_settings
 └─ Storage (user-photos, public read, owner write) ◄── PhotoUpload/Photos; read by 7 screens
Database schedules: payment-ops-tick (*/5, pg_cron) ──► expire + alert + pg_net dispatch
External schedules (not in repo): weekly matcher cron (referenced in retirement migration header)
GitHub Actions: weekly-db-backup (manual only)
```

Critical coupling facts observed in source: the weekly engine depends on `user_responses.responses_array` being `text[]` of option text (chain conversion + engine exact-match); the payment callback depends on `payment_intents.callback_key` existing (fail-closed otherwise) and on the three unlock RPCs being idempotent; the app's match screens depend on `match_history` while paid pairs live in `matches`, and `users_are_paired` bridges both; the clamp trigger depends on PostgREST's JWT claim settings (`request.jwt.claim.role` / `request.jwt.claims`).

---

## G. Verification commands, results, and output summaries

All commands run from `C:\Users\oboch\minglemate` on 2026-10-19. Exit codes captured explicitly (pipeline exit status preserved).

| # | Command | Result | Output summary |
|---|---|---|---|
| G-1 | `node scripts/check-schema-chain.mjs` | **PASS** (exit 0) | 113/113 checks passed — object defined-once invariants, stage ordering, defect regressions (messages.created_at rate limit, display_phone grant, duplicate window), grant-recorder invariants, closure/photos-migration guards |
| G-2 | `node scripts/verify-payment-ticket.mjs` | **PASS** (exit 0) | 54/54 checks passed — ticket screening on both branches, DB-owned expiry ordering, amount matching, cache classification, transactionstatus request/ACK/patch, `process → retry_unlock → noop` walk per purpose |
| G-3 | `node scripts/verify-weekly-generation-safety.mjs` | **PASS** (exit 0) | 4 migration files TRUNCATE-free; retirement migration DML-free with visible-failure guard and re-revoked grants; legacy edge engines (`generate-weekly-matches`, `run-weekly-matching`) absent from `supabase/functions/`; match-generator campus-aware |
| G-4 | `node scripts/verify-matching-eligibility.mjs` | **PASS** (exit 0) | 8/8 checks — same-campus pairs eligible; cross-campus excluded; null/null pairs eligible; mixed null/non-null excluded both orders; same-gender excluded; blocked pairs excluded both orders |
| G-5 | `npm run lint` | **FAIL** (exit 1) | 44 problems: 25 errors, 19 warnings across 20 files. Errors include: `react-hooks/immutability` violations ("Cannot access variable before it is declared", "Cannot access refs during render", "Cannot call impure function during render") concentrated in Chat.jsx (5), Payment.jsx (3), Settings.jsx (2), Messages.jsx (2) and one each in ~13 other files; `no-unused-vars` (`unblock` in Blocked.jsx, `myId`/`isBlocked`/`setIsBlocked` in Chat.jsx, `gift` in Payment.jsx, `silent` in checkPaidState, `err`); `no-undef` `importScripts` in `public/OneSignalSDKWorker.js` (vendored OneSignal worker); `react-refresh/only-export-components` in Turnstile.jsx |
| G-6 | `npm run build` | **PASS** (exit 0) | Vite/rolldown build in ~5.04 s; warning that some chunks exceed 500 kB after minification |
| G-7 | `node scripts/verify-rls-closure.mjs` | **NOT RUN** (exit 2, by design) | "no local stack — skipped (exit 2)"; port 54321 closed (`curl` → no listener). Requires `supabase start` + schema applied |
| G-8 | `node scripts/verify-entitlement-clamp.mjs` | **NOT RUN** (exit 2, by design) | same stack dependency as G-7 |
| G-9 | `node scripts/e2e-matching-test.mjs` | **NOT RUN** (exit 1, by design) | requires `E2E_SUPABASE_URL` + `E2E_SUPABASE_ANON_KEY`; script hard-refuses the production ref; staging-only |
| G-10 | `node scripts/sandbox-transactionstatus.mjs` | **NOT RUN** (exit 3, by design) | requires M-Pesa sandbox credentials (`MPESA_CONSUMER_SECRET`, `MPESA_SECURITY_CREDENTIAL` or initiator password + cert) |
| G-11 | `node -e "import('./src/data/section1Questions.js')…"` | **PASS** | 50 questions, 4 options each |
| G-12 | Grep traversals (messages policies, precondition table DDL, `admin_stats_counts`, `section2_responses`/`engagement_metrics` creators, `get_match_contact` callers, `match_history` columns in inspect tool) | recorded | results cited inline in §C/§I |

**Not attempted (out of permitted scope or unavailable):** any migration/DDL/DML against any database; any production function invocation; any payment/matching/notification/cleanup workflow execution; any remote database inspection; dependency installation.

---

## H. Security and authorization observations (based on inspected evidence only)

1. **Server-side price enforcement** — prices live only in `initiate-payment` (`PRICES` map) and on the intent row; the client displays copy-only prices (F-44, F-49).
2. **Callback authenticity** — per-intent callback key bound into the STK `CallBackURL`, checked before any payload field is trusted, on success and failure branches alike, fail-closed when the column is absent (F-46; verified at the decision level by G-2).
3. **Entitlement forgery defence** — `clamp_user_protected_columns` discards client writes to `section2_unlocked`, `section2_free_expires_at`, `reg_number`, `reputation_score`, `status`, `section2_responses`; the ledger + verdict view (`entitlement_evidence_anomalies`) re-derive whether each grant has supporting evidence (chain stages 3 and 6). Runtime effect not executed here (G-8 NOT RUN).
4. **Column-scoped profile privacy** — blanket `users` SELECT revoked; `display_phone` excluded from the public grant and view; contact data reachable only via `my_profile()` or paid RPCs (F-50, F-51).
5. **Admin authorization inside the operation** — every `admin_*` RPC re-checks `is_admin()`; sensitive admin reads are audit-logged with a forced reason (F-65, F-66).
6. **Notification forgery path** — the legacy `WITH CHECK (true)` insert policy on `notifications` is dropped by the untracked closure migration; this fix is **in the working tree only** and not applied anywhere (F-60).
7. **Function auth split** — `match-generator` accepts the service key or an admin JWT; `send-notification` requires any valid JWT and resolves recipients server-side; `payment-callback` is the only `verify_jwt=false` function (justified: Daraja is not a JWT client; it authenticates via the ticket) (F-33, F-59, F-72).
8. **Secrets handling observed** — no secrets in tracked files; local `.env*` files exist but were never read; Edge Function secrets are referenced by name only (`MPESA_*`, `ONESIGNAL_*`, `SUPABASE_SERVICE_ROLE_KEY`); the ops webhook URL lives in Vault, never in SQL (F-74, chain stage 4).
9. **Open security decisions documented in-repo, not closed:** anonymous read policy on `campuses` retained deliberately; `users.campus_id` remains client-writable (closure migration header, citing audit finding C-1) — the migration states this needs a product decision and was left out on purpose.
10. **Client-side-only controls (observed, not judged):** contact blurring in Chat is display-layer (F-52); Turnstile enforcement depends on Supabase project CAPTCHA configuration (F-10); CSP is `Report-Only` (vercel.json).
11. **Historical credential exposure** — `DEPLOYMENT-CHECKLIST.md` §4 lists previously burned values (an old admin password, a `VITE_ADMIN_PASSWORD`, an old anon JWT) and rotation steps; those values do not appear in current source at HEAD (checked list only, not re-derived from history).

---

## I. Known discrepancies and unresolved questions (evidence-based, no proposals)

- **D-1 — `inspect_state.sql` requires `match_history.user_a_id`/`user_b_id`** (lines 135–136 of the working-tree file), but the chain defines `match_history` with `user_id`, `week_id`, `tier1_match_id`, `tier2_match_id` (chain stage 2, 3b). The inspection tool would report two permanently MISSING columns against a schema built from the chain. Not fixed here (implementation task).
- **D-2 — `Chat.jsx` marks messages read with an UPDATE that RLS cannot allow.** `loadChat` runs `.from('messages').update({ read: true })`; the chain defines only INSERT and SELECT policies on `messages`, so the update matches zero rows. Whether the deployed database carries an additional UPDATE policy from an earlier manual script is UNKNOWN (no live inspection).
- **D-3 — `get_match_contact()` has no caller.** The function exists with grants and paywall logic, but no `src/` or Edge Function code calls it; `Chat.jsx` and `MatchDetail.jsx` use `get_unlocked_contacts`. Whether some deployed frontend version still calls it cannot be determined from the repository.
- **D-4 — `getWeekId()` duplicated in 7 locations** (match-generator + 6 pages) with identical logic. Any divergence (e.g., timezone handling between Deno server time and browser local time) would desynchronize week ids between delivery and display; no test pins this.
- **D-5 — The 20 Section 2 questions are duplicated verbatim** in `Section2.jsx` and `Chat.jsx`; a text change in one file would not propagate.
- **D-6 — Upload validation asymmetry:** `Photos.jsx` enforces magic-byte type sniffing and a 5 MB cap; `PhotoUpload.jsx` (the onboarding path) only resizes. Same product action, different client-side validation.
- **D-7 — `initiate-payment` hardcodes the Daraja sandbox host** (F-45): with `MPESA_ENV=production`, the callback handler switches bases but the initiator does not — end-to-end production payments cannot work from this code as written. Documented in `DEPLOYMENT-CHECKLIST.md` §2.
- **D-8 — `admin_stats_counts` is called by `health` but defined nowhere in the repository** (F-73); health degrades to a fallback read.
- **D-9 — `section2_responses` and `engagement_metrics` are client-read/written tables with no DDL, no policy definition, and no column inventory anywhere in the repository** (F-27, F-36); their live RLS posture is unknown and uninspectable from source.
- **D-10 — The legacy weekly cron's live state is asserted only in a migration header** (F-35): the retirement migration documents a production `calculate-weekly-matches` cron job; no repository artifact proves its current existence, schedule, or target on the live project.
- **D-11 — `DEPLOYMENT-CHECKLIST.md` self-reports 7 false claims and 2 unresolved conflicts** (banner at its head, referencing `docs/docs-reconciliation-2026-10-14.md`), including the project ref and a test-user email conflict. The checklist cannot be taken at face value without that reconciliation.
- **D-12 — Lint is failing at HEAD+working-tree** (G-5): 25 errors including React Hooks v7 immutability violations in the most interactive pages. Whether these are new-rule findings or real render-phase defects was not diagnosed (diagnosis is out of scope for this investigation).
- **Open questions requiring access this investigation did not have:** live catalog state of every table/policy/trigger (would be answered by running `supabase/sql/inspect_state.sql` read-only on the target project); which migrations are recorded in `supabase_migrations.schema_migrations`; which Edge Functions are deployed and at what version; whether cron jobs (`payment-ops-tick`, the legacy weekly job) exist and their run history; whether `ops_alerts` has undelivered rows; whether any `entitlement_evidence_anomalies` / `payment_intent_anomalies` rows exist in production.

---

## J. Investigation coverage matrix

| # | Scope area | Status | Primary evidence | Limitation |
|---|---|---|---|---|
| 1 | Structure / deps / architecture | IMPLEMENTED — UNVERIFIED (build VERIFIED) | F-01..F-03, §B; G-6 | build ≠ runtime |
| 2 | Auth / sessions / access control | IMPLEMENTED — UNVERIFIED | F-04..F-10 (Signup, Login, VerifyCode, AuthGuard, GoogleButton, Turnstile) | no live auth flow executed |
| 3 | Onboarding / returning users | IMPLEMENTED — UNVERIFIED | F-11..F-13 | no runtime walk-through |
| 4 | Profiles / editing / interests | IMPLEMENTED — UNVERIFIED | F-14..F-18 | no runtime writes exercised |
| 5 | Photos: upload / storage / display | IMPLEMENTED — UNVERIFIED (constraint statically checked) | F-19..F-22; G-1 | no upload executed; storage policies not seen live |
| 6 | Section 1 & 2 questionnaires | IMPLEMENTED — UNVERIFIED (question bank VERIFIED) | F-23..F-28; G-11 | persistence untested against a DB |
| 7 | Compatibility scoring | VERIFIED — WORKING (pure logic) | F-29, F-30; G-4 | engine end-to-end untested (G-9 NOT RUN) |
| 8 | Discover retrieval/display | IMPLEMENTED — UNVERIFIED | F-31, F-32 | RPC not executed |
| 9 | Scheduled matching / history / release | IMPLEMENTED — UNVERIFIED | F-33..F-37; G-3 | no cron in repo; deployment state unknown |
| 10 | Tiers / Qrashe / Connect / Force Connect | IMPLEMENTED — UNVERIFIED | F-38..F-43 | RPCs not executed |
| 11 | Payments: initiation → verification → failure | IMPLEMENTED; decision logic VERIFIED; runtime UNVERIFIED | F-44..F-49; G-2, G-10 | no STK push, no Daraja call made |
| 12 | Contact privacy / authorization | IMPLEMENTED — UNVERIFIED | F-50..F-52 | live grants/policies unseen |
| 13 | Conversations / guided questions / retries / archival | IMPLEMENTED — UNVERIFIED | F-53..F-57 | RLS behavior untested (see D-2) |
| 14 | Notifications / delivery | IMPLEMENTED — UNVERIFIED | F-58..F-61 | Realtime and OneSignal untested |
| 15 | Blocking / reporting / safety | IMPLEMENTED — UNVERIFIED | F-62..F-64 | policies untested live |
| 16 | Admin interfaces / authz / audit | IMPLEMENTED — UNVERIFIED | F-65..F-68 | no admin session used |
| 17 | Routes / navigation / responsive / states | IMPLEMENTED — UNVERIFIED (visually) | F-69..F-71; §B.4 | no browser session |
| 18 | Schema / relations / constraints / triggers / policies | IMPLEMENTED — UNVERIFIED against live DB | §D; G-1 | no database inspected (stated limitation) |
| 19 | Backend services / Edge Functions / helpers | IMPLEMENTED — UNVERIFIED | F-72..F-74; G-2, G-4 | deployment state UNKNOWN |
| 20 | Scheduled jobs / background / cleanup | IMPLEMENTED — UNVERIFIED | F-75..F-77 | live cron state UNKNOWN |
| 21 | Error handling / duplicates / partial failures | IMPLEMENTED — UNVERIFIED (logic VERIFIED for payments) | F-78..F-81; G-2 | concurrency behavior untested |
| 22 | Tests / build / lint / deploy config / limitations | VERIFIED (build, 4 static suites) / FAILED (lint) / NOT RUN (4 scripts) | §G | as listed per command |

---

## K. Final completeness assessment

**What was inspected (this investigation):**
- The complete working tree at `dfad576` + 10 modified and 7 untracked files: all 30 page components, all shared components and libs, all 5 Edge Functions plus 3 shared TS modules, all 4 migrations in full (4,356-line chain included), `inspect_state.sql`'s expected-object inventories, all 8 verification scripts, package/lint/build/deploy configuration, and the operational documents. Protection baseline recorded first; nothing was modified.

**What was actually verified to work (observed execution):**
- Schema-chain static integrity (113/113), payment-callback decision logic (54/54), weekly-generation safety invariants, matching-eligibility rules (8/8), production build, and the 50×4 question bank.

**What failed verification:**
- `npm run lint` — exit 1, 25 errors (§G-5). This is the only executed check that failed.

**What is implemented but unverified:**
- Every runtime behavior: auth, onboarding, profiles, photos, both questionnaires, Discover, weekly matching delivery, all payment flows end-to-end, contact reveal, messaging and archival, notifications, blocking/reporting, admin panel, cron ticks, and all RLS/grant/trigger effects on a real database. Static code and static checks establish their presence and internal consistency, not their runtime effect.

**What was not found:**
- No unit-test framework; no repository artifact scheduling `match-generator`; no `admin_stats_counts` definition; no DDL for `section2_responses` or `engagement_metrics`; no UPDATE policy on `messages`; no caller for `get_match_contact`; no `MINGLEMATE_CURRENT_STATE_INVESTIGATION.md` prior to this report (no overwrite occurred).

**What remains unknown:**
- Live database state of every kind (schema, policies, grants, triggers, cron, data, anomaly views, alert delivery); deployed Edge Function versions and secrets; production cron existence/schedule; whether the untracked migrations have been applied anywhere; actual user-facing behavior in a browser.

**Why those gaps could not be closed:**
- No local Supabase stack was running (G-7/G-8 self-skip); the staging scripts require credentials that were not provided (G-9) and the transactionstatus harness requires M-Pesa sandbox secrets (G-10); remote database inspection, function invocation, cron changes, migrations, and any state-changing workflow were outside the authorized scope of this task. The remaining gaps are exactly the ones the repository's own tools (`inspect_state.sql`, `verify-rls-closure.mjs`, `verify-entitlement-clamp.mjs`, `e2e-matching-test.mjs`) would close once a permitted target (local stack or staging) is available.
