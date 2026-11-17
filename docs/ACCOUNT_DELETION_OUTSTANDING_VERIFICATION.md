# Account Deletion — Outstanding Verification

**Mode:** read-only verification. No implementation file was modified. No production SQL, deployment, commit, push, merge or database reset was performed.
**Date:** verification run against HEAD `32cd1b7` (working tree carries the uncommitted implementation package).
**Update:** B1 and B2 have since been fixed and tested. B3 (backup/restore evidence) is untouched and remains a separate release blocker. Sections 1A and 1B below keep the original defect evidence and now record the fix.

---

## 1. Two previously identified corrections

### 1A. Authentication retry safety — **FIXED**

**Original defect (was FAIL).** `supabase/functions/request-account-deletion/index.ts:133` revoked the global session **before** `deleteUser` at `:142`. If deletion failed, the user lost their session and every retry gate (`config.toml:428-429` `verify_jwt = true`, `getUser(token)` at `:76-77`, and `request_account_deletion()` raising `Not authenticated` at `..._account_deletion.sql:143-146` when `auth.uid()` is null) rejected the retry. The `pending: true` response was misleading.

**Fix applied** (`supabase/functions/request-account-deletion/index.ts`):
- Step 5 now is `delete the auth user LAST`, and revocation was **removed from before deletion**. A best-effort `admin.auth.admin.signOut(token,'global')` runs **only after** a successful `deleteUser` (it is harmless or a no-op once the user is gone). A failed deletion leaves the session intact, so the same request can genuinely be retried.
- New `recoverAfterLostResponse(admin, token)` (lines ~199-239) handles the lost-response case: when `getUser(token)` fails because the user was already deleted, the function reads the **`sub` claim from the signed token** (never from the request body), looks up `account_deletion_requests`, and:
  - `db_finalized` → finishes the auth deletion (tolerating "already gone") and returns `{success:true, pending:false}` truthfully;
  - any other status → returns `401 {success:false, pending:true, error:'session_expired'}` (real work remains and the user must sign in);
  - no request row → plain `401 unauthenticated`.
- New `decodeJwtSubject(token)` (lines ~240-250) parses only the payload `sub` (the gateway already verified the signature; this is a lookup key, not the authorisation check).
- Authorisation is preserved: the only id ever acted on is the verified token subject; a body-supplied id is never read.

**Tests** — `scripts/test-b1-retry.mjs` (8 scenarios, all pass):
`B1-1` success reports `{success:true,pending:false}`; `B1-2` auth-delete failure returns `auth_delete_failed` **without** any `signOut`, and a retry with the same live session completes; `B1-3` lost response after successful auth delete recovers via the `db_finalized` row without re-authentication; `B1-3b` unfinished work returns `session_expired`, never a false success; `B1-3c` a token with no request row is `unauthenticated`; `B1-4` a duplicate request is idempotent; `B1-5` only the token subject is ever deleted (cross-account ids are never touched); `B1-6` a request with no Bearer token makes zero admin calls.
The suite is proven non-vacuous: re-introducing the old revoke-before-delete line makes `B1-1` and `B1-2` fail, confirming the tests exercise the fix.

### 1B. SQL chain test rollback — **FIXED**

**Original defect (was FAIL).** `scripts/account-deletion-chain.sql` claimed transaction rollback in its header but had **no `begin;`/`rollback;`** (verified by grep at the time). Every statement autocommitted; an aborted run left fixture rows in the shared local database, causing `users_pkey` collisions on the next run — proving SQL errors could leave persistent data.

**Fix applied** (`scripts/account-deletion-chain.sql`):
- The file now starts with `\set ON_ERROR_STOP on` followed by `begin;` and ends with `rollback;` after the final assertion.
- Isolation contract, stated in the header: the whole script is one transaction. On success it reaches `ROLLBACK`; on an assertion failure `ON_ERROR_STOP` aborts psql mid-transaction, and PostgreSQL rolls the open transaction back when the session ends. Either way **no fixture data persists**.

**Tests** (run against a throwaway `chain_scratch` database built from the real chain schema — never the shared `postgres` DB, never production):
1. Successful run → all assertions pass, then `ROLLBACK`; afterwards `auth.users = 0`, `users = 0`, `account_deletion_requests = 0`, and even the helper `scratch` schema is gone (exit 0).
2. Deliberate assertion failure (`scratch.assert(false, ...)` injected) → psql exits 3 on `ASSERT FAILED` and **zero rows remain** (implicit rollback at session end).
3. Repeated successful runs → no primary-key collisions (runs 1 and 2 both exit 0 with zero residual rows).

---

## 2. Payment dependency findings

### 2.1 Can account deletion break an outstanding payment callback? — **PASS**

`payment-callback/index.ts` identifies an intent by (a) the per-intent callback key `?ck=` (documented lines 18-24) and (b) `status = 'pending'` (line 133 `.eq('status', 'pending')`). The finalizer only rewrites `phone`, `callback_key`, `user_id` and `recipient_user_id`; it never deletes intent rows. A late callback therefore still *finds* the row — it is recorded rather than unlocking, because:
- `20261116000000_production_account_deletion.sql` sets pending intents to `expired`, and the callback's consume guard only matches `pending`;
- `callback_key` is cleared, so the ticket check fails closed.

The callback is not "broken" (no 500 / no lost money record); it is deliberately inert.

### 2.2 Can a callback recreate or expose data belonging to a deleted user? — **PASS**

`20261022160000_production_section2_contacts.sql:305-321` (`complete_connect_unlock`) returns early on:
- `it.status <> 'succeeded'` (line 306),
- `it.recipient_user_id is null` (line 307),
- `buyer is null or seller is null` (line 313) — the finalizer nulls both references.

`users_are_paired(buyer.id, seller.id)` (line 319) then also fails once the match rows are deleted. No unlock row is created and no deleted-user data is re-exposed.

### 2.3 Does phone anonymisation interfere with payment reconciliation? — **PASS**

`+000000000` cannot be confused with a real number:
- `initiate-payment/index.ts:36` `KENYAN_PHONE = /^(?:\+?254|0)(?:7\d|1\d)\d{7}$/` — the sentinel fails this.
- No `unique` index mentions `phone` on `payment_intents`/`payments` (verified with `pg_indexes`).
- `payment-callback/index.ts:350` states unlocking is "never by phone"; no `.eq('phone', …)` appears in the callback.
- Reconciliation keys on `mpesa_transaction_id` / `checkout_request_id` / `callback_key`, none of which the redaction touches.

`scripts/test-phone-redaction.mjs` asserts all of the above and passes 8/8.

### 2.4 Are successful payments and contact-unlock records retained correctly? — **PASS**

- Successful intents: never touched by the `status='pending'` update; only the person reference is detached (`production_account_deletion.sql:216-223`).
- `payments`: `match_id` and `user_id` detached, `phone_number` redacted, row retained (lines 239-247).
- `connect_unlocks`: retained; both `buyer_id` and `seller_id` set to NULL (lines 251-255). Verified safe against `connect_unlocks_buyer_id_seller_id_key` `UNIQUE (buyer_id, seller_id)`: Postgres treats NULLs as distinct, so many fully-nulled snapshots coexist (empirically confirmed: three `(null,null)` rows accepted).

### 2.5 Are retained records inaccessible to ordinary users? — **PASS**

`get_unlocked_contacts` (`20261022160000_…:494-497`) filters `cu.buyer_id = me and cu.seller_id = other_user_id`. With both columns NULL, no ordinary user can match a retained snapshot. `account_deletion_requests` has RLS on, no policies, and no `anon`/`authenticated` grants.

**Caveat (not a defect in this change):** the legacy `payments` table is not RLS-enabled anywhere in the repository (`docs/BACKUP_PREFLIGHT_REPORT.md:60`). Retention there is protected by privilege, not RLS. No application code reads or writes `payments` (grep found only the deletion statements), so the exposure is limited to whatever direct Data API access PostgREST exposes.

---

## 3. Storage coverage findings

Repository upload sites (complete `grep -rn "\.upload("` over `src/` and `supabase/functions/`):

| Upload location | Bucket/path | Deletion cleanup | Result |
|---|---|---|---|
| `src/pages/Photos.jsx:103` (`.upload(storageFilePath, resized, {upsert:true})`), path built at `:87` as `` `${userId}/${slot.type}_${Date.now()}.jpg` `` | `user-photos` — `<userId>/<type>_<epoch>.jpg` | `storage-cleanup.ts:64` `ownedBy` = `path.startsWith(\`${userId}/\`)`; `:125` discovers buckets; `:139` retries ×4; `:146` 1000/chunk | **PASS** |
| `src/pages/PhotoUpload.jsx:69` (`.upload(path, file, {upsert:true})`), path at `:66` as `` `${userId}/${slot.key}.jpg` `` | `user-photos` — `<userId>/<slot>.jpg` | same prefix match and recursive descent (`storage-cleanup.ts:95`, `:100`) | **PASS** |

**Buckets present (local stack):** `user-photos`, `profile_photos`. Cleanup uses `listBuckets()` rather than a hardcoded list, so any bucket added later is covered automatically.

**Retry on failure:** `storage-cleanup.ts:49` `MAX_ATTEMPTS = 4`; `:159-165` re-lists and throws if objects remain. A cleanup failure at `index.ts:104-111` returns `502`, records the failure, and **does not** proceed to finalisation — so the retryable state is preserved. Note the interaction with finding **1A**: the retry is only reachable while the user still has a session.

**Coverage gap to note (not a defect):** `profile_photos` is `public: true` with no application upload path found; deletion still handles it because bucket discovery is dynamic.

---

## 4. Backup and restoration evidence — **BLOCKED**

**Investigation performed (read-only, no configuration changed).** Target: project `mhdjnhiqahsllbczbzpk` (MingleMate, `eu-west-1`). No backup metadata could be retrieved because **no authorized access to the production project is available**. Every management endpoint returned `401`, so no backup timestamp, PITR window or restoration record could be observed. Per the task instruction, the investigation stopped here rather than inventing evidence or constructing a workaround.

### Access evidence

| Probe | Result |
|---|---|
| `GET https://api.supabase.com/v1/projects` with `$SUPABASE_ACCESS_TOKEN` | **HTTP 401** — `{"message":"JWT could not be decoded"}` |
| `GET /v1/projects/mhdjnhiqahsllbczbzpk/database/backups` | **HTTP 401** |
| `GET /v1/projects/mhdjnhiqahsllbczbzpk/config/backups` | **HTTP 401** |
| `npx supabase projects list` | `Invalid access token format. Must be like `sbp_0102...1920`.` |
| Token shape | length 27, **no `sbp_` prefix** (a valid PAT is `sbp_` + 40 hex) |
| `~/.supabase/access-token` | absent — no stored CLI login |
| Credential references in `.pi/mcp.json`, `opencode.json` | all are `${SUPABASE_ACCESS_TOKEN}` / `{env:...}` indirections to the same invalid token — no alternative credential exists |
| `supabase/.temp/project-ref` | `ifiewinipbxxfvzpzezd` (**staging**) — the CLI is linked to the wrong project; production is not the linked target |

### Local/operational evidence

| Check | Result |
|---|---|
| `backups/` directory | **absent** |
| `*.sql.gz` / `*.dump` / `*.backup` in the tree | **none found** |
| `.github/workflows/weekly-db-backup.yml` | `schedule:` still commented out (`workflow_dispatch: {}` only, lines 26-28) |
| `gh run list --workflow weekly-db-backup.yml` | no output — no recorded runs retrievable |
| `docs/BACKUP_PREFLIGHT_REPORT.md:10` | Prior independent verdict: **"NOT READY"**; issue 1 states no usable production database credential is confirmed, and item 5 states **"No restore target is prepared or proven."** |

### Deliverable

| Requirement | Evidence | Status |
|---|---|---|
| Recent successful backup | **No evidence obtainable.** Management API returns 401 for every backup endpoint; no local artifact; no workflow run recorded. No timestamp or source can be stated. | **BLOCKED** |
| Backup restoration capability | **No existing verified evidence.** Plan tier and PITR window are unreadable; `docs/BACKUP_PREFLIGHT_REPORT.md:158-160` still lists them as open questions; the same report (item 5) records that no restore target is prepared or proven. Per the task rule, enabled-but-unverified backups are not claimed restorable. | **BLOCKED** |
| Restoration test | **No recorded outcome exists** anywhere in the repository, workflow history or the prior preflight report. | **NOT TESTED** |

### Exact evidence still required to close B3

1. A valid `sbp_…` personal access token for an account with access to `mhdjnhiqahsllbczbzpk` (or dashboard access), to read the project's backup list and PITR setting.
2. At least one completed backup artifact with a verifiable timestamp (either a platform-managed backup shown in the dashboard, or a completed `weekly-db-backup` run).
3. A completed restore into an isolated, disposable database, with the verification result recorded (row counts / schema check / application smoke test).

**No restoration was initiated, no configuration changed, no PITR enabled, no service purchased, no credentials exposed.**

## 5. Remaining release blockers

| # | Blocker | Severity | Owner action |
|---|---|---|---|
| B1 | ~~Auth-deletion failure leaves the user unable to retry~~ — §1A | **FIXED** | Revoke moved after delete; lost-response recovery added; 8/8 tests pass. |
| B2 | ~~`scripts/account-deletion-chain.sql` has no transaction despite claiming one~~ — §1B | **FIXED** | `ON_ERROR_STOP` + `BEGIN`/`ROLLBACK` added; success and failure paths verified to leave zero rows. |
| B3 | No production backup, no evidenced PITR, no restore test — §4 | **High** (operational) | **Unresolvable in this environment:** no authorized production access exists (401). Requires a valid `sbp_` token or dashboard access, then a recorded restore drill. |
| B4 | Pre-existing: `npm run verify` fails on `verify-weekly-generation-safety.mjs` flagging `20261110090100_campuses_rls_and_write_privileges.sql` for an executable `TRUNCATE` (committed at `9b3e03e`, unrelated to this work) | Low | Decide whether the TRUNCATE is intended; not caused by account deletion. |

---

## 6. Final verdict

**HOLD**

B1 and B2 are fixed and tested. The account-deletion implementation — data handling, payment retention, callback inertness, phone redaction, storage coverage, retry/lost-response recovery, and test isolation — is verified PASS with cited evidence.

**B3 remains open and could not be investigated.** No authorized access to project `mhdjnhiqahsllbczbzpk` is available: the management API returns HTTP 401 (`JWT could not be decoded`) on `/v1/projects`, `/database/backups` and `/config/backups`; the CLI rejects the token (`Must be like sbp_...`); no stored CLI login exists; and the CLI is linked to staging (`ifiewinipbxxfvzpzezd`), not production. No local backup artifact exists, the weekly-backup workflow is still disabled, and the prior independent preflight concluded "NOT READY" with no prepared or proven restore target.

Consequently **no recent backup timestamp can be reported, restoration capability is unverified, and no restoration test has ever been recorded.** Per the investigation rules, enabled backups are not claimed restorable and no workaround was constructed.

**Decision: HOLD — recovery capability remains unverified.**

Account deletion is code-complete and tested, but must not be released until B3 is closed with: (1) a valid `sbp_` production token or dashboard access, (2) a completed backup artifact with a verifiable timestamp, and (3) a recorded restore drill into an isolated database.

The owner retains release authority.
