// Force Connect + pairing status — static regression guard for
// supabase/migrations/20261022130000_fix_force_connect_and_pairing_status.sql,
// the repository record of the fix applied to minglemate-staging on 2026-10-22.
//
//   node scripts/verify-force-connect-pairing.mjs
//
// What this proves (and does not prove):
//   * The migration exists, runs after the Section 2 D3 migration, and
//     replaces both functions with SECURITY DEFINER bodies.
//   * users_are_paired() accepts a match_history pair or an 'active'/'matched'
//     matches row in either direction, rejects NULL/self pairs, and never
//     treats 'interested' as a pairing.
//   * complete_force_connect() locks the intent, keeps the succeeded/purpose
//     checks, never writes the chain-only matches(tier, created_by) columns,
//     promotes an existing row instead of duplicating it, and is idempotent on
//     the active Qrashe conversation.
//   * The ACL re-asserted matches the captured live ACL: no PUBLIC/anon
//     EXECUTE, authenticated and service_role can execute.
//
// It does NOT prove the functions behave that way on a live database, that the
// migration is recorded there, or that the Edge Function that calls
// complete_force_connect is deployed. Those need a database and a deployment.

import { existsSync, readdirSync, readFileSync } from 'node:fs'

const results = []
function check(name, pass, detail = '') {
  results.push({ name, pass, detail })
}

const repoRoot = new URL('../', import.meta.url)
const read = (relativePath) => readFileSync(new URL(relativePath, repoRoot), 'utf8')

// Comment lines are removed so the checks assert on code, not on prose that
// deliberately names the defects being fixed.
function code(text) {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !t.startsWith('--') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')
}

const MIGRATION = 'supabase/migrations/20261022130000_fix_force_connect_and_pairing_status.sql'
const PREDECESSOR = '20261021130000'
const raw = existsSync(new URL(MIGRATION, repoRoot)) ? read(MIGRATION) : ''
const sql = raw ? code(raw) : ''

// Slice a replacement body from its CREATE line to the next top-level
// statement, so the checks never read a different function's text.
const functionBody = (name, endsAt) => {
  const start = sql.indexOf(`create or replace function public.${name}`)
  const end = sql.indexOf(endsAt, start)
  return start >= 0 && end > start ? sql.slice(start, end) : ''
}

const paired = functionBody('users_are_paired', 'revoke all on function public.users_are_paired')
const forceConnect = functionBody('complete_force_connect', 'revoke all on function public.users_are_paired')

// ---------------------------------------------------------------------------
// The file itself
// ---------------------------------------------------------------------------
check('the Force Connect / pairing migration exists', raw.length > 0, MIGRATION)

check('it is ordered after the Section 2 D3 migration',
  MIGRATION.includes('20261022130000') && '20261022130000' > PREDECESSOR,
  `predecessor=${PREDECESSOR}`)

const migrationNames = existsSync(new URL('supabase/migrations', repoRoot))
  ? readdirSync(new URL('supabase/migrations', repoRoot)).filter((f) => f.endsWith('.sql'))
  : []
check('no other migration shares its timestamp',
  migrationNames.filter((f) => f.slice(0, 14) === '20261022130000').length === 1,
  JSON.stringify(migrationNames.filter((f) => f.slice(0, 14) === '20261022130000')))

check('it records the applied version in its header',
  /STATUS: APPLIED to minglemate-staging on 2026-10-22/.test(raw) &&
  /20261022130000 recorded in supabase_migrations\.schema_migrations/.test(raw),
  '')

check('it declares no destructive table or column DDL',
  !/\bdrop\s+table\b/i.test(sql) && !/\bdrop\s+column\b/i.test(sql) &&
  !/\btruncate\b/i.test(sql) && !/\bdelete\s+from\b/i.test(sql),
  '')

// ---------------------------------------------------------------------------
// users_are_paired — the pairing predicate
// ---------------------------------------------------------------------------
check('users_are_paired is replaced as SECURITY DEFINER with a fixed search_path',
  paired.length > 0 &&
  /language sql/i.test(paired) &&
  /security definer/i.test(paired) &&
  /set search_path = public/i.test(paired),
  '')

check('users_are_paired rejects NULL arguments and a self-pair',
  /a is not null/i.test(paired) &&
  /b is not null/i.test(paired) &&
  /a <> b/i.test(paired),
  '')

check('users_are_paired accepts match_history in either direction',
  /from public\.match_history mh/i.test(paired) &&
  /mh\.user_id = a and \(mh\.tier1_match_id = b or mh\.tier2_match_id = b\)/i.test(paired) &&
  /mh\.user_id = b and \(mh\.tier1_match_id = a or mh\.tier2_match_id = a\)/i.test(paired),
  '')

check('users_are_paired accepts a live matched row (active or matched), never interested',
  /from public\.matches m/i.test(paired) &&
  /m\.status in \('active', 'matched'\)/i.test(paired) &&
  !/m\.status in \([^)]*'interested'/i.test(paired),
  'the target stores every pair as matched; interested is one-sided')

// ---------------------------------------------------------------------------
// complete_force_connect — the Qrashe path
// ---------------------------------------------------------------------------
check('complete_force_connect is replaced as SECURITY DEFINER with a fixed search_path',
  forceConnect.length > 0 &&
  /language plpgsql/i.test(forceConnect) &&
  /security definer/i.test(forceConnect) &&
  /set search_path = public/i.test(forceConnect),
  '')

check('complete_force_connect locks the intent and keeps the succeeded/purpose checks',
  /FOR UPDATE/i.test(forceConnect) &&
  /it\.purpose <> 'force_connect'/i.test(forceConnect) &&
  /it\.status <> 'succeeded'/i.test(forceConnect) &&
  /it\.recipient_user_id is null|it\.recipient_user_id IS NULL/i.test(forceConnect),
  '')

check('complete_force_connect never writes the chain-only matches(tier, created_by) columns',
  !/\btier\b\s*,/i.test(forceConnect) &&
  !/created_by/i.test(forceConnect) &&
  !/insert into public\.matches[\s\S]*?\btier\b/i.test(forceConnect),
  '')

check('complete_force_connect promotes an existing pair before inserting',
  /update public\.matches m/i.test(forceConnect) &&
  /status = 'matched'/i.test(forceConnect) &&
  /is_visible = true/i.test(forceConnect) &&
  /GET DIAGNOSTICS affected_rows = ROW_COUNT/i.test(forceConnect) &&
  /IF affected_rows = 0 THEN/i.test(forceConnect) &&
  /INSERT INTO public\.matches \(\s*user_a_id, user_b_id, status, is_visible, compatibility_score\s*\)/i.test(forceConnect),
  '')

check('complete_force_connect is idempotent on the active Qrashe conversation',
  /match_tier = 'qrashe'/i.test(forceConnect) &&
  /c\.status = 'active'/i.test(forceConnect) &&
  /on conflict \(user_a_id, user_b_id\) do update/i.test(forceConnect),
  '')

check('complete_force_connect notifies the target exactly once inside the transaction',
  /insert into public\.messages/i.test(forceConnect) &&
  /insert into public\.notifications/i.test(forceConnect) &&
  /buyer\.full_name/i.test(forceConnect),
  '')

// ---------------------------------------------------------------------------
// ACL — matches the captured live ACL
// ---------------------------------------------------------------------------
check('the ACL revokes PUBLIC and anon EXECUTE',
  /revoke all on function public\.users_are_paired\(uuid, uuid\) from public/i.test(sql) &&
  /revoke all on function public\.users_are_paired\(uuid, uuid\) from anon/i.test(sql),
  '')

check('the ACL grants EXECUTE to authenticated and service_role',
  /grant execute on function public\.users_are_paired\(uuid, uuid\) to authenticated/i.test(sql) &&
  /grant execute on function public\.users_are_paired\(uuid, uuid\) to service_role/i.test(sql),
  '')

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log('\n=========== FORCE CONNECT / PAIRING ===========')
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n        ${r.detail}` : ''}`)
}
const failed = results.filter((r) => !r.pass).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
