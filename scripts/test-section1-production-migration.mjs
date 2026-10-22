// Section 1 production migration — executed in an isolated PostgreSQL (PGlite).
//
//   node scripts/test-section1-production-migration.mjs
//
// This builds a disposable database that mirrors the production shape the
// migration cares about:
//   * public.users with section1_complete / section1_progress
//   * public.user_responses with responses_array integer[] NOT NULL, RLS on,
//     the two pre-rewrite policies, full anon/authenticated grants
//   * a legacy 40-slot integer answer row that is marked complete
//   * a profile that claims completion with no answers at all
//
// then applies supabase/sql/production/20261022180000_production_section1_responses.sql
// twice (to prove it is idempotent) and exercises:
//   * the type conversion and value preservation
//   * owner read/write, cross-user read/write denial, anon denial
//   * server-side completion validation and the response downgrade guard
//   * legacy answers not qualifying as completed current data
//
// It never contacts a hosted database. It is not a substitute for running the
// same file against a Supabase staging project (auth schema, PostgREST and the
// real owners differ), but it does execute the real SQL against Postgres.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { section1Questions } from '../src/data/section1Questions.js'

const MIGRATION_PATH = 'supabase/sql/production/20261022180000_production_section1_responses.sql'
const migration = readFileSync(new URL(`../${MIGRATION_PATH}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const A = 'aaaaaaaa-0000-4000-8000-000000000001' // legacy 40-answer profile, marked complete
const B = 'bbbbbbbb-0000-4000-8000-000000000002' // incomplete profile
const C = 'cccccccc-0000-4000-8000-000000000003' // forged completion, no answers
const LEGACY = [0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0,
  1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0]
const VALID = section1Questions.map(question => question.options[0])

let checks = 0
function ok(condition, message) {
  assert.ok(condition, message)
  checks += 1
}
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message)
  checks += 1
}
async function rows(sql, params) {
  const result = await db.query(sql, params)
  return result.rows
}
async function expectError(label, sql, pattern) {
  let error = null
  try {
    await db.query(sql)
  } catch (caught) {
    error = caught
  }
  ok(error !== null, `${label}: expected an error, none was raised`)
  ok(pattern.test(String(error?.message)), `${label}: unexpected error "${error?.message}"`)
}
async function asRole(role, userId, fn) {
  await db.exec(`set role ${role}`)
  try {
    // PostgREST supplies both claims; the harness stands in for it.
    await rows('select set_config($1, $2, false)', ['request.jwt.claim.role', role])
    if (userId) await rows('select set_config($1, $2, false)', ['request.jwt.claim.sub', userId])
    return await fn()
  } finally {
    await db.exec('reset role')
    await db.exec("select set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)")
  }
}

const db = new PGlite()

// ---------------------------------------------------------------------------
// 0. Harness: production-shaped schema, roles, grants, legacy data
// ---------------------------------------------------------------------------
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;

  create schema auth;
  create function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text
    language sql stable
    as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;

  grant usage on schema public, auth to anon, authenticated;

  create table public.users (
    id uuid primary key,
    email text,
    section1_complete boolean default false,
    section1_progress integer default 0,
    section1_last_edited timestamptz,
    profile_status text default 'active'
  );

  create table public.user_responses (
    user_id uuid primary key references public.users(id) on delete cascade,
    responses_array integer[] not null,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  alter table public.users enable row level security;
  alter table public.user_responses enable row level security;

  create policy users_select_own on public.users for select to authenticated
    using (id = auth.uid());
  create policy users_update_own on public.users for update to authenticated
    using (id = auth.uid()) with check (id = auth.uid());

  -- the pre-rewrite policies the migration must replace
  create policy "Allow authenticated users to read any response matrix for match"
    on public.user_responses for select to authenticated
    using (auth.role() = 'authenticated');
  create policy "Allow users full operational control over their own response ro"
    on public.user_responses for all to authenticated
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

  -- production grants: full table privileges to both client roles
  grant all on public.user_responses to anon, authenticated;
  grant all on public.users to anon, authenticated;
`)

await db.query(
  `insert into public.users (id, email, section1_complete, section1_progress) values
     ($1, 'legacy@example.test', true, 39),
     ($2, 'fresh@example.test', false, 0),
     ($3, 'forged@example.test', true, 0)`,
  [A, B, C]
)
await db.query(
  'insert into public.user_responses (user_id, responses_array) values ($1, $2::integer[])',
  [A, LEGACY]
)

// Pre-migration evidence: any signed-in user can read the legacy answers.
const leaked = await asRole('authenticated', B, () =>
  rows('select user_id from public.user_responses')
)
equal(leaked.length, 1, 'harness: before the fix one authenticated user can read another user\'s answers')

// ---------------------------------------------------------------------------
// 1. Apply the migration, then apply it again (idempotence)
// ---------------------------------------------------------------------------
await db.exec(migration)
const afterFirst = await rows('select user_id, responses_array from public.user_responses order by user_id')
await db.exec(migration)
const afterSecond = await rows('select user_id, responses_array from public.user_responses order by user_id')

equal(afterFirst.length, 1, 'the migration must not delete response rows')
equal(afterSecond, afterFirst, 're-running the migration must change nothing')

const column = await rows(`
  select format_type(a.atttypid, a.atttypmod) as type
    from pg_attribute a
   where a.attrelid = 'public.user_responses'::regclass
     and a.attname = 'responses_array'`)
equal(column[0].type, 'text[]', 'responses_array must be text[] after the migration')

const preserved = afterFirst[0].responses_array
equal(preserved.length, 40, 'the legacy row keeps all 40 stored slots')
equal(preserved, LEGACY.map(String), 'every legacy value is preserved verbatim as text')

const userRows = await rows(
  'select id, email, section1_complete, section1_progress from public.users order by id'
)
equal(userRows.length, 3, 'the migration must not delete users')
equal(userRows.map(row => row.email), ['legacy@example.test', 'fresh@example.test', 'forged@example.test'],
  'unrelated user data is unchanged')
const legacyUser = userRows.find(row => row.id === A)
const forgedUser = userRows.find(row => row.id === C)
equal(legacyUser.section1_complete, false, 'the legacy 40-answer profile must be marked incomplete')
equal(legacyUser.section1_progress, 0, 'the legacy profile must restart at question 1')
equal(forgedUser.section1_complete, false, 'a completion claim with no answers must be reset')

// ---------------------------------------------------------------------------
// 2. Policy set and anon access
// ---------------------------------------------------------------------------
const policies = await rows(`
  select p.polname as name, p.polcmd as cmd,
         pg_get_expr(p.polqual, p.polrelid) as qual,
         pg_get_expr(p.polwithcheck, p.polrelid) as check
    from pg_policy p
   where p.polrelid = 'public.user_responses'::regclass
   order by p.polname`)
equal(policies.map(policy => policy.name), ['responses_insert_own', 'responses_select_own', 'responses_update_own'],
  'exactly the three owner policies must remain')
ok(policies.every(policy => !/auth\.role\(\)/.test(policy.qual || '')), 'no role-wide read policy may remain')
ok(policies.every(policy => /auth\.uid\(\)/.test(policy.qual || policy.check || '')), 'every policy is scoped to auth.uid()')

const anonGrants = await rows(`
  select count(*)::int as n
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'user_responses' and grantee = 'anon'`)
equal(anonGrants[0].n, 0, 'anon must hold no table privileges on user_responses')

// The option bank is internal: 200 rows, 50 questions, invisible to clients.
const optionBank = await rows(`
  select count(*)::int as rows, count(distinct question_number)::int as questions
    from public.section1_question_options`)
equal(optionBank[0].rows, 200, 'the option bank must hold 200 options')
equal(optionBank[0].questions, 50, 'the option bank must cover 50 questions')

await asRole('authenticated', A, async () => {
  await expectError('authenticated option-bank read', 'select * from public.section1_question_options', /permission denied/i)
})
await asRole('anon', null, async () => {
  await expectError('anon option-bank read', 'select * from public.section1_question_options', /permission denied/i)
})

await asRole('anon', null, async () => {
  await expectError('anon read', 'select * from public.user_responses', /permission denied/i)
  await expectError('anon write',
    `insert into public.user_responses (user_id, responses_array) values ('${B}', array['x']::text[])`,
    /permission denied/i)
})

// ---------------------------------------------------------------------------
// 3. Owner access, cross-user denial
// ---------------------------------------------------------------------------
const aView = await asRole('authenticated', A, () =>
  rows('select user_id, responses_array from public.user_responses')
)
equal(aView.map(row => row.user_id), [A], 'an owner reads exactly their own answer row')
ok(aView[0].responses_array.every(value => typeof value === 'string'), 'answers are text for the owner')

const crossRead = await asRole('authenticated', B, () =>
  rows('select user_id from public.user_responses where user_id = $1', [A])
)
equal(crossRead, [], 'another signed-in user cannot read the row by id')

const crossUpdate = await asRole('authenticated', B, () =>
  rows('update public.user_responses set responses_array = $1 where user_id = $2 returning user_id', [VALID, A])
)
equal(crossUpdate, [], 'another signed-in user cannot update the row')

const crossInsert = await asRole('authenticated', A, async () => {
  let failed = false
  try {
    await db.query(
      'insert into public.user_responses (user_id, responses_array) values ($1, $2)',
      [B, VALID]
    )
  } catch (error) {
    failed = /row-level security|violates/i.test(String(error.message))
  }
  return failed
})
ok(crossInsert, 'a signed-in user cannot insert an answer row for someone else')

// ---------------------------------------------------------------------------
// 4. Completion integrity
// ---------------------------------------------------------------------------
// A still holds legacy values; claiming completion must be discarded.
const legacyClaim = await asRole('authenticated', A, () =>
  rows('update public.users set section1_complete = true where id = $1 returning section1_complete, section1_progress', [A])
)
equal(legacyClaim[0].section1_complete, false, 'a legacy 40-answer set cannot be marked complete')
equal(legacyClaim[0].section1_progress, 0, 'the rejected claim also resets the pointer')

// B writes a 50-slot array that is mostly empty, then claims completion.
const sparse = Array.from({ length: 50 }, (_, index) => (index < 10 ? VALID[index] : null))
await asRole('authenticated', B, () =>
  rows('insert into public.user_responses (user_id, responses_array) values ($1, $2)', [B, sparse])
)
const sparseClaim = await asRole('authenticated', B, () =>
  rows('update public.users set section1_complete = true where id = $1 returning section1_complete', [B])
)
equal(sparseClaim[0].section1_complete, false, 'an incomplete 50-slot array cannot be marked complete')

// B writes the legacy numeric shape (50 x '0') and claims completion.
const numeric = Array.from({ length: 50 }, () => '0')
await asRole('authenticated', B, () =>
  rows('update public.user_responses set responses_array = $1 where user_id = $2', [numeric, B])
)
const numericClaim = await asRole('authenticated', B, () =>
  rows('update public.users set section1_complete = true where id = $1 returning section1_complete', [B])
)
equal(numericClaim[0].section1_complete, false, '50 numeric legacy answers cannot be marked complete')

// 50 nonblank strings that are not in the question bank are rejected too.
const outOfBank = Array.from({ length: 50 }, () => 'Not a real option')
await asRole('authenticated', B, () =>
  rows('update public.user_responses set responses_array = $1 where user_id = $2', [outOfBank, B])
)
const outOfBankClaim = await asRole('authenticated', B, () =>
  rows('update public.users set section1_complete = true where id = $1 returning section1_complete', [B])
)
equal(outOfBankClaim[0].section1_complete, false, 'out-of-bank strings cannot be marked complete')

// A real option in the wrong question's slot is not that question's answer.
const wrongSlot = [...VALID]
wrongSlot[0] = section1Questions[1].options[0]
await asRole('authenticated', B, () =>
  rows('update public.user_responses set responses_array = $1 where user_id = $2', [wrongSlot, B])
)
const wrongSlotClaim = await asRole('authenticated', B, () =>
  rows('update public.users set section1_complete = true where id = $1 returning section1_complete', [B])
)
equal(wrongSlotClaim[0].section1_complete, false, 'an option from another question cannot be marked complete')

// A valid current answer set does satisfy the guard.
await asRole('authenticated', B, () =>
  rows('update public.user_responses set responses_array = $1 where user_id = $2', [VALID, B])
)
const validClaim = await asRole('authenticated', B, () =>
  rows('update public.users set section1_complete = true where id = $1 returning section1_complete, section1_progress', [B])
)
equal(validClaim[0].section1_complete, true, '50 valid current answers may be marked complete')
equal(validClaim[0].section1_progress, 50, 'a valid completion stores the pointer as 50')

const stored = await asRole('authenticated', B, () =>
  rows('select responses_array from public.user_responses where user_id = $1', [B])
)
equal(stored[0].responses_array, VALID, 'the valid answer text is persisted unchanged')

// Replacing the completed set with an incomplete one removes completion.
const downgraded = await asRole('authenticated', B, async () => {
  await db.query('update public.user_responses set responses_array = $1 where user_id = $2', [sparse, B])
  return rows('select section1_complete, section1_progress from public.users where id = $1', [B])
})
equal(downgraded[0].section1_complete, false, 'invalidating the stored answers must remove completion')
equal(downgraded[0].section1_progress, 0, 'the downgraded profile restarts at question 1')

// The progress pointer is clamped to the questionnaire length.
const clamped = await asRole('authenticated', B, () =>
  rows('update public.users set section1_progress = 999 where id = $1 returning section1_progress', [B])
)
equal(clamped[0].section1_progress, 50, 'progress is clamped to 50')

// Eligibility, as match-generator reads it.
const eligible = await rows('select id from public.users where section1_complete = true order by id')
equal(eligible.map(row => row.id), [], 'no legacy/incomplete profile qualifies for matching')

// ---------------------------------------------------------------------------
// 5. The migration text stays inside its scope
// ---------------------------------------------------------------------------
const codeLines = migration
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n')
ok(!/delete\s+from/i.test(codeLines), 'the migration must not delete rows')
ok(!/truncate/i.test(codeLines), 'the migration must not truncate')
ok(!/drop\s+table/i.test(codeLines), 'the migration must not drop tables')
ok(!/section2|payment|connect_unlock|force_connect|matches\b/i.test(codeLines),
  'the migration must not touch Section 2, payments, Connect or matches')
ok(!/SECTION1_DIMENSION|dimensionQuestions|communication:|expectations:|values:/i.test(codeLines),
  'the migration must not change scoring weights or dimension mapping')

console.log(`Section 1 production migration checks passed: ${checks} assertions`)
console.log('Isolated PostgreSQL: type conversion, owner-only RLS, anon denial, completion guards, legacy exclusion')
