-- ============================================================
-- SECTION 2 — FREE TO WRITE, FREE TO READ, PAYMENT-ONLY CONTACTS
--
-- Owner decisions D1–D5 (2026-10-21), recorded verbatim in
-- docs/OWNER_DECISIONS_SECTION2_CONTACTS.md:
--
--   D1  Section 2 answers/progress are free to write and free to
--       read for weekly Tier 1/Tier 2 matches and Qrashe pairs. No
--       payment, entitlement flag, completion or expiry gates them.
--   D2  "Reading others" means the Section 2 answers of a matched
--       partner: a Tier 1/Tier 2 pair in match_history in either
--       direction, or an active row in matches, AND no user_blocks
--       row between the pair in either direction.
--   D3  Contact details are revealed only when BOTH hold: a
--       succeeded Connect payment covers that specific pair
--       (connect_unlocks / the paid snapshot), AND the contact
--       owner has the corresponding share_* flag enabled. Section 2
--       progress, completion or payment never reveals contacts.
--   D4  Section 2 stays completely outside matching
--       (scripts/verify-section2-isolation.mjs is untouched).
--   D5  get_match_contact() is dropped; initiate-payment rejects new
--       section2 purchases; payment-callback keeps processing old
--       ones; no payment records are deleted.
--
-- STATUS: APPLIED to minglemate-staging on 2026-10-22 — version
--         20261021120000 recorded in supabase_migrations.schema_migrations
--         (one transaction; every executable statement as written).
--
-- MUST RUN AFTER 20261014150000
--
--   Step 1's live capture is recorded in docs/LIVE_SECTION2_SCHEMA.md. It
--   was taken read-only on 2026-10-22 from project ref
--   ifiewinipbxxfvzpzezd (minglemate-staging). It supersedes the earlier
--   owner-reported findings A–F, which were taken from the OTHER project
--   in the organization — minglemate, ref mhdjnhiqahsllbczbzpk — a legacy
--   schema that has no connect_unlocks, payment_intents, user_blocks or
--   conversations and no users.share_* columns. Those findings are not
--   true of this target and nothing below is based on them.
--
--   Captured on the target, so Stage 0 passes by construction:
--     * section2_responses(id, user_id, question_number, answer_text,
--       created_at) with UNIQUE(user_id, question_number);
--     * section2_chat_progress with user_id_a, user_id_b,
--       questions_discussed, contacts_unlocked (+ last_question_sent,
--       created_at, updated_at, last_bot_question_at, is_archived);
--     * match_history(user_id, week_id, tier1_match_id, tier2_match_id);
--     * matches(user_a_id, user_b_id, status), 2 rows, all 'matched';
--     * user_blocks(blocker_id, blocked_id);
--     * roles anon/authenticated/service_role and auth.uid().
--
--   Two captured facts shape the stages below:
--     * matches.status on this schema is pending|interested|discarded|
--       matched|ghosted (matches_status_check); 'active' is a chain label
--       this database cannot store, and every live pair is 'matched'.
--       is_section2_partner() therefore admits ('active','matched').
--       'interested' stays excluded because it is one-sided (D2), which
--       is narrower than the live policy it replaces.
--     * the question-count reveal is live: trg_contacts_unlocked (BEFORE
--       INSERT OR UPDATE -> enforce_contacts_unlocked) and
--       trg_auto_contact_reveal (BEFORE UPDATE -> handle_contact_reveal)
--       both exist and are dropped by stage 1. get_match_contact(uuid)
--       also exists live and returns raw contacts whenever either side
--       holds section2_unlocked or a live trial; stage 4 revokes and
--       drops it.
--
--   Stage 0 remains unrelaxed: it refuses to run, before any change, if
--   the live shape drifts from the capture above. get_unlocked_contacts
--   is still left untouched here (stage 3b); its captured live body is
--   replaced by 20261021130000_section2_d3_contact_reveal.sql.
--
-- WHAT THIS MIGRATION DOES
--   1. Removes the question-count contact reveal: both live triggers
--      (trg_contacts_unlocked, trg_auto_contact_reveal) and both
--      functions (enforce_contacts_unlocked, handle_contact_reveal).
--      The retained contacts_unlocked column is pinned FALSE/unchanged
--      so a client can never self-grant a flag that used to matter.
--   2. Replaces the Section 2 RLS policies: own-row writes, own-row
--      plus matched-partner reads (D2), for section2_responses;
--      participant-only read/write for section2_chat_progress. No
--      policy references payment, entitlement, completion, expiry or
--      unlock columns.
--   3. Adds public.is_section2_partner(uuid, uuid): SECURITY DEFINER,
--      fixed search_path, the D2 definition in one place.
--   4. Drops get_match_contact(uuid), revoking its EXECUTE grants
--      first when it exists.
--
--   5. DOES NOT TOUCH get_unlocked_contacts(uuid). The live body is now
--      captured (docs/LIVE_SECTION2_SCHEMA.md): it returns the paid
--      snapshot without consulting the owner's share_* flags, and it
--      keeps a legacy branch that returns live contact values whenever
--      the pair's section2_chat_progress.contacts_unlocked is true. Both
--      fail D3, so the replace decision is settled: the replacement is
--      its own migration,
--      supabase/migrations/20261021130000_section2_d3_contact_reveal.sql,
--      which must be applied after this one.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No table or column is dropped, no row is inserted/updated/
--     deleted. payment_intents and connect_unlocks history is intact,
--     so payment-callback can still settle pre-change section2
--     intents.
--   * users.section2_unlocked / section2_free_expires_at are left in
--     place (they still record what old payments bought) but no
--     Section 2 policy, helper or UI path reads them.
--   * No database connection is made by the file existing in Git.
--     Apply through the normal migration flow after review.
--
-- SAFETY / IDEMPOTENCE
--   * Every drop is IF EXISTS or catalog-guarded; every create is
--     CREATE OR REPLACE or preceded by its own drop. Re-running is a
--     no-op.
--   * section2_responses is a provider-created precondition table: no
--     repository file creates it, so its stage is guarded by
--     to_regclass() and raises a NOTICE instead of failing a fresh
--     rebuild. section2_chat_progress is referenced unguarded by the
--     consolidated chain already (it is a hard precondition there).
-- ============================================================

-- ------------------------------------------------------------
-- 0. Live-schema assumptions — fail before ANY change
--
--    docs/LIVE_SECTION2_SCHEMA.md must be filled from the project
--    database before this file is applied. These checks are the
--    mechanical half of that requirement: if the live schema does not
--    have the tables/columns/roles the stages below name, nothing is
--    changed at all and the message names what is missing, so a
--    partially-matching schema cannot get half a security change.
--
--    Deliberately NOT asserted here (because no stage below depends on
--    them until the deferred contact stage is written):
--      connect_unlocks, users.share_*, payment_intents,
--      get_unlocked_contacts.
--
--    user_blocks is REQUIRED on purpose. Making it optional so this file
--    applies to a pre-chain database would create is_section2_partner()
--    without its block clause: a matched-partner read that ignores
--    blocking. The lineage is fixed before this file runs, never after.
--    (2026-10-22 findings A–F: see docs/SECTION2_LIVE_RECONCILIATION.md.)
-- ------------------------------------------------------------
do $$
declare
  missing text[] := array[]::text[];
begin
  if to_regclass('public.section2_chat_progress') is null then
    missing := array_append(missing, 'table public.section2_chat_progress');
  end if;
  if to_regclass('public.match_history') is null then
    missing := array_append(missing, 'table public.match_history');
  end if;
  if to_regclass('public.matches') is null then
    missing := array_append(missing, 'table public.matches');
  end if;
  if to_regclass('public.user_blocks') is null then
    missing := array_append(missing, 'table public.user_blocks');
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'section2_chat_progress'
      and column_name in ('user_id_a', 'user_id_b', 'questions_discussed', 'contacts_unlocked')
    group by table_name
    having count(*) = 4
  ) then
    missing := array_append(missing, 'section2_chat_progress(user_id_a,user_id_b,questions_discussed,contacts_unlocked)');
  end if;

  -- Optional: a fresh rebuild has no provider-created section2_responses.
  -- When it exists, its columns must be the ones the policy stage names.
  if to_regclass('public.section2_responses') is not null and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'section2_responses'
      and column_name in ('user_id', 'question_number', 'answer_text')
    group by table_name
    having count(*) = 3
  ) then
    missing := array_append(missing, 'section2_responses(user_id,question_number,answer_text)');
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'match_history'
      and column_name in ('user_id', 'tier1_match_id', 'tier2_match_id')
    group by table_name
    having count(*) = 3
  ) then
    missing := array_append(missing, 'match_history(user_id,tier1_match_id,tier2_match_id)');
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'matches'
      and column_name in ('user_a_id', 'user_b_id', 'status')
    group by table_name
    having count(*) = 3
  ) then
    missing := array_append(missing, 'matches(user_a_id,user_b_id,status)');
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_blocks'
      and column_name in ('blocker_id', 'blocked_id')
    group by table_name
    having count(*) = 2
  ) then
    missing := array_append(missing, 'user_blocks(blocker_id,blocked_id)');
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    missing := array_append(missing, 'role authenticated');
  end if;
  if to_regprocedure('auth.uid()') is null then
    missing := array_append(missing, 'function auth.uid()');
  end if;

  if array_length(missing, 1) > 0 then
    raise exception
      'Section 2 migration assumptions are not met on this database: %. Capture the live schema into docs/LIVE_SECTION2_SCHEMA.md and reconcile before applying.',
      array_to_string(missing, '; ');
  end if;
end $$;

-- ------------------------------------------------------------
-- 1. Remove the question-count contact reveal
--
--    Live evidence (2026-10-21 investigation):
--      trigger trg_contacts_unlocked      -> enforce_contacts_unlocked()
--      trigger trg_auto_contact_reveal    -> handle_contact_reveal()
--      both BEFORE INSERT OR UPDATE on public.section2_chat_progress
--
--    The explicit drops name the live objects; the two catalog loops
--    then catch any other trigger/function that carries the same
--    names, so the mechanism cannot survive under a second name on
--    the same table. Nothing here depends on a row count.
-- ------------------------------------------------------------
drop trigger if exists trg_contacts_unlocked on public.section2_chat_progress;
drop trigger if exists trg_auto_contact_reveal on public.section2_chat_progress;

do $$
declare
  r record;
begin
  -- Any remaining trigger on section2_chat_progress that calls a
  -- question-count reveal function.
  for r in
    select t.tgname
    from pg_trigger t
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

  -- The functions themselves, by their real identity (trigger
  -- functions carry no arguments, but dropping by OID-derived
  -- signature avoids guessing a declaration).
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('enforce_contacts_unlocked', 'handle_contact_reveal')
  loop
    execute format('drop function if exists %s', r.signature);
  end loop;
end $$;

-- The column survives (dropping it would destroy history and break
-- the guided-chat select('*')), but it no longer means anything and
-- no writer may set it. Pinning it keeps the old contract honest:
-- a client write can never flip a reveal flag, and no server path
-- derives it from a question count any more.
create or replace function public.pin_section2_contacts_flag()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.contacts_unlocked := coalesce(old.contacts_unlocked, false);
  else
    new.contacts_unlocked := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pin_contacts_flag on public.section2_chat_progress;
create trigger trg_pin_contacts_flag
  before insert or update on public.section2_chat_progress
  for each row execute function public.pin_section2_contacts_flag();

revoke all on function public.pin_section2_contacts_flag() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.pin_section2_contacts_flag() from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.pin_section2_contacts_flag() from authenticated';
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. D2 in one place: is b a matched partner of a?
--
--    Tier 1 / Tier 2 in match_history (either direction), or an
--    active row in matches (either direction), AND no block in
--    user_blocks (either direction). SECURITY DEFINER so the RLS
--    policy on section2_responses can evaluate it without needing
--    match_history/matches rows to be visible to the reader;
--    fixed search_path so the definition cannot be redirected.
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
       select 1
       from public.user_blocks ub
       where (ub.blocker_id = a and ub.blocked_id = b)
          or (ub.blocker_id = b and ub.blocked_id = a)
     )
     and (
       exists (
         select 1
         from public.match_history mh
         where (mh.user_id = a and (mh.tier1_match_id = b or mh.tier2_match_id = b))
            or (mh.user_id = b and (mh.tier1_match_id = a or mh.tier2_match_id = a))
       )
       or exists (
         select 1
         from public.matches m
         -- The target stores a matched pair as 'matched': its
         -- matches_status_check admits pending|interested|discarded|
         -- matched|ghosted, so 'active' is a chain label it cannot store.
         -- Admitting both keeps a chain-built database and the target
         -- working; 'interested' stays out because it is one-sided (D2).
         where m.status in ('active', 'matched')
           and ((m.user_a_id = a and m.user_b_id = b)
             or (m.user_a_id = b and m.user_b_id = a))
       )
     );
$$;

revoke all on function public.is_section2_partner(uuid, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.is_section2_partner(uuid, uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.is_section2_partner(uuid, uuid) to authenticated';
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Section 2 RLS
--
--    Both tables get their existing policies dropped by exact name
--    (read from pg_policies, so an unnamed live policy cannot linger
--    and widen access), then a complete, minimal replacement set:
--
--      section2_responses   SELECT own + matched partner (D2)
--                           INSERT/UPDATE own only
--      section2_chat_progress
--                           SELECT/INSERT/UPDATE participants only
--                           (the row is shared by the pair; "own"
--                           means "a row I am a participant of")
--
--    No policy mentions payment_intents, connect_unlocks,
--    entitlement_*, section2_unlocked, section2_free_expires_at,
--    contacts_unlocked, completion or expiry.
-- ------------------------------------------------------------
alter table public.section2_chat_progress enable row level security;

do $$
declare
  r record;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'section2_chat_progress'
  loop
    execute format('drop policy if exists %I on public.section2_chat_progress', r.policyname);
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

-- section2_responses is provider-created: guard the whole stage so a
-- fresh local rebuild (which has no such table) reports the gap
-- instead of aborting, while a live database gets the policies.
do $do$
declare
  r record;
begin
  if to_regclass('public.section2_responses') is null then
    raise notice 'public.section2_responses does not exist; Section 2 response policies were not created. See docs/BACKUP_PREFLIGHT_REPORT.md.';
    return;
  end if;

  execute 'alter table public.section2_responses enable row level security';

  for r in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'section2_responses'
  loop
    execute format('drop policy if exists %I on public.section2_responses', r.policyname);
  end loop;

  execute $policy$
    create policy "section2_responses_select_own_or_partner"
      on public.section2_responses for select
      to authenticated
      using (
        user_id = auth.uid()
        or public.is_section2_partner(user_id, auth.uid())
      )
  $policy$;

  execute $policy$
    create policy "section2_responses_insert_own"
      on public.section2_responses for insert
      to authenticated
      with check (user_id = auth.uid())
  $policy$;

  execute $policy$
    create policy "section2_responses_update_own"
      on public.section2_responses for update
      to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid())
  $policy$;
end
$do$;

-- ------------------------------------------------------------
-- 3b. get_unlocked_contacts(uuid) is left in place here; the D3
--     replacement is the follow-up migration.
--
--     The live definition is captured (docs/LIVE_SECTION2_SCHEMA.md):
--     one overload, TABLE(phone, whatsapp_number, email,
--     social_instagram, social_x, social_tiktok). Its paid branch returns
--     the snapshot without consulting the owner's share_* flags, and it
--     keeps a legacy free branch that returns live contact values
--     whenever the pair's section2_chat_progress.contacts_unlocked is
--     true and users_are_paired() passes (the 14-question reveal).
--
--     Both are D3 violations, so the replace/leave decision is settled:
--     the replacement is
--     supabase/migrations/20261021130000_section2_d3_contact_reveal.sql.
--
--     CONSEQUENCE, stated plainly: D3's second condition (the owner's
--     current share_* choice) and the removal of the free branch are NOT
--     enforced by this file. Until 130000 runs, the live function remains
--     the authority.
-- ------------------------------------------------------------

-- ------------------------------------------------------------
-- 4. Retire get_match_contact (D5)
--
--    It revealed phone/WhatsApp/email on either a paid snapshot or a
--    succeeded section2 intent, which is exactly the Section-2-payment
--    contact gate D3 removes. No repository code calls it. Revoke
--    first, then drop; absent on a database that never had it.
-- ------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.get_match_contact(uuid)') is not null then
    execute 'revoke all on function public.get_match_contact(uuid) from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on function public.get_match_contact(uuid) from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'revoke all on function public.get_match_contact(uuid) from authenticated';
    end if;
    execute 'drop function if exists public.get_match_contact(uuid)';
    raise notice 'Dropped public.get_match_contact(uuid) (D5).';
  else
    raise notice 'public.get_match_contact(uuid) was already absent.';
  end if;
end $$;
