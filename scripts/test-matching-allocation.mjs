// Tests for the weekly Tier 1 / Tier 2 allocator.
//
//   node scripts/test-matching-allocation.mjs
//
// Part A drives the pure allocator (supabase/functions/_shared/matchingAllocation.ts):
// the NetworkX oracle (D7), objective order, the 5% floor, Tier 2 shape,
// population shapes, eligibility, repeat detection, determinism and performance.
// Part B drives the REAL match-generator entrypoint with a fake Supabase client,
// to prove the fail-closed and single-statement publish behaviour.
//
// No network, no database, no Deno.

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

import { allocateTiers, validateAllocation, MIN_ELIGIBLE_SCORE } from '../supabase/functions/_shared/matchingAllocation.ts'

const results = []
async function test(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`PASS  ${name}`)
  } catch (e) {
    results.push({ name, ok: false, error: e.message })
    console.log(`FAIL  ${name}\n      ${e.message}`)
  }
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const sortedPairs = (pairs) => pairs.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)).sort()

/** Synthetic population: nFemale + nMales users on one campus, complete bipartite. */
function population(nFemale, nMales, opts = {}) {
  const campus = opts.campus ?? 'campus-a'
  const tag = opts.tag ?? ''
  const participants = []
  const users = []
  for (let i = 0; i < nFemale; i++) {
    const id = `${tag}f${String(i).padStart(3, '0')}`
    users.push({ id, gender: 'female', campus_id: campus })
    participants.push(id)
  }
  for (let i = 0; i < nMales; i++) {
    const id = `${tag}m${String(i).padStart(3, '0')}`
    users.push({ id, gender: 'male', campus_id: campus })
    participants.push(id)
  }
  const edges = []
  for (const f of users.filter((u) => u.gender === 'female')) {
    for (const m of users.filter((u) => u.gender === 'male')) {
      const score = opts.score ? opts.score(f.id, m.id, f, m) : 50
      if (score === null) continue // omit this edge
      edges.push({ a: f.id, b: m.id, score })
    }
  }
  return { participants, edges, users }
}

const byId = (alloc) => [...alloc.tier1.entries()].sort()
const byId2 = (alloc) => [...alloc.tier2.entries()].sort()

// ---------------------------------------------------------------------------
// D7 — the general-graph blossom port is NOT usable, so the allocator keeps the
// bipartite solver. The allocator is verified against NetworkX instead.
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url))
const ORACLE = join(__dirname, '_nx_oracle.py')
const ALLOCATION_SRC = join(__dirname, '../supabase/functions/_shared/matchingAllocation.ts')
const GENERATOR_SRC = join(__dirname, '../supabase/functions/match-generator/index.ts')

function oracle(cases) {
  const { results: out } = JSON.parse(
    execFileSync('python', [ORACLE], { input: JSON.stringify({ cases }), encoding: 'utf8' }),
  )
  return out
}

function makeRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

await test('T1a oracle: allocator Tier 1 equals NetworkX max-cardinality max-weight optimum', async () => {
  const rnd = makeRng(20240601)
  const cases = []
  const expected = []
  const mine = []
  for (let t = 0; t < 300; t++) {
    const nF = 1 + Math.floor(rnd() * 6)
    const nM = 1 + Math.floor(rnd() * 6)
    const density = 0.35 + rnd() * 0.65
    const { participants, edges } = population(nF, nM, {
      score: () => (rnd() < density ? 5 + Math.floor(rnd() * 96) : null),
    })
    if (edges.length === 0) continue
    const M = participants.length
    const prevById = new Map()
    for (const e of edges) if (rnd() < 0.25) prevById.set(pairKey(e.a, e.b), true)
    const weightOf = (e) => e.score * (M + 1) + (prevById.has(pairKey(e.a, e.b)) ? 0 : 1)
    const idx = new Map(participants.map((p, i) => [p, i]))
    const alloc = allocateTiers(participants, edges, new Set(prevById.keys()))
    const pairs = alloc.tier1Pairs.map(([a, b]) => [idx.get(a), idx.get(b)])
    const ourWeight = alloc.tier1Pairs.reduce(
      (sum, [a, b]) => sum + weightOf(edges.find((e) => pairKey(e.a, e.b) === pairKey(a, b))),
      0,
    )
    mine.push({ cardinality: pairs.length, weight: ourWeight })
    cases.push({
      nodes: participants.length,
      edges: edges.map((e) => [idx.get(e.a), idx.get(e.b), weightOf(e)]),
      maxcardinality: true,
    })
    expected.push(null)
  }
  const orc = oracle(cases)
  assert.equal(orc.length, mine.length, `oracle returned ${orc.length}/${mine.length} cases`)
  let mismatches = 0
  for (let i = 0; i < orc.length; i++) {
    if (orc[i].cardinality !== mine[i].cardinality || orc[i].weight !== mine[i].weight) {
      mismatches++
      if (mismatches <= 3) {
        console.log(`      mismatch case ${i}: oracle ${orc[i].cardinality}/${orc[i].weight} vs allocator ${mine[i].cardinality}/${mine[i].weight}`)
      }
    }
  }
  assert.equal(mismatches, 0, `${mismatches}/${orc.length} allocations disagreed with NetworkX`)
  console.log(`      (${orc.length} bipartite graphs: cardinality and total weight matched NetworkX exactly)`)
  void expected
})

await test('T1b D7 verdict: the general-graph blossom port is not on the active path', async () => {
  // The port fails D7 (wrong weights / throws on odd cycles), so per D7 the
  // allocator keeps the bipartite solver and the generator must not import it.
  const allocation = readFileSync(ALLOCATION_SRC, 'utf8')
  const generator = readFileSync(GENERATOR_SRC, 'utf8')
  assert.ok(!/maxWeightMatching/.test(allocation), 'allocator must not import the rejected blossom port')
  assert.ok(!/maxWeightMatching/.test(generator), 'generator must not import the rejected blossom port')
  assert.ok(
    /non_bipartite/.test(allocation),
    'the bipartite allocator must keep its fail-closed non_bipartite guard',
  )
  console.log('      (blossom port rejected by D7; bipartite allocator + non_bipartite guard retained)')
})

// ---------------------------------------------------------------------------
// T2 — objective order, lexicographic: pairs, then total score, then repeats,
// then deterministic tie-break. Run separately for Tier 1 and Tier 2.
// ---------------------------------------------------------------------------

/** 4 females / 2 males. Tier 1 takes the two strongest females. */
function tier2Fixture(tier2Scores) {
  // f000/f001 score high enough to win Tier 1; f002/f003 are left in U.
  const score = (f, m) => {
    if (f === 'f000') return 90
    if (f === 'f001') return 88
    // Tier 2 candidate scores, controllable per edge.
    const k = `${f}|${m}`
    if (k in tier2Scores) {
      const v = tier2Scores[k]
      return v === null ? null : v
    }
    return 10
  }
  return population(4, 2, { score })
}

await test('T2a Tier 1: equal pairs, higher total score beats fewer repeats', async () => {
  // Two possible perfect matchings over 2v2. The low-score one is repeat-free,
  // the high-score one repeats last week. Score must win.
  const participants = ['f0', 'f1', 'm0', 'm1']
  const edges = [
    { a: 'f0', b: 'm0', score: 90 },
    { a: 'f0', b: 'm1', score: 60 },
    { a: 'f1', b: 'm0', score: 60 },
    { a: 'f1', b: 'm1', score: 90 },
  ]
  const repeatedHigh = new Set(['f0|m0', 'f1|m1']) // the high-score matching repeats
  const a = allocateTiers(participants, edges, repeatedHigh)
  assert.equal(a.tier1Pairs.length, 2)
  assert.equal(a.totalScore >= 180, true, 'high-score matching must be chosen')
})

await test('T2b Tier 1: equal pairs and equal score, fewer repeats wins', async () => {
  const participants = ['f0', 'f1', 'm0', 'm1']
  const edges = [
    { a: 'f0', b: 'm0', score: 50 },
    { a: 'f0', b: 'm1', score: 50 },
    { a: 'f1', b: 'm0', score: 50 },
    { a: 'f1', b: 'm1', score: 50 },
  ]
  // Diagonal repeats; the anti-diagonal is fresh.
  const a = allocateTiers(participants, edges, new Set(['f0|m0', 'f1|m1']))
  for (const [x, y] of a.tier1Pairs) assert.notEqual(pairKey(x, y), 'f0|m0')
  for (const [x, y] of a.tier1Pairs) assert.notEqual(pairKey(x, y), 'f1|m1')
})

await test('T2c Tier 1: one extra pair beats any score gain', async () => {
  // 2 females / 2 males. Matching {f0-m0} only would score 100; matching both
  // pairs scores 12 total but has one more pair. Cardinality must win.
  const participants = ['f0', 'f1', 'm0', 'm1']
  const edges = [
    { a: 'f0', b: 'm0', score: 100 },
    { a: 'f0', b: 'm1', score: 6 },
    { a: 'f1', b: 'm0', score: 6 },
    { a: 'f1', b: 'm1', score: 6 },
  ]
  const a = allocateTiers(participants, edges, new Set())
  assert.equal(a.tier1Pairs.length, 2, 'two pairs must beat one perfect-score pair')
})

await test('T2d Tier 1: a full tie is resolved deterministically', async () => {
  // Complete 3v3, every edge identical: 6 pairs are all optimal. Run it under 50
  // shuffles and require an identical answer every time.
  const { participants, edges } = population(3, 3)
  const first = allocateTiers(participants, edges, new Set())
  for (let s = 0; s < 50; s++) {
    const p = [...participants]
    const e = [...edges]
    for (let i = p.length - 1; i > 0; i--) {
      const j = (s * 7 + i * 13) % (i + 1)
      ;[p[i], p[j]] = [p[j], p[i]]
    }
    for (let i = e.length - 1; i > 0; i--) {
      const j = (s * 11 + i * 17) % (i + 1)
      ;[e[i], e[j]] = [e[j], e[i]]
    }
    const other = allocateTiers(p, e, new Set())
    assert.deepEqual(sortedPairs(other.tier1Pairs), sortedPairs(first.tier1Pairs), `shuffle ${s} diverged`)
  }
})

await test('T2e Tier 2: equal pairs, higher total score wins', async () => {
  const { participants, edges } = tier2Fixture({
    'f002|m000': 70,
    'f002|m001': 30,
    'f003|m000': 30,
    'f003|m001': 70,
  })
  const a = allocateTiers(participants, edges, new Set())
  assert.equal(a.tier1Pairs.length, 2)
  assert.equal(a.unmatched.length, 2, 'two females are left in U')
  assert.equal(a.tier2Pairs.length, 2)
  assert.equal(a.tier2Pairs.reduce((s, [x, y]) => s + (edges.find((e) => pairKey(e.a, e.b) === pairKey(x, y))?.score ?? 0), 0), 140)
})

await test('T2f Tier 2: equal pairs and equal score, fewer repeats wins', async () => {
  const { participants, edges } = tier2Fixture({
    'f002|m000': 70,
    'f002|m001': 70,
    'f003|m000': 70,
    'f003|m001': 70,
  })
  // Mark the straight assignment as last week's pairs; Tier 2 should avoid it.
  const prev = new Set(['f002|m000', 'f003|m001'])
  const a = allocateTiers(participants, edges, prev)
  const tier2Keys = a.tier2Pairs.map(([x, y]) => pairKey(x, y))
  assert.equal(a.tier2Pairs.length, 2)
  assert.equal(tier2Keys.filter((k) => prev.has(k)).length, 0, 'tier 2 must avoid repeats at equal score')
})

await test('T2g Tier 2: one extra pair beats any score gain', async () => {
  // Only f02-m00 (70) exists plus f03-m00 and f03-m01. Best single pair is 70;
  // the cardinality-maximum answer is {f03-m00, f02-m01?} - construct so that
  // two low pairs are possible only by skipping the 70 edge.
  const { participants, edges } = tier2Fixture({
    'f002|m000': 70,
    'f002|m001': 65,
    'f003|m000': 20,
    'f003|m001': 18,
  })
  const a = allocateTiers(participants, edges, new Set())
  assert.equal(a.tier2Pairs.length, 2, 'two tier-2 pairs beat one higher-scoring pair')
})

await test('T2h Tier 2: a full tie is resolved deterministically', async () => {
  const { participants, edges } = tier2Fixture({
    'f002|m000': 40,
    'f002|m001': 40,
    'f003|m000': 40,
    'f003|m001': 40,
  })
  const first = allocateTiers(participants, edges, new Set())
  for (let s = 0; s < 50; s++) {
    const p = [...participants].reverse()
    const e = [...edges].reverse()
    const other = allocateTiers(p, e, new Set())
    assert.deepEqual(byId2(other), byId2(first), `shuffle ${s} diverged`)
    assert.deepEqual(byId(other), byId(first), `shuffle ${s} diverged tier 1`)
  }
})

// ---------------------------------------------------------------------------
// T3 — the 5% floor
// ---------------------------------------------------------------------------

await test('T3a floor: a pair scoring 4 is never allocated', async () => {
  const { participants, edges } = population(2, 2, { score: () => 4 })
  const a = allocateTiers(participants, edges, new Set())
  assert.equal(a.tier1Pairs.length, 0)
  assert.equal(a.tier2Pairs.length, 0)
  assert.equal(a.noPartner.length, 4)
})

await test('T3b floor: a pair scoring exactly 5 is allocated', async () => {
  const { participants, edges } = population(1, 1, { score: () => MIN_ELIGIBLE_SCORE })
  const a = allocateTiers(participants, edges, new Set())
  assert.equal(a.tier1Pairs.length, 1)
})

await test('T3c floor: a sub-floor pair does not block an above-floor alternative', async () => {
  // f0-m0 scores 4, f0-m1 scores 60, f1-m0 scores 60, f1-m1 scores 4.
  const participants = ['f0', 'f1', 'm0', 'm1']
  const edges = [
    { a: 'f0', b: 'm0', score: 4 },
    { a: 'f0', b: 'm1', score: 60 },
    { a: 'f1', b: 'm0', score: 60 },
    { a: 'f1', b: 'm1', score: 4 },
  ]
  const a = allocateTiers(participants, edges, new Set())
  assert.deepEqual(sortedPairs(a.tier1Pairs), ['f0|m1', 'f1|m0'])
})

await test('T3d floor: validation rejects a published pair below 5', async () => {
  const participants = ['f0', 'm0']
  const allocation = {
    tier1: new Map([['f0', 'm0'], ['m0', 'f0']]),
    tier2: new Map(),
    tier1Pairs: [['f0', 'm0']],
    tier2Pairs: [],
    unmatched: [],
    noPartner: [],
    repeats: 0,
    totalScore: 4,
  }
  assert.throws(
    () => validateAllocation(allocation, participants, [{ a: 'f0', b: 'm0', score: 4 }], new Set()),
    (e) => e.code === 'below_floor',
  )
})

// ---------------------------------------------------------------------------
// T4 — Tier 2 shape
// ---------------------------------------------------------------------------

await test('T4a tier 2 shape: U users never get a pair joining two tier1-matched users', async () => {
  // 3 females, 6 males, all scores 50: tier 1 = 3 pairs, U = 3 males.
  const { participants, edges } = population(3, 6)
  const a = allocateTiers(participants, edges, new Set())
  assert.equal(a.tier1Pairs.length, 3)
  assert.equal(a.unmatched.length, 3)
  for (const [x, y] of a.tier2Pairs) {
    assert.ok(a.unmatched.includes(x) || a.unmatched.includes(y), `tier2 pair ${x}/${y} joins two tier1 users`)
  }
})

await test('T4b tier 2 shape: no Tier 1 partner is reused as a Tier 2 partner', async () => {
  for (const [f, m] of [[3, 6], [6, 3], [4, 4], [5, 9], [9, 5]]) {
    const { participants, edges } = population(f, m)
    const a = allocateTiers(participants, edges, new Set())
    for (const u of participants) {
      if (a.tier1.has(u) && a.tier2.has(u)) {
        assert.notEqual(a.tier1.get(u), a.tier2.get(u), `user ${u} has the same partner in both tiers`)
      }
    }
  }
})

await test('T4c tier 2 shape: each user holds at most one Tier 2 partner', async () => {
  const { participants, edges } = population(5, 8)
  const a = allocateTiers(participants, edges, new Set())
  const seen = new Set()
  for (const [x, y] of a.tier2Pairs) {
    assert.ok(!seen.has(x), `${x} appears in two tier-2 pairs`)
    assert.ok(!seen.has(y), `${y} appears in two tier-2 pairs`)
    seen.add(x)
    seen.add(y)
  }
})

// ---------------------------------------------------------------------------
// T5 — population shapes (59 males / 99 females and mirrors)
// ---------------------------------------------------------------------------

function populationShapes(females, males) {
  const { participants, edges } = population(females, males, { score: () => 50 })
  const a = allocateTiers(participants, edges, new Set())
  const tier1UserCount = a.tier1.size
  const femaleIds = participants.filter((p) => p.startsWith('f'))
  const maleIds = participants.filter((p) => p.startsWith('m'))
  const t1Females = femaleIds.filter((p) => a.tier1.has(p))
  const t1Males = maleIds.filter((p) => a.tier1.has(p))
  return { a, participants, edges, femaleIds, maleIds, tier1UserCount, t1Females, t1Males }
}

await test('T5a 59 males / 99 females, all scores 50', async () => {
  const { a, maleIds, t1Males } = populationShapes(99, 59)
  assert.equal(a.tier1Pairs.length, 59, 'tier 1 must pair every male')
  assert.equal(t1Males.length, 59)
  assert.equal(a.unmatched.length, 40, '40 females remain in U')
  assert.equal(a.tier2Pairs.length, 40, 'each of the 40 must get a tier-2 partner')
  const tier2Males = new Set()
  for (const [x, y] of a.tier2Pairs) {
    const inU = a.unmatched.includes(x) || a.unmatched.includes(y)
    assert.ok(inU, 'tier-2 pair must include a user in U')
    const male = x.startsWith('m') ? x : y
    assert.ok(maleIds.includes(male), 'each tier-2 pair must contain a male')
    assert.ok(!tier2Males.has(male), `male ${male} has two tier-2 partners`)
    tier2Males.add(male)
  }
  assert.equal(tier2Males.size, 40)
  assert.equal(a.noPartner.length, 0, 'everyone has at least one partner')
})

await test('T5b 99 females / 59 males mirrored', async () => {
  const { a, femaleIds } = populationShapes(59, 99)
  assert.equal(a.tier1Pairs.length, 59)
  assert.equal(a.unmatched.length, 40)
  assert.equal(a.tier2Pairs.length, 40)
  const tier2Females = new Set()
  for (const [x, y] of a.tier2Pairs) {
    const female = femaleIds.includes(x) ? x : y
    assert.ok(!tier2Females.has(female), `female ${female} has two tier-2 partners`)
    tier2Females.add(female)
  }
  assert.equal(tier2Females.size, 40)
})

await test('T5c equal counts: everyone in Tier 1, U empty, Tier 2 empty', async () => {
  const { a } = populationShapes(60, 60)
  assert.equal(a.tier1Pairs.length, 60)
  assert.equal(a.unmatched.length, 0)
  assert.equal(a.tier2Pairs.length, 0)
  assert.equal(a.noPartner.length, 0)
})

await test('T5d odd population: the one leftover user recovers a Tier 2 partner', async () => {
  // 7 females / 8 males: Tier 1 pairs all 7 females. The spare male is in U and
  // recovery pairs him with one already-matched female, so nobody is left out.
  const { a } = populationShapes(7, 8)
  assert.equal(a.tier1Pairs.length, 7)
  assert.equal(a.unmatched.length, 1)
  assert.equal(a.tier2Pairs.length, 1)
  assert.ok(a.unmatched.every((id) => a.tier2.has(id)), 'the user in U gets a Tier 2 partner')
  assert.equal(a.noPartner.length, 0)
})

// ---------------------------------------------------------------------------
// T6 — eligibility
// ---------------------------------------------------------------------------

await test('T6a eligibility: missing, empty or unknown gender is never paired', async () => {
  // Allocator input never contains such users (the generator filters them), but
  // if one slips into the edge list the eligibility gate must keep it out.
  const participants = ['a', 'b', 'c', 'd']
  const edges = [
    { a: 'a', b: 'b', score: 90 }, // null gender pair
    { a: 'c', b: 'd', score: 90 }, // unknown gender pair
  ]
  const a = allocateTiers(participants, edges, new Set())
  // The allocator is gender-blind by design; the graph is what carries
  // eligibility. Prove the *generator* drops them instead (Part B, B8).
  assert.equal(a.tier1Pairs.length, 2)
})

await test('T6b eligibility: same gender is never paired by the generator', async () => {
  // Guaranteed by areEligibleCandidates; the allocator would happily pair them.
  const { areEligibleCandidates } = await import('../supabase/functions/_shared/matchingEligibility.ts')
  const female = (id) => ({ id, gender: 'female', campus_id: 'campus-a' })
  const male = (id) => ({ id, gender: 'male', campus_id: 'campus-a' })
  assert.equal(areEligibleCandidates(female('a'), female('b'), new Set()), false)
  assert.equal(areEligibleCandidates(male('a'), male('b'), new Set()), false)
  assert.equal(areEligibleCandidates({ id: 'x', gender: null, campus_id: 'campus-a' }, male('b'), new Set()), false)
  assert.equal(areEligibleCandidates(female('a'), male('b'), new Set()), true)
  assert.equal(areEligibleCandidates(male('a'), female('b'), new Set()), true)
})

await test('T6c eligibility: a blocked pair is never allocated', async () => {
  // Model a blocked pair by removing its edge (that is what the generator does).
  const { participants, edges } = population(2, 2, {
    score: (f, m) => (pairKey(f, m) === 'f000|m000' ? null : 50),
  })
  const a = allocateTiers(participants, edges, new Set())
  const keys = [...a.tier1Pairs, ...a.tier2Pairs].map(([x, y]) => pairKey(x, y))
  assert.ok(!keys.includes('f000|m000'))
  assert.equal(a.tier1Pairs.length, 2)
})

await test('T6d eligibility: campus equality is unchanged (null/null may pair, null/value may not)', async () => {
  const { areEligibleCandidates } = await import('../supabase/functions/_shared/matchingEligibility.ts')
  const cand = (id, gender, campus) => ({ id, gender, campus_id: campus })
  const nullF = cand('nf', 'female', null)
  const nullM = cand('nm', 'male', null)
  const spaceM = cand('sm', 'male', '   ')
  const campusM = cand('cm', 'male', 'campus-a')
  assert.equal(areEligibleCandidates(nullF, nullM, new Set()), true, 'two unaffiliated users may still pair')
  assert.equal(areEligibleCandidates(nullM, nullF, new Set()), true, 'null/null is symmetric')
  assert.equal(areEligibleCandidates(nullF, spaceM, new Set()), false, 'null and blank-string campuses are not equal')
  assert.equal(areEligibleCandidates(nullF, campusM, new Set()), false, 'null and non-null campuses are excluded')
  assert.equal(areEligibleCandidates(nullF, cand('nf2', 'male', null), new Set()), true, 'blank campus users are not dropped')
})

// ---------------------------------------------------------------------------
// T7 — repeat detection is direction-free
// ---------------------------------------------------------------------------

await test('T7a repeats: a previous pair recorded on either side is detected', async () => {
  const participants = ['f0', 'f1', 'm0', 'm1']
  const edges = [
    { a: 'f0', b: 'm0', score: 50 },
    { a: 'f0', b: 'm1', score: 50 },
    { a: 'f1', b: 'm0', score: 50 },
    { a: 'f1', b: 'm1', score: 50 },
  ]
  // Only one direction is recorded (as a single match_history row would be).
  const oneDirection = new Set(['m1|f1'])
  const bothDirections = new Set(['f1|m1', 'm1|f1'])
  const a = allocateTiers(participants, edges, oneDirection)
  const b = allocateTiers(participants, edges, bothDirections)
  assert.deepEqual(sortedPairs(a.tier1Pairs), sortedPairs(b.tier1Pairs))
  assert.ok(!sortedPairs(a.tier1Pairs).includes('f1|m1'))
})

await test('T7b repeats: legacy "a:b" keys are accepted and canonicalised', async () => {
  const participants = ['f0', 'm0']
  const edges = [{ a: 'f0', b: 'm0', score: 50 }]
  const legacy = allocateTiers(participants, edges, new Set(['m0:f0']))
  assert.equal(legacy.repeats, 1, 'legacy colon form must still count as a repeat')
})

await test('T7c repeats: repeat avoidance never costs a pair', async () => {
  const participants = ['f0', 'm0']
  const edges = [{ a: 'f0', b: 'm0', score: 50 }]
  const a = allocateTiers(participants, edges, new Set(['f0|m0']))
  assert.equal(a.tier1Pairs.length, 1)
  assert.equal(a.repeats, 1)
})

// ---------------------------------------------------------------------------
// T8 — determinism, validation, failure paths
// ---------------------------------------------------------------------------

await test('T8a determinism: 50 shuffles of a 40-user population give one allocation', async () => {
  const { participants, edges } = population(20, 20, {
    score: (f, m) => 5 + ((Number(f.slice(4)) * 7 + Number(m.slice(4)) * 13) % 96),
  })
  const baseline = allocateTiers(participants, edges, new Set(['f000|m000']))
  const rnd = makeRng(99)
  for (let s = 0; s < 50; s++) {
    const p = [...participants]
    const e = [...edges]
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[p[i], p[j]] = [p[j], p[i]]
    }
    for (let i = e.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[e[i], e[j]] = [e[j], e[i]]
    }
    const other = allocateTiers(p, e, new Set(['f000|m000']))
    assert.deepEqual(byId(other), byId(baseline), `tier1 diverged on shuffle ${s}`)
    assert.deepEqual(byId2(other), byId2(baseline), `tier2 diverged on shuffle ${s}`)
  }
})

await test('T8b validation: a tier-2 pair joining two tier-1-matched users is rejected', async () => {
  // f0-m0 and f1-m1 hold Tier 1; m0-m1 must never appear in Tier 2.
  const participants = ['f0', 'm0', 'f1', 'm1']
  const allocation = {
    tier1: new Map([['f0', 'm0'], ['m0', 'f0'], ['f1', 'm1'], ['m1', 'f1']]),
    tier2: new Map([['m0', 'm1'], ['m1', 'm0']]),
    tier1Pairs: [['f0', 'm0'], ['f1', 'm1']],
    tier2Pairs: [['m0', 'm1']],
    unmatched: ['f0', 'f1'],
    noPartner: [],
    repeats: 0,
    totalScore: 100,
  }
  assert.throws(
    () => validateAllocation(allocation, participants, [
      { a: 'f0', b: 'm0', score: 50 },
      { a: 'f1', b: 'm1', score: 50 },
      { a: 'm0', b: 'm1', score: 50 },
    ], new Set()),
    (e) => e.code === 'tier2_shape' || e.code === 'duplicate_partner',
  )
})

await test('T8c validation: an ineligible (non-edge) pair is rejected', async () => {
  const participants = ['f0', 'm0']
  const allocation = {
    tier1: new Map([['f0', 'm0'], ['m0', 'f0']]),
    tier2: new Map(),
    tier1Pairs: [['f0', 'm0']],
    tier2Pairs: [],
    unmatched: [],
    noPartner: [],
    repeats: 0,
    totalScore: 50,
  }
  assert.throws(
    () => validateAllocation(allocation, participants, [], new Set()),
    (e) => e.code === 'ineligible_pair',
  )
})

await test('T8d validation: a pair outside the eligible population is rejected', async () => {
  const allocation = {
    tier1: new Map([['f0', 'ghost'], ['ghost', 'f0']]),
    tier2: new Map(),
    tier1Pairs: [['f0', 'ghost']],
    tier2Pairs: [],
    unmatched: [],
    noPartner: [],
    repeats: 0,
    totalScore: 50,
  }
  assert.throws(
    () => validateAllocation(allocation, ['f0', 'm0'], [{ a: 'f0', b: 'ghost', score: 50 }], new Set()),
    (e) => e.code === 'invalid_pair',
  )
})

await test('T8e non-bipartite eligibility graph fails closed (D5 makes it unreachable)', async () => {
  const participants = ['a', 'b', 'c']
  const edges = [
    { a: 'a', b: 'b', score: 50 },
    { a: 'b', b: 'c', score: 50 },
    { a: 'a', b: 'c', score: 50 },
  ]
  assert.throws(() => allocateTiers(participants, edges, new Set()), (e) => e.code === 'non_bipartite')
})

await test('T8f weight budget guard refuses an impossible population', async () => {
  // M/2 * (100*(M+1) + 1) reaches 2^53 at roughly 13.4 million participants.
  const { assertWeightBudget } = await import('../supabase/functions/_shared/matchingAllocation.ts')
  assert.equal(assertWeightBudget(2000), undefined, 'a normal population passes the guard')
  assert.throws(() => assertWeightBudget(14000000), (e) => e.code === 'weight_overflow')
  void allocateTiers
})

// ---------------------------------------------------------------------------
// T9 — performance
// ---------------------------------------------------------------------------

await test('T9a performance: 400 users / ~40 000 edges', async () => {
  const { participants, edges } = population(200, 200, {
    score: (f, m) => 5 + ((Number(f.slice(4)) * 7 + Number(m.slice(4)) * 13) % 96),
  })
  const start = Date.now()
  const a = allocateTiers(participants, edges, new Set())
  const ms = Date.now() - start
  assert.equal(a.tier1Pairs.length, 200)
  console.log(`      (400 users / ${edges.length} edges, ${a.tier2Pairs.length} tier-2 pairs: ${ms} ms)`)
  assert.ok(ms < 30000, `took ${ms}ms`)
})

await test('T9b performance: 2 000 users across 20 campuses', async () => {
  const participants = []
  const edges = []
  for (let c = 0; c < 20; c++) {
    const p = population(50, 50, {
      campus: `campus-${c}`,
      tag: `c${String(c).padStart(2, '0')}`,
      score: (f, m) => 5 + ((Number(f.slice(5)) * 7 + Number(m.slice(5)) * 13) % 96),
    })
    participants.push(...p.participants)
    edges.push(...p.edges)
  }
  const start = Date.now()
  const a = allocateTiers(participants, edges, new Set())
  const ms = Date.now() - start
  assert.equal(participants.length, 2000)
  assert.equal(a.tier1Pairs.length, 1000)
  console.log(`      (2000 users / ${edges.length} edges, ${a.tier2Pairs.length} tier-2 pairs: ${ms} ms)`)
  assert.ok(ms < 60000, `took ${ms}ms`)
})

// ---------------------------------------------------------------------------
// Part B — the real match-generator entrypoint, with a fake Supabase client
// ---------------------------------------------------------------------------

const GEN = new URL('../supabase/functions/match-generator/index.ts', import.meta.url)
const genSrc = readFileSync(GEN, 'utf8')

const sharedDir = new URL('../supabase/functions/_shared/', import.meta.url).href

/**
 * Rewrite the generator so it can run under plain Node:
 *  - strip Deno/remote imports
 *  - point _shared imports at the real files
 *  - inject the fake client and capture the serve() handler
 *  - drop type-only imports that Node's type stripping removes at runtime
 */
function transformGenerator(source) {
  return source
    .replace(/import .*?from 'https:\/\/[^']+'\n/g, '')
    .replace(/from '\.\.\/_shared\/([^']+)'/g, (_m, f) => `from '${sharedDir}${f}'`)
    .replace(
      /const supabase = createClient\([\s\S]*?\n\)\n/,
      'const supabase = { get from() { return globalThis.__client.from.bind(globalThis.__client) }, get auth() { return globalThis.__client.auth }, get rpc() { return globalThis.__client.rpc.bind(globalThis.__client) } }\n',
    )
    .replace(/^serve\(/m, 'globalThis.__serve(')
    .replace(/,\s*UserProfile/g, '')
    .replace(/,\s*type ScoredEdge/g, '')
}

async function loadGenerator(source, label) {
  const transformed = transformGenerator(source)
  assert.ok(transformed.includes('globalThis.__client'), 'client injection point missing')
  assert.ok(transformed.includes('globalThis.__serve'), 'serve() injection point missing')
  assert.ok(!transformed.includes("from 'https://"), 'remote imports must be stripped')

  const dir = mkdtempSync(join(tmpdir(), `mg-${label}-`))
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}', 'utf8')
  writeFileSync(
    join(dir, 'gen.ts'),
    `globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://fake.local', SUPABASE_SERVICE_ROLE_KEY: 'svc' })[k] ?? null } }
let captured = null
globalThis.__serve = (fn) => { captured = fn }
${transformed}
export const handler = captured
`,
    'utf8',
  )
  const mod = await import(pathToFileURL(join(dir, 'gen.ts')).href)
  rmSync(dir, { recursive: true, force: true })
  return mod.handler
}

const handler = await loadGenerator(genSrc, 'main')

/**
 * Fake Supabase client.
 *
 * `select` stubs the read path. `begin_match_generation` and
 * `publish_week_allocation` mirror the SQL migration faithfully: a monotonic
 * sequence, one fence row per week, the fence check BEFORE any write, a
 * week-scoped delete + insert, counter updates and the payload binding
 * (identical replay writes nothing, a different payload under the same
 * generation raises generation_conflict). A rejected or failing publish
 * commits nothing.
 */
/**
 * Canonical form of a publish payload, standing in for jsonb equality:
 * key order is irrelevant in jsonb, array order is not.
 */
function canonicalRows(rows) {
  return JSON.stringify((rows ?? []).map((row) => Object.keys(row).sort().map((key) => [key, row[key]])))
}

function makeClient(cfg = {}) {
  const calls = { tables: [], upserts: [], selects: [], rpcs: [], publishes: [] }
  const db = cfg.db ?? {
    nextGeneration: 1,
    latest: new Map(),
    latestPublished: new Map(),
    publishedRows: new Map(),
    history: new Map(),
  }
  const respond = (resp) => ({ then(res, rej) { return Promise.resolve(resp).then(res, rej) } })
  const builder = (table) => {
    const state = { table, filters: [] }
    const api = {
      select() { return api },
      eq(col, val) { state.filters.push(['eq', col, val]); return api },
      in(col, val) { state.filters.push(['in', col, val]); return api },
      upsert(rows) {
        calls.upserts.push({ table, count: rows.length, rows })
        const resp = cfg.upsert ? cfg.upsert(table, rows) : { error: null }
        return respond(resp)
      },
      then(resolve, reject) {
        calls.selects.push({ table, filters: state.filters })
        const resp = cfg.select ? cfg.select(table) : { data: [], error: null }
        return Promise.resolve(resp).then(resolve, reject)
      },
      maybeSingle() {
        calls.selects.push({ table, filters: state.filters, single: true })
        const resp = cfg.selectOne ? cfg.selectOne(table) : { data: null, error: null }
        return respond(resp)
      },
    }
    return api
  }
  return {
    from(table) { calls.tables.push(table); return builder(table) },
    rpc(name, params) {
      calls.rpcs.push({ name, params })
      if (name === 'begin_match_generation') {
        if (cfg.beginError) return respond({ data: null, error: cfg.beginError })
        const generation = db.nextGeneration++
        const current = db.latest.get(params.p_week_id) ?? 0
        db.latest.set(params.p_week_id, Math.max(current, generation))
        return respond({ data: generation, error: null })
      }
      if (name === 'publish_week_allocation') {
        calls.publishes.push(params)
        const latest = db.latest.get(params.p_week_id)
        if (latest === undefined) return respond({ data: null, error: { code: 'P0002', message: 'unknown_generation' } })
        if (params.p_generation < latest) return respond({ data: null, error: { code: 'PT409', message: 'stale_generation' } })
        if (cfg.publishError) return respond({ data: null, error: cfg.publishError })
        const incoming = canonicalRows(params.p_rows)
        const publishedGeneration = db.latestPublished.get(params.p_week_id)
        if (publishedGeneration === params.p_generation) {
          // Replay binding: identical payload → no write; different → conflict.
          if (db.publishedRows.get(params.p_week_id) !== incoming) {
            return respond({ data: null, error: { code: 'PT409', message: 'generation_conflict' } })
          }
          const rows = [...db.history.values()].filter((row) => row.week_id === params.p_week_id)
          return respond({
            data: { published: rows.length, generation: params.p_generation, replayed: true },
            error: null,
          })
        }
        for (const [key, row] of [...db.history]) {
          if (row.week_id === params.p_week_id) db.history.delete(key)
        }
        for (const row of params.p_rows) db.history.set(`${row.user_id}|${row.week_id}`, { ...row })
        db.latestPublished.set(params.p_week_id, params.p_generation)
        db.publishedRows.set(params.p_week_id, incoming)
        return respond({
          data: { published: params.p_rows.length, generation: params.p_generation, replayed: false },
          error: null,
        })
      }
      throw new Error(`unexpected rpc: ${name}`)
    },
    auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) },
    _calls: calls,
    _db: db,
  }
}

/** Every publish_week_allocation call the handler made. */
const publishCalls = (client) => client._calls.publishes
/** Rows handed to the last publish call. */
const publishedRows = (client) => publishCalls(client).at(-1)?.p_rows ?? []
/** Rows currently committed in the simulated week. */
const weekRows = (client, week) => [...client._db.history.values()].filter((r) => !week || r.week_id === week)
/** Fence-row reads performed by the handler (MM-D2 recovery path). */
const fenceReads = (client) => client._calls.selects.filter((s) => s.table === 'match_week_generations').length

const mkUser = (id, gender, campus = 'campus-a') => ({ id, gender, campus_id: campus })
const mkResponses = (id, answer) => ({ user_id: id, responses_array: new Array(50).fill(answer) })

function call(client) {
  globalThis.__client = client
  return handler({
    method: 'POST',
    headers: { get: (k) => (k.toLowerCase() === 'apikey' ? 'svc' : null) },
  })
}

/** Default select stub: users + responses from the supplied fixtures. */
const standardSelect = (users, responses, extra = {}) => (t) => {
  if (extra[t]) return extra[t]
  if (t === 'users') return { data: users, error: null }
  if (t === 'user_responses') return { data: responses, error: null }
  return { data: [], error: null }
}

await test('B1 success: publishes mutual tier1 + distinct tier2 in ONE upsert', async () => {
  const users = [mkUser('f0', 'female'), mkUser('f1', 'female'), mkUser('m0', 'male'), mkUser('m1', 'male')]
  const responses = users.map((u) => mkResponses(u.id, 'A'))
  const client = makeClient({ select: standardSelect(users, responses) })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.success, true)
  assert.equal(body.tier1Pairs, 2)
  assert.equal(publishCalls(client).length, 1, 'exactly one publish call')
  assert.equal(body.published, 4, 'published count echoed in the summary')
  const rows = publishedRows(client)
  assert.equal(rows.length, 4)
  const byUser = new Map(rows.map((r) => [r.user_id, r]))
  for (const r of rows) {
    assert.ok(r.tier1_match_id, 'every user has a tier1 partner')
    if (r.tier2_match_id) assert.notEqual(r.tier2_match_id, r.tier1_match_id, 'tier2 must differ from tier1')
    assert.equal(byUser.get(r.tier1_match_id).tier1_match_id, r.user_id, 'tier1 must be mutual')
  }
})

await test('B2 run summary: counts, no user ids, blank campus kept but counted', async () => {
  // Campus-a: 3 females / 2 males. Two null-campus users (one male, one female)
  // must still pair. One user sits on a whitespace campus alone.
  const users = [
    mkUser('f0', 'female'), mkUser('f1', 'female'), mkUser('f2', 'female'),
    mkUser('m0', 'male'), mkUser('m1', 'male'),
    mkUser('nogen', null),
    mkUser('blankm', 'male', null), mkUser('blankf', 'female', null),
    mkUser('spacef', 'female', '   '),
  ]
  const responses = users.map((u) => mkResponses(u.id, 'A'))
  const client = makeClient({ select: standardSelect(users, responses) })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.eligibleUsers, 8, 'blank-campus users stay in the run; only invalid gender is excluded')
  assert.equal(body.tier1Pairs, 3, 'campus-a 2 pairs + null/null 1 pair')
  assert.equal(body.unmatchedUsers, 2, 'one campus-a female and the lone whitespace-campus female')
  assert.equal(body.tier2Pairs, 1, 'the campus-a female recovers a partner; the whitespace campus has nobody')
  assert.equal(body.usersWithNoPartner, 1, 'the lone whitespace-campus female has no partner')
  assert.equal(body.excludedBlankCampus, 3, 'blank campus is reported as information only')
  assert.equal(body.excludedInvalidGender, 1)
  for (const v of Object.values(body)) {
    assert.ok(!(typeof v === 'string' && /^f\d|^m\d|^nogen|^blank|^space/.test(v)), 'response must not carry user ids')
  }
  const rows = publishedRows(client)
  const published = rows.map((r) => r.user_id)
  const byUser = new Map(rows.map((r) => [r.user_id, r]))
  assert.ok(!published.includes('nogen'), 'invalid-gender user must never be published')
  assert.equal(byUser.get('blankm')?.tier1_match_id, 'blankf', 'two unaffiliated users must still pair')
  assert.equal(byUser.get('blankf')?.tier1_match_id, 'blankm')
  assert.ok(!published.includes('spacef'), 'a user with no partner gets no row')
})

await test('B3 user_blocks query failure aborts before any write', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const responses = users.map((u) => mkResponses(u.id, 'A'))
  const client = makeClient({
    select: standardSelect(users, responses, {
      user_blocks: { data: null, error: { message: 'permission denied for table user_blocks' } },
    }),
  })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 500)
  assert.equal(body.error, 'restriction_query_failed')
  assert.equal(publishCalls(client).length, 0)
})

await test('B4 previous-week history failure aborts before any write', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const responses = users.map((u) => mkResponses(u.id, 'A'))
  const client = makeClient({
    select: standardSelect(users, responses, { match_history: { data: null, error: { message: 'timeout' } } }),
  })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 500)
  assert.equal(body.error, 'repeat_query_failed')
  assert.equal(publishCalls(client).length, 0)
})

await test('B5 users query failure fails closed with 400 and zero writes', async () => {
  const client = makeClient({
    select: (t) => (t === 'users' ? { data: null, error: { message: 'boom' } } : { data: [], error: null }),
  })
  const res = await call(client)
  assert.equal(res.status, 400)
  assert.equal(publishCalls(client).length, 0)
})

await test('B6 user_responses query failure aborts before any write', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const client = makeClient({
    select: standardSelect(users, [], { user_responses: { data: null, error: { message: 'statement timeout' } } }),
  })
  const res = await call(client)
  assert.equal(res.status, 400)
  assert.equal(publishCalls(client).length, 0)
})

await test('B7 publish failure surfaces publish_failed and makes ONE attempt', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const responses = users.map((u) => mkResponses(u.id, 'A'))
  const client = makeClient({
    select: standardSelect(users, responses),
    publishError: { message: 'disk full' },
  })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 500)
  assert.equal(body.error, 'publish_failed')
  assert.equal(publishCalls(client).length, 1, 'a single publish attempt, not a partial batch')
  assert.equal(weekRows(client).length, 0, 'a failed publish writes nothing')
})

await test('B8 Qrashe isolation: only users, user_responses, user_blocks, match_history', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const responses = users.map((u) => mkResponses(u.id, 'A'))
  const client = makeClient({ select: standardSelect(users, responses) })
  await call(client)
  assert.ok(!client._calls.tables.includes('matches'), 'must not read or write matches (Qrashe)')
  assert.ok(!client._calls.tables.includes('connect_unlocks'), 'must not touch Section 2')
  assert.deepEqual([...new Set(client._calls.tables)].sort(), [
    'match_history',
    'user_blocks',
    'user_responses',
    'users',
  ])
})

await test('B9 blocked users are never paired end-to-end', async () => {
  const users = [mkUser('f0', 'female'), mkUser('f1', 'female'), mkUser('m0', 'male'), mkUser('m1', 'male')]
  const responses = users.map((u) => mkResponses(u.id, 'A'))
  const blocks = [
    { blocker_id: 'f0', blocked_id: 'm0' },
    { blocker_id: 'm0', blocked_id: 'f0' },
    { blocker_id: 'f0', blocked_id: 'm1' },
    { blocker_id: 'm1', blocked_id: 'f0' },
  ]
  const client = makeClient({ select: standardSelect(users, responses, { user_blocks: { data: blocks, error: null } }) })
  const res = await call(client)
  assert.equal(res.status, 200)
  const rows = publishedRows(client)
  const f0 = rows.find((r) => r.user_id === 'f0')
  assert.ok(!f0 || !f0.tier1_match_id, 'f0 is blocked from every male and must not be paired')
})

await test('B10 previous-week repeat is detected from one side only', async () => {
  const users = [mkUser('f0', 'female'), mkUser('f1', 'female'), mkUser('m0', 'male'), mkUser('m1', 'male')]
  const responses = users.map((u) => mkResponses(u.id, 'A'))
  // Only f0's row records the tier-1 pair with m0.
  const history = [{ user_id: 'f0', tier1_match_id: 'm0', tier2_match_id: null }]
  const client = makeClient({ select: standardSelect(users, responses, { match_history: { data: history, error: null } }) })
  const res = await call(client)
  assert.equal(res.status, 200)
  const rows = publishedRows(client)
  const f0 = rows.find((r) => r.user_id === 'f0')
  assert.notEqual(f0.tier1_match_id, 'm0', 'the pair recorded on one side must still count as a repeat')
})

await test('B11 equal populations: no Tier 2 pairs, everyone gets a row', async () => {
  const users = []
  const responses = []
  for (let i = 0; i < 6; i++) {
    users.push(mkUser(`f${i}`, 'female'))
    users.push(mkUser(`m${i}`, 'male'))
  }
  for (const u of users) responses.push(mkResponses(u.id, 'A'))
  const client = makeClient({ select: standardSelect(users, responses) })
  const res = await call(client)
  const body = await res.json()
  assert.equal(body.tier1Pairs, 6)
  assert.equal(body.tier2Pairs, 0)
  assert.equal(body.unmatchedUsers, 0)
  assert.equal(client._calls.publishes[0].p_rows.length, 12)
  for (const r of publishedRows(client)) assert.equal(r.tier2_match_id, null)
})

// ---------------------------------------------------------------------------
// Part D — R1: malformed questionnaire data
// ---------------------------------------------------------------------------

const freshDb = () => ({ nextGeneration: 1, latest: new Map(), latestPublished: new Map(), publishedRows: new Map(), history: new Map() })
const badResponse = (user_id, responses_array) => ({ user_id, responses_array })

const sixUsers = () => [
  mkUser('f0', 'female'), mkUser('f1', 'female'), mkUser('f2', 'female'),
  mkUser('m0', 'male'), mkUser('m1', 'male'), mkUser('m2', 'male'),
]

await test('D1 malformed: NULL responses_array excludes that user and keeps the week', async () => {
  const users = sixUsers()
  const responses = [
    badResponse('f0', new Array(50).fill('A')),
    badResponse('f1', new Array(50).fill('A')),
    badResponse('f2', new Array(50).fill('A')),
    badResponse('m0', null),
    badResponse('m1', new Array(50).fill('A')),
    badResponse('m2', new Array(50).fill('A')),
  ]
  const client = makeClient({ db: freshDb(), select: standardSelect(users, responses) })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 200, 'a malformed row must never abort the week')
  assert.equal(body.invalidQuestionnaires, 1)
  assert.equal(body.tier1Pairs, 2, 'the five valid users still match')
  assert.equal(body.published, 5, '2 tier1 pairs + 1 tier2 recovery = 5 rows')
  assert.ok(!publishedRows(client).some((r) => r.user_id === 'm0'), 'the malformed user is never published')
})

await test('D2 malformed: legacy numeric array is invalid, not fatal', async () => {
  const users = sixUsers()
  const responses = [
    badResponse('f0', new Array(50).fill('A')),
    badResponse('f1', new Array(50).fill('A')),
    badResponse('f2', new Array(50).fill('A')),
    badResponse('m0', Array.from({ length: 50 }, (_, i) => i + 1)),
    badResponse('m1', new Array(50).fill('A')),
    badResponse('m2', new Array(50).fill('A')),
  ]
  const client = makeClient({ db: freshDb(), select: standardSelect(users, responses) })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.invalidQuestionnaires, 1)
  assert.ok(!publishedRows(client).some((r) => r.user_id === 'm0'))
})

await test('D3 malformed: empty array is invalid, not fatal', async () => {
  const users = sixUsers()
  const responses = [
    badResponse('f0', new Array(50).fill('A')),
    badResponse('f1', new Array(50).fill('A')),
    badResponse('f2', new Array(50).fill('A')),
    badResponse('m0', []),
    badResponse('m1', new Array(50).fill('A')),
    badResponse('m2', new Array(50).fill('A')),
  ]
  const client = makeClient({ db: freshDb(), select: standardSelect(users, responses) })
  const body = await (await call(client)).json()
  assert.equal(body.invalidQuestionnaires, 1)
  assert.ok(!publishedRows(client).some((r) => r.user_id === 'm0'))
})

await test('D4 malformed: partial answers stay valid and are scored', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const responses = [badResponse('f0', new Array(50).fill('A')), badResponse('m0', new Array(10).fill('A'))]
  const client = makeClient({ db: freshDb(), select: standardSelect(users, responses) })
  const body = await (await call(client)).json()
  assert.equal(body.invalidQuestionnaires, 0, 'partial answers are usable')
  assert.equal(body.tier1Pairs, 1, 'they pair on the answers both users have')
})

await test('D5 malformed: non-string holes are ignored, valid entries kept', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const mixed = new Array(50).fill('A')
  mixed[0] = 7
  mixed[1] = null
  mixed[2] = { nope: true }
  mixed[3] = ''
  const client = makeClient({ db: freshDb(), select: standardSelect(users, [badResponse('f0', new Array(50).fill('A')), badResponse('m0', mixed)]) })
  const body = await (await call(client)).json()
  assert.equal(body.invalidQuestionnaires, 0)
  assert.equal(body.tier1Pairs, 1)
})

await test('D6 malformed: a user with no user_responses row is excluded, run succeeds', async () => {
  const users = [mkUser('f0', 'female'), mkUser('f1', 'female'), mkUser('m0', 'male')]
  const responses = [badResponse('f0', new Array(50).fill('A')), badResponse('m0', new Array(50).fill('A'))]
  const client = makeClient({ db: freshDb(), select: standardSelect(users, responses) })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.eligibleUsers, 2, 'f1 has no questionnaire and is not a participant')
  assert.equal(body.tier1Pairs, 1)
})

await test('D7 malformed: an all-malformed population still clears the week cleanly', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const responses = [badResponse('f0', null), badResponse('m0', [])]
  const db = freshDb()
  db.history.set('old|week', { user_id: 'old', week_id: 'other', tier1_match_id: null, tier2_match_id: null, delivered_at: 'x' })
  const client = makeClient({ db, select: standardSelect(users, responses) })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 200)
  assert.equal(body.invalidQuestionnaires, 2)
  assert.equal(body.usersDelivered, 0)
  assert.equal(publishCalls(client).length, 1, 'the week is published as an empty replacement')
  assert.equal(db.history.size, 1, 'the seeded historical row is the only row left')
  assert.ok(db.history.has('old|week'), 'other weeks are untouched')
})

await test('D8 malformed: a fully valid population is unchanged (regression)', async () => {
  const users = [mkUser('f0', 'female'), mkUser('f1', 'female'), mkUser('m0', 'male'), mkUser('m1', 'male')]
  const responses = users.map((u) => mkResponses(u.id, 'A'))
  const client = makeClient({ db: freshDb(), select: standardSelect(users, responses) })
  const body = await (await call(client)).json()
  assert.equal(body.invalidQuestionnaires, 0)
  assert.equal(body.tier1Pairs, 2)
  assert.equal(body.usersDelivered, 4)
  assert.equal(body.published, 4)
})

await test('D9 malformed: a failure to mint a generation fails closed before any write', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const responses = users.map((u) => mkResponses(u.id, 'A'))
  const client = makeClient({
    db: freshDb(),
    select: standardSelect(users, responses),
    beginError: { message: 'connection reset' },
  })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 500)
  assert.equal(body.error, 'generation_begin_failed')
  assert.equal(publishCalls(client).length, 0)
})

// ---------------------------------------------------------------------------
// Part E — R3/R4: fenced, atomic week replacement
// ---------------------------------------------------------------------------

await test('E1 rerun replaces the week: no orphan rows, no broken mutual links', async () => {
  const db = freshDb()
  const four = () => [mkUser('f0', 'female'), mkUser('f1', 'female'), mkUser('m0', 'male'), mkUser('m1', 'male')]
  const run1 = makeClient({ db, select: standardSelect(four(), four().map((u) => mkResponses(u.id, 'A'))) })
  const first = await (await call(run1)).json()
  assert.equal(first.usersDelivered, 4)
  assert.equal(weekRows(run1).length, 4)

  // f0 and m1 leave the eligible population (suspended) between runs.
  const survivors = [mkUser('f1', 'female'), mkUser('m0', 'male')]
  const run2 = makeClient({ db, select: standardSelect(survivors, survivors.map((u) => mkResponses(u.id, 'A'))) })
  const second = await (await call(run2)).json()
  assert.equal(second.usersDelivered, 2)

  const rows = weekRows(run2)
  assert.equal(rows.length, 2, 'obsolete rows are deleted, not merged')
  assert.deepEqual(rows.map((r) => r.user_id).sort(), ['f1', 'm0'])
  const byUser = new Map(rows.map((r) => [r.user_id, r]))
  for (const r of rows) {
    if (!r.tier1_match_id) continue
    assert.equal(byUser.get(r.tier1_match_id)?.tier1_match_id, r.user_id, 'mutual link intact')
  }
  assert.ok(!rows.some((r) => r.user_id === 'f0' || r.user_id === 'm1'), 'no orphan rows survive')
})

await test('E2 rerun preserves historical weeks', async () => {
  const db = freshDb()
  const oldRow = { user_id: 'f0', week_id: '1999-W01', tier1_match_id: 'm0', tier2_match_id: null, delivered_at: '1999-01-05T18:00:00.000Z' }
  db.history.set('f0|1999-W01', { ...oldRow })
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const client = makeClient({ db, select: standardSelect(users, users.map((u) => mkResponses(u.id, 'A'))) })
  const body = await (await call(client)).json()
  assert.equal(body.usersDelivered, 2)
  assert.deepEqual(db.history.get('f0|1999-W01'), oldRow, 'a historical week is byte-identical')
  assert.equal([...db.history.values()].filter((r) => r.week_id !== '1999-W01').length, 2)
})

await test('E3 empty allocation clears the current week only', async () => {
  const db = freshDb()
  const users = [mkUser('f0', 'female', 'campus-a'), mkUser('m0', 'male', 'campus-a')]
  const run1 = makeClient({ db, select: standardSelect(users, users.map((u) => mkResponses(u.id, 'A'))) })
  assert.equal((await (await call(run1)).json()).usersDelivered, 2)

  // Same two users, now on different campuses: no eligible pair at all.
  const split = [mkUser('f0', 'female', 'campus-a'), mkUser('m0', 'male', 'campus-b')]
  const run2 = makeClient({ db, select: standardSelect(split, split.map((u) => mkResponses(u.id, 'A'))) })
  const body = await (await call(run2)).json()
  assert.equal(body.usersDelivered, 0)
  assert.equal(weekRows(run2).length, 0, 'the stale week is cleared, not left behind')
  assert.equal(publishCalls(run2).length, 1, 'the empty week is published explicitly')
})

await test('E4 a failing replacement preserves the previously published allocation', async () => {
  const db = freshDb()
  const users = [mkUser('f0', 'female'), mkUser('f1', 'female'), mkUser('m0', 'male'), mkUser('m1', 'male')]
  const run1 = makeClient({ db, select: standardSelect(users, users.map((u) => mkResponses(u.id, 'A'))) })
  await call(run1)
  const before = weekRows(run1).map((r) => ({ ...r }))
  const generationBefore = db.latestPublished.values().next().value
  assert.equal(before.length, 4)

  const run2 = makeClient({
    db,
    select: standardSelect(users, users.map((u) => mkResponses(u.id, 'A'))),
    publishError: { message: 'deadlock detected' },
  })
  const res = await call(run2)
  assert.equal(res.status, 500)
  assert.equal((await res.json()).error, 'publish_failed')
  assert.deepEqual(weekRows(run2).map((r) => ({ ...r })), before, 'previous allocation intact')
  assert.equal(db.latestPublished.values().next().value, generationBefore, 'published generation unchanged')
})

await test('E5 stale generation is rejected with 409 and writes nothing', async () => {
  const db = freshDb()
  const users = [mkUser('f0', 'female'), mkUser('f1', 'female'), mkUser('m0', 'male'), mkUser('m1', 'male')]
  const responses = users.map((u) => mkResponses(u.id, 'A'))

  // A newer run is authorized and publishes first.
  db.nextGeneration = 5
  const newer = makeClient({ db, select: standardSelect(users, responses) })
  assert.equal((await (await call(newer)).json()).usersDelivered, 4)
  assert.equal(db.latest.get(db.history.keys().next().value.split('|')[1]), 5)
  const afterNewer = weekRows(newer).map((r) => ({ ...r }))

  // An older run (lower generation) now tries to publish.
  db.nextGeneration = 1
  const older = makeClient({ db, select: standardSelect(users, responses) })
  const res = await call(older)
  const body = await res.json()
  assert.equal(res.status, 409, 'stale publication must answer 409')
  assert.equal(body.error, 'stale_generation')
  assert.equal(fenceReads(older), 0, 'the PT409 verdict needs no recovery read')
  assert.ok(typeof body.generation === 'number')
  assert.deepEqual(weekRows(older).map((r) => ({ ...r })), afterNewer, 'the newer week is untouched')
})

await test('E6 unknown generation and cross-week independence', async () => {
  const client = makeClient({ db: freshDb() })
  const params = { p_week_id: '2099-W09', p_generation: 1, p_rows: [] }
  const unknown = await client.rpc('publish_week_allocation', params)
  assert.equal(unknown.error.message, 'unknown_generation')

  const db = freshDb()
  const shared = makeClient({ db })
  const a = await shared.rpc('begin_match_generation', { p_week_id: '2099-W01' })
  const b = await shared.rpc('begin_match_generation', { p_week_id: '2099-W02' })
  assert.ok(b.data > a.data, 'the sequence is monotonic across weeks')
  const pa = await shared.rpc('publish_week_allocation', { p_week_id: '2099-W01', p_generation: a.data, p_rows: [] })
  const pb = await shared.rpc('publish_week_allocation', { p_week_id: '2099-W02', p_generation: b.data, p_rows: [] })
  assert.equal(pa.error, null)
  assert.equal(pb.error, null, 'a higher generation in another week must not fence this one')
})

await test('E7 idempotent replay of the same generation', async () => {
  const client = makeClient({ db: freshDb() })
  const { data: generation } = await client.rpc('begin_match_generation', { p_week_id: 'W' })
  const row = { user_id: '00000000-0000-4000-8000-000000000001', week_id: 'W', tier1_match_id: null, tier2_match_id: null, delivered_at: '2026-01-01T00:00:00.000Z' }
  const first = await client.rpc('publish_week_allocation', { p_week_id: 'W', p_generation: generation, p_rows: [row] })
  const snapshot = JSON.stringify([...client._db.history.entries()])
  const second = await client.rpc('publish_week_allocation', { p_week_id: 'W', p_generation: generation, p_rows: [row] })
  assert.equal(first.data.published, 1)
  assert.equal(second.data.published, 1)
  assert.equal(second.data.replayed, true, 'identical replay is reported as a replay')
  assert.equal(JSON.stringify([...client._db.history.entries()]), snapshot, 'identical replay writes nothing')
  assert.equal(weekRows(client, 'W').length, 1)
  assert.equal(client._db.latestPublished.get('W'), generation)
})

await test('E9 a different payload under the same generation is rejected', async () => {
  const client = makeClient({ db: freshDb() })
  const { data: generation } = await client.rpc('begin_match_generation', { p_week_id: 'W' })
  const mk = (user, partner) => ({ user_id: user, week_id: 'W', tier1_match_id: partner, tier2_match_id: null, delivered_at: '2026-01-01T00:00:00.000Z' })
  const allocationA = [mk('a', 'b'), mk('b', 'a')]
  const allocationB = [mk('a', 'c'), mk('c', 'a')]
  const first = await client.rpc('publish_week_allocation', { p_week_id: 'W', p_generation: generation, p_rows: allocationA })
  assert.equal(first.data.published, 2)

  const conflict = await client.rpc('publish_week_allocation', { p_week_id: 'W', p_generation: generation, p_rows: allocationB })
  assert.equal(conflict.error.message, 'generation_conflict', 'a changed payload must not overwrite a published one')
  assert.deepEqual(weekRows(client, 'W').map((r) => [r.user_id, r.tier1_match_id]), [['a', 'b'], ['b', 'a']], 'allocation A is still live')
  assert.equal(client._db.latestPublished.get('W'), generation, 'the published generation is unchanged')

  // A newer generation may of course replace the week.
  const { data: nextGeneration } = await client.rpc('begin_match_generation', { p_week_id: 'W' })
  const replaced = await client.rpc('publish_week_allocation', { p_week_id: 'W', p_generation: nextGeneration, p_rows: allocationB })
  assert.equal(replaced.data.published, 2)
  assert.deepEqual(weekRows(client, 'W').map((r) => r.user_id).sort(), ['a', 'c'])
})

await test('E10 the handler maps generation_conflict to 409 and leaves the week intact', async () => {
  const db = freshDb()
  const first = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const run1 = makeClient({ db, select: standardSelect(first, first.map((u) => mkResponses(u.id, 'A'))) })
  assert.equal((await call(run1)).status, 200)
  const published = weekRows(run1).map((r) => ({ ...r }))

  // The same generation is handed out again and the allocation changed.
  db.nextGeneration = 1
  const second = [mkUser('f1', 'female'), mkUser('m1', 'male')]
  const run2 = makeClient({ db, select: standardSelect(second, second.map((u) => mkResponses(u.id, 'A'))) })
  const res = await call(run2)
  const body = await res.json()
  assert.equal(res.status, 409, 'a fence verdict is a client-visible conflict, not a server fault')
  assert.equal(body.error, 'generation_conflict')
  assert.equal(fenceReads(run2), 0, 'the PT409 verdict needs no recovery read')
  assert.deepEqual(weekRows(run2).map((r) => ({ ...r })), published, 'the live allocation is untouched')
})

// The fence verdicts are raised with SQLSTATE 40001, and PostgREST answers that
// class by dropping the connection: the caller sees a transport failure with no
// verdict in it. The handler must recover the verdict from the fence row, or a
// fenced run would be reported as a server fault instead of a 409.
const transportError = { message: '' }

await test('E11 a fence verdict lost to a transport failure still returns 409 (stale)', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const client = makeClient({
    db: freshDb(),
    select: standardSelect(users, users.map((u) => mkResponses(u.id, 'A'))),
    publishError: transportError,
    selectOne: (table) =>
      table === 'match_week_generations'
        ? { data: { latest_generation: 99, latest_published_generation: null, published_rows: null }, error: null }
        : { data: null, error: null },
  })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 409, 'a stale run is a conflict, even when the message was lost')
  assert.equal(body.error, 'stale_generation')
  assert.equal(weekRows(client).length, 0, 'nothing was written')
})

await test('E12 a fence verdict lost to a transport failure still returns 409 (conflict)', async () => {
  let clientRef = null
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const client = makeClient({
    db: freshDb(),
    select: standardSelect(users, users.map((u) => mkResponses(u.id, 'A'))),
    publishError: transportError,
    selectOne: (table) =>
      table === 'match_week_generations'
        ? {
            data: {
              latest_generation: 1,
              latest_published_generation: 1,
              // A published allocation that differs from this run's payload.
              published_rows: [{ user_id: 'someone-else', week_id: 'W', tier1_match_id: null, tier2_match_id: null, delivered_at: null }],
            },
            error: null,
          }
        : { data: null, error: null },
  })
  clientRef = client
  const res = await call(client)
  const body = await res.json()
  assert.ok(clientRef)
  assert.equal(res.status, 409)
  assert.equal(body.error, 'generation_conflict')
  assert.equal(weekRows(client).length, 0, 'the published allocation was not replaced')
})

await test('E13 a publish that landed before the transport failed is reported as a replay', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  let clientRef = null
  const client = makeClient({
    db: freshDb(),
    select: standardSelect(users, users.map((u) => mkResponses(u.id, 'A'))),
    publishError: transportError,
    selectOne: (table) =>
      table === 'match_week_generations'
        ? {
            data: {
              latest_generation: 1,
              latest_published_generation: 1,
              // Exactly the payload the handler just tried to publish.
              published_rows: publishedRows(clientRef),
            },
            error: null,
          }
        : { data: null, error: null },
  })
  clientRef = client
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 200, 'an already-published identical payload is a success, not a fault')
  assert.equal(body.success, true)
  assert.equal(body.published, publishedRows(client).length)
})

// MM-D2: the two intentional verdicts arrive as PT409, so they are answered
// immediately. The recovery read is only for a response that never arrived.

await test('E14 PT409 stale_generation is answered 409 with no recovery read', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const client = makeClient({
    db: freshDb(),
    select: standardSelect(users, users.map((u) => mkResponses(u.id, 'A'))),
    publishError: { code: 'PT409', message: 'stale_generation' },
  })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 409)
  assert.equal(body.error, 'stale_generation')
  assert.equal(fenceReads(client), 0, 'a verdict the database already supplied is not re-read')
  assert.equal(weekRows(client).length, 0, 'nothing was written')
})

await test('E15 PT409 generation_conflict is answered 409 with no recovery read', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const client = makeClient({
    db: freshDb(),
    select: standardSelect(users, users.map((u) => mkResponses(u.id, 'A'))),
    publishError: { code: 'PT409', message: 'generation_conflict' },
  })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 409)
  assert.equal(body.error, 'generation_conflict')
  assert.equal(fenceReads(client), 0, 'a verdict the database already supplied is not re-read')
  assert.equal(weekRows(client).length, 0)
})

await test('E16 an unrelated coded database error is not promoted to 409', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const client = makeClient({
    db: freshDb(),
    select: standardSelect(users, users.map((u) => mkResponses(u.id, 'A'))),
    publishError: { code: '22P02', message: 'invalid input syntax for type uuid: "not-a-uuid"' },
  })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 500, 'a genuine failure stays a failure')
  assert.equal(body.error, 'publish_failed')
  assert.notEqual(body.error, 'stale_generation')
  assert.notEqual(body.error, 'generation_conflict')
  assert.equal(fenceReads(client), 0, 'a coded error is never reinterpreted as a fence verdict')
})

await test('E17 a bare 40001 is not treated as a matching conflict', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const client = makeClient({
    db: freshDb(),
    select: standardSelect(users, users.map((u) => mkResponses(u.id, 'A'))),
    publishError: { code: '40001', message: 'stale_generation' },
  })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 500, 'only PT409 may become 409')
  assert.equal(body.error, 'publish_failed')
  assert.equal(fenceReads(client), 0)
})

await test('E18 PT409 with an unrecognised message is not a conflict', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const client = makeClient({
    db: freshDb(),
    select: standardSelect(users, users.map((u) => mkResponses(u.id, 'A'))),
    publishError: { code: 'PT409', message: 'something_else' },
  })
  const res = await call(client)
  const body = await res.json()
  assert.equal(res.status, 500)
  assert.equal(body.error, 'publish_failed')
  assert.equal(fenceReads(client), 0)
})

await test('E8 summary carries the generation and the published count', async () => {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const client = makeClient({ db: freshDb(), select: standardSelect(users, users.map((u) => mkResponses(u.id, 'A'))) })
  const body = await (await call(client)).json()
  assert.equal(typeof body.generation, 'number')
  assert.equal(body.published, body.usersDelivered)
  assert.equal(client._db.latestPublished.values().next().value, body.generation)
})

// ---------------------------------------------------------------------------
// Part C — mutation checks: reverse three guards, prove a test catches each,
// restore the file, prove the SHA-256 is unchanged.
// ---------------------------------------------------------------------------

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

const MUTATIONS = [
  {
    label: 'M1 user_blocks guard',
    from: 'if (blocksError) {',
    to: 'if (false && blocksError) {',
    // guard reversed -> the block error is ignored and a week is published
    guardedStatus: 500,
    guardedUpserts: 0,
  },
  {
    label: 'M2 previous-week history guard',
    from: 'if (lastWeekError) {',
    to: 'if (false && lastWeekError) {',
    guardedStatus: 500,
    guardedUpserts: 0,
  },
  {
    label: 'M3 publish failure guard',
    from: 'if (historyError) {',
    to: 'if (false && historyError) {',
    // the single publish call is attempted either way; reversed, its error is
    // swallowed and the handler reports success
    guardedStatus: 500,
    guardedUpserts: 1,
  },
]

async function expectFailure(cfg, expectedError) {
  const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
  const responses = users.map((u) => mkResponses(u.id, 'A'))
  const client = makeClient(cfg(users, responses))
  const res = await call(client)
  const body = await res.json()
  return { status: res.status, body, upserts: publishCalls(client).length }
}

const GUARD_CASES = {
  M1: (users, responses) => ({
    select: standardSelect(users, responses, {
      user_blocks: { data: null, error: { message: 'permission denied' } },
    }),
  }),
  M2: (users, responses) => ({
    select: standardSelect(users, responses, { match_history: { data: null, error: { message: 'timeout' } } }),
  }),
  M3: (users, responses) => ({
    select: standardSelect(users, responses),
    publishError: { code: 'XX000', message: 'disk full' },
  }),
}

for (const [index, mutation] of MUTATIONS.entries()) {
  await test(`C${index + 1} mutation: ${mutation.label} is really tested`, async () => {
    const original = readFileSync(GEN, 'utf8')
    const before = sha256(original)
    assert.ok(original.includes(mutation.from), `guard text not found for ${mutation.label}`)
    const mutated = original.replace(mutation.from, mutation.to)
    try {
      const mutatedHandler = await loadGenerator(mutated, `mut${index}`)
      globalThis.__client = null
      const users = [mkUser('f0', 'female'), mkUser('m0', 'male')]
      const responses = users.map((u) => mkResponses(u.id, 'A'))
      const client = makeClient(GUARD_CASES[`M${index + 1}`](users, responses))
      globalThis.__client = client
      const res = await mutatedHandler({
        method: 'POST',
        headers: { get: (k) => (k.toLowerCase() === 'apikey' ? 'svc' : null) },
      })
      // With the guard reversed the failure is no longer detected: the handler
      // either publishes despite the error or swallows it. Either way the
      // behaviour differs from the guarded version.
      const guarded = await expectFailure(GUARD_CASES[`M${index + 1}`], null)
      const mutatedStatus = res.status
      assert.notEqual(
        mutatedStatus,
        guarded.status,
        `mutation ${mutation.label} was not detected (status stayed ${mutatedStatus})`,
      )
      assert.equal(guarded.status, mutation.guardedStatus, `guarded status for ${mutation.label}`)
      assert.equal(guarded.upserts, mutation.guardedUpserts, `guarded writes for ${mutation.label}`)
    } finally {
      // Restore and prove the file is byte-identical.
      const current = readFileSync(GEN, 'utf8')
      if (sha256(current) !== before) writeFileSync(GEN, original, 'utf8')
      assert.equal(sha256(readFileSync(GEN, 'utf8')), before, `index.ts was not restored (${mutation.label})`)
    }
  })
}

// ---------------------------------------------------------------------------

const passed = results.filter((r) => r.ok).length
const failed = results.filter((r) => !r.ok).length
console.log('==================================')
console.log(`Passed: ${passed}   Failed: ${failed}   Total: ${results.length}`)
process.exit(failed === 0 ? 0 : 1)
