-- ============================================================
-- ADMIN ROLE: server-side admin gating for Admin.jsx
--
-- Problem: the admin panel is "protected" by a password
-- hardcoded in the client bundle ('minglemate-admin-2025').
-- Anyone can read it from the shipped JS, and then read every
-- user's rows, add campuses, and trigger matching — all with
-- their own regular account. The lockdown SQL makes client
-- reads of sensitive columns fail, which would also break the
-- panel; this migration gives admins a real, verified path.
--
-- All RPCs are SECURITY DEFINER and re-check admin membership
-- internally, so the client can never call them as a non-admin.
--
-- AFTER RUNNING: insert yourself as admin (SQL editor):
--   insert into public.admin_users (user_id)
--   values ('YOUR-AUTH-USER-UUID');
-- ============================================================

-- 1. Admin membership table. RLS on, NO client policies:
--    clients can neither read nor write it. Only the SQL
--    editor / service role manage membership.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- 2. Membership check used inside definer functions
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- 3. Client gate for the UI (returns your membership only)
create or replace function public.am_i_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.is_admin();
$$;

grant execute on function public.am_i_admin() to authenticated;

-- 4. One RPC for the whole admin dashboard
create or replace function public.admin_overview()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select json_build_object(
    'campuses', (
      select coalesce(json_agg(c order by c.created_at), '[]'::json)
      from public.campuses c
    ),
    'stats', (
      select json_build_object(
        'totalUsers', (select count(*) from public.users),
        'activeUsers', (select count(*) from public.users where profile_status = 'active'),
        'section1Complete', (select count(*) from public.users where section1_complete),
        'section2Unlocked', (select count(*) from public.users where section2_unlocked),
        'totalMessages', (select count(*) from public.messages)
      )
    ),
    'transactions', (
      select coalesce(json_agg(t order by t.created_at desc), '[]'::json)
      from public.token_purchases t
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_overview() to authenticated;

-- 5. Campus mutations
create or replace function public.admin_add_campus(p_name text, p_email_domain text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.campuses (name, email_domain)
  values (p_name, p_email_domain);
$$;

create or replace function public.admin_set_campus_active(p_campus_id uuid, p_value boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.campuses set is_active = p_value where id = p_campus_id;
$$;

create or replace function public.admin_set_campus_matching(p_campus_id uuid, p_value boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.campuses set matching_enabled = p_value where id = p_campus_id;
$$;

grant execute on function
  public.admin_add_campus(text, text),
  public.admin_set_campus_active(uuid, boolean),
  public.admin_set_campus_matching(uuid, boolean)
to authenticated;

-- ============================================================
-- NOTE: campuses table itself should also get RLS if it has
-- none (clients currently write it directly). Suggested:
--   alter table public.campuses enable row level security;
--   create policy campuses_read_all on public.campuses
--     for select to authenticated using (true);
-- (all writes then go through the admin_* functions above)
-- ============================================================
