// Section 1 migration — PostgreSQL staging test (rollback-safe).
//
//   SECTION1_STAGING_DB_URL="$STAGING_URL" node scripts/test-section1-staging-pg17.mjs
//
// The URL is never printed. The script refuses the production ref.
//
// Every write happens inside one transaction that is deliberately rolled back,
// including the migration itself. The migration deletes every answer row inside
// that transaction; the rollback restores the project's data, which is checked
// by comparing against the counts and flags captured before the transaction
// opened. No fixture user is created (the staging users table has an
// auth.users foreign key).
//
// WHY THIS TEST BUILDS THE LEGACY SCHEMA ITSELF
//   Staging already has public.user_responses.responses_array as text[], so
//   applying the migration there only proves the "already text[] with a marker"
//   path. The production defect is an integer[] column that must become
//   text[] while the legacy rows are discarded. So, inside the transaction,
//   this script:
//     1. copies the live rows to a temp table, empties the table and alters
//        responses_array to integer[] (the pre-migration shape),
//     2. verifies with the catalog that the column really is integer[] NOT NULL
//        before the migration runs — the test fails if the fixture is wrong,
//     3. inserts legacy integer answer rows and per-user Section 1 state,
//     4. applies the migration file verbatim.
//   Nothing here is committed: the enclosing transaction is rolled back and the
//   complete pre-test state — column type, every answer row, every user's
//   Section 1 flags, policies, grants and triggers — is re-read and compared
//   afterwards.
//
// What this exercises on a real PostgreSQL server:
//   * the migration file, verbatim, starting from integer[] NOT NULL
//   * a statement failing AFTER the cutover aborts the whole file: the column,
//     the legacy rows, the flags, the marker, the option bank, the functions,
//     the guards and a table created earlier in the same batch are all restored
//     (the property the documented `psql -1` run depends on)
//   * the first-run cutover: every legacy row deleted, every profile reset,
//     the marker recorded with the counts it actually deleted and reset
//   * the first-run reset postcondition (incomplete / progress 0 / null stamp)
//   * re-execution: answers and progress submitted after the cutover survive,
//     including an answer whose created_at is stamped before the marker
//   * the refusal to run against text[] with no cutover marker
//   * owner-only policies, cross-user denial against a row that really exists,
//     cross-user INSERT refused by RLS WITH CHECK, anon denial, function
//     privileges, and effective table privileges (inherited PUBLIC included)
//   * option bank and cutover marker unreadable to anon AND authenticated
//   * completion guards: forged completion, out-of-bank, wrong-question option
//   * rollback: the complete pre-test state is restored — column type and
//     NOT NULL, every answer row byte-for-byte, every user's Section 1 flags,
//     every policy definition, the pre-existing grants and triggers, and no
//     migration-created object
//
// What it does NOT prove: that Supabase's PostgREST layer behaves the same for
// the same policies (this talks SQL directly, standing in for PostgREST with
// request.jwt.claim.* settings), and that a *concurrent* client write is
// blocked by the migration's locks — one connection runs the whole script, so
// the lock behaviour is asserted by catalog inspection only (see the P0 lock
// notes in docs/SECTION1_PRODUCTION_REMEDIATION.md).

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
// postgres.js returns Result objects (Array subclasses carrying count/command),
// so a strict comparison against a plain array fails on the prototype even when
// the rows match. Normalise to plain values before asserting.
function plain(value) {
  if (Array.isArray(value)) return Array.from(value, plain)
  if (value instanceof Date || value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]))
}

function equal(actual, expected, message) {
  assert.deepEqual(plain(actual), plain(expected), message)
  checks += 1
}

class RolledBack extends Error {}

// Complete pre-test state, used to prove the rollback field by field. Answer
// rows and per-user flags are captured as digests so a mismatch fails with a
// generic message instead of printing private answer text.
async function captureState(query) {
  const column = (await query`
    select format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as not_null
      from pg_attribute a
     where a.attrelid = 'public.user_responses'::regclass
       and a.attname = 'responses_array'
       and not a.attisdropped`)[0]
  const responses = (await query`
    select count(*)::int as n,
           coalesce(md5(string_agg(row_to_json(t)::text, '|' order by t.user_id)), '') as digest
      from (select * from public.user_responses) t`)[0]
  const profiles = (await query`
    select coalesce(md5(string_agg(row_to_json(t)::text, '|' order by t.id)), '') as digest
      from (select id, section1_complete, section1_progress, section1_last_edited
              from public.users) t`)[0]
  const policies = await query`
    select p.polname as name, p.polcmd as cmd,
           coalesce(pg_get_expr(p.polqual, p.polrelid), '') as qual,
           coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as check,
           coalesce((select string_agg(r.rolname, ',' order by r.rolname)
                       from pg_roles r where r.oid = any(p.polroles)), '') as roles
      from pg_policy p
     where p.polrelid = 'public.user_responses'::regclass
     order by p.polname`
  const triggers = await query`
    select t.tgname as name, t.tgrelid::regclass::text as table_name, t.tgenabled as enabled
      from pg_trigger t
     where t.tgrelid in ('public.users'::regclass, 'public.user_responses'::regclass)
       and not t.tgisinternal
     order by t.tgname`
  const grants = await query`
    select grantee, privilege_type
      from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'user_responses'
     order by grantee, privilege_type`
  const objects = (await query`
    select to_regclass('public.section1_question_options')::text as options,
           to_regclass('public.section1_legacy_cutover')::text as cutover,
           (select count(*)::int from pg_proc p
             where p.pronamespace = 'public'::regnamespace
               and p.proname in ('section1_answers_are_complete', 'enforce_section1_completion',
                                 'downgrade_section1_on_invalid_answers')) as functions`)[0]
  return {
    column: column?.type ?? null,
    columnNotNull: column?.not_null ?? null,
    responseRows: responses.n,
    responseDigest: responses.digest,
    profileDigest: profiles.digest,
    policies,
    triggers,
    grants,
    objects
  }
}

const sql = postgres(DB_URL, { ssl: 'require', max: 1, onnotice: () => {} })
// A second connection, used to prove that a client write is really blocked
// while the migration transaction holds its locks.
const side = postgres(DB_URL, { ssl: 'require', max: 1, onnotice: () => {} })

const fixtures = { ids: [], originals: new Map() }

try {
  const version = await sql`select current_setting('server_version') as version`
  console.log(`staging PostgreSQL ${version[0].version}`)

  // Captured outside the transaction so the rollback proof compares against
  // this project's real state instead of a hard-coded expectation.
  const baseline = await captureState(sql)
  equal(baseline.objects.options, null, 'staging must not already hold the option bank')
  equal(baseline.objects.cutover, null, 'staging must not already hold the cutover marker')
  equal(baseline.objects.functions, 0, 'staging must not already hold the Section 1 functions')

  try {
    await sql.begin(async tx => {
      await tx.unsafe("set local lock_timeout = '15s'")
      await tx.unsafe("set local statement_timeout = '180s'")

      const columnType = async () => (await tx`
        select format_type(a.atttypid, a.atttypmod) as type,
               a.attnotnull as not_null
          from pg_attribute a
         where a.attrelid = 'public.user_responses'::regclass
           and a.attname = 'responses_array'
           and not a.attisdropped`)[0]

      // A failed statement aborts the surrounding transaction, so expected
      // errors run inside a savepoint that is always rolled back.
      async function expectError(label, run, pattern) {
        await tx.unsafe('savepoint probe')
        let error = null
        try {
          await run()
        } catch (caught) {
          error = caught
        }
        await tx.unsafe('rollback to savepoint probe')
        await tx.unsafe('release savepoint probe')
        ok(error !== null, `${label}: expected an error, none was raised`)
        ok(pattern.test(String(error?.message)), `${label}: unexpected error "${error?.message}"`)
      }

      // ---------------------------------------------------------------
      // 1. Build the pre-migration legacy schema on the real table
      // ---------------------------------------------------------------
      const before = await columnType()
      ok(['integer[]', 'text[]'].includes(before.type),
        `unexpected staging column type ${before.type}; this test cannot build a faithful fixture`)

      // The live rows go to a temp table first: replacing the column type on
      // populated text data would fail, and the rollback covers the table.
      await tx.unsafe('create temp table section1_pristine_responses as select * from public.user_responses')
      await tx.unsafe('delete from public.user_responses')

      if (before.type === 'text[]') {
        // The table is empty at this point, so the cast has no rows to touch.
        await tx.unsafe(
          'alter table public.user_responses alter column responses_array type integer[] using null'
        )
      }

      const legacy = await columnType()
      equal(legacy.type, 'integer[]',
        'the fixture must present the legacy integer[] column BEFORE the migration runs')
      equal(legacy.not_null, true, 'the legacy column must keep its NOT NULL constraint')
      equal((await tx`select count(*)::int as n from public.user_responses`)[0].n, 0,
        'the legacy fixture table starts empty')

      // ---------------------------------------------------------------
      // 2. Fixture users and legacy integer answer rows
      // ---------------------------------------------------------------
      const picked = await tx`
        select id, section1_complete, section1_progress, section1_last_edited
          from public.users
         order by id
         limit 3`
      ok(picked.length === 3, 'staging must hold at least three users')
      const [A, B, C] = picked.map(row => row.id)
      fixtures.ids = [A, B, C]
      for (const row of picked) {
        fixtures.originals.set(row.id, {
          complete: row.section1_complete,
          progress: row.section1_progress,
          lastEdited: row.section1_last_edited
        })
      }

      await tx`update public.users set section1_complete = true, section1_progress = 39, section1_last_edited = now() where id = ${A}`
      await tx`update public.users set section1_complete = false, section1_progress = 0, section1_last_edited = null where id = ${B}`
      await tx`update public.users set section1_complete = true, section1_progress = 0, section1_last_edited = now() where id = ${C}`

      // Legacy answers: 40 numeric slots, exactly what integer[] allowed.
      await tx.unsafe(`
        insert into public.user_responses (user_id, responses_array) values
          ('${A}', array[0,0,0,1,0,0,0,1,1,1,1,0,0,1,0,0,0,1,1,0,
                       1,0,0,1,0,1,1,0,0,1,0,0,1,1,0,0,1,0,1,0]::integer[]),
          ('${C}', array[1,1,0,0,1]::integer[])
      `)
      equal((await tx`select count(*)::int as n from public.user_responses`)[0].n, 2,
        'the fixture must hold the legacy integer answer rows')
      equal((await columnType()).type, 'integer[]',
        'the column must still be integer[] when the migration starts')

      // ---------------------------------------------------------------
      // 2b. A failure after the cutover must roll back the whole file
      // ---------------------------------------------------------------
      // The documented run is `psql -1`: one transaction for the entire file.
      // This executes the file plus two later statements inside a savepoint of
      // the surrounding transaction. If the batch were not atomic, the cutover,
      // the type change and the extra table would already be committed and
      // rollback-to-savepoint could not undo them.
      await tx.unsafe('savepoint late_failure_probe')
      let lateError = null
      try {
        await tx.unsafe(`${migration}
          create table public.zz_late_probe (id int);
          do $$ begin raise exception 'deliberate late failure after the cutover'; end $$;
        `)
      } catch (caught) {
        lateError = caught
      }
      await tx.unsafe('rollback to savepoint late_failure_probe')
      await tx.unsafe('release savepoint late_failure_probe')

      ok(lateError !== null, 'a statement failing after the cutover must abort the run')
      ok(/deliberate late failure after the cutover/.test(String(lateError?.message)),
        `the failure must be the late probe, got "${lateError?.message}"`)
      equal((await columnType()).type, 'integer[]',
        'the late failure must roll the column type change back')
      equal((await columnType()).not_null, true,
        'the late failure must leave the legacy NOT NULL constraint as it was')
      equal((await tx`select count(*)::int as n from public.user_responses`)[0].n, 2,
        'the late failure must restore both deleted legacy answer rows')
      for (const [label, oid] of [
        ['cutover marker', 'public.section1_legacy_cutover'],
        ['option bank', 'public.section1_question_options'],
        ['late probe table', 'public.zz_late_probe']
      ]) {
        equal((await tx`select to_regclass(${oid})::text as oid`)[0].oid, null,
          `the late failure must roll the ${label} back`)
      }
      equal((await tx`
        select count(*)::int as n from pg_proc
         where pronamespace = 'public'::regnamespace
           and proname in ('section1_answers_are_complete', 'enforce_section1_completion',
                           'downgrade_section1_on_invalid_answers')`)[0].n, 0,
        'the late failure must roll every Section 1 function back')
      equal((await tx`
        select count(*)::int as n from pg_trigger
         where tgrelid in ('public.users'::regclass, 'public.user_responses'::regclass)
           and not tgisinternal and tgname like 'trg_section1%'`)[0].n, 0,
        'the late failure must roll both guards back')
      equal((await tx`select section1_progress from public.users where id = ${A}`)[0].section1_progress, 39,
        'the late failure must restore the legacy pointer')

      // ---------------------------------------------------------------
      // 2c. FORCE RLS with a role that lacks BYPASSRLS: fail closed
      // ---------------------------------------------------------------
      // The migration sets `row_security = off` inside its transaction; that
      // does NOT bypass RLS, it makes a statement that RLS would filter raise
      // an error instead of silently affecting a subset of rows. With both
      // tables under FORCE ROW LEVEL SECURITY and an executing role that is
      // neither superuser nor BYPASSRLS, the run must fail and roll back with
      // NOTHING deleted or reset — not a subset of the legacy rows, not a
      // subset of the profiles, and no marker. All setup lives inside the
      // savepoint, so the rollback to it also undoes the role, the ownership
      // transfer and the FORCE flags.
      const ownerBeforeForceTest = (await tx`
        select pg_get_userbyid(relowner) as owner
          from pg_class where oid = 'public.user_responses'::regclass`)[0].owner
      await expectError('FORCE RLS without BYPASSRLS', async () => {
        await tx.unsafe(`
          create role section1_pg17_runner nologin;
          grant usage, create on schema public to section1_pg17_runner;
          grant usage on schema auth to section1_pg17_runner;
          alter table public.users owner to section1_pg17_runner;
          alter table public.user_responses owner to section1_pg17_runner;
          alter table public.users force row level security;
          alter table public.user_responses force row level security;
          set role section1_pg17_runner;
        `)
        await tx.unsafe(migration)
      }, /row-level security/)
      await tx.unsafe('reset role')

      equal((await columnType()).type, 'integer[]',
        'the FORCE RLS refusal must leave the legacy column type untouched')
      equal((await tx`select count(*)::int as n from public.user_responses`)[0].n, 2,
        'the FORCE RLS refusal must leave every legacy answer row in place (no subset deleted)')
      equal((await tx`select to_regclass('public.section1_legacy_cutover')::text as marker`)[0].marker, null,
        'the FORCE RLS refusal must not leave a cutover marker')
      equal((await tx`select section1_complete, section1_progress
                        from public.users where id = ${A}`)[0],
        { section1_complete: true, section1_progress: 39 },
        'the FORCE RLS refusal must not reset any profile')
      equal((await tx`
        select bool_and(relforcerowsecurity) as force_any
          from pg_class
         where oid in ('public.users'::regclass, 'public.user_responses'::regclass)`)[0].force_any, false,
        'the savepoint rollback must undo the FORCE flags')
      equal((await tx`
        select pg_get_userbyid(relowner) as owner from pg_class
         where oid = 'public.user_responses'::regclass`)[0].owner,
        ownerBeforeForceTest,
        'the savepoint rollback must restore the original table owner')

      // ---------------------------------------------------------------
      // 3. First application: the legacy cutover
      // ---------------------------------------------------------------
      await tx.unsafe(migration)

      // The file's `set local row_security = off` is scoped to its own
      // transaction: under the documented `psql -1` run the file IS the whole
      // transaction, so the GUC reverts when that transaction commits. This
      // suite runs the file as a prefix of one longer transaction, so restore
      // the session default here to model that boundary — otherwise every
      // later probe as a client role (a subject of RLS) fails against the
      // lingering `off` instead of exercising the real policies.
      await tx.unsafe('reset row_security')

      const afterFirst = await columnType()
      equal(afterFirst.type, 'text[]', 'the migration must convert responses_array to text[]')
      equal(afterFirst.not_null, true, 'responses_array must stay NOT NULL')
      equal((await tx`select count(*)::int as n from public.user_responses`)[0].n, 0,
        'the first application must delete every legacy answer row')

      const marker = await tx`
        select executed_at, deleted_response_rows, reset_user_profiles
          from public.section1_legacy_cutover`
      equal(marker.length, 1, 'the one-time cutover marker must be recorded exactly once')
      equal(marker[0].deleted_response_rows, 2, 'the marker records the two legacy rows it deleted')
      ok(marker[0].reset_user_profiles >= 3, 'the marker records every profile it reset')

      const unresolved = await tx`
        select count(*)::int as n
          from public.users u
         where u.section1_complete is distinct from false
            or u.section1_progress is distinct from 0
            or u.section1_last_edited is not null`
      equal(unresolved[0].n, 0,
        'after the first run no profile may remain complete, mid-questionnaire or stamped')

      const resetFixture = await tx`
        select section1_complete, section1_progress, section1_last_edited
          from public.users where id = ${A}`
      equal(resetFixture[0].section1_complete, false, 'a completed legacy profile must be reset')
      equal(resetFixture[0].section1_progress, 0, 'the reset profile restarts at question 1')
      equal(resetFixture[0].section1_last_edited, null, 'the reset profile keeps no stale answer stamp')

      const policies = await tx`
        select p.polname as name, pg_get_expr(p.polqual, p.polrelid) as qual
          from pg_policy p
         where p.polrelid = 'public.user_responses'::regclass
         order by 1`
      equal(policies.map(row => row.name),
        ['responses_insert_own', 'responses_select_own', 'responses_update_own'],
        'exactly the three owner policies must remain')
      ok(policies.every(row => !/auth\.role\(\)/.test(row.qual || '')),
        'no role-wide read policy may remain')

      equal((await tx`
        select count(*)::int as n from information_schema.role_table_grants
         where table_schema = 'public' and table_name = 'user_responses' and grantee = 'anon'`)[0].n,
        0, 'anon must hold no privilege on user_responses')

      const clientPrivs = await tx`
        select has_table_privilege('authenticated', 'public.user_responses', 'select') as sel,
               has_table_privilege('authenticated', 'public.user_responses', 'insert') as ins,
               has_table_privilege('authenticated', 'public.user_responses', 'update') as upd,
               has_table_privilege('authenticated', 'public.user_responses', 'delete') as del,
               has_table_privilege('authenticated', 'public.user_responses', 'truncate') as trunc`
      equal(clientPrivs[0], { sel: true, ins: true, upd: true, del: false, trunc: false },
        'authenticated keeps select/insert/update only; delete and truncate are revoked')

      // Effective privileges: has_table_privilege() includes privileges the
      // role inherits through PUBLIC, which role_table_grants alone would miss.
      const effectivePrivs = (await tx`
        select has_table_privilege('anon', 'public.user_responses', 'select') as anon_select,
               has_table_privilege('anon', 'public.user_responses', 'insert') as anon_insert,
               has_table_privilege('authenticated', 'public.user_responses', 'select') as auth_select,
               has_table_privilege('authenticated', 'public.user_responses', 'insert') as auth_insert,
               has_table_privilege('authenticated', 'public.user_responses', 'update') as auth_update,
               has_table_privilege('authenticated', 'public.user_responses', 'references') as auth_references,
               has_table_privilege('authenticated', 'public.user_responses', 'trigger') as auth_trigger,
               has_table_privilege('anon', 'public.section1_question_options', 'select') as anon_bank,
               has_table_privilege('authenticated', 'public.section1_question_options', 'select') as auth_bank,
               has_table_privilege('anon', 'public.section1_legacy_cutover', 'select') as anon_marker,
               has_table_privilege('authenticated', 'public.section1_legacy_cutover', 'select') as auth_marker`)[0]
      equal(effectivePrivs, {
        anon_select: false, anon_insert: false,
        auth_select: true, auth_insert: true, auth_update: true,
        auth_references: false, auth_trigger: false,
        anon_bank: false, auth_bank: false, anon_marker: false, auth_marker: false
      }, 'effective privileges (inherited PUBLIC included) match the intended set')

      equal((await tx`
        select count(*)::int as n
          from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
         where c.oid in ('public.user_responses'::regclass,
                         'public.section1_question_options'::regclass,
                         'public.section1_legacy_cutover'::regclass)
           and acl.grantee = 0`)[0].n, 0,
        'no PUBLIC grant remains on the response table, the option bank or the marker')

      equal((await tx`
        select count(*)::int as n from pg_trigger
         where tgrelid in ('public.users'::regclass, 'public.user_responses'::regclass)
           and not tgisinternal and tgname like 'trg_section1%'`)[0].n,
        2, 'both Section 1 guards must be installed')

      const bank = await tx`
        select count(*)::int as rows, count(distinct question_number)::int as questions
          from public.section1_question_options`
      equal(bank[0].rows, 200, 'the option bank must hold 200 options')
      equal(bank[0].questions, 50, 'the option bank must cover 50 questions')
      equal((await tx`
        select relrowsecurity from pg_class
         where oid = 'public.section1_question_options'::regclass`)[0].relrowsecurity,
        true, 'the option bank must have RLS enabled')

      // ---------------------------------------------------------------
      // 3b. A concurrent writer is blocked while the migration holds its locks
      // ---------------------------------------------------------------
      // A second connection (not part of this transaction) tries to write an
      // answer row while the migration transaction is still open. It must time
      // out on the ACCESS EXCLUSIVE lock instead of landing a row between the
      // legacy delete and the type change. The probe runs inside its own
      // always-rolled-back transaction, so a probe that did get through could
      // not commit anything.
      const extraUser = await tx`
        select id from public.users
         where id <> all(${tx.array([A, B, C])}::uuid[])
         order by id limit 1`
      const probeUser = extraUser[0]?.id ?? A

      let blockedByLock = false
      let probeError = null
      try {
        await side.begin(async sideTx => {
          await sideTx.unsafe("set local lock_timeout = '750ms'")
          try {
            await sideTx`insert into public.user_responses (user_id, responses_array)
                         values (${probeUser}, ${sideTx.array(VALID)})`
          } catch (caught) {
            probeError = caught
            blockedByLock = /lock timeout/i.test(String(caught?.message))
          }
          throw new RolledBack('probe')
        })
      } catch (error) {
        if (!(error instanceof RolledBack)) throw error
      }
      ok(blockedByLock,
        `a concurrent answer write must block on the migration lock, got "${probeError ? probeError.message : 'the insert succeeded'}"`)

      // ---------------------------------------------------------------
      // 4. A real user retakes Section 1 after the cutover
      // ---------------------------------------------------------------
      await tx.unsafe('set local role authenticated')
      await tx`select set_config('request.jwt.claim.sub', ${B}, true)`

      await tx`insert into public.user_responses (user_id, responses_array)
               values (${B}, ${tx.array(VALID)})`
      const ownAfterCutover = await tx`
        select user_id from public.user_responses`
      equal(ownAfterCutover.map(row => row.user_id), [B], 'the owner reads only their own answer row')

      const retake = await tx`
        update public.users set section1_complete = true, section1_last_edited = now()
         where id = ${B}
         returning section1_complete, section1_progress`
      equal(retake[0].section1_complete, true, '50 valid current answers may be marked complete')
      equal(retake[0].section1_progress, 50, 'a valid completion stores the pointer as 50')

      await tx.unsafe('reset role')
      await tx`select set_config('request.jwt.claim.sub', '', true)`

      // created_at is client-supplied, so a legitimate post-cutover answer can
      // be stamped before the marker. The rerun below must not classify rows by
      // timestamp and must leave this value alone.
      await tx`
        update public.user_responses
           set created_at = (select executed_at from public.section1_legacy_cutover) - interval '30 days'
         where user_id = ${B}`
      const backdated = await tx`
        select created_at < (select executed_at from public.section1_legacy_cutover) as older
          from public.user_responses where user_id = ${B}`
      equal(backdated[0].older, true,
        'the fixture answer must be genuinely stamped before the cutover marker')

      // ---------------------------------------------------------------
      // 5. Second application: nothing is deleted or reset again
      // ---------------------------------------------------------------
      const preservedBefore = {
        answers: await tx`select user_id, responses_array, created_at from public.user_responses order by user_id`,
        flags: await tx`select id, section1_complete, section1_progress, section1_last_edited
                          from public.users order by id`,
        marker: await tx`select executed_at, deleted_response_rows, reset_user_profiles
                           from public.section1_legacy_cutover`
      }

      await tx.unsafe(migration)
      await tx.unsafe('reset row_security') // model the psql -1 transaction boundary, as above

      equal(await tx`select user_id, responses_array, created_at from public.user_responses order by user_id`,
        preservedBefore.answers,
        're-running the migration must not delete answers submitted after the cutover, nor rewrite a backdated created_at')
      equal(await tx`select id, section1_complete, section1_progress, section1_last_edited
                       from public.users order by id`,
        preservedBefore.flags,
        're-running the migration must not reset post-cutover progress or completion')
      equal(await tx`select executed_at, deleted_response_rows, reset_user_profiles
                       from public.section1_legacy_cutover`,
        preservedBefore.marker,
        'the one-time cutover marker must not be rewritten on re-execution')

      // ---------------------------------------------------------------
      // 6. The guard against a blind second cutover still holds
      // ---------------------------------------------------------------
      await tx.unsafe('delete from public.section1_legacy_cutover')
      await expectError(
        'text[] without a cutover marker',
        () => tx.unsafe(migration),
        /already text\[\] and no cutover marker/
      )
      equal((await tx`select user_id from public.user_responses order by user_id`).map(row => row.user_id),
        [B],
        'the refused run must leave the post-cutover answers in place')

      // ---------------------------------------------------------------
      // 6b. A marker with nullable counts and a NULL marker row must refuse
      // ---------------------------------------------------------------
      // `NULL < 0` is NULL, not true, so count checks of the shape `count < 0`
      // alone let a NULL count pass, and the preflight's `Number(null) === 0`
      // did the same on the JavaScript side: this state was previously
      // classified as a completed migration. The structure the file writes is
      // `integer NOT NULL`, so a nullable count column with a NULL row is
      // refused before anything reads it. The seed statements stay outside
      // the savepoint; the failed batch rolls back to it; the cleanup restores
      // the exact table shape section 6 left behind.
      await tx.unsafe(`
        alter table public.section1_legacy_cutover
          alter column deleted_response_rows drop not null,
          alter column reset_user_profiles drop not null;
        insert into public.section1_legacy_cutover (deleted_response_rows, reset_user_profiles)
             values (null, null);
      `)
      const answersUnderNullMarker = await tx`
        select user_id, responses_array from public.user_responses order by user_id`
      const flagsUnderNullMarker = await tx`
        select id, section1_complete, section1_progress, section1_last_edited
          from public.users order by id`
      await expectError('marker counts are NULL', () => tx.unsafe(migration),
        /does not match the marker structure/)
      equal(await tx`select user_id, responses_array from public.user_responses order by user_id`,
        answersUnderNullMarker,
        'the NULL-count marker refusal must leave every answer row untouched')
      equal(await tx`select id, section1_complete, section1_progress, section1_last_edited
                       from public.users order by id`,
        flagsUnderNullMarker,
        'the NULL-count marker refusal must leave every profile untouched')
      await tx.unsafe(`
        delete from public.section1_legacy_cutover;
        alter table public.section1_legacy_cutover
          alter column deleted_response_rows set not null,
          alter column reset_user_profiles set not null;
      `)
      equal((await tx`select count(*)::int as n from public.section1_legacy_cutover`)[0].n, 0,
        'the marker is restored to the empty state section 6 left')

      // ---------------------------------------------------------------
      // 7. Client access — cross-user attempts against a row that exists
      // ---------------------------------------------------------------
      // B's post-cutover row is present here. Earlier revisions of this script
      // had C read and update A's row, but A's row had been deleted by the
      // cutover, so an empty result proved nothing: it was the missing row, not
      // RLS. These probes now use B's real row.
      await tx.unsafe('set local role authenticated')
      await tx`select set_config('request.jwt.claim.sub', ${B}, true)`
      equal((await tx`select count(*)::int as n from public.user_responses`)[0].n, 1,
        'the owner reads exactly their own answer row')

      await tx`select set_config('request.jwt.claim.sub', ${C}, true)`
      equal((await tx`select count(*)::int as n from public.user_responses`)[0].n, 0,
        'another signed-in user sees no answer rows at all')
      equal(await tx`select user_id from public.user_responses where user_id = ${B}`,
        [], 'one user cannot read another user\'s existing answers')
      equal(await tx`update public.user_responses set responses_array = ${tx.array(VALID)}
                     where user_id = ${B} returning user_id`,
        [], 'one user cannot update another user\'s existing answers')

      // A cross-user INSERT hits the WITH CHECK expression, not a duplicate key:
      // A holds no row at this point. The pattern is therefore RLS-specific.
      await expectError(
        'cross-user insert',
        () => tx`insert into public.user_responses (user_id, responses_array)
                 values (${A}, ${tx.array(VALID)})`,
        /row-level security/i
      )

      await expectError(
        'authenticated option-bank read',
        () => tx`select count(*) from public.section1_question_options`,
        /permission denied/i
      )
      await expectError(
        'authenticated cutover-marker read',
        () => tx`select count(*) from public.section1_legacy_cutover`,
        /permission denied/i
      )

      // The claim is attempted as the client's own row; the guard below must
      // reject it. (Acting on another user's row would be stopped by RLS first,
      // which would leave the completion guard untested.)
      await tx`select set_config('request.jwt.claim.sub', ${C}, true)`
      await tx`update public.users set section1_complete = true where id = ${C}`
      const forged = await tx`
        select section1_complete from public.users where id = ${C}`
      equal(forged[0].section1_complete, false, 'a completion claim with no answers must be refused')

      await tx.unsafe('reset role')
      await tx`select set_config('request.jwt.claim.sub', '', true)`

      await tx.unsafe('set local role anon')
      await expectError(
        'anon read',
        () => tx`select count(*) from public.user_responses`,
        /permission denied/i
      )
      await expectError(
        'anon write',
        () => tx`insert into public.user_responses (user_id, responses_array)
                 values (${B}, ${tx.array(VALID)})`,
        /permission denied/i
      )
      await expectError(
        'anon option-bank read',
        () => tx`select count(*) from public.section1_question_options`,
        /permission denied/i
      )
      await expectError(
        'anon cutover-marker read',
        () => tx`select count(*) from public.section1_legacy_cutover`,
        /permission denied/i
      )
      await tx.unsafe('reset role')

      throw new RolledBack('rollback')
    })
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error
  }

  // -----------------------------------------------------------------
  // Rollback proof: the complete pre-test state is restored, field by field.
  // Digests are compared as booleans so a failure never prints answer text.
  // -----------------------------------------------------------------
  const restoredState = await captureState(sql)

  ok(restoredState.responseRows === baseline.responseRows,
    `rollback must restore every response row (${baseline.responseRows} before, ${restoredState.responseRows} after)`)
  ok(restoredState.responseDigest === baseline.responseDigest,
    'rollback must restore every response row, its answers and its metadata byte-for-byte')
  ok(restoredState.profileDigest === baseline.profileDigest,
    'rollback must restore Section 1 completion, progress and last-edited for every user')
  ok(restoredState.column === baseline.column && restoredState.columnNotNull === baseline.columnNotNull,
    `rollback must restore responses_array as ${baseline.column} NOT NULL`)
  equal(restoredState.policies, baseline.policies,
    'rollback must restore every existing policy with its definition and roles')
  equal(restoredState.triggers, baseline.triggers,
    'rollback must restore the pre-existing triggers on users and user_responses')
  equal(restoredState.grants, baseline.grants,
    'rollback must restore the pre-existing grants on user_responses')
  equal(restoredState.objects.options, null, 'rollback must remove the option bank')
  equal(restoredState.objects.cutover, null, 'rollback must remove the cutover marker')
  equal(restoredState.objects.functions, 0, 'rollback must remove the Section 1 functions')

  const restored = await sql`
    select id, section1_complete, section1_progress, section1_last_edited
      from public.users
     where id in (${fixtures.ids[0]}, ${fixtures.ids[1]}, ${fixtures.ids[2]})
     order by id`
  for (const row of restored) {
    const original = fixtures.originals.get(row.id)
    equal(row.section1_complete, original.complete, `rollback must restore ${row.id} completion`)
    equal(row.section1_progress, original.progress, `rollback must restore ${row.id} progress`)
    equal(row.section1_last_edited, original.lastEdited, `rollback must restore ${row.id} answer stamp`)
  }
  ok(fixtures.originals.size === 3, 'the rollback proof covers the three fixture users')

  console.log(`Section 1 staging checks passed: ${checks} assertions`)
  console.log('Applied inside a rolled-back transaction: legacy integer[] fixture, migration twice, RLS, guards, refusal')
} finally {
  await side.end({ timeout: 5 })
  await sql.end({ timeout: 5 })
}
