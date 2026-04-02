export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0
  const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0)
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0))
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0))
  if (magA === 0 || magB === 0) return 0
  return dot / (magA * magB)
}

export function jaccardSimilarity(tagsA: string[], tagsB: string[]): number {
  const setA = new Set(tagsA)
  const setB = new Set(tagsB)
  const intersection = tagsA.filter(t => setB.has(t)).length
  const union = new Set([...tagsA, ...tagsB]).size
  return union === 0 ? 0 : intersection / union
}

export function complementarityScore(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0
  const diffs = vecA.map((a, i) => Math.abs(a - vecB[i]))
  const avg = diffs.reduce((sum, d) => sum + d, 0) / diffs.length
  return avg
}