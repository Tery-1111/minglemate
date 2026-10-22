-- seed_test_sessions.sql
-- Seeds auth.sessions + auth.refresh_tokens for the two liveness test users
-- (auth users seeded by liveness_seed.sql). Run against STAGING only.
--
-- Purpose: staging has mailer_autoconfirm=ON for the OTP login flow, so a
-- browser login sends an email code we cannot read (fake inboxes). Seeding a
-- session lets us sign the test users in without email codes, exactly like a
-- password grant would after an email confirmation.
--
-- This creates a real session (audit-visible) for throwaway test users only.
-- It does NOT touch the app schema, RLS, or any real user.

do $$
declare
  u record;
  sid uuid;
  tok text;
begin
  for u in select id, email from auth.users where email in ('liveness-alice@example.com','liveness-ben@example.com') loop
    select gen_random_uuid() into sid;
    tok := 'liveness-test-' || u.id::text || '-' || floor(extract(epoch from now()))::text;

    insert into auth.sessions (id, user_id, created_at, updated_at, aal, not_after, refreshed_at, user_agent, ip, tag)
    values (sid, u.id, now(), now(), 'aal1', now() + interval '7 days', null, 'liveness-seed-script', null, 'liveness')
    on conflict (id) do nothing;

    insert into auth.refresh_tokens (token, user_id, revoked, created_at, updated_at, parent, session_id)
    values (tok, u.id::text, false, now(), now(), null, sid)
    on conflict (token) do nothing;
  end loop;
end $$;

select email,
       (select count(*) from auth.sessions s where s.user_id = u.id) as sessions,
       (select count(*) from auth.refresh_tokens r where r.user_id = u.id::text and r.revoked = false) as refresh_tokens
from auth.users u
where email in ('liveness-alice@example.com','liveness-ben@example.com');
