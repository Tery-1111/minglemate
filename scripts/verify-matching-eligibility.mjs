import assert from 'node:assert/strict'
import { areEligibleCandidates, pairKey } from '../supabase/functions/_shared/matchingEligibility.ts'

const blockedPairs = new Set()
const candidate = (id, gender, campus_id) => ({ id, gender, campus_id })

const campusA1 = candidate('a1', 'female', 'campus-a')
const campusA2 = candidate('a2', 'male', 'campus-a')
const campusB = candidate('b', 'male', 'campus-b')
const unaffiliated1 = candidate('u1', 'female', null)
const unaffiliated2 = candidate('u2', 'male', null)

assert.equal(areEligibleCandidates(campusA1, campusA2, blockedPairs), true, 'same-campus candidates remain eligible')
assert.equal(areEligibleCandidates(campusA1, campusB, blockedPairs), false, 'different-campus candidates are excluded')
assert.equal(areEligibleCandidates(unaffiliated1, unaffiliated2, blockedPairs), true, 'two unaffiliated candidates remain eligible')
assert.equal(areEligibleCandidates(unaffiliated1, campusA2, blockedPairs), false, 'null and non-null campuses are excluded')
assert.equal(areEligibleCandidates(campusA2, unaffiliated1, blockedPairs), false, 'non-null and null campuses are excluded in reverse order')
assert.equal(areEligibleCandidates(campusA1, candidate('same-campus-female', 'female', 'campus-a'), blockedPairs), false, 'same-gender candidates remain excluded')

// D5: the only matchable gender pair is exactly male/female, in either order.
assert.equal(areEligibleCandidates(campusA2, campusA1, blockedPairs), true, 'male/female is eligible in reverse order')
assert.equal(areEligibleCandidates(candidate('n1', null, 'campus-a'), campusA1, blockedPairs), false, 'null gender is never eligible')
assert.equal(areEligibleCandidates(candidate('n2', '', 'campus-a'), campusA2, blockedPairs), false, 'empty gender is never eligible')
assert.equal(areEligibleCandidates(candidate('n3', 'other', 'campus-a'), campusA2, blockedPairs), false, 'unknown gender is never eligible')
assert.equal(areEligibleCandidates(candidate('n4', 'nonbinary', 'campus-a'), campusA1, blockedPairs), false, 'third gender value is never eligible')
assert.equal(areEligibleCandidates(candidate('n5', 'MALE', 'campus-a'), campusA1, blockedPairs), false, 'gender is compared case-sensitively')
assert.equal(areEligibleCandidates(candidate('n1', null, 'campus-a'), candidate('n2', null, 'campus-a'), blockedPairs), false, 'two null genders are never eligible')

const blocked = new Set([pairKey('a1', 'a2')])
assert.equal(areEligibleCandidates(campusA1, campusA2, blocked), false, 'blocked pairs remain excluded')
assert.equal(areEligibleCandidates(campusA2, campusA1, blocked), false, 'block exclusion is direction-agnostic')

console.log('17 matching eligibility checks passed')
