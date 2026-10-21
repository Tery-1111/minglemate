// OWNER-APPROVED mapping (Will, 2026-10-21), not derived from the PRD.
// Guards against silent drift.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculateCompatibility } from '../supabase/functions/_shared/compatibilityEngine.ts'
import { section1Questions } from '../src/data/section1Questions.js'

// The owner-approved table, written out as literals on purpose: the test must
// never read its expectations from the code it is checking.
const OWNER_APPROVED_MAPPING = {
  communication: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  conflict: [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  emotional: [21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  expectations: [31, 32, 33, 34, 35, 36, 37, 38, 39, 40],
  values: [41, 42, 43, 44, 45, 46, 47, 48, 49, 50]
}

const dimensions = Object.keys(OWNER_APPROVED_MAPPING)
const tableEntries = dimensions.flatMap(dimension =>
  OWNER_APPROVED_MAPPING[dimension].map(id => [id, dimension])
)

// a. exactly 50 questions, ids 1 to 50, no gaps or duplicates
assert.equal(section1Questions.length, 50, 'Section 1 must hold exactly 50 questions')
const ids = section1Questions.map(question => question.id)
assert.deepEqual(
  [...ids].sort((a, b) => a - b),
  Array.from({ length: 50 }, (_, index) => index + 1),
  'question ids must be 1 to 50 with no gaps'
)
assert.equal(new Set(ids).size, 50, 'question ids must have no duplicates')

// b. every question has exactly 4 options
for (const question of section1Questions) {
  assert.equal(question.options.length, 4, `Q${question.id} must have exactly 4 options`)
}

// c. each dimension owns exactly 10 questions in the owner-approved table
assert.deepEqual(
  [...dimensions].sort(),
  ['communication', 'conflict', 'emotional', 'expectations', 'values'],
  'the table must hold the five dimensions'
)
for (const dimension of dimensions) {
  assert.equal(
    OWNER_APPROVED_MAPPING[dimension].length,
    10,
    `${dimension} must own exactly 10 questions`
  )
}
assert.equal(tableEntries.length, 50, 'the table must cover 50 questions')
assert.equal(new Set(tableEntries.map(([id]) => id)).size, 50, 'the table must not repeat a question')

// d. the bank's category for every question equals the table, case-insensitively
for (const [id, dimension] of tableEntries) {
  const question = section1Questions.find(candidate => candidate.id === id)
  assert.ok(question, `Q${id} must exist in the question bank`)
  assert.equal(
    question.category.toLowerCase(),
    dimension,
    `Q${id} is filed as ${question.category} but the approved dimension is ${dimension}`
  )
}

// e. the engine's per-dimension question ranges equal the table exactly
//    (dimensionQuestions is not exported, so the range constants are read from
//    the engine source; the engine itself is not modified)
const engineSource = readFileSync(
  new URL('../supabase/functions/_shared/compatibilityEngine.ts', import.meta.url),
  'utf8'
)
const engineOffsets = {}
for (const match of engineSource.matchAll(
  /^ {2}(\w+): Array\.from\(\{ length: 10 \}, \(_, index\) => index \+ (\d+)\)/gm
)) {
  engineOffsets[match[1]] = Number(match[2])
}
assert.deepEqual(
  Object.keys(engineOffsets).sort(),
  [...dimensions].sort(),
  'the engine must define exactly the five dimensions'
)
for (const dimension of dimensions) {
  const offset = engineOffsets[dimension]
  assert.equal(
    typeof offset,
    'number',
    `${dimension} range must be readable from compatibilityEngine.ts`
  )
  const engineIds = Array.from({ length: 10 }, (_, index) => offset + index)
  assert.deepEqual(
    engineIds,
    OWNER_APPROVED_MAPPING[dimension],
    `${dimension}: the engine range must equal the approved question set`
  )
}

// fixed answer sets, built from each question's own option text
const answersChoosing = optionIndex => {
  const answers = {}
  for (const question of section1Questions) answers[question.id] = question.options[optionIndex]
  return answers
}
const option1Answers = answersChoosing(0)
const option2Answers = answersChoosing(1)

// f. identical answers on every question give every dimension 100
const identical = calculateCompatibility(
  { id: 'mapping-a', answers: option1Answers },
  { id: 'mapping-b', answers: option1Answers }
)
for (const dimension of dimensions) {
  assert.equal(
    typeof identical.dimensions[dimension],
    'number',
    `${dimension} score must be defined`
  )
  assert.equal(
    identical.dimensions[dimension],
    100,
    `${dimension} must score 100 when both users answer identically`
  )
}

// g. option 1 against option 2 on every question gives every dimension 0
const different = calculateCompatibility(
  { id: 'mapping-a', answers: option1Answers },
  { id: 'mapping-b', answers: option2Answers }
)
for (const dimension of dimensions) {
  assert.equal(
    different.dimensions[dimension],
    0,
    `${dimension} must score 0 when the users answer differently on every question`
  )
}

console.log(
  'Section 1 question-mapping checks passed: 50 questions, 5 dimensions x 10, engine ranges match, 100/0 scoring'
)
