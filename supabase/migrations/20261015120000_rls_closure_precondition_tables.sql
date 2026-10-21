-- ============================================================
-- RLS CLOSURE — the four precondition tables
-- photos / notifications / token_purchases / campuses
--
-- FINDING (PRD audit 2026-10-15, C-15)
--   The consolidated chain brings 17 tables under RLS; these four are not
--   among them. Each is a PRECONDITION of that chain — it reads them, and the
--   only trace of the intent to lock them is a comment at chain:3582
--   ("campuses table itself should also get RLS if it has none — clients
--   currently write it directly"). With RLS off, a client holding the
--   anon/publishable key can:
--     * photos           read every row, and insert/update/delete a row for
--                        ANY user_id (strip a rival's photos, repoint another
--                        user's photo_url);
--     * notifications    read every user's notifications and INSERT forged
--                        ones — the product's only "New Match Alert" surface
--                        is spoofable;
--     * token_purchases  read other users' rows (user_id, amount,
--                        mpesa_transaction_id) and forge or alter a purchase;
--     * campuses         insert a campus row or flip is_active /
--                        matching_enabled (which also feeds the client-writable
--                        users.campus_id of audit finding C-1).
--   Two legacy permissive policies would keep part of that open even with RLS
--   on: "System can insert notifications" WITH CHECK (true) and "Public can
--   read campuses" USING (true). The 30 Aug 2026 schema dump carries both
--   (schema_only.sql:1838 and :1826).
--
-- ACCESS THE APPLICATION ACTUALLY NEEDS (traced through src/,
-- supabase/functions/ and the chain's own functions)
--   * photos — every client read is for a user the viewer is NOT matched with:
--     Discover.jsx:82 (arbitrary candidates), Matches.jsx:57 and
--     MatchCelebration.jsx:63 (the weekly Tier 1/Tier 2 pair, which lives in
--     match_history — public.matches holds only paid Qrashe pairs),
--     ForceConnect.jsx:34 and Payment.jsx:68 (a target not yet connected),
--     MatchDetail.jsx:47, Messages.jsx:95, Profile.jsx:76, Photos.jsx:43.
--     The read rule is therefore "any authenticated user", NOT an
--     owner-or-matched rule: an owner-or-matched rule would blank every photo
--     in Discover, Matches, Match Detail and the celebration. Every write is
--     the owner's own row — PhotoUpload.jsx:82 and Photos.jsx:106 upsert on
--     (user_id, photo_type) with the signed-in user's id.
--   * notifications — the client only SUBSCRIBES. Home.jsx:28-41 opens a
--     Realtime channel on its own rows (filter user_id=eq.<self>), and Realtime
--     applies RLS for the subscriber, so the own-row SELECT policy below is
--     what keeps the in-app match alert working. No client statement anywhere
--     reads or writes the table. The only writer is complete_force_connect(), a
--     SECURITY DEFINER function (chain:1151, executed by service_role only);
--     the service role bypasses RLS too.
--   * token_purchases — written by payment-callback with the SERVICE ROLE
--     (supabase/functions/payment-callback/index.ts:371) and read by the
--     definer admin_overview (chain:3166). Nothing in src/ touches it. RLS on
--     with ZERO client policies is the control.
--   * campuses — ProfileSetup.jsx:45 reads it (authenticated) to resolve the
--     signup email domain; writes go through the is_admin()-guarded definer
--     RPCs admin_add_campus / admin_set_campus_active /
--     admin_set_campus_matching (chain:3197 / 3218 / 3238). Read for
--     authenticated, no client write.
--
-- WHY THIS IS ITS OWN MIGRATION AND NOT A NEW STAGE IN THE CHAIN
--   `supabase db push` applies only migration versions that are not already in
--   supabase_migrations.schema_migrations. The project is linked
--   (supabase/.temp/linked-project.json) and db.migrations is enabled
--   (supabase/config.toml), so once 20261014150000 has been recorded, editing
--   that file changes nothing on the next push — the CLI never re-runs a
--   recorded version. A security fix that a routine `db push` can silently
--   skip is not a fix, so the closure ships as a NEW version. Its timestamp
--   sorts after the chain: on a project that has not yet run the chain it
--   applies immediately after it, and on one that has, it applies on the next
--   push. It is additive and rewrites no migration that has already shipped.
--   For the Dashboard SQL-editor workflow, DEPLOYMENT-CHECKLIST.md step 1.1
--   names this file too.
--
-- IDEMPOTENT AND PRECONDITION-TOLERANT: each block runs only if its table
--   exists (to_regclass — the same guard the chain uses for campuses at
--   chain:4165), the enable is a no-op when RLS is already on, and every policy
--   is dropped before it is created. A second run changes nothing, and a
--   project missing one of the four still applies the rest. The statements are
--   issued through `execute` inside a guarded block, the form this repository
--   already uses for conditional DDL (chain:1518, chain:4168, and the
--   harden-auth guarded-enable loop).
--
-- PRECONDITIONS (evidenced, not assumed): all four tables exist on the target
--   projects. supabase/.temp/preconditions.sql declares each of them, and
--   DEPLOYMENT-CHECKLIST.md step 1.1 lists them as chain preconditions.
--
-- DELIBERATELY NOT IN THIS FILE: users.campus_id. It is still in the client
--   UPDATE grant (chain:2090) and written by ProfileSetup.jsx:89; correcting it
--   changes product behaviour (it depends on the campus-model decision) and
--   needs a client change, so it stays out of this security-only migration.
-- ============================================================

-- ------------------------------------------------------------
-- 1. photos — read for any authenticated user, write only your own row
--    (the read is what Discover, the weekly matches and the celebration
--    need; it is not an owner-or-matched rule — see the header)
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.photos') is null then
    raise notice 'public.photos does not exist (a precondition of the chain): the photo RLS closure is skipped.';
  else
    execute 'alter table public.photos enable row level security';

    execute 'drop policy if exists "photos_select_authenticated" on public.photos';
    execute 'create policy "photos_select_authenticated" on public.photos for select '
         || 'to authenticated using (true)';

    execute 'drop policy if exists "photos_insert_own" on public.photos';
    execute 'create policy "photos_insert_own" on public.photos for insert '
         || 'to authenticated with check (user_id = auth.uid())';

    execute 'drop policy if exists "photos_update_own" on public.photos';
    execute 'create policy "photos_update_own" on public.photos for update '
         || 'to authenticated using (user_id = auth.uid()) '
         || 'with check (user_id = auth.uid())';

    execute 'drop policy if exists "photos_delete_own" on public.photos';
    execute 'create policy "photos_delete_own" on public.photos for delete '
         || 'to authenticated using (user_id = auth.uid())';

    -- State the privilege the read policy needs rather than assume it (the
    -- chain's own pattern, chain:2044). A no-op where the project's default
    -- grants already cover it, which is what lets today's reads work.
    execute 'grant select on public.photos to authenticated';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 2. notifications — read your own rows; no client write at all
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.notifications') is null then
    raise notice 'public.notifications does not exist (a precondition of the chain): the notification RLS closure is skipped.';
  else
    execute 'alter table public.notifications enable row level security';

    -- Retire the legacy permissive insert policy: WITH CHECK (true) lets any
    -- client, including anon, forge a notification (schema_only.sql:1838).
    -- RLS alone would not stop it while this policy exists.
    execute 'drop policy if exists "System can insert notifications" on public.notifications';

    execute 'drop policy if exists "notifications_select_own" on public.notifications';
    execute 'create policy "notifications_select_own" on public.notifications for select '
         || 'to authenticated using (user_id = auth.uid())';

    -- No client write policy on purpose: complete_force_connect() (SECURITY
    -- DEFINER) and the service role both bypass RLS, so legitimate delivery is
    -- unaffected while a client can no longer create or alter a notification.
    execute 'revoke insert, update, delete on public.notifications from anon, authenticated';

    execute 'grant select on public.notifications to authenticated';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 3. token_purchases — server-only. RLS on, no client policy, client
--    privileges revoked. payment-callback inserts with the service role and
--    admin_overview reads as a definer; neither needs a policy.
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.token_purchases') is null then
    raise notice 'public.token_purchases does not exist (a precondition of the chain): the purchase RLS closure is skipped.';
  else
    execute 'alter table public.token_purchases enable row level security';

    -- Defence in depth: RLS with no policy already denies every client row,
    -- and this revoke survives an accidental `disable row level security`.
    execute 'revoke all on public.token_purchases from anon, authenticated';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 4. campuses — reference data, read for authenticated, no client write.
--    Writes go through the is_admin()-guarded definer RPCs.
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.campuses') is null then
    raise notice 'public.campuses does not exist (a precondition, not created here): the campus RLS closure is skipped. Re-run after the campus DDL exists.';
  else
    execute 'alter table public.campuses enable row level security';

    execute 'drop policy if exists "campuses_select_authenticated" on public.campuses';
    execute 'create policy "campuses_select_authenticated" on public.campuses for select '
         || 'to authenticated using (true)';

    execute 'revoke insert, update, delete on public.campuses from anon, authenticated';

    execute 'grant select on public.campuses to authenticated';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 5. NOT CLOSED HERE — the anonymous read of campuses.
--    The proposal's section 7.2 flagged this as needing the owner's decision,
--    and no code path in src/ reads campuses anonymously, so it is left exactly
--    as it is: the legacy "Public can read campuses" USING (true) policy is NOT
--    dropped by this migration. It is reference data (name, email_domain,
--    flags), so an anonymous read is not a data exposure, and the confirmed gap
--    for this table — insert or flag change by a client — is closed above.
--    If the owner confirms that no external surface (SEO page, sitemap
--    generator, onboarding flow outside this repository) reads it anonymously,
--    the reversal is the single line below. Do not uncomment without that
--    confirmation:
--
--      drop policy if exists "Public can read campuses" on public.campuses;
-- ------------------------------------------------------------
