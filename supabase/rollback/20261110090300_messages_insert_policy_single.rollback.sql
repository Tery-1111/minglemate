-- ============================================================================
-- ROLLBACK for C3 — 20261110090300_messages_insert_policy_single.sql
-- ============================================================================
-- WARNING: SECURITY-WEAKENING ROLLBACK.
--   Re-creating the two permissive INSERT policies restores the defect: Postgres
--   ORs permissive policies, so the block and locked/unmatched guards in
--   messages_insert_own_sender become ineffective again. Only run this if the
--   consolidation is proven to break legitimate messaging.
--
-- This file is NOT a migration. It lives outside supabase/migrations/.
--
-- Restores the EXACT pre-C3 staging policy definitions (verified before writing):
--   "Allow users to send messages_v2"  INSERT  roles=public       WITH CHECK (auth.uid() = sender_id)
--   "Users can send messages"          INSERT  roles=authenticated WITH CHECK (auth.uid() = sender_id)
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.messages') is null then
    raise exception 'C3 rollback precondition failed: table public.messages does not exist';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='messages' and policyname='messages_insert_own_sender'
  ) then
    raise exception 'C3 rollback precondition failed: canonical policy is missing; nothing to roll back onto';
  end if;
end
$$;

create policy "Allow users to send messages_v2"
  on public.messages
  for insert
  to public
  with check (auth.uid() = sender_id);

create policy "Users can send messages"
  on public.messages
  for insert
  to authenticated
  with check (auth.uid() = sender_id);

do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from pg_policies
   where schemaname='public' and tablename='messages' and cmd='INSERT';

  if v_count <> 3 then
    raise exception 'C3 rollback failed: expected 3 INSERT policies after rollback, found %', v_count;
  end if;

  raise notice 'C3 rolled back: permissive INSERT policies restored (SECURITY WEAKENED)';
end
$$;

commit;
