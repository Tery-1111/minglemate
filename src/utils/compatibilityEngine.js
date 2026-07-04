// src/utils/compatibilityEngine.js
// src/utils/compatibilityEngine.js

// Add 'export' to all your functions
export function hasDealbreaker(userA, userB) { /* ... */ }
export function calculateCommunicationScore(userA, userB) { /* ... */ }
export function calculateConflictScore(userA, userB) { /* ... */ }
export function calculateEmotionalScore(userA, userB) { /* ... */ }
export function calculateExpectationsScore(userA, userB) { /* ... */ }
export function calculateValuesScore(userA, userB) { /* ... */ }
export function calculateComplementaryBonus(userA, userB) { /* ... */ }

// Export variables as well
export { questionWeights };
// Add 'export' before these function signatures in
// ============================================
// WEIGHT CONFIGURATION
// ============================================
const questionWeights = {
  1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 10: 3,
  11: 3, 12: 3, 13: 3, 14: 3, 15: 3, 16: 3, 17: 3, 18: 3, 19: 3, 20: 3,
  21: 2, 22: 2, 23: 2, 24: 2, 25: 2, 26: 2, 27: 2, 28: 2, 29: 2, 30: 2,
  31: 3, 32: 3, 33: 2, 34: 3, 35: 2, 36: 3, 37: 2, 38: 3, 39: 3, 40: 2,
  41: 1, 42: 1, 43: 1, 44: 1, 45: 1, 46: 1, 47: 1, 48: 1, 49: 1, 50: 1
};

// ============================================
// COMPATIBILITY MATRICES
// ============================================
const communicationTimingMatrix = {
  'Talk about it immediately': { 'Talk about it immediately': 100, 'Think first, then talk': 85, 'Keep it to yourself': 30, 'Avoid discussing it': 20 },
  'Think first, then talk': { 'Talk about it immediately': 85, 'Think first, then talk': 100, 'Keep it to yourself': 50, 'Avoid discussing it': 35 },
  'Keep it to yourself': { 'Talk about it immediately': 30, 'Think first, then talk': 50, 'Keep it to yourself': 70, 'Avoid discussing it': 60 },
  'Avoid discussing it': { 'Talk about it immediately': 20, 'Think first, then talk': 35, 'Keep it to yourself': 60, 'Avoid discussing it': 80 }
};

const frequencyMatrix = {
  'Throughout the day': { 'Throughout the day': 100, 'Once or twice daily': 80, 'Every few days': 40, 'Only when necessary': 20 },
  'Once or twice daily': { 'Throughout the day': 80, 'Once or twice daily': 100, 'Every few days': 70, 'Only when necessary': 40 },
  'Every few days': { 'Throughout the day': 40, 'Once or twice daily': 70, 'Every few days': 100, 'Only when necessary': 75 },
  'Only when necessary': { 'Throughout the day': 20, 'Once or twice daily': 40, 'Every few days': 75, 'Only when necessary': 100 }
};

const styleMatrix = {
  'Very direct': { 'Very direct': 100, 'Mostly direct': 85, 'Balanced': 60, 'Very gentle': 40 },
  'Mostly direct': { 'Very direct': 85, 'Mostly direct': 100, 'Balanced': 80, 'Very gentle': 60 },
  'Balanced': { 'Very direct': 60, 'Mostly direct': 80, 'Balanced': 100, 'Very gentle': 85 },
  'Very gentle': { 'Very direct': 40, 'Mostly direct': 60, 'Balanced': 85, 'Very gentle': 100 }
};

const conflictApproachMatrix = {
  'Address it immediately': { 'Address it immediately': 100, 'Take some time first': 85, 'Avoid it': 25, 'Depends on the situation': 70 },
  'Take some time first': { 'Address it immediately': 85, 'Take some time first': 100, 'Avoid it': 45, 'Depends on the situation': 80 },
  'Avoid it': { 'Address it immediately': 25, 'Take some time first': 45, 'Avoid it': 65, 'Depends on the situation': 50 },
  'Depends on the situation': { 'Address it immediately': 70, 'Take some time first': 80, 'Avoid it': 50, 'Depends on the situation': 100 }
};

const resolutionTimingMatrix = {
  'Resolving it immediately': { 'Resolving it immediately': 100, 'Resolving it within a day': 85, 'Taking a few days': 50, 'Leaving it alone': 20 },
  'Resolving it within a day': { 'Resolving it immediately': 85, 'Resolving it within a day': 100, 'Taking a few days': 75, 'Leaving it alone': 40 },
  'Taking a few days': { 'Resolving it immediately': 50, 'Resolving it within a day': 75, 'Taking a few days': 100, 'Leaving it alone': 60 },
  'Leaving it alone': { 'Resolving it immediately': 20, 'Resolving it within a day': 40, 'Taking a few days': 60, 'Leaving it alone': 70 }
};

const intentMatrix = {
  'Serious relationship': { 'Serious relationship': 100, 'Meaningful dating': 70, 'Exploring possibilities': 30, 'Curious': 10 },
  'Meaningful dating': { 'Serious relationship': 70, 'Meaningful dating': 100, 'Exploring possibilities': 60, 'Curious': 40 },
  'Exploring possibilities': { 'Serious relationship': 30, 'Meaningful dating': 60, 'Exploring possibilities': 100, 'Curious': 80 },
  'Curious': { 'Serious relationship': 10, 'Meaningful dating': 40, 'Exploring possibilities': 80, 'Curious': 100 }
};

const relationshipValueMatrix = {
  'Trust': { 'Trust': 100, 'Loyalty': 85, 'Communication': 80, 'Growth': 60 },
  'Loyalty': { 'Trust': 85, 'Loyalty': 100, 'Communication': 75, 'Growth': 55 },
  'Communication': { 'Trust': 80, 'Loyalty': 75, 'Communication': 100, 'Growth': 70 },
  'Growth': { 'Trust': 60, 'Loyalty': 55, 'Communication': 70, 'Growth': 100 }
};

const stressMatrix = {
  'Seek support': { 'Seek support': 90, 'Handle it yourself': 75, 'Stay busy': 65, 'Withdraw': 50 },
  'Handle it yourself': { 'Seek support': 75, 'Handle it yourself': 100, 'Stay busy': 85, 'Withdraw': 60 },
  'Stay busy': { 'Seek support': 65, 'Handle it yourself': 85, 'Stay busy': 100, 'Withdraw': 55 },
  'Withdraw': { 'Seek support': 85, 'Handle it yourself': 60, 'Stay busy': 55, 'Withdraw': 70 }
};

const spaceMatrix = {
  'Very little': { 'Very little': 100, 'Moderate': 70, 'Significant': 40, 'A lot': 25 },
  'Moderate': { 'Very little': 70, 'Moderate': 100, 'Significant': 80, 'A lot': 55 },
  'Significant': { 'Very little': 40, 'Moderate': 80, 'Significant': 100, 'A lot': 85 },
  'A lot': { 'Very little': 25, 'Moderate': 55, 'Significant': 85, 'A lot': 100 }
};

const commitmentMatrix = {
  'Extremely important': { 'Extremely important': 100, 'Important': 80, 'Somewhat important': 50, 'Not important': 20 },
  'Important': { 'Extremely important': 80, 'Important': 100, 'Somewhat important': 70, 'Not important': 40 },
  'Somewhat important': { 'Extremely important': 50, 'Important': 70, 'Somewhat important': 100, 'Not important': 65 },
  'Not important': { 'Extremely important': 20, 'Important': 40, 'Somewhat important': 65, 'Not important': 100 }
};

const attractionMatrix = {
  'Confidence': { 'Confidence': 100, 'Kindness': 70, 'Intelligence': 80, 'Ambition': 85 },
  'Kindness': { 'Confidence': 70, 'Kindness': 100, 'Intelligence': 75, 'Ambition': 65 },
  'Intelligence': { 'Confidence': 80, 'Kindness': 75, 'Intelligence': 100, 'Ambition': 85 },
  'Ambition': { 'Confidence': 85, 'Kindness': 65, 'Intelligence': 85, 'Ambition': 100 }
};

const valueMatrix = {
  'Integrity': { 'Integrity': 100, 'Loyalty': 85, 'Growth': 60, 'Success': 50 },
  'Loyalty': { 'Integrity': 85, 'Loyalty': 100, 'Growth': 55, 'Success': 45 },
  'Growth': { 'Integrity': 60, 'Loyalty': 55, 'Growth': 100, 'Success': 75 },
  'Success': { 'Integrity': 50, 'Loyalty': 45, 'Growth': 75, 'Success': 100 }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function getMatrixScore(matrix, answerA, answerB, defaultScore = 50) {
  if (!answerA || !answerB) return defaultScore;
  return matrix[answerA]?.[answerB] ?? defaultScore;
}

function getNumericValue(answer, map, defaultValue = 2) {
  return map[answer] ?? defaultValue;
}

// ============================================
// DEALBREAKER SYSTEM
// ============================================

export function hasDealbreaker(userA, userB) {
  const intentA = userA.answers[31];
  const intentB = userB.answers[31];
  
  if ((intentA === 'Serious relationship' && intentB === 'Curious') || (intentA === 'Curious' && intentB === 'Serious relationship')) {
    return { isDealbreaker: true, reason: 'Mismatch in relationship intent (Serious vs Curious).' };
  }
  if ((intentA === 'Serious relationship' && intentB === 'Exploring possibilities') || (intentA === 'Exploring possibilities' && intentB === 'Serious relationship')) {
    return { isDealbreaker: true, reason: 'Mismatch in relationship intent (Serious vs Exploring).' };
  }
  
  const commitA = userA.answers[36];
  const commitB = userB.answers[36];
  if ((commitA === 'Extremely important' && commitB === 'Not important') || (commitA === 'Not important' && commitB === 'Extremely important')) {
    return { isDealbreaker: true, reason: 'Very different views on commitment.' };
  }
  
  return { isDealbreaker: false, reason: null };
}

// ============================================
// SCORING FUNCTIONS
// ============================================

export function calculateCommunicationScore(userA, userB) {
  let totalScore = 0;
  let totalWeight = 0;
  
  totalScore += getMatrixScore(communicationTimingMatrix, userA.answers[1], userB.answers[1]) * questionWeights[1];
  totalWeight += questionWeights[1];
  
  totalScore += getMatrixScore(frequencyMatrix, userA.answers[2], userB.answers[2]) * questionWeights[2];
  totalWeight += questionWeights[2];
  
  const q3Score = userA.answers[3] === userB.answers[3] ? 100 : (userA.answers[3] === 'Reflect first, then explain' && userB.answers[3] === 'Explain yourself immediately') ? 85 : 60;
  totalScore += q3Score * questionWeights[3];
  totalWeight += questionWeights[3];
  
  totalScore += getMatrixScore(styleMatrix, userA.answers[4], userB.answers[4]) * questionWeights[4];
  totalWeight += questionWeights[4];
  
  return totalWeight > 0 ? (totalScore / totalWeight) : 70;
}

export function calculateConflictScore(userA, userB) {
    let totalScore = 0;
    let totalWeight = 0;
    
    totalScore += getMatrixScore(conflictApproachMatrix, userA.answers[11], userB.answers[11]) * questionWeights[11];
    totalWeight += questionWeights[11];
    
    totalScore += getMatrixScore(resolutionTimingMatrix, userA.answers[12], userB.answers[12]) * questionWeights[12];
    totalWeight += questionWeights[12];

    return totalWeight > 0 ? (totalScore / totalWeight) : 70;
}

export function calculateEmotionalScore(userA, userB) {
    let totalScore = 0;
    let totalWeight = 0;
    
    totalScore += getMatrixScore(stressMatrix, userA.answers[21], userB.answers[21]) * questionWeights[21];
    totalWeight += questionWeights[21];
    
    return totalWeight > 0 ? (totalScore / totalWeight) : 70;
}

export function calculateExpectationsScore(userA, userB) {
    let totalScore = 0;
    let totalWeight = 0;
    
    totalScore += getMatrixScore(intentMatrix, userA.answers[31], userB.answers[31]) * questionWeights[31];
    totalWeight += questionWeights[31];
    
    return totalWeight > 0 ? (totalScore / totalWeight) : 70;
}

export function calculateValuesScore(userA, userB) {
    let totalScore = 0;
    let totalWeight = 0;
    
    totalScore += getMatrixScore(attractionMatrix, userA.answers[43], userB.answers[43]) * questionWeights[43];
    totalWeight += questionWeights[43];
    
    return totalWeight > 0 ? (totalScore / totalWeight) : 70;
}

export function calculateComplementaryBonus(userA, userB) {
  let bonus = 0;
  if ((userA.answers[21] === 'Seek support' && userB.answers[21] === 'Withdraw') || (userA.answers[21] === 'Withdraw' && userB.answers[21] === 'Seek support')) {
    bonus += 12;
  }
  return { bonus: Math.min(bonus, 20) };
}