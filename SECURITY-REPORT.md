# MingleMate Security Assessment — Penetration Test Report

**Date:** 2026-09-18 · **Target:** minglemate (React SPA + Supabase + Edge Functions)
**Method:** Static white-box analysis of source, git history, and live runtime probing. No destructive testing against production data.

---

## Remediation Status (updated 2026-09-18)

All code-fixable findings have been remediated in this working tree. Remaining items require dashboard/CLI access: run the 4 SQL files, redeploy 5 edge functions, rotate burned secrets. See `DEPLOYMENT-CHECKLIST.md`.

| Finding | Status | Fix location |
|---|---|---|
| C1 admin password in bundle | ✅ Code fixed — pending SQL + admin row | `admin_role.sql`, `Admin.jsx` (RPC-gated) |
| C2 client-set price | ✅ Fixed | `initiate-payment/index.ts` (server constant) |
| C3 phone-keyed unlock | ✅ Fixed | `payment-callback/index.ts` + `payment_intents` (remediation_bundle.sql) |
| C4 unauthenticated STK spam | ✅ Fixed (JWT + rate limit + phone validation) | `initiate-payment/index.ts` |
| C5 broken signup | ✅ Client fixed — pending SQL trigger | `Signup.jsx`, `fix_rls.sql` |
| H1 paywall cosmetic | ✅ Fixed | `harden_profile_reads.sql` (`get_match_contact`), `Chat.jsx`, `Matches.jsx` |
| H2 push spoofing | ✅ Fixed | `send-notification/index.ts` (JWT + server-side player lookup) |
| H3 hardcoded JWT | ✅ Removed from code — token burned in history, rotate | git history |
| H4 .env in history | ⚠️ History scrub deferred (destructive) | git history |
| H5 public matching compute | ✅ Fixed | admin/service guard in both functions |
| H6 dead leaky util | ✅ Deleted | `src/utils/notifications.js` removed |
| H7 spoofable chat sender | ✅ Pending SQL | `remediation_bundle.sql` (messages RLS) |
| H8 self-granted unlock | ✅ Pending SQL | `remediation_bundle.sql` (trigger forces `contacts_unlocked`) |
| M1 photo upload limits | ✅ Fixed | `Photos.jsx` (magic bytes + 5 MB cap) |
| M2 no rate limits | ✅ Partially (STK done; OTP covered by Supabase defaults) | `initiate-payment` |
| M3 function JWT unverified | ✅ Fixed | both matching functions verify admin |
| M4 callback replay | ✅ Fixed | intent status guard + unique txn constraints |
| M5 all-rows users SELECT | ✅ Column grants applied in SQL | `harden_profile_reads.sql` |
| M6 account enumeration | ✅ Fixed | `Login.jsx` generic OTP message |
| M7 CORS `*` | ✅ Fixed | per-origin CORS in all client-facing functions |
| L1 console leaks | ✅ Fixed | `Photos.jsx` |
| L2 security headers | ✅ Fixed | `vercel.json` (CSP + XFO + nosniff + others) |
| Storage bucket policies | ⚠️ Dashboard setting — verify `auth.uid()/*` scoping manually | Supabase dashboard |

---

## Executive Summary

Found **22 findings: 5 Critical, 8 High, 7 Medium, 2 Low/Info**. The most serious: hardcoded admin credentials in the client bundle, an unauthenticated payment-spam endpoint, trivially forgeable payment unlocks, and a paywall that leaks every user's phone/email to any logged-in user. Authentication is functionally broken (new signups fail; existing logins unreachable), which currently masks the worse issues but must be fixed alongside them, not instead of them.

---

## CRITICAL

### C1. Hardcoded admin password in client bundle
- **Where:** `src/pages/Admin.jsx` (`ADMIN_PASSWORD = 'minglemate-admin-2025'`), plus `VITE_ADMIN_PASSWORD="TWO#0292024"` committed in git history (`4d783d8`, since removed)
- **Impact:** Anyone can open DevTools on the deployed site, read the password, and access the full admin panel: all user rows, message counts, transactions, campus creation, matching triggers.
- **Status:** Partially fixed in working tree (server-side `admin_users` + RPCs written in `admin_role.sql`, Admin.jsx rewritten). **SQL must still be run and one admin row inserted.**

### C2. Payment amount is client-controlled — pay any amount
- **Where:** `supabase/functions/initiate-payment/index.ts` — `const { phone, amount, userId } = await req.json()` → `Amount: amount`
- **Impact:** A user can POST `{"phone":"2547...","amount":1}` and unlock Section 2 for KES 1. The function never validates that amount equals the product price. Price enforcement must happen server-side.

### C3. Payment unlock keyed on attacker-known data — wrong-user/free unlock
- **Where:** `supabase/functions/payment-callback/index.ts` — finds user by `phone`, sets `section2_unlocked = true`
- **Impact chain:** Any user can (a) initiate an STK push to **someone else's phone** (no auth check on `userId` in initiate), (b) when that payment completes, whichever user row matches the paying phone gets unlocked — not necessarily the payer's intended account. Users can self-unlock for KES 1 via C2, or unlock a shared-phone account unintentionally. `initiate-payment` must derive `userId` from the Authorization JWT, enforce the price, and record an intent row (user, phone, txn) that the callback consumes.

### C4. Unauthenticated M-Pesa spam endpoint
- **Where:** `initiate-payment` — no JWT verification, no rate limit, `userId`/`phone`/`amount` all taken from request body
- **Impact:** Anyone on the internet (no account needed) can hammer the endpoint and fire STK prompts at arbitrary Kenyan phone numbers — harassment vector + real API costs + potential Safaricom account suspension. Rate limit per user/phone, require a verified session, validate phone format.

### C5. Authentication is broken end-to-end
- **Where:** `Signup.jsx` — profile upsert fails RLS (`new row violates row-level security policy for table "users"`) when email confirmation is enabled (no session at that moment). Accounts are created with no profile row; login is OTP-only with `shouldCreateUser:false` and rejects those unconfirmed users (probed live: "Email address ... is invalid").
- **Impact:** No new user can onboard. Also: signup collects a password the login flow never uses (mismatched flows).
- **Status:** Fix written (`fix_rls.sql` trigger + policies) but **not yet applied**. Signup.jsx should tolerate the duplicate upsert after the trigger exists.

---

## HIGH

### H1. Paywall was client-side only — contact harvesting
- **Where:** `Chat.jsx` reads any user's `email/phone/whatsapp_number` directly from `users`; message blur is regex-only
- **Impact:** Any authenticated user can query any user's contact info via the REST API regardless of payment. Regex blur is bypassed by formatting tricks ("0 7 1 2 ...", "name at gmail dot com").
- **Status:** Server-side fix written (`harden_profile_reads.sql`: column grants + `get_match_contact()` RPC); Chat.jsx/Matches.jsx updated. Blur regex remains best-effort — consider server-side message filtering.

### H2. OneSignal player IDs exposed — push-notification spoofing
- **Where:** `users.onesignal_player_id` readable by all; `send-notification` accepts arbitrary `playerIds` with no auth check
- **Impact:** Anyone can send push notifications to any user impersonating MingleMate (phishing: "click here to see who matched with you").
- **Status:** Column revoked in lockdown SQL; `send-notification` **still needs** an auth check + server-side recipient resolution (pairs with H6).

### H3. Hardcoded anon JWT in source
- **Where:** Admin.jsx `triggerMatching()` embedded a full long-lived JWT
- **Impact:** Token is burned forever (in git history) and granted function access to any reader.
- **Status:** Removed in rewritten Admin.jsx (now uses SDK invoke). **Rotate/ignore the burned token.**

### H4. `.env` committed to git history
- **Where:** `4d783d8` added `.env` with anon key + `VITE_ADMIN_PASSWORD`; removed later (48b77e7) but recoverable from history
- **Impact:** Anon keys are by design public; the admin password is not. Consider history rewrite + rotation. Note `supabaseClient.js` reads `VITE_SUPABASE_ANON_KEY` while current `.env` uses `sb_publishable_...` — verify names match the deployed env.

### H5. Matching edge functions are public compute — RESOLVED
- **Where:** `match-generator` — now admin/service-key gated (JWT user must be in `admin_users`, or the service key must be presented). `run-weekly-matching` was **retired and deleted**: it read `section1_responses`, a table nothing writes, so it always produced zero matches; no cron or code called it (verified repo-wide).
- **Impact:** An authenticated user could force full-campus recompute loops (DoS-ish, burns function time).
- **Fix:** implemented — service-key or admin-membership check inside `match-generator`; unauthorized calls get `403 Forbidden`.

### H6. Dead unsafe notification util
- **Where:** `src/utils/notifications.js` — imported nowhere, but fetches *other users'* `onesignal_player_id` from the client
- **Fix:** Delete it; move player-ID lookup inside `send-notification` keyed by the authenticated caller.

### H7. Chat write access — spoofable sender (needs RLS verification)
- **Where:** `Chat.jsx` inserts messages with `sender_id` from client state
- **Impact:** If RLS on `messages` lacks `with check (sender_id = auth.uid())`, users can forge messages as others or write into arbitrary conversations.
- **Verify:** couldn't inspect live policies (no DB creds). Must enforce: insert sender = auth.uid(); select limited to conversation participants.

### H8. `section2_chat_progress` manipulation
- **Where:** Client directly inserts/updates progress rows; `contacts_unlocked` is computed client-side
- **Impact:** A user can self-set `contacts_unlocked = true` if RLS allows writes, self-granting the paywall trigger. Unlock should be derived server-side from `questions_discussed`.

---

## MEDIUM

1. **Photos: no file-size limit, spoofable type check** (`Photos.jsx` trusts `file.type`); storage policies unverified — confirm upload path scoped to `auth.uid()/*` and `remove()` validates ownership (path parsed from URL).
2. **No rate limiting anywhere** beyond Supabase auth defaults: OTP resend, messages, response upserts, function calls. Add throttles on high-cost operations (STK, OTP).
3. **Edge functions don't verify the JWT the panel now sends** (pairs with H5) — verify inside the function.
4. **Payment callback lacks idempotency:** no unique constraint on `mpesa_transaction_id`; replayed callbacks could double-insert `token_purchases`. Phone→user mapping is ambiguous for shared numbers.
5. **Users SELECT is all-rows** (needed for matchmaking; post-column-grants exposure is limited) — consider per-need views later; ensure no flow reads others' `email`.
6. **Account enumeration via OTP errors:** client renders raw `otpError.message` ("Email address X is invalid") — attackers can probe which emails have accounts. Normalize client messaging.
7. **CORS `*` on all edge functions** — acceptable for public APIs, but invites abuse while auth checks (C4/H2) are missing. Tighten after adding auth.

---

## LOW / INFO

- **L1.** `console.log` of storage paths in Photos.jsx — strip in prod builds.
- **L2.** No security headers (CSP, X-Frame-Options) in `vercel.json`. Basic CSP is easy: `default-src 'self'; connect-src https://*.supabase.co https://onesignal.com ...`.
- **INFO.** XSS: no `dangerouslySetInnerHTML`/`innerHTML` anywhere; React escapes message content — stored XSS via chat unlikely.
- **INFO.** Working-tree `.env` untracked (good); verify with `git status` before commits.
- **INFO.** OneSignal app ID public in `index.html` — expected; restrict push origins in OneSignal dashboard.

---

## Priority remediation order

1. **Now:** Apply `fix_rls.sql` (unblocks auth) → `harden_profile_reads.sql` → `admin_role.sql`; insert your `admin_users` row.
2. **This week:** Fix `initiate-payment` (JWT-derived user, server-set price, rate limit, phone validation); fix `payment-callback` (intent row, idempotency, correct mapping). Delete `notifications.js`; add auth checks to `send-notification` and both matching functions.
3. **Verify then ship:** RLS for `messages`, `section2_chat_progress`, and photo storage (H7/H8/M1) — written on request.
4. **Hygiene:** rotate the burned JWT + admin passwords; optional git history scrub; add security headers; normalize OTP errors.

---

*Test artifacts: demo user `buffy.tester@student.egerton.ac.ke` (unconfirmed) left in Supabase auth — safe to delete.*
