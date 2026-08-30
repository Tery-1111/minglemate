import { describe, it, expect } from 'vitest';
import { calculateValuesScore } from './compatibilityEngine.js';

describe('calculateValuesScore', () => {
  it('scores from valueMatrix, not attractionMatrix (regression test for BUG-001)', () => {
    // valueMatrix has keys like 'Integrity', 'Loyalty', 'Growth', 'Success'.
    // attractionMatrix has completely different keys ('Confidence', 'Kindness',
    // 'Intelligence', 'Ambition') and would not recognize these answers at all.
    // If this function ever regresses back to using attractionMatrix, the
    // lookup fails and getMatrixScore falls back to its default score of 50
    // instead of the real valueMatrix score of 85 — so this test would catch
    // that regression immediately.
    const userA = { answers: { 43: 'Integrity' } };
    const userB = { answers: { 43: 'Loyalty' } };

    const score = calculateValuesScore(userA, userB);

    // valueMatrix['Integrity']['Loyalty'] === 85
    expect(score).toBe(85);
  });

  it('falls back to the default matrix score (50) when an answer is missing', () => {
    // getMatrixScore's own default (50) fires when the matrix lookup itself
    // fails (undefined answers). Since that still produces a nonzero
    // totalWeight, calculateValuesScore's own 70-fallback never triggers here
    // — it only applies if totalWeight ends up exactly 0, which doesn't
    // happen as long as questionWeights[43] is a positive number.
    const userA = { answers: {} };
    const userB = { answers: {} };

    const score = calculateValuesScore(userA, userB);

    expect(score).toBe(50);
  });
});
