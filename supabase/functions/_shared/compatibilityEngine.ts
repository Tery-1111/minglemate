export interface UserProfile {
  id: string
  answers: Record<number, string>
}

export interface CompatibilityScore {
  overall: number
  dimensions: {
    communication: number
    conflict: number
    emotional: number
    expectations: number
    values: number
  }
}

type Dimension = keyof CompatibilityScore['dimensions']

// ---------------------------------------------------------------------------
// Section 1 dimension weights
//
// MingleMate_Master_Product_Specification §5 lists the five dimensions in this
// order — communication, conflict, emotional maturity, relationship
// expectations, values/lifestyle — and weights them 3:3:2:2:1. The integers
// below are the definition and the only place the weights live; the decimal a
// dimension contributes to the overall score is derived by dividing its
// integer by their total, so no fraction is rounded in code.
// ---------------------------------------------------------------------------
export const SECTION1_DIMENSION_WEIGHT_RATIOS: Record<Dimension, number> = {
  communication: 3,
  conflict: 3,
  emotional: 2,
  expectations: 2,
  values: 1
}

export const SECTION1_WEIGHT_TOTAL: number = Object.values(SECTION1_DIMENSION_WEIGHT_RATIOS)
  .reduce((sum, ratio) => sum + ratio, 0)

function fractionOfWeightTotal(ratio: number): number {
  return ratio / SECTION1_WEIGHT_TOTAL
}

export const SECTION1_DIMENSION_WEIGHTS: Record<Dimension, number> = {
  communication: fractionOfWeightTotal(SECTION1_DIMENSION_WEIGHT_RATIOS.communication),
  conflict: fractionOfWeightTotal(SECTION1_DIMENSION_WEIGHT_RATIOS.conflict),
  emotional: fractionOfWeightTotal(SECTION1_DIMENSION_WEIGHT_RATIOS.emotional),
  expectations: fractionOfWeightTotal(SECTION1_DIMENSION_WEIGHT_RATIOS.expectations),
  values: fractionOfWeightTotal(SECTION1_DIMENSION_WEIGHT_RATIOS.values)
}

const dimensionQuestions: Record<Dimension, number[]> = {
  communication: Array.from({ length: 10 }, (_, index) => index + 1),
  conflict: Array.from({ length: 10 }, (_, index) => index + 11),
  emotional: Array.from({ length: 10 }, (_, index) => index + 21),
  expectations: Array.from({ length: 10 }, (_, index) => index + 31),
  values: Array.from({ length: 10 }, (_, index) => index + 41)
}

function answersAreSimilar(answerA: string | undefined, answerB: string | undefined): boolean {
  if (!answerA || !answerB) return false

  // Every stored answer is the exact option text the user chose from a
  // question's fixed option list (Section1.jsx writes option strings,
  // user_responses.responses_array holds them positionally). Two users
  // are compatible on a question ONLY when they chose the same option.
  // The previous word-overlap heuristic made distinct options score as
  // matches (verified: "My kindness"≈"My courage", "Phone calls"≈
  // "Video calls", "Very important"≈"Less important than experiences"
  // — 16 of 300 distinct option pairs across 11 questions), inflating
  // compatibility for dissimilar users. Legacy rows from the old
  // integer[] era hold numeric indices as text; they never equal option
  // text and correctly count as non-matches under exact comparison.
  return answerA.trim().toLowerCase() === answerB.trim().toLowerCase()
}

function scoreDimension(userA: UserProfile, userB: UserProfile, questions: number[]): number {
  const answeredQuestions = questions.filter(question => userA.answers[question] && userB.answers[question])
  if (answeredQuestions.length === 0) return 0

  const matchingAnswers = answeredQuestions.filter(question =>
    answersAreSimilar(userA.answers[question], userB.answers[question])
  ).length

  return (matchingAnswers / answeredQuestions.length) * 100
}

export function calculateCompatibility(userA: UserProfile, userB: UserProfile): CompatibilityScore {
  const dimensions = {
    communication: scoreDimension(userA, userB, dimensionQuestions.communication),
    conflict: scoreDimension(userA, userB, dimensionQuestions.conflict),
    emotional: scoreDimension(userA, userB, dimensionQuestions.emotional),
    expectations: scoreDimension(userA, userB, dimensionQuestions.expectations),
    values: scoreDimension(userA, userB, dimensionQuestions.values)
  }

  const overall =
    dimensions.communication * SECTION1_DIMENSION_WEIGHTS.communication +
    dimensions.conflict * SECTION1_DIMENSION_WEIGHTS.conflict +
    dimensions.emotional * SECTION1_DIMENSION_WEIGHTS.emotional +
    dimensions.expectations * SECTION1_DIMENSION_WEIGHTS.expectations +
    dimensions.values * SECTION1_DIMENSION_WEIGHTS.values

  return {
    overall,
    dimensions
  }
}
