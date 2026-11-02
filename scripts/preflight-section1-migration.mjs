// Section 1 migration - read-only production preflight.
//
//   $env:SECTION1_PREFLIGHT_DATABASE_URL   = '<Supabase connection string>'
//   $env:SECTION1_PREFLIGHT_CONFIRM_PROJECT = 'mhdjnhiqahsllbczbzpk'
//   node scripts/preflight-section1-migration.mjs
//
// WHY THIS EXISTS
//   supabase/sql/production/20261022180000_production_section1_responses.sql
//   deletes every answer row and resets Section 1 state for every profile on
//   its first run. This tool answers one question before the owner authorises
//   that: does the database actually look the way the migration assumes?
//
// WHAT IT GUARANTEES
//   * one transaction, opened `read only` and repeatable read, always rolled
//     back. Every inspection statement is a SELECT or a catalogue read; the only
//     other statements are transaction control (BEGIN/SET LOCAL/SAVEPOINT). No
//     DDL, no DML, no function call that writes, no migration invocation.
//   * the connection string comes only from SECTION1_PREFLIGHT_DATABASE_URL.
//     There is no fallback to DATABASE_URL, and the string is never printed.
//   * the target must be confirmed twice for a non-loopback host: the project
//     reference must appear in the host or username, and
//     SECTION1_PREFLIGHT_CONFIRM_PROJECT must equal it exactly.
//   * every probe that cannot run is reported as missing evidence, which makes
//     the decision a STOP instead of a clean result.
//   * output contains counts and object metadata only: no emails, names,
//     user ids or answer text.
//
// EXIT CODES
//   0  MATCHES_EXPECTED_STARTING_STATE
//   2  REFUSED_TARGET_OR_USAGE          (nothing was connected)
//   3  STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED
//   4  STOP_MISSING_EVIDENCE            (a check could not run; report is partial)
//   5  STOP_ALREADY_MIGRATED            (a cutover is recorded; nothing to cut over)
//   1  INTERNAL_ERROR                   (the tool itself failed)
//
// A clean result is NOT authorisation. It does not prove the connection points
// at the intended Supabase project, and it does not apply the migration.

import { readFileSync, writeFileSync } from 'node:fs'
import postgres from 'postgres'
import { section1Questions } from '../src/data/section1Questions.js'

const EXPECTED_REF = 'mhdjnhiqahsllbczbzpk'
const TOOL = 'scripts/preflight-section1-migration.mjs'
const TOOL_VERSION = '3'
const ROLLBACK = Symbol('rollback')
const ABORT = Symbol('abort')

// format_type() spells these out; the migration accepts the same set.
const INTEGER_TYPES = new Set(['integer[]', 'bigint[]'])
const TEXT_TYPE = 'text[]'
const EXPECTED_MARKER_COLUMNS = ['deleted_response_rows', 'executed_at', 'reset_user_profiles', 'singleton']
// The structure the migration itself writes: matching names alone are not
// enough, because a nullable count column accepts NULL and `NULL < 0` is NULL,
// not true — so the malformed-marker predicates would pass a NULL count.
const EXPECTED_MARKER_STRUCTURE = {
  singleton: { type: 'boolean', notNull: true },
  executed_at: { type: 'timestamp with time zone', notNull: true },
  deleted_response_rows: { type: 'integer', notNull: true },
  reset_user_profiles: { type: 'integer', notNull: true }
}
// The check constraint the migration writes. Verified against the catalog by
// the suites: pg_get_constraintdef renders `check (singleton)` as this string.
const EXPECTED_MARKER_CHECK = 'CHECK (singleton)'
const EXPECTED_POLICIES = ['responses_insert_own', 'responses_select_own', 'responses_update_own']
const EXPECTED_FUNCTIONS = [
  'public.section1_answers_are_complete(text[])',
  'public.enforce_section1_completion()',
  'public.downgrade_section1_on_invalid_answers()'
]
const EXPECTED_GUARDS = {
  trg_section1_completion_guard: 'public.users',
  trg_section1_responses_guard: 'public.user_responses'
}
const REQUIRED_USERS_COLUMNS = {
  id: 'uuid',
  section1_complete: 'boolean',
  section1_progress: 'integer',
  section1_last_edited: 'timestamp'
}
// The answer-row columns the Section 1 client upserts and the migration's
// post-check reads. A missing one is a schema stop: the deployed client cannot
// save answers against a table without them.
const REQUIRED_RESPONSE_COLUMNS = {
  user_id: 'uuid',
  updated_at: 'timestamp'
}
const EXIT = {
  MATCHES: 0,
  INTERNAL: 1,
  REFUSED: 2,
  INCONSISTENT: 3,
  MISSING_EVIDENCE: 4,
  ALREADY_MIGRATED: 5
}
const CATEGORY = {
  0: 'MATCHES_EXPECTED_STARTING_STATE',
  3: 'STOP_INCONSISTENT_OR_PARTIALLY_MIGRATED',
  4: 'STOP_MISSING_EVIDENCE',
  5: 'STOP_ALREADY_MIGRATED'
}
const REQUIRED_SENTENCE =
  'READ-ONLY PREFLIGHT ONLY \u2014 MIGRATION NOT EXECUTED. OWNER AUTHORIZATION STILL REQUIRED.'

// ---------------------------------------------------------------------------
// Redaction. The URL, its password and any postgres:// string are removed from
// everything printed or written, including error messages from the driver.
// ---------------------------------------------------------------------------
const secrets = []
function registerSecret(value) {
  if (typeof value === 'string' && value.length >= 4) secrets.push(value)
}
function redact(text) {
  let value = String(text ?? '')
  for (const secret of secrets) value = value.split(secret).join('[redacted]')
  return value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted-connection-string]')
}

function parseArgs(argv) {
  const options = { out: null }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--out') {
      options.out = argv[index + 1] ?? ''
      index += 1
    } else if (arg.startsWith('--out=')) {
      options.out = arg.slice('--out='.length)
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      options.unknown = arg
    }
  }
  return options
}

function parseTarget(raw) {
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') return null
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!database) return null
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port: parsed.port || '5432',
    database,
    user: decodeURIComponent(parsed.username || ''),
    password: decodeURIComponent(parsed.password || ''),
    sslmode: parsed.searchParams.get('sslmode')
  }
}

function isLoopback(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === ''
}

class Refusal extends Error {}

// Thrown, not process.exit(): an immediate exit can truncate stderr on Windows
// pipes, and the refusal text is the point of the refusal.
function refuse(message, hint) {
  console.error(`REFUSED: ${redact(message)}`)
  if (hint) console.error(hint)
  console.error(REQUIRED_SENTENCE)
  throw new Refusal('refused before connecting')
}

function usage() {
  return [
    'Usage:',
    '  SECTION1_PREFLIGHT_DATABASE_URL=<connection string> \\',
    `  SECTION1_PREFLIGHT_CONFIRM_PROJECT=${EXPECTED_REF} \\`,
    `  node ${TOOL} [--out <report file>]`,
    '',
    'The connection string is read only from SECTION1_PREFLIGHT_DATABASE_URL.',
    'DATABASE_URL is never used as a fallback.',
    'Loopback targets are for the disposable local test fixture only and also',
    'require SECTION1_PREFLIGHT_ALLOW_LOCAL=1.'
  ].join('\n')
}

// ---------------------------------------------------------------------------
// Inspection. Everything below runs inside the read-only transaction.
// ---------------------------------------------------------------------------
async function inspect(tx, evidence) {
  let savepoints = 0

  async function attempt(label, run) {
    const name = `preflight_${savepoints}`
    savepoints += 1
    await tx.unsafe(`savepoint ${name}`)
    try {
      const value = await run()
      await tx.unsafe(`release savepoint ${name}`)
      return value
    } catch (error) {
      await tx.unsafe(`rollback to savepoint ${name}`).catch(() => {})
      await tx.unsafe(`release savepoint ${name}`).catch(() => {})
      const code = error?.code ? ` [${error.code}]` : ''
      const message = redact(error?.message ?? error).slice(0, 240)
      evidence.push(`${label} could not be read${code}: ${message}`)
      return undefined
    }
  }

  const ctx = {}

  // -- 1. Server and connection identity ------------------------------------
  ctx.server = await attempt('server identity', async () => {
    const rows = await tx`
      select current_database()                                         as database,
             current_user                                               as role,
             session_user                                               as session_role,
             current_setting('server_version')                          as server_version,
             current_setting('server_version_num')::int                 as server_version_num,
             current_setting('is_superuser')                            as is_superuser,
             (select rolbypassrls from pg_roles where rolname = current_user) as bypassrls,
             pg_is_in_recovery()                                        as in_recovery,
             coalesce(inet_server_addr()::text, '')                     as server_addr,
             inet_server_port()                                         as server_port,
             coalesce((select setting from pg_settings where name = 'ssl'), '') as ssl`
    return rows[0]
  })

  ctx.supabase = await attempt('Supabase schema markers', async () => {
    const rows = await tx`
      select to_regclass('auth.users') is not null                       as auth_users,
             to_regprocedure('auth.uid()') is not null                   as auth_uid,
             to_regclass('storage.objects') is not null                  as storage_objects,
             exists (select 1 from pg_namespace where nspname = 'supabase_migrations') as migrations_schema,
             (select count(*)::int from pg_extension
               where extname in ('pgcrypto', 'pg_net', 'supabase_vault', 'pgsodium', 'pg_stat_statements')) as extensions`
    return rows[0]
  })

  // -- 2. Tables, ownership, RLS -------------------------------------------
  ctx.tables = await attempt('table catalogue', async () => {
    const rows = await tx`
      select n.nspname || '.' || c.relname                     as name,
             c.relkind::text                                   as kind,
             c.relrowsecurity                                  as rls,
             c.relforcerowsecurity                             as force_rls,
             pg_get_userbyid(c.relowner)                       as owner,
             pg_has_role(current_user, c.relowner, 'USAGE')    as can_act_as_owner
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where c.oid in (to_regclass('public.user_responses'), to_regclass('public.users'))
       order by 1`
    return rows
  })

  const responsesTable = ctx.tables.find(table => table.name === 'public.user_responses')
  const usersTable = ctx.tables.find(table => table.name === 'public.users')

  // -- 3. Column state ------------------------------------------------------
  if (responsesTable) {
    ctx.column = await attempt('public.user_responses.responses_array', async () => {
      const rows = await tx`
        select format_type(a.atttypid, a.atttypmod) as type,
               a.attnotnull                         as not_null,
               a.attnum                             as attnum,
               t.typtype = 'd'                      as is_domain
          from pg_attribute a
          join pg_type t on t.oid = a.atttypid
         where a.attrelid = 'public.user_responses'::regclass
           and a.attname = 'responses_array'
           and not a.attisdropped`
      return rows.length ? rows[0] : { present: false }
    })
  }

  if (usersTable) {
    ctx.usersColumns = await attempt('Section 1 columns on public.users', async () => {
      const rows = await tx`
        select a.attname::text                        as name,
               format_type(a.atttypid, a.atttypmod)   as type,
               a.attnotnull                           as not_null
          from pg_attribute a
         where a.attrelid = 'public.users'::regclass
           and a.attname in ('id', 'section1_complete', 'section1_progress', 'section1_last_edited')
           and not a.attisdropped
         order by 1`
      return rows
    })
  }

  if (responsesTable) {
    ctx.responseColumns = await attempt('required columns on public.user_responses', async () => {
      const rows = await tx`
        select a.attname::text                        as name,
               format_type(a.atttypid, a.atttypmod)   as type,
               a.attnotnull                           as not_null
          from pg_attribute a
         where a.attrelid = 'public.user_responses'::regclass
           and a.attname in ('user_id', 'updated_at')
           and not a.attisdropped
         order by 1`
      return rows
    })
  }

  // -- 3b. Effective COLUMN privileges for the client's Section 1 operations --
  // src/pages/Section1.jsx reads section1_progress + section1_complete and
  // filters on id; it updates section1_progress, section1_complete and
  // section1_last_edited (also filtering on id). The client upserts user_id,
  // responses_array and updated_at on public.user_responses. A table-level
  // grant implies every column, but a column-level grant list does not imply
  // the table, so has_column_privilege() is the effective check for each
  // column the client actually touches. Absent column -> null here; the schema
  // stop for a missing column already covers that case.
  if (usersTable) {
    ctx.usersColumnPrivileges = await attempt('client column privileges on public.users', async () => {
      const rows = await tx`
        with required(name, privilege) as (values
          ('id', 'SELECT'),
          ('section1_complete', 'SELECT'),
          ('section1_progress', 'SELECT'),
          ('section1_complete', 'UPDATE'),
          ('section1_progress', 'UPDATE'),
          ('section1_last_edited', 'UPDATE')
        )
        select r.name, r.privilege,
               a.attname is not null as column_present,
               case when a.attname is null then null
                    else has_column_privilege('authenticated', 'public.users', r.name, r.privilege)
               end as allowed
          from required r
          left join pg_attribute a
            on a.attrelid = 'public.users'::regclass
           and a.attname = r.name
           and not a.attisdropped
         order by 1, 2`
      return rows
    })
  }

  if (responsesTable) {
    ctx.responseColumnPrivileges = await attempt('client column privileges on public.user_responses', async () => {
      const rows = await tx`
        with required(name, privilege) as (values
          ('user_id', 'SELECT'),
          ('responses_array', 'SELECT'),
          ('updated_at', 'SELECT'),
          ('user_id', 'INSERT'),
          ('responses_array', 'INSERT'),
          ('updated_at', 'INSERT'),
          ('user_id', 'UPDATE'),
          ('responses_array', 'UPDATE'),
          ('updated_at', 'UPDATE')
        )
        select r.name, r.privilege,
               a.attname is not null as column_present,
               case when a.attname is null then null
                    else has_column_privilege('authenticated', 'public.user_responses', r.name, r.privilege)
               end as allowed
          from required r
          left join pg_attribute a
            on a.attrelid = 'public.user_responses'::regclass
           and a.attname = r.name
           and not a.attisdropped
         order by 1, 2`
      return rows
    })
  }

  // -- 4. Counts (the destructive footprint) --------------------------------
  if (usersTable) {
    ctx.data = await attempt('Section 1 data counts', async () => {
      const users = await tx`
        select count(*)::bigint                                                    as profiles,
               count(*) filter (where section1_complete is true)::bigint           as complete_true,
               count(*) filter (where section1_complete is null)::bigint           as complete_null,
               count(*) filter (where coalesce(section1_progress, 0) <> 0)::bigint as nonzero_progress,
               count(*) filter (where section1_last_edited is not null)::bigint    as stamped
          from public.users`
      const rows = responsesTable
        ? await tx`select count(*)::bigint as n from public.user_responses`
        : null
      return {
        profiles: Number(users[0].profiles),
        completeTrue: Number(users[0].complete_true),
        completeNull: Number(users[0].complete_null),
        nonzeroProgress: Number(users[0].nonzero_progress),
        stamped: Number(users[0].stamped),
        responseRows: rows ? Number(rows[0].n) : null
      }
    })
  }

  // -- 5. Cutover marker ----------------------------------------------------
  ctx.markerPresent = await attempt('cutover marker presence', async () => {
    const rows = await tx`select to_regclass('public.section1_legacy_cutover') is not null as present`
    return rows[0].present
  })

  if (ctx.markerPresent) {
    ctx.marker = await attempt('cutover marker contents', async () => {
      const shape = await tx`
        select a.attname                            as name,
               format_type(a.atttypid, a.atttypmod) as type,
               a.attnotnull                         as not_null,
               pg_get_expr(d.adbin, d.adrelid)      as default_expr
          from pg_attribute a
          left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
         where a.attrelid = 'public.section1_legacy_cutover'::regclass
           and a.attnum > 0
           and not a.attisdropped
         order by a.attname`
      const primary = await tx`
        select a.attname as name
          from pg_constraint c
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
         where c.conrelid = 'public.section1_legacy_cutover'::regclass
           and c.contype = 'p'
         order by array_position(c.conkey, a.attnum)`
      const checks = await tx`
        select conname as name, pg_get_constraintdef(oid) as definition
          from pg_constraint
         where conrelid = 'public.section1_legacy_cutover'::regclass
           and contype = 'c'
         order by conname`
      const count = await tx`select count(*)::bigint as n from public.section1_legacy_cutover`
      const table = await tx`
        select c.relrowsecurity as rls
          from pg_class c
         where c.oid = 'public.section1_legacy_cutover'::regclass`
      const rows = Number(count[0].n)
      let row = null
      if (rows === 1) {
        const content = await tx`
          select singleton is true                as singleton_ok,
                 executed_at is not null          as timestamp_present,
                 deleted_response_rows            as deleted_rows,
                 reset_user_profiles              as reset_profiles
            from public.section1_legacy_cutover`
        row = content[0]
      }
      return {
        columns: shape.map(column => column.name),
        detail: shape,
        primaryKey: primary.map(column => column.name),
        checks,
        rows,
        rls: table[0].rls,
        row
      }
    })
  }

  // Only meaningful once the column is text[]; a row that holds at least one
  // numeric string and NO nonnumeric non-null value is the signature of
  // converted legacy answers. NULL elements do not clear the suspicion (a
  // converted legacy row may be sparse); only real option text does. An all-NULL
  // row cannot be told apart from legitimate partial data and is not flagged.
  if (responsesTable && ctx.column?.type === TEXT_TYPE) {
    ctx.numericOnlyRows = await attempt('numeric-only answer scan', async () => {
      const rows = await tx`
        select count(*)::bigint as n
          from public.user_responses ur
         where coalesce(cardinality(ur.responses_array), 0) > 0
           and exists (
             select 1
               from unnest(ur.responses_array) as value
              where value is not null and value ~ '^-?[0-9]+$'
           )
           and not exists (
             select 1
               from unnest(ur.responses_array) as value
              where value is not null and value !~ '^-?[0-9]+$'
           )`
      return Number(rows[0].n)
    })
  }

  // -- 6. Option bank -------------------------------------------------------
  ctx.optionsPresent = await attempt('option bank presence', async () => {
    const rows = await tx`select to_regclass('public.section1_question_options') is not null as present`
    return rows[0].present
  })

  if (ctx.optionsPresent) {
    ctx.options = await attempt('option bank contents', async () => {
      const shape = await tx`
        select coalesce(array_agg(a.attname::text order by a.attname), '{}') as columns
          from pg_attribute a
         where a.attrelid = 'public.section1_question_options'::regclass
           and a.attnum > 0
           and not a.attisdropped`
      const stats = await tx`
        select count(*)::bigint                            as rows,
               count(distinct question_number)::bigint      as questions
          from public.section1_question_options`
      const table = await tx`
        select c.relrowsecurity as rls
          from pg_class c
         where c.oid = 'public.section1_question_options'::regclass`
      const entries = await tx`
        select question_number::int as question, option_text::text as option
          from public.section1_question_options`
      return {
        columns: shape[0].columns,
        rows: Number(stats[0].rows),
        questions: Number(stats[0].questions),
        rls: table[0].rls,
        bank: compareBank(entries)
      }
    })
  }

  // -- 7. Functions ---------------------------------------------------------
  ctx.functions = []
  ctx.functionsComplete = true
  for (const signature of EXPECTED_FUNCTIONS) {
    const found = await attempt(`function ${signature}`, async () => {
      const rows = await tx`
        select n.nspname || '.' || p.oid::regprocedure::text as signature,
               p.prosecdef                                   as security_definer,
               coalesce(array_to_string(p.proconfig, ', '), '') as config,
               case when to_regrole('anon') is null then null
                    else has_function_privilege('anon', p.oid, 'EXECUTE') end          as anon_execute,
               case when to_regrole('authenticated') is null then null
                    else has_function_privilege('authenticated', p.oid, 'EXECUTE') end as authenticated_execute
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
         where p.oid = to_regprocedure(${signature})`
      return rows.length ? rows[0] : null
    })
    if (found === undefined) ctx.functionsComplete = false
    else if (found) ctx.functions.push(found)
  }

  // -- 8. Triggers ----------------------------------------------------------
  if (responsesTable || usersTable) {
    ctx.triggers = await attempt('triggers', async () => {
      const rows = await tx`
        select t.tgname                                     as name,
               n.nspname || '.' || c.relname                as table_name,
               t.tgenabled::text                            as enabled,
               pn.nspname || '.' || p.oid::regprocedure::text as function,
               pg_get_triggerdef(t.oid)                     as definition,
               p.prosecdef                                  as security_definer,
               coalesce(array_to_string(p.proconfig, ', '), '') as config,
               (position('section1_complete' in p.prosrc) > 0
                or position('section1_progress' in p.prosrc) > 0
                or position('section1_last_edited' in p.prosrc) > 0) as touches_section1_state,
               length(p.prosrc)                             as body_length
          from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
          join pg_proc p on p.oid = t.tgfoid
          join pg_namespace pn on pn.oid = p.pronamespace
         where not t.tgisinternal
           and n.nspname = 'public'
           and c.relname in ('users', 'user_responses')
         order by 2, 1`
      return rows
    })
  }

  // -- 9. Policies ----------------------------------------------------------
  if (responsesTable) {
    ctx.policies = await attempt('policies on public.user_responses', async () => {
      const rows = await tx`
        select p.polname                                          as name,
               p.polcmd::text                                     as command,
               coalesce(pg_get_expr(p.polqual, p.polrelid), '')      as using_expression,
               coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as with_check_expression,
               coalesce((select string_agg(coalesce(r.rolname, 'PUBLIC'), ', ' order by u.ord)
                           from unnest(p.polroles) with ordinality as u(role_oid, ord)
                           left join pg_roles r on r.oid = u.role_oid), '') as roles
          from pg_policy p
         where p.polrelid = 'public.user_responses'::regclass
         order by p.polname`
      return rows
    })
  }

  // -- 10. Grants and effective privileges ----------------------------------
  ctx.roles = await attempt('client roles', async () => {
    const rows = await tx`
      select rolname::text as name
        from pg_roles
       where rolname in ('anon', 'authenticated', 'service_role')
       order by 1`
    const present = new Set(rows.map(row => row.name))
    return {
      anon: present.has('anon'),
      authenticated: present.has('authenticated'),
      serviceRole: present.has('service_role')
    }
  })

  ctx.schemaCreate = await attempt('schema privilege', async () => {
    const rows = await tx`select has_schema_privilege(current_user, 'public', 'CREATE') as allowed`
    return rows[0].allowed
  })

  if (responsesTable) {
    ctx.directAcl = await attempt('direct grants on public.user_responses', async () => {
      const rows = await tx`
        select coalesce(r.rolname, 'PUBLIC') as grantee,
               a.privilege_type              as privilege,
               a.is_grantable                as grantable
          from pg_class c
          cross join lateral aclexplode(c.relacl) a
          left join pg_roles r on r.oid = a.grantee
         where c.oid = 'public.user_responses'::regclass
         order by 1, 2`
      return rows
    })

    ctx.effective = {}
    for (const role of ['anon', 'authenticated', 'service_role']) {
      if (!ctx.roles?.[role === 'service_role' ? 'serviceRole' : role]) continue
      ctx.effective[role] = await attempt(`effective privileges for ${role}`, async () => {
        const rows = await tx`
          select has_table_privilege(${role}, 'public.user_responses', 'SELECT')     as select,
                 has_table_privilege(${role}, 'public.user_responses', 'INSERT')     as insert,
                 has_table_privilege(${role}, 'public.user_responses', 'UPDATE')     as update,
                 has_table_privilege(${role}, 'public.user_responses', 'DELETE')     as delete,
                 has_table_privilege(${role}, 'public.user_responses', 'TRUNCATE')   as truncate,
                 has_table_privilege(${role}, 'public.user_responses', 'REFERENCES') as references,
                 has_table_privilege(${role}, 'public.user_responses', 'TRIGGER')    as trigger,
                 ${ctx.optionsPresent
                   ? tx`has_table_privilege(${role}, 'public.section1_question_options', 'SELECT') as options_select,
                        has_table_privilege(${role}, 'public.section1_question_options', 'INSERT') as options_insert,
                        has_table_privilege(${role}, 'public.section1_question_options', 'UPDATE') as options_update,
                        has_table_privilege(${role}, 'public.section1_question_options', 'DELETE') as options_delete,
                        has_table_privilege(${role}, 'public.section1_question_options', 'TRUNCATE') as options_truncate`
                   : tx`null::boolean as options_select,
                        null::boolean as options_insert,
                        null::boolean as options_update,
                        null::boolean as options_delete,
                        null::boolean as options_truncate`},
                 ${ctx.markerPresent
                   ? tx`has_table_privilege(${role}, 'public.section1_legacy_cutover', 'SELECT') as marker_select,
                        has_table_privilege(${role}, 'public.section1_legacy_cutover', 'INSERT') as marker_insert,
                        has_table_privilege(${role}, 'public.section1_legacy_cutover', 'UPDATE') as marker_update,
                        has_table_privilege(${role}, 'public.section1_legacy_cutover', 'DELETE') as marker_delete,
                        has_table_privilege(${role}, 'public.section1_legacy_cutover', 'TRUNCATE') as marker_truncate`
                   : tx`null::boolean as marker_select,
                        null::boolean as marker_insert,
                        null::boolean as marker_update,
                        null::boolean as marker_delete,
                        null::boolean as marker_truncate`}`
        return rows[0]
      })
    }
  }

  ctx.defaultAcl = await attempt('default privileges', async () => {
    const rows = await tx`
      select coalesce(r.rolname, 'PUBLIC')  as role,
             coalesce(n.nspname, '-')       as schema,
             d.defaclobjtype::text          as object_type,
             coalesce((select string_agg(coalesce(g.rolname, 'PUBLIC') || '=' || a.privilege_type,
                                         ',' order by a.privilege_type)
                         from aclexplode(d.defaclacl) a
                         left join pg_roles g on g.oid = a.grantee), '') as grants
        from pg_default_acl d
        left join pg_roles r on r.oid = d.defaclrole
        left join pg_namespace n on n.oid = d.defaclnamespace
       order by 1, 2, 3`
    return rows
  })

  // -- 11. Dependent objects ------------------------------------------------
  if (responsesTable) {
    ctx.foreignKeys = await attempt('foreign keys referencing public.user_responses', async () => {
      const rows = await tx`
        select con.conname                               as name,
               src_n.nspname || '.' || src.relname       as referencing_table,
               con.confdeltype::text                     as on_delete,
               pg_get_constraintdef(con.oid)             as definition
          from pg_constraint con
          join pg_class src on src.oid = con.conrelid
          join pg_namespace src_n on src_n.oid = src.relnamespace
         where con.contype = 'f'
           and con.confrelid = 'public.user_responses'::regclass
         order by 1`
      return rows
    })

    ctx.dependents = await attempt('views and rules depending on responses_array', async () => {
      const rows = await tx`
        select distinct dep_n.nspname || '.' || dep.relname as dependent_object,
               dep.relkind::text                            as object_kind,
               d.refobjsubid                                as column_dependency,
               rw.rulename::text                            as rule
          from pg_depend d
          join pg_rewrite rw on rw.oid = d.objid
          join pg_class dep on dep.oid = rw.ev_class
          join pg_namespace dep_n on dep_n.oid = dep.relnamespace
         where d.classid = 'pg_rewrite'::regclass
           and d.refclassid = 'pg_class'::regclass
           and d.refobjid = 'public.user_responses'::regclass
           and d.refobjsubid in (
                 0,
                 (select a.attnum from pg_attribute a
                   where a.attrelid = 'public.user_responses'::regclass
                     and a.attname = 'responses_array')
               )
           and dep.oid <> 'public.user_responses'::regclass
         order by 1`
      return rows
    })

    ctx.rules = await attempt('rules on public.user_responses', async () => {
      const rows = await tx`
        select rw.rulename::text as name
          from pg_rewrite rw
         where rw.ev_class = 'public.user_responses'::regclass
           and rw.rulename <> '_RETURN'
         order by 1`
      return rows
    })
  }

  ctx.publications = await attempt('publication membership', async () => {
    const rows = await tx`
      select pubname::text as publication, tablename::text as table_name
        from pg_publication_tables
       where schemaname = 'public'
         and tablename in ('user_responses', 'users')
       order by 1, 2`
    return rows
  })

  return ctx
}

function compareBank(entries) {
  const expected = new Set()
  section1Questions.forEach((question, index) => {
    for (const option of question.options) expected.add(`${index + 1}\u0000${option}`)
  })
  const actual = new Set(entries.map(entry => `${entry.question}\u0000${entry.option}`))
  let missing = 0
  let extra = 0
  for (const key of expected) if (!actual.has(key)) missing += 1
  for (const key of actual) if (!expected.has(key)) extra += 1
  return { missing, extra, matches: missing === 0 && extra === 0 }
}

// ---------------------------------------------------------------------------
// Classification. Precedence: a definite state conflict wins over a check that
// could not run, because the conflict is actionable on its own; a check that
// could not run wins over "already migrated", which cannot be confirmed.
// ---------------------------------------------------------------------------
function evaluate(ctx, identity) {
  const blocking = []
  const evidence = [...ctx.evidence]
  const notes = []
  const warnings = []

  const stop = message => blocking.push({ kind: 'inconsistent', message })
  const review = message => blocking.push({ kind: 'review', message })

  const tables = ctx.tables ?? []
  const tablesKnown = Array.isArray(ctx.tables)
  const responsesPresent = tables.some(table => table.name === 'public.user_responses')
  const usersPresent = tables.some(table => table.name === 'public.users')
  const column = ctx.column
  const columnType = column?.type
  const isInteger = INTEGER_TYPES.has(columnType)
  const isText = columnType === TEXT_TYPE
  const marker = ctx.marker
  const markerRows = marker?.rows
  const options = ctx.options
  const functions = (ctx.functions ?? []).map(fn => fn.signature)
  const triggers = ctx.triggers ?? []
  const policies = ctx.policies ?? []
  const section1Triggers = triggers.filter(trigger =>
    /section1/i.test(trigger.name) || trigger.touches_section1_state
  )
  const guards = triggers.filter(trigger => trigger.name in EXPECTED_GUARDS
    && EXPECTED_GUARDS[trigger.name] === trigger.table_name)

  // -- schema ---------------------------------------------------------------
  if (tablesKnown && !responsesPresent) stop('public.user_responses is missing; the migration refuses to run')
  if (tablesKnown && !usersPresent) stop('public.users is missing; the migration resets Section 1 state there')
  if (responsesPresent) {
    const table = tables.find(item => item.name === 'public.user_responses')
    if (table.kind !== 'r') stop(`public.user_responses is a ${table.kind} relation, not an ordinary table`)
    if (column?.present === false) stop('public.user_responses.responses_array is missing; the migration refuses to run')
    if (column?.is_domain) stop(`responses_array is a domain over ${columnType}; the migration expects a plain array type`)
    if (columnType && !isInteger && !isText) {
      stop(`responses_array is ${columnType}; the migration only handles integer[]/bigint[]/text[]`)
    }
  }
  if (usersPresent && Array.isArray(ctx.usersColumns)) {
    const columns = ctx.usersColumns
    for (const [name, expectedType] of Object.entries(REQUIRED_USERS_COLUMNS)) {
      const found = columns.find(item => item.name === name)
      if (!found) {
        stop(name === 'id'
          ? `public.users.${name} is missing; the Section 1 client and the migration need it`
          : `public.users.${name} is missing; the migration writes it`)
        continue
      }
      const compatible = expectedType === 'timestamp'
        ? /^timestamp/.test(found.type)
        : found.type === expectedType
      if (!compatible) {
        stop(name === 'id'
          ? `public.users.${name} is ${found.type}; the Section 1 client and the migration need uuid`
          : `public.users.${name} is ${found.type}; the migration writes a ${expectedType}`)
      }
    }
  }
  if (responsesPresent && Array.isArray(ctx.responseColumns)) {
    const columns = ctx.responseColumns
    for (const [name, expectedType] of Object.entries(REQUIRED_RESPONSE_COLUMNS)) {
      const found = columns.find(item => item.name === name)
      if (!found) {
        stop(`public.user_responses.${name} is missing; the Section 1 client and the migration need it`)
        continue
      }
      const compatible = expectedType === 'timestamp'
        ? /^timestamp/.test(found.type)
        : found.type === expectedType
      if (!compatible) {
        stop(`public.user_responses.${name} is ${found.type}; the Section 1 client and the migration need ${expectedType === 'timestamp' ? 'a timestamp type' : expectedType}`)
      }
    }
  }

  // -- authority ------------------------------------------------------------
  // Effective column privileges for what the client actually does with
  // Section 1 (src/pages/Section1.jsx): read progress + completion, update the
  // three Section 1 columns, upsert the answer row. A missing privilege means
  // the deployed client cannot save or resume Section 1 after the cutover, so
  // it blocks authorisation. An unassessed probe is missing evidence.
  const CLIENT_COLUMN_PRIVILEGES = [
    ['users', 'public.users', 'id', 'SELECT'],
    ['users', 'public.users', 'section1_complete', 'SELECT'],
    ['users', 'public.users', 'section1_progress', 'SELECT'],
    ['users', 'public.users', 'section1_complete', 'UPDATE'],
    ['users', 'public.users', 'section1_progress', 'UPDATE'],
    ['users', 'public.users', 'section1_last_edited', 'UPDATE'],
    ['responses', 'public.user_responses', 'user_id', 'SELECT'],
    ['responses', 'public.user_responses', 'responses_array', 'SELECT'],
    ['responses', 'public.user_responses', 'updated_at', 'SELECT'],
    ['responses', 'public.user_responses', 'user_id', 'INSERT'],
    ['responses', 'public.user_responses', 'responses_array', 'INSERT'],
    ['responses', 'public.user_responses', 'updated_at', 'INSERT'],
    ['responses', 'public.user_responses', 'user_id', 'UPDATE'],
    ['responses', 'public.user_responses', 'responses_array', 'UPDATE'],
    ['responses', 'public.user_responses', 'updated_at', 'UPDATE']
  ]
  for (const [group, table, column, privilege] of CLIENT_COLUMN_PRIVILEGES) {
    const probe = group === 'users' ? ctx.usersColumnPrivileges : ctx.responseColumnPrivileges
    if (!Array.isArray(probe)) continue // probe failed (evidence recorded) or the table is absent (schema stop)
    const entry = probe.find(item => item.name === column && item.privilege === privilege)
    if (!entry || entry.column_present === false) continue // missing column: schema stop already covers it
    if (entry.allowed === false) {
      stop(`role authenticated lacks ${privilege} on ${table}.${column}; the deployed Section 1 client needs it to save or resume answers`)
    }
  }

  for (const table of tables) {
    if (!table.can_act_as_owner) {
      evidence.push(`the connected role cannot act as owner of ${table.name}; ALTER TABLE, CREATE POLICY and LOCK would fail`)
    }
  }

  // -- FORCE ROW LEVEL SECURITY -------------------------------------------
  // The migration runs with `row_security = off` inside its transaction, so a
  // statement that RLS would filter FAILS instead of affecting a subset of
  // rows. That is only safe when the run can actually see every row: with FORCE
  // ROW LEVEL SECURITY on a table and an executing role that is neither
  // superuser nor BYPASSRLS, the DELETE, the global reset, the emptiness
  // assertion and the reset postcondition are all subject to filtering, so the
  // preflight cannot establish that the full-table operations will behave as
  // intended. Stop rather than authorise; if the role's BYPASSRLS status
  // could not be read, that is missing evidence instead.
  if (tablesKnown) {
    const serverKnown = ctx.server !== undefined
    const canBypassRls = serverKnown
      && (ctx.server.is_superuser === 'on' || ctx.server.bypassrls === true)
    for (const table of tables) {
      if (!table.force_rls) continue
      if (!serverKnown) {
        evidence.push(`${table.name} has FORCE ROW LEVEL SECURITY and the executing role's BYPASSRLS status could not be read; the full-table delete and reset cannot be confirmed to affect all rows`)
      } else if (canBypassRls) {
        notes.push(`${table.name} has FORCE ROW LEVEL SECURITY; the executing role is superuser or BYPASSRLS, so the run is not filtered and sees every row`)
      } else {
        stop(`${table.name} has FORCE ROW LEVEL SECURITY and the executing role is neither superuser nor BYPASSRLS; the migration's global delete, reset and their postconditions would be filtered or fail, so it cannot be shown to affect all rows`)
      }
    }
  }
  if (ctx.schemaCreate === false) {
    evidence.push('the connected role lacks CREATE on schema public; the migration creates tables and functions there')
  }
  if (ctx.roles) {
    if (!ctx.roles.anon) evidence.push('role anon is absent; the migration revokes from and grants against it')
    if (!ctx.roles.authenticated) evidence.push('role authenticated is absent; the migration grants to it')
    if (!ctx.roles.serviceRole) notes.push('role service_role is absent; the migration skips its optional SELECT grant')
  }
  if (ctx.supabase?.auth_uid === false) {
    evidence.push('auth.uid() is absent; the migration installs policies that call it')
  }
  if (ctx.server?.in_recovery === true) {
    evidence.push('pg_is_in_recovery() is true; the target is a standby and must not run the migration')
  }

  // -- destructive footprint ------------------------------------------------
  if (ctx.data) {
    const firstRun = isInteger && markerRows !== 1
    if (ctx.data.responseRows === null) {
      notes.push('answer row count was not read')
    } else if (firstRun) {
      notes.push(`a first run would delete ${ctx.data.responseRows} answer row(s) and reset ${ctx.data.profiles} profile(s)`)
    } else if (isText) {
      notes.push('responses_array is already text[]: no first-run deletion or reset applies')
    }
    if (firstRun && ctx.data.completeTrue > 0) {
      notes.push(`${ctx.data.completeTrue} profile(s) are marked section1_complete = true and would be reset`)
    }
  }

  // -- object inventory -----------------------------------------------------
  if (isInteger) {
    if (markerRows === 1) {
      stop('a cutover marker exists while responses_array is still integer[]; the marker and schema disagree and the migration refuses this state')
    } else if (markerRows > 1) {
      stop(`the cutover marker holds ${markerRows} rows; the migration requires a singleton`)
    } else {
      if (marker && !markerShapeOk(marker)) {
        stop('public.section1_legacy_cutover exists with the wrong shape; the migration refuses to read it as its marker')
      }
      if (options) stop('the option bank exists although the cutover has not happened; this is a partial previous execution')
      if (functions.length) stop(`Section 1 function(s) already exist: ${functions.join(', ')}; partial previous execution`)
      if (section1Triggers.length) {
        stop(`Section 1 trigger(s) already exist: ${section1Triggers.map(trigger => trigger.name).join(', ')}; partial previous execution`)
      }
      if (column && column.not_null === false) {
        notes.push('responses_array is nullable; the migration sets NOT NULL itself, so this does not block')
      }
    }
  }

  let alreadyMigrated = false
  if (isText) {
    if (ctx.markerPresent === undefined) {
      // The marker presence probe failed; attempt() already recorded evidence.
    } else if (!ctx.markerPresent) {
      stop('responses_array is already text[] with no cutover marker; the migration cannot tell legacy from current answers and refuses')
    } else if (markerRows === 0) {
      stop('responses_array is already text[] but the cutover marker is empty; no cutover was recorded')
    } else if (markerRows === undefined) {
      // The marker contents could not be read; evidence governs the decision.
    } else if (markerRows > 1) {
      stop(`the cutover marker holds ${markerRows} rows; the migration requires a singleton`)
    } else if (markerRows === 1) {
      const beforeBranch = blocking.length
      if (marker && !markerShapeOk(marker)) {
        stop(`the cutover marker table has the wrong shape: ${markerShapeProblems(marker).join('; ')}`)
      }
      if (marker && !markerRowOk(marker.row)) stop('the cutover marker row is malformed (singleton, timestamp or counts)')
      if (!column?.not_null) stop('responses_array is text[] but nullable; a completed cutover leaves NOT NULL')
      if (ctx.numericOnlyRows === undefined) {
        // attempt() already recorded missing evidence
      } else if (ctx.numericOnlyRows > 0) {
        stop(`${ctx.numericOnlyRows} answer row(s) hold only numeric values (NULL elements allowed): converted legacy answers, not option text`)
      }
      if (!options) {
        stop('the option bank is missing although a cutover is recorded')
      } else {
        if (!options.columns?.includes('question_number') || !options.columns?.includes('option_text')) {
          stop(`the option bank has the wrong shape (${(options.columns ?? []).join(', ')})`)
        }
        if (options.rows !== 200 || options.questions !== 50) {
          stop(`the option bank holds ${options.rows} rows across ${options.questions} questions; expected 200 rows across 50`)
        } else if (options.bank && !options.bank.matches) {
          stop(`the option bank differs from src/data/section1Questions.js (${options.bank.missing} missing, ${options.bank.extra} unexpected entries)`)
        }
        if (options.rls !== true) stop('the option bank does not have row level security enabled')
      }
      const missingFunctions = ctx.functionsComplete
        ? EXPECTED_FUNCTIONS.filter(signature => !functions.includes(signature))
        : []
      if (missingFunctions.length) stop(`missing Section 1 function(s): ${missingFunctions.join(', ')}`)
      if (Array.isArray(ctx.triggers) && guards.length !== 2) {
        stop(`expected both Section 1 guards, found ${guards.map(guard => guard.name).join(', ') || 'none'}`)
      }
      if (Array.isArray(ctx.policies)) {
        const policyNames = policies.map(policy => policy.name).sort()
        if (policyNames.join(',') !== [...EXPECTED_POLICIES].sort().join(',')) {
          stop(`user_responses has ${policies.length} policy/policies (${policyNames.join(', ') || 'none'}); a completed cutover leaves exactly the three owner policies`)
        }
        if (policies.some(policy => /auth\.role\(\)/.test(policy.using_expression))) {
          stop('a role-wide read policy is still present on user_responses')
        }
      }
      if (marker && marker.rls !== true) stop('the cutover marker does not have row level security enabled')
      const table = tables.find(item => item.name === 'public.user_responses')
      if (table && table.rls !== true) stop('row level security is not enabled on public.user_responses')

      // Post-cutover effective privileges.
      const anon = ctx.effective?.anon
      const authenticated = ctx.effective?.authenticated
      if (anon && (anon.select || anon.insert || anon.update || anon.delete || anon.truncate)) {
        stop('anon still holds a privilege on public.user_responses; a completed cutover revokes all of them')
      }
      if (authenticated && (authenticated.delete || authenticated.truncate || authenticated.references || authenticated.trigger)) {
        stop('authenticated still holds DELETE/TRUNCATE/REFERENCES/TRIGGER on public.user_responses')
      }
      if (authenticated && !(authenticated.select && authenticated.insert && authenticated.update)) {
        stop('authenticated does not hold SELECT/INSERT/UPDATE on public.user_responses')
      }
      for (const role of ['anon', 'authenticated']) {
        const grant = ctx.effective?.[role]
        if (!grant) continue
        const clientGrant = grant.options_select || grant.options_insert || grant.options_update
          || grant.options_delete || grant.options_truncate
          || grant.marker_select || grant.marker_insert || grant.marker_update
          || grant.marker_delete || grant.marker_truncate
        if (clientGrant) stop(`${role} holds a privilege on the option bank or the cutover marker; a completed cutover revokes both`)
      }
      for (const fn of ctx.functions ?? []) {
        if (fn.anon_execute || fn.authenticated_execute) {
          stop(`${fn.signature} is executable by a client role; a completed cutover revokes EXECUTE from PUBLIC, anon and authenticated`)
        }
      }

      alreadyMigrated = blocking
        .slice(beforeBranch)
        .every(entry => entry.kind !== 'inconsistent')
    }
  }

  // -- object conflicts (all paths) ----------------------------------------
  for (const dependent of ctx.dependents ?? []) {
    review(`${dependent.dependent_object} depends on responses_array (rule ${dependent.rule}); ALTER COLUMN TYPE will fail until that object is dropped or recreated`)
  }
  for (const trigger of triggers) {
    if (!(trigger.name in EXPECTED_GUARDS) && trigger.touches_section1_state) {
      review(`trigger ${trigger.name} on ${trigger.table_name} references Section 1 state; confirm it does not fight the reset or the guards`)
    }
  }
  for (const foreignKey of ctx.foreignKeys ?? []) {
    const action = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' }[foreignKey.on_delete]
      ?? foreignKey.on_delete
    stop(`${foreignKey.referencing_table} has a foreign key to public.user_responses with ON DELETE ${action}; deleting every answer row would fail or modify another table (${foreignKey.definition}), which the migration documents as untouched`)
  }

  // -- notes that do not block ---------------------------------------------
  const roleWide = policies.filter(policy => /auth\.role\(\)/.test(policy.using_expression))
  if (roleWide.length) {
    notes.push(`${roleWide.length} pre-rewrite role-wide read policy on user_responses will be dropped by the migration`)
  }
  if (isInteger && policies.length) {
    notes.push(`${policies.length} existing policy/policies on user_responses will be dropped and replaced by the migration`)
  }
  if (ctx.data && ctx.data.completeTrue > 0 && !ctx.data.responseRows) {
    notes.push('at least one profile is marked complete with no answer row; the reset corrects that')
  }
  for (const publication of ctx.publications ?? []) {
    notes.push(`${publication.table_name} is part of publication ${publication.publication}`)
  }
  if ((ctx.defaultAcl ?? []).length) {
    notes.push(`${(ctx.defaultAcl ?? []).length} default privilege entr(y/ies) exist for schema public; the migration grants and revokes explicitly`)
  }
  if (ctx.optionsPresent === false && isInteger) {
    notes.push('option bank, cutover marker and Section 1 guards are absent, as expected before a first run')
  }

  if (identity.tier !== 'OPERATOR_SUPPLIED_REF_MATCH') {
    notes.push('this run targets a loopback fixture, not a Supabase project; the result says nothing about production')
  }

  const hasInconsistent = blocking.some(entry => entry.kind === 'inconsistent' || entry.kind === 'review')
  let exitCode
  if (hasInconsistent) exitCode = EXIT.INCONSISTENT
  else if (evidence.length) exitCode = EXIT.MISSING_EVIDENCE
  else if (alreadyMigrated) exitCode = EXIT.ALREADY_MIGRATED
  else exitCode = EXIT.MATCHES

  return { blocking, evidence, notes, warnings, exitCode, category: CATEGORY[exitCode] }
}

// The exact structure the migration writes, not just the column names: the
// four columns and no others, their types and NOT NULL, the two defaults, a
// primary key on singleton alone, and the singleton check. Each entry is one
// problem; markerShapeOk is simply "no problems".
function markerShapeProblems(marker) {
  const problems = []
  const columns = marker?.columns ?? []
  const unexpected = columns.filter(name => !EXPECTED_MARKER_COLUMNS.includes(name))
  const missing = EXPECTED_MARKER_COLUMNS.filter(name => !columns.includes(name))
  if (unexpected.length) problems.push(`unexpected column ${unexpected.join(', ')}`)
  if (missing.length) problems.push(`missing column ${missing.join(', ')}`)
  const detail = marker?.detail
  if (Array.isArray(detail)) {
    for (const [name, expected] of Object.entries(EXPECTED_MARKER_STRUCTURE)) {
      const column = detail.find(entry => entry.name === name)
      if (!column) continue
      if (column.type !== expected.type || column.not_null !== expected.notNull) {
        problems.push(`${name} ${column.type}${column.not_null ? '' : ' (nullable)'} must be ${expected.type} ${expected.notNull ? 'NOT NULL' : 'nullable'}`)
      }
    }
    const singletonDefault = detail.find(entry => entry.name === 'singleton')?.default_expr
    if (singletonDefault !== 'true') {
      problems.push(`singleton default must be true, found ${singletonDefault ?? 'no default'}`)
    }
    const executedDefault = detail.find(entry => entry.name === 'executed_at')?.default_expr
    if (executedDefault !== 'now()') {
      problems.push(`executed_at default must be now(), found ${executedDefault ?? 'no default'}`)
    }
  } else {
    problems.push('the column structure could not be read')
  }
  const primaryKey = marker?.primaryKey
  if (!Array.isArray(primaryKey) || primaryKey.join(',') !== 'singleton') {
    problems.push(`primary key must be singleton alone, found ${Array.isArray(primaryKey) && primaryKey.length ? primaryKey.join(', ') : 'none'}`)
  }
  const checks = marker?.checks
  if (!Array.isArray(checks) || !checks.some(check => check.definition === EXPECTED_MARKER_CHECK)) {
    problems.push(`check must be ${EXPECTED_MARKER_CHECK}, found ${Array.isArray(checks) && checks.length ? checks.map(check => check.definition).join(', ') : 'none'}`)
  }
  return problems
}

function markerShapeOk(marker) {
  return markerShapeProblems(marker).length === 0
}

function markerRowOk(row) {
  if (!row) return false
  // `Number(null) === 0`, so a plain `>= 0` would accept a NULL count as zero.
  // The counts are integer columns, so anything but a nonnegative integer —
  // including NULL — is not a recorded count this file can trust.
  return row.singleton_ok === true
    && row.timestamp_present === true
    && Number.isInteger(row.deleted_rows)
    && row.deleted_rows >= 0
    && Number.isInteger(row.reset_profiles)
    && row.reset_profiles >= 0
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const COMMAND_LABELS = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', '*': 'ALL' }

function render(ctx, identity, decision) {
  const lines = []
  const push = (text = '') => lines.push(text)
  const row = (label, value) => push(`  ${label.padEnd(25)} ${value}`)
  const yesNo = value => (value === undefined || value === null ? 'not assessed' : value ? 'yes' : 'no')
  const list = values => (values && values.length ? values.join(', ') : 'none')

  push('='.repeat(78))
  push(' MingleMate - Section 1 migration preflight (READ ONLY)')
  push('='.repeat(78))
  row('tool', `${TOOL} (v${TOOL_VERSION})`)
  row('generated', new Date().toISOString())
  row('expected project ref', EXPECTED_REF)

  push('')
  push('1. TARGET')
  row('host', `${identity.host}:${identity.port}`)
  row('database', identity.database)
  row('connection string', 'from SECTION1_PREFLIGHT_DATABASE_URL (never printed)')
  row('project ref confirmed', identity.confirm === 'matched'
    ? 'SECTION1_PREFLIGHT_CONFIRM_PROJECT matched'
    : identity.confirm === 'loopback' ? 'not required for a loopback fixture' : identity.confirm)
  row('identity tier', identity.tier)
  row('identity note', identity.note)
  if (ctx.server) {
    row('server version', ctx.server.server_version)
    row('server address', ctx.server.server_addr ? `${ctx.server.server_addr}:${ctx.server.server_port}` : 'unix socket (no TCP address)')
    row('session user', `${ctx.server.session_role}${ctx.server.role === ctx.server.session_role ? '' : ` (current ${ctx.server.role})`}`)
    row('superuser / bypassrls', `${yesNo(ctx.server.is_superuser === 'on')} / ${yesNo(ctx.server.bypassrls)}`)
    row('in recovery', yesNo(ctx.server.in_recovery))
    row('ssl', ctx.server.ssl || 'not reported')
  } else {
    row('server version', 'not assessed')
  }
  if (ctx.supabase) {
    row('Supabase markers', `auth.users=${yesNo(ctx.supabase.auth_users)} auth.uid()=${yesNo(ctx.supabase.auth_uid)} `
      + `storage.objects=${yesNo(ctx.supabase.storage_objects)} supabase_migrations=${yesNo(ctx.supabase.migrations_schema)} `
      + `extensions=${ctx.supabase.extensions}`)
  }

  push('')
  push('2. SCHEMA AND AUTHORITY')
  if (!Array.isArray(ctx.tables)) {
    row('tables', 'not assessed')
  } else {
    for (const table of ctx.tables) {
      row(table.name, `${table.kind === 'r' ? 'table' : `relation kind ${table.kind}`}, rls=${yesNo(table.rls)}${table.force_rls ? ' (FORCE)' : ''}, `
        + `owner=${table.owner}, can act as owner=${yesNo(table.can_act_as_owner)}`)
    }
    if (!ctx.tables.some(table => table.name === 'public.user_responses')) row('public.user_responses', 'MISSING')
    if (!ctx.tables.some(table => table.name === 'public.users')) row('public.users', 'MISSING')
  }
  if (ctx.column) {
    row('responses_array.type', ctx.column.present === false ? 'MISSING' : ctx.column.type)
    row('responses_array.null', ctx.column.present === false ? '-' : ctx.column.not_null ? 'NOT NULL' : 'nullable')
  } else {
    row('responses_array', 'not assessed')
  }
  if (ctx.usersColumns) {
    row('users Section 1 columns', ctx.usersColumns.length
      ? ctx.usersColumns.map(column => `${column.name} ${column.type}`).join(', ')
      : 'none of section1_complete, section1_progress, section1_last_edited')
  }
  row('schema public CREATE', yesNo(ctx.schemaCreate))
  if (ctx.roles) {
    row('roles', `anon=${yesNo(ctx.roles.anon)} authenticated=${yesNo(ctx.roles.authenticated)} service_role=${yesNo(ctx.roles.serviceRole)}`)
  }
  const renderColumnPrivileges = (label, probe) => {
    if (!Array.isArray(probe)) {
      row(label, 'not assessed')
      return
    }
    const denied = probe.filter(entry => entry.column_present && entry.allowed === false)
    const pending = probe.filter(entry => entry.column_present && entry.allowed === undefined)
    row(label, denied.length
      ? `MISSING ${denied.map(entry => `${entry.privilege} ${entry.name}`).join(', ')}`
      : pending.length ? 'partially not assessed'
        : `all present (${probe.length} checks)`)
  }
  renderColumnPrivileges('client column privs users', ctx.usersColumnPrivileges)
  renderColumnPrivileges('client column privs responses', ctx.responseColumnPrivileges)

  push('')
  push('3. DATA (read-only counts, no identifiers)')
  if (ctx.data) {
    row('answer rows', ctx.data.responseRows ?? 'not assessed')
    row('profiles', ctx.data.profiles)
    row('section1_complete = true', ctx.data.completeTrue)
    row('section1_complete null', ctx.data.completeNull)
    row('progress <> 0', ctx.data.nonzeroProgress)
    row('last_edited not null', ctx.data.stamped)
    if (ctx.data.responseRows !== null) {
      row('first-run footprint', ctx.column?.type === TEXT_TYPE
        ? 'not applicable: responses_array is already text[]'
        : `DELETE ${ctx.data.responseRows} answer row(s); RESET ${ctx.data.profiles} profile(s)`)
    }
  } else {
    row('counts', 'not assessed')
  }
  if (ctx.numericOnlyRows !== undefined) row('numeric-only answer rows', ctx.numericOnlyRows)

  push('')
  push('4. MIGRATION OBJECTS')
  if (ctx.markerPresent === undefined) {
    row('cutover marker', 'not assessed')
  } else if (!ctx.markerPresent) {
    row('cutover marker', 'absent')
  } else if (ctx.marker) {
    const markerColumns = Array.isArray(ctx.marker.detail)
      ? ctx.marker.detail.map(column =>
          `${column.name} ${column.type}${column.not_null ? '' : ' (nullable)'}`
          + ` default ${column.default_expr ?? 'none'}`).join(', ')
      : (ctx.marker.columns ?? []).join(', ')
    row('cutover marker', `${ctx.marker.rows} row(s), rls=${yesNo(ctx.marker.rls)}, columns=${markerColumns || 'none'}`)
    row('  marker constraints',
      `primary key (${(ctx.marker.primaryKey ?? []).join(', ') || 'none'}); `
      + `check ${ctx.marker.checks?.map(check => check.definition).join(', ') || 'none'}`)
    if (ctx.marker.row) {
      row('  marker contents', `singleton=${yesNo(ctx.marker.row.singleton_ok)} executed_at=${yesNo(ctx.marker.row.timestamp_present)} `
        + `deleted_rows=${ctx.marker.row.deleted_rows} reset_profiles=${ctx.marker.row.reset_profiles}`)
    }
  } else {
    row('cutover marker', 'present (contents not assessed)')
  }
  if (!ctx.optionsPresent) {
    row('option bank', ctx.optionsPresent === undefined ? 'not assessed' : 'absent')
  } else if (ctx.options) {
    row('option bank', `${ctx.options.rows} row(s) across ${ctx.options.questions} question(s), rls=${yesNo(ctx.options.rls)}, `
      + `repo match=${ctx.options.bank ? yesNo(ctx.options.bank.matches) : 'not assessed'}`)
  } else {
    row('option bank', 'present (contents not assessed)')
  }
  const foundFunctions = ctx.functions ?? []
  const functionDetail = `${foundFunctions.length} of ${EXPECTED_FUNCTIONS.length}`
    + `${foundFunctions.length ? ` (${foundFunctions.map(fn => fn.signature).join(', ')})` : ''}`
  row('functions', ctx.functionsComplete ? functionDetail : `${functionDetail} - read incomplete, see below`)
  const triggers = ctx.triggers
  if (triggers === undefined) {
    row('guards', 'not assessed')
  } else {
    const guards = triggers.filter(trigger => trigger.name in EXPECTED_GUARDS
      && EXPECTED_GUARDS[trigger.name] === trigger.table_name)
    row('guards', `${guards.length} of 2${guards.length ? ` (${guards.map(guard => guard.name).join(', ')})` : ''}`)
    const other = triggers.filter(trigger => !(trigger.name in EXPECTED_GUARDS))
    if (other.length) {
      row('other triggers', `${other.length} (see section 6)`)
    }
  }

  push('')
  push('5. POLICIES AND EFFECTIVE PRIVILEGES')
  if (ctx.policies === undefined) {
    row('policies', 'not assessed')
  } else if (!ctx.policies.length) {
    row('policies on user_responses', 'none')
  } else {
    push('  policies on public.user_responses')
    for (const policy of ctx.policies) {
      push(`    - ${policy.name} [${COMMAND_LABELS[policy.command] ?? policy.command}] roles=${policy.roles || 'none'}`)
      if (policy.using_expression) push(`        USING ${policy.using_expression}`)
      if (policy.with_check_expression) push(`        WITH CHECK ${policy.with_check_expression}`)
    }
  }
  if (ctx.effective && Object.keys(ctx.effective).length) {
    row('effective privileges', 'has_table_privilege() on public.user_responses, inherited PUBLIC included; '
      + 'has_column_privilege() per Section 1 client column in section 2')
    for (const [role, grant] of Object.entries(ctx.effective)) {
      if (!grant) continue
      const held = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']
        .filter(privilege => grant[privilege])
      row(`  ${role}`, held.length ? held.map(privilege => privilege.toUpperCase()).join(', ') : 'none')
      const clientObjects = ['options_select', 'options_insert', 'options_update', 'options_delete', 'options_truncate',
        'marker_select', 'marker_insert', 'marker_update', 'marker_delete', 'marker_truncate'].filter(key => grant[key])
      if (clientObjects.length) row(`  ${role} on bank/marker`, clientObjects.join(', '))
    }
  } else {
    row('effective privileges', 'not assessed')
  }
  if (ctx.directAcl) {
    const summary = {}
    for (const entry of ctx.directAcl) {
      summary[entry.grantee] = summary[entry.grantee] ?? []
      summary[entry.grantee].push(`${entry.privilege}${entry.grantable ? '*' : ''}`)
    }
    row('direct ACL on table', Object.keys(summary).length
      ? Object.entries(summary).map(([grantee, privileges]) => `${grantee}: ${privileges.sort().join(',')}`).join(' | ')
      : 'none')
  }
  if (ctx.defaultAcl) {
    row('default privileges', ctx.defaultAcl.length
      ? ctx.defaultAcl.map(entry => `${entry.role} on ${entry.object_type} in ${entry.schema}: ${entry.grants || 'none'}`).join(' | ')
      : 'none')
  }

  push('')
  push('6. TRIGGERS AND DEPENDENT OBJECTS')
  if (ctx.triggers === undefined) {
    row('triggers', 'not assessed')
  } else if (!ctx.triggers.length) {
    row('non-internal triggers', 'none on public.users or public.user_responses')
  } else {
    push('  non-internal triggers')
    for (const trigger of ctx.triggers) {
      push(`    - ${trigger.table_name}.${trigger.name} enabled=${trigger.enabled}`)
      push(`        ${trigger.definition}`)
      push(`        function ${trigger.function} security_definer=${yesNo(trigger.security_definer)} `
        + `config=${trigger.config || 'none'} body=${trigger.body_length} bytes touches_section1_state=${yesNo(trigger.touches_section1_state)}`)
    }
  }
  row('foreign keys to user_responses', ctx.foreignKeys === undefined ? 'not assessed'
    : (ctx.foreignKeys.length
      ? ctx.foreignKeys.map(key => `${key.referencing_table} ON DELETE ${key.on_delete}`).join('; ')
      : 'none'))
  row('views/rules on responses_array', ctx.dependents === undefined ? 'not assessed'
    : (ctx.dependents.length
      ? ctx.dependents.map(dependent => `${dependent.dependent_object} (rule ${dependent.rule}, column dependency ${dependent.column_dependency})`).join('; ')
      : 'none'))
  row('rules on user_responses', ctx.rules === undefined ? 'not assessed' : list((ctx.rules ?? []).map(rule => rule.name)))
  row('publications', ctx.publications === undefined ? 'not assessed'
    : (ctx.publications.length
      ? ctx.publications.map(entry => `${entry.publication}:${entry.table_name}`).join(', ')
      : 'none'))

  push('')
  push('7. DECISION')
  row('category', decision.category)
  row('exit code', decision.exitCode)
  push('  reasons')
  if (decision.blocking.length) {
    for (const entry of decision.blocking) push(`    - [${entry.kind}] ${entry.message}`)
  } else if (decision.exitCode === EXIT.ALREADY_MIGRATED) {
    push('    - a completed cutover is recorded and the post-cutover object set is complete; there is nothing left to cut over')
  } else if (decision.evidence.length) {
    push('    - no state conflict was found, but a required check could not run, so the state cannot be confirmed')
  } else {
    push('    - the observable schema, object inventory and privileges match the documented starting assumptions')
  }
  if (decision.evidence.length) {
    push('  could not assess')
    for (const message of decision.evidence) push(`    - ${message}`)
  }
  if (decision.notes.length) {
    push('  notes')
    for (const message of decision.notes) push(`    - ${message}`)
  }
  if (decision.warnings.length) {
    push('  warnings')
    for (const message of decision.warnings) push(`    - ${message}`)
  }

  push('')
  push('WHAT THIS REPORT DOES NOT PROVE')
  push('  * that the supplied connection really reaches the intended Supabase project:')
  push('    only the dashboard/service can confirm that. Verify the host and project there')
  push('    before treating this report as evidence.')
  push('  * that a backup or PITR restore has been tested, or that a recovery target exists.')
  push('  * that the migration behaves the same on this server: it is verified on disposable')
  push('    PostgreSQL 17 and 18 clusters, not on this instance.')
  push('')
  push(`  ${REQUIRED_SENTENCE}`)

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }
  if (options.unknown) refuse(`unknown argument: ${options.unknown}`, usage())
  if (options.out === '') refuse('--out needs a file path', usage())

  const raw = process.env.SECTION1_PREFLIGHT_DATABASE_URL
  if (!raw || !raw.trim()) {
    refuse(
      'SECTION1_PREFLIGHT_DATABASE_URL is not set. Nothing was connected.',
      'This tool deliberately does not fall back to DATABASE_URL.\n' + usage()
    )
  }
  const target = parseTarget(raw.trim())
  if (!target) refuse('SECTION1_PREFLIGHT_DATABASE_URL is not a postgres:// connection string with a database name.')
  registerSecret(raw.trim())
  registerSecret(target.password)
  registerSecret(`${target.user}:${target.password}`)

  const loopback = isLoopback(target.host)
  const refInTarget = target.host.includes(EXPECTED_REF) || target.user.includes(EXPECTED_REF)
  const confirmed = process.env.SECTION1_PREFLIGHT_CONFIRM_PROJECT

  if (loopback) {
    if (process.env.SECTION1_PREFLIGHT_ALLOW_LOCAL !== '1') {
      refuse(
        'the target host is loopback. That path exists for the disposable local test fixture only; set SECTION1_PREFLIGHT_ALLOW_LOCAL=1 to acknowledge it is not a Supabase project.'
      )
    }
  } else {
    if (confirmed !== EXPECTED_REF) {
      refuse(
        `SECTION1_PREFLIGHT_CONFIRM_PROJECT must be exactly ${EXPECTED_REF} (got ${confirmed ? 'a different value' : 'nothing'}).`,
        'The project ref must also appear in the connection host or username.'
      )
    }
    if (!refInTarget) {
      refuse(
        `the expected project ref ${EXPECTED_REF} does not appear in the connection host or username, so this looks like a different target.`
      )
    }
  }

  const identity = {
    tier: loopback ? 'LOCAL_DISPOSABLE_FIXTURE' : 'OPERATOR_SUPPLIED_REF_MATCH',
    host: target.host,
    port: target.port,
    database: target.database,
    confirm: loopback ? 'loopback' : 'matched',
    note: loopback
      ? 'loopback fixture: this is not a Supabase project, and the result says nothing about production'
      : 'the ref appears in the host/username you supplied and the confirmation variable matched. This tool cannot independently prove the project: check the host and project in the Supabase dashboard before trusting this report.'
  }

  const ctx = { evidence: [] }
  let sql
  try {
    sql = postgres(raw.trim(), {
      max: 1,
      connect_timeout: 15,
      idle_timeout: 5,
      onnotice: () => {},
      connection: { application_name: 'section1_preflight' }
    })
  } catch (error) {
    ctx.evidence.push(`the driver rejected the connection string: ${redact(error?.message ?? error)}`)
  }

  if (sql) {
    try {
      await sql.begin('isolation level repeatable read read only', async tx => {
        const readOnly = await tx`show transaction_read_only`
        if (readOnly[0]?.transaction_read_only !== 'on') {
          ctx.evidence.push('the session did not enter a read-only transaction; refusing to run inspection queries')
          throw ABORT
        }
        await tx.unsafe("set local statement_timeout = '60s'")
        await tx.unsafe("set local lock_timeout = '5s'")
        const inspected = await inspect(tx, ctx.evidence)
        Object.assign(ctx, inspected)
        throw ROLLBACK
      })
    } catch (error) {
      if (error !== ROLLBACK && error !== ABORT) {
        const code = error?.code ? ` [${error.code}]` : ''
        ctx.evidence.push(`the read-only transaction could not be established${code}: ${redact(error?.message ?? error).slice(0, 240)}`)
      }
    } finally {
      await sql.end({ timeout: 5 }).catch(() => {})
    }
  }

  const decision = evaluate(ctx, identity)
  const report = render(ctx, identity, decision)

  if (options.out) {
    try {
      writeFileSync(options.out, `${report}\n`, 'utf8')
    } catch (error) {
      console.error(`could not write ${options.out}: ${redact(error?.message ?? error)}`)
      process.exitCode = EXIT.INTERNAL
      return
    }
  }

  console.log(report)
  process.exitCode = decision.exitCode
}

main().catch(error => {
  if (error instanceof Refusal) {
    process.exitCode = EXIT.REFUSED
    return
  }
  console.error(`INTERNAL ERROR: ${redact(error?.stack ?? error)}`)
  console.error(REQUIRED_SENTENCE)
  process.exitCode = EXIT.INTERNAL
})
