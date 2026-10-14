-- ============================================================
-- ADMIN ROLE v2: server-side admin gating for Admin.jsx
--
-- v2 changes (Admin remediation):
--   * admin_add_campus / admin_set_campus_active /
--     admin_set_campus_matching now verify is_admin() INTERNALLY
--     (previously guarded only by GRANT — any authenticated user
--     could call them directly). Authorization happens inside the
--     privileged operation, not in the UI.
--   * admin_overview payments now read payment_intents (current
--     Force Connect / Connect / Section-2 payments). Legacy
--     token_purchases rows are merged in, marked 'legacy', so old
--     history stays visible. The legacy write path is preserved.
--   * New: admin user directory, user detail (audit-logged for
--     sensitive categories), and match-records views.
--
-- Idempotent: safe to re-run (if not exists / create or replace).
--
-- AFTER RUNNING, insert yourself as admin (SQL editor):
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

-- 1b. Audit log for admin access to sensitive user data.
--     RLS on, no client policies (admin-only, via definer fns).
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admin_users(user_id) on delete cascade,
  target_user_id uuid,
  category text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

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

-- 4. One RPC for the admin dashboard (campuses + stats + payments)
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
        'totalMessages', (select count(*) from public.messages),
        'totalMatches', (select count(*) from public.matches),
        'pendingPayments', (
          select count(*) from public.payment_intents where status = 'pending'
        ),
        'openReports', (select count(*) from public.reports)
      )
    ),
    -- Current payment system: payment_intents (Force Connect KSh 80,
    -- Connect KSh 70/50, Section-2 KSh 200). Last 100 by recency.
    -- Completed intents are matched to their matching row so the
    -- admin sees who paid whom, without exposing contact data.
    'transactions', (
      select coalesce(json_agg(t order by t.created_at desc), '[]'::json)
      from (
        select
          pi.id,
          pi.user_id,
          u.full_name as user_name,
          pi.purpose,
          pi.amount,
          pi.status,
          pi.created_at,
          pi.mpesa_receipt as mpesa_transaction_id,
          null::text as legacy_marker
        from public.payment_intents pi
        left join public.users u on u.id = pi.user_id
        order by pi.created_at desc
        limit 100
      ) t
    ),
    'legacy_transactions', (
      select coalesce(json_agg(t order by t.created_at desc), '[]'::json)
      from (
        select
          tp.id,
          tp.user_id,
          u.full_name as user_name,
          'section2_unlock'::text as purpose,
          tp.amount,
          tp.status,
          tp.created_at,
          tp.mpesa_transaction_id,
          'legacy'::text as legacy_marker
        from public.token_purchases tp
        left join public.users u on u.id = tp.user_id
        order by tp.created_at desc
        limit 100
      ) t
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_overview() to authenticated;

-- 5. Campus mutations — authorization INSIDE the operation.
create or replace function public.admin_add_campus(p_name text, p_email_domain text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  insert into public.campuses (name, email_domain)
  values (p_name, lower(trim(p_email_domain)));
end;
$$;

create or replace function public.admin_set_campus_active(p_campus_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  update public.campuses set is_active = p_value where id = p_campus_id;
end;
$$;

create or replace function public.admin_set_campus_matching(p_campus_id uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  update public.campuses set matching_enabled = p_value where id = p_campus_id;
end;
$$;

grant execute on function
  public.admin_add_campus(text, text),
  public.admin_set_campus_active(uuid, boolean),
  public.admin_set_campus_matching(uuid, boolean)
to authenticated;

-- ============================================================
-- 6. ADMIN USER DIRECTORY
--    Paged, searchable list of registered users. Contains only
--    non-sensitive fields (no phone/whatsapp/contacts/photos).
--    p_q matches name/email; p_status filters profile_status
--    ('all' = no filter); p_sort: created|name;
--    p_asc: ascending when true. p_page is 0-based, 25 rows.
-- ============================================================
create or replace function public.admin_users_list(
  p_q text default null,
  p_status text default 'all',
  p_sort text default 'created',
  p_asc boolean default false,
  p_page integer default 0
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
  v_offset integer;
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  v_offset := greatest(coalesce(p_page, 0), 0) * 25;

  select json_build_object(
    'total', (
      select count(*)
      from public.users ur
      where (coalesce(p_status, 'all') = 'all' or ur.profile_status = p_status)
        and (p_q is null or p_q = ''
             or ur.full_name ilike '%' || p_q || '%'
             or ur.email ilike '%' || p_q || '%')
    ),
    'users', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (
        select
          ur.id,
          ur.full_name,
          ur.email,
          ur.gender,
          ur.age,
          ur.campus_id,
          c.name as campus_name,
          ur.profile_status,
          ur.section1_complete,
          ur.section2_unlocked,
          ur.is_active,
          ur.created_at
        from public.users ur
        left join public.campuses c on c.id = ur.campus_id
        where (coalesce(p_status, 'all') = 'all' or ur.profile_status = p_status)
          and (p_q is null or p_q = ''
               or ur.full_name ilike '%' || p_q || '%'
               or ur.email ilike '%' || p_q || '%')
        order by
          case when p_sort = 'name' and coalesce(p_asc, false)
               then lower(ur.full_name) end asc nulls last,
          case when p_sort = 'name' and not coalesce(p_asc, false)
               then lower(ur.full_name) end desc nulls last,
          case when coalesce(p_sort, 'created') <> 'name' and coalesce(p_asc, false)
               then ur.created_at end asc nulls last,
          case when coalesce(p_sort, 'created') <> 'name' and not coalesce(p_asc, false)
               then ur.created_at end desc nulls last,
          ur.id
        limit 25
        offset v_offset
      ) t
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_users_list(text, text, text, boolean, integer) to authenticated;

-- ============================================================
-- 7. ADMIN USER DETAIL (audit-logged)
--    Server-authorized deep view of one user. Section 1: admin
--    always needs no reason. Sensitive categories (contacts,
--    questionnaire answers) require p_reason and are recorded in
--    admin_audit_log (admin id, target, category, reason, time).
--    p_categories: array subset of
--      'profile','status','questionnaire','contacts','matches'
-- ============================================================
create or replace function public.admin_user_detail(
  p_user_id uuid,
  p_categories text[] default array['profile','status'],
  p_reason text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid;
  result json;
  v_sensitive boolean := false;
begin
  select au.user_id into v_admin
  from public.admin_users au
  where au.user_id = auth.uid();
  if v_admin is null then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if 'contacts' = any (p_categories) or 'questionnaire' = any (p_categories) then
    v_sensitive := true;
  end if;

  if v_sensitive and (p_reason is null or length(trim(p_reason)) < 4) then
    raise exception 'A reason (min 4 characters) is required to access contacts or questionnaire answers';
  end if;

  select json_build_object(
    'profile', (
      select row_to_json(t)
      from (
        select
          ur.id, ur.full_name, ur.email, ur.gender, ur.age, ur.bio,
          ur.created_at, ur.campus_id, c.name as campus_name
        from public.users ur
        left join public.campuses c on c.id = ur.campus_id
        where ur.id = p_user_id
      ) t
    ),
    'status', (
      select json_build_object(
        'profile_status', ur.profile_status,
        'section1_complete', ur.section1_complete,
        'section2_unlocked', ur.section2_unlocked,
        'is_active', ur.is_active,
        'interests', ur.interests,
        'share_phone', ur.share_phone,
        'share_whatsapp', ur.share_whatsapp,
        'share_social', ur.share_social
      )
      from public.users ur where ur.id = p_user_id
    ),
    'photos', (
      select coalesce(json_agg(row_to_json(p) order by p.display_order), '[]'::json)
      from public.photos p
      where p.user_id = p_user_id and p.photo_type in ('facial','full_body')
    ),
    -- user_responses is one row per user: responses_array holds the
    -- 50 answers by index (Postgres array, 1-based). Emit
    -- {question_number, responses_array} per question so the UI can
    -- map index -> option text.
    'questionnaire', case
      when 'questionnaire' = any (p_categories) then (
        select coalesce(
          json_agg(
            json_build_object(
              'question_number', qn.qn,
              'responses_array', ur2.responses_array[qn.qn]
            )
            order by qn.qn
          ),
          '[]'::json
        )
        from generate_series(1, 50) as qn(qn)
        join public.user_responses ur2 on ur2.user_id = p_user_id
      )
      else null
    end,
    'contacts', case
      when 'contacts' = any (p_categories) then (
        select json_build_object(
          'phone', ur.phone,
          'whatsapp_number', ur.whatsapp_number,
          'social_handles', ur.social_handles
        )
        from public.users ur where ur.id = p_user_id
      )
      else null
    end,
    'matches', case
      when 'matches' = any (p_categories) then (
        select coalesce(json_agg(row_to_json(m)), '[]'::json)
        from (
          select
            ma.id, ma.tier, ma.compatibility_score, ma.created_at,
            case when ma.user_a_id = p_user_id
                 then ma.user_b_id else ma.user_a_id end as partner_id,
            pu.full_name as partner_name
          from public.matches ma
          join public.users pu
            on pu.id = case when ma.user_a_id = p_user_id
                            then ma.user_b_id else ma.user_a_id end
          where ma.user_a_id = p_user_id or ma.user_b_id = p_user_id
          order by ma.created_at desc
          limit 50
        ) m
      )
      else null
    end
  ) into result
  from (select 1) x;

  if v_sensitive then
    insert into public.admin_audit_log (admin_id, target_user_id, category, details)
    values (
      v_admin, p_user_id,
      case
        when 'contacts' = any (p_categories) and 'questionnaire' = any (p_categories)
          then 'contacts+questionnaire'
        when 'contacts' = any (p_categories) then 'contacts'
        else 'questionnaire'
      end,
      json_build_object('reason', p_reason)
    );
  end if;

  return result;
end;
$$;

grant execute on function public.admin_user_detail(uuid, text[], text) to authenticated;

-- ============================================================
-- 8. ADMIN MATCH RECORDS
--    All match activity across all three types (tier1, tier2,
--    qrashe) plus the weekly delivery history. Read-only.
--    p_filter: 'all' | 'tier1' | 'tier2' | 'qrashe'
-- ============================================================
create or replace function public.admin_matches_list(
  p_filter text default 'all',
  p_page integer default 0
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
  v_offset integer;
begin
  if not public.is_admin() then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  v_offset := greatest(coalesce(p_page, 0), 0) * 25;

  select json_build_object(
    'total', (
      select count(*)
      from public.matches ma
      where coalesce(p_filter, 'all') = 'all' or ma.tier = p_filter
    ),
    'matches', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json)
      from (
        select
          ma.id,
          ma.tier,
          ma.compatibility_score,
          ma.created_at,
          ma.user_a_id,
          ua.full_name as user_a_name,
          ma.user_b_id,
          ub.full_name as user_b_name,
          (exists (
            select 1 from public.conversations cv
            where cv.match_id = ma.id
          )) as has_conversation
        from public.matches ma
        left join public.users ua on ua.id = ma.user_a_id
        left join public.users ub on ub.id = ma.user_b_id
        where coalesce(p_filter, 'all') = 'all' or ma.tier = p_filter
        order by ma.created_at desc
        limit 25
        offset v_offset
      ) t
    )
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_matches_list(text, integer) to authenticated;

-- ============================================================
-- NOTE: campuses table itself should also get RLS if it has
-- none (clients currently write it directly). Suggested:
--   alter table public.campuses enable row level security;
--   create policy campuses_read_all on public.campuses
--     for select to authenticated using (true);
-- (all writes then go through the admin_* functions above)
-- ============================================================
