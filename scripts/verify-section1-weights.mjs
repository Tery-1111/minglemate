import assert from 'node:assert/strict'
import {
  calculateCompatibility,
  SECTION1_DIMENSION_WEIGHT_RATIOS,
  SECTION1_DIMENSION_WEIGHTS,
  SECTION1_WEIGHT_TOTAL
} from '../supabase/functions/_shared/compatibilityEngine.ts'

// MingleMate_Master_Product_Specification §5 lists the five dimensions in this
// order and weights them 3:3:2:2:1.
const EXPECTED_RATIOS = {
  communication: 3,
  conflict: 3,
  emotional: 2,
  expectations: 2,
  values: 1
}
const HIGHEST_WEIGHT_DIMENSIONS = ['communication', 'conflict']

// a. each dimension carries its exact integer weight
assert.deepEqual(
  Object.keys(SECTION1_DIMENSION_WEIGHT_RATIOS),
  Object.keys(EXPECTED_RATIOS),
  'the five dimensions must be stored in the PRD order'
)
for (const [dimension, ratio] of Object.entries(EXPECTED_RATIOS)) {
  assert.equal(
    SECTION1_DIMENSION_WEIGHT_RATIOS[dimension],
    ratio,
    `${dimension} must weigh exactly ${ratio}`
  )
}

// b. the integers sum to 11
const integerSum = Object.values(SECTION1_DIMENSION_WEIGHT_RATIOS)
  .reduce((sum, ratio) => sum + ratio, 0)
assert.equal(integerSum, 11, 'the integer weights must sum to 11')
assert.equal(SECTION1_WEIGHT_TOTAL, 11, 'the exported total must be 11')

// c. the two highest-weight dimensions are equal
const highest = Math.max(...Object.values(SECTION1_DIMENSION_WEIGHT_RATIOS))
const atHighest = Object.entries(SECTION1_DIMENSION_WEIGHT_RATIOS)
  .filter(([, ratio]) => ratio === highest)
  .map(([dimension]) => dimension)
assert.equal(highest, 3, 'the highest weight must be 3')
assert.deepEqual(
  atHighest.sort(),
  HIGHEST_WEIGHT_DIMENSIONS,
  'communication and conflict must be the equal highest pair'
)

// the decimal each dimension contributes is its integer over the sum, never a literal
for (const [dimension, ratio] of Object.entries(EXPECTED_RATIOS)) {
  assert.ok(
    Math.abs(SECTION1_DIMENSION_WEIGHTS[dimension] - ratio / 11) < 1e-12,
    `${dimension} must contribute ${ratio}/11`
  )
}

// fixed inputs: two users who agree on every question, and two who agree only
// on questions 41–50 (the `values` dimension)
const SAME = 'My kindness'
const OTHER = 'My courage'

const answersFor = rule => {
  const answers = {}
  for (let question = 1; question <= 50; question++) answers[question] = rule(question)
  return answers
}
const alwaysSame = answersFor(() => SAME)
const sameOnValuesOnly = answersFor(question => (question >= 41 ? SAME : OTHER))

// d. all five dimensions at full marks scores 1.0
// Dimension scores are percentages (0–100), so full marks are 100 and the
// overall score is read on that same scale.
const allFull = calculateCompatibility(
  { id: 'full-a', answers: alwaysSame },
  { id: 'full-b', answers: alwaysSame }
)
for (const dimension of Object.keys(EXPECTED_RATIOS)) {
  assert.equal(allFull.dimensions[dimension], 100, `${dimension} at full marks must be 100`)
}
assert.ok(
  Math.abs(allFull.overall - 100) < 1e-9,
  `full marks on all five dimensions must score 1.0 (100), got ${allFull.overall}`
)

// e. only the weight-1 dimension at full marks scores 1/11
const valuesOnly = calculateCompatibility(
  { id: 'values-a', answers: alwaysSame },
  { id: 'values-b', answers: sameOnValuesOnly }
)
assert.equal(valuesOnly.dimensions.values, 100, 'values must be at full marks')
for (const dimension of ['communication', 'conflict', 'emotional', 'expectations']) {
  assert.equal(valuesOnly.dimensions[dimension], 0, `${dimension} must be at zero`)
}
assert.ok(
  Math.abs(valuesOnly.overall / 100 - 1 / 11) < 1e-9,
  `only the weight-1 dimension at full marks must score 1/11, got ${valuesOnly.overall / 100}`
)
assert.ok(
  Math.abs(valuesOnly.overall - (1 / 11) * 100) < 1e-9,
  `that same result on the engine's 0–100 scale is 100/11, got ${valuesOnly.overall}`
)

console.log('Section 1 weight checks passed: 3:3:2:2:1, only-values scores 1/11')
