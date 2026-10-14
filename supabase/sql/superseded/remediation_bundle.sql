-- ============================================================
-- REMEDIATION BUNDLE: payment_intents table + remaining RLS
-- (C2/C3/C4, H7, H8, M4) — run in Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. payment_intents — server-side record of every STK push.
--    initiate-payment inserts; payment-callback consumes.
-- ------------------------------------------------------------
create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null,
  amount numeric not null,
  status text not null default 'pending'
    check (status in ('pending','succeeded','failed')),
  checkout_request_id text unique,
  mpesa_transaction_id text unique,
  created_at timestamptz not null default now()
);

alter table public.payment_intents enable row level security;

-- Clients never read or write intents directly — zero policies.
-- Edge functions use the service role (bypasses RLS).

-- Rate-limit window queries need an index
create index if not exists payment_intents_user_created_idx
  on public.payment_intents (user_id, created_at desc);

-- ------------------------------------------------------------
-- 2. Idempotent purchases (M4): one row per M-Pesa receipt.
--    unique on payment_intents.mpesa_transaction_id above;
--    token_purchases gets the same treatment.
--    (If the table already has duplicates this will fail —
--     dedupe first: delete dupes keeping min(created_at).)
-- ------------------------------------------------------------
do $$
begin
  begin
    alter table public.token_purchases
      add constraint token_purchases_txn_unique unique (mpesa_transaction_id);
  exception when duplicate_table or undefined_table then null;
  end;
end $$;

-- ------------------------------------------------------------
-- 3. messages RLS (H7): participants read; sender = auth.uid()
--    on insert; no client updates/deletes.
-- ------------------------------------------------------------
alter table public.messages enable row level security;

drop policy if exists "messages_select_participants" on public.messages;
create policy "messages_select_participants"
  on public.messages for select
  to authenticated
  using (
    sender_id = auth.uid() or recipient_id = auth.uid()
  );

drop policy if exists "messages_insert_own_sender" on public.messages;
create policy "messages_insert_own_sender"
  on public.messages for insert
  to authenticated
  with check (sender_id = auth.uid());

-- ------------------------------------------------------------
-- 4. section2_chat_progress RLS (H8): participants only, and
--    contacts_unlocked can never be client-set to true — the
--    server trigger derives it from questions_discussed.
-- ------------------------------------------------------------
alter table public.section2_chat_progress enable row level security;

drop policy if exists "progress_select_participants" on public.section2_chat_progress;
create policy "progress_select_participants"
  on public.section2_chat_progress for select
  to authenticated
  using (
    user_id_a = auth.uid() or user_id_b = auth.uid()
  );

drop policy if exists "progress_insert_participants" on public.section2_chat_progress;
create policy "progress_insert_participants"
  on public.section2_chat_progress for insert
  to authenticated
  with check (
    user_id_a = auth.uid() or user_id_b = auth.uid()
  );

drop policy if exists "progress_update_participants" on public.section2_chat_progress;
create policy "progress_update_participants"
  on public.section2_chat_progress for update
  to authenticated
  using (
    user_id_a = auth.uid() or user_id_b = auth.uid()
  );

-- Server-side truth for the paywall flag (H8)
create or replace function public.enforce_contacts_unlocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 14+ questions discussed => contacts unlocked; client input ignored
  new.contacts_unlocked := (coalesce(new.questions_discussed, 0) >= 14);
  return new;
end;
$$;

drop trigger if exists trg_contacts_unlocked on public.section2_chat_progress;
create trigger trg_contacts_unlocked
  before insert or update on public.section2_chat_progress
  for each row execute function public.enforce_contacts_unlocked();

-- ------------------------------------------------------------
-- 5. Note: Chat.jsx's "14+ questions" threshold matches this
--    trigger's constant. If you change one, change both.
-- ------------------------------------------------------------
