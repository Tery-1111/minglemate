-- ============================================================
-- CLAMP SECTION 2 ENTITLEMENTS  (audit fix: entitlement forgery)
--
-- FINDING
--   Two entitlement columns were writable from the browser:
--     1. src/pages/Section2.jsx set `users.section2_unlocked = true`
--        when a user finished the Section 2 questionnaire. Section 2 is
--        now answered for free (product spec §2: no paywall in
--        onboarding), but the payment callback, the guided-chat paywall
--        (Chat.jsx) and get_match_contact() all treat that column as
--        "paid". So finishing a free questionnaire granted the KSh 200
--        unlock — and the paid chat past the 4 free questions — for
--        nothing.
--     2. src/pages/ProfileSetup.jsx computed
--        `section2_free_expires_at` (now + 14 days) in the browser, so
--        the trial window was client-controlled too.
--
-- ROOT CAUSE
--   The `users_update_own` RLS policy (supabase/sql/fix_rls.sql) lets a
--   user update their own row, and RLS cannot restrict *columns*. The
--   trigger created below is the column-level guard — it is the
--   `clamp_user_protected_columns` trigger that an earlier migration's
--   comment already assumed existed but which was never defined.
--
-- AFTER THIS MIGRATION
--   * `section2_unlocked` and `section2_free_expires_at` are
--     server-owned. A client write is silently DISCARDDED (the caller's
--     existing value is preserved), so no client gets an error and no
--     entitlement can be forged.
--   * The 14-day trial is granted once, server-side, when the profile
--     row is created for a new auth user (handle_new_user).
--   * Verified payments still unlock, because payment-callback uses the
--     service role and therefore bypasses the clamp.
--
-- COMPANION CODE CHANGE (already applied in src/)
--   Section2.jsx no longer writes section2_unlocked; ProfileSetup.jsx no
--   longer writes section2_free_expires_at.
--
-- IDEMPOTENT: columns use if-not-exists, functions use create-or-replace,
-- and the trigger is dropped before creation. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The entitlement columns.
--    Neither column is created anywhere else in this repository, so they
--    are declared here for completeness; where they already exist in the
--    live database these statements are no-ops.
-- ------------------------------------------------------------
alter table public.users
  add column if not exists section2_unlocked boolean not null default false;

alter table public.users
  add column if not exists section2_free_expires_at timestamptz;

-- ------------------------------------------------------------
-- 2. Column-level entitlement clamp.
--    Fires on every write to public.users. It is a NO-OP for trusted
--    server paths — the service role, the SQL editor, and the
--    auth.users signup trigger none of which carry a user JWT — and for
--    anonymous writes (RLS already blocks those). It only ever rewrites
--    the two entitlement columns, so every other column a client
--    legitimately edits (bio, interests, share_*, social_*, status,
--    notifications_enabled, ...) is untouched.
-- ------------------------------------------------------------
create or replace function public.clamp_user_protected_columns()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- PostgREST exposes the request's role as `request.jwt.claim.role`
  -- (legacy, per-claim) and inside the `request.jwt.claims` JSON.
  v_role text := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
  v_is_client boolean;
begin
  -- A client write is one that carries a user JWT and is not the
  -- service role. Server code and internal triggers carry no user JWT
  -- (auth.uid() is null), so they pass through unchanged.
  v_is_client := auth.uid() is not null and v_role <> 'service_role';

  if not v_is_client then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A row created by a client never carries entitlement.
    new.section2_unlocked := false;
    new.section2_free_expires_at := null;
  else
    -- Existing values are preserved verbatim; the client may not change
    -- them. Deliberately not an error: the client's write simply has no
    -- effect on these two columns.
    new.section2_unlocked := old.section2_unlocked;
    new.section2_free_expires_at := old.section2_free_expires_at;
  end if;

  return new;
end;
$$;

drop trigger if exists clamp_user_protected_columns on public.users;
create trigger clamp_user_protected_columns
  before insert or update on public.users
  for each row
  execute function public.clamp_user_protected_columns();

-- ------------------------------------------------------------
-- 3. Server-side trial grant.
--    Replaces the handle_new_user() from supabase/sql/fix_rls.sql (which
--    is updated in the same change so a re-run cannot undo this). The
--    14-day Section 2 trial is now written by the server when the
--    profile row is created, instead of being calculated by the browser.
--    `on conflict do nothing` keeps it once-only per user.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, section2_unlocked, section2_free_expires_at)
  values (new.id, new.email, false, now() + interval '14 days')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 4. VERIFY after applying (read-only).
--
--  a) The clamp exists exactly once:
--       select tgname from pg_trigger
--        where tgrelid = 'public.users'::regclass
--          and tgname = 'clamp_user_protected_columns';   -- 1 row
--
--  b) A client write is discarded. Signed in as an ordinary (non-paying)
--     user, from the browser console:
--       await supabase.from('users')
--         .update({ section2_unlocked: true })
--         .eq('id', <myId>);
--       await supabase.from('users')
--         .select('section2_unlocked').eq('id', <myId>).single();
--       -- expect section2_unlocked STILL false
--
--  c) A verified payment still unlocks: complete an M-Pesa KSh 200
--     payment, then
--       select section2_unlocked from public.users where id = <myId>;
--       -- expect true (the callback writes with the service role, which
--       -- the clamp lets through)
--
--  d) The trial is granted on signup: create a throwaway account, then
--       select section2_free_expires_at from public.users
--        where id = '<new-user-uuid>';   -- ≈ now() + 14 days
--
--  NOTE: this migration only stops FUTURE client writes. It does not
--  reset existing rows, so no current user loses access. Any account that
--  already forged section2_unlocked=true keeps it until corrected
--  deliberately (see the audit report for the reconciliation query).
-- ------------------------------------------------------------
