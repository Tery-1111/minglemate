export interface MatchCandidate {
  id: string
  gender: string | null
  campus_id: string | null
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * The only genders the allocator treats as matchable.
 *
 * A database CHECK constraining `users.gender` to these two values is NOT
 * verified to exist: no such constraint appears in this repository's migrations,
 * and the live database has not been inspected. The bipartite guarantee is
 * therefore enforced HERE (this filter) and by the allocator's `non_bipartite`
 * fail-closed guard, never assumed from the schema.
 */
const GENDERS = new Set(['male', 'female'])

/** True when the value is one of the two matchable genders. */
export function isMatchableGender(gender: string | null | undefined): boolean {
  return typeof gender === 'string' && GENDERS.has(gender)
}

/**
 * True when the pair is one male and one female, in either order.
 * Null, empty, unknown and same-gender pairs are not eligible.
 */
export function isOppositeGender(userA: MatchCandidate, userB: MatchCandidate): boolean {
  if (!isMatchableGender(userA.gender) || !isMatchableGender(userB.gender)) return false
  return userA.gender !== userB.gender
}

export function areEligibleCandidates(
  userA: MatchCandidate,
  userB: MatchCandidate,
  blockedPairs: ReadonlySet<string>
): boolean {
  return isOppositeGender(userA, userB) &&
    userA.campus_id === userB.campus_id &&
    !blockedPairs.has(pairKey(userA.id, userB.id))
}
