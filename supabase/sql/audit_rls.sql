-- ============================================================
-- AUDIT: current RLS state for users and user_responses
-- Run this FIRST in Supabase Dashboard → SQL Editor and keep
-- the output for comparison. Read-only.
-- ============================================================

-- 1. Is RLS even enabled on the tables we care about?
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('users', 'user_responses')
order by tablename;

-- 2. Every policy on those tables (roles, commands, USING, WITH CHECK)
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('users', 'user_responses')
order by tablename, policyname;

-- 3. Any triggers already on auth.users (profile-creation trigger?)
select trigger_name, event_manipulation, action_statement
from information_schema.triggers
where trigger_schema = 'auth'
order by trigger_name;

-- 4. Optional: RLS picture across the whole public schema
--    (photos, payments, messages matter too)
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;
