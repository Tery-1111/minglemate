-- ============================================================================
-- C3 — messages INSERT policy consolidation
-- ============================================================================
-- Problem
--   Staging carries three INSERT policies on public.messages that all admit the
--   same shape of row but only one of them enforces the relationship guards:
--
--     * "Allow users to send messages_v2"  WITH CHECK (auth.uid() = sender_id)
--     * "Users can send messages"          WITH CHECK (auth.uid() = sender_id)
--     * messages_insert_own_sender         WITH CHECK (
--           sender_id = auth.uid()
--           AND NOT EXISTS (block in either direction)
--           AND NOT EXISTS (conversation locked or unmatched) )
--
--   Postgres ORs permissive policies together, so the two narrow policies defeat
--   the block and locked/unmatched guards on the canonical one: a blocked user,
--   or a user whose conversation is locked/unmatched, can still insert messages.
--   Production already has only the canonical policy (verified: 1 INSERT policy).
--
-- Scope
--   Drops exactly two named policies. SELECT, UPDATE and DELETE policies are not
--   touched. No tables, columns, functions or rows are modified.
--
-- Canonical expression pinning
--   The canonical policy's WITH CHECK is pinned by MD5 over its whitespace-
--   normalised expression. The approved digest is:
--       b3a0c998abb38b4917d29a6f0c8d2b19
--   computed as md5(regexp_replace(with_check, '\s+', ' ', 'g')). This digest was
--   derived from the verified live definition and is environment-independent
--   (production and staging both hash to it). Any logical change to the policy --
--   an added or removed predicate, a flipped comparison, a different role set --
--   changes the digest and aborts the migration.
--
-- Fail-closed behaviour
--   If the canonical policy is missing, misnamed, carries the wrong role set, is not
--   PERMISSIVE, or its normalized expression does not match the approved digest, the
--   migration raises and rolls back. If either policy being removed is not in its
--   expected sender-only PERMISSIVE shape, the migration raises and rolls back
--   rather than dropping an unrecognised policy. Non-INSERT policy definitions are
--   captured before the change (including the PERMISSIVE/RESTRICTIVE property) and
--   asserted unchanged afterwards.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Preconditions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_canonical      record;
  v_wrong_count    int;
  v_policy         record;
  v_expected_names text[] := array['Allow users to send messages_v2', 'Users can send messages'];
  v_approved_md5   text   := 'b3a0c998abb38b4917d29a6f0c8d2b19';
  v_expected_check text   := '(auth.uid() = sender_id)';
begin
  if to_regclass('public.messages') is null then
    raise exception 'C3 precondition failed: table public.messages does not exist';
  end if;

  if not exists (select 1 from pg_class where oid = 'public.messages'::regclass and relrowsecurity) then
    raise exception 'C3 precondition failed: RLS is not enabled on public.messages';
  end if;

  -- ---- 1. The canonical policy must be exactly the approved policy. ---------
  select policyname, cmd, array_to_string(roles, ',') as roles,
         permissive,
         with_check,
         regexp_replace(coalesce(with_check, ''), '\s+', ' ', 'g') as wc_norm,
         md5(regexp_replace(coalesce(with_check, ''), '\s+', ' ', 'g')) as wc_md5
    into v_canonical
    from pg_policies
   where schemaname = 'public' and tablename = 'messages'
     and policyname = 'messages_insert_own_sender';

  if not found then
    raise exception
      'C3 precondition failed: canonical policy messages_insert_own_sender is missing';
  end if;

  -- Only a PERMISSIVE policy contributes row visibility through OR; a RESTRICTIVE
  -- one is ANDed and would not be combined with the superseded policies at all.
  -- The whole consolidation premise therefore requires PERMISSIVE.
  if v_canonical.permissive <> 'PERMISSIVE' then
    raise exception
      'C3 precondition failed: messages_insert_own_sender is % (expected PERMISSIVE)',
      v_canonical.permissive;
  end if;

  if v_canonical.cmd <> 'INSERT' then
    raise exception
      'C3 precondition failed: messages_insert_own_sender has command % (expected INSERT)',
      v_canonical.cmd;
  end if;

  if v_canonical.roles <> 'authenticated' then
    raise exception
      'C3 precondition failed: messages_insert_own_sender targets roles [%] (expected authenticated)',
      v_canonical.roles;
  end if;

  -- USING must be absent on an INSERT policy.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'messages'
       and policyname = 'messages_insert_own_sender' and qual is not null
  ) then
    raise exception
      'C3 precondition failed: messages_insert_own_sender unexpectedly has a USING expression';
  end if;

  -- ---- 2. Its normalized WITH CHECK must match the approved digest. --------
  if v_canonical.wc_md5 <> v_approved_md5 then
    raise exception
      'C3 precondition failed: messages_insert_own_sender WITH CHECK digest % does not match approved %',
      v_canonical.wc_md5, v_approved_md5;
  end if;

  -- Belt-and-braces: the digest must describe a policy carrying both guards.
  if position('user_blocks' in v_canonical.wc_norm) = 0
     or position('conversations' in v_canonical.wc_norm) = 0 then
    raise exception
      'C3 precondition failed: approved digest resolved to a policy without block/conversation guards';
  end if;

  -- ---- 3. The two policies being removed must be in their expected shape. --
  -- Idempotency: 2 => pending first apply, 0 => already applied (nothing to do).
  -- Any other count means unrecognised policies exist; refuse rather than guess.
  select count(*) into v_wrong_count
    from pg_policies
   where schemaname = 'public' and tablename = 'messages' and cmd = 'INSERT'
     and policyname <> 'messages_insert_own_sender';

  if v_wrong_count not in (0, 2) then
    raise exception
      'C3 precondition failed: expected 0 (already applied) or 2 (pending) superseded INSERT policies, found %',
      v_wrong_count;
  end if;

  -- Every superseded policy that IS present must be in the expected shape.
  for v_policy in
    select policyname, cmd, array_to_string(roles, ',') as roles, permissive, qual, with_check
      from pg_policies
     where schemaname = 'public' and tablename = 'messages' and cmd = 'INSERT'
       and policyname <> 'messages_insert_own_sender'
  loop
    if v_policy.policyname <> all (v_expected_names) then
      raise exception
        'C3 precondition failed: unexpected INSERT policy "%" present; refusing to guess', v_policy.policyname;
    end if;

    if v_policy.cmd <> 'INSERT' then
      raise exception 'C3 precondition failed: policy "%" has command % (expected INSERT)',
        v_policy.policyname, v_policy.cmd;
    end if;

    -- These policies only weaken the canonical one because they are PERMISSIVE and
    -- therefore ORed together. If a target were RESTRICTIVE the orphans' removal
    -- would be a no-op with respect to permissiveness and the premise is wrong.
    if v_policy.permissive <> 'PERMISSIVE' then
      raise exception 'C3 precondition failed: policy "%" is % (expected PERMISSIVE)',
        v_policy.policyname, v_policy.permissive;
    end if;

    -- Sender-only shape: no USING clause, and WITH CHECK is exactly the
    -- sender-identity predicate once whitespace is normalized.
    if v_policy.qual is not null then
      raise exception 'C3 precondition failed: policy "%" unexpectedly has a USING expression',
        v_policy.policyname;
    end if;

    if regexp_replace(coalesce(v_policy.with_check, ''), '\s+', ' ', 'g')
       <> v_expected_check then
      raise exception
        'C3 precondition failed: policy "%" WITH CHECK is "%" (expected "%")',
        v_policy.policyname,
        regexp_replace(coalesce(v_policy.with_check, ''), '\s+', ' ', 'g'),
        v_expected_check;
    end if;
  end loop;

  -- Role sets of the two targets, verified explicitly when they are present.
  if exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='messages'
       and policyname='Allow users to send messages_v2'
  ) and not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='messages'
       and policyname='Allow users to send messages_v2'
       and cmd='INSERT' and array_to_string(roles, ',') = 'public'
  ) then
    raise exception
      'C3 precondition failed: "Allow users to send messages_v2" is not INSERT for role public';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='messages'
       and policyname='Users can send messages'
  ) and not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='messages'
       and policyname='Users can send messages'
       and cmd='INSERT' and array_to_string(roles, ',') = 'authenticated'
  ) then
    raise exception
      'C3 precondition failed: "Users can send messages" is not INSERT for role authenticated';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Capture non-INSERT policy definitions so we can prove they are untouched.
-- ---------------------------------------------------------------------------
create temp table c3_policy_snapshot on commit drop as
select cmd                                                          as cmd,
       policyname                                                   as policyname,
       array_to_string(roles, ',')                                  as roles,
       permissive                                                   as permissive,
       coalesce(qual, '-')                                          as using_expr,
       coalesce(with_check, '-')                                    as check_expr,
       md5(coalesce(cmd,'') || '|' || coalesce(policyname,'') || '|' ||
           coalesce(permissive,'') || '|' ||
           coalesce(array_to_string(roles, ','),'') || '|' ||
           coalesce(regexp_replace(coalesce(qual,''), '\s+', ' ', 'g'),'') || '|' ||
           coalesce(regexp_replace(coalesce(with_check,''), '\s+', ' ', 'g'),'')) as def_md5
  from pg_policies
 where schemaname = 'public' and tablename = 'messages' and cmd <> 'INSERT';

-- ---------------------------------------------------------------------------
-- The correction: drop only the two superseded permissive policies.
-- ---------------------------------------------------------------------------
drop policy if exists "Allow users to send messages_v2" on public.messages;
drop policy if exists "Users can send messages" on public.messages;

-- ---------------------------------------------------------------------------
-- Postconditions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_insert_count  int;
  v_canonical     record;
  v_changed       int;
  v_approved_md5  text := 'b3a0c998abb38b4917d29a6f0c8d2b19';
begin
  -- ---- 1. Exactly one INSERT policy remains. -------------------------------
  select count(*) into v_insert_count
    from pg_policies
   where schemaname = 'public' and tablename = 'messages' and cmd = 'INSERT';

  if v_insert_count <> 1 then
    raise exception
      'C3 postcondition failed: expected exactly 1 INSERT policy on messages, found %', v_insert_count;
  end if;

  -- ---- 2. It is messages_insert_own_sender, unchanged. ---------------------
  select policyname, cmd, array_to_string(roles, ',') as roles, permissive,
         regexp_replace(coalesce(with_check, ''), '\s+', ' ', 'g') as wc_norm,
         md5(regexp_replace(coalesce(with_check, ''), '\s+', ' ', 'g')) as wc_md5
    into v_canonical
    from pg_policies
   where schemaname = 'public' and tablename = 'messages'
     and cmd = 'INSERT';

  if not found then
    raise exception 'C3 postcondition failed: no INSERT policy on messages';
  end if;

  if v_canonical.policyname <> 'messages_insert_own_sender' then
    raise exception
      'C3 postcondition failed: surviving INSERT policy is "%" (expected messages_insert_own_sender)',
      v_canonical.policyname;
  end if;

  if v_canonical.roles <> 'authenticated' then
    raise exception
      'C3 postcondition failed: surviving INSERT policy targets roles [%] (expected authenticated)',
      v_canonical.roles;
  end if;

  -- Still PERMISSIVE: a RESTRICTIVE survivor would silently change the semantics
  -- from OR-combined permissive policies to an ANDed constraint.
  if v_canonical.permissive <> 'PERMISSIVE' then
    raise exception
      'C3 postcondition failed: surviving INSERT policy is % (expected PERMISSIVE)',
      v_canonical.permissive;
  end if;

  -- ---- 3. Its expression still matches the approved digest. ----------------
  if v_canonical.wc_md5 <> v_approved_md5 then
    raise exception
      'C3 postcondition failed: surviving INSERT policy digest % does not match approved %',
      v_canonical.wc_md5, v_approved_md5;
  end if;

  -- ---- 4. The two superseded policies are gone. ---------------------------
  if exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'messages'
       and policyname in ('Allow users to send messages_v2', 'Users can send messages')
  ) then
    raise exception 'C3 postcondition failed: a superseded INSERT policy still exists';
  end if;

  -- ---- 5. SELECT / UPDATE / DELETE definitions are unchanged. -------------
  select count(*) into v_changed
    from c3_policy_snapshot s
    full join (
      select cmd, policyname,
             md5(coalesce(cmd,'') || '|' || coalesce(policyname,'') || '|' ||
                 coalesce(permissive,'') || '|' ||
                 coalesce(array_to_string(roles, ','),'') || '|' ||
                 coalesce(regexp_replace(coalesce(qual,''), '\s+', ' ', 'g'),'') || '|' ||
                 coalesce(regexp_replace(coalesce(with_check,''), '\s+', ' ', 'g'),'')) as def_md5
        from pg_policies
       where schemaname = 'public' and tablename = 'messages' and cmd <> 'INSERT'
    ) c using (cmd, policyname)
   where s.def_md5 is distinct from c.def_md5;

  if v_changed <> 0 then
    raise exception
      'C3 postcondition failed: % non-INSERT policy definition(s) changed', v_changed;
  end if;

  -- The application still needs its SELECT policy to exist at all.
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'messages' and cmd = 'SELECT'
  ) then
    raise exception 'C3 postcondition failed: messages lost its SELECT policy';
  end if;

  raise notice 'C3 applied: messages has exactly 1 INSERT policy (messages_insert_own_sender, digest %)', v_approved_md5;
end
$$;

commit;
