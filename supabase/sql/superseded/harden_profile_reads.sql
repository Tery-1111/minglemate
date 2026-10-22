-- ============================================================
-- HARDENING: column-scoped profile reads
--
-- Problem: the users RLS policy "users_select_authenticated"
-- exposes EVERY column to EVERY logged-in user, including:
--   * onesignal_player_id → anyone can push-notify any user
--     via send-notification (src/utils/notifications.js does
--     exactly this — and it's the documented pattern)
--   * phone, whatsapp_number, email → contact harvesting
--     (the chat paywall exists to hide exactly this!)
--   * payment / unlock bookkeeping columns
--
-- Strategy (all idempotent):
--   1. Replace blanket SELECT with a COLUMN-LEVEL grant on
--      non-sensitive columns only. Direct `select('*')` and
--      direct reads of email/phone/onesignal_player_id fail.
--   2. profiles_public view (security_invoker=on) over those
--      columns: RLS still applies, code reads it for other users.
--   3. my_profile() — SECURITY DEFINER RPC returning YOUR full
--      row (uid is server-derived via auth.uid(), not spoofable).
--   4. get_match_contact() — SECURITY DEFINER paywall: returns a
--      match's contact info ONLY if you're actually paired in
--      match_history AND an unlock condition truly holds.
--   INSERT/UPDATE/DELETE grants stay table-wide; RLS policies
--   (fix_rls.sql) gate them to own-row writes.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Column-scoped SELECT on the base table
-- ------------------------------------------------------------
revoke select on public.users from anon, authenticated;

grant select (
  id, full_name, age, gender, bio, interests, campus_id,
  residence_type, display_phone, profile_status,
  section1_complete, section1_progress, section1_last_edited,
  section2_unlocked, section2_free_expires_at, created_at
) on public.users to anon, authenticated;

-- service_role (edge functions) keeps unrestricted access
grant select on public.users to service_role;

-- ------------------------------------------------------------
-- 2. Public profile view — what OTHER users may see
-- ------------------------------------------------------------
create or replace view public.profiles_public
with (security_invoker = on) as
select
  id, full_name, age, gender, bio, interests, campus_id,
  residence_type, display_phone, profile_status,
  section1_complete, section2_unlocked, section2_free_expires_at,
  created_at
from public.users;

grant select on public.profiles_public to anon, authenticated;

-- ------------------------------------------------------------
-- 3. Your own row, full columns, server-derived uid
--    (definer so it works without any base-table grants;
--     it can only ever return YOUR row)
-- ------------------------------------------------------------
create or replace function public.my_profile()
returns setof public.users
language sql
security definer
set search_path = public
as $$
  select * from public.users where id = auth.uid();
$$;

grant execute on function public.my_profile() to authenticated;

-- ------------------------------------------------------------
-- 4. Paywall-enforced contact unlock (replaces reading the
--    match's contact columns directly — previously ANY user
--    could read them regardless of payment state)
-- ------------------------------------------------------------
create or replace function public.get_match_contact(match_user_id uuid)
returns table (
  display_phone text,
  phone text,
  whatsapp_number text,
  email text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.users;
  target public.users;
  paired boolean;
  now_ts timestamptz := now();
begin
  select * into me from public.users where id = auth.uid();
  select * into target from public.users where id = match_user_id;

  if me is null or target is null then
    return;
  end if;

  -- must actually be weekly matches, either direction
  select exists (
    select 1 from public.match_history mh
    where (mh.user_id = me.id and mh.tier1_match_id = target.id)
       or (mh.user_id = me.id and mh.tier2_match_id = target.id)
       or (mh.user_id = target.id and mh.tier1_match_id = me.id)
       or (mh.user_id = target.id and mh.tier2_match_id = me.id)
  ) into paired;

  if not paired then
    return;
  end if;

  -- paywall: either side paid, or either side's free trial is live
  if me.section2_unlocked
     or target.section2_unlocked
     or (me.section2_free_expires_at is not null and me.section2_free_expires_at > now_ts)
     or (target.section2_free_expires_at is not null and target.section2_free_expires_at > now_ts) then
    return query
      select target.display_phone, target.phone, target.whatsapp_number, target.email;
  end if;
end;
$$;

grant execute on function public.get_match_contact(uuid) to authenticated;

-- ============================================================
-- CLIENT STATE AFTER THIS RUNS (already applied in src/):
--   ✔ Matches.jsx  → reads .from('profiles_public')
--   ✔ Chat.jsx     → own row via .rpc('my_profile'); match row
--                    via profiles_public; contact reveal via
--                    .rpc('get_match_contact')
--   Still using granted own-row columns directly (fine):
--     Home, Section1, Section2, ProfileSetup, Signup
--   TODO for you:
--   * Profile.jsx still does .select('*') on its OWN row —
--     switch to .rpc('my_profile') (works, returns array)
--   * src/utils/notifications.js is dead code AND unsafe
--     (client fetches recipient player ids). Delete it; move
--     player-id lookup inside the send-notification function.
--   * Admin.jsx queries all users' rows as the logged-in admin —
--     needs a real admin role/policy, out of scope here.
-- ============================================================
