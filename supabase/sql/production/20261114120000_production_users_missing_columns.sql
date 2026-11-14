-- Step A (applied directly to production on 2026-11-14): add the three missing
-- public.users columns the app already uses.
-- Definitions: profile_prompts and notifications_enabled come from
-- supabase/migrations/20261014150000_consolidated_schema_chain.sql (account settings
-- bundle), matching staging. looking_for comes from the live staging database, because
-- no DDL for it exists in the repo (the chain lists it as a precondition).
-- Idempotent. Rollback at the bottom.

begin;

alter table public.users
  add column if not exists profile_prompts jsonb not null default '[]'::jsonb;
alter table public.users
  add column if not exists notifications_enabled boolean not null default true;
alter table public.users
  add column if not exists looking_for text;

alter table public.users drop constraint if exists prompts_shape;
alter table public.users
  add constraint prompts_shape check (
    jsonb_typeof(profile_prompts) = 'array'
    and jsonb_array_length(profile_prompts) <= 3
  );

-- Reads: authenticated only (anon has no column reads on users in production).
grant select (profile_prompts, looking_for, notifications_enabled)
  on public.users to authenticated;

-- Writes: the app edits these on the caller's own row.
grant update (profile_prompts, looking_for, notifications_enabled)
  on public.users to authenticated;

-- Regression assertions: fail and roll back the whole step if anything is missing.
do $a$
begin
  if (select count(*) from information_schema.columns
       where table_schema='public' and table_name='users'
         and ((column_name='profile_prompts' and data_type='jsonb' and is_nullable='NO')
           or (column_name='notifications_enabled' and data_type='boolean' and is_nullable='NO')
           or (column_name='looking_for' and data_type='text' and is_nullable='YES'))) <> 3 then
    raise exception 'Step A: a column is missing or has the wrong type';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid='public.users'::regclass and conname='prompts_shape') then
    raise exception 'Step A: prompts_shape missing';
  end if;
  if not (has_column_privilege('authenticated','public.users','profile_prompts','SELECT')
      and has_column_privilege('authenticated','public.users','looking_for','SELECT')
      and has_column_privilege('authenticated','public.users','notifications_enabled','SELECT')) then
    raise exception 'Step A: select grant missing';
  end if;
  if has_column_privilege('anon','public.users','looking_for','SELECT')
     or has_column_privilege('anon','public.users','notifications_enabled','SELECT') then
    raise exception 'Step A: anon must not read these columns';
  end if;
end;
$a$;

commit;

-- ROLLBACK (only if needed; any data saved in these columns after Step A would be lost):
--   alter table public.users drop constraint if exists prompts_shape;
--   alter table public.users drop column if exists profile_prompts;
--   alter table public.users drop column if exists notifications_enabled;
--   alter table public.users drop column if exists looking_for;
