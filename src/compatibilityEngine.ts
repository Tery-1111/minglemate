/**
 * MingleMate Compatibility Engine v3.0
 * Complete, full implementation for all 50 questions.
 */

export interface UserProfile {
  id: string;
  answers: Record<number, string>;
}

// 1. QUESTION WEIGHTS
export const questionWeights: Record<number, number> = {
  1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 10: 3,
  11: 3, 12: 3, 13: 3, 14: 3, 15: 3, 16: 3, 17: 3, 18: 3, 19: 3, 20: 3,
  21: 2, 22: 2, 23: 2, 24: 2, 25: 2, 26: 2, 27: 2, 28: 2, 29: 2, 30: 2,
  31: 3, 32: 3, 33: 2, 34: 3, 35: 2, 36: 3, 37: 2, 38: 3, 39: 3, 40: 2,
  41: 1, 42: 1, 43: 1, 44: 1, 45: 1, 46: 1, 47: 1, 48: 1, 49: 1, 50: 1
};

// 2. MATRICES (Mapping all categories)
const communicationMatrix = { 
  'Talk about it immediately': { 'Talk about it immediately': 100, 'Think first, then talk': 85, 'Keep it to yourself': 30, 'Avoid discussing it': 20 },
  'Think first, then talk': { 'Talk about it immediately': 85, 'Think first, then talk': 100, 'Keep it to yourself': 50, 'Avoid discussing it': 35 },
  'Keep it to yourself': { 'Talk about it immediately': 30, 'Think first, then talk': 50, 'Keep it to yourself': 70, 'Avoid discussing it': 60 },
  'Avoid discussing it': { 'Talk about it immediately': 20, 'Think first, then talk': 35, 'Keep it to yourself': 60, 'Avoid discussing it': 80 }
};

const conflictMatrix = {
  'Address it immediately': { 'Address it immediately': 100, 'Take some time first': 85, 'Avoid it': 25, 'Depends on the situation': 70 },
  'Take some time first': { 'Address it immediately': 85, 'Take some time first': 100, 'Avoid it': 45, 'Depends on the situation': 80 },
  'Avoid it': { 'Address it immediately': 25, 'Take some time first': 45, 'Avoid it': 65, 'Depends on the situation': 50 },
  'Depends on the situation': { 'Address it immediately': 70, 'Take some time first': 80, 'Avoid it': 50, 'Depends on the situation': 100 }
};

const emotionalMatrix = {
  'Seek support': { 'Seek support': 90, 'Handle it yourself': 85, 'Stay busy': 60, 'Withdraw': 50 },
  'Handle it yourself': { 'Seek support': 85, 'Handle it yourself': 100, 'Stay busy': 75, 'Withdraw': 55 },
  'Stay busy': { 'Seek support': 60, 'Handle it yourself': 75, 'Stay busy': 100, 'Withdraw': 50 },
  'Withdraw': { 'Seek support': 50, 'Handle it yourself': 55, 'Stay busy': 50, 'Withdraw': 80 }
};

const expectationsMatrix = {
  'Serious relationship': { 'Serious relationship': 100, 'Meaningful dating': 80, 'Exploring possibilities': 20, 'Curious': 10 },
  'Meaningful dating': { 'Serious relationship': 80, 'Meaningful dating': 100, 'Exploring possibilities': 70, 'Curious': 30 },
  'Exploring possibilities': { 'Serious relationship': 20, 'Meaningful dating': 70, 'Exploring possibilities': 100, 'Curious': 75 },
  'Curious': { 'Serious relationship': 10, 'Meaningful dating': 30, 'Exploring possibilities': 75, 'Curious': 100 }
};

const lifestyleMatrix = {
  'Integrity': { 'Integrity': 100, 'Loyalty': 90, 'Growth': 70, 'Success': 60 },
  'Loyalty': { 'Integrity': 90, 'Loyalty': 100, 'Growth': 65, 'Success': 50 },
  'Growth': { 'Integrity': 70, 'Loyalty': 65, 'Growth': 100, 'Success': 80 },
  'Success': { 'Integrity': 60, 'Loyalty': 50, 'Growth': 80, 'Success': 100 }
};

// 3. CORE LOGIC
function getScore(a: string, b: string, matrix: any): number {
  if (!a || !b) return 50;
  return matrix[a]?.[b] ?? 50;
}

export function hasDealbreaker(userA: UserProfile, userB: UserProfile) {
  const intentA = userA.answers[31];
  const intentB = userB.answers[31];
  if ((intentA === 'Serious relationship' && (intentB === 'Curious' || intentB === 'Exploring possibilities')) || 
      (intentB === 'Serious relationship' && (intentA === 'Curious' || intentA === 'Exploring possibilities'))) {
    return { isDealbreaker: true, reason: 'Mismatch in relationship intent.' };
  }
  return { isDealbreaker: false, reason: null };
}

function calculateCategory(userA: UserProfile, userB: UserProfile, start: number, end: number, matrix: any): number {
  let total = 0, weight = 0;
  for (let i = start; i <= end; i++) {
    const score = getScore(userA.answers[i], userB.answers[i], matrix);
    total += score * questionWeights[i];
    weight += questionWeights[i];
  }
  return total / weight;
}

export const calculateCompatibility = (userA: UserProfile, userB: UserProfile) => {
  const scores = {
    communication: calculateCategory(userA, userB, 1, 10, communicationMatrix),
    conflict: calculateCategory(userA, userB, 11, 20, conflictMatrix),
    emotional: calculateCategory(userA, userB, 21, 30, emotionalMatrix),
    expectations: calculateCategory(userA, userB, 31, 40, expectationsMatrix),
    values: calculateCategory(userA, userB, 41, 50, lifestyleMatrix),
  };
  
  const total = Object.values(scores).reduce((a, b) => a + b, 0) / 5;
  return { scores, total };
};