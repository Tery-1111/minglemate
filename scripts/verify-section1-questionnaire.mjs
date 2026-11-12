// Section 1 questionnaire and scoring — executed checks.
//
//   node scripts/verify-section1-questionnaire.mjs
//
// What this proves:
//   * the bank holds 50 questions, ids 1–50 in array order (the order is the
//     storage contract: user_responses.responses_array is positional), with
//     four distinct option strings each and 10 questions per dimension;
//   * the engine's dimension ranges cover questions 1–50 exactly once and
//     agree with the bank's category for every question;
//   * EVERY question changes the score, in its own dimension, by its
//     dimension's declared weight — 50/50 participate;
//   * changing an answer is recomputed from scratch (no cached score);
//   * the handling of an unanswered question is explicit (excluded from the
//     denominator, never counted as a match);
//   * Section 1 (`user_responses`) and Section 2 (`section2_responses`) do not
//     read or write each other;
//   * the Section 1 screen starts a retake at question 1, stores the pointer as
//     "questions answered", normalises a stored row onto 50 slots, and returns
//     a retake to Profile.
//
// What it does NOT prove: that the production table accepts these writes. The
// production column was integer[] and not text[] on 2026-10-22 — see
// supabase/sql/production/20261022180000_production_section1_responses.sql and
// docs/SECTION1_MATCHING_VERIFICATION.md. Static checks never prove a live
// schema.

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  calculateCompatibility,
  SECTION1_DIMENSION_WEIGHT_RATIOS
} from '../supabase/functions/_shared/compatibilityEngine.ts'
import { section1Questions } from '../src/data/section1Questions.js'
import { normalizeStoredAnswers } from '../src/lib/section1.js'

const ROOT = new URL('../', import.meta.url)
const read = relativePath => readFileSync(new URL(relativePath, ROOT), 'utf8')
let checks = 0
function ok(condition, message) {
  assert.ok(condition, message)
  checks += 1
}
function equal(actual, expected, message) {
  assert.equal(actual, expected, message)
  checks += 1
}
function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${message} (got ${actual}, expected ${expected})`)
  checks += 1
}

// ---------------------------------------------------------------------------
// 1. The bank
// ---------------------------------------------------------------------------
equal(section1Questions.length, 50, 'Section 1 must hold exactly 50 questions')

const DIMENSIONS = ['communication', 'conflict', 'emotional', 'expectations', 'values']
const CATEGORY_TO_DIMENSION = {
  Communication: 'communication',
  Conflict: 'conflict',
  Emotional: 'emotional',
  Expectations: 'expectations',
  Values: 'values'
}

for (let index = 0; index < section1Questions.length; index += 1) {
  const question = section1Questions[index]
  // Answers are stored at answers[index]; the engine reads answers[index + 1].
  // A bank reordered away from its ids would silently move every stored answer.
  equal(question.id, index + 1, `question at index ${index} must carry id ${index + 1}`)
  ok(typeof question.text === 'string' && question.text.trim().length > 0, `Q${question.id} must have text`)
  ok(DIMENSIONS.includes(CATEGORY_TO_DIMENSION[question.category]), `Q${question.id} has unknown category ${question.category}`)
  equal(question.options.length, 4, `Q${question.id} must have 4 options`)
  equal(
    new Set(question.options.map(option => option.trim().toLowerCase())).size,
    4,
    `Q${question.id} options must be distinct`
  )
  ok(question.options.every(option => String(option).trim().length > 0), `Q${question.id} options must be non-empty`)
}

equal(new Set(section1Questions.map(question => question.id)).size, 50, 'question ids must be unique')
equal(new Set(section1Questions.map(question => question.text.trim().toLowerCase())).size, 50, 'question text must be unique')

for (const dimension of DIMENSIONS) {
  const count = section1Questions.filter(question => CATEGORY_TO_DIMENSION[question.category] === dimension).length
  equal(count, 10, `${dimension} must own exactly 10 questions`)
}

// ---------------------------------------------------------------------------
// 2. The engine's ranges cover 1–50 once, matching the bank's dimension
// ---------------------------------------------------------------------------
const engineSource = read('supabase/functions/_shared/compatibilityEngine.ts').replace(/\r\n/g, '\n')
const offsets = {}
for (const match of engineSource.matchAll(
  /^ {2}(\w+): Array\.from\(\{ length: 10 \}, \(_, index\) => index \+ (\d+)\)/gm
)) {
  offsets[match[1]] = Number(match[2])
}
assert.deepEqual(Object.keys(offsets).sort(), [...DIMENSIONS].sort(), 'the engine must define exactly the five dimensions')
checks += 1

const engineQuestions = {}
for (const dimension of DIMENSIONS) {
  engineQuestions[dimension] = Array.from({ length: 10 }, (_, index) => offsets[dimension] + index)
}
const flatEngineQuestions = Object.values(engineQuestions).flat()
equal(flatEngineQuestions.length, 50, 'the engine ranges must total 50 questions')
equal(new Set(flatEngineQuestions).size, 50, 'no question may be scored twice')
assert.deepEqual([...flatEngineQuestions].sort((a, b) => a - b), Array.from({ length: 50 }, (_, i) => i + 1), 'the engine must score 1–50')
checks += 1

for (const question of section1Questions) {
  const dimension = CATEGORY_TO_DIMENSION[question.category]
  ok(
    engineQuestions[dimension].includes(question.id),
    `Q${question.id} is filed as ${question.category} but the engine scores it under another dimension`
  )
}

// The declared weights are the code's contract. Whether `expectations` is the
// PRD's "space ×2" is an open product decision (see the report); this test
// pins what the code does today so a change cannot be silent.
assert.deepEqual(SECTION1_DIMENSION_WEIGHT_RATIOS, {
  communication: 3,
  conflict: 3,
  emotional: 2,
  expectations: 2,
  values: 1
}, 'the engine weights must stay at the reviewed 3:3:2:2:1 ratios until the PRD ambiguity is decided')
checks += 1

// ---------------------------------------------------------------------------
// 3. All 50 questions participate, each in its own dimension and weight
// ---------------------------------------------------------------------------
const answersChoosing = optionIndex => {
  const answers = {}
  for (const question of section1Questions) answers[question.id] = question.options[optionIndex]
  return answers
}
const baseline = answersChoosing(0)

const identical = calculateCompatibility({ id: 'a', answers: baseline }, { id: 'b', answers: baseline })
for (const dimension of DIMENSIONS) equal(identical.dimensions[dimension], 100, `${dimension} must be 100 when identical`)
close(identical.overall, 100, 'identical answers must score 100')

let participationChecks = 0
for (const question of section1Questions) {
  const dimension = CATEGORY_TO_DIMENSION[question.category]
  const changed = { ...baseline, [question.id]: question.options[1] }
  const result = calculateCompatibility({ id: 'a', answers: baseline }, { id: 'b', answers: changed })

  for (const other of DIMENSIONS) {
    const expected = other === dimension ? 90 : 100
    equal(result.dimensions[other], expected, `changing Q${question.id} must move only ${dimension}`)
  }
  const weight = SECTION1_DIMENSION_WEIGHT_RATIOS[dimension]
  close(result.overall, 100 - 10 * (weight / 11), `Q${question.id} must contribute its ${dimension} weight`)
  participationChecks += 1
}
equal(participationChecks, 50, 'every one of the 50 questions must be exercised')

const allDifferent = calculateCompatibility(
  { id: 'a', answers: baseline },
  { id: 'b', answers: answersChoosing(1) }
)
for (const dimension of DIMENSIONS) equal(allDifferent.dimensions[dimension], 0, `${dimension} must be 0 on total disagreement`)
close(allDifferent.overall, 0, 'total disagreement must score 0')

// ---------------------------------------------------------------------------
// 4. A changed answer is recomputed, and an unanswered one is not a match
// ---------------------------------------------------------------------------
const changedQ1 = calculateCompatibility(
  { id: 'a', answers: baseline },
  { id: 'b', answers: { ...baseline, 1: section1Questions[0].options[2] } }
)
close(changedQ1.overall, 100 - 10 * (3 / 11), 'a different Q1 answer must lower the overall score')

const missingQ1 = { ...baseline }
delete missingQ1[1]
const unansweredQ1 = calculateCompatibility({ id: 'a', answers: baseline }, { id: 'b', answers: missingQ1 })
// scoreDimension only divides by the questions BOTH users answered, so an
// unanswered question is excluded rather than counted as a mismatch.
equal(unansweredQ1.dimensions.communication, 100, 'an unanswered question must be excluded, not counted as a mismatch')
close(unansweredQ1.overall, 100, 'the engine scores the answered subset')
equal(
  calculateCompatibility({ id: 'a', answers: {} }, { id: 'b', answers: baseline }).overall,
  0,
  'a profile with no answers must score 0, never a fabricated value'
)

// ---------------------------------------------------------------------------
// 5. Section 1 and Section 2 stay separate
// ---------------------------------------------------------------------------
const section1Screen = read('src/pages/Section1.jsx').replace(/\r\n/g, '\n')
const section2Screen = read('src/pages/Section2.jsx').replace(/\r\n/g, '\n')
const matchGenerator = read('supabase/functions/match-generator/index.ts').replace(/\r\n/g, '\n')

for (const source of [engineSource, matchGenerator]) {
  ok(!/section2/i.test(source), 'the compatibility engine and generator must not read Section 2')
}
ok(!/user_responses/.test(section2Screen), 'Section 2 must not read or write the Section 1 answer table')
ok(/section2_responses/.test(section2Screen), 'Section 2 must persist to section2_responses')
ok(/user_responses/.test(section1Screen), 'Section 1 must persist to user_responses')
ok(!/section2_responses|section2_unlocked|section2_free_expires_at/.test(section1Screen), 'Section 1 must not touch Section 2 state')
ok(!/compatibility|score/i.test(section1Screen.replace(/progressbar|aria-valuenow/g, '')), 'the Section 1 screen must not compute or send a score')

// ---------------------------------------------------------------------------
// 6. Returning users: retake, pointer, positional storage
// ---------------------------------------------------------------------------
ok(/const resumeAt = isRetake\s*\n?\s*\?\s*0\s*\n?\s*:/.test(section1Screen), 'a retake must start at question 1')
ok(/section1_progress: isSurveyFinished \? CAMPUS_QUESTIONS\.length : nextStepIndex/.test(section1Screen),
  'the completion pointer must be the number of questions answered (50)')
ok(/normalizeStoredAnswers\(responseRow\?\.responses_array, CAMPUS_QUESTIONS\)/.test(section1Screen),
  'the screen must normalise the stored row through the option-aware helper')

// Executed: the stored-row projection drops anything that is not that
// question's own option text (legacy integers, shifted values, blanks).
const legacyStored = [...Array(40)].map((_, index) => String(index % 2))
const normalizedLegacy = normalizeStoredAnswers(legacyStored, section1Questions)
equal(normalizedLegacy.length, 50, 'a short stored row is padded to 50 slots')
ok(normalizedLegacy.every(value => value === null),
  'legacy integer values (now text) must project to unanswered')

const shiftedStored = new Array(50).fill(null)
shiftedStored[0] = section1Questions[1].options[0]
equal(normalizeStoredAnswers(shiftedStored, section1Questions)[0], null,
  'an option that belongs to another question must not be accepted')

const realStored = new Array(50).fill(null)
realStored[7] = section1Questions[7].options[2]
equal(normalizeStoredAnswers(realStored, section1Questions)[7], section1Questions[7].options[2],
  'a real stored option must survive at its own position')
equal(normalizeStoredAnswers(undefined, section1Questions).length, 50,
  'a missing row projects to 50 unanswered slots')
equal(normalizeStoredAnswers(new Array(60).fill('x'), section1Questions).length, 50,
  'an over-long row is truncated to 50 slots')
ok(/navigate\(isRetake \? '\/profile' : '\/section2'\)/.test(section1Screen),
  'a completed retake must return to Profile, not re-enter Section 2 onboarding')
ok(/section1_complete: isSurveyFinished \|\| \(isRetake && wasComplete\)/.test(section1Screen),
  'editing one answer on a completed profile must not drop it out of the match pool')
ok(/setWasComplete\(Boolean\(profile\?\.section1_complete\)\)/.test(section1Screen),
  'the screen must remember whether the row was already complete')
ok(/if \(profile\?\.section1_complete && !isRetake\)/.test(section1Screen),
  'a completed returning user must skip the questionnaire unless retaking')
ok(/\.eq\('user_id', user\.id\)/.test(section1Screen) && /user_id: userId/.test(section1Screen),
  'Section 1 must only write the signed-in user\'s answers')

const profileScreen = read('src/pages/Profile.jsx').replace(/\r\n/g, '\n')
ok(/navigate\('\/section1\?retake=1'\)/.test(profileScreen), 'Profile must offer a retake link')
ok(/interests\?edit=1/.test(profileScreen), 'Profile must offer an interests edit link')

const interestsScreen = read('src/pages/Interests.jsx').replace(/\r\n/g, '\n')
ok(/if \(isEdit\) \{[\s\S]{0,200}navigate\('\/profile'\)/.test(interestsScreen),
  'editing interests must return to Profile without entering Section 1')
ok(/\.update\(\{ interests: selected \}\)/.test(interestsScreen), 'editing interests must only write interests')

// A returning user lands on Home, which branches on the stored completion flag;
// only an incomplete profile is offered the questionnaire.
const loginScreen = read('src/pages/Login.jsx').replace(/\r\n/g, '\n')
const homeScreen = read('src/pages/Home.jsx').replace(/\r\n/g, '\n')
ok(/navigate\('\/home'\)/.test(loginScreen), 'sign-in must land on Home, not on the questionnaire')
ok(/section1_complete/.test(homeScreen), 'Home must read the stored completion flag')

// Profile editing writes the profile row only; answers are never deleted.
ok(/\.delete\(\)/.test(profileScreen) === false, 'Profile must not delete rows')
ok(!/user_responses/.test(profileScreen), 'Profile must not touch Section 1 answers')

// ---------------------------------------------------------------------------
// 7. Data-access source: answers are owner-only, and the fix exists for the
//    production drift (it is NOT applied by this script)
// ---------------------------------------------------------------------------
const migration = read('supabase/migrations/20261014150000_consolidated_schema_chain.sql')
for (const policy of ['responses_select_own', 'responses_insert_own', 'responses_update_own']) {
  ok(migration.includes(policy), `the schema chain must declare ${policy}`)
}
ok(/using \(user_id = auth\.uid\(\)\)/.test(migration), 'answer reads must be scoped to auth.uid()')

const productionFix = 'supabase/sql/production/20261022180000_production_section1_responses.sql'
ok(existsSync(new URL(productionFix, ROOT)), `the production compatibility fix must exist at ${productionFix}`)
const productionSql = read(productionFix).replace(/\r\n/g, '\n')
ok(/alter column responses_array type text\[\]/.test(productionSql), 'the fix must convert responses_array to text[]')
ok(/for policy_row in[\s\S]{0,200}from pg_policy p[\s\S]{0,200}drop policy if exists/.test(productionSql),
  'the fix must drop every existing policy by catalog, including the cross-user read policy')
ok(/pg_get_expr\(p\.polqual, p\.polrelid\) ilike '%auth\.role\(\)%'/.test(productionSql),
  'the fix must post-check that no role-wide read policy survives')
ok(/create policy responses_select_own/.test(productionSql), 'the fix must install the owner-only read policy')

console.log(`Section 1 questionnaire checks passed: ${checks} assertions, 50/50 questions scored, retake/pointer/positional storage verified`)
