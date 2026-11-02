// Disposable-database scenario tests for scripts/preflight-section1-migration.mjs
//
//   SECTION1_PREFLIGHT_TEST_ADMIN_URL="postgres://postgres:<pw>@127.0.0.1:<port>/postgres" \
//     node scripts/test-preflight-section1.mjs
//
// This script needs a THROWAWAY local PostgreSQL server (a disposable cluster),
// never production or hosted staging. It creates one database per scenario,
// seeds a production-shaped fixture, runs the preflight as a child process, and
// asserts the exit code, the decision category and that the database is byte-
// for-byte unchanged afterwards. Databases are dropped as it goes; the roles it
// creates (anon, authenticated, service_role, preflight_limited) stay on the
// throwaway cluster.
//
// What it proves:
//   * the six required scenarios: expected legacy start, text[] without a
//     marker, marker/schema disagreement, a partially present object set,
//     missing authority, and a failed connection
//   * a genuinely migrated database (the real migration applied, then rolled up
//     as text[] + marker + bank + functions + triggers + policies) is classified
//     STOP_ALREADY_MIGRATED rather than safe to cut over
//   * a foreign key with ON DELETE CASCADE and a view over responses_array are
//     caught before the destructive run
//   * target-identity refusals happen before any connection is opened
//   * a marker table with the expected column names but nullable counts and a
//     NULL marker row is a stop, not a completed migration (both the marker
//     structure — type + nullability — and the recorded counts must be exact)
//   * FORCE ROW LEVEL SECURITY with an executing role that cannot bypass RLS
//     stops the preflight instead of leaving the initial state acceptable
//   * no report contains the connection string, its password, a user id or an
//     email, and the database is unchanged after every run

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { section1Questions } from '../src/data/section1Questions.js'

const ADMIN_URL = process.env.SECTION1_PREFLIGHT_TEST_ADMIN_URL
if (!ADMIN_URL) {
  console.error('Set SECTION1_PREFLIGHT_TEST_ADMIN_URL to a disposable local PostgreSQL connection string.')
  process.exit(2)
}
if (/mhdjnhiqahsllbczbzpk/.test(ADMIN_URL)) {
  console.error('REFUSING: that is the production project.')
  process.exit(2)
}
if (!/^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(ADMIN_URL)) {
  console.error('REFUSING: the disposable test harness only accepts a loopback PostgreSQL URL.')
  process.exit(2)
}

const EXPECTED_REF = 'mhdjnhiqahsllbczbzpk'
const REQUIRED_SENTENCE =
  'READ-ONLY PREFLIGHT ONLY \u2014 MIGRATION NOT EXECUTED. OWNER AUTHORIZATION STILL REQUIRED.'
const PASSWORD = new URL(ADMIN_URL).password
// The report legitimately names the database, the executing role and the table
// owners. A short or dictionary password ("postgres" is all three here) is then
// indistinguishable from ordinary output, so the strict "the password never
// appears" assertion below would fail for the wrong reason. Require a fixture
// password that cannot collide with an identifier.
if (PASSWORD.length < 12) {
  console.error(
    'REFUSING: SECTION1_PREFLIGHT_TEST_ADMIN_URL needs a password of at least 12 characters.\n' +
    'The disposable fixture must use a unique password so that "the password never appears in the report"\n' +
    'can be asserted without colliding with the database name, the executing role or a table owner.'
  )
  process.exit(2)
}
const repoRoot = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const migration = readFileSync(
  new URL('../supabase/sql/production/20261022180000_production_section1_responses.sql', import.meta.url),
  'utf8'
).replace(/\r\n/g, '\n')

const A = 'aaaaaaaa-0000-4000-8000-000000000001'
const B = 'bbbbbbbb-0000-4000-8000-000000000002'
const C = 'cccccccc-0000-4000-8000-000000000003'
const D = 'dddddddd-0000-4000-8000-000000000004'
const LEGACY = [0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0,
  1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0]
const PARTIAL = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]
const TEXT_LEGACY = Array.from({ length: 40 }, (_, index) => `legacy ${index}`)
const TEXT_PARTIAL = Array.from({ length: 10 }, (_, index) => `partial ${index}`)

let checks = 0
function ok(condition, message) {
  assert.ok(condition, message)
  checks += 1
}

function localUrl(database, user = 'postgres') {
  const parsed = new URL(ADMIN_URL)
  parsed.pathname = `/${database}`
  if (user !== 'postgres') {
    parsed.username = user
    parsed.password = 'limited'
  }
  return parsed.toString()
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const USERS_SQL = `
  create schema auth;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  grant usage on schema public, auth to anon, authenticated;

  create table public.users (
    id uuid primary key,
    email text,
    full_name text,
    section1_complete boolean default false,
    section1_progress integer default 0,
    section1_last_edited timestamptz,
    profile_status text default 'active',
    created_at timestamptz default now()
  );

  insert into public.users (id, email, full_name, section1_complete, section1_progress, section1_last_edited) values
    ('${A}', 'a@example.test', 'A', true, 39, '2026-01-02T00:00:00Z'),
    ('${B}', 'b@example.test', 'B', false, 0, null),
    ('${C}', 'c@example.test', 'C', true, 0, '2026-01-03T00:00:00Z'),
    ('${D}', 'd@example.test', 'D', false, 23, '2026-01-04T00:00:00Z');
`

function responsesSql(columnType) {
  return `
    create table public.user_responses (
      user_id uuid primary key references public.users(id) on delete cascade,
      responses_array ${columnType} not null,
      created_at timestamptz default now(),
      updated_at timestamptz default now()
    );
    alter table public.users enable row level security;
    alter table public.user_responses enable row level security;
    create policy users_select_own on public.users for select to authenticated
      using (id = auth.uid());
    create policy "Allow authenticated users to read any response matrix for match"
      on public.user_responses for select to authenticated
      using (auth.role() = 'authenticated');
    create policy "Allow users full operational control over their own response ro"
      on public.user_responses for all to authenticated
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
    grant all on public.users, public.user_responses to anon, authenticated;
  `
}

async function seedLegacy(db, columnType = 'integer[]') {
  await db.unsafe(USERS_SQL)
  await db.unsafe(responsesSql(columnType))
  if (columnType === 'text[]') {
    await db.unsafe(
      'insert into public.user_responses (user_id, responses_array) values ($1, $2::text[]), ($3, $4::text[])',
      [A, TEXT_LEGACY, D, TEXT_PARTIAL]
    )
  } else {
    await db.unsafe(
      'insert into public.user_responses (user_id, responses_array) values ($1, $2::integer[]), ($3, $4::integer[])',
      [A, LEGACY, D, PARTIAL]
    )
  }
}

async function seedMarker(db) {
  await db.unsafe(`
    create table public.section1_legacy_cutover (
      singleton boolean primary key default true,
      executed_at timestamptz not null default now(),
      deleted_response_rows integer not null,
      reset_user_profiles integer not null,
      constraint section1_legacy_cutover_singleton check (singleton)
    );
    alter table public.section1_legacy_cutover enable row level security;
    revoke all on table public.section1_legacy_cutover from public, anon, authenticated;
    insert into public.section1_legacy_cutover (deleted_response_rows, reset_user_profiles) values (2, 4);
  `)
}

async function seedOptionBank(db) {
  await db.unsafe(`
    create table public.section1_question_options (
      question_number integer not null,
      option_text text not null,
      primary key (question_number, option_text)
    );
    alter table public.section1_question_options enable row level security;
    revoke all on table public.section1_question_options from public, anon, authenticated;
  `)
}

// ---------------------------------------------------------------------------
// Snapshot: proves the preflight did not write anything
// ---------------------------------------------------------------------------
async function snapshot(db) {
  const column = await db`
    select coalesce(format_type(a.atttypid, a.atttypmod), '') as type, a.attnotnull as not_null
      from pg_attribute a
     where a.attrelid = to_regclass('public.user_responses')
       and a.attname = 'responses_array'
       and not a.attisdropped`
  const responses = await db`
    select count(*)::int as n,
           coalesce(md5(string_agg(row_to_json(t)::text, '|' order by t.user_id)), '') as digest
      from (select * from public.user_responses) t`
  const users = await db`
    select count(*)::int as n,
           coalesce(md5(string_agg(row_to_json(t)::text, '|' order by t.id)), '') as digest
      from (select id, section1_complete, section1_progress, section1_last_edited from public.users) t`
  const objects = await db`
    select coalesce(to_regclass('public.section1_legacy_cutover')::text, '') as marker,
           coalesce(to_regclass('public.section1_question_options')::text, '') as options,
           (select count(*)::int from pg_proc
             where pronamespace = 'public'::regnamespace
               and proname in ('section1_answers_are_complete', 'enforce_section1_completion',
                               'downgrade_section1_on_invalid_answers')) as functions,
           (select count(*)::int from pg_trigger
             where not tgisinternal and tgname like 'trg_section1%') as triggers,
           (select count(*)::int from pg_policy
             where polrelid = to_regclass('public.user_responses')) as policies`
  const grants = await db`
    select coalesce(string_agg(grantee::text || ':' || privilege_type, ',' order by grantee::text, privilege_type), '') as acl
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'user_responses'`
  return JSON.stringify({
    column: column[0] ?? null,
    responses: responses[0],
    users: users[0],
    objects: objects[0],
    grants: grants[0]
  })
}

// ---------------------------------------------------------------------------
// Child process
// ---------------------------------------------------------------------------
function runPreflight({ url, env = {}, args = [], allowLocal = true }) {
  const childEnv = { ...process.env }
  for (const key of [
    'SECTION1_PREFLIGHT_DATABASE_URL',
    'SECTION1_PREFLIGHT_CONFIRM_PROJECT',
    'SECTION1_PREFLIGHT_ALLOW_LOCAL',
    'DATABASE_URL'
  ]) delete childEnv[key]
  if (url) childEnv.SECTION1_PREFLIGHT_DATABASE_URL = url
  if (allowLocal) childEnv.SECTION1_PREFLIGHT_ALLOW_LOCAL = '1'
  Object.assign(childEnv, env)

  return new Promise(resolve => {
    const child = spawn(process.execPath, ['scripts/preflight-section1-migration.mjs', ...args], {
      cwd: repoRoot,
      env: childEnv
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

function categoryOf(output) {
  const match = /^\s+category\s+(\S+)\s*$/m.exec(output)
  return match?.[1] ?? null
}

function assertHygiene(result, label) {
  const combined = `${result.stdout}\n${result.stderr}`
  ok(!combined.includes('postgres://') && !combined.includes('postgresql://'),
    `${label}: the report printed a connection string`)
  ok(!combined.includes(PASSWORD), `${label}: the report printed the password`)
  ok(!combined.includes('a@example.test') && !combined.includes(A),
    `${label}: the report printed an email or user id`)
  ok(result.stdout.includes(REQUIRED_SENTENCE), `${label}: the required closing sentence is missing\n${combined.slice(0, 4000)}`)
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------
const scenarios = [
  {
    name: 'expected_legacy',
    seed: db => seedLegacy(db),
    env: { DATABASE_URL: 'postgres://ignored:ignored@127.0.0.1:1/ignored' },
    expect: {
      exit: 0,
      category: 'MATCHES_EXPECTED_STARTING_STATE',
      includes: [
        /DELETE 2 answer row\(s\); RESET 4 profile\(s\)/,
        /identity tier\s+LOCAL_DISPOSABLE_FIXTURE/,
        /responses_array\.type\s+integer\[\]/,
        /cutover marker\s+absent/
      ]
    }
  },
  {
    name: 'text_without_marker',
    seed: db => seedLegacy(db, 'text[]'),
    expect: {
      exit: 3,
      category: 'STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED',
      includes: [/already text\[\] with no cutover marker/]
    }
  },
  {
    name: 'marker_with_integer_column',
    seed: async db => {
      await seedLegacy(db)
      await seedMarker(db)
    },
    expect: {
      exit: 3,
      category: 'STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED',
      includes: [/marker and schema disagree/]
    }
  },
  {
    name: 'partial_objects',
    seed: async db => {
      await seedLegacy(db)
      await seedOptionBank(db)
    },
    expect: {
      exit: 3,
      category: 'STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED',
      includes: [/option bank exists although the cutover has not happened/]
    }
  },
  {
    name: 'missing_authority',
    seed: async db => {
      await seedLegacy(db)
      await db.unsafe(`
        grant usage on schema public, auth to preflight_limited;
        grant select on public.users, public.user_responses to preflight_limited;
      `)
    },
    url: database => localUrl(database, 'preflight_limited'),
    expect: {
      exit: 4,
      category: 'STOP_MISSING_EVIDENCE',
      includes: [/cannot act as owner of public\.user_responses/]
    }
  },
  {
    name: 'connection_failure',
    noDatabase: true,
    url: () => 'postgres://postgres:wrong@127.0.0.1:1/postgres',
    env: { SECTION1_PREFLIGHT_ALLOW_LOCAL: '1' },
    expect: {
      exit: 4,
      category: 'STOP_MISSING_EVIDENCE',
      includes: [/could not be established/]
    }
  },
  {
    name: 'already_migrated',
    seed: async db => {
      await seedLegacy(db)
      await db.unsafe(migration)
    },
    expect: {
      exit: 5,
      category: 'STOP_ALREADY_MIGRATED',
      includes: [
        /responses_array\.type\s+text\[\]/,
        /option bank\s+200 row\(s\) across 50 question\(s\)/,
        /functions\s+3 of 3/,
        /guards\s+2 of 2/
      ]
    }
  },
  {
    name: 'damaged_option_bank',
    seed: async db => {
      await seedLegacy(db)
      await db.unsafe(migration)
      await db.unsafe('delete from public.section1_question_options where ctid in (select ctid from public.section1_question_options limit 1)')
    },
    expect: {
      exit: 3,
      category: 'STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED',
      includes: [/option bank holds 199 rows across 50 questions/]
    }
  },
  {
    name: 'cascade_foreign_key',
    seed: async db => {
      await seedLegacy(db)
      await db.unsafe(`
        create table public.response_notes (
          id integer primary key,
          user_id uuid references public.user_responses(user_id) on delete cascade
        );
        insert into public.response_notes (id, user_id) values (1, '${A}');
      `)
    },
    expect: {
      exit: 3,
      category: 'STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED',
      includes: [/foreign key to public\.user_responses with ON DELETE CASCADE/]
    }
  },
  {
    name: 'dependent_view',
    seed: async db => {
      await seedLegacy(db)
      await db.unsafe('create view public.response_export as select user_id, responses_array from public.user_responses;')
    },
    expect: {
      exit: 3,
      category: 'STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED',
      includes: [/public\.response_export depends on responses_array/]
    }
  },
  {
    // A column-level revoke that a table-level check would miss: authenticated
    // keeps every other privilege on public.users, but loses UPDATE on
    // section1_last_edited, which Section1.jsx writes on every save.
    name: 'missing_column_priv',
    seed: async db => {
      await seedLegacy(db)
      await db.unsafe(`
        revoke update on public.users from authenticated;
        grant update (section1_complete, section1_progress) on public.users to authenticated;
      `)
    },
    expect: {
      exit: 3,
      category: 'STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED',
      includes: [
        /lacks UPDATE on public\.users\.section1_last_edited/,
        /client column privs users\s+MISSING UPDATE section1_last_edited/
      ]
    }
  },
  {
    // The same revoke on the answer row: the client upserts responses_array.
    name: 'missing_response_column_priv',
    seed: async db => {
      await seedLegacy(db)
      await db.unsafe(`
        revoke update on public.user_responses from authenticated;
        grant update (user_id, updated_at) on public.user_responses to authenticated;
      `)
    },
    expect: {
      exit: 3,
      category: 'STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED',
      includes: [/lacks UPDATE on public\.user_responses\.responses_array/]
    }
  },
  {
    // A marker plus a text[] row that mixes numeric strings with NULLs is the
    // converted-legacy signature even though NULL elements are present.
    name: 'converted_legacy_with_nulls',
    seed: async db => {
      await seedLegacy(db)
      await db.unsafe(migration)
      await db.unsafe(
        'insert into public.user_responses (user_id, responses_array) values ($1, $2::text[])',
        [B, ['0', '1', null, '3', null]]
      )
    },
    expect: {
      exit: 3,
      category: 'STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED',
      includes: [/1 answer row\(s\) hold only numeric values \(NULL elements allowed\)/]
    }
  },
  {
    // Legitimate current partial data — option text mixed with NULLs — under a
    // valid marker is still the legitimate already-migrated state.
    name: 'legit_partial_with_nulls',
    seed: async db => {
      await seedLegacy(db)
      await db.unsafe(migration)
      await db.unsafe(
        'insert into public.user_responses (user_id, responses_array) values ($1, $2::text[])',
        [B, [section1Questions[0].options[0], null, section1Questions[2].options[1], null]]
      )
    },
    expect: {
      exit: 5,
      category: 'STOP_ALREADY_MIGRATED',
      includes: [/numeric-only answer rows\s+0/]
    }
  },
  {
    // The marker table has the expected column names but NULLABLE counts, and
    // the marker row's counts are NULL. `Number(null) === 0` made the old
    // `>= 0` row check pass and `NULL < 0` is NULL, so the old shape check
    // (names only) also passed: this state was classified as a completed
    // migration (exit 5). It must be a stop instead — both the structure
    // (type + nullability) and the row (non-null integer counts) refuse it.
    name: 'marker_null_counts',
    seed: async db => {
      await seedLegacy(db)
      await db.unsafe(migration)
      await db.unsafe(`
        alter table public.section1_legacy_cutover
          alter column deleted_response_rows drop not null,
          alter column reset_user_profiles drop not null;
        update public.section1_legacy_cutover
           set deleted_response_rows = null, reset_user_profiles = null;
      `)
    },
    expect: {
      exit: 3,
      category: 'STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED',
      includes: [
        /the cutover marker table has the wrong shape/,
        /the cutover marker row is malformed/,
        /deleted_response_rows integer \(nullable\)/,
        /reset_user_profiles integer \(nullable\)/
      ]
    }
  },
  {
    // FORCE ROW LEVEL SECURITY on both tables while the executing role is
    // neither superuser nor BYPASSRLS: the migration's global delete, global
    // reset, emptiness assertion and reset postcondition would all be subject
    // to RLS filtering (the migration sets `row_security = off`, so they would
    // fail rather than affect a subset). The initial state therefore cannot be
    // classified as acceptable — without this decision the scenario below
    // would be exit 0 MATCHES_EXPECTED_STARTING_STATE.
    name: 'force_rls_no_bypass',
    seed: async db => {
      await seedLegacy(db)
      await db.unsafe(`
        grant usage, create on schema public to preflight_limited;
        alter table public.users owner to preflight_limited;
        alter table public.user_responses owner to preflight_limited;
        alter table public.users force row level security;
        alter table public.user_responses force row level security;
      `)
    },
    url: database => localUrl(database, 'preflight_limited'),
    expect: {
      exit: 3,
      category: 'STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED',
      includes: [
        /FORCE ROW LEVEL SECURITY and the executing role is neither superuser nor BYPASSRLS/,
        /rls=yes \(FORCE\)/
      ]
    }
  }
]

const refusals = [
  {
    name: 'no_url',
    run: () => runPreflight({}),
    includes: [/SECTION1_PREFLIGHT_DATABASE_URL is not set/]
  },
  {
    name: 'loopback_without_opt_in',
    run: () => runPreflight({ url: localUrl('postgres'), allowLocal: false }),
    includes: [/loopback/]
  },
  {
    name: 'ref_not_in_host',
    run: () => runPreflight({
      url: 'postgres://postgres:secret@db.wrongrefexample.supabase.co:5432/postgres',
      env: { SECTION1_PREFLIGHT_CONFIRM_PROJECT: EXPECTED_REF }
    }),
    includes: [/does not appear in the connection host or username/]
  },
  {
    name: 'confirmation_missing',
    run: () => runPreflight({ url: `postgres://postgres:secret@db.${EXPECTED_REF}.supabase.co:5432/postgres` }),
    includes: [/SECTION1_PREFLIGHT_CONFIRM_PROJECT must be exactly/]
  }
]

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {}, ssl: false })

try {
  const version = (await admin`select current_setting('server_version') as v`)[0].v
  console.log(`disposable PostgreSQL ${version}`)

  await admin.unsafe(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
      if not exists (select 1 from pg_roles where rolname = 'preflight_limited') then
        create role preflight_limited login password 'limited';
      end if;
    end $$;
  `)

  const scratch = mkdtempSync(join(tmpdir(), 'mm-preflight-'))
  const outFile = join(scratch, 'expected_legacy.txt')

  for (const [index, scenario] of scenarios.entries()) {
    const database = `preflight_${index}_${scenario.name}`
    let db = null
    try {
      if (!scenario.noDatabase) {
        await admin.unsafe(`drop database if exists ${database}`)
        await admin.unsafe(`create database ${database}`)
        db = postgres(localUrl(database), { max: 1, onnotice: () => {}, ssl: false })
        await scenario.seed(db)
      }
      const before = db ? await snapshot(db) : null
      const url = scenario.url ? scenario.url(database) : localUrl(database)
      const args = scenario.name === 'expected_legacy' ? ['--out', outFile] : []
      const result = await runPreflight({ url, env: scenario.env, args })
      if (db) {
        const after = await snapshot(db)
        ok(before === after, `${scenario.name}: the preflight changed the database`)
      }
      assertHygiene(result, scenario.name)
      ok(result.code === scenario.expect.exit,
        `${scenario.name}: exit ${result.code}, expected ${scenario.expect.exit}\n${result.stderr}\n${result.stdout}`)
      ok(categoryOf(result.stdout) === scenario.expect.category,
        `${scenario.name}: category ${categoryOf(result.stdout)}, expected ${scenario.expect.category}\n${result.stdout}`)
      for (const pattern of scenario.expect.includes) {
        ok(pattern.test(result.stdout), `${scenario.name}: output does not match ${pattern}\n${result.stdout}`)
      }
      console.log(`  ok  ${scenario.name} (exit ${result.code}, ${scenario.expect.category})`)
    } finally {
      if (db) await db.end({ timeout: 5 }).catch(() => {})
      if (!scenario.noDatabase) await admin.unsafe(`drop database if exists ${database} with (force)`)
    }
  }

  // --out: the saved report is the same text and is equally clean.
  ok(existsSync(outFile), '--out did not create the report file')
  const saved = readFileSync(outFile, 'utf8')
  ok(saved.includes(REQUIRED_SENTENCE), 'the saved report is missing the required closing sentence')
  ok(!saved.includes('postgres://') && !saved.includes(PASSWORD), 'the saved report contains a connection string or password')

  for (const refusal of refusals) {
    const result = await refusal.run()
    ok(result.code === 2, `${refusal.name}: exit ${result.code}, expected 2\n${result.stdout}\n${result.stderr}`)
    ok(result.stderr.includes('REFUSED:'), `${refusal.name}: no refusal on stderr\n${result.stderr}`)
    for (const pattern of refusal.includes) {
      ok(pattern.test(result.stderr) || pattern.test(result.stdout),
        `${refusal.name}: refusal does not match ${pattern}\n${result.stderr}`)
    }
    ok(result.stderr.includes(REQUIRED_SENTENCE), `${refusal.name}: the refusal is missing the closing sentence`)
    console.log(`  ok  refused ${refusal.name} (exit 2, nothing connected)`)
  }

  console.log(`\npreflight scenarios passed: ${checks} assertions`)
} finally {
  await admin.end({ timeout: 5 })
}
