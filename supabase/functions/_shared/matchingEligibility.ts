export interface MatchCandidate {
  id: string
  gender: string | null
  campus_id: string | null
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

export function areEligibleCandidates(
  userA: MatchCandidate,
  userB: MatchCandidate,
  blockedPairs: ReadonlySet<string>
): boolean {
  return userA.gender !== userB.gender &&
    userA.campus_id === userB.campus_id &&
    !blockedPairs.has(pairKey(userA.id, userB.id))
}
