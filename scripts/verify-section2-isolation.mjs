// PRD section 5: "Section 2 contains 20 guided/display questions and must not
// accidentally alter the core compatibility engine unless explicitly designed
// to do so."
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

// The whole weekly matching run: the generator and the two shared modules it
// imports. Nothing else executes inside it.
const MATCHING_FILES = [
  'supabase/functions/match-generator/index.ts',
  'supabase/functions/_shared/compatibilityEngine.ts',
  'supabase/functions/_shared/matchingEligibility.ts'
]

// Section 2 identifiers found in the repository (questionnaire answers,
// entitlement flags, guided-question progress and engagement tracking).
// "qrashe" is deliberately absent: it is a match type created by Force Connect
// payment, not Section 2 data.
const SECTION2_IDENTIFIERS = [
  'section2',
  'section_2',
  'section 2',
  'sec2',
  'section2_unlocked',
  'section2_free_expires_at',
  'section2_responses',
  'section2_chat_progress',
  'engagement_metrics'
]

const repoRoot = new URL('../', import.meta.url)

for (const file of MATCHING_FILES) {
  // A deleted or renamed file must fail rather than pass by being absent.
  assert.ok(existsSync(new URL(file, repoRoot)), `${file} must exist`)

  const source = readFileSync(new URL(file, repoRoot), 'utf8').toLowerCase()
  for (const identifier of SECTION2_IDENTIFIERS) {
    assert.equal(
      source.includes(identifier),
      false,
      `${file} must not contain the Section 2 identifier "${identifier}"`
    )
  }
}

console.log(
  `Section 2 isolation checks passed: ${MATCHING_FILES.length} matching files, ${SECTION2_IDENTIFIERS.length} Section 2 identifiers absent`
)
