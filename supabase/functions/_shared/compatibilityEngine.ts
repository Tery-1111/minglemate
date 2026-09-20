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
  dealbreakers: string[]
}

type Dimension = keyof CompatibilityScore['dimensions']

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

export function hasDealbreaker(userA: UserProfile, userB: UserProfile): {
  isDealbreaker: boolean
  reason: string | null
} {
  const relationshipAnswers = [userA.answers[31], userB.answers[31]]
  if (relationshipAnswers.includes('Serious relationship') && relationshipAnswers.includes('Curious')) {
    return {
      isDealbreaker: true,
      reason: 'Different relationship intentions: Serious relationship and Curious'
    }
  }

  const importanceAnswers = [userA.answers[36], userB.answers[36]]
  if (importanceAnswers.includes('Extremely important') && importanceAnswers.includes('Not important')) {
    return {
      isDealbreaker: true,
      reason: 'Incompatible importance preferences: Extremely important and Not important'
    }
  }

  return { isDealbreaker: false, reason: null }
}

export function calculateCompatibility(userA: UserProfile, userB: UserProfile): CompatibilityScore {
  const dealbreaker = hasDealbreaker(userA, userB)
  const dimensions = {
    communication: scoreDimension(userA, userB, dimensionQuestions.communication),
    conflict: scoreDimension(userA, userB, dimensionQuestions.conflict),
    emotional: scoreDimension(userA, userB, dimensionQuestions.emotional),
    expectations: scoreDimension(userA, userB, dimensionQuestions.expectations),
    values: scoreDimension(userA, userB, dimensionQuestions.values)
  }

  if (dealbreaker.isDealbreaker) {
    return {
      overall: 0,
      dimensions,
      dealbreakers: [dealbreaker.reason as string]
    }
  }

  const overall =
    dimensions.communication * 0.3 +
    dimensions.conflict * 0.25 +
    dimensions.emotional * 0.2 +
    dimensions.expectations * 0.15 +
    dimensions.values * 0.1

  return {
    overall,
    dimensions,
    dealbreakers: []
  }
}
