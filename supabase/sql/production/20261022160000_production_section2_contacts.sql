-- ============================================================
-- PRODUCTION BASELINE (2 of 2) — SECTION 2, CONNECT CONTACTS, FORCE CONNECT
--
-- Target: project `minglemate`, ref mhdjnhiqahsllbczbzpk.
-- Runs AFTER 20261022150000_production_baseline_objects.sql.
--
-- Owner decisions D1–D5 (docs/OWNER_DECISIONS_SECTION2_CONTACTS.md), as
-- applied to the production schema:
--
--   D1  Section 2 answers and progress are free to read and write. No
--       payment, entitlement, completion, unlock or expiry gate.
--   D2  Responses are readable by the owner or an eligible matched
--       partner (match_history tier slot in either direction, or a live
--       matches pair), never across a block in either direction.
--   D3  Contacts require BOTH a Connect payment for that specific pair
--       and the owner's current share_* choice, per channel. Question
--       count, progress or payment never reveals a contact.
--   D4  Section 2 stays outside matching (no matching file changes).
--   D5  No new Section 2 purchase (initiate-payment returns 400); the
--       legacy intasend-webhook keeps settling historical purchases, and
--       no payment record is deleted or reinterpreted.
--
-- PRODUCTION DIFFERENCES FROM THE STAGING BUILDS
--   * matches stores the pair as 'matched' (its check constraint has no
--     'active'); both labels are admitted, 'interested' is not, because
--     it is one-sided.
--   * complete_force_connect promotes/creates the pair with the live
--     columns (user_a_id, user_b_id, status, is_visible,
--     compatibility_score) — never the chain-only tier/created_by.
--   * The legacy question-count reveal is live here
--     (trg_contacts_unlocked -> enforce_contacts_unlocked and
--     trg_auto_contact_reveal -> handle_contact_reveal) and is removed.
--   * users rows were readable in full by every signed-in user, so
--     contact columns are withdrawn from client SELECT entirely and
--     my_profile() (written in the previous file) is the self read path.
--
-- WHAT THIS FILE DOES
--   1. Refuses to run unless the previous file's objects are present.
--   2. Drops the question-count reveal (both triggers, both functions)
--      and pins contacts_unlocked so no writer can grant it.
--   3. Installs is_section2_partner() and the Section 2 policies.
--   4. Installs users_are_paired(), complete_connect_unlock(),
--      complete_force_connect() and the D3 get_unlocked_contacts().
--   5. Revokes direct client access to every contact column and to the
--      legacy users.section2_responses array; proves internal helpers are
--      not executable by anon or PUBLIC.
--   6. Corrects the unsafe contacts_unlocked state the reveal produced.
--      No other row is changed.
--   7. Post-checks the result.
--
-- STATUS: APPLIED to minglemate (mhdjnhiqahsllbczbzpk) on 2026-10-22 —
--         recorded as version 20261022160000 in
--         supabase_migrations.schema_migrations. Section 2 free reads/writes,
--         partner scoping, block denial, D3 channel consent, Connect and
--         Force Connect idempotency were all exercised with rollback-scoped
--         writes on that database (docs/PRODUCTION_SECTION2_MIGRATION.md).
--
--         NOTE: pin_section2_contacts_flag() forces contacts_unlocked = false
--         on INSERT and UPDATE. The staging build preserved OLD on UPDATE,
--         which would have carried production's unsafe true value forward.
--
-- NOT IN supabase/migrations/ ON PURPOSE — see the companion file's header.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Preflight
-- ------------------------------------------------------------
do $$
declare
  missing text[] := array[]::text[];
begin
  if to_regclass('public.user_blocks') is null then
    missing := array_append(missing, 'table public.user_blocks');
  end if;
  if to_regclass('public.connect_unlocks') is null then
    missing := array_append(missing, 'table public.connect_unlocks');
  end if;
  if to_regclass('public.payment_intents') is null then
    missing := array_append(missing, 'table public.payment_intents');
  end if;
  if to_regclass('public.conversations') is null then
    missing := array_append(missing, 'table public.conversations');
  end if;
  if to_regprocedure('public.my_profile()') is null then
    missing := array_append(missing, 'function public.my_profile()');
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
      and column_name in ('share_phone', 'share_whatsapp', 'share_email',
                          'share_social_instagram', 'share_social_x', 'share_social_tiktok')
    group by table_name having count(*) = 6
  ) then
    missing := array_append(missing, 'users share_* columns');
  end if;

  if array_length(missing, 1) > 0 then
    raise exception
      '20261022150000_production_baseline_objects.sql has not been applied: %. Nothing was changed.',
      array_to_string(missing, '; ');
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. Remove the question-count contact reveal
-- ------------------------------------------------------------
drop trigger if exists trg_contacts_unlocked on public.section2_chat_progress;
drop trigger if exists trg_auto_contact_reveal on public.section2_chat_progress;

do $$
declare
  r record;
begin
  for r in
    select tgname from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname = 'section2_chat_progress'
      and not t.tgisinternal
      and p.proname in ('enforce_contacts_unlocked', 'handle_contact_reveal')
  loop
    execute format('drop trigger if exists %I on public.section2_chat_progress', r.tgname);
  end loop;

  for r in
    select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enforce_contacts_unlocked', 'handle_contact_reveal')
  loop
    execute format('drop function if exists %s', r.signature);
  end loop;
end $$;

-- The column stays (dropping it would destroy history), but it can no
-- longer be set by a client or derived from a question count.
create or replace function public.pin_section2_contacts_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Always false, on INSERT and UPDATE alike. Production still carries a
  -- true value written by the old 14-question trigger, so preserving OLD
  -- would carry that unsafe state forward; a question count buys nothing.
  new.contacts_unlocked := false;
  return new;
end;
$$;

drop trigger if exists trg_pin_contacts_flag on public.section2_chat_progress;
create trigger trg_pin_contacts_flag
  before insert or update on public.section2_chat_progress
  for each row execute function public.pin_section2_contacts_flag();

revoke all on function public.pin_section2_contacts_flag() from public;
revoke all on function public.pin_section2_contacts_flag() from anon;
revoke all on function public.pin_section2_contacts_flag() from authenticated;

-- ------------------------------------------------------------
-- 3. D2 in one place + Section 2 RLS
-- ------------------------------------------------------------
create or replace function public.is_section2_partner(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select a is not null
     and b is not null
     and a <> b
     and not exists (
       select 1 from public.user_blocks ub
       where (ub.blocker_id = a and ub.blocked_id = b)
          or (ub.blocker_id = b and ub.blocked_id = a)
     )
     and (
       exists (
         select 1 from public.match_history mh
         where (mh.user_id = a and (mh.tier1_match_id = b or mh.tier2_match_id = b))
            or (mh.user_id = b and (mh.tier1_match_id = a or mh.tier2_match_id = a))
       )
       or exists (
         select 1 from public.matches m
         -- Production stores a live pair as 'matched'; 'active' is the
         -- chain label. 'interested' stays out because it is one-sided.
         where m.status in ('active', 'matched')
           and ((m.user_a_id = a and m.user_b_id = b)
             or (m.user_a_id = b and m.user_b_id = a))
       )
     );
$$;

revoke all on function public.is_section2_partner(uuid, uuid) from public;
revoke all on function public.is_section2_partner(uuid, uuid) from anon;
grant execute on function public.is_section2_partner(uuid, uuid) to authenticated;
grant execute on function public.is_section2_partner(uuid, uuid) to service_role;

alter table public.section2_chat_progress enable row level security;

do $$
declare
  r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('section2_chat_progress', 'section2_responses')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "section2_progress_select_participants"
  on public.section2_chat_progress for select
  to authenticated
  using (user_id_a = auth.uid() or user_id_b = auth.uid());

create policy "section2_progress_insert_participants"
  on public.section2_chat_progress for insert
  to authenticated
  with check (user_id_a = auth.uid() or user_id_b = auth.uid());

create policy "section2_progress_update_participants"
  on public.section2_chat_progress for update
  to authenticated
  using (user_id_a = auth.uid() or user_id_b = auth.uid())
  with check (user_id_a = auth.uid() or user_id_b = auth.uid());

alter table public.section2_responses enable row level security;

create policy "section2_responses_select_own_or_partner"
  on public.section2_responses for select
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_section2_partner(user_id, auth.uid())
  );

create policy "section2_responses_insert_own"
  on public.section2_responses for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "section2_responses_update_own"
  on public.section2_responses for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke delete on public.section2_responses from anon;
revoke delete on public.section2_responses from authenticated;

-- ------------------------------------------------------------
-- 4. Pairing + paid Connect + Force Connect + the D3 reveal
-- ------------------------------------------------------------
create or replace function public.users_are_paired(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select a is not null
     and b is not null
     and a <> b
     and (
       exists (
         select 1 from public.match_history mh
         where (mh.user_id = a and (mh.tier1_match_id = b or mh.tier2_match_id = b))
            or (mh.user_id = b and (mh.tier1_match_id = a or mh.tier2_match_id = a))
       )
       or exists (
         select 1 from public.matches m
         where m.status in ('active', 'matched')
           and ((m.user_a_id = a and m.user_b_id = b)
             or (m.user_a_id = b and m.user_b_id = a))
       )
     );
$$;

revoke all on function public.users_are_paired(uuid, uuid) from public;
revoke all on function public.users_are_paired(uuid, uuid) from anon;
grant execute on function public.users_are_paired(uuid, uuid) to authenticated;
grant execute on function public.users_are_paired(uuid, uuid) to service_role;

create or replace function public.complete_connect_unlock(intent_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.payment_intents;
  buyer public.users;
  seller public.users;
  pair_a uuid;
  pair_b uuid;
  tier_name text;
  v_unlock_id uuid;
begin
  select * into it from public.payment_intents where id = intent_id;
  if it is null or it.status <> 'succeeded'
     or it.purpose not in ('connect_tier1', 'connect_tier2', 'connect_qrashe')
     or it.recipient_user_id is null then
    return;
  end if;

  select * into buyer from public.users where id = it.user_id;
  select * into seller from public.users where id = it.recipient_user_id;
  if buyer is null or seller is null or buyer.id = seller.id then
    return;
  end if;

  -- Server-side pairing re-check: unlock only real matches.
  if not public.users_are_paired(buyer.id, seller.id) then
    return;
  end if;

  tier_name := case it.purpose
    when 'connect_tier1' then 'tier1'
    when 'connect_tier2' then 'tier2'
    else 'qrashe'
  end;

  -- Idempotent snapshot insert; the rest runs only on the first insert,
  -- so repeated callbacks cannot duplicate state.
  insert into public.connect_unlocks (
    buyer_id, seller_id, tier, amount, payment_intent_id,
    phone, whatsapp_number, email, social_instagram, social_x, social_tiktok
  )
  select buyer.id, seller.id, tier_name, it.amount, it.id,
    case when seller.share_phone then seller.phone end,
    case when seller.share_whatsapp then seller.whatsapp_number end,
    case when seller.share_email then seller.email end,
    case when seller.share_social_instagram then seller.social_instagram end,
    case when seller.share_social_x then seller.social_x end,
    case when seller.share_social_tiktok then seller.social_tiktok end
  on conflict (buyer_id, seller_id) do nothing
  returning id into v_unlock_id;

  if v_unlock_id is null then
    return; -- already unlocked by a previous callback
  end if;

  pair_a := least(buyer.id, seller.id);
  pair_b := greatest(buyer.id, seller.id);

  insert into public.conversations (user_a_id, user_b_id, match_tier, status, locked_at)
  values (pair_a, pair_b, tier_name, 'locked', now())
  on conflict (user_a_id, user_b_id) do update
    set status = 'locked', locked_at = now(),
        match_tier = coalesce(public.conversations.match_tier, tier_name);

  insert into public.messages (sender_id, recipient_id, content, is_bot)
  values (buyer.id, seller.id, buyer.full_name || ' connected with you.', true);
end;
$$;

revoke all on function public.complete_connect_unlock(uuid) from public;
revoke all on function public.complete_connect_unlock(uuid) from anon;
revoke all on function public.complete_connect_unlock(uuid) from authenticated;
grant execute on function public.complete_connect_unlock(uuid) to service_role;

create or replace function public.complete_force_connect(intent_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.payment_intents;
  buyer public.users;
  target public.users;
  pair_a uuid;
  pair_b uuid;
  affected_rows integer;
begin
  -- Serialize duplicate payment callbacks for this intent.
  select pi.* into it
  from public.payment_intents pi
  where pi.id = intent_id
  for update;

  if it.id is null
     or it.purpose <> 'force_connect'
     or it.recipient_user_id is null
     or it.status <> 'succeeded' then
    return;
  end if;

  select u.* into buyer from public.users u where u.id = it.user_id;
  select u.* into target from public.users u where u.id = it.recipient_user_id;

  if buyer.id is null or target.id is null or buyer.id = target.id then
    return;
  end if;

  pair_a := least(buyer.id, target.id);
  pair_b := greatest(buyer.id, target.id);

  -- The active Qrashe conversation is the idempotency marker: the payment
  -- callback may be delivered repeatedly.
  if exists (
    select 1 from public.conversations c
    where c.user_a_id = pair_a
      and c.user_b_id = pair_b
      and c.match_tier = 'qrashe'
      and c.status = 'active'
  ) then
    return;
  end if;

  -- Production matches columns only: promote an existing pair or create
  -- one. There is no tier or created_by column here.
  update public.matches m
  set status = 'matched',
      is_visible = true,
      last_interaction_at = now()
  where (m.user_a_id = pair_a and m.user_b_id = pair_b)
     or (m.user_a_id = pair_b and m.user_b_id = pair_a);

  get diagnostics affected_rows = row_count;

  if affected_rows = 0 then
    insert into public.matches (
      user_a_id, user_b_id, status, is_visible, compatibility_score
    )
    values (pair_a, pair_b, 'matched', true, 0);
  end if;

  insert into public.conversations (
    user_a_id, user_b_id, match_tier, status, locked_at
  )
  values (pair_a, pair_b, 'qrashe', 'active', null)
  on conflict (user_a_id, user_b_id) do update
    set status = 'active',
        locked_at = null,
        match_tier = 'qrashe';

  insert into public.messages (sender_id, recipient_id, content, is_bot)
  values (
    buyer.id, target.id,
    '⚡ ' || buyer.full_name || ' sent you a Force Connect. You are now matched.',
    true
  );

  insert into public.notifications (user_id, message)
  values (
    target.id,
    '⚡ Force Connect: ' || buyer.full_name || ' connected with you.'
  );
end;
$$;

revoke all on function public.complete_force_connect(uuid) from public;
revoke all on function public.complete_force_connect(uuid) from anon;
revoke all on function public.complete_force_connect(uuid) from authenticated;
grant execute on function public.complete_force_connect(uuid) to service_role;

-- The only contact read path: a paid snapshot for THIS buyer and THIS
-- seller, filtered per channel by the owner's CURRENT consent. No Section
-- 2 progress, entitlement, trial or expiry input anywhere in the body.
create or replace function public.get_unlocked_contacts(other_user_id uuid)
returns table (
  phone text,
  whatsapp_number text,
  email text,
  social_instagram text,
  social_x text,
  social_tiktok text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  paid public.connect_unlocks;
  contact_owner public.users;
begin
  if me is null or other_user_id is null or me = other_user_id then
    return;
  end if;

  if not public.users_are_paired(me, other_user_id) then
    return;
  end if;

  select cu.* into paid
  from public.connect_unlocks cu
  where cu.buyer_id = me
    and cu.seller_id = other_user_id
  order by cu.created_at desc
  limit 1;

  if not found then
    return;
  end if;

  select u.* into contact_owner
  from public.users u
  where u.id = other_user_id;

  if not found then
    return;
  end if;

  return query
    select
      case when contact_owner.share_phone then paid.phone end,
      case when contact_owner.share_whatsapp then paid.whatsapp_number end,
      case when contact_owner.share_email then paid.email end,
      case when contact_owner.share_social_instagram then paid.social_instagram end,
      case when contact_owner.share_social_x then paid.social_x end,
      case when contact_owner.share_social_tiktok then paid.social_tiktok end;
end;
$$;

comment on function public.get_unlocked_contacts(uuid) is
  'D3: returns a contact channel only when a Connect snapshot for (auth.uid(), other_user_id) exists AND the owner currently shares that channel. Reads no Section 2 progress, entitlement, trial or expiry state.';

revoke all on function public.get_unlocked_contacts(uuid) from public;
revoke all on function public.get_unlocked_contacts(uuid) from anon;
grant execute on function public.get_unlocked_contacts(uuid) to authenticated;
grant execute on function public.get_unlocked_contacts(uuid) to service_role;

-- ------------------------------------------------------------
-- 5. Close the direct-database bypasses
--
--    users: table-level SELECT is replaced by per-column grants that
--    withhold every contact column and the legacy section2_responses
--    array. Own-row reads keep working through my_profile().
-- ------------------------------------------------------------
do $$
declare
  cols text;
  withheld constant text[] := array[
    'phone', 'whatsapp_number', 'display_phone', 'email',
    'social_instagram', 'social_x', 'social_tiktok',
    'section2_responses'
  ];
begin
  select string_agg(format('%I', attname), ', ' order by attnum)
  into cols
  from pg_attribute
  where attrelid = 'public.users'::regclass
    and attnum > 0
    and not attisdropped
    and attname <> all (withheld);

  if cols is null then
    raise exception 'users has no selectable columns; refusing to continue';
  end if;

  execute 'revoke select on public.users from anon';
  execute 'revoke select on public.users from authenticated';
  execute format('grant select (%s) on public.users to authenticated', cols);
end $$;

-- ------------------------------------------------------------
-- 6. Correct the unsafe reveal state (explicitly required)
-- ------------------------------------------------------------
update public.section2_chat_progress
set contacts_unlocked = false
where contacts_unlocked is true;

-- ------------------------------------------------------------
-- 7. Post-conditions
-- ------------------------------------------------------------
do $$
declare
  v_src text;
  v_secdef boolean;
  v_settings text[];
  v_policies int;
begin
  if exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc p on p.oid = t.tgfoid
    where c.relname = 'section2_chat_progress'
      and p.proname in ('enforce_contacts_unlocked', 'handle_contact_reveal')
  ) then
    raise exception 'a question-count contact-reveal trigger survived';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enforce_contacts_unlocked', 'handle_contact_reveal')
  ) then
    raise exception 'a question-count contact-reveal function survived';
  end if;

  if exists (select 1 from public.section2_chat_progress where contacts_unlocked) then
    raise exception 'contacts_unlocked is still true on a progress row';
  end if;

  select p.prosrc, p.prosecdef, p.proconfig
  into v_src, v_secdef, v_settings
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_unlocked_contacts'
    and pg_get_function_identity_arguments(p.oid) = 'other_user_id uuid';

  if v_src is null then
    raise exception 'get_unlocked_contacts(uuid) is missing';
  end if;
  if v_src ~* '(section2_chat_progress|contacts_unlocked|section2_unlocked|section2_free_expires_at|questions_discussed|section2_responses)' then
    raise exception 'get_unlocked_contacts still reads Section 2 state (D3 violation)';
  end if;
  if v_src !~* 'connect_unlocks' or v_src !~* 'share_phone' or v_src !~* 'users_are_paired' then
    raise exception 'get_unlocked_contacts does not gate on both D3 conditions plus the pairing guard';
  end if;
  if not v_secdef or v_settings is distinct from array['search_path=public'] then
    raise exception 'get_unlocked_contacts must stay SECURITY DEFINER with search_path=public (got secdef=%, settings=%)',
      v_secdef, v_settings;
  end if;

  -- Internal helpers are unreachable for anonymous callers.
  if has_function_privilege('anon', 'public.users_are_paired(uuid, uuid)', 'execute') then
    raise exception 'anon can execute users_are_paired';
  end if;
  if has_function_privilege('anon', 'public.complete_force_connect(uuid)', 'execute') then
    raise exception 'anon can execute complete_force_connect';
  end if;
  if has_function_privilege('anon', 'public.complete_connect_unlock(uuid)', 'execute') then
    raise exception 'anon can execute complete_connect_unlock';
  end if;
  if has_function_privilege('anon', 'public.get_unlocked_contacts(uuid)', 'execute') then
    raise exception 'anon can execute get_unlocked_contacts';
  end if;
  if has_function_privilege('anon', 'public.my_profile()', 'execute') then
    raise exception 'anon can execute my_profile';
  end if;
  if not has_function_privilege('authenticated', 'public.get_unlocked_contacts(uuid)', 'execute') then
    raise exception 'authenticated lost EXECUTE on get_unlocked_contacts';
  end if;
  if not has_function_privilege('authenticated', 'public.is_section2_partner(uuid, uuid)', 'execute') then
    raise exception 'authenticated lost EXECUTE on is_section2_partner';
  end if;

  -- No client path to a contact or Section 2 answer column.
  if has_column_privilege('authenticated', 'public.users', 'phone', 'select')
     or has_column_privilege('authenticated', 'public.users', 'whatsapp_number', 'select')
     or has_column_privilege('authenticated', 'public.users', 'email', 'select')
     or has_column_privilege('authenticated', 'public.users', 'display_phone', 'select')
     or has_column_privilege('authenticated', 'public.users', 'section2_responses', 'select') then
    raise exception 'authenticated can still read a users contact or Section 2 column directly';
  end if;
  if not has_column_privilege('authenticated', 'public.users', 'id', 'select')
     or not has_column_privilege('authenticated', 'public.users', 'full_name', 'select') then
    raise exception 'authenticated lost SELECT on the non-contact users columns the app reads';
  end if;
  if has_column_privilege('authenticated', 'public.connect_unlocks', 'phone', 'select')
     or has_column_privilege('authenticated', 'public.connect_unlocks', 'email', 'select') then
    raise exception 'authenticated can still read a connect_unlocks contact snapshot';
  end if;
  if not has_column_privilege('authenticated', 'public.connect_unlocks', 'id', 'select') then
    raise exception 'authenticated lost SELECT on connect_unlocks.id; the Connect CTA reads it';
  end if;

  if has_table_privilege('authenticated', 'public.payment_intents', 'select')
     or has_table_privilege('anon', 'public.payment_intents', 'select') then
    raise exception 'a client role can read payment_intents';
  end if;

  if not exists (select 1 from pg_class where oid = 'public.user_blocks'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.connect_unlocks'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.payment_intents'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.section2_responses'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.section2_chat_progress'::regclass and relrowsecurity) then
    raise exception 'row level security is not enabled on a protected table';
  end if;

  select count(*) into v_policies
  from pg_policies
  where schemaname = 'public'
    and policyname in (
      'section2_responses_select_own_or_partner',
      'section2_responses_insert_own',
      'section2_responses_update_own',
      'section2_progress_select_participants',
      'section2_progress_insert_participants',
      'section2_progress_update_participants'
    );
  if v_policies <> 6 then
    raise exception 'expected 6 Section 2 policies, found %', v_policies;
  end if;
end $$;
