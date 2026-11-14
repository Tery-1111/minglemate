-- Hotfix (applied directly to production on 2026-11-14): restore the client UPDATE grant on the
-- Section 1 state columns that H-1 (20261113120000_users_update_privilege_hardening.sql) revoked.
-- H-1 assumed these columns were written "through the guarded RPC path". No such RPC exists, and
-- src/pages/Section1.jsx updates them directly, so Section 1 progress/completion could not save
-- (permission denied for table users). Safe because trg_section1_completion_guard
-- (enforce_section1_completion) clamps progress to 0-50 and discards a completion claim unless the
-- user has 50 valid stored answers. Verified with a rolled-back test: a false completion claim is
-- reset to section1_complete=false, progress=0. All other protected columns stay blocked.

begin;

grant update (section1_progress, section1_complete, section1_last_edited)
  on public.users to authenticated;

do $a$
begin
  if not (has_column_privilege('authenticated','public.users','section1_progress','UPDATE')
      and has_column_privilege('authenticated','public.users','section1_complete','UPDATE')
      and has_column_privilege('authenticated','public.users','section1_last_edited','UPDATE')) then
    raise exception 'Hotfix: section1 update grant missing';
  end if;
  if has_column_privilege('anon','public.users','section1_progress','UPDATE')
     or has_column_privilege('anon','public.users','section1_complete','UPDATE') then
    raise exception 'Hotfix: anon must not update section1 columns';
  end if;
  if has_column_privilege('authenticated','public.users','reputation_score','UPDATE')
     or has_column_privilege('authenticated','public.users','status','UPDATE')
     or has_column_privilege('authenticated','public.users','section2_unlocked','UPDATE')
     or has_column_privilege('authenticated','public.users','section2_free_expires_at','UPDATE')
     or has_column_privilege('authenticated','public.users','section2_responses','UPDATE')
     or has_column_privilege('authenticated','public.users','reg_number','UPDATE')
     or has_column_privilege('authenticated','public.users','email','UPDATE')
     or has_column_privilege('authenticated','public.users','id','UPDATE')
     or has_column_privilege('authenticated','public.users','created_at','UPDATE') then
    raise exception 'Hotfix: a protected column became writable';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid='public.users'::regclass
                    and tgname='trg_section1_completion_guard'
                    and tgenabled='O') then
    raise exception 'Hotfix: the Section 1 completion guard trigger is missing or disabled';
  end if;
end;
$a$;

commit;

-- ROLLBACK: revoke update (section1_progress, section1_complete, section1_last_edited)
--   on public.users from authenticated;
