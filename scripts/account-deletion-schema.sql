-- ============================================================
-- Production-shaped fixture schema for the deletion artifact.
-- Runs inside the throwaway acct_del_scratch database.
-- Shapes follow the verified production columns; only what the artifact
-- touches is modelled. auth.users/auth.uid are provided as stubs.
-- ============================================================

create schema if not exists auth;
create schema if not exists scratch;

create table auth.users (id uuid primary key);

-- auth.uid() reads a session setting in the scratch DB.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  profile_status text not null default 'incomplete',
  notifications_enabled boolean not null default true,
  onesignal_player_id text
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  onesignal_player_id text
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade
);
create table public.user_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade
);
create table public.user_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade
);
create table public.section1_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade
);
create table public.section2_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade
);
create table public.section2_chat_progress (
  id uuid primary key default gen_random_uuid(),
  user_id_a uuid references public.users(id) on delete cascade,
  user_id_b uuid references public.users(id) on delete cascade
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid,
  recipient_id uuid,
  content text,
  has_contact_info boolean not null default false,
  sender_id_allows_bot boolean not null default false,
  is_bot boolean not null default false
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid references public.users(id) on delete cascade,
  user_b_id uuid references public.users(id) on delete cascade
);
create table public.user_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid references public.users(id) on delete cascade,
  blocked_id uuid references public.users(id) on delete cascade
);
create table public.likes (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.users(id) on delete cascade,
  recipient_id uuid references public.users(id) on delete cascade
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_a_id uuid references public.users(id) on delete cascade,
  user_b_id uuid references public.users(id) on delete cascade,
  status text,
  is_visible boolean not null default false,
  compatibility_score int
);
create table public.match_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  tier1_match_id uuid,
  tier2_match_id uuid
);
create table public.match_interactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid
);
create table public.match_behavior (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  match_history_id uuid,
  date date,
  value int
);
create table public.match_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid
);
create table public.match_signals (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid,
  receiver_id uuid
);
create table public.compatibility_scores (
  id uuid primary key default gen_random_uuid(),
  user_id_a uuid,
  user_id_b uuid,
  score int
);
create table public.engagement_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  value int
);
create table public.question_engagement_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  value int
);
create table public.badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid
);
create table public.user_reputation (
  id uuid primary key default gen_random_uuid(),
  user_id uuid
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid,
  reported_id uuid,
  reason text
);

-- Retention targets: production shape (currently cascading from auth/users).
create table public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  recipient_user_id uuid references public.users(id),
  phone text not null,
  amount int not null,
  status text not null check (status in ('pending','succeeded','failed','expired')),
  callback_key text,
  status_reason text,
  verification_detail text,
  unlock_error text,
  purpose text
);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  phone_number text not null,
  amount int,
  status text,
  match_id uuid references public.matches(id),
  unlock_status text
);
create table public.connect_unlocks (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid references public.users(id) on delete cascade,
  seller_id uuid references public.users(id) on delete cascade,
  tier text,
  amount int,
  payment_intent_id uuid references public.payment_intents(id),
  phone text,
  whatsapp_number text,
  email text
);
create table public.token_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  gifted_by uuid,
  amount int,
  status text
);
create table public.gift_transactions (
  id uuid primary key default gen_random_uuid(),
  gifter_user_id uuid,
  recipient_user_id uuid,
  amount int
);
create table public.payment_prompts (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid,
  recipient_user_id uuid,
  amount int
);
create table public.processed_payment_callbacks (
  id uuid primary key default gen_random_uuid(),
  intent_id uuid
);
