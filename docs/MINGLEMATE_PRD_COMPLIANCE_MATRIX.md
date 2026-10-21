# MingleMate — PRD Compliance Matrix

**Prepared:** 2026-10-21
**Repository:** `C:\Users\oboch\minglemate`, branch `fix/review-2026-10-15`, HEAD `dfad576`
**PRD:** `MingleMate_Master_Product_Specification.docx` — located at `C:\Users\oboch\Downloads\MingleMate_Master_Product_Specification.docx`, version 1.0, dated 27 September 2026 (SHA-256 `6442a106840a258675f39583d80395dfd254e29a47f5010ff8f5996011a3d0d4`).
**Primary implementation evidence:** [MINGLEMATE_CURRENT_STATE_INVESTIGATION.md](MINGLEMATE_CURRENT_STATE_INVESTIGATION.md) — investigation dated 2026-10-19 at the same branch and HEAD.
**Companion document:** [MINGLEMATE_PRIORITIZED_GAP_REGISTER.md](MINGLEMATE_PRIORITIZED_GAP_REGISTER.md).

**Status of this document:** planning and evidence reconciliation only. No application code, migration, test, configuration or database state was changed. No production system was contacted. No fix is authorized by this document.

---

## 0. Scope, sources and method

### 0.1 What was read

| Source | Role in this matrix |
|---|---|
| `MingleMate_Master_Product_Specification.docx` v1.0 (27 Sep 2026) | Authoritative requirement source. Extracted text was checked against the DOCX XML; the two extractions are identical after whitespace normalisation (492 paragraphs, 25,018 characters of body text). No requirement text below is invented. |
| `docs/MINGLEMATE_CURRENT_STATE_INVESTIGATION.md` | Primary finding IDs (`F-01`–`F-81`), discrepancies (`D-1`–`D-12`), verification results (`§G-1`–`§G-12`) and limitations. Reused, not repeated. |
| Targeted source reads, only to resolve a specific ambiguity | `src/pages/Discover.jsx`, `MatchDetail.jsx`, `Interests.jsx`, `Profile.jsx`, `Chat.jsx`, `Section2.jsx`, `Section1.jsx`, `src/data/section1Questions.js`, `src/components/BottomNav.jsx`, `supabase/functions/_shared/compatibilityEngine.ts`, `supabase/functions/match-generator/index.ts`, `supabase/migrations/20261014150000_consolidated_schema_chain.sql`, `.github/workflows/weekly-db-backup.yml`, `ADMIN-PANEL-REMEDIATION.md`, `audit-out/plan-production-migration-2026-10-15/RECOVERY-READINESS.md`. |
| Existing verification output | Investigation §G (static suites, build, lint, question-bank import). Not re-run; no new product test was executed for this document. |

### 0.2 What was deliberately not done

- No production or staging database, Edge Function, cron job, payment, email or storage object was accessed.
- No migration was applied, executed or edited.
- No application source, test or configuration file was modified.
- No package was installed and no new tooling was introduced.
- No visual, browser, screen-reader or device testing was performed.
- No runtime claim is made where only source or static-check evidence exists.

### 0.3 Requirement normalisation

The PRD is itself a reconciliation document: it contains normative requirements **and** status labels copied from an earlier audit. This matrix treats only the normative statements as requirements. Status words inside the PRD (for example "VERIFIED", "PARTIAL") are not treated as evidence; the investigation and source are.

Requirements are normalised into one testable statement each and given a stable ID of the form `DOMAIN-NN`. IDs are stable for future revisions; they do not encode priority. The PRD section that carries the requirement is named in the `PRD ref` column.

PRD §17 is a findings table rather than a requirement list. Its required dispositions are mapped to the administration rows and gaps (`ADM-08`, `ADM-09`, `ADM-14`, `ADM-16`, `MTM-08`, `NAV-03`, `NAV-04`, `G-02`, `G-09`) instead of being duplicated as separate requirements. PRD §26 (prompt history) and §27 (caveat) are context, not requirements.

Where the PRD states a number or price, the number is preserved exactly:

- 50 Section 1 questions, 20 Section 2 questions.
- Five Discover cards.
- Tier 1 Connect KSh 70, Tier 2 Connect KSh 50, Force Connect KSh 80.
- 7-day conversation archive period (stated in PRD §9 as "the specified period"; the implementation's period is 7 days).
- Weights: communication + conflict ×3; emotional + space ×2; values ×1.

### 0.4 Classification rules used

The seven permitted primary classifications are used exactly as named. Their meaning in this document:

| Classification | Meaning here |
|---|---|
| **PASS — Verified** | The requirement is established by an executed check, or by a deterministic artifact fact that runtime cannot change without a different deployment (for example a text absence, an exact data count, a fixed route target, a server-side price table). The evidence column states which. PASS does **not** imply browser or database execution unless the evidence says so. |
| **PARTIAL** | Part of the requirement is implemented or verified and part is not; or the mechanism exists but a named sub-behaviour is absent, inconsistent or unproven in a way that changes the product outcome. |
| **FAIL — Confirmed gap** | Source or documentation evidence positively contradicts the requirement. The contradiction is cited. |
| **UNVERIFIED** | The implementation exists in source, but the requirement's outcome depends on runtime state (database, auth session, deployed function, cron, payment provider, browser) that was not exercised. No defect is asserted. |
| **DECISION REQUIRED** | The PRD is silent, internally ambiguous, or conflicts with another approved statement, and the correct product policy cannot be derived from the documents. |
| **BLOCKED** | Evidence necessary to classify the requirement cannot be obtained without an external environment or credential. The blocker is named. |
| **NOT IMPLEMENTED** | No implementation of the required capability was found in the repository's current UI, RPC surface or schema. Absence is evidenced by the enumerated surface, not assumed from one missing file. |

Rules applied from the task brief:

1. Source presence alone is not runtime proof; where the outcome is runtime-dependent the row is `UNVERIFIED`.
2. A passing script proves only what it exercises. `verify-payment-ticket.mjs` proves decision logic, not HTTP or database execution.
3. `npm run build` passing is recorded as a build fact, not product correctness.
4. A missing repository migration is not proof that a production object is absent.
5. An untracked migration is not evidence that a database change was applied.
6. Suspected defects are not promoted to `FAIL` without a cited contradiction.
7. Missing evidence is separated from product defects through `UNVERIFIED` / `BLOCKED`.
8. PRD conflicts and silences are surfaced as `DECISION REQUIRED`, not resolved by assumption.

---

## 1. Summary

### 1.1 Requirements by classification

| Classification | Count |
|---|---:|
| PASS — Verified | 26 |
| PARTIAL | 32 |
| FAIL — Confirmed gap | 12 |
| UNVERIFIED | 30 |
| DECISION REQUIRED | 2 |
| BLOCKED | 2 |
| NOT IMPLEMENTED | 5 |
| **Total mapped** | **109** |

### 1.2 Requirements by domain

| Domain | Requirements | PASS | PARTIAL | FAIL | UNVERIFIED | DECISION | BLOCKED | NOT IMPL. |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A. Identity and positioning | 4 | 3 | 1 | 0 | 0 | 0 | 0 | 0 |
| B. Sign-up, verification, returning users | 6 | 2 | 0 | 0 | 4 | 0 | 0 | 0 |
| C. Profile, photos, contact sharing | 7 | 3 | 1 | 0 | 3 | 0 | 0 | 0 |
| D. Section 1 and scoring | 5 | 2 | 0 | 2 | 1 | 0 | 0 | 0 |
| E. Section 2 | 4 | 3 | 0 | 0 | 1 | 0 | 0 | 0 |
| F. Discover | 7 | 2 | 3 | 1 | 1 | 0 | 0 | 0 |
| G. Matching model and history | 12 | 4 | 4 | 0 | 3 | 0 | 1 | 0 |
| H. Connect and payments | 12 | 2 | 5 | 3 | 1 | 1 | 0 | 0 |
| I. Conversation lifecycle | 8 | 0 | 0 | 0 | 7 | 1 | 0 | 0 |
| J. Notifications | 4 | 0 | 2 | 1 | 1 | 0 | 0 | 0 |
| K. Navigation | 5 | 4 | 1 | 0 | 0 | 0 | 0 | 0 |
| L. Administration | 18 | 0 | 5 | 2 | 6 | 0 | 0 | 5 |
| M. Liveness, loading, UI/UX | 9 | 0 | 8 | 0 | 1 | 0 | 0 | 0 |
| N. Operations and deployment | 8 | 1 | 2 | 3 | 1 | 0 | 1 | 0 |
| **Total** | **109** | **26** | **32** | **12** | **30** | **2** | **2** | **5** |

### 1.3 Headline evidence position

- The product surface is broadly implemented: all PRD screen areas have a route, and the investigation traced each corresponding data path.
- Runtime correctness is largely **UNVERIFIED**: auth, onboarding, photo upload, persistence, RLS effects, weekly cron, Edge Function deployment, payments, notifications and admin execution were not exercised.
- The only executed checks available are the investigation's build, schema-chain static checks (113/113), payment decision-logic checks (54/54), weekly-generation safety checks, matching-eligibility checks (8/8), 50×4 question-bank import, and the failing lint run (25 errors).
- Four P0 issues are identified in the companion register: one confirmed contact-reveal authorization defect, two privacy-enforcement evidence blockers, and the absence of any recoverable production data backup.

---

## 2. Requirement matrix

Notation: `§C.10 / F-40` means investigation §C.10, finding F-40. `chain:L1808` means `supabase/migrations/20261014150000_consolidated_schema_chain.sql` line 1808 in the current working tree. "PRD" references are to the v1.0 document.

### A. Identity and positioning

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| IDN-01 | MingleMate is an independent student relationship platform, not an institution product. | §1 | Direct inspection | `index.html`, `src/seo.js`, marketing pages and app copy contain no institution name; campuses are rows looked up by email domain (`ProfileSetup.jsx`). Grep over `src/`, `index.html`, `public/` found no institution name. | PASS — Verified |
| IDN-02 | No Egerton University branding, copy, campus-only language, metadata or SEO text anywhere in the product. | §1, §25(1) | Direct inspection | Repository-wide grep (`*.js/jsx/css/html/json/md/sql/ts`, excluding `node_modules`/`dist`) found "Egerton" only in `SECURITY-REPORT.md:151` and `docs/docs-reconciliation-2026-10-14.md` (a test-account e-mail in operational documents). No product file, route, meta tag or copy contains it. | PASS — Verified |
| IDN-03 | Institution concepts are configurable platform data, not a fixed identity; the product is not re-tied to a different single institution. | §1 | F-12, F-31, F-66 | `campuses` table with `email_domain`; `ProfileSetup` derives campus by domain and allows null; admin campus RPCs. No hard-coded institution appears in matching or onboarding. | PASS — Verified |
| IDN-04 | Voice and personality are institution-neutral and student-oriented across the product. | §1, §23 | F-69, F-70; no copy audit | Copy in the inspected pages is neutral; no full content or visual review was performed. | PARTIAL |

### B. Sign-up, verification and returning users

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| ONB-01 | Email + password sign-up leads to verification and then profile setup. | §2, §20 | F-04, F-05, F-11 | `Signup.jsx` → `signUp` + Turnstile → `/verify-code`; `VerifyCode.jsx` → `/profile-setup`; trigger `handle_new_user()` creates the profile row. No auth flow was executed. | UNVERIFIED |
| ONB-02 | Returning users sign in, recover sessions and are routed correctly, with anti-enumeration errors. | §2, §20 | F-06, F-08 | `Login.jsx`, `AuthGuard.jsx` use `auth.getUser()`; generic failure messages. No live session tested. | UNVERIFIED |
| ONB-03 | Onboarding order is profile → photos → interests → Section 1 → Section 2 → Discover. | §2 | F-11 | Navigation calls in `ProfileSetup`, `PhotoUpload`, `Interests`, `Section1`, `Section2` read in source. No browser walk-through. | UNVERIFIED |
| ONB-04 | Phone/social contact details are captured during profile setup, with copy explaining that they are shown only to permitted matches after unlock. | §6 | F-12, F-16 | `ProfileSetup.jsx` writes phone, WhatsApp, social handles; `MatchDetail.jsx:219` carries the disclosure line. Copy placement in the full setup flow not browser-verified. | UNVERIFIED |
| ONB-05 | Interests can be edited without forcing a full questionnaire retake. | §2, §11 | F-17; direct inspection | `Interests.jsx:10-14` detects `?edit=1`; `:72-78` returns to `/profile` and never navigates to `/section1`. `Profile.jsx:533` links to `/interests?edit=1`. | PASS — Verified |
| ONB-06 | Users can retake or edit questionnaire content later from Profile. | §5, §11 | F-13; direct inspection | `Profile.jsx:539` → `/section1?retake=1`; `:545` → `/section2`; `Section1.jsx` completed-user bypass honours the retake flag. | PASS — Verified |

### C. Profile, photos and contact sharing

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| PRF-01 | Exactly two photo types exist: one facial photo and one full-body photo. | §2, §6, §20 | F-19, F-21 | `PhotoUpload.jsx:21-24` defines exactly `facial` and `full_body`; `Photos.jsx` uses the same two; DB unique `(user_id, photo_type)`. | PASS — Verified |
| PRF-02 | Both photo slots are required during onboarding. | §6, §20 | F-19 | `PhotoUpload.jsx:50` refuses submit unless both slots have an uploaded photo; copy at `:99` states both are required. | PASS — Verified |
| PRF-03 | The full-body photo is the visual anchor of Match Detail. | §6 | F-22; direct inspection | `MatchDetail.jsx` selects and renders `full_body` first, falling back to facial only if absent. | PASS — Verified |
| PRF-04 | Users can edit bio, interests and profile prompts, with validation preserved on failure. | §6 | F-14, F-15, F-18 | `Profile.jsx` save-state machine (idle/saving/saved/error), `src/lib/profile.js` limits, DB constraints `bio_max_300`, `prompts_shape`. No runtime save executed. | UNVERIFIED |
| PRF-05 | Owners control which contact methods (phone, WhatsApp, social) are shared. | §6 | F-16, F-40 | Six `share_*` toggles and social handles are writable own-row columns; `complete_connect_unlock` snapshots enabled flags. Controls not exercised. | UNVERIFIED |
| PRF-06 | The UI clearly states that contact details are visible only to permitted matches after the relevant unlock conditions. | §6 | F-16; direct inspection | Disclosure text exists in `MatchDetail.jsx:219` and setup copy. Full-flow copy not reviewed in a browser. | UNVERIFIED |
| PRF-07 | Contact data is never exposed on Discover or before a verified unlock; the database, not the front end, enforces this. | §3, §6, §7 | F-32, F-50, F-51; G-01 | Discover fetches only facial photo, name, age; column grants exclude `display_phone`; `profiles_public` omits contact fields. **But** `get_match_contact` (`chain:L1808-1864`) can return raw contact columns under a Section 2 payment, outside the Connect snapshot and without honouring share flags. Deployment of the grant changes is also unproven. See gaps G-01/G-02. | PARTIAL |

### D. Section 1 and compatibility scoring

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| S1-01 | Section 1 contains exactly 50 multiple-choice questions, each with a fixed option set. | §5, §25(2) | F-23; §G-11 | `src/data/section1Questions.js` imported in Node: 50 questions × 4 options (executed check, investigation §G-11). | PASS — Verified |
| S1-02 | Every Section 1 question maps to its intended scoring dimension (communication, conflict, emotional maturity, relationship expectations, values/lifestyle). | §5 | F-23, F-29; direct inspection | Data file labels exactly 10 questions per category in order (Communication 1–10, Conflict 11–20, Emotional 21–30, Expectations 31–40, Values 41–50); `Section1.jsx:82-83` stores by 0-based position; `match-generator/index.ts:62-64` maps array index + 1; `compatibilityEngine.ts` ranges 1–10, 11–20, 21–30, 31–40, 41–50. The mapping is positionally consistent. | PASS — Verified |
| S1-03 | Dimension weighting is communication and conflict ×3, emotional and space ×2, values ×1. | §5 | F-29; direct inspection | `compatibilityEngine.ts:65-69` applies 0.30 / 0.25 / 0.20 / 0.15 / 0.10. Normalised to the PRD's ratios this is 3 : 2.5 : 2 : 1.5 : 1, not 3 : 3 : 2 : 2 : 1. See gap G-05 and decision PD-1. | FAIL — Confirmed gap |
| S1-04 | The matching engine actually consumes the stored Section 1 answers and the result affects output. | §5, §22 | F-29, F-33, F-37 | Engine reads `user_responses.responses_array` through service role and writes ranked `match_history`. No end-to-end run: `e2e-matching-test.mjs` NOT RUN (§G-9). | UNVERIFIED |
| S1-05 | A dedicated verification pass proves all 50 questions reach the correct scoring pipeline; route existence is not sufficient. | §5, §25(2) | F-37; §G-9, §G-11 | No repository test asserts per-question dimension mapping or an end-to-end score from 50 answers. §G-11 proves only the bank's size. See gap G-06. | FAIL — Confirmed gap |

### E. Section 2

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| S2-01 | Section 2 contains exactly 20 guided/display questions. | §2, §5 | F-26; direct count | `Section2.jsx` question array counted: 20 entries. `Chat.jsx` duplicates the same 20 (D-5). | PASS — Verified |
| S2-02 | Section 2 is a separate guided/display system, distinct from the compatibility engine. | §5, §25(3) | F-26, F-29 | Answers go to `section2_responses`; the engine reads only `user_responses`. | PASS — Verified |
| S2-03 | Section 2 answers persist and can be re-edited by their owner. | §5 | F-26, F-27, D-9 | Upsert on `(user_id, question_number)` exists; `section2_responses` has no DDL or policy definition in the repository, so ownership enforcement is unknown. See gap G-03. | UNVERIFIED |
| S2-04 | Section 2 cannot accidentally alter core compatibility scoring. | §5 | F-26, F-29 | No read of `section2_responses` exists in `compatibilityEngine.ts` or `match-generator`; the RPC/table path is separate. | PASS — Verified |

### F. Discover

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| DSC-01 | Discover presents exactly five candidate cards. | §2, §3, §25(4) | F-31, F-32 | `discover_candidates()` ends `limit 5` (`chain:L1124`); UI renders five skeleton cards while loading. The RPC returns *up to* five; a smaller eligible pool yields fewer. Runtime not executed. See decision PD-8. | PARTIAL |
| DSC-02 | An initial card shows only facial photo, name and age. | §3 | F-32; direct inspection | `Discover.jsx` fetches `full_name`, `age` from the RPC and only facial photos; no bio/tier/contact rendered. | PASS — Verified |
| DSC-03 | Tier and contact details are not exposed on Discover. | §3, §6 | F-31, F-32 | RPC selects no tier/contact columns; card renders name/age/photo and a Force Connect price hint only. | PASS — Verified |
| DSC-04 | Each candidate can lead to Match Detail. | §3 | Direct inspection | The only candidate navigation in `Discover.jsx` is `navigate('/force-connect/' + selected.id)` (`:105`); selecting a card opens the Force Connect receipt, not `/match/:userId`. Confirmed gap G-14. | FAIL — Confirmed gap |
| DSC-05 | The user has both a normal wait path and a Force Connect path from Discover. | §3 | F-32; direct inspection | Force Connect path present; wait path exists only as explanatory copy (`discover-pathnote`). There is no candidate-level route to inspect a profile or enter the normal match journey. | PARTIAL |
| DSC-06 | Discover feels live: immediate selection feedback, card transitions, localized loading and replacement transitions when a candidate leaves the set. | §3, §12, §13 | F-32, F-71 | Selection state, five skeletons, photo fade and a `rise-in` entrance exist; there is no card-exit/reposition/replacement transition, and the board is only replaced by a full reload. See gap G-22. | PARTIAL |
| DSC-07 | Returning to Discover restores cached cards and scroll position without an unnecessary reload. | §13 | F-32; direct inspection | `sessionStorage` board cache, per-page scroll key and background refresh are implemented. No browser execution. | UNVERIFIED |

### G. Matching model, history and release

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| MTM-01 | There are exactly two ordinary match tiers plus Qrashe, and Qrashe is a distinct type, not a replacement. | §4 | F-38 | Weekly tiers live in `match_history.tier1_match_id`/`tier2_match_id`; Qrashe lives in `matches` with `tier='qrashe'`; `users_are_paired` bridges both. | PASS — Verified |
| MTM-02 | Tier 1 Connect costs KSh 70 and Tier 2 Connect KSh 50, enforced by the server. | §4, §7, §25(5) | F-44, F-49 | `initiate-payment` `PRICES` map is the only authority; intent rows store the amount; client shows display copy. Production initiation is nevertheless sandbox-bound (PAY-09). | PARTIAL |
| MTM-03 | Force Connect costs KSh 80 and is a distinct operation from ordinary Connect. | §4, §8 | F-42, F-44 | Separate `force_connect` purpose at 80, separate `complete_force_connect` path and `matches` row; client receipt screen. Not executed. | PARTIAL |
| MTM-04 | Qrashe is created only after server-verified payment, idempotently, with no duplicate records. | §8 | F-39, F-79 | `complete_force_connect` is service-role only, requires `status='succeeded'`, returns early for an existing pair; `matches_unique_pair` backs it. Logic present; no database execution. | UNVERIFIED |
| MTM-05 | The Qrashe recipient is notified and has no decline path. | §4, §8 | F-39, F-58, F-59 | `complete_force_connect` inserts a `notifications` row and a system message; no decline control exists. Push delivery is not invoked (see J). Runtime unverified. | PARTIAL |
| MTM-06 | Qrashe appears in its own Matches section. | §4 | F-36; direct inspection | `Matches.jsx:119-148` renders one screen with Tier 1, Tier 2 and Qrashe sections. | PASS — Verified |
| MTM-07 | Qrashe uses the same Match Detail → conversation → Connect/contact-unlock architecture. | §4 | F-38, F-42; direct inspection | `MatchDetail.jsx` resolves a Qrashe pair and uses the same CTA block; `Chat.jsx` is the same conversation surface. | PASS — Verified |
| MTM-08 | Weekly matching runs automatically on a schedule. | §15, §18, §25 | F-33, F-35, F-75, D-10 | No repository artifact schedules `match-generator`; only `payment-ops-tick` is created by the chain. A production cron for the legacy engine is asserted only in a migration header. Live cron state cannot be read here. See gap G-07. | BLOCKED |
| MTM-09 | Matches are historically stored, not only visible in the current UI. | §16, §25(9) | F-33, F-36 | `match_history` unique `(user_id, week_id)` is upserted per delivery; `matches` retains Qrashe rows. Live retention/data not inspected. | UNVERIFIED |
| MTM-10 | Eligibility excludes same gender, cross-campus or mixed-null campus pairs, and blocked pairs in either direction. | §4 | F-30, F-31; §G-4 | Executed `verify-matching-eligibility.mjs`: 8/8 assertions pass (same-campus eligible, cross-campus excluded, null/null eligible, mixed-null excluded both orders, same-gender excluded, blocked excluded both orders). | PASS — Verified |
| MTM-11 | Previous-week partners are avoided when alternatives exist. | §4 (via engine behavior) | F-33 | Ranking/delivery code contains the avoidance rule. No run exercised it. | UNVERIFIED |
| MTM-12 | A real match event triggers the intended celebration progression from real state, not a demo. | §10, §13 | F-13, F-36; direct inspection | `Home.jsx:76-83` reads the current week's `match_history` row and redirects to `/celebration` once per session. Celebration is weekly-match-only; Qrashe has no equivalent trigger. Full live scenario not exercised. | PARTIAL |

### H. Connect, contact reveal and payments

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| PAY-01 | Connect is available in Match Detail, at the end of the conversation, and below the action that opens the conversation. | §7 | F-42, F-56; direct inspection | `MatchDetail.jsx:212-218` renders "Start Conversation" then "Connect with …" (the required below-the-opening-action placement). In `Chat.jsx` the single Connect CTA is rendered at `:662-667`, **before** `<div className="chat-messages">` at `:671` — i.e. above the message history, not at the end. The in-conversation placement is therefore partial. | PARTIAL |
| PAY-02 | Contact reveal requires a server-verified Connect payment. | §6, §7, §25(6) | F-40, F-51; direct inspection | Paid unlock snapshots are created only by `complete_connect_unlock`; `get_unlocked_contacts` requires pairing + snapshot. **But** `get_match_contact` returns contact columns when the caller has any succeeded `section2` intent, not a Connect unlock (`chain:L1808-1864`). See gap G-01. | FAIL — Confirmed gap |
| PAY-03 | Only the contact methods the owner elected to share are revealed. | §6, §7 | F-40, F-51; direct inspection | `complete_connect_unlock` snapshots only enabled share flags and `get_unlocked_contacts` reads the snapshot. `get_match_contact` returns raw `display_phone`, `phone`, `whatsapp_number`, `email` with no share-flag check. See gap G-01. | FAIL — Confirmed gap |
| PAY-04 | A system message confirms the connection after unlock. | §7 | F-40 | `complete_connect_unlock` inserts a system message on first unlock; no execution. | UNVERIFIED |
| PAY-05 | Connect and Force Connect are distinct products and code paths. | §4, §7 | F-39, F-44 | Distinct purposes, RPCs and target tables; Force Connect creates Qrashe, Connect creates an unlock snapshot. | PASS — Verified |
| PAY-06 | Payment follows a clear state model: ready → initiating → processing/pending → success or failed/cancelled/recovery. | §13 | F-49 | `Payment.jsx:22-28` implements idle → pushing → success / pending / failed, including an `awaitingPin` recovery watcher. No live push. | PARTIAL |
| PAY-07 | Payment, Connect, contact-unlock and Qrashe success are never shown before backend confirmation. | §13, §24 | F-46, F-49, F-80 | Client polls server-side effects before success; callback consumes the intent before applying the unlock and reads the effect back. Not exercised end-to-end. | PARTIAL |
| PAY-08 | Prices are authoritative on the server; the client displays copy only. | §7, §25(5) | F-44, F-49 | Server `PRICES` map and intent amount; no client-supplied price is read. | PASS — Verified |
| PAY-09 | Production payments use the production M-Pesa environment. | §7, §8, §22 | F-45, D-7 | `initiate-payment` hardcodes `sandbox.safaricom.co.ke` for OAuth and STK on every run; only the callback honours `MPESA_ENV`. Production payment cannot initiate from this code. See gap G-08. | FAIL — Confirmed gap |
| PAY-10 | Payment callbacks are authenticated and idempotent, and late/duplicate/failed callbacks have defined outcomes. | §7, §8 | F-46, F-47; §G-2 | `verify-payment-ticket.mjs` 54/54 passes decision logic: ticket screening, DB expiry verdict, amount match, callback cache, status-guarded consume, retry/no-op walk. Deno/HTTP/DB execution not exercised. | PARTIAL |
| PAY-11 | The price of Connect after a Qrashe match is defined. | §4, §7 | F-42; direct inspection | PRD prices Force Connect at KSh 80 and states Qrashe uses the downstream Connect architecture, but never states a Qrashe Connect price. Implementation maps `connect_qrashe` to KSh 50. See gap G-18 / decision PD-2. | DECISION REQUIRED |
| PAY-12 | Abandoned or stuck payments expire and are recovered/alerted without double charge. | §13, §21 | F-46, F-48 | 30-minute window, `expire_stale_payment_intents`, 5-minute ops tick, `paid_but_not_unlocked` alerting, pending-phase watcher. Live cron/alert state unknown. | PARTIAL |

### I. Conversation lifecycle

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| CNV-01 | The existing guided-question conversation logic is preserved. | §9 | F-28, F-56 | Bot question flow, `section2_chat_progress`, paywall card and 14-question trigger remain in source. No runtime conversation. | UNVERIFIED |
| CNV-02 | Safe interactions respond immediately and reconcile with the server. | §9, §12 | F-56, F-81 | Optimistic message insert with `_pending`; server row replaces it. No browser execution. | UNVERIFIED |
| CNV-03 | Failed sends expose failure and retry instead of disappearing. | §9, §13 | F-56, F-81; direct inspection | `Chat.jsx:376-411` keeps a failed bubble and `:521-541` renders Retry/Discard. | UNVERIFIED |
| CNV-04 | After the defined lifecycle, conversations become read-only. | §9 | F-40, F-53, F-54 | `complete_connect_unlock` sets `conversations.status='locked'`; message INSERT policy rejects locked/unmatched pairs. No database execution. | UNVERIFIED |
| CNV-05 | Conversations are archived after the specified period and older history is hidden. | §9 | F-53, F-54 | SELECT policy hides messages for conversations locked more than 7 days; Chat renders an archived banner. No runtime verification. | UNVERIFIED |
| CNV-06 | Block, report and unmatch controls remain part of the safety architecture. | §9 | F-62, F-63, F-64 | Block/report/unmatch exist in Match Detail and Chat; unmatch refuses after Connect. No execution. | UNVERIFIED |
| CNV-07 | Read state / read receipts behave correctly. | PRD silent (task brief names read receipts) | F-55, D-2; direct inspection | `Chat.jsx:202-205` updates `messages.read`, but the chain defines only INSERT and SELECT policies on `messages` (no UPDATE policy), so the update cannot match rows. The PRD contains no read-receipt requirement. See decision PD-3. | DECISION REQUIRED |
| CNV-08 | A conversation is reachable from both Match Detail and the Messages list. | §9, §20 | F-57; direct inspection | Match Detail opens `/chat/:id`; Messages builds a unified conversation list from Qrashe and weekly matches. | UNVERIFIED |

### J. Notifications

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| NTF-01 | The Qrashe recipient is notified even if they already have other matches. | §4, §8 | F-39, F-58, F-61 | `complete_force_connect` inserts a per-user `notifications` row; Home subscribes via Realtime and alerts. No push dispatch and no runtime delivery. | PARTIAL |
| NTF-02 | Weekly match delivery notifies users automatically. | §15, §18, §25 | F-61 | No client or Edge Function path sends a weekly match notification; `send-notification` has no caller in `src/` or `supabase/functions/`. See gap G-15. | FAIL — Confirmed gap |
| NTF-03 | Notifications use the product's available channels (database, system message, push where implemented). | §8, §15 | F-58, F-59 | In-app row + Realtime + system message exist; OneSignal push function exists but is not invoked by any product flow. | PARTIAL |
| NTF-04 | A user's notification preference is respected. | §6 (settings), §15 | F-58; direct inspection | Home checks `users.notifications_enabled` before alerting; `send-notification` does not consult the column. No runtime test. | UNVERIFIED |

### K. Navigation

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| NAV-01 | Primary navigation is Discover, Matches, Messages, Profile. | §11, §20 | F-69; direct inspection | `BottomNav.jsx` `TABS` is exactly those four routes. | PASS — Verified |
| NAV-02 | Matches is one screen with Tier 1, Tier 2 and Qrashe sections. | §11 | F-36; direct inspection | `Matches.jsx` renders the three sections on one page, no tabs. | PASS — Verified |
| NAV-03 | Profile retains primary navigation and is not a dead end. | §11 | F-69; direct inspection | `Profile.jsx:560` renders `<BottomNav active="profile" />`. | PASS — Verified |
| NAV-04 | Settings is accessible from Profile, not only from a Matches/Home header. | §11 | F-69; direct inspection | `Profile.jsx:551-553` navigates to `/settings`; Settings back target is `/profile`. | PASS — Verified |
| NAV-05 | Navigation preserves context where appropriate and is immediate when data exists. | §13, §25 | F-32, F-71 | Discover caches board and scroll; other routes reload their data. No browser measurement. | PARTIAL |

### L. Administration

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| ADM-01 | Admin is a governance and exception-operations surface, not the engine for ordinary operation. | §15, §18 | F-65, F-67 | Admin tabs and RPCs are read/governance-oriented, but "Run Matching Now" is a manual trigger and no schedule exists (see MTM-08). | PARTIAL |
| ADM-02 | Admins can list/search users, inspect status and investigate. | §15, §16 | F-66 | `admin_users_list` paged/search/filter; `admin_user_detail`. RPCs not proven deployed. | UNVERIFIED |
| ADM-03 | Admins can suspend, unsuspend and ban users where authorized. | §15 | F-66, F-67; Admin.jsx RPC surface | `Admin.jsx` calls only `admin_overview`, `admin_reports_list`, `admin_users_list`, `admin_matches_list`, `admin_user_detail`, `admin_add_campus`, and campus toggles (`:68-225`). No suspend/ban RPC or action exists. See gap G-10. | NOT IMPLEMENTED |
| ADM-04 | Admins can access profiles/bios and relevant user data for legitimate reasons, with a recorded reason. | §15, §16 | F-66 | `admin_user_detail` requires a ≥4-character reason for sensitive categories and writes an audit row (`chain:L3491`). Not executed. | UNVERIFIED |
| ADM-05 | Admins can review, investigate and resolve reports and take moderation action. | §15 | F-63, F-66 | `admin_reports_list` reads reports; no status, resolution or action RPC/UI exists (the runbook itself notes no lifecycle). | PARTIAL |
| ADM-06 | Admins can view all current and historical matches. | §16 | F-66 | `admin_matches_list` exists, filterable/paged. Deployment unproven. | UNVERIFIED |
| ADM-07 | Admin payments view reflects the current payment architecture. | §16, §17 | F-66 | `admin_overview` reads `payment_intents` and merges legacy `token_purchases` as tagged history. Not executed. | UNVERIFIED |
| ADM-08 | Admins can add/remove/activate/deactivate institutions and control matching. | §15 | F-66; `chain:L3181-3222` | Add, active and matching toggles exist; no remove/delete RPC or UI. | PARTIAL |
| ADM-09 | Institution matching controls govern the real matching engine. | §15, §17 | F-33; direct inspection | `match-generator/index.ts:40-43` loads every `section1_complete`+`active` user and never reads `campuses.matching_enabled` or `is_active`. The manual/admin run ignores the toggles. See gap G-11. | FAIL — Confirmed gap |
| ADM-10 | Admins can monitor matching health and trigger emergency/operator runs. | §15 | F-67 | "Run Matching Now" calls `match-generator`; no matching-health view. Live trigger not executed. | PARTIAL |
| ADM-11 | Admins can review system health, failures and alerts. | §15 | F-73, F-75 | No health/alert tab in `Admin.jsx`; `health` Edge Function exists and falls back because `admin_stats_counts` is undefined. | NOT IMPLEMENTED |
| ADM-12 | Admins can manage admin roles and permissions. | §15 | F-65, F-66 | `admin_users` membership exists but no RPC/UI to add/remove admins or roles. | NOT IMPLEMENTED |
| ADM-13 | Admins can review administrative actions and sensitive access in an audit view. | §15, §16 | F-68 | `admin_audit_log` table exists; no RPC or UI reads it. | NOT IMPLEMENTED |
| ADM-14 | Every privileged mutation enforces authorization server-side, not by route obscurity. | §19 | F-65; §G-1 | All `admin_*` RPCs contain internal `is_admin()` guards raising 42501 (static schema-chain check). Not executed against a live DB. | UNVERIFIED |
| ADM-15 | Sensitive access records admin ID, data category, target, reason, timestamp and action. | §16, §19 | F-66; `chain:L3491` | `admin_user_detail` inserts those fields for sensitive categories. No live execution. | UNVERIFIED |
| ADM-16 | Administrative actions generate audit events. | §19 | F-66; `chain:L3491`; direct inspection | The only `admin_audit_log` insert is inside `admin_user_detail`. Campus add/active/matching and maintenance-message mutations write no audit row. See gap G-12. | FAIL — Confirmed gap |
| ADM-17 | Admin is not required for routine matching, payment completion, notifications or conversation lifecycle. | §18, §25(12) | F-33, F-35, F-46, F-54, F-61 | Payment completion and conversation expiry are automatic; weekly matching has no repository schedule and weekly notification is absent, so an operator must currently trigger matching manually. See gaps G-07/G-15. | PARTIAL |
| ADM-18 | Relevant conversations are available to admins for legitimate moderation, safety or dispute investigation under access controls. | §16 | F-65, F-66 | No admin RPC or UI reads conversations/messages; `admin_user_detail` covers profile, questionnaire, contacts and matches only. | NOT IMPLEMENTED |

### M. Liveness, loading and UI/UX

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| UIX-01 | The interface reacts to state: reaction, transformation, continuity, anticipation, consequence. | §12, §24 | F-71 | Selection states, skeletons, optimistic sends, photo fade and the weekly celebration exist across pages. No interaction review was performed. | PARTIAL |
| UIX-02 | Safe interactions use optimistic UI with server reconciliation and rollback. | §12, §25 | F-56, F-81 | Chat and questionnaire saves reconcile/rollback. No browser execution. | UNVERIFIED |
| UIX-03 | The exact loading/processing state model is implemented per operation. | §13 | F-71; direct inspection | Most operations have local states (Discover 5 skeletons, Payment phases, Profile save, Section 1/2 save, Chat pending). Gaps: Match Detail uses a full-page "Loading" indicator instead of a structure skeleton; Discover has no candidate replacement transition. | PARTIAL |
| UIX-04 | Loaders are localized; a single operation does not blank the whole screen. | §13 | F-71; direct inspection | Most screens use localized states; `MatchDetail.jsx` returns a page-level loading paragraph; Section 2 uses a page-level loading text. | PARTIAL |
| UIX-05 | No operation spins forever; every async action has success, failure or recoverable waiting. | §13 | F-49, F-71, F-81 | Payment has pending/recovery; chat has failure/retry; most fetches have error/retry. Not exhaustively audited. | PARTIAL |
| UIX-06 | High-risk actions never show false success. | §13, §25 | F-46, F-49, F-80 | Success is gated on server effects in Payment; Force Connect success depends on the matches row. Not exercised. | PARTIAL |
| UIX-07 | Motion and visual language avoid generic AI patterns (perpetual float, random bounce, decorative animation). | §12, §14 | F-70; no visual audit | CSS uses restrained transitions and some entrance animations; no rendered review was done. | PARTIAL |
| UIX-08 | A coherent semantic design-token system is used instead of hard-coded random colours. | §14 | F-70; `src/styles/tokens.css` | Tokens and component classes exist; a full hard-coded-colour audit was not performed. | PARTIAL |
| UIX-09 | `prefers-reduced-motion` is respected for all motion. | §12, §25(18) | Direct inspection | Reduced-motion blocks exist in `Landing.css`, `MatchCelebration.css` and `tokens.css`, but `Payment.css` contains animation declarations with no reduced-motion block. See gap G-23. | PARTIAL |

### N. Operations, monitoring, recovery and deployment

| ID | Requirement (normalised) | PRD ref | Findings | Evidence / verification | Classification |
|---|---|---|---|---|---|
| OPS-01 | Backups are automatic, data-bearing and retained. | §15, §25; see §3 item 7 | F-77; `RECOVERY-READINESS.md` | `weekly-db-backup.yml` is manual-only (schedule commented out, `:28-31`); no run has ever produced an artifact; the pooler secret is absent; the free plan provided no platform backup/PITR as recorded on 2026-10-16 (not re-checked for this document). No data-bearing backup exists. See gap G-04. | FAIL — Confirmed gap |
| OPS-02 | Monitoring and health checks detect failures and alert. | §15 | F-02, F-58, F-73, F-75 | Sentry and PostHog initialize when keys exist; `health` Edge Function exists but depends on an undefined `admin_stats_counts` and falls back to `app_settings`; ops alerts dispatch via pg_net when configured. No monitoring run. | PARTIAL |
| OPS-03 | Recovery readiness is proven by a tested restore. | §25; see §3 item 7 | `RECOVERY-READINESS.md` | The only load test restores a **schema-only** artifact with 0 data rows; production data is unrecoverable today. See gap G-04. | FAIL — Confirmed gap |
| OPS-04 | Deployment readiness is established: migrations recorded, functions deployed, secrets present, migrations not left untracked. | §22, §25 | F-74, F-76, F-77; D-11 | Live migration history, deployed function versions and secrets cannot be read here; three migrations are untracked; the checklist self-reports stale claims. | BLOCKED |
| OPS-05 | The production build succeeds. | §22 | §G-6 | `npm run build` exit 0 (Vite/rolldown, ~5.04 s, chunk-size warning). | PASS — Verified |
| OPS-06 | The repository passes its lint/quality gate. | §22 | §G-5, D-12 | `npm run lint` exit 1: 44 problems (25 errors, 19 warnings) across 20 files, including React Hooks immutability errors in Chat/Payment/Settings/Messages. See gap G-19. | FAIL — Confirmed gap |
| OPS-07 | Critical flows have automated tests that are actually run. | §22 | §B.2, §G-7 … §G-10 | Four static suites pass; no unit-test framework; RLS/clamp scripts did not run (no local stack); the staging e2e matcher test and M-Pesa sandbox harness were not run. See gap G-21. | PARTIAL |
| OPS-08 | Scheduled maintenance jobs (payment expiry, alerts, cleanup) run reliably. | §15, §21 | F-48, F-75 | `payment-ops-tick` is created only when pg_cron exists; live schedule/run history is unknown. | UNVERIFIED |

---

## 3. Conflicts, ambiguities and PRD silences

These are carried into the decision list in the gap register; none is resolved here.

1. **Section 1 weighting.** PRD §5 states communication + conflict ×3, emotional + "space" ×2, values ×1. The implementation uses 0.30/0.25/0.20/0.15/0.10. The PRD's word "space" does not match any named dimension ("relationship expectations" is the fourth). A product owner must confirm the intended dimension and weights before code changes. (S1-03 / PD-1.)
2. **Qrashe Connect price.** The PRD prices Force Connect at KSh 80 but gives no price for a Connect/contact unlock that follows a Qrashe match. The implementation charges KSh 50. The PRD cannot be used to declare the implementation wrong or right. (PAY-11 / PD-2.)
3. **Read receipts.** The task brief names read receipts; the PRD does not. The implementation attempts a read update that RLS cannot authorize. Whether read receipts are in scope is a product decision, not a defect classification. (CNV-07 / PD-3.)
4. **"Exactly five" candidates.** The RPC is written as `limit 5`, which yields at most five. The PRD's "exactly five" cannot hold when fewer eligible users exist. The product decision is whether to show fewer, pad, or communicate scarcity; this matrix treats the cap as partial. (DSC-01 / PD-8.)
5. **Section 2 access model.** The PRD describes Section 2 as guided/display and does not require payment; the implementation contains a KSh 200 `section2` product and a guided-chat paywall. This is not counted as a PRD failure because the PRD does not forbid the product, but the access rules should be explicitly confirmed. (S2-03; decision PD-9.)
6. **Contact reveal through Section 2.** PRD §6–§7 requires Connect-payment unlock. The `get_match_contact` RPC also accepts a succeeded Section 2 payment, and ignores share flags. This is treated as a confirmed defect, not an ambiguity, because the PRD's condition is explicit. (PAY-02/PAY-03 / G-01.)
7. **Backup and recovery scope.** The PRD has no clause specifying a backup mechanism, retention, RPO or RTO. OPS-01/OPS-03 are therefore assessed against the task's explicit backup/recovery scope and the P0 data-loss rule, not against a literal PRD sentence. The absence of a recoverable production data backup is still a confirmed operational gap; the retention target is decision PD-5. (OPS-01, OPS-03 / G-04.)

---

## 4. Coverage and limitations

### 4.1 What this matrix can support

- A requirement-by-requirement statement of what the PRD asks, what the repository contains, and what was actually verified.
- A defensible distinction between confirmed defects, partial implementations, missing evidence and missing product decisions.
- A traceable basis for the prioritized gap register and the proposed work-package order.

### 4.2 What it cannot support

- Any claim that the deployed product behaves as the source suggests. No database, Edge Function, cron, payment, notification or browser session was exercised.
- Any claim that a production table, policy or grant is absent because the repository does not contain it. `UNVERIFIED`/`BLOCKED` is used instead.
- Any accessibility conformance claim beyond the single PRD requirement for reduced motion. The PRD does not define WCAG level, keyboard, screen-reader or contrast targets, so none is asserted.
- Any legal, financial or privacy assurance. The P0 items require the verification described in the gap register.

### 4.3 Verification inventory (as inherited)

| Check | Result | Bearing on this matrix |
|---|---|---|
| `npm run build` | PASS (exit 0) | Only OPS-05. |
| `node scripts/check-schema-chain.mjs` | PASS 113/113 | Structural consistency of SQL, not execution. |
| `node scripts/verify-payment-ticket.mjs` | PASS 54/54 | PAY-10 decision logic only. |
| `node scripts/verify-weekly-generation-safety.mjs` | PASS (exit 0) | Legacy-engine safety, not live cron. |
| `node scripts/verify-matching-eligibility.mjs` | PASS 8/8 | MTM-10. |
| Section 1 bank import | PASS 50×4 | S1-01. |
| `npm run lint` | FAIL 25 errors / 19 warnings | OPS-06. |
| `verify-rls-closure.mjs` | NOT RUN (no local stack) | PRF-07, ADM-14, CNV-04/05. |
| `verify-entitlement-clamp.mjs` | NOT RUN (no local stack) | PRF-05, S2-03. |
| `e2e-matching-test.mjs` | NOT RUN (no staging credentials) | S1-04/05, MTM-08/11. |
| `sandbox-transactionstatus.mjs` | NOT RUN (no M-Pesa credentials) | PAY-06/07/10/12. |

---

## 5. Traceability index

| PRD area | Requirement IDs |
|---|---|
| §1 Product identity | IDN-01 … IDN-04 |
| §2 Core flow | ONB-01 … ONB-06, PRF-01, S1-01, S2-01 |
| §3 Discover | DSC-01 … DSC-07 |
| §4 Matching model | MTM-01 … MTM-12, PAY-11 |
| §5 Questionnaires | S1-01 … S1-05, S2-01 … S2-04 |
| §6 Photos/profile/contact | PRF-01 … PRF-07, PAY-03 |
| §7 Connect/reveal | PAY-01 … PAY-05, PAY-09 |
| §8 Force Connect/Qrashe | MTM-03 … MTM-05, NTF-01 |
| §9 Conversation lifecycle | CNV-01 … CNV-08 |
| §10 Match celebration | MTM-12 |
| §11 Navigation | NAV-01 … NAV-05, ONB-05/06 |
| §12 Liveness | UIX-01, UIX-02, UIX-07, UIX-09 |
| §13 Loading system | UIX-03 … UIX-06, PAY-06/07 |
| §14 Visual direction | UIX-07, UIX-08 |
| §15 Admin purpose | ADM-01 … ADM-13, ADM-17 |
| §16 Admin visibility | ADM-02, ADM-04, ADM-06, ADM-15, ADM-18 |
| §17 Admin findings | ADM-09; gaps G-09 … G-12 |
| §18 No routine admin work | ADM-17, MTM-08, NTF-02 |
| §19 Admin security model | ADM-14 … ADM-16 |
| §20 Route inventory | NAV-01 … NAV-04; all route rows |
| §21 Evidence vs end state | summary §1.3 |
| §22 Agent method | S1-05, OPS-05 … OPS-07 |
| §23–§24 Personality/finish | IDN-04, UIX-01 … UIX-09 |
| §25 Definition of done | all domains; see summary |

---

## 6. Document control

- This matrix does not authorize any work. The proposed sequence is in the companion gap register, §8.
- Counts in §1 were reconciled against the row classifications in §2.
- Classification labels are exact and mutually exclusive; no row carries a secondary label.
- Where a requirement's wording was compressed, the PRD reference in the same row is authoritative.
