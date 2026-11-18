// Weekly Tier 1 / Tier 2 allocation.
//
// Pure, database-free module: it takes the eligible population and a score
// function and returns both tiers. `match-generator` owns all I/O.
//
// Objective, strictly lexicographic, applied to each tier independently:
//   1. maximise the number of pairs
//   2. maximise the total compatibility score
//   3. minimise repeated pairings (last week's partner)
//   4. deterministic tie-break (see "Determinism" below)
//
// Scoring is the same rounded integer the generator already computes for every
// eligible pair; a pair scoring below MIN_ELIGIBLE_SCORE is never an edge in
// either tier.
//
// Determinism: participants are sorted by id, every edge is stored in canonical
// `a < b` order, and edges are explored in `weight desc, a asc, b asc` order.
// The result is therefore a pure function of the logical input: the same users
// and edges in any row order produce an identical allocation.
//
// Eligibility is NOT re-invented here; callers pass the edges produced by
// `areEligibleCandidates`, so gender/campus/block rules stay in one place.

import { pairKey } from './matchingEligibility.ts'

/** A pair is eligible only if its rounded score reaches the 5% floor. */
export const MIN_ELIGIBLE_SCORE = 5

export interface ScoredEdge {
  a: string
  b: string
  score: number
}

export interface Allocation {
  /** user id -> tier 1 partner, both directions present */
  tier1: Map<string, string>
  /** user id -> tier 2 partner, both directions present */
  tier2: Map<string, string>
  tier1Pairs: Array<[string, string]>
  tier2Pairs: Array<[string, string]>
  /** users with no tier 1 partner (the "U" set) */
  unmatched: string[]
  /** users with no partner at all */
  noPartner: string[]
  /** number of allocated pairs that repeat a previous-week partner */
  repeats: number
  /** sum of the integer compatibility scores of every allocated pair */
  totalScore: number
}

export class AllocationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'AllocationError'
  }
}

/**
 * Integer edge weight (D6).
 *
 *   w = score * (M + 1) + (isRepeat ? 0 : 1)
 *
 * Proof that this encodes objective 3 after objective 2, with cardinality first
 * handled by the algorithm itself (max-flow = max cardinality):
 *
 *  - A matching of k pairs can carry at most k non-repeat bonuses, so the bonus
 *    total is at most M/2 < M + 1. One extra point of compatibility therefore
 *    always outweighs every bonus in the whole matching: score dominates
 *    repeat-avoidance.
 *  - Conversely, two matchings with the same score total differ only in the
 *    bonus, so the one with fewer repeats has the larger weight, and the bonus
 *    per pair is 1, so repeats are minimised exactly.
 *  - Cardinality is not encoded in w at all: the solver sends the maximum flow,
 *    which is the maximum cardinality, and minimises cost among those flows.
 */
function edgeWeight(score: number, isRepeat: boolean, participants: number): number {
  return Math.round(score) * (participants + 1) + (isRepeat ? 0 : 1)
}

/**
 * Refuse to run when the largest possible total weight could leave the safe
 * integer range. With a 100-point score ceiling the worst case is
 * `M/2 * (100*(M+1) + 1)`.
 */
export function assertWeightBudget(participants: number): void {
  if (!Number.isInteger(participants) || participants < 0) {
    throw new AllocationError('invalid_population', `participant count ${participants} is not a natural number`)
  }
  const maxTotal = (participants / 2) * (100 * (participants + 1) + 1)
  if (!Number.isFinite(maxTotal) || maxTotal >= Number.MAX_SAFE_INTEGER) {
    throw new AllocationError(
      'weight_overflow',
      `population of ${participants} could exceed Number.MAX_SAFE_INTEGER (${maxTotal}); refusing to allocate`,
    )
  }
}

/** Canonicalise and de-duplicate edges; drop anything below the floor. */
function normaliseEdges(participants: ReadonlySet<string>, edges: readonly ScoredEdge[]): ScoredEdge[] {
  const byKey = new Map<string, ScoredEdge>()
  for (const e of edges) {
    if (!participants.has(e.a) || !participants.has(e.b)) continue
    if (e.a === e.b) continue
    if (!Number.isFinite(e.score) || Math.round(e.score) < MIN_ELIGIBLE_SCORE) continue
    const [a, b] = e.a < e.b ? [e.a, e.b] : [e.b, e.a]
    const key = pairKey(a, b)
    const existing = byKey.get(key)
    if (!existing) byKey.set(key, { a, b, score: Math.round(e.score) })
  }
  return [...byKey.values()].sort((x, y) => (x.a !== y.a ? (x.a < y.a ? -1 : 1) : x.b < y.b ? -1 : 1))
}

/**
 * Exact maximum-cardinality, maximum-weight matching for a bipartite graph,
 * via successive shortest augmenting paths (SPFA, so negative costs are fine).
 *
 * Every round augments one unit of flow, so the loop runs until the flow is
 * maximum — that is, until the matching has maximum cardinality. Because each
 * round uses a shortest (most negative) path, the flow of maximum value has
 * minimum total cost, i.e. maximum total weight among the maximum-cardinality
 * matchings.
 */
function maxCardinalityMaxWeightBipartite(
  leftCount: number,
  rightCount: number,
  edges: ReadonlyArray<{ l: number; r: number; w: number }>,
): Array<[number, number]> {
  const nl = leftCount
  const nr = rightCount
  const source = 0
  const sink = nl + nr + 1
  const nodeCount = nl + nr + 2

  interface FlowEdge {
    to: number
    cap: number
    cost: number
    rev: number
  }
  const graph: FlowEdge[][] = Array.from({ length: nodeCount }, () => [])

  const addEdge = (from: number, to: number, cap: number, cost: number): void => {
    graph[from].push({ to, cap, cost, rev: graph[to].length })
    graph[to].push({ to: from, cap: 0, cost: -cost, rev: graph[from].length - 1 })
  }

  for (let i = 0; i < nl; i++) addEdge(source, 1 + i, 1, 0)
  for (let j = 0; j < nr; j++) addEdge(1 + nl + j, sink, 1, 0)
  for (const e of edges) addEdge(1 + e.l, 1 + nl + e.r, 1, -e.w)

  for (let round = 0; round < Math.min(nl, nr); round++) {
    const dist = new Array<number>(nodeCount).fill(Infinity)
    const inQueue = new Array<boolean>(nodeCount).fill(false)
    const prevNode = new Array<number>(nodeCount).fill(-1)
    const prevEdge = new Array<number>(nodeCount).fill(-1)

    dist[source] = 0
    const queue: number[] = [source]
    inQueue[source] = true
    while (queue.length > 0) {
      const u = queue.shift() as number
      inQueue[u] = false
      for (let ei = 0; ei < graph[u].length; ei++) {
        const e = graph[u][ei]
        if (e.cap <= 0) continue
        const nd = dist[u] + e.cost
        if (nd < dist[e.to]) {
          dist[e.to] = nd
          prevNode[e.to] = u
          prevEdge[e.to] = ei
          if (!inQueue[e.to]) {
            inQueue[e.to] = true
            queue.push(e.to)
          }
        }
      }
    }

    if (dist[sink] === Infinity) break

    let node = sink
    while (node !== source) {
      const p = prevNode[node]
      const pe = prevEdge[node]
      const e = graph[p][pe]
      e.cap -= 1
      graph[node][e.rev].cap += 1
      node = p
    }
  }

  const out: Array<[number, number]> = []
  for (let i = 0; i < nl; i++) {
    for (const e of graph[1 + i]) {
      if (e.to > nl && e.to !== sink && e.cap === 0) {
        const j = e.to - nl - 1
        if (j >= 0 && j < nr) out.push([i, j])
      }
    }
  }
  return out
}

/** Two-colour a component built from the given edges. Returns null on an odd cycle. */
function bipartition(
  ids: string[],
  adjacency: Map<string, Set<string>>,
): { left: string[]; right: string[] } | null {
  const colour = new Map<string, 0 | 1>()
  for (const start of ids) {
    if (colour.has(start)) continue
    colour.set(start, 0)
    const stack = [start]
    while (stack.length > 0) {
      const u = stack.pop() as string
      const cu = colour.get(u) as 0 | 1
      for (const v of adjacency.get(u) ?? []) {
        const existing = colour.get(v)
        if (existing === undefined) {
          colour.set(v, cu === 0 ? 1 : 0)
          stack.push(v)
        } else if (existing === cu) {
          return null
        }
      }
    }
  }
  const left: string[] = []
  const right: string[] = []
  for (const id of ids) (colour.get(id) === 0 ? left : right).push(id)
  return { left, right }
}

/**
 * Solve one tier over `participants` restricted to `edges`.
 *
 * The wrapper is a no-op while the eligibility graph is bipartite (two
 * gender values). It refuses to guess if that ever stops being true.
 */
function solveOneTier(
  participants: string[],
  edges: ScoredEdge[],
  previousPairs: ReadonlySet<string>,
  participantCount: number,
): Array<[string, string]> {
  if (participants.length === 0 || edges.length === 0) return []

  const participantSet = new Set(participants)
  const adjacency = new Map<string, Set<string>>()
  for (const p of participants) adjacency.set(p, new Set())
  const usable = edges.filter((e) => participantSet.has(e.a) && participantSet.has(e.b))
  if (usable.length === 0) return []
  for (const e of usable) {
    adjacency.get(e.a)?.add(e.b)
    adjacency.get(e.b)?.add(e.a)
  }

  const pairs: Array<[string, string]> = []

  // Components are independent: eligibility never crosses a campus.
  const seen = new Set<string>()
  const components: string[][] = []
  for (const p of participants) {
    if (seen.has(p)) continue
    const comp: string[] = []
    const stack = [p]
    seen.add(p)
    while (stack.length > 0) {
      const u = stack.pop() as string
      comp.push(u)
      for (const v of adjacency.get(u) ?? []) {
        if (!seen.has(v)) {
          seen.add(v)
          stack.push(v)
        }
      }
    }
    components.push(comp.sort())
  }

  for (const component of components) {
    const inComponent = new Set(component)
    const compEdges = usable.filter((e) => inComponent.has(e.a))
    if (compEdges.length === 0) continue

    const colouring = bipartition(component, adjacency)
    if (!colouring) {
      // D5 makes this unreachable: eligibility requires exactly one male and
      // one female. Never guess — the caller must publish nothing.
      throw new AllocationError(
        'non_bipartite',
        'eligibility graph is not bipartite; refusing to allocate',
      )
    }

    const left = colouring.left.slice().sort()
    const right = colouring.right.slice().sort()
    const leftIndex = new Map(left.map((id, i) => [id, i]))
    const rightIndex = new Map(right.map((id, i) => [id, i]))

    const indexed = compEdges
      .map((e) => {
        const [x, y] = leftIndex.has(e.a) ? [e.a, e.b] : [e.b, e.a]
        return {
          l: leftIndex.get(x) as number,
          r: rightIndex.get(y) as number,
          w: edgeWeight(e.score, previousPairs.has(pairKey(e.a, e.b)), participantCount),
          a: x,
          b: y,
        }
      })
      .sort((m, n) => {
        if (m.w !== n.w) return n.w - m.w
        if (m.a !== n.a) return m.a < n.a ? -1 : 1
        if (m.b !== n.b) return m.b < n.b ? -1 : 1
        return 0
      })

    for (const [li, ri] of maxCardinalityMaxWeightBipartite(left.length, right.length, indexed)) {
      const x = left[li]
      const y = right[ri]
      pairs.push(x < y ? [x, y] : [y, x])
    }
  }

  return pairs.sort((p, q) => (p[0] !== q[0] ? (p[0] < q[0] ? -1 : 1) : p[1] < q[1] ? -1 : 1))
}

/** Accept the canonical `a|b` form and the legacy `a:b` form, both directions. */
function normalisePreviousPairs(previousPartners: Iterable<string>): Set<string> {
  const out = new Set<string>()
  for (const raw of previousPartners) {
    if (typeof raw !== 'string') continue
    const parts = raw.split(/[|:]/)
    if (parts.length !== 2) continue
    const [a, b] = parts
    if (!a || !b || a === b) continue
    out.add(pairKey(a, b))
  }
  return out
}

/**
 * Allocate both tiers.
 *
 * Tier 1 is one global mutual matching over the whole eligible population and is
 * final. Tier 2 is a *recovery* pass, not a second full matching: its edges are
 * exactly the pairs (a, b) with score >= 5 that are not Tier 1 pairs and where
 * at least one of a, b has no Tier 1 partner. Two users who both have a Tier 1
 * partner can never be paired in Tier 2, and every user holds at most one Tier 2
 * partner.
 *
 * Why recovery rather than a second full pass: after a maximum Tier 1 matching
 * the users in U have no eligible edges left among themselves (otherwise Tier 1
 * was not maximum), so Tier 2 must pair them with already-matched users.
 */
export function allocateTiers(
  participants: readonly string[],
  edges: readonly ScoredEdge[],
  previousPartners: ReadonlySet<string> | Iterable<string>,
): Allocation {
  const sortedParticipants = [...new Set(participants)].sort()
  const participantCount = sortedParticipants.length
  assertWeightBudget(participantCount)

  const participantSet = new Set(sortedParticipants)
  const canonicalEdges = normaliseEdges(participantSet, edges)
  const previousPairs = normalisePreviousPairs(previousPartners)

  const tier1Pairs = solveOneTier(sortedParticipants, canonicalEdges, previousPairs, participantCount)

  const tier1 = new Map<string, string>()
  for (const [a, b] of tier1Pairs) {
    tier1.set(a, b)
    tier1.set(b, a)
  }

  const unmatched = sortedParticipants.filter((id) => !tier1.has(id))
  const unmatchedSet = new Set(unmatched)
  const tier1Keys = new Set(tier1Pairs.map(([a, b]) => pairKey(a, b)))

  const tier2Candidates = canonicalEdges.filter(
    (e) => !tier1Keys.has(pairKey(e.a, e.b)) && (unmatchedSet.has(e.a) || unmatchedSet.has(e.b)),
  )
  const tier2Pairs = solveOneTier(sortedParticipants, tier2Candidates, previousPairs, participantCount)

  const tier2 = new Map<string, string>()
  for (const [a, b] of tier2Pairs) {
    tier2.set(a, b)
    tier2.set(b, a)
  }

  const scoreOf = new Map(canonicalEdges.map((e) => [pairKey(e.a, e.b), e.score]))
  let repeats = 0
  let totalScore = 0
  for (const [a, b] of [...tier1Pairs, ...tier2Pairs]) {
    totalScore += scoreOf.get(pairKey(a, b)) ?? 0
    if (previousPairs.has(pairKey(a, b))) repeats++
  }

  const noPartner = sortedParticipants.filter((id) => !tier1.has(id) && !tier2.has(id))

  const allocation: Allocation = {
    tier1,
    tier2,
    tier1Pairs,
    tier2Pairs,
    unmatched,
    noPartner,
    repeats,
    totalScore,
  }
  validateAllocation(allocation, sortedParticipants, canonicalEdges, previousPairs)
  return allocation
}

/**
 * Structural validation, run before anything is published. Any violation throws
 * and the caller writes nothing.
 */
export function validateAllocation(
  allocation: Allocation,
  participants: readonly string[],
  edges: readonly ScoredEdge[],
  previousPartners: ReadonlySet<string>,
): void {
  const participantSet = new Set(participants)
  if (participantSet.size !== participants.length) {
    throw new AllocationError('invalid_population', 'duplicate participant id')
  }

  const scoreOf = new Map(edges.map((e) => [pairKey(e.a, e.b), e.score]))

  const check = (tier: string, map: Map<string, string>, pairs: Array<[string, string]>): void => {
    const seen = new Set<string>()
    for (const [a, b] of pairs) {
      if (a === b) throw new AllocationError('invalid_pair', `${tier}: self-pair ${a}`)
      if (!participantSet.has(a) || !participantSet.has(b)) {
        throw new AllocationError('invalid_pair', `${tier}: ${a}/${b} is not an eligible participant`)
      }
      const key = pairKey(a, b)
      const score = scoreOf.get(key)
      if (score === undefined) {
        throw new AllocationError('ineligible_pair', `${tier}: ${key} is not an eligible edge`)
      }
      if (score < MIN_ELIGIBLE_SCORE) {
        throw new AllocationError('below_floor', `${tier}: ${key} scores ${score}, below the ${MIN_ELIGIBLE_SCORE} floor`)
      }
      for (const [self, other] of [[a, b], [b, a]] as const) {
        if (seen.has(self)) throw new AllocationError('duplicate_participant', `${tier}: ${self} appears twice`)
        seen.add(self)
        if (map.get(self) !== other) {
          throw new AllocationError('asymmetric', `${tier}: ${self} is not mutual with ${other}`)
        }
      }
    }
    for (const [self, other] of map) {
      if (map.get(other) !== self) throw new AllocationError('asymmetric', `${tier}: ${self}->${other} is not mutual`)
    }
  }

  // A pair may not appear in both tiers.
  const allKeys = new Set<string>()
  for (const [a, b] of allocation.tier1Pairs) {
    allKeys.add(pairKey(a, b))
  }
  for (const [a, b] of allocation.tier2Pairs) {
    const key = pairKey(a, b)
    if (allKeys.has(key)) {
      throw new AllocationError('duplicate_participant', `pair ${key} allocated in both tiers`)
    }
    allKeys.add(key)
  }

  check('tier1', allocation.tier1, allocation.tier1Pairs)
  check('tier2', allocation.tier2, allocation.tier2Pairs)

  // A user's two partners must differ, and Tier 1 must be untouched by Tier 2.
  for (const [self, tier2Partner] of allocation.tier2) {
    const tier1Partner = allocation.tier1.get(self)
    if (tier1Partner !== undefined && tier1Partner === tier2Partner) {
      throw new AllocationError('duplicate_partner', `tier2 reuses the tier1 partner for ${self}`)
    }
  }

  // Tier 2 must involve at least one user who received no Tier 1 partner.
  for (const [a, b] of allocation.tier2Pairs) {
    if (allocation.tier1.has(a) && allocation.tier1.has(b)) {
      throw new AllocationError(
        'tier2_shape',
        `tier2 pair ${pairKey(a, b)} joins two tier1-matched users`,
      )
    }
  }

  // Tier 1 must be maximum: no two users in U may share a Tier 1-eligible edge,
  // otherwise an extra pair was available and coverage was left on the table.
  // Scanned over the edge list (O(E)), not over all pairs of unmatched users.
  const unmatchedSet = new Set(allocation.unmatched)
  for (const e of edges) {
    if (unmatchedSet.has(e.a) && unmatchedSet.has(e.b)) {
      throw new AllocationError(
        'tier1_not_maximum',
        `tier1 left ${pairKey(e.a, e.b)} unallocated although both users are unmatched`,
      )
    }
  }

  void previousPartners
}
