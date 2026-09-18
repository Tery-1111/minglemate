-- ============================================================
-- FIX: RLS policies for `users` and `user_responses`
-- Run in Supabase Dashboard → SQL Editor.
-- Idempotent: drops then recreates each policy, so it is safe
-- to run regardless of the current live state.
--
-- Part 1 fixes the signup bug (profile row creation via trigger)
-- Part 2 locks Section 1 answers to their owner
-- ============================================================

-- ============================================================
-- PART 1 — users table
-- ============================================================

-- 1a. Auto-create the profile row when a user signs up.
--     SECURITY DEFINER bypasses RLS, so this works even while
--     the user has no session yet (email-confirmation flow).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 1b. Explicit policies (replace whatever exists — idempotent)

-- Anyone logged in can read profiles (core matchmaking feature).
-- NOTE: this exposes ALL columns incl. onesignal_player_id and
-- payment fields. Consider a view with selected columns later.
drop policy if exists "users_select_authenticated" on public.users;
create policy "users_select_authenticated"
  on public.users for select
  to authenticated
  using (true);

-- Logged-in users may insert their OWN profile row
-- (covers signup when email confirmation is disabled).
drop policy if exists "users_insert_own" on public.users;
create policy "users_insert_own"
  on public.users for insert
  to authenticated
  with check (id = auth.uid());

-- Users may update only their own profile.
drop policy if exists "users_update_own" on public.users;
create policy "users_update_own"
  on public.users for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ============================================================
-- PART 2 — user_responses table (Section 1 answers)
-- ============================================================

-- Ensure RLS is actually ON for this table.
alter table public.user_responses enable row level security;

-- Answers are private: owner-only for all operations.
-- (The match-generator edge function uses the service role key,
--  which bypasses RLS — matching keeps working.)
drop policy if exists "responses_select_own" on public.user_responses;
create policy "responses_select_own"
  on public.user_responses for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "responses_insert_own" on public.user_responses;
create policy "responses_insert_own"
  on public.user_responses for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "responses_update_own" on public.user_responses;
create policy "responses_update_own"
  on public.user_responses for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- DONE. Verify with audit_rls.sql afterwards.
--
-- Caveats to review manually:
--  * If any feature intentionally shows a MATCH's answers to the
--    other user (e.g. Section 2 comparison), that table needs a
--    scoped sharing policy via match_history — not a blanket one.
--  * If signup still shows an error after this, it is the client
--    upsert in Signup.jsx hitting the (now-correct) RLS wall as
--    anon — the trigger has already created the row, so the app
--    code should tolerate that error.
-- ============================================================
