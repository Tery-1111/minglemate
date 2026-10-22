// Static regression checks for the weekly-matching pipeline correction.
//
//   node scripts/verify-weekly-generation-safety.mjs
//
// Confirms, as text (no database, no dependencies — same spirit as
// scripts/check-schema-chain.mjs):
//
//   1. No migration under supabase/migrations/ contains an executable
//      TRUNCATE. The legacy weekly engine's TRUNCATE of public.matches
//      aborted on the payments FK (0A000) and, on a database without
//      that FK, would wipe every paid Qrashe pair.
//   2. The retirement migration for generate_tuesday_matches() performs
//      no DML at all (no INSERT / UPDATE / DELETE / TRUNCATE against any
//      table, matches and payments included), keeps the legacy cron
//      failing visibly (raise exception), and re-revokes EXECUTE from
//      public / anon / authenticated so recreating the function cannot
//      re-open the chain's grant hole.
//   3. The legacy edge engines stay retired in the repository: no
//      generate-weekly-matches/ or run-weekly-matching/ directory under
//      supabase/functions/ (both are deployed only on the server and
//      both write weekly results without campus eligibility).
//   4. The intended weekly engine stays campus-aware: match-generator
//      imports the shared eligibility helper and calls it before
//      pairing.
//
// Behaviour on a live database (does the cron job actually fail loudly,
// does pg_cron run as the owner) is verified by supabase/sql/
// inspect_state.sql section 08 CRON against the live project — not here.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// Strip block comments, line comments, then single-quoted string literals
// (with '' escapes) so keyword scans cannot trip over prose in comments or
// in raise-exception messages.
function executableSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '')
    .replace(/'(?:[^']|'')*'/g, "''")
}

// --- 1. No executable TRUNCATE in any migration ---------------------------
const migrationsDir = join(root, 'supabase', 'migrations')
const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
assert.ok(migrationFiles.length > 0, 'no migration files found')

let truncateCount = 0
for (const file of migrationFiles) {
  const sql = executableSql(read(join('supabase', 'migrations', file)))
  assert.ok(
    !/\btruncate\b/i.test(sql),
    `${file} contains an executable TRUNCATE — weekly generation must never clear tables`
  )
  truncateCount++
}

// --- 2. The retirement migration is DML-free and keeps its guardrails -----
const RETIREMENT = 'supabase/migrations/20261019190000_retire_generate_tuesday_matches.sql'
const retirementRaw = read(RETIREMENT)
const retirementSql = executableSql(retirementRaw)

assert.ok(
  !/\btruncate\b/i.test(retirementSql),
  'retirement migration contains TRUNCATE'
)
assert.ok(
  !/\binsert\s+into\b/i.test(retirementSql),
  'retirement migration contains INSERT — it must touch no data'
)
assert.ok(
  !/\bdelete\s+from\b/i.test(retirementSql),
  'retirement migration contains DELETE — it must touch no data'
)
assert.ok(
  !/\bupdate\b/i.test(retirementSql),
  'retirement migration contains UPDATE — it must touch no data'
)

// Presence checks run against the raw text: the statements must exist
// verbatim (the header comments deliberately describe them too, which is
// harmless for presence).
assert.ok(
  /drop function if exists public\.generate_tuesday_matches\(\);/i.test(retirementRaw),
  'retirement migration does not drop the legacy function defensively'
)
assert.ok(
  /create function public\.generate_tuesday_matches\(\)/i.test(retirementRaw),
  'retirement migration does not recreate generate_tuesday_matches()'
)
assert.ok(
  /raise exception/i.test(retirementSql),
  'retirement migration must raise a visible exception so the legacy cron fails loudly, not silently'
)
assert.ok(
  /revoke all on function public\.generate_tuesday_matches\(\) from public;/i.test(retirementRaw),
  'retirement migration must re-revoke EXECUTE from public (PostgreSQL grants it by default)'
)
assert.ok(
  /revoke all on function public\.generate_tuesday_matches\(\) from anon/i.test(retirementRaw),
  'retirement migration must re-revoke EXECUTE from anon'
)
assert.ok(
  /revoke all on function public\.generate_tuesday_matches\(\) from authenticated/i.test(retirementRaw),
  'retirement migration must re-revoke EXECUTE from authenticated'
)

// Naming convention: timestamped, and sorted after the consolidated chain
// so the normal migration flow applies the chain first.
const retirementName = RETIREMENT.split('/').pop()
assert.match(retirementName, /^\d{14}_[a-z0-9_]+\.sql$/, 'retirement migration name breaks the timestamp convention')
assert.ok(
  retirementName > '20261014150000_consolidated_schema_chain.sql',
  'retirement migration must sort after the consolidated chain'
)

// --- 3. Legacy edge engines stay absent from the repository ---------------
for (const legacy of ['generate-weekly-matches', 'run-weekly-matching']) {
  let present = false
  try {
    readdirSync(join(root, 'supabase', 'functions', legacy))
    present = true
  } catch {
    present = false
  }
  assert.ok(
    !present,
    `supabase/functions/${legacy}/ exists — the legacy engine must not return to the repository; the intended weekly engine is match-generator`
  )
}

// --- 4. The intended engine stays campus-aware ---------------------------
const matcher = read('supabase/functions/match-generator/index.ts')
assert.ok(
  matcher.includes("from '../_shared/matchingEligibility.ts'"),
  'match-generator no longer imports the shared campus eligibility helper'
)
assert.ok(
  /areEligibleCandidates\(/.test(matcher),
  'match-generator no longer calls areEligibleCandidates before pairing'
)
assert.ok(
  /\.select\('id, gender, campus_id'\)/.test(matcher),
  'match-generator no longer selects campus_id for eligibility'
)

console.log(
  `${truncateCount} migration file(s) checked TRUNCATE-free; retirement migration is DML-free with a visible-failure guard and re-revoked grants; legacy edge engines absent; match-generator campus-aware — all weekly-generation safety checks passed`
)
