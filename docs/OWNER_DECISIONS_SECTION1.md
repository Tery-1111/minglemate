## Decisions

1. The PRD (section 5, paragraph 86) says "emotional + space x2". Will's decision: "space" means relationship expectations. The weights stay 3:3:2:2:1 as already implemented.
2. The PRD gives no per-question mapping. Will reviewed docs/SECTION1_MAPPING_REVIEW.md and approved all 50 questions as filed. This is an OWNER-APPROVED mapping, not a PRD-derived one.
3. The approved mapping, which you hard-code explicitly in the test as a literal table (do NOT read it from the code):

   - Questions 1-10 = communication
   - Questions 11-20 = conflict
   - Questions 21-30 = emotional
   - Questions 31-40 = expectations
   - Questions 41-50 = values

## Open product questions, not decided

a. The PRD names the fifth dimension "values/lifestyle", but questions 41-50 contain no lifestyle questions (Q32 and Q34 are the nearest).
b. Section 1 scoring appears to count the share of questions where both users chose the identical option, so all different answers count as equally incompatible; whether that is the intended rule is undecided.
