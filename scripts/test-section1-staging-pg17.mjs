// Section 1 migration — PostgreSQL 17 staging test (rollback-safe).
//
//   SECTION1_STAGING_DB_URL="$STAGING_URL" node scripts/test-section1-staging-pg17.mjs
//
// The URL is never printed. The script refuses the production ref.
//
// Every write happens inside one transaction that is deliberately rolled back,
// including the migration itself. Existing staging rows are only used as
// fixtures and are restored by the rollback; no fixture user is created (the
// staging users table has an auth.users foreign key).
//
// What this exercises on real PostgreSQL 17.6 (staging):
//   * integer[] -> text[] conversion on a temp table (value + row preservation)
//   * the migration file, verbatim, against a text[] column
//   * owner-only policies, cross-user denial, anon denial
//   * completion guards: legacy, blank, out-of-bank, wrong-question option
//   * valid 50-answer completion and the downgrade guard
//   * idempotence (the file is applied twice)
//   * rollback: no fixture row, policy, trigger or option table survives
//
// What it does NOT prove: the production column conversion (staging is already
// text[]; the temp-table probe covers the ALTER semantics, not public data).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { section1Questions } from '../src/data/section1Questions.js'

const DB_URL = process.env.SECTION1_STAGING_DB_URL
if (!DB_URL) {
  console.error('Set SECTION1_STAGING_DB_URL to the STAGING connection string.')
  process.exit(2)
}
if (/mhdjnhiqahsllbczbzpk/.test(DB_URL)) {
  console.error('REFUSING: that is the production project.')
  process.exit(2)
}

const migration = readFileSync(
  new URL('../supabase/sql/production/20261022180000_production_section1_responses.sql', import.meta.url),
  'utf8'
).replace(/\r\n/g, '\n')
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

class RolledBack extends Error {}

const sql = postgres(DB_URL, { ssl: 'require', max: 1, onnotice: () => {} })

const fixtures = { ids: [], original: new Map() }
try {
  const version = await sql`select current_setting('server_version') as version`
  console.log(`staging PostgreSQL ${version[0].version}`)

  try {
    await sql.begin(async tx => {
      await tx.unsafe("set local lock_timeout = '15s'")
      await tx.unsafe("set local statement_timeout = '90s'")

      // ---------------------------------------------------------------
      // Fixtures: three existing users without answers.
      // ---------------------------------------------------------------
      const picked = await tx`
        select id, section1_complete, section1_progress
          from public.users u
         where not exists (select 1 from public.user_responses r where r.user_id = u.id)
         order by u.id
         limit 3`
      ok(picked.length === 3, 'staging must hold at least three users without answers')
      const [A, B, C] = picked.map(row => row.id)
      fixtures.ids = [A, B, C]
      for (const row of picked) {
        fixtures.original.set(row.id, {
          complete: row.section1_complete,
          progress: row.section1_progress
        })
      }

      await tx`update public.users set section1_complete = true, section1_progress = 39 where id = ${A}`
      await tx`update public.users set section1_complete = false, section1_progress = 0 where id = ${B}`
      await tx`update public.users set section1_complete = true, section1_progress = 0 where id = ${C}`

      // The post-conversion shape of a legacy row: 40 numeric strings.
      const legacy = Array.from({ length: 40 }, (_, index) => String(index % 2))
      await tx`insert into public.user_responses (user_id, responses_array)
               values (${A}, ${tx.array(legacy)})`

      // ---------------------------------------------------------------
      // PG17: integer[] -> text[] preserves rows and values.
      // ---------------------------------------------------------------
      await tx.unsafe(`
        create temp table section1_conversion_probe (
          id int primary key,
          responses_array integer[] not null
        );
        insert into section1_conversion_probe values
          (1, array[0,0,0,1]),
          (2, array[1,0,1]);
        alter table section1_conversion_probe
          alter column responses_array type text[]
          using responses_array::text[];
      `)
      const converted = await tx`select id, responses_array from section1_conversion_probe order by id`
      equal(converted.length, 2, 'the conversion must keep every row')
      equal(converted[0].responses_array, ['0', '0', '0', '1'], 'the conversion must keep every value')
      equal(converted[1].responses_array, ['1', '0', '1'], 'the conversion must keep every value in order')

      // ---------------------------------------------------------------
      // Apply the file, verbatim, twice.
      // ---------------------------------------------------------------
      await tx.unsafe(migration)
      const afterFirst = await tx`
        select user_id, responses_array from public.user_responses order by user_id`
      const flagsFirst = await tx`
        select id, section1_complete, section1_progress from public.users
         where id in (${A}, ${B}, ${C}) order by id`

      await tx.unsafe(migration)
      const afterSecond = await tx`
        select user_id, responses_array from public.user_responses order by user_id`
      const flagsSecond = await tx`
        select id, section1_complete, section1_progress from public.users
         where id in (${A}, ${B}, ${C}) order by id`

      equal(afterSecond, afterFirst, 'reapplying the migration must not change response rows')
      equal(flagsSecond, flagsFirst, 'reapplying the migration must not change completion flags')

      const col = await tx`
        select format_type(a.atttypid, a.atttypmod) as type
          from pg_attribute a
         where a.attrelid = 'public.user_responses'::regclass
           and a.attname = 'responses_array'`
      equal(col[0].type, 'text[]', 'responses_array must remain text[] under the migration')

      const legacyRow = await tx`
        select responses_array from public.user_responses where user_id = ${A}`
      equal(legacyRow[0].responses_array, legacy, 'legacy values must be preserved verbatim')

      const aFlags = await tx`select section1_complete, section1_progress from public.users where id = ${A}`
      equal(aFlags[0].section1_complete, false, 'the legacy profile must be marked incomplete')
      equal(aFlags[0].section1_progress, 0, 'the legacy profile must restart at question 1')
      const cFlags = await tx`select section1_complete from public.users where id = ${C}`
      equal(cFlags[0].section1_complete, false, 'a forged completion with no answers must be reset')

      // ---------------------------------------------------------------
      // Policies, grants, guards, option bank.
      // ---------------------------------------------------------------
      const policies = await tx`
        select p.polname as name, pg_get_expr(p.polqual, p.polrelid) as qual
          from pg_policy p where p.polrelid = 'public.user_responses'::regclass order by 1`
      equal(policies.map(row => row.name), ['responses_insert_own', 'responses_select_own', 'responses_update_own'],
        'exactly the three owner policies must remain')
      ok(policies.every(row => !/auth\.role\(\)/.test(row.qual || '')), 'no role-wide policy may remain')

      const anon = await tx`
        select count(*)::int as n from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'user_responses' and grantee = 'anon'`
      equal(anon[0].n, 0, 'anon must hold no privilege on user_responses')

      const guards = await tx`
        select count(*)::int as n from pg_trigger
         where tgrelid in ('public.users'::regclass, 'public.user_responses'::regclass)
           and not tgisinternal and tgname like 'trg_section1%'`
      equal(guards[0].n, 2, 'both completion guards must exist')

      const bank = await tx`
        select count(*)::int as rows, count(distinct question_number)::int as questions
          from public.section1_question_options`
      equal(bank[0].rows, 200, 'the option bank must hold 200 options')
      equal(bank[0].questions, 50, 'the option bank must cover 50 questions')

      const rls = await tx`
        select relrowsecurity from pg_class where oid = 'public.section1_question_options'::regclass`
      equal(rls[0].relrowsecurity, true, 'the option bank must have RLS enabled')

      // ---------------------------------------------------------------
      // Client behaviour: B is the signed-in owner.
      // ---------------------------------------------------------------
      await tx.unsafe('set local role authenticated')
      await tx`select set_config('request.jwt.claim.sub', ${B}, true)`

      const ownNone = await tx`select user_id from public.user_responses`
      equal(ownNone, [], 'B has no answers yet')
      await tx`insert into public.user_responses (user_id, responses_array)
               values (${B}, ${tx.array(VALID)})`
      const own = await tx`select user_id from public.user_responses`
      equal(own.map(row => row.user_id), [B], 'B reads only their own answers')

      const crossRead = await tx`select user_id from public.user_responses where user_id = ${A}`
      equal(crossRead, [], 'B cannot read A\'s answers')
      const crossUpdate = await tx`
        update public.user_responses set responses_array = ${tx.array(VALID)}
         where user_id = ${A} returning user_id`
      equal(crossUpdate, [], 'B cannot update A\'s answers')

      const bankDenied = await tx`select count(*) from public.section1_question_options`.then(
        () => false,
        error => /permission denied/i.test(String(error.message))
      )
      ok(bankDenied, 'a signed-in user cannot read the option bank')

      const validClaim = await tx`
        update public.users set section1_complete = true
         where id = ${B} returning section1_complete, section1_progress`
      equal(validClaim[0].section1_complete, true, 'B may complete with 50 valid answers')
      equal(validClaim[0].section1_progress, 50, 'valid completion stores progress 50')

      const outOfBank = Array.from({ length: 50 }, () => 'Not a real option')
      await tx`update public.user_responses set responses_array = ${tx.array(outOfBank)} where user_id = ${B}`
      const outOfBankClaim = await tx`
        update public.users set section1_complete = true
         where id = ${B} returning section1_complete`
      equal(outOfBankClaim[0].section1_complete, false, 'out-of-bank strings cannot be completed')

      const wrongSlot = [...VALID]
      wrongSlot[0] = section1Questions[1].options[0]
      await tx`update public.user_responses set responses_array = ${tx.array(wrongSlot)} where user_id = ${B}`
      const wrongSlotClaim = await tx`
        update public.users set section1_complete = true
         where id = ${B} returning section1_complete`
      equal(wrongSlotClaim[0].section1_complete, false, 'an option in the wrong slot cannot be completed')

      await tx.unsafe('reset role')
      await tx`select set_config('request.jwt.claim.sub', '', true)`

      await tx.unsafe('set local role anon')
      const anonRead = await tx`select count(*) from public.user_responses`.then(
        () => false,
        error => /permission denied/i.test(String(error.message))
      )
      ok(anonRead, 'anon cannot read responses')
      await tx.unsafe('reset role')

      throw new RolledBack('rollback')
    })
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error
  }

  // -----------------------------------------------------------------
  // Rollback proof: no fixture answer, flag change, policy, trigger or table.
  // -----------------------------------------------------------------
  const leftovers = await sql`
    select
      (select count(*)::int from public.user_responses where user_id in (${fixtures.ids[0]}, ${fixtures.ids[1]}, ${fixtures.ids[2]})) as response_rows,
      (select count(*)::int from pg_trigger where tgname like 'trg_section1%' and not tgisinternal) as guards,
      (select count(*)::int from pg_policy where polrelid = 'public.user_responses'::regclass) as policies,
      (select to_regclass('public.section1_question_options')::text) as option_table`
  equal(leftovers[0].response_rows, 0, 'rollback must remove the fixture response')
  equal(leftovers[0].guards, 0, 'rollback must remove the guards')
  equal(leftovers[0].policies, 5, 'rollback must restore the five original staging policies')
  equal(leftovers[0].option_table, null, 'rollback must remove the option table')

  const restored = await sql`
    select id, section1_complete, section1_progress from public.users
     where id in (${fixtures.ids[0]}, ${fixtures.ids[1]}, ${fixtures.ids[2]}) order by id`
  for (const row of restored) {
    const original = fixtures.original.get(row.id)
    equal(row.section1_complete, original.complete, `rollback must restore ${row.id} completion`)
    equal(row.section1_progress, original.progress, `rollback must restore ${row.id} progress`)
  }

  console.log(`Section 1 staging (PostgreSQL 17) checks passed: ${checks} assertions`)
  console.log('Applied inside a rolled-back transaction: conversion probe, migration twice, RLS, guards, option bank')
} finally {
  await sql.end({ timeout: 5 })
}
