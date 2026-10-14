-- fix_rate_limit_column.sql
--
-- CONFIRMED DEFECT: harden_resilience.sql created enforce_message_rate_limit()
-- referencing public.messages.created_at, but the messages table has no
-- created_at column — its timestamp column is sent_at. Every INSERT into
-- messages fails with 42703 (column m.created_at does not exist), so chat
-- send is broken on any project where this bundle was applied.
--
-- Fix: rebuild the function with the correct column. The rate-limit
-- semantics (60 messages per sender per hour, exception 'RATE_LIMITED')
-- are unchanged. payment_intents.created_at is valid and untouched.

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
      and m.sent_at > now() - interval '1 hour'
  ) >= 60 then
    raise exception 'RATE_LIMITED'
      using errcode = 'P0001',
            hint = 'Wait a bit before sending more messages.';
  end if;
  return new;
end;
$$;
