// Shared profile constants + validation. Used by Profile.jsx (editing)
// and Settings.jsx. Single source of truth so client rules stay in
// agreement with the DB boundary (bio_max_300, prompts_shape <= 3).

export const BIO_MIN = 0
export const BIO_MAX = 300

export const MAX_PROMPTS = 3
export const PROMPT_ANSWER_MAX = 280

// Small, meaningful catalog — not an exhaustive list.
export const PROMPT_LIBRARY = [
  { id: 'perfect-day', question: 'My perfect campus day is…' },
  { id: 'green-flag', question: 'A green flag I look for is…' },
  { id: 'dealbreaker', question: 'A dealbreaker for me is…' },
  { id: 'last-laughed', question: 'I last laughed when…' },
  { id: 'study-spot', question: 'You will find me at…' },
  { id: 'two-things', question: 'Two things I can not go a week without…' },
  { id: 'first-look', question: 'The first thing I notice is…' },
  { id: 'unusual-talent', question: 'A hidden talent of mine is…' },
]

// Relationship intention options — maps to the existing
// users.looking_for column (single source, no duplicates).
export const LOOKING_FOR_OPTIONS = [
  { value: 'something_serious', label: 'Something serious' },
  { value: 'something_casual', label: 'Something casual' },
  { value: 'still_figuring_it_out', label: 'Still figuring it out' },
  { value: 'new_friends', label: 'New friends' },
]

// Validate profile edit payload. Returns { ok, error, value }.
// Trims strings; enforces the same limits the DB constraints do.
export function validateProfileEdits({ bio, prompts, looking_for, interests }) {
  const value = {}

  if (bio !== undefined) {
    const b = String(bio ?? '')
    if (b.length > BIO_MAX) {
      return { ok: false, error: `Bio must be ${BIO_MAX} characters or fewer.` }
    }
    value.bio = b
  }

  if (prompts !== undefined) {
    if (!Array.isArray(prompts)) {
      return { ok: false, error: 'Prompts must be a list.' }
    }
    if (prompts.length > MAX_PROMPTS) {
      return { ok: false, error: `You can answer at most ${MAX_PROMPTS} prompts.` }
    }
    const seenIds = new Set()
    const cleaned = []
    for (const p of prompts) {
      const answer = String(p?.answer ?? '').trim()
      const entry = PROMPT_LIBRARY.find(x => x.id === p?.id)
      if (!entry) return { ok: false, error: 'Unknown prompt selected.' }
      if (seenIds.has(p.id)) {
        return { ok: false, error: 'Each prompt can only be used once.' }
      }
      seenIds.add(p.id)
      if (answer.length === 0) continue // skip empties
      if (answer.length > PROMPT_ANSWER_MAX) {
        return { ok: false, error: `Prompt answers must be ${PROMPT_ANSWER_MAX} characters or fewer.` }
      }
      cleaned.push({ id: entry.id, question: entry.question, answer })
    }
    value.prompts = cleaned
  }

  if (looking_for !== undefined) {
    const lf = String(looking_for ?? '')
    if (lf && !LOOKING_FOR_OPTIONS.some(o => o.value === lf)) {
      return { ok: false, error: 'Invalid relationship intention.' }
    }
    value.looking_for = lf || null
  }

  if (interests !== undefined) {
    if (!Array.isArray(interests)) {
      return { ok: false, error: 'Interests must be a list.' }
    }
    if (interests.length > 15) {
      return { ok: false, error: 'Pick at most 15 interests.' }
    }
    value.interests = interests
  }

  return { ok: true, value }
}
