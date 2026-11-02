// Section 1 production migration — executed in an isolated PostgreSQL (PGlite).
//
//   node scripts/test-section1-production-migration.mjs
//
// Builds a disposable database that mirrors the production shape the migration
// cares about:
//   * public.users with Section 1 state plus unrelated profile fields
//   * public.user_responses with responses_array integer[] NOT NULL, RLS on,
//     the two pre-rewrite policies, full anon/authenticated grants
//   * a legacy 40-slot answer row marked complete
//   * an incomplete profile
//   * a forged completion with no answers
//   * a profile with stale partial progress and no completion
//   * representative rows in matches, match_history, messages, conversations,
//     section2_responses, section2_chat_progress, payment_intents and
//     connect_unlocks so "unrelated data is preserved" is measured, not claimed
//
// then applies supabase/sql/production/20261022180000_production_section1_responses.sql
// and asserts the owner's discard contract:
//   * the first run deletes every pre-existing answer row
//   * every user is reset to incomplete / progress 0 (last_edited nulled)
//   * unrelated rows and columns are byte-identical afterwards
//   * a second run refuses the destructive reset and keeps new answers
//   * owner-only access, anon denial and function privileges
//   * option-bank membership validation and the completion guards
//
// It never contacts a hosted database. It is not a substitute for running the
// same file against a Supabase staging project (auth schema, PostgREST and the
// real owners differ), but it does execute the real SQL against Postgres.
//
// ENGINE: PGlite bundles a real PostgreSQL build (currently 18.x), so this file
// is executed evidence for that version, not for PostgreSQL 17. The PG17
// counterpart is scripts/test-section1-staging-pg17.mjs, which needs a staging
// connection string and builds its own legacy integer[] schema.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { section1Questions } from '../src/data/section1Questions.js'

const MIGRATION_PATH = 'supabase/sql/production/20261022180000_production_section1_responses.sql'
const migration = readFileSync(new URL(`../${MIGRATION_PATH}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const A = 'aaaaaaaa-0000-4000-8000-000000000001' // legacy 40-answer profile, marked complete
const B = 'bbbbbbbb-0000-4000-8000-000000000002' // incomplete profile
const C = 'cccccccc-0000-4000-8000-000000000003' // forged completion, no answers
const D = 'dddddddd-0000-4000-8000-000000000004' // stale partial progress, not complete
const LEGACY = [0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0,
  1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0]
const PARTIAL = [0, 1, 0, 1, 0, 1, 0, 1, 0, 1]
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
    full_name text,
    bio text,
    campus_id uuid,
    section1_complete boolean default false,
    section1_progress integer default 0,
    section1_last_edited timestamptz,
    section2_unlocked boolean default false,
    section2_free_expires_at timestamptz,
    profile_status text default 'active',
    notifications_enabled boolean default true,
    created_at timestamptz default now()
  );

  create table public.user_responses (
    user_id uuid primary key references public.users(id) on delete cascade,
    responses_array integer[] not null,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  create table public.matches (
    id uuid primary key, user_a uuid, user_b uuid, compatibility_score integer,
    created_at timestamptz default now()
  );
  create table public.match_history (
    id bigserial primary key, match_id uuid, action text, created_at timestamptz default now()
  );
  create table public.conversations (
    id uuid primary key, match_id uuid, created_at timestamptz default now()
  );
  create table public.messages (
    id uuid primary key, conversation_id uuid, sender_id uuid, body text,
    created_at timestamptz default now()
  );
  create table public.section2_responses (
    user_id uuid primary key, responses_array text[], updated_at timestamptz default now()
  );
  create table public.section2_chat_progress (
    user_id uuid primary key, current_question integer, completed boolean default false
  );
  create table public.payment_intents (
    id text primary key, user_id uuid, amount integer, status text,
    created_at timestamptz default now()
  );
  create table public.connect_unlocks (
    id uuid primary key, user_id uuid, target_user_id uuid, unlocked_at timestamptz default now()
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
  `insert into public.users
     (id, email, full_name, bio, campus_id, section1_complete, section1_progress,
      section1_last_edited, section2_unlocked, section2_free_expires_at,
      profile_status, notifications_enabled, created_at)
   values
     ($1, 'legacy@example.test', 'Legacy User', 'Legacy bio', gen_random_uuid(), true, 39,
      '2026-01-02T00:00:00Z', true, '2026-02-01T00:00:00Z', 'active', false, '2026-01-01T00:00:00Z'),
     ($2, 'fresh@example.test', 'Fresh User', 'Fresh bio', gen_random_uuid(), false, 0,
      null, false, null, 'active', true, '2026-01-01T00:00:00Z'),
     ($3, 'forged@example.test', 'Forged User', 'Forged bio', gen_random_uuid(), true, 0,
      '2026-01-03T00:00:00Z', false, null, 'active', true, '2026-01-01T00:00:00Z'),
     ($4, 'stale@example.test', 'Stale User', 'Stale bio', gen_random_uuid(), false, 23,
      '2026-01-04T00:00:00Z', false, null, 'paused', true, '2026-01-01T00:00:00Z')`,
  [A, B, C, D]
)
await db.query(
  'insert into public.user_responses (user_id, responses_array) values ($1, $2::integer[]), ($3, $4::integer[])',
  [A, LEGACY, D, PARTIAL]
)

await db.exec(`
  insert into public.matches (id, user_a, user_b, compatibility_score)
    values ('11111111-1111-4111-8111-111111111111', '${A}', '${B}', 72);
  insert into public.match_history (match_id, action)
    values ('11111111-1111-4111-8111-111111111111', 'delivered');
  insert into public.conversations (id, match_id)
    values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');
  insert into public.messages (id, conversation_id, sender_id, body)
    values ('33333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222',
            '${A}', 'hello there');
  insert into public.section2_responses (user_id, responses_array)
    values ('${A}', array['answer one','answer two']);
  insert into public.section2_chat_progress (user_id, current_question, completed)
    values ('${A}', 7, false);
  insert into public.payment_intents (id, user_id, amount, status)
    values ('pi_test_1', '${A}', 500, 'succeeded');
  insert into public.connect_unlocks (id, user_id, target_user_id)
    values ('44444444-4444-4444-8444-444444444444', '${A}', '${B}');
`)

// Snapshot everything the migration must not touch.
async function unrelatedSnapshot() {
  return {
    profileColumns: await rows(`
      select id, email, full_name, bio, campus_id, section2_unlocked,
             section2_free_expires_at, profile_status, notifications_enabled, created_at
        from public.users order by id`),
    matches: await rows('select * from public.matches order by id'),
    matchHistory: await rows('select * from public.match_history order by id'),
    conversations: await rows('select * from public.conversations order by id'),
    messages: await rows('select * from public.messages order by id'),
    section2Responses: await rows('select * from public.section2_responses order by user_id'),
    section2Progress: await rows('select * from public.section2_chat_progress order by user_id'),
    payments: await rows('select * from public.payment_intents order by id'),
    unlocks: await rows('select * from public.connect_unlocks order by id')
  }
}

// Pre-migration evidence: any signed-in user can read the legacy answers.
const leaked = await asRole('authenticated', B, () =>
  rows('select user_id from public.user_responses')
)
equal(leaked.length, 2, 'harness: before the fix one authenticated user can read every answer row')

const before = await unrelatedSnapshot()

// ---------------------------------------------------------------------------
// 1. First application: legacy answers are discarded, everyone is reset
// ---------------------------------------------------------------------------
await db.exec(migration)

const afterFirst = await rows('select user_id, responses_array from public.user_responses order by user_id')
equal(afterFirst, [], 'the first run must delete every pre-existing answer row')
equal((await rows('select count(*)::int as n from public.user_responses'))[0].n, 0,
  'no legacy answer row may survive the migration')

const column = await rows(`
  select format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as not_null
    from pg_attribute a
   where a.attrelid = 'public.user_responses'::regclass
     and a.attname = 'responses_array'`)
equal(column[0].type, 'text[]', 'responses_array must be text[] after the migration')
equal(column[0].not_null, true, 'responses_array must stay NOT NULL')

const usersAfter = await rows(
  'select id, section1_complete, section1_progress, section1_last_edited from public.users order by id'
)
equal(usersAfter.length, 4, 'the migration must not delete users')
equal(usersAfter.map(row => [row.section1_complete, row.section1_progress]),
  [[false, 0], [false, 0], [false, 0], [false, 0]],
  'every user is reset to incomplete with progress 0 (including stale partial progress)')
ok(usersAfter.every(row => row.section1_last_edited === null),
  'the discarded answers leave no stale last-edited timestamp')

const cutover = await rows(
  'select count(*)::int as n, min(deleted_response_rows)::int as deleted, min(reset_user_profiles)::int as reset from public.section1_legacy_cutover'
)
equal(cutover[0].n, 1, 'the one-time cutover marker must exist exactly once')
equal(cutover[0].deleted, 2, 'the marker records the two legacy answer rows it deleted')
equal(cutover[0].reset, 4, 'the marker records all four profiles it reset')

// R6: unrelated data untouched.
equal(await unrelatedSnapshot(), before,
  'matches, match history, conversations, messages, Section 2, payments, unlocks and unrelated profile columns must be unchanged')

// R5: owner-only policies, anon locked out, least-privilege grants.
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

const authPrivs = await rows(`
  select has_table_privilege('authenticated', 'public.user_responses', 'select') as sel,
         has_table_privilege('authenticated', 'public.user_responses', 'insert') as ins,
         has_table_privilege('authenticated', 'public.user_responses', 'update') as upd,
         has_table_privilege('authenticated', 'public.user_responses', 'delete') as del,
         has_table_privilege('authenticated', 'public.user_responses', 'truncate') as trunc`)
equal(authPrivs[0], { sel: true, ins: true, upd: true, del: false, trunc: false },
  'authenticated keeps only select/insert/update; delete and truncate are revoked')

const fnPrivs = await rows(`
  select has_function_privilege('anon', 'public.section1_answers_are_complete(text[])', 'EXECUTE') as anon_validator,
         has_function_privilege('authenticated', 'public.section1_answers_are_complete(text[])', 'EXECUTE') as auth_validator,
         has_function_privilege('anon', 'public.enforce_section1_completion()', 'EXECUTE') as anon_guard,
         has_function_privilege('authenticated', 'public.enforce_section1_completion()', 'EXECUTE') as auth_guard,
         has_function_privilege('anon', 'public.downgrade_section1_on_invalid_answers()', 'EXECUTE') as anon_downgrade,
         has_function_privilege('authenticated', 'public.downgrade_section1_on_invalid_answers()', 'EXECUTE') as auth_downgrade`)
equal(fnPrivs[0], {
  anon_validator: false, auth_validator: false,
  anon_guard: false, auth_guard: false,
  anon_downgrade: false, auth_downgrade: false
}, 'no client role may EXECUTE the validator or either guard directly')

// R4: the option bank stays complete and private.
const optionBank = await rows(`
  select count(*)::int as rows, count(distinct question_number)::int as questions
    from public.section1_question_options`)
equal(optionBank[0].rows, 200, 'the option bank must hold 200 options')
equal(optionBank[0].questions, 50, 'the option bank must cover 50 questions')
const malformed = await rows(`
  select count(*)::int as n from (
    select question_number from public.section1_question_options
     group by question_number having count(*) <> 4) malformed`)
equal(malformed[0].n, 0, 'every question must have exactly four options')

const cutoverTableGrants = await rows(`
  select count(*)::int as n from information_schema.role_table_grants
   where table_schema = 'public' and table_name in ('section1_question_options', 'section1_legacy_cutover')
     and grantee in ('anon', 'authenticated')`)
equal(cutoverTableGrants[0].n, 0, 'no client role may hold a privilege on the option bank or the cutover marker')

await asRole('authenticated', A, async () => {
  await expectError('authenticated option-bank read', 'select * from public.section1_question_options', /permission denied/i)
  await expectError('authenticated cutover-marker read', 'select * from public.section1_legacy_cutover', /permission denied/i)
  await expectError('authenticated validator call',
    "select public.section1_answers_are_complete(array['x']::text[])", /permission denied/i)
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
// 2. A real user retakes Section 1 after the cutover
// ---------------------------------------------------------------------------
await asRole('authenticated', B, () =>
  rows('insert into public.user_responses (user_id, responses_array) values ($1, $2)', [B, VALID])
)
const validClaim = await asRole('authenticated', B, () =>
  rows('update public.users set section1_complete = true, section1_last_edited = now() where id = $1 returning section1_complete, section1_progress', [B])
)
equal(validClaim[0].section1_complete, true, '50 valid current answers may be marked complete')
equal(validClaim[0].section1_progress, 50, 'a valid completion stores the pointer as 50')

// ---------------------------------------------------------------------------
// 3. Second application: the destructive reset is refused
// ---------------------------------------------------------------------------
const beforeSecond = {
  answers: await rows('select user_id, responses_array from public.user_responses order by user_id'),
  flags: await rows('select id, section1_complete, section1_progress, section1_last_edited from public.users order by id'),
  cutover: await rows('select * from public.section1_legacy_cutover')
}

await db.exec(migration)

const afterSecond = {
  answers: await rows('select user_id, responses_array from public.user_responses order by user_id'),
  flags: await rows('select id, section1_complete, section1_progress, section1_last_edited from public.users order by id'),
  cutover: await rows('select * from public.section1_legacy_cutover')
}

equal(afterSecond.answers, beforeSecond.answers,
  're-running the migration must not delete answers submitted after the cutover')
equal(afterSecond.answers.length, 1, 'the post-cutover answer row still exists')
equal(afterSecond.answers[0].responses_array, VALID, 'the post-cutover answer text is unchanged')
equal(afterSecond.flags, beforeSecond.flags,
  're-running the migration must not reset completion state a second time')
equal(afterSecond.cutover, beforeSecond.cutover,
  'the one-time cutover marker is not rewritten on re-execution')
equal(await unrelatedSnapshot(), before,
  're-running the migration must still leave unrelated data untouched')

// ---------------------------------------------------------------------------
// 4. Completion integrity
// ---------------------------------------------------------------------------
// C has no answers and claims completion.
const forgedClaim = await asRole('authenticated', C, () =>
  rows('update public.users set section1_complete = true where id = $1 returning section1_complete, section1_progress', [C])
)
equal(forgedClaim[0].section1_complete, false, 'a completion claim with no answers must be reset')
equal(forgedClaim[0].section1_progress, 0, 'the rejected claim also resets the pointer')

// B replaces the valid set with a mostly-empty 50-slot array.
const sparse = Array.from({ length: 50 }, (_, index) => (index < 10 ? VALID[index] : null))
const sparseDowngrade = await asRole('authenticated', B, async () => {
  await db.query('update public.user_responses set responses_array = $1 where user_id = $2', [sparse, B])
  return rows('select section1_complete, section1_progress from public.users where id = $1', [B])
})
equal(sparseDowngrade[0].section1_complete, false, 'a partial 50-slot array cannot keep completion')
equal(sparseDowngrade[0].section1_progress, 0, 'the downgraded profile restarts at question 1')

// 50 numeric legacy values are not options.
const numeric = Array.from({ length: 50 }, () => '0')
await asRole('authenticated', B, () =>
  rows('update public.user_responses set responses_array = $1 where user_id = $2', [numeric, B])
)
const numericClaim = await asRole('authenticated', B, () =>
  rows('update public.users set section1_complete = true where id = $1 returning section1_complete', [B])
)
equal(numericClaim[0].section1_complete, false, '50 numeric legacy answers cannot be marked complete')

// 50 nonblank strings outside the bank are not options.
const outOfBank = Array.from({ length: 50 }, () => 'Not a real option')
await asRole('authenticated', B, () =>
  rows('update public.user_responses set responses_array = $1 where user_id = $2', [outOfBank, B])
)
const outOfBankClaim = await asRole('authenticated', B, () =>
  rows('update public.users set section1_complete = true where id = $1 returning section1_complete', [B])
)
equal(outOfBankClaim[0].section1_complete, false, 'out-of-bank strings cannot be marked complete')

// A real option from another question is still not this question's answer.
const wrongSlot = [...VALID]
wrongSlot[0] = section1Questions[1].options[0]
await asRole('authenticated', B, () =>
  rows('update public.user_responses set responses_array = $1 where user_id = $2', [wrongSlot, B])
)
const wrongSlotClaim = await asRole('authenticated', B, () =>
  rows('update public.users set section1_complete = true where id = $1 returning section1_complete', [B])
)
equal(wrongSlotClaim[0].section1_complete, false, 'an option from another question cannot be marked complete')

// A valid set still completes, and the stored text is exact.
await asRole('authenticated', B, () =>
  rows('update public.user_responses set responses_array = $1 where user_id = $2', [VALID, B])
)
const reClaim = await asRole('authenticated', B, () =>
  rows('update public.users set section1_complete = true where id = $1 returning section1_complete, section1_progress', [B])
)
equal(reClaim[0].section1_complete, true, 'a valid current answer set may be completed again')
equal(reClaim[0].section1_progress, 50, 'valid completion sets progress 50')

const stored = await asRole('authenticated', B, () =>
  rows('select responses_array from public.user_responses where user_id = $1', [B])
)
equal(stored[0].responses_array, VALID, 'the valid answer text is persisted unchanged')

// The pointer is clamped to the questionnaire length.
const clamped = await asRole('authenticated', B, () =>
  rows('update public.users set section1_progress = 999 where id = $1 returning section1_progress', [B])
)
equal(clamped[0].section1_progress, 50, 'progress is clamped to 50')

// Removing the answers removes the completion it was based on.
await asRole('authenticated', B, async () => {
  await expectError('client delete', 'delete from public.user_responses', /permission denied/i)
})

await db.query('delete from public.user_responses where user_id = $1', [B])
const afterOwnerDelete = await rows('select section1_complete, section1_progress from public.users where id = $1', [B])
equal(afterOwnerDelete[0].section1_complete, false, 'deleting the answers downgrades completion')
equal(afterOwnerDelete[0].section1_progress, 0, 'deleting the answers resets the pointer')

// ---------------------------------------------------------------------------
// 5. Owner access, cross-user denial
// ---------------------------------------------------------------------------
await asRole('authenticated', B, () =>
  rows('insert into public.user_responses (user_id, responses_array) values ($1, $2)', [B, VALID])
)
const bComplete = await asRole('authenticated', B, () =>
  rows('update public.users set section1_complete = true where id = $1 returning section1_complete', [B])
)
equal(bComplete[0].section1_complete, true, 'a retaken profile can complete again after the cutover')

const bView = await asRole('authenticated', B, () =>
  rows('select user_id, responses_array from public.user_responses')
)
equal(bView.map(row => row.user_id), [B], 'an owner reads exactly their own answer row')
ok(bView[0].responses_array.every(value => typeof value === 'string'), 'answers are text for the owner')

const crossRead = await asRole('authenticated', C, () =>
  rows('select user_id from public.user_responses where user_id = $1', [B])
)
equal(crossRead, [], 'another signed-in user cannot read the row by id')

const crossUpdate = await asRole('authenticated', C, () =>
  rows('update public.user_responses set responses_array = $1 where user_id = $2 returning user_id', [VALID, B])
)
equal(crossUpdate, [], 'another signed-in user cannot update the row')

const crossInsert = await asRole('authenticated', C, async () => {
  let failed = false
  try {
    await db.query('insert into public.user_responses (user_id, responses_array) values ($1, $2)', [A, VALID])
  } catch (error) {
    // Only the RLS WITH CHECK violation proves the guard. A duplicate-key error
    // would mean the row already existed, which is a different fact.
    failed = /row-level security/i.test(String(error.message))
  }
  return failed
})
ok(crossInsert, 'a signed-in user cannot insert an answer row for someone else (RLS WITH CHECK)')

// ---------------------------------------------------------------------------
// 6. The migration text stays inside its scope
// ---------------------------------------------------------------------------
// Option text is data, not a table reference: scope checks run on the code
// outside the generated bank.
const bankStart = migration.indexOf('-- BEGIN GENERATED SECTION1 OPTION BANK')
const bankEnd = migration.indexOf('-- END GENERATED SECTION1 OPTION BANK')
const outsideBank = migration.slice(0, bankStart) + migration.slice(bankEnd)
const codeLines = outsideBank
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n')
const deleteStatements = codeLines.match(/delete\s+from\s+public\.user_responses/gi) || []
equal(deleteStatements.length, 1, 'the migration must contain exactly one delete of legacy answers')
ok(!/^\s*truncate\b/im.test(codeLines), 'the migration must not truncate')
ok(!/drop\s+table/i.test(codeLines), 'the migration must not drop tables')
ok(!/section2|payment|connect_unlock|force_connect|matches\b|messages\b|conversations\b/i.test(codeLines),
  'the migration must not touch Section 2, payments, Connect, matches or messages')
ok(!/SECTION1_DIMENSION|dimensionQuestions|communication:|expectations:|values:/i.test(codeLines),
  'the migration must not change scoring weights or dimension mapping')

// Eligibility, as match-generator reads it: only a currently valid completion.
const eligible = await rows('select id from public.users where section1_complete = true order by id')
equal(eligible.map(row => row.id), [B], 'only the retaken, valid profile is eligible for matching')

// ---------------------------------------------------------------------------
// 7. A backdated post-cutover answer survives an ordinary rerun
// ---------------------------------------------------------------------------
// created_at is client-supplied and can legitimately be older than the cutover
// marker, so a row's timestamp cannot distinguish a legacy answer from a new
// one. This is the exact shape the removed `created_at < executed_at`
// post-check rejected: A submits a valid 50-answer set stamped one month
// before the marker and completes, then the migration runs again. Deletion is
// driven by the marker alone, so the rerun must succeed and leave the row --
// contents and timestamp -- untouched.
const marker = await rows(
  'select executed_at, deleted_response_rows, reset_user_profiles from public.section1_legacy_cutover'
)
equal(marker.length, 1, 'the cutover marker exists before the backdated-answer test')

const backdatedStamp = new Date(
  new Date(marker[0].executed_at).getTime() - 30 * 24 * 60 * 60 * 1000
)
const backdatedCreatedAt = (await asRole('authenticated', A, () =>
  rows(
    `insert into public.user_responses (user_id, responses_array, created_at)
     values ($1, $2, $3::timestamptz)
     returning created_at`,
    [A, VALID, backdatedStamp]
  )
))[0].created_at
ok(new Date(backdatedCreatedAt) < new Date(marker[0].executed_at),
  'the fixture answer is genuinely stamped before the cutover marker')

const backdatedClaim = await asRole('authenticated', A, () =>
  rows('update public.users set section1_complete = true, section1_last_edited = now() where id = $1 returning section1_complete, section1_progress', [A])
)
equal(backdatedClaim[0].section1_complete, true,
  'a valid backdated 50-answer set may complete through the guarded path')
equal(backdatedClaim[0].section1_progress, 50, 'the guarded completion stores progress 50')

const beforeThird = {
  answers: await rows('select user_id, responses_array, created_at from public.user_responses order by user_id'),
  flags: await rows('select id, section1_complete, section1_progress, section1_last_edited from public.users order by id'),
  cutover: await rows('select * from public.section1_legacy_cutover')
}

let rerunError = null
try {
  await db.exec(migration)
} catch (caught) {
  rerunError = caught
}
ok(rerunError === null,
  `a backdated post-cutover answer must not fail a rerun, got "${rerunError?.message}"`)

const afterThird = {
  answers: await rows('select user_id, responses_array, created_at from public.user_responses order by user_id'),
  flags: await rows('select id, section1_complete, section1_progress, section1_last_edited from public.users order by id'),
  cutover: await rows('select * from public.section1_legacy_cutover')
}

equal(afterThird.answers, beforeThird.answers,
  'the backdated answer row survives a rerun unchanged, including its created_at')
equal(afterThird.answers.filter(row => row.user_id === A).length, 1,
  'the backdated row was not deleted by the rerun')
equal(afterThird.flags, beforeThird.flags,
  'legitimate completion and progress survive a rerun that also sees a backdated row')
equal(afterThird.flags.filter(row => row.id === A)[0].section1_complete, true,
  'the backdated completion is still recorded after the rerun')
equal(afterThird.flags.filter(row => row.id === A)[0].section1_progress, 50,
  'the backdated completion keeps progress 50 after the rerun')
equal(afterThird.cutover, beforeThird.cutover,
  'the cutover marker is not rewritten by the rerun')
equal(await unrelatedSnapshot(), before,
  'the rerun that sees a backdated answer still leaves unrelated data untouched')

// ---------------------------------------------------------------------------
// 8. A first run that cannot reset every profile must roll back entirely
// ---------------------------------------------------------------------------
// The cutover asserts "every profile is incomplete / progress 0 / no stamp"
// and "no answer row survived the deletion" before it records the marker. A statement trigger that restores progress
// right after the reset makes that assertion fail, so the whole file must be
// rolled back: no marker, no deletion, no reset, column still integer[].
// A disposable database holding only the objects the migration touches, used
// to prove that a sabotaged first run aborts instead of committing half of the
// cutover. Two saboteurs cover the two first-run assertions: the reset
// postcondition, and "no answer row survived the deletion".
async function createMinimalLegacyDb() {
  const scratch = new PGlite()
  await scratch.exec(`
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
    section1_complete boolean default false,
    section1_progress integer default 0,
    section1_last_edited timestamptz
  );

  create table public.user_responses (
    user_id uuid primary key references public.users(id) on delete cascade,
    responses_array integer[] not null,
    created_at timestamptz default now()
  );

  alter table public.users enable row level security;
  alter table public.user_responses enable row level security;

  create policy "Allow users full operational control over their own response ro"
    on public.user_responses for all to authenticated
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

  grant all on public.user_responses to anon, authenticated;
`)
  await scratch.query(
    `insert into public.users (id, section1_complete, section1_progress, section1_last_edited)
     values ($1, true, 39, '2026-01-02T00:00:00Z'), ($2, false, 0, null)`,
    [A, B]
  )
  await scratch.query(
    'insert into public.user_responses (user_id, responses_array) values ($1, $2::integer[])',
    [A, LEGACY]
  )
  return scratch
}

async function cutoverState(database) {
  return (await database.query(`
    select
      (select format_type(a.atttypid, a.atttypmod)
         from pg_attribute a
        where a.attrelid = 'public.user_responses'::regclass
          and a.attname = 'responses_array') as type,
      (select to_regclass('public.section1_legacy_cutover')::text) as marker_table,
      (select to_regclass('public.section1_question_options')::text) as option_table,
      (select count(*)::int from public.user_responses) as response_rows,
      (select count(*)::int from pg_trigger
        where tgname like 'trg_section1%' and not tgisinternal) as guards,
      (select section1_complete from public.users where id = '${A}') as a_complete,
      (select section1_progress from public.users where id = '${A}') as a_progress
  `)).rows[0]
}

const sabotageDb = await createMinimalLegacyDb()
// Any UPDATE on users leaves A at progress 7, so the reset can never be complete.
await sabotageDb.exec(`
  create function public.zz_sabotage_reset() returns trigger
    language plpgsql
    as $$
    begin
      if pg_trigger_depth() > 1 then
        return null;
      end if;
      update public.users set section1_progress = 7 where id = '${A}';
      return null;
    end $$;

  create trigger zz_sabotage_reset
    after update on public.users
    for each statement
    execute function public.zz_sabotage_reset();
`)

let cutoverError = null
try {
  await sabotageDb.exec(migration)
} catch (caught) {
  cutoverError = caught
}
ok(cutoverError !== null, 'a first run that leaves a profile un-reset must raise')
ok(/cutover post-check/.test(String(cutoverError?.message)),
  `the failure must name the reset post-check, got "${cutoverError?.message}"`)

const afterFailure = await cutoverState(sabotageDb)
equal(afterFailure.type, 'integer[]', 'the failed run must leave the legacy column type untouched')
equal(afterFailure.marker_table, null, 'the failed run must not record a cutover marker')
equal(afterFailure.option_table, null, 'the failed run must not leave the option bank behind')
equal(afterFailure.guards, 0, 'the failed run must not install the guards')
equal(afterFailure.response_rows, 1, 'the failed run must not delete the legacy answers')
equal(afterFailure.a_complete, true, 'the failed run must not reset completion')
equal(afterFailure.a_progress, 39, 'the failed run must not reset the pointer')
await sabotageDb.close()

// ---------------------------------------------------------------------------
// 9. A deletion that leaves a row behind must abort the first run
// ---------------------------------------------------------------------------
// The "nothing survived the deletion" assertion runs inside the cutover
// transaction. A statement trigger that re-inserts a legacy row right after the
// DELETE must make the whole file fail and roll back, so the marker, the column
// change and the reset never commit independently of the deletion.
const survivorDb = await createMinimalLegacyDb()
await survivorDb.exec(`
  create function public.zz_sabotage_survivor() returns trigger
    language plpgsql
    as $$
    begin
      insert into public.user_responses (user_id, responses_array)
        values ('${A}', array[0, 0, 0]::integer[]);
      return null;
    end $$;

  create trigger zz_sabotage_survivor
    after delete on public.user_responses
    for each statement
    execute function public.zz_sabotage_survivor();
`)

let survivorError = null
try {
  await survivorDb.exec(migration)
} catch (caught) {
  survivorError = caught
}
ok(survivorError !== null, 'a deletion that leaves a row behind must abort the first run')
ok(/answer rows remain after the legacy deletion/.test(String(survivorError?.message)),
  `the failure must name the deletion post-check, got "${survivorError?.message}"`)

const afterSurvivor = await cutoverState(survivorDb)
equal(afterSurvivor.type, 'integer[]', 'the aborted run must leave the legacy column type untouched')
equal(afterSurvivor.marker_table, null, 'the aborted run must not record a cutover marker')
equal(afterSurvivor.option_table, null, 'the aborted run must not leave the option bank behind')
equal(afterSurvivor.guards, 0, 'the aborted run must not install the guards')
equal(afterSurvivor.response_rows, 1, 'the aborted run must roll the deletion back, leaving the legacy answer in place')
equal(afterSurvivor.a_complete, true, 'the aborted run must not reset completion')
equal(afterSurvivor.a_progress, 39, 'the aborted run must not reset the pointer')
await survivorDb.close()

// ---------------------------------------------------------------------------
// 10. text[] without the cutover marker must be refused, not guessed
// ---------------------------------------------------------------------------
// If the marker disappears while the column is already text[], the file cannot
// tell a legacy row from a live one. It must stop and leave the live answers
// alone rather than run the destructive cutover a second time.
const refusalDb = await createMinimalLegacyDb()
await refusalDb.exec(migration)
await refusalDb.query(
  'insert into public.user_responses (user_id, responses_array) values ($1, $2)',
  [A, VALID]
)
await refusalDb.query(
  'update public.users set section1_complete = true where id = $1', [A]
)
await refusalDb.exec('delete from public.section1_legacy_cutover')

let refusalError = null
try {
  await refusalDb.exec(migration)
} catch (caught) {
  refusalError = caught
}
ok(refusalError !== null, 'text[] with no cutover marker must be refused')
ok(/already text\[\] and no cutover marker/.test(String(refusalError?.message)),
  `the refusal must name the missing marker, got "${refusalError?.message}"`)

const afterRefusal = await refusalDb.query(
  'select user_id, responses_array from public.user_responses order by user_id'
)
equal(afterRefusal.rows.map(row => row.user_id), [A],
  'the refused run must not delete the post-cutover answer row')
equal(afterRefusal.rows[0].responses_array, VALID,
  'the refused run must leave the post-cutover answer text intact')
const refusalFlags = (await refusalDb.query(
  'select section1_complete, section1_progress from public.users where id = $1', [A]
)).rows[0]
equal(refusalFlags.section1_complete, true, 'the refused run must not reset completion')
equal(refusalFlags.section1_progress, 50, 'the refused run must not reset progress')
await refusalDb.close()

// ---------------------------------------------------------------------------
// 11. A failure after the cutover must roll back the whole file, not just the
//     cutover block. This is the property the documented `psql -1` run relies
//     on, so it is asserted through the same execution shape: one batch of
//     statements whose last statement fails.
// ---------------------------------------------------------------------------
async function policyNames(database) {
  return (await database.query(`
    select p.polname as name
      from pg_policy p
     where p.polrelid = 'public.user_responses'::regclass
     order by 1`)).rows.map(row => row.name)
}

const lateDb = await createMinimalLegacyDb()
const latePolicies = await policyNames(lateDb)
const lateBefore = await cutoverState(lateDb)

let lateError = null
try {
  // Statements after the cutover succeed, then the batch fails. If the batch
  // were not one transaction, the delete, the reset, the marker, the type
  // change, the guards and this probe table would all have committed.
  await lateDb.exec(`${migration}
    create table public.zz_late_probe (id int);
    do $$ begin raise exception 'deliberate late failure after the cutover'; end $$;
  `)
} catch (caught) {
  lateError = caught
}
ok(lateError !== null, 'a statement failing after the cutover must abort the run')
ok(/deliberate late failure after the cutover/.test(String(lateError?.message)),
  `the failure must be the late probe, got "${lateError?.message}"`)

const lateAfter = await cutoverState(lateDb)
equal(lateAfter.type, 'integer[]', 'the late failure must roll the column type change back')
equal(lateAfter.marker_table, null, 'the late failure must roll the cutover marker back')
equal(lateAfter.option_table, null, 'the late failure must roll the option bank back')
equal(lateAfter.guards, 0, 'the late failure must roll the guards back')
equal(lateAfter.response_rows, 1, 'the late failure must restore the deleted legacy answer row')
equal(lateAfter.a_complete, true, 'the late failure must restore completion')
equal(lateAfter.a_progress, 39, 'the late failure must restore the pointer')
equal(await policyNames(lateDb), latePolicies,
  'the late failure must restore the policies the file replaced')
equal((await lateDb.query(`
  select to_regclass('public.zz_late_probe')::text as probe,
         (select count(*)::int from pg_proc
           where pronamespace = 'public'::regnamespace
             and proname in ('section1_answers_are_complete', 'enforce_section1_completion',
                             'downgrade_section1_on_invalid_answers')) as functions`)).rows[0],
  { probe: null, functions: 0 },
  'the late failure must roll back a table created earlier in the same batch and every function')
equal({ ...lateBefore }, { ...lateAfter }, 'the complete pre-run state is restored field by field')

// The same database then migrates cleanly: the abort above was the probe, not a
// defect that would block the real run.
await lateDb.exec(migration)
const lateRetry = await cutoverState(lateDb)
equal(lateRetry.type, 'text[]', 'the retry after the late failure converts the column')
equal(lateRetry.response_rows, 0, 'the retry deletes the legacy answer row')
equal(lateRetry.marker_table, 'section1_legacy_cutover', 'the retry records the marker')
await lateDb.close()

// ---------------------------------------------------------------------------
// 12. The transaction probe the file uses really detects "no transaction"
// ---------------------------------------------------------------------------
// A temp table created `on commit drop` survives only while its transaction is
// open. Executed on its own it is gone by the time the next statement runs, so
// the file's section-0 guard cannot see it and refuses to run. (A module-level
// note explains why the guard is not fired end-to-end here.)
const probeDb = new PGlite()
await probeDb.exec('create temp table section1_atomicity_probe (ok boolean) on commit drop')
equal((await probeDb.query("select to_regclass('pg_temp.section1_atomicity_probe')::text as found")).rows[0].found,
  null,
  'outside a transaction the probe table is gone, so the file\'s guard reports "not in a transaction"')
ok(migration.includes("to_regclass('pg_temp.section1_atomicity_probe') is null"),
  'the migration must contain the transaction guard that reads that probe table')
await probeDb.close()

// ---------------------------------------------------------------------------
// 13. Case A — marker present, column still integer[], legacy rows present
// ---------------------------------------------------------------------------
// A marker with the legacy schema means a previous run did not complete. The
// file must not repeat the deletion and must not convert the rows: it stops.
async function createMarkerTable(database) {
  await database.exec(`
    create table public.section1_legacy_cutover (
      singleton boolean primary key default true,
      executed_at timestamptz not null default now(),
      deleted_response_rows integer not null,
      reset_user_profiles integer not null,
      constraint section1_legacy_cutover_singleton check (singleton)
    )
  `)
}

const markerLegacyDb = await createMinimalLegacyDb()
await createMarkerTable(markerLegacyDb)
await markerLegacyDb.query(
  'insert into public.section1_legacy_cutover (deleted_response_rows, reset_user_profiles) values (1, 2)'
)
let markerLegacyError = null
try {
  await markerLegacyDb.exec(migration)
} catch (caught) {
  markerLegacyError = caught
}
ok(markerLegacyError !== null, 'a marker with an integer[] column must be refused')
ok(/marker exists but responses_array is integer\[\]/.test(String(markerLegacyError?.message)),
  `the refusal must name the marker/schema disagreement, got "${markerLegacyError?.message}"`)
const markerLegacyState = await cutoverState(markerLegacyDb)
equal(markerLegacyState.type, 'integer[]', 'the refused run must not convert the legacy column')
equal(markerLegacyState.response_rows, 1, 'the refused run must not delete the legacy answer')
equal(markerLegacyState.a_complete, true, 'the refused run must not reset completion')
equal(markerLegacyState.a_progress, 39, 'the refused run must not reset the pointer')
equal((await markerLegacyDb.query(
  'select deleted_response_rows, reset_user_profiles from public.section1_legacy_cutover'
)).rows[0], { deleted_response_rows: 1, reset_user_profiles: 2 },
  'the refused run must not rewrite the existing marker')
await markerLegacyDb.close()

// ---------------------------------------------------------------------------
// 14. Case B — the marker table exists but is empty
// ---------------------------------------------------------------------------
// An empty marker table does not mean "a cutover happened"; with integer[] the
// schema proves none did, so the documented behaviour is to run the first
// cutover. (The text[] variant of the same state is Case D, refused.)
const emptyMarkerDb = await createMinimalLegacyDb()
await createMarkerTable(emptyMarkerDb)
await emptyMarkerDb.exec(migration)
const emptyMarkerState = await cutoverState(emptyMarkerDb)
equal(emptyMarkerState.type, 'text[]', 'an empty marker table plus integer[] must run the cutover')
equal(emptyMarkerState.response_rows, 0, 'the cutover runs: the legacy answer is deleted')
equal((await emptyMarkerDb.query(
  'select deleted_response_rows, reset_user_profiles from public.section1_legacy_cutover'
)).rows[0], { deleted_response_rows: 1, reset_user_profiles: 2 },
  'the cutover records the marker it did not inherit')
await emptyMarkerDb.close()

// ---------------------------------------------------------------------------
// 14b. The marker table exists with a shape this file cannot read
// ---------------------------------------------------------------------------
const wrongShapeDb = await createMinimalLegacyDb()
await wrongShapeDb.exec('create table public.section1_legacy_cutover (id int)')
let wrongShapeError = null
try {
  await wrongShapeDb.exec(migration)
} catch (caught) {
  wrongShapeError = caught
}
ok(wrongShapeError !== null, 'an unreadable marker table must be refused')
ok(/already exists without the column/.test(String(wrongShapeError?.message)),
  `the refusal must name the unreadable marker table, got "${wrongShapeError?.message}"`)
equal((await cutoverState(wrongShapeDb)).response_rows, 1,
  'the refused run must not delete the legacy answers')
equal((await cutoverState(wrongShapeDb)).type, 'integer[]',
  'the refused run must not convert the column')
await wrongShapeDb.close()

// ---------------------------------------------------------------------------
// 15. Case C2 — marker present, text[] column, converted legacy rows left over
// ---------------------------------------------------------------------------
// The confirmed defect: a marker plus numeric-only rows is the signature of a
// partial run that skipped the deletion and converted the answers. A rerun must
// refuse instead of preserving those rows as if they were answers.
const numericLeftoverDb = await createMinimalLegacyDb()
await numericLeftoverDb.exec(migration)
await numericLeftoverDb.query(
  'insert into public.user_responses (user_id, responses_array) values ($1, $2::text[])',
  [B, LEGACY.map(String)]
)
let numericLeftoverError = null
try {
  await numericLeftoverDb.exec(migration)
} catch (caught) {
  numericLeftoverError = caught
}
ok(numericLeftoverError !== null, 'numeric-only rows under an existing marker must be refused')
ok(/hold only numeric values/.test(String(numericLeftoverError?.message)),
  `the refusal must name the converted legacy rows, got "${numericLeftoverError?.message}"`)
equal((await numericLeftoverDb.query(
  'select count(*)::int as n from public.user_responses where user_id = $1', [B]
)).rows[0].n, 1, 'the refused rerun must leave the numeric row untouched')
await numericLeftoverDb.close()

// ---------------------------------------------------------------------------
// 15b. Numeric strings mixed with NULLs are the same signature
// ---------------------------------------------------------------------------
// A converted legacy row may be sparse: NULL elements must not clear the
// suspicion, as long as at least one element is a numeric string and none is
// nonnumeric text. The refusal must leave every answer, profile, the schema
// and the marker exactly as they were.
const nullMixedDb = await createMinimalLegacyDb()
await nullMixedDb.exec(migration)
const nullMixed = ['0', null, '1', null, '3']
await nullMixedDb.query(
  'insert into public.user_responses (user_id, responses_array) values ($1, $2::text[])',
  [B, nullMixed]
)
const nullMixedBefore = {
  answers: (await nullMixedDb.query(
    'select user_id, responses_array from public.user_responses order by user_id'
  )).rows,
  users: (await nullMixedDb.query(
    'select id, section1_complete, section1_progress, section1_last_edited from public.users order by id'
  )).rows,
  type: (await cutoverState(nullMixedDb)).type,
  marker: (await nullMixedDb.query(
    'select singleton, deleted_response_rows, reset_user_profiles from public.section1_legacy_cutover'
  )).rows
}
let nullMixedError = null
try {
  await nullMixedDb.exec(migration)
} catch (caught) {
  nullMixedError = caught
}
ok(nullMixedError !== null, 'numeric-with-NULL rows under an existing marker must be refused')
ok(/hold only numeric values \(NULL elements allowed\)/.test(String(nullMixedError?.message)),
  `the refusal must name the numeric signature, got "${nullMixedError?.message}"`)
const nullMixedAfter = {
  answers: (await nullMixedDb.query(
    'select user_id, responses_array from public.user_responses order by user_id'
  )).rows,
  users: (await nullMixedDb.query(
    'select id, section1_complete, section1_progress, section1_last_edited from public.users order by id'
  )).rows,
  type: (await cutoverState(nullMixedDb)).type,
  marker: (await nullMixedDb.query(
    'select singleton, deleted_response_rows, reset_user_profiles from public.section1_legacy_cutover'
  )).rows
}
equal(nullMixedAfter.answers, nullMixedBefore.answers,
  'the refused rerun must leave every answer row untouched')
equal(nullMixedAfter.users, nullMixedBefore.users,
  'the refused rerun must leave profile Section 1 state untouched')
equal(nullMixedAfter.type, 'text[]',
  'the refused rerun must not change the column type')
equal(nullMixedAfter.marker, nullMixedBefore.marker,
  'the refused rerun must not touch the cutover marker')
await nullMixedDb.close()

// ---------------------------------------------------------------------------
// 15c. Legitimate partial option text with NULLs is NOT that signature
// ---------------------------------------------------------------------------
// Current answers are option text plus NULLs for unanswered slots. That is the
// normal post-cutover shape and must not be mistaken for converted legacy
// data, even under an existing marker.
const legitPartialDb = await createMinimalLegacyDb()
await legitPartialDb.exec(migration)
const legitPartial = [VALID[0], null, VALID[2], null, null]
await legitPartialDb.query(
  'insert into public.user_responses (user_id, responses_array) values ($1, $2::text[])',
  [B, legitPartial]
)
let legitPartialError = null
try {
  await legitPartialDb.exec(migration)
} catch (caught) {
  legitPartialError = caught
}
ok(legitPartialError === null,
  `legitimate option text with NULLs must not fail a rerun, got "${legitPartialError?.message}"`)
equal((await legitPartialDb.query(
  'select responses_array from public.user_responses where user_id = $1', [B]
)).rows[0].responses_array, legitPartial,
  'the legitimate partial row survives the rerun unchanged')
await legitPartialDb.close()

// ---------------------------------------------------------------------------
// 15d. Documented limitation: an ALL-NULL row is not flagged
// ---------------------------------------------------------------------------
// A row whose elements are all NULL cannot be distinguished from legitimate
// (untouched) partial data, so the predicate deliberately does not flag it.
// This test pins that limitation so a future change cannot silently claim more.
const allNullDb = await createMinimalLegacyDb()
await allNullDb.exec(migration)
await allNullDb.query(
  'insert into public.user_responses (user_id, responses_array) values ($1, $2::text[])',
  [B, [null, null, null]]
)
let allNullError = null
try {
  await allNullDb.exec(migration)
} catch (caught) {
  allNullError = caught
}
ok(allNullError === null,
  `an all-NULL row must not be flagged as converted legacy data, got "${allNullError?.message}"`)
await allNullDb.close()

// ---------------------------------------------------------------------------
// 15e. A marker table with the expected column names but NULLABLE counts,
//      holding a marker row with NULL counts
// ---------------------------------------------------------------------------
// `NULL < 0` evaluates to NULL, not true, so malformed-marker predicates of
// the shape `count < 0` alone let a NULL count pass both cutover checks. The
// structure check refuses the table instead: the counts this file writes are
// `integer NOT NULL`. The refusal must leave data, profile state, schema and
// the marker row exactly as they were.
const nullableMarkerDb = await createMinimalLegacyDb()
await nullableMarkerDb.exec(`
  create table public.section1_legacy_cutover (
    singleton boolean default true,
    executed_at timestamptz default now(),
    deleted_response_rows integer,
    reset_user_profiles integer
  );
  insert into public.section1_legacy_cutover (deleted_response_rows, reset_user_profiles)
       values (null, null);
`)
const nullableSnapshot = async () => ({
  answers: (await nullableMarkerDb.query(
    'select user_id, responses_array from public.user_responses order by user_id')).rows,
  users: (await nullableMarkerDb.query(
    'select id, section1_complete, section1_progress, section1_last_edited from public.users order by id')).rows,
  type: (await cutoverState(nullableMarkerDb)).type,
  marker: (await nullableMarkerDb.query(
    'select singleton, deleted_response_rows, reset_user_profiles from public.section1_legacy_cutover')).rows
})
const nullableBefore = await nullableSnapshot()
let nullableError = null
try {
  await nullableMarkerDb.exec(migration)
} catch (caught) {
  nullableError = caught
}
ok(nullableError !== null,
  'a marker table with nullable counts and a NULL marker row must be refused')
ok(/does not match the marker structure/.test(String(nullableError?.message)),
  `the refusal must name the marker structure mismatch, got "${nullableError?.message}"`)
const nullableAfter = await nullableSnapshot()
equal(nullableAfter.answers, nullableBefore.answers,
  'the refused run must leave every answer row untouched')
equal(nullableAfter.users, nullableBefore.users,
  'the refused run must leave profile Section 1 state untouched')
equal(nullableAfter.type, 'integer[]',
  'the refused run must not convert the legacy column')
equal(nullableAfter.marker, nullableBefore.marker,
  'the refused run must leave the NULL marker row unchanged')
await nullableMarkerDb.close()

// ---------------------------------------------------------------------------
// 15f. Right column names, wrong types: matching names alone are refused
// ---------------------------------------------------------------------------
// The structure this file writes is boolean / timestamptz / integer / integer,
// all NOT NULL. A `timestamp` (no zone) or `bigint` count is not that marker,
// so it must be refused before anything reads it.
const wrongTypeMarkerDb = await createMinimalLegacyDb()
await wrongTypeMarkerDb.exec(`
  create table public.section1_legacy_cutover (
    singleton boolean primary key default true,
    executed_at timestamp not null default now(),
    deleted_response_rows bigint not null,
    reset_user_profiles bigint not null,
    constraint section1_legacy_cutover_singleton check (singleton)
  );
  insert into public.section1_legacy_cutover (deleted_response_rows, reset_user_profiles) values (1, 2);
`)
let wrongTypeError = null
try {
  await wrongTypeMarkerDb.exec(migration)
} catch (caught) {
  wrongTypeError = caught
}
ok(wrongTypeError !== null,
  'a marker table with wrong column types must be refused')
ok(/does not match the marker structure/.test(String(wrongTypeError?.message)),
  `the refusal must name the marker structure mismatch, got "${wrongTypeError?.message}"`)
ok(/executed_at timestamp without time zone NOT NULL/.test(String(wrongTypeError?.message)),
  `the refusal must name the wrong column type, got "${wrongTypeError?.message}"`)
equal((await cutoverState(wrongTypeMarkerDb)).response_rows, 1,
  'the refused run must leave the legacy answer intact')
equal((await cutoverState(wrongTypeMarkerDb)).type, 'integer[]',
  'the refused run must not convert the column')
await wrongTypeMarkerDb.close()

// ---------------------------------------------------------------------------
// 16. Lock strategy: the file takes the intended lock modes and a short
//     lock_timeout inside its transaction
// ---------------------------------------------------------------------------
// This proves the locks are requested and held for the transaction. It does NOT
// simulate a concurrent client: PGlite is a single-connection engine, so the
// blocking behaviour itself is argued from the lock-compatibility table and is
// reported as not dynamically tested.
const lockDb = await createMinimalLegacyDb()
await lockDb.exec('begin')
await lockDb.exec(migration)
const lockState = (await lockDb.query(`
  select current_setting('lock_timeout') as lock_timeout,
         (select string_agg(distinct l.mode, ',')
            from pg_locks l
           where l.locktype = 'relation'
             and l.relation = 'public.user_responses'::regclass
             and l.pid = pg_backend_pid()) as responses_modes,
         (select string_agg(distinct l.mode, ',')
            from pg_locks l
           where l.locktype = 'relation'
             and l.relation = 'public.users'::regclass
             and l.pid = pg_backend_pid()) as users_modes,
         (select count(*)::int from public.user_responses) as response_rows
`)).rows[0]
equal(lockState.lock_timeout, '5s', 'the migration sets an explicit 5s lock timeout')
ok(/AccessExclusiveLock/.test(lockState.responses_modes || ''),
  `user_responses must be held ACCESS EXCLUSIVE, got "${lockState.responses_modes}"`)
ok(/ShareRowExclusiveLock/.test(lockState.users_modes || ''),
  `users must be held SHARE ROW EXCLUSIVE, got "${lockState.users_modes}"`)

// The modes above are also taken later by `alter column ... type` and
// `create trigger`, so they cannot show WHEN the lock was acquired. What the
// race fix needs is the lock being held before the first destructive
// statement; that is asserted on the file's own ordering.
const responsesLockAt = migration.indexOf('lock table public.user_responses in access exclusive mode')
const usersLockAt = migration.indexOf('lock table public.users in share row exclusive mode')
const deleteAt = migration.indexOf('delete from public.user_responses')
const resetAt = migration.indexOf('update public.users')
ok(responsesLockAt > -1, 'the migration must lock user_responses explicitly')
ok(usersLockAt > -1, 'the migration must lock users explicitly')
ok(responsesLockAt < deleteAt,
  'ACCESS EXCLUSIVE on user_responses must be taken BEFORE the legacy delete')
ok(usersLockAt < resetAt,
  'SHARE ROW EXCLUSIVE on users must be taken BEFORE the global reset')
equal(lockState.response_rows, 0, 'the cutover ran inside that transaction')
await lockDb.exec('rollback')
const afterLockRollback = await cutoverState(lockDb)
equal(afterLockRollback.type, 'integer[]', 'rolling the transaction back restores the legacy column')
equal(afterLockRollback.response_rows, 1, 'rolling the transaction back restores the legacy answer')
await lockDb.close()

// ---------------------------------------------------------------------------
// 16b. FORCE ROW LEVEL SECURITY with a role that cannot bypass it
// ---------------------------------------------------------------------------
// The file sets `row_security = off` inside its required transaction. That does
// NOT bypass RLS: for a role subject to it — including the table owner when
// FORCE ROW LEVEL SECURITY is set — a statement that RLS would filter raises
// an error instead of silently affecting a subset of rows. Without that, a
// FORCE RLS table would let the DELETE, the global reset, the emptiness
// assertion and the reset postcondition all read the same filtered view, and
// the run would record a cutover that never happened. Here both tables are
// owned by a non-superuser, non-BYPASSRLS role with FORCE RLS on: the run must
// fail, roll back, and delete/reset nothing.
const forceRlsDb = await createMinimalLegacyDb()
await forceRlsDb.exec(`
  create role section1_runner nologin;
  grant usage, create on schema public to section1_runner;
  grant usage on schema auth to section1_runner;
  alter table public.users owner to section1_runner;
  alter table public.user_responses owner to section1_runner;
  alter table public.users force row level security;
  alter table public.user_responses force row level security;
`)
await forceRlsDb.exec('set role section1_runner')
let forceRlsError = null
try {
  await forceRlsDb.exec(migration)
} catch (caught) {
  forceRlsError = caught
}
await forceRlsDb.exec('reset role')
ok(forceRlsError !== null,
  'a FORCE RLS run by a non-BYPASSRLS role must fail, not partially succeed')
ok(/row-level security/.test(String(forceRlsError?.message)),
  `the failure must be the RLS refusal, got "${forceRlsError?.message}"`)
const forceRlsState = await cutoverState(forceRlsDb)
equal(forceRlsState.type, 'integer[]', 'the failed run must not convert the column')
equal(forceRlsState.response_rows, 1,
  'the failed run must not delete any answer row (no subset, no survivor)')
equal(forceRlsState.a_complete, true, 'the failed run must not reset completion')
equal(forceRlsState.a_progress, 39, 'the failed run must not reset progress')
equal(forceRlsState.marker_table, null, 'the failed run must not leave a cutover marker')
equal(forceRlsState.option_table, null, 'the failed run must not create the option bank')
equal(forceRlsState.guards, 0, 'the failed run must not install the completion guards')
await forceRlsDb.close()

// ---------------------------------------------------------------------------
// 17. Effective privileges, including inherited PUBLIC grants
// ---------------------------------------------------------------------------
const effective = (await rows(`
  select has_table_privilege('anon', 'public.section1_question_options', 'SELECT') as anon_bank,
         has_table_privilege('authenticated', 'public.section1_question_options', 'SELECT') as auth_bank,
         has_table_privilege('anon', 'public.section1_legacy_cutover', 'SELECT') as anon_marker,
         has_table_privilege('authenticated', 'public.section1_legacy_cutover', 'SELECT') as auth_marker,
         has_table_privilege('authenticated', 'public.user_responses', 'SELECT') as auth_select,
         has_table_privilege('authenticated', 'public.user_responses', 'INSERT') as auth_insert,
         has_table_privilege('authenticated', 'public.user_responses', 'UPDATE') as auth_update,
         has_table_privilege('authenticated', 'public.user_responses', 'REFERENCES') as auth_references,
         has_table_privilege('authenticated', 'public.user_responses', 'TRIGGER') as auth_trigger,
         has_table_privilege('anon', 'public.user_responses', 'SELECT') as anon_select
`))[0]
equal(effective, {
  anon_bank: false, auth_bank: false, anon_marker: false, auth_marker: false,
  auth_select: true, auth_insert: true, auth_update: true,
  auth_references: false, auth_trigger: false, anon_select: false
}, 'effective privileges (inherited PUBLIC included) match the intended set')

const publicGrants = (await rows(`
  select count(*)::int as n
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
   where c.oid in ('public.user_responses'::regclass,
                   'public.section1_question_options'::regclass,
                   'public.section1_legacy_cutover'::regclass)
     and acl.grantee = 0
`))[0]
equal(publicGrants.n, 0,
  'no PUBLIC grant remains on the response table, the option bank or the marker')

console.log(`Section 1 production migration checks passed: ${checks} assertions`)
console.log('Isolated PostgreSQL: legacy answers deleted, all profiles reset, unrelated data preserved, re-run refused')
console.log('Also proved: late-failure rollback, inconsistent-marker refusal, lock modes, effective privileges')
