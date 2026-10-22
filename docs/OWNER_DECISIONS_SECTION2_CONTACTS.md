# Owner decisions — Section 2 contacts

Recorded 2026-10-21. D1–D5 are the owner's decisions **verbatim**. The
implementation must be read against this file, not against earlier Section 2
assumptions.

## D1

Section 2 is free to write and free to read, for weekly tier matches and Qrashe pairs. No payment, entitlement, unlock flag or expiry gates it.

## D2

"Reading others" means reading Section 2 answers of matched partners only. A matched tier 1/tier 2 pair in `match_history` in either direction, or an active row in `matches`, AND neither user has blocked the other in `user_blocks`, in either direction.

## D3

Contact details are revealed only when BOTH conditions hold:

* A succeeded Connect payment covers that specific match, represented by `connect_unlocks` or the paid Connect snapshot.
* The contact owner has enabled the corresponding `share_*` flag.

Section 2 progress, completion or payment must never reveal contacts.

## D4

Section 2 remains completely outside matching. Do not weaken `scripts/verify-section2-isolation.mjs`.

## D5

Drop `get_match_contact`. Reject new Section 2 purchases in `initiate-payment`; retain callback processing for old payments. Do not delete payment records.

---

## Where each decision stands

| Decision | State | Where |
|---|---|---|
| D1 | Implemented in the migration and the screens | Stage 3 policies use no payment/entitlement/unlock/expiry column; `Section2.jsx`, `Matches.jsx` and `Chat.jsx` carry no Section 2 gate. |
| D2 | Implemented in the migration | `public.is_section2_partner(uuid, uuid)` plus the `section2_responses_select_own_or_partner` policy. |
| D3 | Implemented in its own migration | `supabase/migrations/20261021130000_section2_d3_contact_reveal.sql` replaces `get_unlocked_contacts(uuid)`: a `connect_unlocks` row for this buyer/seller is required, and every returned channel is filtered by the owner's live `share_*` flag. The legacy question-count branch is removed. |
| D4 | Preserved | `scripts/verify-section2-isolation.mjs` is untouched and still run by `npm run verify`. |
| D5 | Implemented in the migration, Edge Function and payment screen | `get_match_contact(uuid)` revoked then dropped; `initiate-payment` returns HTTP 400 for `section2`; `payment-callback` still settles old intents; no payment row is written or deleted. |

## D3 implementation

The **live** body is still not captured. Two revisions are evidenced, and
Step 3a resolves to **replace** under either:

- The older chain revision materialized in the 2026-10-15 **local** Supabase
dump (`audit-out/verify-2026-10-15/dumps/A.norm.sql`, lines 1879–1918;
provenance and its limits are in `docs/LIVE_SECTION2_SCHEMA.md`) had a second
branch returning live contact values when
`section2_chat_progress.contacts_unlocked` was true — no Connect payment
involved. Rows already carrying that flag would have kept revealing after the
write path was pinned.
- The **current** chain (`20261014150000_consolidated_schema_chain.sql`, stage
8f) has removed that legacy branch, but its paid branch still returns the
snapshot without consulting the owner's current `share_*` choice, so consent
withdrawn after purchase is ignored.

`20261021130000_section2_d3_contact_reveal.sql` therefore:

- keeps the deployed pairing guard (`users_are_paired`), so the replacement can
  only narrow the reveal, never widen it;
- returns no row unless `connect_unlocks` holds a row with
  `buyer_id = auth.uid()` and `seller_id = other_user_id` (that row is the
  paid snapshot `complete_connect_unlock()` writes only after a verified
  succeeded intent and a server-side pairing check);
- maps each channel through the owner's live flag, so a withdrawn flag hides
  the channel:

  | Channel | Owner's flag | Paid snapshot column |
  |---|---|---|
  | Phone | `share_phone` | `phone` |
  | WhatsApp | `share_whatsapp` | `whatsapp_number` |
  | Email | `share_email` | `email` |
  | Instagram | `share_social_instagram` | `social_instagram` |
  | X | `share_social_x` | `social_x` |
  | TikTok | `share_social_tiktok` | `social_tiktok` |

  Each column is `case when contact_owner.<flag> then paid.<snapshot column>
  end`, so a channel the owner never shared stays null even after payment;
- reads no progress, question-count, entitlement, trial or expiry column;
- re-asserts the ACL (PUBLIC and `anon` revoked, `authenticated` granted,
  `service_role` untouched) and fails if the stored body or privileges do not
  match;
- revokes SELECT on the six snapshot contact columns of `connect_unlocks` from
  `public`, `anon` and `authenticated`, granting `authenticated` only `id,
  buyer_id, seller_id, tier, created_at`. Without this the buyer could select
  the pipeline row directly (RLS policy `unlock_select_buyer`) and read a
  channel the owner had switched off, bypassing the consent condition.

Its Stage 0 aborts before any change if the live return type, the
`connect_unlocks`/`users` columns, `auth.uid()` or the `authenticated` role
differ from the evidenced shape — `CREATE OR REPLACE` cannot change a return
type, so a different live shape needs a reviewed drop-and-create instead.

The migration is **not applied**, and its behaviour was executed against PGlite
(15/15, including a paid row with no pairing, a withdrawn consent flag, and a
refused direct read of the snapshot contact columns).
Repository evidence plus a run-time preflight is what makes it safe to review;
the live body, signature and grants still need the single read-only capture
(`docs/LIVE_SECTION2_SCHEMA.md` item 6).

## Open, not decided

Recorded verbatim from the owner's Section 2 brief. These four remain
undecided: this implementation decides none of them and assumes nothing about
them.

1. Connect price
2. Refund or retirement of old Section 2 payments
3. Read receipts
4. Whether match visibility should expire after a number of weeks

## Consequences of the evidence block

The 2026-10-22 read-only capture in `docs/LIVE_SECTION2_SCHEMA.md` closes these
items for the target (`minglemate-staging`, ref `ifiewinipbxxfvzpzezd`):

- D3's preflight passes there: `connect_unlocks` and all six `users.share_*`
  flags exist, and the live `get_unlocked_contacts` body is captured (it ignores
  consent and keeps the free branch, which is why it is replaced).
- `user_id`, `user_id_a`/`user_id_b`, `contacts_unlocked` and
  `UNIQUE(user_id, question_number)` all exist as named.
- Both reveal triggers exist under the names the migration drops
  (`trg_contacts_unlocked`, `trg_auto_contact_reveal`), so the question-count
  reveal is removed when stage 1 runs.
- Both files were applied to the target on 2026-10-22 on the owner's
explicit authorization, and their versions are recorded. Their headers now
record the application instead of a pending status.
