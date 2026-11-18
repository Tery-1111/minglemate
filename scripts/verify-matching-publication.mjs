#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Verifies the matching publication migration.
//
// Part 1 — static safety properties of the SQL file.
// Part 2 — the real plpgsql functions, executed against an in-memory Postgres
//          (PGlite). This is the "RPC migration test in an isolated
//          environment": no server, no data, nothing persisted.
//
// PGlite is a devDependency. If it cannot be resolved from this worktree, run
// with an explicit path:
//   PGLITE_MODULE=/abs/path/to/node_modules/@electric-sql/pglite/dist/index.js \
//     node scripts/verify-matching-publication.mjs
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATION = join(here, '..', 'supabase', 'migrations', '20261118120000_match_generation_fencing.sql')
const MIGRATION_D2 = join(here, '..', 'supabase', 'migrations', '20261119120000_match_publication_pt409.sql')
const sql = readFileSync(MIGRATION, 'utf8')
const sqlD2 = readFileSync(MIGRATION_D2, 'utf8')

let checks = 0
const failures = []
function check(name, condition, detail = '') {
  checks++
  if (!condition) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${name}${!condition && detail ? ` — ${detail}` : ''}`)
}

console.log('Part 1 — migration static properties')

const fenceAt = sql.indexOf("raise exception 'stale_generation'")
const deleteAt = sql.indexOf('delete from public.match_history')
check('fence check is present', fenceAt > 0)
check('week delete is present', deleteAt > 0)
check('fence is evaluated before the week delete', fenceAt > 0 && deleteAt > 0 && fenceAt < deleteAt)
const replayAt = sql.indexOf('generation_conflict')
check('replay binding is enforced before the week delete', replayAt > 0 && replayAt < deleteAt)
check('the published payload is stored for comparison', /published_rows\s+jsonb/.test(sql))
check('week delete is scoped by week_id', /delete from public\.match_history\s+where week_id = p_week_id/.test(sql))
check('publishers are serialised with a row lock', /for update/.test(sql))
check('no advisory-lock dependency', !/pg_advisory/.test(sql))
check('insert is guarded against empty uuid strings', sql.includes("nullif(r->>'tier1_match_id', '')::uuid"))
check('generations are minted from a sequence', sql.includes("nextval('public.match_generation_seq')"))
check('concurrent beginnings are order independent', sql.includes('greatest(public.match_week_generations.latest_generation'))
check('execution granted to service_role only', !/grant execute[\s\S]*?to\s+(anon|authenticated|public)\b/.test(sql))
check('anon/authenticated are revoked', /revoke all on function public\.publish_week_allocation/.test(sql) && /from public, anon, authenticated/.test(sql))
check('no users-table or gender change', !/alter table public\.users/i.test(sql) && !/gender/i.test(sql))
check('no match_history schema change', !/alter table public\.match_history/i.test(sql))
check('fence state is readable by service_role only', /grant select on public\.match_week_generations to service_role/.test(sql) && !/grant select on public\.match_week_generations to (anon|authenticated|public)/.test(sql))

console.log('Part 1b — MM-D2 conflict SQLSTATE migration')

const d2FenceAt = sqlD2.indexOf('stale_generation')
const d2DeleteAt = sqlD2.indexOf('delete from public.match_history')
const d2ConflictAt = sqlD2.indexOf('generation_conflict')
check('MM-D2 recreates the same function signature', /create or replace function public\.publish_week_allocation\(\s*p_week_id\s+text,\s*p_generation bigint,\s*p_rows\s+jsonb\s*\)/m.test(sqlD2))
check('MM-D2 raises stale_generation as PT409', /raise exception using errcode = 'PT409', message = 'stale_generation'/.test(sqlD2))
check('MM-D2 raises generation_conflict as PT409', /raise exception using errcode = 'PT409', message = 'generation_conflict'/.test(sqlD2))
check('MM-D2 leaves no 40001 in the function', !/errcode = '40001'/.test(sqlD2))
check('MM-D2 keeps the fence check before the week delete', d2FenceAt > 0 && d2DeleteAt > 0 && d2FenceAt < d2DeleteAt)
check('MM-D2 keeps the payload comparison before the week delete', d2ConflictAt > 0 && d2DeleteAt > 0 && d2ConflictAt < d2DeleteAt)
check('MM-D2 keeps the week row lock', /for update/.test(sqlD2))
check('MM-D2 keeps the week-scoped delete', /delete from public\.match_history where week_id = p_week_id/.test(sqlD2))
check('MM-D2 stays security definer with a fixed search_path', /security definer/.test(sqlD2) && /set search_path = public/.test(sqlD2))
check('MM-D2 keeps execution to service_role only', /grant execute on function public\.publish_week_allocation\(text, bigint, jsonb\) to service_role/.test(sqlD2) && !/grant execute[\s\S]*?to\s+(anon|authenticated|public)\b/.test(sqlD2))
check('MM-D2 touches no table other than through the function', !/^\s*(insert into|delete from|update|alter table|drop)\b/im.test(sqlD2.split('as $$')[0]))

const candidates = [process.env.PGLITE_MODULE, '@electric-sql/pglite'].filter(Boolean)
let PGlite = null
for (const candidate of candidates) {
  try {
    const mod = await import(candidate)
    PGlite = mod.PGlite ?? mod.default?.PGlite ?? null
    if (PGlite) break
  } catch {
    // try the next candidate
  }
}

if (!PGlite) {
  console.log('\nPart 2 — SKIPPED: @electric-sql/pglite is not resolvable from this worktree.')
  console.log('  Set PGLITE_MODULE to dist/index.js of an installed copy to run the SQL tests.')
  process.exit(failures.length ? 1 : 0)
}

console.log('\nPart 2 — real functions on an in-memory Postgres')

const db = new PGlite()
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema if not exists public;
  create table public.users (id uuid primary key);
  create table public.match_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references public.users(id) on delete cascade,
    week_id text,
    tier1_match_id uuid,
    tier2_match_id uuid,
    delivered_at timestamptz
  );
`)
await db.exec('create unique index match_history_user_week_uidx on public.match_history (user_id, week_id)')
await db.exec(sql)
await db.exec(sqlD2)

const query = async (text, params) => (await db.query(text, params)).rows
const insertUser = async (id) => {
  await db.query('insert into public.users (id) values ($1) on conflict do nothing', [id])
}
const U = (n) => `00000000-0000-4000-8000-00000000000${n}`
await insertUser(U(1))
await insertUser(U(2))
await insertUser(U(3))

const rows = (week) => query('select user_id, tier1_match_id from public.match_history where week_id = $1 order by user_id', [week])
const expectError = async (text, params, needle) => {
  try {
    await db.query(text, params)
    return `no error raised (expected ${needle})`
  } catch (error) {
    return String(error.message).includes(needle) ? null : `wrong error: ${error.message}`
  }
}
// MM-D2: the two intentional verdicts must arrive as PT409 so PostgREST can
// answer them as HTTP 409 instead of dropping the connection.
const sqlStateOf = async (text, params) => {
  try {
    await db.query(text, params)
    return { code: null, message: null }
  } catch (error) {
    return { code: error.code ?? error.sqlState ?? null, message: String(error.message) }
  }
}
const payload = (pairs) =>
  JSON.stringify(
    pairs.map(([user, partner]) => ({
      user_id: user,
      week_id: 'ignored-by-publish',
      tier1_match_id: partner,
      tier2_match_id: null,
      delivered_at: '2026-11-18T18:00:00.000Z',
    })),
  )

// 1. monotonic generations
const g1 = (await query("select public.begin_match_generation('2099-W01') as g"))[0].g
const g2 = (await query("select public.begin_match_generation('2099-W01') as g"))[0].g
const gOther = (await query("select public.begin_match_generation('2099-W02') as g"))[0].g
check('generations are strictly increasing', Number(g1) < Number(g2) && Number(g2) < Number(gOther), `${g1} < ${g2} < ${gOther}`)

// 2. stale generation is rejected before any write, as PT409
const staleVerdict = await sqlStateOf('select public.publish_week_allocation($1,$2,$3::jsonb)', ['2099-W01', g1, payload([[U(1), U(2)]])])
check(
  'stale generation raises stale_generation',
  (await expectError('select public.publish_week_allocation($1,$2,$3::jsonb)', ['2099-W01', g1, payload([[U(1), U(2)]])], 'stale_generation')) === null,
)
check('stale generation raises SQLSTATE PT409', staleVerdict.code === 'PT409', JSON.stringify(staleVerdict))
check('stale generation carries the stale_generation message', staleVerdict.message === 'stale_generation', JSON.stringify(staleVerdict))
check('a rejected run writes nothing', (await rows('2099-W01')).length === 0)

// 3. the current generation replaces the week
const published = await query('select public.publish_week_allocation($1,$2,$3::jsonb) as r', ['2099-W01', g2, payload([[U(1), U(2)], [U(2), U(1)]])])
check('current generation publishes', published[0].r.published === 2, JSON.stringify(published[0].r))
check('rows are committed', (await rows('2099-W01')).length === 2)

// 4. the counters advanced
const state = (await query('select latest_generation, latest_published_generation from public.match_week_generations where week_id = $1', ['2099-W01']))[0]
check('latest_published_generation records the publisher', String(state.latest_published_generation) === String(g2))
check('latest_generation is the newest authorization', String(state.latest_generation) === String(g2))

// 5. replay binding: an identical replay is idempotent and writes NOTHING
const snapshot = async (week) =>
  await query('select id::text, user_id::text, tier1_match_id::text from public.match_history where week_id = $1 order by user_id', [week])
const liveBefore = await snapshot('2099-W01')
const replay = (
  await query('select public.publish_week_allocation($1,$2,$3::jsonb) as r', ['2099-W01', g2, payload([[U(1), U(2)], [U(2), U(1)]])])
)[0].r
check('an identical replay of the published generation is accepted', replay.published === 2 && replay.replayed === true, JSON.stringify(replay))
check('an identical replay writes nothing (row ids unchanged)', JSON.stringify(await snapshot('2099-W01')) === JSON.stringify(liveBefore))

// 6. the same generation may not publish a different payload (D-1), as PT409
const conflictVerdict = await sqlStateOf('select public.publish_week_allocation($1,$2,$3::jsonb)', ['2099-W01', g2, payload([[U(1), U(2)], [U(2), U(3)]])])
check(
  'a changed payload under the same generation raises generation_conflict',
  (await expectError('select public.publish_week_allocation($1,$2,$3::jsonb)', ['2099-W01', g2, payload([[U(1), U(2)], [U(2), U(3)]])], 'generation_conflict')) === null,
)
check('a changed payload raises SQLSTATE PT409', conflictVerdict.code === 'PT409', JSON.stringify(conflictVerdict))
check('a changed payload carries the generation_conflict message', conflictVerdict.message === 'generation_conflict', JSON.stringify(conflictVerdict))
check('the published allocation survives the rejection', JSON.stringify(await snapshot('2099-W01')) === JSON.stringify(liveBefore))
const stateAfterConflict = (await query('select latest_published_generation from public.match_week_generations where week_id = $1', ['2099-W01']))[0]
check('the published counter is unchanged after a conflict', String(stateAfterConflict.latest_published_generation) === String(g2))

// 7. a NEWER generation replaces the week and removes obsolete rows
const g3 = (await query("select public.begin_match_generation('2099-W01') as g"))[0].g
const replaced = await query('select public.publish_week_allocation($1,$2,$3::jsonb) as r', ['2099-W01', g3, payload([[U(1), U(3)], [U(3), U(1)]])])
check('a newer generation replaces the week', replaced[0].r.published === 2 && (await rows('2099-W01')).every((r) => String(r.tier1_match_id).endsWith('3') || String(r.user_id).endsWith('3')))
check('obsolete rows are gone', (await rows('2099-W01')).length === 2)

// 8. historical weeks are untouched
await db.query("insert into public.match_history (user_id, week_id, tier1_match_id) values ($1,'2098-W52',$2)", [U(1), U(2)])
const g4 = (await query("select public.begin_match_generation('2099-W01') as g"))[0].g
await query('select public.publish_week_allocation($1,$2,$3::jsonb)', ['2099-W01', g4, '[]'])
check('an empty allocation clears the target week', (await rows('2099-W01')).length === 0)
check('a historical week survives', (await rows('2098-W52')).length === 1)

// 9. a failing replacement rolls back and preserves the previous allocation
const g5 = (await query("select public.begin_match_generation('2099-W01') as g"))[0].g
await query('select public.publish_week_allocation($1,$2,$3::jsonb)', ['2099-W01', g5, payload([[U(1), U(2)], [U(2), U(1)]])])
const beforeFailure = await rows('2099-W01')
const g6 = (await query("select public.begin_match_generation('2099-W01') as g"))[0].g
const badPayload = payload([[U(1), 'not-a-uuid'], [U(2), U(1)]])
check('a malformed payload raises', (await expectError('select public.publish_week_allocation($1,$2,$3::jsonb)', ['2099-W01', g6, badPayload], 'invalid input syntax')) === null)
const malformedVerdict = await sqlStateOf('select public.publish_week_allocation($1,$2,$3::jsonb)', ['2099-W01', g6, badPayload])
check('a genuine database error keeps its own SQLSTATE', malformedVerdict.code === '22P02', JSON.stringify(malformedVerdict))
check('a genuine database error is not reported as a conflict', malformedVerdict.code !== 'PT409')
check('the previous allocation survives a failed replacement', JSON.stringify(beforeFailure) === JSON.stringify(await rows('2099-W01')))
const stateAfterFailure = (await query('select latest_published_generation from public.match_week_generations where week_id = $1', ['2099-W01']))[0]
check('the published counter is unchanged after a failure', String(stateAfterFailure.latest_published_generation) === String(g5))

// 10. a superseded generation stays rejected even after the newer run failed
check(
  'a superseded generation stays rejected',
  (await expectError('select public.publish_week_allocation($1,$2,$3::jsonb)', ['2099-W01', g5, '[]'], 'stale_generation')) === null,
)
const g7 = (await query("select public.begin_match_generation('2099-W01') as g"))[0].g
await query('select public.publish_week_allocation($1,$2,$3::jsonb)', ['2099-W01', g7, payload([[U(1), U(3)], [U(3), U(1)]])])
check('a new generation can publish after the failed one', (await rows('2099-W01')).length === 2)

// 11. unknown week
check(
  'publishing an unbegun week raises unknown_generation',
  (await expectError('select public.publish_week_allocation($1,$2,$3::jsonb)', ['2099-W77', 1, '[]'], 'unknown_generation')) === null,
)
const unknownVerdict = await sqlStateOf('select public.publish_week_allocation($1,$2,$3::jsonb)', ['2099-W77', 1, '[]'])
check('unknown week keeps SQLSTATE P0002 (not PT409)', unknownVerdict.code === 'P0002', JSON.stringify(unknownVerdict))
const emptyWeekVerdict = await sqlStateOf('select public.publish_week_allocation($1,$2,$3::jsonb)', ['', 1, '[]'])
check('argument validation keeps SQLSTATE 22023 (not PT409)', emptyWeekVerdict.code === '22023', JSON.stringify(emptyWeekVerdict))

// 12. independence across weeks
const gW2 = (await query("select public.begin_match_generation('2099-W02') as g"))[0].g
const w2 = await query('select public.publish_week_allocation($1,$2,$3::jsonb) as r', ['2099-W02', gW2, payload([[U(1), U(2)], [U(2), U(1)]])])
check('a different week publishes independently', w2[0].r.published === 2 && (await rows('2099-W01')).length === 2)

// 13. privileges
const priv = async (role, fn) =>
  (await query(`select has_function_privilege($1, $2, 'EXECUTE') as ok`, [role, fn]))[0].ok
check('service_role may publish', await priv('service_role', 'public.publish_week_allocation(text,bigint,jsonb)'))
check('authenticated may not publish', !(await priv('authenticated', 'public.publish_week_allocation(text,bigint,jsonb)')))
check('anon may not publish', !(await priv('anon', 'public.publish_week_allocation(text,bigint,jsonb)')))
check('authenticated may not begin a run', !(await priv('authenticated', 'public.begin_match_generation(text)')))
const tablePriv = (await query("select has_table_privilege('authenticated','public.match_week_generations','SELECT') as ok"))[0].ok
check('authenticated cannot read the fence table', !tablePriv)
const serviceTablePriv = (await query("select has_table_privilege('service_role','public.match_week_generations','SELECT') as ok"))[0].ok
check('service_role can read the fence row back (transport-loss recovery)', serviceTablePriv)
const anonTablePriv = (await query("select has_table_privilege('anon','public.match_week_generations','SELECT') as ok"))[0].ok
check('anon cannot read the fence table', !anonTablePriv)
const seqPriv = (await query("select has_sequence_privilege('authenticated','public.match_generation_seq','USAGE') as ok"))[0].ok
check('authenticated cannot advance the generation sequence', !seqPriv)

await db.close()

console.log('')
if (failures.length) {
  console.log(`${checks - failures.length}/${checks} checks passed`)
  for (const failure of failures) console.log(`  FAILED: ${failure}`)
  process.exit(1)
}
console.log(`${checks}/${checks} checks passed`)
