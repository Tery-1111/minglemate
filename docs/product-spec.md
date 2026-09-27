# MingleMate — Complete App Flow & Implementation Task

## IMPLEMENTATION RULES (apply throughout)

- Inspect the existing codebase before changing anything.
- Preserve existing working functionality.
- Do NOT redesign or re-engineer existing questionnaire/conversation logic.
- Do NOT create duplicate systems.
- Do NOT invent product behavior not specified below.
- Follow: Inspect → Confirm → Implement → Test → Verify → Report.
- Make the minimum necessary code changes.
- Use the existing design system/components where possible.
- Do NOT replace working implementations just to match the description — where functionality already exists, reuse it; where missing, implement only the missing pieces.
- Do NOT perform unrelated refactoring.

### Security requirements

- Never trust the frontend for payment success.
- Never expose private contact information before the server-authorized Connect state.
- Enforce contact visibility server-side/database-side.
- Enforce match ownership server-side.
- Enforce Qrashe creation only after verified KSh 80 payment.
- Enforce Tier 1/Tier 2 Connect prices server-side.
- Ensure users cannot manipulate match type or payment state from the client.
- Respect existing Supabase RLS/security architecture.

---

## 1. App Structure

Primary navigation: **Discover | Matches | Messages | Profile**

Settings lives under Profile, not as its own primary nav item.

---

## 2. Onboarding

**Sign Up** collects:

- Name, Age/DOB, Bio/profile information
- Phone number — required
- WhatsApp number — required
- Social-media handles — optional
- Exactly two photo slots: Photo 1 = facial photo, Photo 2 = full-body photo (no additional slots)

Must clearly communicate: "Your phone number, WhatsApp number and social handles are not public. They are only revealed to your matches through the Connect feature according to your sharing choices."

Contact details must never appear on public/discoverable profile cards.

**Onboarding order (all free, no payment gate anywhere in this chain):**
Sign Up → Algorithm Questionnaire (existing 50-question compatibility engine, do not rebuild) → Guided-Question Questionnaire (existing system, do not rebuild; answers feed the guided conversation experience between matches) → Discover.

Users can later edit/retake questionnaire answers without repeating onboarding — this must always be freely accessible, at any time, with no paywall gating the ability to answer or edit either questionnaire.

---

## 3. Discover

First screen after onboarding. Displays exactly **5 profile cards** in a grid. Each card shows ONLY: facial photo, name, age. Never show Tier 1/Tier 2 status on Discover.

Two paths communicated to the user:

- Normal: "Wait for a mutual match."
- Alternative: "Want to connect now? Force Connect — KSh 80" (applies to a selected person from the 5 shown)

**Force Connect flow:**
Discover → Select profile → Force Connect → Payment → Successful KSh 80 payment → Qrashe match created → Recipient notified.

The recipient MUST be notified, CANNOT decline, MUST receive the connection, and must be notified even if they already have other matches. No accept/decline step.

---

## 4. Match Types

Exactly three categories: **Tier 1, Tier 2, Qrashe**. Qrashe is created ONLY through the KSh 80 Force Connect flow.

---

## 5. Match Celebration

For a normal mutual match: show a Match Celebration screen displaying the match info and the relevant Tier 1/Tier 2 cards, then a clear route into Matches. Never expose Tier 1/Tier 2 status on Discover before a mutual match. Qrashe does not need this mechanism since Force Connect directly creates the connection.

---

## 6. Matches Screen

ONE screen, three sections: Tier 1 Matches, Tier 2 Matches, Qrashe Matches. Do NOT create separate navigation tabs per tier.

A match card shows: facial photo, name, age. Do not unnecessarily repeat the tier prominently on the opened match screen.

---

## 7. Open Match Screen

Same basic experience for Tier 1, Tier 2, and Qrashe:

1. Full-body photo (NOT the primary card photo — that's the face photo)
2. Bio
3. Conversation access
4. Connect actions

---

## 8. Conversation Entry

Use the EXISTING guided-question conversation system — do not rebuild it.

On the opened match screen, provide:

- "Start Conversation"
- "Connect with [Name]" (also appears again below/after the conversation)

The Connect action must be available WITHOUT requiring the guided questions to be completed first. Two valid paths:

- Path A: Match → Start Conversation → Conversation → Connect
- Path B: Match → Connect directly

Never force users through guided questions before Connect.

---

## 9. Connect Pricing

- Tier 1 Connect = KSh 70
- Tier 2 Connect = KSh 50
- Qrashe uses the SAME Connect/contact-unlock system as the other match types

IMPORTANT: KSh 80 Force Connect is NOT the same as normal Connect. KSh 80 creates a Qrashe match from Discover. Normal Connect unlocks contact information per the existing Connect rules. These are two entirely separate payments for two entirely separate things.

---

## 10. Connect Payment Flow

User selects "Connect with [Name]" → Payment → Successful payment → Connect button disappears → Available contact details appear directly below the conversation.

Only reveal contact methods the other user has chosen to make available. Possible methods: Phone, WhatsApp, Social-media handles. Never reveal a method the owner hasn't enabled.

---

## 11. Contact Sharing Settings

The contact-info owner controls which methods are available. Changing sharing choices affects FUTURE paid connections only. If someone already paid to unlock contact info, they retain access to what they already unlocked — never retroactively remove previously paid access due to a later settings change.

---

## 12. Connect Notification

After a successful Connect payment, create a system message inside the conversation: "[Name] connected with you." Do NOT build a separate notification system for this — the in-conversation message is sufficient.

---

## 13. Conversation Lifecycle

**Before paid Connect:** allow Unmatch, Block, Report.
**After paid Connect:** allow Block, Report only — do NOT allow Unmatch after paid Connect.

After paid Connect:

- The MingleMate conversation becomes locked for active conversation (users continue via revealed contact methods instead).
- Conversation history remains visible as READ-ONLY for 1 week.
- After 1 week, archive the conversation from normal-user access.
- The underlying database record may remain — never delete underlying conversation data merely because the user-facing view has been archived.

---

## 14. Profile Screen

Provides access to: profile information, facial photo, full-body photo, bio, contact sharing controls, questionnaire editing/retaking, settings. Exactly two profile photo slots (facial + full-body) — no extra slots.

---

## 15. Messages Screen

Use/implement the existing messaging infrastructure — do not create a second messaging architecture. Messages must respect the match/conversation lifecycle defined in section 13.

---

## 16. Required Screens/Routes

**Onboarding:** Sign Up, Algorithm Questionnaire, Guided-Question Questionnaire
**Main App:** Discover, Matches, Messages, Profile
**Matching:** Match Celebration, Open Match/Match Detail, Conversation experience, Connect payment, Connect-success/contact reveal
**Force Connect:** Selection/confirmation, KSh 80 payment, Qrashe created/recipient notification state
**Account/Profile:** Profile editing, Contact sharing controls, Questionnaire edit/retake

Do not create unnecessary duplicate screens if existing architecture can handle these states within existing routes/components.

---

## 17. Overall Navigation Flow

SIGN UP → ALGORITHM QUESTIONNAIRE → GUIDED-QUESTION QUESTIONNAIRE → DISCOVER
  → 5 PROFILE CARDS (Face + Name + Age)
    → WAIT → MUTUAL MATCH → TIER 1/TIER 2 → MATCH CELEBRATION → MATCHES
    → FORCE CONNECT → KSh 80 → QRASHE → RECIPIENT NOTIFIED → MATCHES
  MATCHES → TIER 1 / TIER 2 / QRASHE → OPEN MATCH
    → FULL-BODY PHOTO → BIO → CONVERSATION → CONNECT → PAYMENT
    → CONTACTS REVEALED → CONVERSATION LOCKED → READ-ONLY 1 WEEK → ARCHIVED
