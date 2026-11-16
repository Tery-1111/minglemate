-- ROLLBACK for: 20261116090000_production_e_gender_lock_bio_limit.sql
-- Environment : PRODUCTION (mhdjnhiqahsllbczbzpk).
-- Restores the exact original clamp_user_protected_columns() body that was
-- live before Section E, and removes ONLY the bio_max_300 constraint.

-- Everything below runs as ONE transaction: if any statement fails, nothing
-- is kept (no half-applied state).
begin;

create or replace function public.clamp_user_protected_columns()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if current_user in ('service_role', 'supabase_admin', 'postgres') then
    return new;  -- server-side writer (payment callback, definer triggers)
  end if;

  if tg_op = 'INSERT' then
    -- Client inserts never open paid access (defaults are safe).
    new.section2_unlocked := false;
    new.section2_free_expires_at := null;
  else
    -- Client updates keep whatever the server last stored.
    new.section2_unlocked := old.section2_unlocked;
    new.section2_free_expires_at := old.section2_free_expires_at;
  end if;

  return new;
end;
$function$;

alter table public.users drop constraint if exists bio_max_300;

commit;
