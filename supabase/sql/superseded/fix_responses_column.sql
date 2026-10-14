-- ============================================================
-- FIX: user_responses.responses_array type — integer[] → text[]
-- Run standalone in Supabase Dashboard → SQL Editor (any time,
-- before or after the other bundles; no dependencies).
-- Safe to re-run (checks current type first).
--
-- WHY: The adopted 50-question engine (match-generator →
-- compatibilityEngine.ts) compares ANSWER TEXT between users
-- (answersAreSimilar: word-overlap on option strings).
-- Section1.jsx correctly writes option text, but the column is
-- still integer[] from the old 40-question index system, so every
-- answer insert fails with:
--   22P02 invalid input syntax for type integer
-- Existing data (if any) is numeric indices from the old system;
-- the cast preserves them as text (they simply read as stale
-- indices the UI ignores — string answers never equal an index).
-- ============================================================

do $$
declare
  col_type text;
begin
  select data_type
    into col_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name   = 'user_responses'
     and column_name  = 'responses_array';

  if col_type is null then
    raise notice 'user_responses.responses_array not found — nothing to do';
  elsif col_type = 'ARRAY' then
    select format_type(a.atttypid, a.atttypmod)
      into col_type
      from pg_attribute a
     where a.attrelid = 'public.user_responses'::regclass
       and a.attname  = 'responses_array'
       and not a.attisdropped;

    if col_type = 'integer[]' or col_type = 'int4[]' or col_type = 'bigint[]' then
      alter table public.user_responses
        alter column responses_array type text[]
        using responses_array::text[];
      raise notice 'responses_array migrated to text[] ✓';
    else
      raise notice 'responses_array is already % — nothing to do', col_type;
    end if;
  else
    raise notice 'responses_array is non-array type % — inspect manually', col_type;
  end if;
end
$$;

-- If RLS was somehow disabled on this table, keep it locked
-- (owner-only answers — mirrors fix_rls.sql Part 2).
alter table public.user_responses enable row level security;
