ADVISORY ONLY. Not a sign-off. Will decides.

# Section 1 mapping — agent review

## Part 1: Evidence on "space"

Search: case-insensitive, whole word "space", across the PRD
(`MingleMate_Master_Product_Specification.docx`) and `src`, `docs`, `supabase`,
`scripts`, `README.md`, `DEPLOYMENT-CHECKLIST.md`. CSS layout tokens
(`space-between`, `white-space`, `var(--space-N)`) and unrelated uses ("free disk
space") are not scoring dimensions and are excluded.

| Source | Location | Exact words | Scoring context |
|---|---|---|---|
| PRD | section "5. Compatibility & Questionnaires", paragraph 87 (heading is paragraph 82) | "communication + conflict ×3; emotional + space ×2; values ×1" | The only weighting sentence in the PRD. "space" is named as a ×2 term and is never defined |
| docs/MINGLEMATE_PRD_COMPLIANCE_MATRIX.md | line 47 | "Weights: communication + conflict ×3; emotional + space ×2; values ×1." | Quotation of the PRD weighting |
| docs/MINGLEMATE_PRD_COMPLIANCE_MATRIX.md | line 162 | "Dimension weighting is communication and conflict ×3, emotional and space ×2, values ×1." | Quotation of the PRD weighting as the audit criterion |
| docs/MINGLEMATE_PRD_COMPLIANCE_MATRIX.md | line 309 | "The PRD's word \"space\" does not match any named dimension" | Audit's own note that the term is unassigned |
| docs/MINGLEMATE_PRIORITIZED_GAP_REGISTER.md | line 137 | "PRD §5 requires communication + conflict ×3, emotional + \"space\" ×2, values ×1" | Quotation of the PRD weighting |
| docs/MINGLEMATE_PRIORITIZED_GAP_REGISTER.md | line 141 | "Decision PD-1 (which weighting is authoritative, and what \"space\" means)" | Records the meaning of "space" as an open decision |
| docs/MINGLEMATE_PRIORITIZED_GAP_REGISTER.md | line 485 | "\"Space\" maps to no named dimension" | Records the term as unassigned |
| src/data/section1Questions.js | line 197 (Q33) | "What role should personal space play in a relationship?" | Question filed under Expectations |
| src/data/section1Questions.js | line 54 (Q9 option) | "Give the conversation space" | Answer option in a Communication question |
| src/data/section1Questions.js | line 78 (Q13 option) | "Physical space" | Answer option in a Conflict question |
| src/data/section1Questions.js | line 168 (Q28 option) | "Space" | Answer option in an Emotional question |
| src/data/section1Questions.js | line 234 (Q39 option) | "Respect for my space" | Answer option in an Expectations question |

No other scoring or weighting use of "space" exists in the searched files.

**Conclusion:** the PRD alone gives NO EVIDENCE of which of the five named
dimensions "space" means — paragraph 87 names it as a ×2 weighting term without
defining it; the only repository hit that treats space as a relationship
construct is Q33 ("personal space in a relationship"), filed under
**Expectations**, so the hits support relationship expectations and nothing
further.

## Part 2: Fit review of all 50 questions

Judged only by what each question and its options measure, using the PRD's five
names. Nothing was moved; `docs/SECTION1_MAPPING_REVIEW.md` is unchanged and its
Sign-off column is untouched.

| Q | Filed under | Verdict | Reason | Better fit if DOUBTFUL |
|---|---|---|---|---|
| 1 | Communication | FITS | Asks which channel the person prefers for getting to know someone, a communication-style choice. | — |
| 2 | Communication | FITS | Measures desired contact frequency while busy, a communication cadence. | — |
| 3 | Communication | FITS | Asks what makes someone feel heard in conversation, a listening behaviour. | — |
| 4 | Communication | DOUBTFUL | The options are affection-expression modes (time, practical help, words, remembered details), measuring how care is expressed emotionally rather than conversational communication. | Emotional maturity |
| 5 | Communication | FITS | Measures willingness to discuss personal topics, i.e. conversational openness. | — |
| 6 | Communication | FITS | Directly asks the preferred conversation style. | — |
| 7 | Communication | FITS | Asks how the person prefers feedback to be delivered, a communication preference. | — |
| 8 | Communication | DOUBTFUL | The options describe emotional expression and regulation (tell immediately, share online, wait, show energy), with no communication channel or style content. | Emotional maturity |
| 9 | Communication | FITS | Asks how the person repairs an awkward conversation, a communication behaviour. | — |
| 10 | Communication | DOUBTFUL | Measures how highly honesty is valued, an honesty commitment rather than a communication behaviour. | Values/lifestyle |
| 11 | Conflict | FITS | First response to a disagreement is conflict behaviour. | — |
| 12 | Conflict | FITS | Preferred speed of resolution is conflict handling. | — |
| 13 | Conflict | FITS | Calming strategies during conflict are conflict regulation. | — |
| 14 | Conflict | FITS | Reaction to being wrong is conflict repair. | — |
| 15 | Conflict | FITS | What is needed after an argument is conflict recovery. | — |
| 16 | Conflict | FITS | The chosen constructive approach is conflict strategy. | — |
| 17 | Conflict | FITS | Handling frustration with someone close is conflict management. | — |
| 18 | Conflict | FITS | What makes an apology meaningful is conflict repair. | — |
| 19 | Conflict | FITS | Comfort setting boundaries during conflict is conflict behaviour. | — |
| 20 | Conflict | FITS | Unacceptable behaviours in a disagreement are conflict boundaries. | — |
| 21 | Emotional | FITS | How difficult emotions are processed is emotional regulation. | — |
| 22 | Emotional | FITS | What makes someone feel emotionally supported is an emotional need. | — |
| 23 | Emotional | FITS | Openness in expressing feelings is emotional expression. | — |
| 24 | Emotional | FITS | Mood-lifting preferences are emotional regulation. | — |
| 25 | Emotional | FITS | Response to a distressed close person is emotional support. | — |
| 26 | Emotional | FITS | What makes someone feel appreciated is an emotional need. | — |
| 27 | Emotional | FITS | Importance of emotional availability is emotional intimacy. | — |
| 28 | Emotional | FITS | Preference when overwhelmed is emotional coping. | — |
| 29 | Emotional | FITS | How good news is celebrated is emotional expression. | — |
| 30 | Emotional | FITS | What builds emotional trust is emotional intimacy. | — |
| 31 | Expectations | FITS | Directly asks what is expected from a relationship. | — |
| 32 | Expectations | FITS | Ideal time with a partner is an expectation about contact. | — |
| 33 | Expectations | FITS | Asks the role personal space should play, an expectation about space in a relationship. | — |
| 34 | Expectations | DOUBTFUL | The options describe personal planning habits and spontaneity, not what is expected of a partner. | Values/lifestyle |
| 35 | Expectations | FITS | Defines what reliability means, an expectation of a partner. | — |
| 36 | Expectations | FITS | Preferred division of responsibilities is a relationship expectation. | — |
| 37 | Expectations | FITS | Preferred pace of the relationship is an expectation. | — |
| 38 | Expectations | FITS | Importance of shared interests is an expectation about compatibility. | — |
| 39 | Expectations | FITS | Expected support during stress is an expectation of a partner. | — |
| 40 | Expectations | FITS | Preferred decision-making approach is an expectation about how decisions are made. | — |
| 41 | Values | FITS | Ranking the most important quality is a values question. | — |
| 42 | Values | FITS | The definition of success is a values question. | — |
| 43 | Values | FITS | The importance of personal growth is a values question. | — |
| 44 | Values | FITS | The guiding principle for decisions is a values question. | — |
| 45 | Values | FITS | Preferred community contribution is an expression of values. | — |
| 46 | Values | FITS | The place of family is a values question. | — |
| 47 | Values | FITS | The definition of respect is a values question. | — |
| 48 | Values | FITS | The preferred kind of life is a lifestyle value. | — |
| 49 | Values | FITS | The importance of financial responsibility is a value. | — |
| 50 | Values | FITS | The desired legacy is a values question. | — |

### DOUBTFUL questions

- Q4 — Communication → Emotional maturity
- Q8 — Communication → Emotional maturity
- Q10 — Communication → Values/lifestyle
- Q34 — Expectations → Values/lifestyle
