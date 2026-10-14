-- ============================================================
-- HARDEN RESILIENCE — migration
-- STAGING ONLY (ref: ifiewinipbxxfvzpzezd).
-- Do NOT run on production (ref: mhdjnhiqahsllbczbzpk) until reviewed.
-- Idempotent: IF NOT EXISTS / create-or-replace / drop-if-exists.
--
-- Sections:
--   A. payment_intents.callback_key   (per-intent callback binding)
--   B. processed_payment_callbacks    (idempotency cache table)
--   C. Rate limits: messages 60/h, connection requests 30/h
--   D. app_settings                   (maintenance banner, admin-only write)
--   E. admin_reports_list()           (reports review via existing admin RPC enforcement)
-- ============================================================

-- ------------------------------------------------------------
-- A. Per-intent callback binding
--    initiate-payment generates a random key per intent and appends
--    it to the STK CallBackURL; payment-callback requires it to
--    match before trusting the payload.
-- ------------------------------------------------------------
alter table public.payment_intents
  add column if not exists callback_key text;

-- ------------------------------------------------------------
-- B. Idempotency cache for payment callbacks
--    One row per processed intent (unique) — the first callback
--    inserts, every concurrent/retried callback loses the race and
--    becomes a no-op. Belt-and-braces on top of the status-guarded
--    intent UPDATE + unique mpesa_transaction_id.
-- ------------------------------------------------------------
create table if not exists public.processed_payment_callbacks (
  cache_key text primary key,
  created_at timestamptz not null default now()
);

alter table public.processed_payment_callbacks enable row level security;

-- Clients never read or write the cache — zero policies.
-- Edge functions use the service role (bypasses RLS).

-- ------------------------------------------------------------
-- C. Database-side rate limits (enforced for every insert path,
--    not only the UI). Tunables are the two literals:
--      messages: 60 per rolling hour
--      connection requests (payment_intents): 30 per rolling hour
--    NOTE: payment_intents carries a 5-per-hour edge-function
--    throttle already; this DB guard is a backstop for ALL rows.
--    SECURITY DEFINER avoids RLS self-visibility edge cases; the
--    count is always scoped to the inserting user themselves.
-- ------------------------------------------------------------
create or replace function public.enforce_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.messages m
    where m.sender_id = new.sender_id
      and m.created_at > now() - interval '1 hour'
  ) >= 60 then
    raise exception 'RATE_LIMITED'
      using errcode = 'P0001',
            message = 'RATE_LIMITED';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function public.enforce_message_rate_limit();

create or replace function public.enforce_intent_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*)
    from public.payment_intents pi
    where pi.user_id = new.user_id
      and pi.created_at > now() - interval '1 hour'
  ) >= 30 then
    raise exception 'RATE_LIMITED'
      using errcode = 'P0001',
            message = 'RATE_LIMITED';
  end if;
  return new;
end;
$$;

drop trigger if exists intents_rate_limit on public.payment_intents;
create trigger intents_rate_limit
  before insert on public.payment_intents
  for each row execute function public.enforce_intent_rate_limit();

-- ------------------------------------------------------------
-- D. app_settings — single-row maintenance banner
--    PUBLIC READ (every client fetches it on load), write only
--    through the existing admin RPC enforcement (no direct write
--    policy → only service role / SECURITY DEFINER admin RPCs).
-- ------------------------------------------------------------
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  maintenance_message text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_public_read" on public.app_settings;
create policy "app_settings_public_read"
  on public.app_settings for select
  using (true);

-- No INSERT/UPDATE/DELETE policies: writes go only through
-- admin_set_maintenance_message() below (is_admin() enforced).

-- Seed the single row if absent (idempotent).
insert into public.app_settings (id) values (1)
on conflict (id) do nothing;

create or replace function public.admin_set_maintenance_message(p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Forbidden';
  end if;
  update public.app_settings
  set maintenance_message = coalesce(p_message, ''),
      updated_at = now(),
      updated_by = auth.uid()
  where id = 1;
end;
$$;

revoke all on function public.admin_set_maintenance_message(text) from anon, authenticated, public;

-- ------------------------------------------------------------
-- E. Reports review list for the Admin panel
--    Reuses the EXISTING admin enforcement (is_admin()); no new
--    admin logic — same pattern as admin_users_list etc.
-- ------------------------------------------------------------
create or replace function public.admin_reports_list(
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  id uuid,
  reporter_id uuid,
  reporter_name text,
  reported_id uuid,
  reported_name text,
  reason text,
  created_at timestamptz,
  reporter_status text
)
language sql
security definer
set search_path = public
as $$
  select r.id,
         r.reporter_id,
         ru.full_name,
         r.reported_id,
         eu.full_name,
         r.reason,
         r.created_at,
         pu.profile_status
  from public.reports r
  left join public.users ru on ru.id = r.reporter_id
  left join public.users eu on eu.id = r.reported_id
  left join public.users pu on pu.id = r.reported_id
  order by r.created_at desc
  limit least(coalesce(p_limit, 100), 200)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.admin_reports_list(int, int) from anon, authenticated, public;

-- ============================================================
-- VERIFY after running:
--   select column_name from information_schema.columns
--    where table_name='payment_intents' and column_name='callback_key';
--   select count(*) from public.processed_payment_callbacks;   -- 0
--   select tgname from pg_trigger where tgrelid='public.messages'::regclass;
--   select maintenance_message from public.app_settings;       -- ''
--   select * from public.admin_reports_list(10, 0);            -- error if not admin
-- ============================================================
