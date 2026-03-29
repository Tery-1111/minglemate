// ─── Egerton University Registration Number Parser ───────────────────────────

export function parseRegNumber(input) {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: 'Registration number is required' }
  }

  // Step 1 — Normalize
  const normalized = input
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[-_.]/g, '/')

  // Step 2 — Split by /
  const parts = normalized.split('/')

  if (parts.length !== 3) {
    return { valid: false, error: 'Format must be PREFIX+CODE/STUDENT_ID/YEAR (e.g. S17/02920/24)' }
  }

  const [segment1, studentId, intakeYear] = parts

  // Step 3 — Extract prefix and program code from segment1
  const prefixMatch = segment1.match(/^([A-Z]{1,2})(\d{2})$/)

  if (!prefixMatch) {
    if (/^\d/.test(segment1)) {
      return { valid: false, error: 'Invalid format — prefix must come before digits (e.g. S17 not 17S)' }
    }
    const letters = segment1.match(/^[A-Z]+/)?.[0] || ''
    if (letters.length > 2) {
      return { valid: false, error: 'Invalid prefix — must be 1 or 2 letters only (e.g. S or ED)' }
    }
    const digits = segment1.replace(/[A-Z]/g, '')
    if (digits.length !== 2) {
      return { valid: false, error: 'Program code must be exactly 2 digits (e.g. 17)' }
    }
    return { valid: false, error: 'Invalid registration number format' }
  }

  const prefix = prefixMatch[1]
  const programCode = prefixMatch[2]

  // Step 4 — Validate student ID
  if (!/^\d{5}$/.test(studentId)) {
    return { valid: false, error: `Student ID must be exactly 5 digits (got "${studentId}")` }
  }

  // Step 5 — Validate intake year
  if (!/^\d{2}$/.test(intakeYear)) {
    return {
      valid: false,
      error: intakeYear.length > 2
        ? 'Intake year must be 2 digits only (e.g. 24 not 2024)'
        : 'Intake year must be exactly 2 digits (e.g. 24)'
    }
  }

  // Step 6 — Build result
  const fullId = `${prefix}${programCode}/${studentId}/${intakeYear}`

  return {
    valid: true,
    prefix,
    program_code: programCode,
    student_id: studentId,
    intake_year: intakeYear,
    full_id: fullId
  }
}


// ─── Unit Tests ──────────────────────────────────────────────────────────────

export function runTests() {
  const tests = [
    // Valid inputs
    { input: 'S17/02920/24',        expect: { valid: true,  full_id: 'S17/02920/24'  } },
    { input: 's17/02920/24',        expect: { valid: true,  full_id: 'S17/02920/24'  } },
    { input: 'ed17/02920/24',       expect: { valid: true,  full_id: 'ED17/02920/24' } },
    { input: 'Ed17/02920/24',       expect: { valid: true,  full_id: 'ED17/02920/24' } },
    { input: ' ed17 / 02920 / 24 ', expect: { valid: true,  full_id: 'ED17/02920/24' } },
    { input: 'ED23/12345/24',       expect: { valid: true,  full_id: 'ED23/12345/24' } },
    { input: 'P23/12345/25',        expect: { valid: true,  full_id: 'P23/12345/25'  } },

    // Invalid inputs
    { input: '17S/02920/24',        expect: { valid: false } },
    { input: 'EDD17/02920/24',      expect: { valid: false } },
    { input: 'S1/02920/24',         expect: { valid: false } },
    { input: 'S17/2920/24',         expect: { valid: false } },
    { input: 'S17/02920/2024',      expect: { valid: false } },
    { input: 'S17-02920-24',        expect: { valid: true,  full_id: 'S17/02920/24'  } },
    { input: '',                    expect: { valid: false } },
  ]

  let passed = 0
  let failed = 0

  tests.forEach(({ input, expect: expected }, i) => {
    const result = parseRegNumber(input)
    const validMatch = result.valid === expected.valid
    const idMatch = !expected.full_id || result.full_id === expected.full_id

    if (validMatch && idMatch) {
      console.log(`✅ Test ${i + 1} passed: "${input}"`)
      passed++
    } else {
      console.error(`❌ Test ${i + 1} failed: "${input}"`)
      console.error(`   Expected: valid=${expected.valid}, full_id=${expected.full_id}`)
      console.error(`   Got:      valid=${result.valid}, full_id=${result.full_id}, error=${result.error}`)
      failed++
    }
  })

  console.log(`\n${passed} passed, ${failed} failed out of ${tests.length} tests`)
}