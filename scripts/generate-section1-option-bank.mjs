// Keeps the database option bank in sync with src/data/section1Questions.js.
//
//   node scripts/generate-section1-option-bank.mjs --check   # verify (npm run verify)
//   node scripts/generate-section1-option-bank.mjs --write   # rewrite the block
//
// The migration validates completed Section 1 submissions against
// public.section1_question_options: each of the 50 slots must hold the exact
// option text belonging to that question. The table is seeded from the block
// this script owns, so the bank exists in SQL without being hand-copied.
//
// --check exits 1 when the SQL block no longer matches the question file, which
// is the signal that a question/option change needs a migration.

import { readFileSync, writeFileSync } from 'node:fs'
import { section1Questions } from '../src/data/section1Questions.js'

const MIGRATION = new URL(
  '../supabase/sql/production/20261022180000_production_section1_responses.sql',
  import.meta.url
)
const BEGIN = '-- BEGIN GENERATED SECTION1 OPTION BANK'
const END = '-- END GENERATED SECTION1 OPTION BANK'

const quote = value => `'${String(value).replace(/'/g, "''")}'`

function block() {
  const rows = section1Questions.flatMap(question =>
    question.options.map(option => `  (${question.id}, ${quote(option)})`)
  )
  return [
    BEGIN,
    'insert into public.section1_question_options (question_number, option_text) values',
    `${rows.join(',\n')}`,
    'on conflict (question_number, option_text) do nothing;',
    END
  ].join('\n')
}

const source = readFileSync(MIGRATION, 'utf8').replace(/\r\n/g, '\n')
const start = source.indexOf(BEGIN)
const finish = source.indexOf(END)
if (start === -1 || finish === -1 || finish < start) {
  console.error(`Option-bank markers not found in ${MIGRATION.pathname}`)
  process.exit(1)
}

const current = source.slice(start, finish + END.length)
const expected = block()

if (process.argv.includes('--write')) {
  writeFileSync(MIGRATION, source.slice(0, start) + expected + source.slice(finish + END.length))
  console.log(`Option bank written: ${section1Questions.length} questions, ${section1Questions.reduce((n, q) => n + q.options.length, 0)} options`)
  process.exit(0)
}

if (current !== expected) {
  console.error('The SQL option bank does not match src/data/section1Questions.js.')
  console.error('Run: node scripts/generate-section1-option-bank.mjs --write')
  process.exit(1)
}

console.log(`Option bank matches the question file: ${section1Questions.length} questions, ${section1Questions.reduce((n, q) => n + q.options.length, 0)} options`)
