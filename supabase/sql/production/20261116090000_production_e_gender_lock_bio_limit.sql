-- PRODUCTION change record: Section E (gender lock + bio length limit)
-- Environment : PRODUCTION (mhdjnhiqahsllbczbzpk). Do NOT run on staging.
-- Status      : APPLIED to production on 2026-11-16 after explicit owner approval ("approve E").
-- Scope       : (1) gender can be set once by a client, then is locked.
--               (2) bio is limited to 300 characters (bio_max_300).
--               (3) existing Section 2 protections and the trusted
--                   server-side bypass are preserved exactly.
-- Excluded    : ALL campus-related changes (campus_id is untouched).

-- Everything below runs as ONE transaction: if any statement fails, nothing
-- is kept (no half-applied state).
begin;

-- Pre-check: refuse to run if an existing bio would violate the new limit.
do $$
begin
  if exists (select 1 from public.users where char_length(bio) > 300) then
    raise exception 'ABORT: at least one existing bio is longer than 300 characters';
  end if;
end $$;

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
    -- Gender can be set once (while empty); after that it is locked.
    -- A client can neither change nor clear it.
    if old.gender is not null then
      new.gender := old.gender;
    end if;
  end if;

  return new;
end;
$function$;

alter table public.users
  add constraint bio_max_300 check (bio is null or char_length(bio) <= 300);

commit;
