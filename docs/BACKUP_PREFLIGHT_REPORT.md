# MingleMate Production Backup — Preflight Report

**Investigation date:** 2026-10-21  
**Repository:** `C:\Users\oboch\minglemate`  
**Target named by the repository:** Supabase project `mhdjnhiqahsllbczbzpk` (`minglemate`)  
**Mode:** read-only. No database connection, no dump, no restore, no deployment, no write outside this file.

---

## 1. Verdict

**NOT READY**

1. **No usable production database credential is confirmed available.** The GitHub Actions secret `SUPABASE_DB_POOLER_URL` does not exist (`total_count: 0`), and the local `.env*` files were not read. No production connection string is proven available for a manual dump.
2. **The Supabase CLI is linked to staging, not production.** `supabase/.temp/linked-project.json` and `supabase/.temp/project-ref` both name `ifiewinipbxxfvzpzezd` (`minglemate-staging`). Any `--linked` command would target the wrong project.
3. **No PostgreSQL 17 dump client is installed or verified.** `pg_dump` and `psql` are absent from PATH and from the common PostgreSQL install locations. A Docker-based client exists as a candidate image, but its `pg_dump` version has not been verified.
4. **No backup destination, format, scope, retention or encryption decision exists.** There is no `backups/` directory in the repository and no local `.sql.gz`/dump file. Nothing currently exists to overwrite, but there is also no defined target.
5. **No restore target is prepared or proven.** Docker and the Supabase CLI are present and ports 54321–54324 are free, but no local stack is running. A schema-only rebuild from the repository is currently broken: `supabase/seed.sql` is missing, `supabase/.temp/preconditions.sql` is not wired into the active config, and `section2_responses`, `engagement_metrics` and `payments` are not created by the migrations or preconditions.
6. **Production database size, server version and region are unknown.** The repository targets PostgreSQL 17, but the deployed server version was not verified. Free space on `C:` is 35.56 GB, which cannot be confirmed sufficient without the database size from the dashboard.
7. **A database dump alone will not capture storage files, Auth/Edge configuration and secrets, roles/ACLs under the workflow’s flags, or deployed Edge Function versions.** No separate backup plan exists for those items.
8. **The repository migrations cannot be proven to match the deployed database.** The consolidated chain is modified in the working tree and three later migrations are untracked.

---

## 2. Facts table

| Fact | Value | Evidence |
|---|---|---|
| Production project reference named by repository | `mhdjnhiqahsllbczbzpk` | `.github/workflows/weekly-db-backup.yml:7`; `supabase/sql/superseded/harden_resilience.sql:4`; `docs/MINGLEMATE_CURRENT_STATE_INVESTIGATION.md:440` |
| Local Supabase project id | `minglemate` | `supabase/config.toml:5` |
| CLI-linked project | `ifiewinipbxxfvzpzezd` (`minglemate-staging`) | `supabase/.temp/linked-project.json`; `supabase/.temp/project-ref` |
| CLI link conflict | The link points to staging; the workflow and docs name production | `docs/docs-reconciliation-2026-10-14.md:106`, `:194` |
| Production region | **UNKNOWN — needs Will** | No repository file proves it. The only region evidence is staging’s pooler host (`eu-west-1`) in `supabase/.temp/pooler-url` — **VALUE REDACTED** |
| Target PostgreSQL major version | 17 | `supabase/config.toml:41` (`major_version = 17`) |
| Local stack PostgreSQL image version | `17.6.1.166` | `supabase/.temp/postgres-version`; `docker images` output |
| Deployed PostgreSQL server version | **UNKNOWN** | No database connection was made; `supabase/config.toml:39-40` says to check the remote with `SHOW server_version;` |
| Local `pg_dump` | **NOT INSTALLED** | `Get-Command pg_dump` returned nothing; no `pg_dump.exe` under `C:\Program Files\PostgreSQL`, `C:\Program Files (x86)\PostgreSQL`, Chocolatey bin or Scoop apps |
| Local `psql` | **NOT INSTALLED** | `Get-Command psql` returned nothing |
| Supabase CLI | `2.116.0`; an update to `2.121.0` is advertised | `supabase --version`; `supabase/.temp/cli-latest` |
| Docker | `29.6.1`, build `8900f1d`; engine ServerVersion `29.6.1`; context `desktop-linux` | `docker --version`; `docker info --format '{{.ServerVersion}}'`; `docker context show` |
| Docker running | Yes | `docker info` returned ServerVersion `29.6.1` |
| Free disk space | `C:` 35.56 GB free, 202.11 GB used; no other filesystem drive returned | `Get-PSDrive -PSProvider FileSystem` |
| Local ports 54321–54324 | **None listening** | `Get-NetTCPConnection -State Listen` filtered to 54321–54324 returned `NONE LISTENING` |
| Git | `2.53.0.windows.2`; branch `fix/review-2026-10-15`; HEAD `dfad576` | `git --version`; `git branch --show-current`; `git log -1 --oneline` |
| GitHub CLI | `2.100.0`; authenticated as `Tery-1111`; repository private | `gh --version`; `gh auth status`; `gh repo view Tery-1111/minglemate --json isPrivate,nameWithOwner,defaultBranchRef` returned `isPrivate: true` |
| Repository remote | `https://github.com/Tery-1111/minglemate.git` | `git remote -v` |
| API-exposed schemas | `public`, `graphql_public` | `supabase/config.toml:13` |
| Additional search path | `public`, `extensions` | `supabase/config.toml:15` |
| Schemas created by migrations | **None.** No `create schema` statement exists in `supabase/migrations` | `Select-String` over `supabase/migrations/*.sql` for `create schema` returned no match |
| Schemas modified by migrations | `public` (tables/functions/policies), `storage` (bucket rows and `storage.objects` policies), `auth` (trigger on `auth.users`), `cron` (schedule) | `20261014150000_consolidated_schema_chain.sql:126`, `:2306-2308`, `:3008-3010`, `:3608`, `:3676` |
| Other schemas read/used | `vault` for `OPS_ALERT_WEBHOOK_URL`; `net` for `net.http_post` | Chain `:2889-2892`, `:2916-2927` |
| Extensions required | `pgcrypto` (for `gen_random_uuid`), `pg_cron` (scheduler), `pg_net` (webhook delivery) | Chain `:27-29`, `:61`; no `create extension` statement exists in the migrations |
| Extensions enabled by migrations | **None.** They are preconditions; the Dashboard must enable them | Same evidence; chain explicitly says “Dashboard → Database → Extensions” |
| pg_cron jobs defined in repo | `payment-ops-tick` at `*/5 * * * *`, calling `select public.payment_ops_tick()` | Chain `:3008-3010` |
| Other cron-like schedule | `expire-payment-intents` at `*/10 * * * *` is **commented out** in a superseded file, not a current job | `supabase/sql/superseded/payment_intent_lifecycle.sql:233` |
| GitHub Actions schedule | Commented out; workflow is manual-only | `.github/workflows/weekly-db-backup.yml:24-28` |
| User-data and supporting tables named by the repository | `users`, `user_responses`, `photos`, `matches`, `match_history`, `messages`, `conversations`, `connect_unlocks`, `section2_chat_progress`, `section2_responses`, `user_blocks`, `reports`, `campuses`, `admin_users`, `admin_audit_log`, `app_settings`, `notifications`, `engagement_metrics`, `payment_intents`, `token_purchases`, `processed_payment_callbacks`, `ops_alerts`, `entitlement_grants`, `entitlement_grant_kinds` | `supabase/sql/inspect_state.sql:75-98`; `supabase/.temp/preconditions.sql:13-86`; chain table DDL |
| Legacy payment table | `public.payments` exists in the legacy product narrative and is referenced by the retirement migration, but is **not** in the repository’s expected-table inventory | `20261019190000_retire_generate_tuesday_matches.sql:9-10`, `:41`, `:62` |
| Tables with RLS enabled in migrations | `users`, `user_responses`, `payment_intents`, `messages`, `section2_chat_progress`, `reports`, `user_blocks`, `app_settings`, `matches`, `match_history`, `connect_unlocks`, `conversations`, `processed_payment_callbacks`, `ops_alerts`, `admin_users`, `admin_audit_log`, `entitlement_grants`, `photos`, `notifications`, `token_purchases`, `campuses` | Chain `:126`, `:162`, `:314`, `:343`, `:356`, `:467`, `:503`, `:641`, `:856`, `:905`, `:940`, `:1010`, `:2419`, `:2776`, `:3054`, `:3067`, `:3802`; closure `:101`, `:136`, `:167`, `:185` |
| Tables not RLS-enabled anywhere in migrations | `section2_responses`, `engagement_metrics`, `payments`, `entitlement_grant_kinds` | No `enable row level security` match for these names in `supabase/migrations`; `section2_responses` and `engagement_metrics` appear only as expected objects in `inspect_state.sql:85,93` |
| Storage buckets referenced | `profile_photos`, `user-photos` | Chain `:3608`, `:3676`; app paths below |
| Bucket visibility in migrations | Both inserted with `public = true` | Chain `:3608` and `:3676` |
| App upload path | `src/pages/Photos.jsx:96-97`, `src/pages/PhotoUpload.jsx:68-69` use `supabase.storage.from('user-photos').upload(...)` | Direct file reads |
| App public URL path | `src/pages/Photos.jsx:101-102`, `src/pages/PhotoUpload.jsx:79-80` use `getPublicUrl(...)` | Direct file reads |
| App delete path | `src/pages/Photos.jsx:86-88` removes from `user-photos` | Direct file read |
| App use of `profile_photos` | No upload/download path found in `src/`; the bucket policies exist in the chain | `Select-String` across `src/` and `supabase/` |
| Auth tables the app depends on | `auth.users` is referenced by FKs and the signup trigger; no direct `.from('auth.users')` query was found. The client uses `supabase.auth.getUser()`/`getSession()` | Chain `:304`, `:638`, `:2017`, `:2306-2308`, `:3050`; `src/components/AuthGuard.jsx:24`, `src/pages/Signup.jsx:28-40` |
| Auth config captured by a DB dump | No — Auth providers, JWT signing configuration, e-mail templates, redirect URLs, MFA and SMTP settings are platform configuration, not ordinary `public` table data | `supabase/config.toml:154-175` is local config only; no Auth config export artifact exists in the repository |
| Edge Function source location | Repository, `supabase/functions/` | Directory listing |
| Edge Function names | `health`, `initiate-payment`, `match-generator`, `payment-callback`, `send-notification` (`_shared` is shared code, not a function) | `Get-ChildItem .\supabase\functions -Directory` |
| Edge Function secret/env names | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL`, `MPESA_ENV`, `SUPABASE_FUNCTION_URL`, `MPESA_INITIATOR`, `MPESA_SECURITY_CREDENTIAL`, `ONESIGNAL_API_KEY`, `ONESIGNAL_APP_ID` | `Select-String "Deno.env.get"` across `supabase/functions`; values were not read or printed |
| Vault secret used by DB | `OPS_ALERT_WEBHOOK_URL` | Chain `:2889-2892`, `:2910` |
| GitHub Actions secret expected | `SUPABASE_DB_POOLER_URL` — **NAME ONLY** | `.github/workflows/weekly-db-backup.yml:41` |
| GitHub Actions secret state | `0` secrets; no names returned | `gh api repos/Tery-1111/minglemate/actions/secrets --jq '.total_count'` → `0` |
| Backup workflow runs | **None** | `gh run list -R Tery-1111/minglemate --workflow weekly-db-backup.yml --limit 5` returned no rows |
| Backup artifacts | **0** | `gh api repos/Tery-1111/minglemate/actions/artifacts --jq '.total_count'` → `0` |
| Backup destination in repo | No `.\backups` directory; no `*.sql.gz` files | `Test-Path .\backups` → false; recursive `*.sql.gz` search returned nothing |
| Local `.env` file names | `.env`, `.env.local`, `.env.daraja.local` — **values not read** | `Get-ChildItem -Filter ".env*"` |
| Local preconditions file | `supabase/.temp/preconditions.sql` exists; it is not tracked by Git | `Test-Path`; `git ls-files supabase/.temp/preconditions.sql` returned nothing |
| Local seed file | `supabase/seed.sql` is **missing**, but `supabase/config.toml:70` sets `sql_paths = ["./seed.sql"]` | `Test-Path .\supabase\seed.sql` → false |
| Local migration count | 4 SQL files | `Get-ChildItem .\supabase\migrations -Filter *.sql` |
| Tracked migration files | Only `20261014150000_consolidated_schema_chain.sql` is tracked | `git ls-files supabase/migrations` |
| Working-tree migration state | Chain is modified; three later migrations are untracked | `git status --short supabase/migrations` |
| Deployed-vs-repository migration match | **UNKNOWN — cannot be proven without a database read** | No migration-history table was read; no database connection was made |

### 2a. Tables and RLS detail

| Table | What it holds | Created by repository? | RLS enabled in migrations? |
|---|---|---|---|
| `public.users` | Profiles, contact fields, auth mirror | Precondition (`preconditions.sql:13`); chain adds columns | Yes (`chain:126`) |
| `public.user_responses` | Section 1 answers | Precondition (`preconditions.sql:28`) | Yes (`chain:162`) |
| `public.photos` | Photo metadata/URLs | Precondition (`preconditions.sql:66`) | Yes (`closure:101`) |
| `public.matches` | Paid Qrashe pairs | Chain (`chain:827`) | Yes (`chain:856`) |
| `public.match_history` | Weekly Tier 1/Tier 2 matches | Precondition and `create table if not exists` in chain (`preconditions.sql:81`, `chain:891`) | Yes (`chain:905`) |
| `public.messages` | Chat messages | Precondition (`preconditions.sql:37`) | Yes (`chain:343`) |
| `public.conversations` | Chat lifecycle | Chain (`chain:955`) | Yes (`chain:1010`) |
| `public.connect_unlocks` | Paid contact snapshots | Chain (`chain:922`) | Yes (`chain:940`) |
| `public.section2_chat_progress` | Guided-chat progress | Precondition (`preconditions.sql:44`) | Yes (`chain:356`) |
| `public.section2_responses` | Section 2 free-text answers | **Not created by migrations or preconditions**; expected object only (`inspect_state.sql:85`) | **No migration RLS statement** |
| `public.user_blocks` | Block relationships | Chain (`chain:492`) | Yes (`chain:503`) |
| `public.reports` | Abuse reports | Chain (`chain:458`) | Yes (`chain:467`) |
| `public.campuses` | Campus reference data | Precondition (`preconditions.sql:52`) | Yes (`closure:185`) |
| `public.notifications` | In-app notifications | Precondition (`preconditions.sql:59`) | Yes (`closure:136`) |
| `public.engagement_metrics` | Engagement events | **Not created by migrations or preconditions**; expected object only (`inspect_state.sql:93`) | **No migration RLS statement** |
| `public.payment_intents` | Payment/entitlement state | Chain (`chain:302`) | Yes (`chain:314`) |
| `public.token_purchases` | Legacy token purchases | Precondition (`preconditions.sql:72`) | Yes (`closure:167`) |
| `public.processed_payment_callbacks` | Callback deduplication | Chain (`chain:2414`) | Yes (`chain:2419`) |
| `public.ops_alerts` | Operational alert records | Chain (`chain:2746`) | Yes (`chain:2776`) |
| `public.admin_users` | Admin identities | Chain (`chain:3049`) | Yes (`chain:3054`) |
| `public.admin_audit_log` | Admin audit trail | Chain (`chain:3058`) | Yes (`chain:3067`) |
| `public.app_settings` | Application settings | Chain (`chain:634`) | Yes (`chain:641`) |
| `public.entitlement_grants` | Entitlement evidence | Chain (`chain:3767`) | Yes (`chain:3802`) |
| `public.entitlement_grant_kinds` | Entitlement lookup | Chain (`chain:3815`) | No RLS statement |
| `public.payments` | Legacy payments | **Not created by migrations**; referenced in `20261019190000:9-10` | No repository RLS statement |

`storage.objects` and `auth.users` are platform tables; they are covered by platform RLS/privileges, not by the `public` migration inventory above.

---

## 3. What a dump will NOT capture

Each item below needs a separate backup or a separate recorded decision.

1. **Storage bucket files.** `profile_photos` and `user-photos` are referenced by the repository. A `pg_dump` captures database rows and storage policies, but **not the object bytes**. The app uploads to `user-photos` in `src/pages/Photos.jsx:96-97` and `src/pages/PhotoUpload.jsx:68-69`, and reads public URLs via `getPublicUrl` at `Photos.jsx:101-102` and `PhotoUpload.jsx:79-80`. The `profile_photos` bucket is created by the migration at `chain:3608`, but no app upload path to it was found. **Separate backup need:** export/download all objects in both buckets, plus bucket metadata and policies. Object count and total size are unknown.
2. **Auth service configuration.** The app depends on `auth.users` through the Supabase Auth SDK and through FKs/trigger (`chain:304`, `:638`, `:2306-2308`, `:3050`). The application code does **not** directly query `auth.users`; it calls `supabase.auth.getUser()`/`getSession()` (`src/components/AuthGuard.jsx:24`, many pages). A database dump may contain the `auth` schema tables, but it does **not** contain Auth providers, JWT signing keys, SMTP settings, e-mail templates, MFA policy, rate limits, or redirect URLs. **Separate backup need:** export/record the Auth configuration from the dashboard and store the JWT/signing secrets in a secret manager. Do not treat a database dump as an Auth configuration backup.
3. **Edge Function secrets and environment variables.** The functions read the names listed in section 2: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL`, `MPESA_ENV`, `SUPABASE_FUNCTION_URL`, `MPESA_INITIATOR`, `MPESA_SECURITY_CREDENTIAL`, `ONESIGNAL_API_KEY`, `ONESIGNAL_APP_ID`. **None are in a database dump.** **Separate backup need:** keep them in the Supabase secret store or an external secret manager; never write their values into this report or a repository file.
4. **Edge Function source and deployed versions.** Source exists in `supabase/functions/` (`health`, `initiate-payment`, `match-generator`, `payment-callback`, `send-notification`; `_shared` is shared code). Git is the source backup, but the deployed function versions and configuration are not in a database dump. **Separate backup need:** record deployed versions/timestamps and `verify_jwt` settings; keep source in version control.
5. **Roles, ownership and ACLs under the existing workflow.** `weekly-db-backup.yml:51` runs `pg_dump "$SUPABASE_DB_POOLER_URL" --no-owner --no-privileges`, so a dump produced by that workflow omits ownership and privilege grants. **Separate backup need:** a role/ACL dump (`pg_dumpall --roles-only --no-role-passwords` or an equivalent reviewed export), or accept that a restore will not reproduce grants and must reapply them from the migrations/policy inventory.
6. **`pg_cron` scheduler state.** The repository defines `payment-ops-tick` (`chain:3008-3010`), but scheduler rows live in `cron.job`. A dump may include extension tables inconsistently and restoring `cron.job` directly is not a supported substitute for re-creating schedules. **Separate backup need:** record the schedule SQL and reapply it after restore; verify `cron.job` and `cron.job_run_details`.
7. **Vault secret `OPS_ALERT_WEBHOOK_URL`.** The chain reads it from `vault.decrypted_secrets` (`chain:2889-2892`). Even if encrypted Vault rows are present in a dump, they are not a usable secret backup. **Separate backup need:** store the webhook secret in the secret manager and re-create the Vault secret after restore.
8. **Supabase platform configuration.** API keys, JWT secret, Auth providers, SMTP, Storage S3 settings, Realtime settings, Edge Function secrets, project settings and custom domains are platform state, not ordinary table data. **Separate backup need:** a documented dashboard/configuration export or a configuration-as-code record.
9. **Storage bucket rows vs files.** Bucket rows and `storage.objects` policies are database objects; the actual files are not. A dump can restore the metadata but leave every photo URL pointing at missing bytes. **Separate backup need:** both the database dump and the bucket object export, restored together.

---

## 4. Decisions Will must make

No option below is recommended.

| Decision | Options | Consequence |
|---|---|---|
| Backup route | (a) Install/use native PostgreSQL 17 `pg_dump`; (b) use the Supabase CLI `db dump` with Docker; (c) use `pg_dump` from the cached `public.ecr.aws/supabase/postgres:17.6.1.166` image; (d) use the existing GitHub Actions workflow | (a) requires installing a client but gives direct control of format and scope; (b) is already installed but its default schema scope and internal dump version must be verified; (c) uses an image already present but its `pg_dump` version must be verified; (d) produces only a 7-day Actions artifact and requires a repository secret. |
| Dump format | (a) Plain SQL (optionally gzip); (b) PostgreSQL custom format (`-Fc`); (c) Directory format (`-Fd`) | Plain SQL is readable and matches the existing workflow; custom/directory formats support selective restore and parallel restore but require `pg_restore`. |
| Dump scope | (a) Full database, all schemas; (b) `public` only; (c) `public` plus selected `auth`/`storage` objects; (d) separate schema and data dumps | Full-database is the only option that can capture Auth/Storage metadata, but it creates restore-order and platform-schema risks. `public`-only is simpler but omits Auth/Storage data. |
| Roles/ACLs | (a) Include a separate role/ACL dump; (b) exclude them and reapply grants from the migrations; (c) use a dump without `--no-owner --no-privileges` | Without a role/ACL backup, a restore will not reproduce ownership or grants. Including roles may require privileges the pooler user does not have. |
| Destination | (a) Local fixed disk (`C:` has 35.56 GB free); (b) external/removable drive; (c) encrypted cloud object storage (S3/R2); (d) GitHub Actions artifact | Local disk is fast but not disaster-safe. External storage is portable but needs handling. Cloud storage adds credentials and retention controls. Actions artifacts expire after 7 days and are not a durable backup. |
| Retention and encryption | (a) Single copy; (b) multiple generations with a fixed retention; (c) encrypted at rest with a separately stored key; (d) unencrypted | A dump contains personal data (profiles, answers, messages, payment metadata). Retention and encryption affect privacy, storage cost and recoverability. |
| Restore target | (a) Local Supabase stack; (b) throwaway standalone PostgreSQL container; (c) staging project; (d) a new isolated project | Local Supabase is closest to the platform but includes Auth/Storage services. A standalone Postgres is cleaner for data validation but lacks Supabase schemas. Staging risks overwriting an existing environment. A new project costs money and must be isolated. |
| Storage and Auth backup | (a) Include bucket-object export and Auth configuration record in the same runbook; (b) back them up separately; (c) accept that a database-only restore is incomplete | A database-only backup cannot restore photos or Auth provider configuration. |
| Use of the existing workflow | (a) Keep it manual-only; (b) add the secret and run manually; (c) enable the weekly schedule; (d) retire it in favour of a local/offsite script | The workflow currently cannot run without the secret. Enabling the schedule before a proven restore would create recurring artifacts with only 7-day retention. |

---

## 5. Questions for Will

Only the Supabase dashboard can answer these:

1. **What is the production project’s plan tier?** (Free/Pro/Team/Enterprise; this determines whether platform backups or PITR are available.)
2. **Is point-in-time recovery enabled?** If yes, what is the recovery window and retention?
3. **What is the current production database size?** This is needed to confirm that 35.56 GB free on `C:` is sufficient, including the dump, compression and restore copy.
4. **Where is the production connection string in the dashboard?** The workflow header records: **Supabase Dashboard → Production project (`mhdjnhiqahsllbczbzpk`) → Connect → Session pooler connection string, port 5432** (`.github/workflows/weekly-db-backup.yml:7-10`). Will must retrieve it there and supply it through a secure channel, not paste it into chat or this report.
5. **What is the production region?** The repository does not prove it. The staging pooler host indicates `eu-west-1`, but that is staging, not production.

---

## 6. Exact commands that would be run — NOT EXECUTED

These are command sets, not a recommendation. Only one backup route should be chosen. Replace every `<PLACEHOLDER>` before running; never echo the connection string.

### 6.0 Common preflight (PowerShell)

```powershell
$env:SUPABASE_DB_URL = '<PRODUCTION_SESSION_POOLER_URI>'
$env:BACKUP_DIR = '<ABSOLUTE_BACKUP_DIRECTORY>'
$env:TS = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
New-Item -ItemType Directory -Path $env:BACKUP_DIR -Force | Out-Null
```

Verify the Docker image’s dump client before choosing route (c):

```powershell
docker run --rm public.ecr.aws/supabase/postgres:17.6.1.166 pg_dump --version
```

The expected major version is 17. If this does not print 17.x, route (c) is not valid.

### 6.1 Route A — native PostgreSQL 17 `pg_dump`

```powershell
& '<PG17_BIN>\pg_dump.exe' --version
& '<PG17_BIN>\pg_dump.exe' --dbname $env:SUPABASE_DB_URL --format=custom --no-owner --no-privileges --file "$env:BACKUP_DIR\minglemate-prod-full-$env:TS.dump"
```

### 6.2 Route B — Docker `pg_dump` from the cached Supabase PostgreSQL 17 image

```powershell
$dumpName = "minglemate-prod-full-$env:TS.dump"
docker run --rm `
  -v "${env:BACKUP_DIR}:/backups" `
  -e "SUPABASE_DB_URL=$env:SUPABASE_DB_URL" `
  -e "DUMP_NAME=$dumpName" `
  public.ecr.aws/supabase/postgres:17.6.1.166 `
  sh -lc 'pg_dump "$SUPABASE_DB_URL" --format=custom --no-owner --no-privileges --file="/backups/$DUMP_NAME"'
```

Optional role/ACL export, if Will chooses to include it and the connection user has permission:

```powershell
docker run --rm `
  -v "${env:BACKUP_DIR}:/backups" `
  -e "SUPABASE_DB_URL=$env:SUPABASE_DB_URL" `
  public.ecr.aws/supabase/postgres:17.6.1.166 `
  sh -lc 'pg_dumpall --roles-only --no-role-passwords "$SUPABASE_DB_URL" > /backups/minglemate-prod-roles.sql'
```

### 6.3 Route C — Supabase CLI `db dump`

```powershell
supabase db dump --db-url $env:SUPABASE_DB_URL --file "$env:BACKUP_DIR\minglemate-prod-schema-$env:TS.sql"
supabase db dump --db-url $env:SUPABASE_DB_URL --data-only --use-copy --file "$env:BACKUP_DIR\minglemate-prod-data-$env:TS.sql"
```

The CLI `--help` does **not** state the default schema scope. The default must be verified before relying on this route; the two-file output is not the same as a single full-database dump.

### 6.4 Route D — existing GitHub Actions workflow

This would add the secret through the GitHub prompt; do not put the value in this report or in chat.

```powershell
gh secret set SUPABASE_DB_POOLER_URL -R Tery-1111/minglemate
gh workflow run weekly-db-backup.yml -R Tery-1111/minglemate
gh run list -R Tery-1111/minglemate --workflow weekly-db-backup.yml --limit 5
gh run download -R Tery-1111/minglemate -n minglemate-prod-db-dump -D "$env:BACKUP_DIR"
```

The workflow’s exact dump command is:

```text
pg_dump "$SUPABASE_DB_POOLER_URL" --no-owner --no-privileges | gzip > "$DUMP_FILE"
```

It writes a plain SQL gzip stream, not a custom-format archive, despite the comment saying “Custom format”. It keeps the artifact for 7 days.

### 6.5 Post-dump integrity checks

```powershell
Get-Item "$env:BACKUP_DIR\minglemate-prod-full-$env:TS.dump" | Select-Object FullName,Length,LastWriteTime
Get-FileHash "$env:BACKUP_DIR\minglemate-prod-full-$env:TS.dump" -Algorithm SHA256 | Format-List
```

For a plain SQL gzip dump, also verify that it is data-bearing, not schema-only:

```powershell
# Run only if the chosen route produces a plain SQL gzip file.
# Inspect for COPY/INSERT lines without printing personal data.
```

### 6.6 Restore-test commands

Do not run these against production or staging.

```powershell
supabase start
supabase status
$env:LOCAL_DB_URL = '<LOCAL_DB_URL_FROM_SUPABASE_STATUS>'
```

Restore a custom-format dump:

```powershell
docker run --rm `
  -v "${env:BACKUP_DIR}:/backups" `
  -e "LOCAL_DB_URL=$env:LOCAL_DB_URL" `
  public.ecr.aws/supabase/postgres:17.6.1.166 `
  sh -lc 'pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$LOCAL_DB_URL" /backups/<DUMP_FILE>'
```

Restore a plain SQL dump:

```powershell
docker run --rm `
  -v "${env:BACKUP_DIR}:/backups" `
  -e "LOCAL_DB_URL=$env:LOCAL_DB_URL" `
  public.ecr.aws/supabase/postgres:17.6.1.166 `
  sh -lc 'psql "$LOCAL_DB_URL" -v ON_ERROR_STOP=1 -f /backups/<SQL_FILE>'
```

Verify key row counts after restore:

```powershell
docker run --rm `
  -e "LOCAL_DB_URL=$env:LOCAL_DB_URL" `
  public.ecr.aws/supabase/postgres:17.6.1.166 `
  sh -lc 'psql "$LOCAL_DB_URL" -c "select '\''users'\'' as table_name, count(*) from public.users union all select '\''user_responses'\'', count(*) from public.user_responses union all select '\''matches'\'', count(*) from public.matches union all select '\''match_history'\'', count(*) from public.match_history union all select '\''messages'\'', count(*) from public.messages union all select '\''payment_intents'\'', count(*) from public.payment_intents;"'
```

Stop the local stack after the drill:

```powershell
supabase stop
```

### 6.7 Schema-only local rebuild — current commands and known failure

The commands implied by the config are:

```powershell
supabase start
supabase db reset --local
```

This is **not currently a valid rebuild path**:

- `supabase/config.toml:58-60` enables migrations.
- `supabase/config.toml:65-70` sets seed `sql_paths = ["./seed.sql"]`.
- `supabase/seed.sql` does not exist.
- `supabase/.temp/preconditions.sql` exists but is not referenced by the active config; its own comment says it was intended for a `[db.seed]` path with migrations disabled (`preconditions.sql:1-11`).
- The preconditions file creates 9 tables (`preconditions.sql:13-86`), but not `section2_responses`, `engagement_metrics` or `payments`.
- The chain itself states that `users`, `user_responses`, `messages`, `section2_chat_progress`, `campuses`, `notifications` and `match_history` are preconditions (`chain:48-61`).

A restore from a real dump is therefore the only currently defensible local restore test. A schema-only rebuild needs a separate, reviewed bootstrap that creates all precondition tables and wires the seed path before migrations run.

---

## 7. Existing backup workflow

**Path:** `.github/workflows/weekly-db-backup.yml`

**Trigger:** `workflow_dispatch` only (`:28`). The weekly `schedule` block is commented out (`:25-27`). The workflow does not run on push or pull request (`:18`).

**Exact commands:**

```text
sudo apt-get update
sudo apt-get install -y --no-install-recommends postgresql-client
pg_dump "$SUPABASE_DB_POOLER_URL" --no-owner --no-privileges | gzip > "$DUMP_FILE"
```

The dump file is `backups/minglemate-prod-$(date -u +%Y%m%dT%H%M%SZ).sql.gz` (`:47-51`). It uploads `backups/*.sql.gz` as artifact `minglemate-prod-db-dump` with `retention-days: 7` (`:54-59`).

**Secret expected:** `SUPABASE_DB_POOLER_URL` — **NAME ONLY** (`:41`). The guard exits 1 if it is empty (`:43-46`).

**Why it has never produced an artifact — current evidence:**

- `gh run list -R Tery-1111/minglemate --workflow weekly-db-backup.yml --limit 5` returned **no runs**.
- `gh api repos/Tery-1111/minglemate/actions/artifacts --jq '.total_count'` returned **`0`**.
- `gh api repos/Tery-1111/minglemate/actions/secrets --jq '.total_count'` returned **`0`**; no secret names were returned.
- The workflow is manual-only, and its own guard would fail without the secret.

Therefore the absence of an artifact is not ambiguous: the workflow has not run, and it could not run successfully because the required secret is not configured.

**Other repository references to backup/restore:**

- `docs/MINGLEMATE_CURRENT_STATE_INVESTIGATION.md:102` (workflow manual-only), `:266` (F-77 workflow facts), `:382` (backup diagram).
- `docs/MINGLEMATE_PRD_COMPLIANCE_MATRIX.md:294` (OPS-01), `:296` (OPS-03).
- `docs/MINGLEMATE_PRIORITIZED_GAP_REGISTER.md:112-124` (G-04 evidence/resolution), `:555-566` (WP-02 backup/restore).
- `docs/docs-reconciliation-2026-10-14.md:212` mentions “repaired restore semantics,” not a backup procedure.
- `scripts/verify-entitlement-clamp.mjs:360` restores grant state in a test; it is not a backup/restore script.
- No executable backup or restore script exists outside the workflow.

The external `C:\Users\oboch\audit-out\plan-production-migration-2026-10-15\RECOVERY-READINESS.md` is outside this repository and was not used as repository evidence.

---

## 8. Restore-test readiness

| Requirement | Status | Evidence |
|---|---|---|
| Docker installed | Yes | `docker --version` → `29.6.1` |
| Docker engine running | Yes | `docker info --format '{{.ServerVersion}}'` → `29.6.1` |
| Supabase CLI installed | Yes | `supabase --version` → `2.116.0` |
| PostgreSQL 17 image available | Yes | `public.ecr.aws/supabase/postgres:17.6.1.166` in `docker images` |
| Ports 54321–54324 free | Yes | `Get-NetTCPConnection` returned `NONE LISTENING` |
| `psql` on host | **No** | `Get-Command psql` returned nothing |
| `pg_dump` on host | **No** | `Get-Command pg_dump` returned nothing |
| Local stack currently running | **No** | No listener on 54321–54324; no local stack was started |
| `supabase/seed.sql` present | **No** | `Test-Path .\supabase\seed.sql` → false |
| Preconditions wired into active config | **No** | `config.toml:65-70` points to `./seed.sql`; `preconditions.sql` is in `.temp` and untracked |
| Schema rebuild self-contained | **No** | `section2_responses`, `engagement_metrics` and `payments` have no `create table` in migrations or preconditions, so a fresh migration-only rebuild is not equivalent to production |
| Restore target isolated | **Not prepared** | No throwaway database/container was created; no restore was attempted |
| Restore proof exists | **No** | No data-bearing dump or restore transcript exists in the repository |

The machine can probably start a local Supabase stack (Docker, CLI, images and free ports are present), but that was **not** executed because it would create local containers and state. A standalone throwaway PostgreSQL container is also possible from the cached Supabase image. Neither is a proven restore target until a dump is actually restored and row counts match.

---

## 9. Safety state

### Git

`git status --short`:

```text
 M DEPLOYMENT-CHECKLIST.md
 M scripts/check-schema-chain.mjs
 M src/pages/Chat.jsx
 M src/pages/Faq.jsx
 M src/pages/HowItWorks.jsx
 M src/pages/Signup.jsx
 M supabase/.temp/cli-latest
 M supabase/functions/match-generator/index.ts
 M supabase/migrations/20261014150000_consolidated_schema_chain.sql
 M supabase/sql/inspect_state.sql
?? docs/MINGLEMATE_CURRENT_STATE_INVESTIGATION.md
?? docs/MINGLEMATE_PRD_COMPLIANCE_MATRIX.md
?? docs/MINGLEMATE_PRIORITIZED_GAP_REGISTER.md
?? scripts/verify-matching-eligibility.mjs
?? scripts/verify-rls-closure.mjs
?? scripts/verify-weekly-generation-safety.mjs
?? supabase/functions/_shared/matchingEligibility.ts
?? supabase/migrations/20261015120000_rls_closure_precondition_tables.sql
?? supabase/migrations/20261015160000_photos_unique_per_user_and_type.sql
?? supabase/migrations/20261019190000_retire_generate_tuesday_matches.sql
```

- Branch: `fix/review-2026-10-15`
- HEAD: `dfad576 Fix signup upsert under column grants, add notifications_enabled grant, fix clamp script cleanup`
- The only tracked migration is `20261014150000_consolidated_schema_chain.sql`; it is modified. The three later migrations are untracked.
- The deployed database cannot be proven to match this working tree from the repository alone. **UNKNOWN — needs a database read or a schema comparison.**

### Backup destination

- No `.\backups` directory exists.
- No `*.sql.gz` file exists anywhere in the repository.
- The existing workflow’s `backups/` directory is created only inside the ephemeral GitHub Actions runner (`weekly-db-backup.yml:47`).
- No destination path is defined for a manual backup. There is consequently **no current file that a backup would overwrite**, but Will must choose a destination and use a new timestamped filename rather than an existing path.

### No state changed

This investigation performed only PowerShell reads, Git reads, Docker metadata/version reads, `gh` read-only API calls, and filesystem listing. It did not connect to the database, dump, restore, deploy, invoke any Edge Function, write any database row, change any policy, or start any container. It created exactly this one report file.

---

## 10. Minimum path to READY

The following are prerequisites, not authorizations:

1. Will supplies the production session-pooler connection string through a secure channel and chooses whether to store it as the GitHub Actions secret or use it only in the local shell.
2. Use the explicit production reference `mhdjnhiqahsllbczbzpk` or an explicit `--db-url`; do not use `--linked` while the CLI points at staging.
3. Choose and verify a PostgreSQL 17 dump client (native install, Docker image, or Supabase CLI), then confirm its `pg_dump --version` is 17.x.
4. Choose destination, format, scope, retention and encryption.
5. Choose a restore target and prove a restore with matching row counts before treating the dump as a backup.
6. Decide how storage objects, Auth configuration, Edge Function secrets/versions, Vault secret and roles/ACLs will be backed up alongside the database.
