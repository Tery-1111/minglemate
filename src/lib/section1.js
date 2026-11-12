// Stored Section 1 answers are option text held by position: slot i is
// question i + 1. This projection is the only place a stored row becomes
// editable state, so it is also where legacy and malformed values are dropped.
//
// A value counts only when it is exactly one of that question's options.
// Everything else is unanswered (null):
//   * the retired integer[] rows, whose numbers became strings ('0', '1') when
//     the column was converted to text;
//   * an option that belongs to a different question (a shifted row);
//   * a short row (padded to one slot per question);
//   * a long row (truncated to one slot per question).
export function normalizeStoredAnswers(stored, questions) {
  return Array.from({ length: questions.length }, (_, index) => {
    const value = Array.isArray(stored) ? stored[index] : null
    return typeof value === 'string' && questions[index].options.includes(value)
      ? value
      : null
  })
}
