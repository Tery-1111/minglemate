#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Stage 4 — parity alignment verification.
//
//   node scripts/verify-matching-parity-alignment.mjs
//
// Proves that the migration 20261120120000_match_publication_activity_protection
// brings a chain-built database to the behaviour verified in production:
// generation fencing, activity protection, delivery visibility, validation,
// security configuration and permissions (T01–T18).
//
// Runs against a DISPOSABLE database inside the local Supabase Postgres
// container. It never touches production, never resets an existing database and
// drops only the scratch database it created.
//
// Requirements: docker with the local `supabase_db_*` container running.
//
//   DB_CONTAINER   override the container name (default: first supabase_db_*)
//   SCRATCH_DB     override the scratch database name
// ---------------------------------------------------------------------------

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATION_FENCING = join(here, '..', 'supabase', 'migrations', '20261118120000_match_generation_fencing.sql')
const MIGRATION_PT409 = join(here, '..', 'supabase', 'migrations', '20261119120000_match_publication_pt409.sql')
const MIGRATION_NEW = join(here, '..', 'supabase', 'migrations', '20261120120000_match_publication_activity_protection.sql')

const SCRATCH = process.env.SCRATCH_DB || 'minglemate_parity_scratch'

function sh(cmd, args, input) {
  const res = spawnSync(cmd, args, { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (res.error) throw new Error(`${cmd} failed to start: ${res.error.message}`)
  return { code: res.status, out: res.stdout ?? '', err: res.stderr ?? '' }
}

function findContainer() {
  if (process.env.DB_CONTAINER) return process.env.DB_CONTAINER
  const res = sh('docker', ['ps', '--format', '{{.Names}}'])
  if (res.code !== 0) throw new Error(`docker ps failed: ${res.err.trim()}`)
  const match = res.out.split('\n').map((s) => s.trim()).find((n) => n.startsWith('supabase_db_'))
  if (!match) throw new Error('no running supabase_db_* container found — start the local stack first')
  return match
}

const container = findContainer()

/** Run SQL against a database in the container. `-f -` keeps it one session. */
function psql(sql, { db = SCRATCH, stopOnError = true, tuplesOnly = false } = {}) {
  const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-X', '-q', '-f', '-']
  if (stopOnError) args.push('-v', 'ON_ERROR_STOP=1')
  if (tuplesOnly) args.push('-t', '-A')
  return sh('docker', args, sql)
}

function ok(label, detail = '') {
  console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
}

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    ok(label, detail)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// ---------------------------------------------------------------------------
// Scratch database
// ---------------------------------------------------------------------------
console.log(`container: ${container}`)
console.log(`scratch database: ${SCRATCH}`)

let res = psql(`drop database if exists ${SCRATCH};`, { db: 'postgres' })
if (res.code !== 0) throw new Error(`could not drop a previous scratch database: ${res.err.trim()}`)
res = psql(`create database ${SCRATCH};`, { db: 'postgres' })
if (res.code !== 0) throw new Error(`could not create the scratch database: ${res.err.trim()}`)

// ---------------------------------------------------------------------------
// Prerequisites: the state a chain-built database is in BEFORE this migration.
// Roles, the auth stub, users, and match_history exactly as the consolidated
// chain creates it (20261014150000:891-914) — including the OLD policy, so the
// migration is tested as a reconciliation of an existing object, not a fresh
// create.
// ---------------------------------------------------------------------------
const prereqs = `
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- A real Supabase database starts with these default privileges, so every
-- migration-created object is born broadly granted. Reproduced here so the
-- migration under test has to earn its revokes instead of inheriting them.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable
  as $fn$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $fn$;

create table public.users (id uuid primary key);
grant select on public.users to authenticated;

create table if not exists public.match_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  week_id text,
  tier1_match_id uuid,
  tier2_match_id uuid,
  delivered_at timestamptz
);

alter table public.match_history add column if not exists delivered_at timestamptz;

create unique index if not exists match_history_user_week_uidx
  on public.match_history (user_id, week_id);

alter table public.match_history enable row level security;

drop policy if exists "match_history_select_own" on public.match_history;
create policy "match_history_select_own"
  on public.match_history for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.match_history from anon;
revoke insert, update, delete on public.match_history from authenticated;
`

res = psql(prereqs)
if (res.code !== 0) throw new Error(`prerequisites failed:\n${res.err}`)

// Historical migrations, in order — the accepted chain this migration extends.
for (const [label, path] of [
  ['20261118120000_match_generation_fencing', MIGRATION_FENCING],
  ['20261119120000_match_publication_pt409', MIGRATION_PT409],
]) {
  const out = psql(readFileSync(path, 'utf8'))
  if (out.code !== 0) throw new Error(`applying ${label} failed:\n${out.err}`)
  ok(`applied baseline migration ${label}`)
}

// ---------------------------------------------------------------------------
// The migration under test
// ---------------------------------------------------------------------------
const migration = readFileSync(MIGRATION_NEW, 'utf8')
// Applied as one transaction, as a migration runner does: a refusal anywhere in
// the file leaves the database exactly as it was.
const migrationTx = `begin;\n${migration}\ncommit;`
const applied = psql(migrationTx)
if (applied.code !== 0) {
  console.error('\nmigration failed to apply:')
  console.error(applied.err.trim())
  process.exit(1)
}
for (const line of applied.err.split('\n')) {
  if (line.includes('NOTICE')) console.log(`  note ${line.replace(/^.*NOTICE:\s*/, '').trim()}`)
}
ok('applied 20261120120000_match_publication_activity_protection')

const second = psql(migrationTx)
check('migration is idempotent (applies twice without error)', second.code === 0, second.code === 0 ? '' : second.err.trim())
// ---------------------------------------------------------------------------
// T01–T13, T17, T18 plus the schema/security assertions, in one session.
// Everything is recorded in public.parity_results so a failure is visible with
// its observed value rather than a bare exit code.
// ---------------------------------------------------------------------------
const assertions = `
create table public.parity_results (
  id text primary key,
  expected text,
  actual text,
  ok boolean
);

create or replace function public.rec(p_id text, p_expected text, p_actual text, p_ok boolean)
returns void language sql as $f$
  insert into public.parity_results (id, expected, actual, ok)
  values (p_id, p_expected, p_actual, coalesce(p_ok, false))
  on conflict (id) do update set expected = excluded.expected, actual = excluded.actual, ok = excluded.ok;
$f$;

-- Calls the publisher and renders the outcome as one comparable string.
create or replace function public.try_publish(p_week text, p_gen bigint, p_rows jsonb)
returns text language plpgsql as $f$
declare r jsonb;
begin
  r := public.publish_week_allocation(p_week, p_gen, p_rows);
  return 'ok:' || r::text;
exception when others then
  return sqlstate || ':' || sqlerrm;
end $f$;

-- Two participants per payload; passenger/partner ids come from the pair list.
create or replace function public.payload(p_pairs jsonb, p_delivered text default '2026-11-19T18:00:00.000Z')
returns jsonb language sql immutable as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', p->>'u',
           'week_id', 'client-supplied-value-is-ignored',
           'tier1_match_id', p->>'m',
           'tier2_match_id', null,
           'delivered_at', p_delivered)), '[]'::jsonb)
    from jsonb_array_elements(p_pairs) as p;
$f$;

insert into public.users (id) values
  ('00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000004')
on conflict do nothing;

-- T01 — normal publication ------------------------------------------------
do $$
declare g bigint; res text; n int; weeks int; stamps int;
begin
  g := public.begin_match_generation('2099-W01');
  res := public.try_publish('2099-W01', g, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000001","m":"00000000-0000-4000-8000-000000000002"},
      {"u":"00000000-0000-4000-8000-000000000002","m":"00000000-0000-4000-8000-000000000001"}]'));
  select count(*) into n from public.match_history where week_id = '2099-W01';
  select count(*) into weeks from public.match_history where week_id = '2099-W01' and user_id is not null;
  select count(*) into stamps from public.match_history where week_id = '2099-W01' and delivered_at is not null;
  perform public.rec('T01', 'ok, 2 rows with week_id and delivered_at',
    res || ', ' || n || ' rows, stamps ' || stamps,
    res like 'ok%' and n = 2 and weeks = 2 and stamps = 2);
end $$;

-- T02 — identical replay writes nothing ------------------------------------
do $$
declare g bigint; res text; before_ids text; after_ids text; rows_before int; rows_after int;
begin
  select latest_generation into g from public.match_week_generations where week_id = '2099-W01';
  select string_agg(id::text, ',' order by id), count(*) into before_ids, rows_before
    from public.match_history where week_id = '2099-W01';
  res := public.try_publish('2099-W01', g, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000001","m":"00000000-0000-4000-8000-000000000002"},
      {"u":"00000000-0000-4000-8000-000000000002","m":"00000000-0000-4000-8000-000000000001"}]'));
  select string_agg(id::text, ',' order by id), count(*) into after_ids, rows_after
    from public.match_history where week_id = '2099-W01';
  perform public.rec('T02', 'ok with replayed true and unchanged row ids',
    res || ' ids-unchanged=' || (before_ids = after_ids)::text,
    res like 'ok%' and res like '%"replayed": true%' and before_ids = after_ids and rows_after = rows_before);
end $$;

-- T03 — different payload under the same generation ------------------------
do $$
declare g bigint; res text;
begin
  select latest_generation into g from public.match_week_generations where week_id = '2099-W01';
  res := public.try_publish('2099-W01', g, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000001","m":"00000000-0000-4000-8000-000000000003"},
      {"u":"00000000-0000-4000-8000-000000000003","m":"00000000-0000-4000-8000-000000000001"}]'));
  perform public.rec('T03', 'PT409:generation_conflict', res, res = 'PT409:generation_conflict');
end $$;

-- T04 — older generation ---------------------------------------------------
do $$
declare g1 bigint; g2 bigint; res text;
begin
  g1 := public.begin_match_generation('2099-W04');
  g2 := public.begin_match_generation('2099-W04');
  res := public.try_publish('2099-W04', g2, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000001","m":"00000000-0000-4000-8000-000000000002"}]'));
  if res not like 'ok%' then
    perform public.rec('T04', 'newest publishes, older is stale', 'setup failed: ' || res, false);
    return;
  end if;
  res := public.try_publish('2099-W04', g1, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000003","m":"00000000-0000-4000-8000-000000000004"}]'));
  perform public.rec('T04', 'PT409:stale_generation', res, res = 'PT409:stale_generation');
end $$;

-- T05 — generation that was never authorised -------------------------------
do $$
declare g bigint; res text;
begin
  select latest_generation into g from public.match_week_generations where week_id = '2099-W04';
  res := public.try_publish('2099-W04', g + 5, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000001","m":"00000000-0000-4000-8000-000000000002"}]'));
  perform public.rec('T05', '22023:invalid_generation', res, res = '22023:invalid_generation');
end $$;

-- T06 — activity in match_signals -----------------------------------------
do $$
declare g1 bigint; g2 bigint; res text; n int;
begin
  g1 := public.begin_match_generation('2099-W06');
  res := public.try_publish('2099-W06', g1, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000001","m":"00000000-0000-4000-8000-000000000002"},
      {"u":"00000000-0000-4000-8000-000000000002","m":"00000000-0000-4000-8000-000000000001"}]'));
  if res not like 'ok%' then
    perform public.rec('T06', 'PT409:week_in_use', 'setup failed: ' || res, false);
    return;
  end if;
  insert into public.match_signals (match_history_id, sender_id, receiver_id)
  select mh.id, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'
    from public.match_history mh where mh.week_id = '2099-W06' limit 1;
  g2 := public.begin_match_generation('2099-W06');
  res := public.try_publish('2099-W06', g2, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000003","m":"00000000-0000-4000-8000-000000000004"}]'));
  select count(*) into n from public.match_history where week_id = '2099-W06';
  perform public.rec('T06', 'PT409:week_in_use, allocation preserved', res || ', ' || n || ' rows kept',
    res = 'PT409:week_in_use' and n = 2);
end $$;

-- T07 — activity in match_behavior ----------------------------------------
do $$
declare g1 bigint; g2 bigint; res text; n int;
begin
  g1 := public.begin_match_generation('2099-W07');
  res := public.try_publish('2099-W07', g1, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000001","m":"00000000-0000-4000-8000-000000000002"},
      {"u":"00000000-0000-4000-8000-000000000002","m":"00000000-0000-4000-8000-000000000001"}]'));
  if res not like 'ok%' then
    perform public.rec('T07', 'PT409:week_in_use', 'setup failed: ' || res, false);
    return;
  end if;
  insert into public.match_behavior (match_history_id, user_id, action)
  select mh.id, '00000000-0000-4000-8000-000000000001', 'viewed'
    from public.match_history mh where mh.week_id = '2099-W07' limit 1;
  g2 := public.begin_match_generation('2099-W07');
  res := public.try_publish('2099-W07', g2, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000003","m":"00000000-0000-4000-8000-000000000004"}]'));
  select count(*) into n from public.match_history where week_id = '2099-W07';
  perform public.rec('T07', 'PT409:week_in_use, allocation preserved', res || ', ' || n || ' rows kept',
    res = 'PT409:week_in_use' and n = 2);
end $$;

-- T08 — tier1_interaction flag --------------------------------------------
do $$
declare g1 bigint; g2 bigint; res text;
begin
  g1 := public.begin_match_generation('2099-W08');
  res := public.try_publish('2099-W08', g1, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000001","m":"00000000-0000-4000-8000-000000000002"},
      {"u":"00000000-0000-4000-8000-000000000002","m":"00000000-0000-4000-8000-000000000001"}]'));
  if res not like 'ok%' then
    perform public.rec('T08', 'PT409:week_in_use', 'setup failed: ' || res, false);
    return;
  end if;
  update public.match_history set tier1_interaction = true where week_id = '2099-W08';
  g2 := public.begin_match_generation('2099-W08');
  res := public.try_publish('2099-W08', g2, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000003","m":"00000000-0000-4000-8000-000000000004"}]'));
  perform public.rec('T08', 'PT409:week_in_use', res, res = 'PT409:week_in_use');
end $$;

-- T09 — tier2_interaction flag --------------------------------------------
do $$
declare g1 bigint; g2 bigint; res text;
begin
  g1 := public.begin_match_generation('2099-W09');
  res := public.try_publish('2099-W09', g1, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000001","m":"00000000-0000-4000-8000-000000000002"},
      {"u":"00000000-0000-4000-8000-000000000002","m":"00000000-0000-4000-8000-000000000001"}]'));
  if res not like 'ok%' then
    perform public.rec('T09', 'PT409:week_in_use', 'setup failed: ' || res, false);
    return;
  end if;
  update public.match_history set tier2_interaction = true where week_id = '2099-W09';
  g2 := public.begin_match_generation('2099-W09');
  res := public.try_publish('2099-W09', g2, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000003","m":"00000000-0000-4000-8000-000000000004"}]'));
  perform public.rec('T09', 'PT409:week_in_use', res, res = 'PT409:week_in_use');
end $$;

-- T10 — invalid user_id ----------------------------------------------------
do $$
declare g bigint; missing text; invalid text; n int;
begin
  g := public.begin_match_generation('2099-W10');
  missing := public.try_publish('2099-W10', g, '[{"week_id":"2099-W10","delivered_at":"2026-11-19T18:00:00.000Z"}]'::jsonb);
  invalid := public.try_publish('2099-W10', g, '[{"user_id":"not-a-uuid","delivered_at":"2026-11-19T18:00:00.000Z"}]'::jsonb);
  select count(*) into n from public.match_history where week_id = '2099-W10';
  perform public.rec('T10', '22023 for a missing and for an invalid user_id, nothing written',
    missing || ' / ' || invalid || ', ' || n || ' rows',
    missing = '22023:publish_week_allocation: every row needs a user_id'
    and invalid = '22023:publish_week_allocation: a row has a user_id that is not a uuid'
    and n = 0);
end $$;

-- T11 — invalid delivered_at ----------------------------------------------
do $$
declare g bigint; missing text; invalid text; n int;
begin
  g := public.begin_match_generation('2099-W11');
  missing := public.try_publish('2099-W11', g, '[{"user_id":"00000000-0000-4000-8000-000000000001"}]'::jsonb);
  invalid := public.try_publish('2099-W11', g,
    '[{"user_id":"00000000-0000-4000-8000-000000000001","delivered_at":"not-a-timestamp"}]'::jsonb);
  select count(*) into n from public.match_history where week_id = '2099-W11';
  perform public.rec('T11', '22023 for a missing and for an invalid delivered_at, nothing written',
    missing || ' / ' || invalid || ', ' || n || ' rows',
    missing = '22023:publish_week_allocation: every row needs a delivered_at'
    and invalid = '22023:publish_week_allocation: a row has a delivered_at that is not a timestamp'
    and n = 0);
end $$;

-- T12 — a failed publication replaces nothing -----------------------------
do $$
declare g1 bigint; g2 bigint; res text; before_ids text; after_ids text; fence bigint;
begin
  g1 := public.begin_match_generation('2099-W12');
  res := public.try_publish('2099-W12', g1, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000001","m":"00000000-0000-4000-8000-000000000002"},
      {"u":"00000000-0000-4000-8000-000000000002","m":"00000000-0000-4000-8000-000000000001"}]'));
  if res not like 'ok%' then
    perform public.rec('T12', 'partial replacement impossible', 'setup failed: ' || res, false);
    return;
  end if;
  select string_agg(id::text, ',' order by id) into before_ids from public.match_history where week_id = '2099-W12';
  g2 := public.begin_match_generation('2099-W12');
  res := public.try_publish('2099-W12', g2, '[{"user_id":"","delivered_at":""}]'::jsonb);
  select string_agg(id::text, ',' order by id) into after_ids from public.match_history where week_id = '2099-W12';
  select latest_published_generation into fence from public.match_week_generations where week_id = '2099-W12';
  perform public.rec('T12', 'validation refusal, allocation and fence untouched',
    res || ', ids-unchanged=' || (before_ids = after_ids)::text || ', published_generation=' || fence,
    res like '22023:%' and before_ids = after_ids and fence = g1);
end $$;

-- T13 — another week is never touched -------------------------------------
do $$
declare gA bigint; gB bigint; resA text; resB text; idsA_before text; idsA_after text;
begin
  gA := public.begin_match_generation('2099-W13A');
  resA := public.try_publish('2099-W13A', gA, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000001","m":"00000000-0000-4000-8000-000000000002"},
      {"u":"00000000-0000-4000-8000-000000000002","m":"00000000-0000-4000-8000-000000000001"}]'));
  select string_agg(id::text, ',' order by id) into idsA_before from public.match_history where week_id = '2099-W13A';
  gB := public.begin_match_generation('2099-W13B');
  resB := public.try_publish('2099-W13B', gB, public.payload(
    '[{"u":"00000000-0000-4000-8000-000000000003","m":"00000000-0000-4000-8000-000000000004"},
      {"u":"00000000-0000-4000-8000-000000000004","m":"00000000-0000-4000-8000-000000000003"}]'));
  select string_agg(id::text, ',' order by id) into idsA_after from public.match_history where week_id = '2099-W13A';
  perform public.rec('T13', 'both weeks publish, the first is untouched',
    resA || ' / ' || resB || ', unchanged=' || (idsA_before = idsA_after)::text,
    resA like 'ok%' and resB like 'ok%' and idsA_before = idsA_after);
end $$;

-- T23 — an empty allocation is a valid publication ----------------------
do $$
declare g bigint; res text; n int; published bigint;
begin
  g := public.begin_match_generation('2099-W23');
  res := public.try_publish('2099-W23', g, '[]'::jsonb);
  select count(*) into n from public.match_history where week_id = '2099-W23';
  select latest_published_generation into published from public.match_week_generations where week_id = '2099-W23';
  perform public.rec('T23', 'ok, 0 rows, fence records the publication',
    res || ', ' || n || ' rows, published_generation=' || coalesce(published::text, '<null>'),
    res like 'ok%' and res like '%"published": 0%' and n = 0 and published = g);
end $$;

-- Publication fixture for the visibility tests (T14–T16) -------------------
insert into public.match_history (user_id, week_id, tier1_match_id, delivered_at) values
  ('00000000-0000-4000-8000-000000000001', '2099-W14', '00000000-0000-4000-8000-000000000002', now() + interval '1 day'),
  ('00000000-0000-4000-8000-000000000001', '2099-W15', '00000000-0000-4000-8000-000000000002', now() - interval '1 hour');

create table public.rls_probe (id text primary key, n integer);
grant insert on public.rls_probe to authenticated;

set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
set role authenticated;
insert into public.rls_probe (id, n) select 'T14', count(*) from public.match_history where week_id = '2099-W14';
insert into public.rls_probe (id, n) select 'T15', count(*) from public.match_history where week_id = '2099-W15';
reset role;

set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
set role authenticated;
insert into public.rls_probe (id, n) select 'T16', count(*) from public.match_history where week_id = '2099-W15';
reset role;

insert into public.parity_results (id, expected, actual, ok)
select 'T14', '0 rows (delivered_at in the future)', n || ' rows', n = 0 from public.rls_probe where id = 'T14';
insert into public.parity_results (id, expected, actual, ok)
select 'T15', '1 row (released, owned)', n || ' rows', n = 1 from public.rls_probe where id = 'T15';
insert into public.parity_results (id, expected, actual, ok)
select 'T16', '0 rows (owned by someone else)', n || ' rows', n = 0 from public.rls_probe where id = 'T16';

-- T17 — execution permissions and function definitions --------------------
do $$
declare
  exec_service boolean; exec_auth boolean; exec_anon boolean;
  definer int; config text; owner_name text; bad_owner int; missing_config int;
begin
  select has_function_privilege('service_role', 'public.publish_week_allocation(text,bigint,jsonb)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.begin_match_generation(text)', 'EXECUTE')
    into exec_service;
  select has_function_privilege('authenticated', 'public.publish_week_allocation(text,bigint,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.begin_match_generation(text)', 'EXECUTE')
    into exec_auth;
  select has_function_privilege('anon', 'public.publish_week_allocation(text,bigint,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.begin_match_generation(text)', 'EXECUTE')
    into exec_anon;

  select count(*) into definer from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('publish_week_allocation','begin_match_generation')
     and p.prosecdef;

  select count(*) into missing_config from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('publish_week_allocation','begin_match_generation')
     and (p.proconfig is null or not ('search_path=""' = any (p.proconfig)));

  select string_agg(p.proname || ':' || coalesce(p.proconfig::text, '<null>'), ' | ')
    into config
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('publish_week_allocation','begin_match_generation');

  select count(*) into bad_owner from pg_proc p
    join pg_roles r on r.oid = p.proowner
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('publish_week_allocation','begin_match_generation')
     and r.rolname <> 'postgres';

  perform public.rec('T17', 'service_role only, definer, empty search_path, owner postgres',
    'service=' || exec_service::text || ' authenticated=' || exec_auth::text || ' anon=' || exec_anon::text
      || ' definer_functions=' || definer::text || ' wrong_search_path=' || missing_config::text
      || ' wrong_owner=' || bad_owner::text || ' config=' || coalesce(config::text, '<none>'),
    exec_service and not exec_auth and not exec_anon and definer = 2 and missing_config = 0 and bad_owner = 0);
end $$;

-- T18 — sequence permissions ----------------------------------------------
do $$
declare usage_ok boolean; select_ok boolean; update_ok boolean; client_denied boolean;
begin
  select has_sequence_privilege('service_role', 'public.match_generation_seq', 'USAGE') into usage_ok;
  select has_sequence_privilege('service_role', 'public.match_generation_seq', 'SELECT') into select_ok;
  select has_sequence_privilege('service_role', 'public.match_generation_seq', 'UPDATE') into update_ok;
  select not has_sequence_privilege('authenticated', 'public.match_generation_seq', 'USAGE')
     and not has_sequence_privilege('anon', 'public.match_generation_seq', 'USAGE')
    into client_denied;
  perform public.rec('T18', 'service_role has USAGE/SELECT/UPDATE, client roles none',
    'usage=' || usage_ok::text || ' select=' || select_ok::text || ' update=' || update_ok::text
      || ' clients_denied=' || client_denied::text,
    usage_ok and select_ok and update_ok and client_denied);
end $$;

-- Schema and security shapes ----------------------------------------------
do $$
declare
  wk_not_null boolean; ds_default text; mh_rls boolean; mh_policies int;
  ms_rls boolean; mb_rls boolean; mb_policies int; ms_policies int;
  cascade_signals text; cascade_behavior text; ms_unique int; ms_policy_ok boolean; mh_policy_ok boolean;
begin
  select a.attnotnull into wk_not_null from pg_attribute a
   where a.attrelid = 'public.match_history'::regclass and a.attname = 'week_id' and not a.attisdropped;
  select pg_get_expr(d.adbin, d.adrelid) into ds_default from pg_attrdef d
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.match_history'::regclass and a.attname = 'delivered_at';

  select relrowsecurity into mh_rls from pg_class where oid = 'public.match_history'::regclass;
  select count(*) into mh_policies from pg_policies where schemaname = 'public' and tablename = 'match_history';
  select relrowsecurity into ms_rls from pg_class where oid = 'public.match_signals'::regclass;
  select relrowsecurity into mb_rls from pg_class where oid = 'public.match_behavior'::regclass;
  select count(*) into ms_policies from pg_policies where schemaname = 'public' and tablename = 'match_signals';
  select count(*) into mb_policies from pg_policies where schemaname = 'public' and tablename = 'match_behavior';

  select confdeltype into cascade_signals from pg_constraint
   where conrelid = 'public.match_signals'::regclass and contype = 'f'
     and confrelid = 'public.match_history'::regclass;
  select confdeltype into cascade_behavior from pg_constraint
   where conrelid = 'public.match_behavior'::regclass and contype = 'f'
     and confrelid = 'public.match_history'::regclass;

  select count(*) into ms_unique from pg_constraint
   where conrelid = 'public.match_signals'::regclass and contype = 'u'
     and pg_get_constraintdef(oid) = 'UNIQUE (match_history_id, sender_id)';

  select bool_and(pg_get_expr(polqual, polrelid) like '%auth.uid() = user_id%'
                  and pg_get_expr(polqual, polrelid) like '%delivered_at <= now()%')
    into mh_policy_ok from pg_policy where polrelid = 'public.match_history'::regclass;
  select bool_and(pg_get_expr(polqual, polrelid) like '%sender_id%'
                  and pg_get_expr(polqual, polrelid) like '%receiver_id%')
    into ms_policy_ok from pg_policy where polrelid = 'public.match_signals'::regclass;

  perform public.rec('T19', 'match_history aligned (NOT NULL week_id, now() default, delivery-gated policy)',
    'not_null=' || wk_not_null::text || ' default=' || coalesce(ds_default, '<none>')
      || ' policies=' || mh_policies::text || ' gate=' || coalesce(mh_policy_ok::text, 'false'),
    wk_not_null and ds_default like 'now()%' and mh_rls and mh_policies = 1 and coalesce(mh_policy_ok, false));

  perform public.rec('T20', 'activity tables with production delete rules and RLS state',
    'signals cascade=' || coalesce(cascade_signals, '<none>') || ' unique=' || ms_unique::text
      || ' signals_policies=' || ms_policies::text || ' signals_policy_ok=' || coalesce(ms_policy_ok::text, 'false')
      || ' behavior cascade=' || coalesce(cascade_behavior, '<none>') || ' behavior_policies=' || mb_policies::text
      || ' both_rls=' || (ms_rls and mb_rls)::text,
    cascade_signals = 'c' and cascade_behavior = 'a' and ms_unique = 1 and ms_rls and mb_rls
      and ms_policies = 1 and coalesce(ms_policy_ok, false) and mb_policies = 0);
end $$;
`

const run = psql(assertions)
if (run.code !== 0) {
  console.error('\nassertions failed to run:')
  console.error(run.err.trim())
  process.exit(1)
}

const table = psql('select id, ok, expected, actual from public.parity_results order by id;', { tuplesOnly: true })
if (table.code !== 0) {
  console.error('\ncould not read results:')
  console.error(table.err.trim())
  process.exit(1)
}

console.log('\nresults')
for (const line of table.out.split('\n').map((l) => l.trim()).filter(Boolean)) {
  const [id, isOk, expected, actual] = line.split('|')
  if (isOk === 't') {
    ok(`${id} — ${expected}`)
  } else {
    failures++
    console.log(`  FAIL ${id} — expected ${expected}; got ${actual}`)
  }
}

// ---------------------------------------------------------------------------
// T21/T22 — a partially existing incompatible object must stop the migration.
//
// A broad `if not exists` would let a half-built table pass as the production
// one and fail much later, at publication time, with an opaque error. Each case
// runs in its own disposable database because a refused migration is expected
// to leave the database untouched anyway.
// ---------------------------------------------------------------------------
function failLoudlyCase(dbName, setupSql, expectedPattern, probeTable, description) {
  psql(`drop database if exists ${dbName};`, { db: 'postgres' })
  const created = psql(`create database ${dbName};`, { db: 'postgres' })
  if (created.code !== 0) throw new Error(`could not create ${dbName}: ${created.err.trim()}`)

  for (const [label, sql] of [
    ['prerequisites', prereqs],
    ['20261118120000_match_generation_fencing', readFileSync(MIGRATION_FENCING, 'utf8')],
    ['20261119120000_match_publication_pt409', readFileSync(MIGRATION_PT409, 'utf8')],
    ['incompatible object', setupSql],
  ]) {
    const out = psql(sql, { db: dbName })
    if (out.code !== 0) throw new Error(`${dbName}: ${label} failed:\n${out.err.trim()}`)
  }

  const refused = psql(migrationTx, { db: dbName })
  const message = refused.err.trim().split('\n').filter((l) => l.includes('ERROR')).join(' ')
  check(description, refused.code !== 0 && expectedPattern.test(message), message || 'the migration was accepted')

  const leftover = psql(
    `select coalesce(to_regclass('public.${probeTable}')::text, '<absent>');`,
    { db: dbName, tuplesOnly: true },
  )
  const afterState = leftover.out.trim()
  check(`${description} — nothing was created after the refusal`, afterState === '<absent>', afterState)

  psql(`drop database if exists ${dbName};`, { db: 'postgres' })
}

failLoudlyCase(
  `${SCRATCH}_neg1`,
  `create table public.match_signals (
     id uuid primary key default gen_random_uuid(),
     match_history_id uuid references public.match_history(id) on delete cascade,
     sender_id uuid references public.users(id) on delete cascade,
     receiver_id uuid references public.users(id) on delete cascade
   );`,
  /match_signals exists but is incompatible: missing .*unlocked_at/,
  'match_behavior',
  'T21 an incomplete match_signals stops the migration',
)

failLoudlyCase(
  `${SCRATCH}_neg2`,
  `create table public.match_behavior (
     id uuid primary key default gen_random_uuid(),
     match_history_id uuid references public.match_history(id) on delete cascade,
     user_id uuid references public.users(id),
     action text not null,
     created_at timestamptz default now(),
     action_timestamp timestamptz default now()
   );`,
  /match_behavior exists but its match_history foreign key cascades/,
  'match_signals',
  'T22 a cascading match_behavior stops the migration',
)

// Clean up only the scratch database this run created.
const drop = psql(`drop database if exists ${SCRATCH};`, { db: 'postgres' })
if (drop.code !== 0) console.log(`  note could not drop ${SCRATCH}: ${drop.err.trim()}`)

console.log('==================================')
console.log(failures === 0 ? 'parity alignment: all checks passed' : `parity alignment: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
