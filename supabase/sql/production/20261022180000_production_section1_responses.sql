-- ============================================================
-- PRODUCTION REMEDIATION — SECTION 1 ANSWERS AND COMPLETION
--
-- Target: project `minglemate`, ref mhdjnhiqahsllbczbzpk.
--
-- STATUS: NOT APPLIED. Prepared and tested 2026-10-22 against an isolated
--         PostgreSQL instance. Applying it changes the live schema and two
--         completion flags, so it needs the owner's explicit authorisation.
--         Execution steps are in docs/SECTION1_MATCHING_VERIFICATION.md.
--
-- DEFECTS THIS FIXES
--   D-1  `public.user_responses.responses_array` is `integer[] NOT NULL`,
--        while Section1.jsx writes the chosen OPTION TEXT ('In person') and
--        the engine compares option text. Read-only production check:
--          pg_input_is_valid('In person','integer') -> false
--          pg_input_is_valid('0','integer')         -> true
--        Every answer write therefore fails with 22P02 and no one can
--        complete Section 1.
--
--   D-2  The table carries the pre-rewrite policy
--        "Allow authenticated users to read any response matrix for match"
--        (USING auth.role() = 'authenticated'), so any signed-in user can read
--        every other user's answers. The repository's owner-only policies
--        were never applied here. `anon` also holds full table grants.
--
--   D-3  Completion is client-asserted. `section1_complete` and
--        `section1_progress` are in the client UPDATE grant and the own-row
--        policy, and the production clamp protects only the Section 2
--        entitlement columns. Nothing checks that 50 answers exist.
--
--   D-4  The one completed production profile holds the retired 40-slot
--        integer answer set. Cast to text it becomes '0'/'1', which the
--        text-comparing engine scores as zero matches; the profile is still
--        admitted as complete.
--
-- WHAT THIS FILE DOES
--   1. Preflight: refuses unless the table and column exist and the column is
--      an integer[]/bigint[]/text[] (anything else is unknown and stops).
--   2. Drops every existing policy on public.user_responses by catalog (the
--      production names are pre-rewrite), then installs owner-only
--      select/insert/update scoped to auth.uid().
--   3. Converts responses_array to text[] with an element cast. Every stored
--      value is preserved verbatim ('0' stays '0'); nothing is deleted.
--   4. Creates public.section1_question_options, a generated reference copy
--      of every option per question (200 rows; src/data/section1Questions.js
--      is the source, and `npm run verify` fails if they drift), and installs
--      public.section1_answers_are_complete(text[]): exactly 50 entries, each
--      one the option text belonging to that question. Legacy integer answers
--      ('0'/'1'), blanks and out-of-bank strings all fail.
--   5. Installs two guards:
--        * trg_section1_completion_guard (BEFORE INSERT/UPDATE on users)
--          validates the stored answers whenever section1_complete is set
--          true. Invalid -> complete false, progress 0. Valid -> progress 50.
--          A client can no longer self-assert completion.
--        * trg_section1_responses_guard (AFTER INSERT/UPDATE on
--          user_responses) downgrades a completed profile if its stored
--          answers are replaced with an incomplete/invalid set.
--   6. Resets section1_complete / section1_progress for every profile whose
--      stored answers are not the current 50-answer set, preserving the answer
--      row itself. The legacy profile must complete the current questionnaire
--      before it is eligible again; no answer is invented or reinterpreted.
--   7. Revokes all table privileges from `anon` on this table.
--   8. Post-checks the column type, the three owner policies, the absence of a
--      role-wide policy, both guards, zero anon grants, zero complete-but-
--      invalid profiles, the 200-row/50-question option bank, and reports
--      (does not modify) preserved legacy rows.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It does not change scoring weights, dimension mapping, or the engine.
--     The PRD's "emotional + space x2" versus the named "relationship
--     expectations" dimension is still an open product decision.
--   * It does not delete or rewrite user_responses rows, users, matches,
--     match_history, Section 2 data, payments or contact unlocks.
--   * It does not drop the unused SQL helpers public.calculate_compatibility /
--     public.get_bulk_compatibility_scores (also integer[]-based and not called
--     by src/). They are dead code; removing database objects is a separate
--     decision. After this change they would fail if anything called them.
--   * It does not force RLS: the service role (match-generator) must keep
--     reading answers across users.
--
-- DATA-PRESERVATION ASSESSMENT
--   Responses: converted in place, element by element; row count and every
--   value survive. Users: only section1_complete / section1_progress are
--   changed, and only where the stored answers are not a valid current set.
--   Everything else is untouched. Every statement is idempotent; the file can
--   be re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Preflight
-- ------------------------------------------------------------
do $$
declare
  column_type text;
begin
  if to_regclass('public.user_responses') is null then
    raise exception 'public.user_responses does not exist. Nothing was changed.';
  end if;

  select format_type(a.atttypid, a.atttypmod)
    into column_type
    from pg_attribute a
   where a.attrelid = 'public.user_responses'::regclass
     and a.attname = 'responses_array'
     and not a.attisdropped;

  if column_type is null then
    raise exception 'public.user_responses.responses_array does not exist. Nothing was changed.';
  end if;

  if column_type not in ('integer[]', 'int4[]', 'bigint[]', 'text[]') then
    raise exception
      'responses_array is %, which this fix does not handle. Nothing was changed.', column_type;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. Remove every existing policy on the table
-- ------------------------------------------------------------
do $$
declare
  policy_row record;
begin
  for policy_row in
    select p.polname
      from pg_policy p
     where p.polrelid = 'public.user_responses'::regclass
  loop
    execute format('drop policy if exists %I on public.user_responses', policy_row.polname);
    raise notice 'dropped policy % on public.user_responses', policy_row.polname;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3. integer[] -> text[], preserving every value
-- ------------------------------------------------------------
alter table public.user_responses
  alter column responses_array type text[]
  using responses_array::text[];

alter table public.user_responses
  alter column responses_array set not null;

comment on column public.user_responses.responses_array is
  'Section 1 answers: chosen option text, position i = question i+1 (Q1 at index 1). Unanswered is null.';

-- ------------------------------------------------------------
-- 4. The current question bank
--    A reference copy of every option, per question, so completion can be
--    validated against the real bank instead of "looks like an answer".
--    Generated from src/data/section1Questions.js by
--    scripts/generate-section1-option-bank.mjs; `npm run verify` fails if the
--    two drift. No client role can read or write this table; it is internal.
-- ------------------------------------------------------------
create table if not exists public.section1_question_options (
  question_number smallint not null check (question_number between 1 and 50),
  option_text text not null,
  primary key (question_number, option_text)
);

alter table public.section1_question_options enable row level security;
revoke all on table public.section1_question_options from anon, authenticated;

-- BEGIN GENERATED SECTION1 OPTION BANK
insert into public.section1_question_options (question_number, option_text) values
  (1, 'In person'),
  (1, 'Text messages'),
  (1, 'Phone calls'),
  (1, 'Video calls'),
  (2, 'Several times'),
  (2, 'Once or twice'),
  (2, 'Only when needed'),
  (2, 'At the end of the day'),
  (3, 'Eye contact'),
  (3, 'Thoughtful questions'),
  (3, 'Helpful advice'),
  (3, 'A caring response'),
  (4, 'Spend time together'),
  (4, 'Offer practical help'),
  (4, 'Give encouraging words'),
  (4, 'Remember small details'),
  (5, 'Very comfortable'),
  (5, 'Usually comfortable'),
  (5, 'Comfortable with trust'),
  (5, 'I need plenty of time'),
  (6, 'Deep and thoughtful'),
  (6, 'Light and playful'),
  (6, 'Balanced'),
  (6, 'Focused on shared interests'),
  (7, 'Directly'),
  (7, 'Gently'),
  (7, 'With specific examples'),
  (7, 'After some time to reflect'),
  (8, 'Tell someone immediately'),
  (8, 'Share it online'),
  (8, 'Wait for the right moment'),
  (8, 'Show it through my energy'),
  (9, 'Make a joke'),
  (9, 'Ask a new question'),
  (9, 'Acknowledge the awkwardness'),
  (9, 'Give the conversation space'),
  (10, 'Essential at all times'),
  (10, 'Important but considerate'),
  (10, 'Important for serious matters'),
  (10, 'It depends on the situation'),
  (11, 'Talk it through'),
  (11, 'Take a short break'),
  (11, 'Listen before responding'),
  (11, 'Try to find common ground'),
  (12, 'Immediately'),
  (12, 'Within the same day'),
  (12, 'After everyone cools down'),
  (12, 'When a solution feels clear'),
  (13, 'Quiet reflection'),
  (13, 'Clear facts'),
  (13, 'A reassuring tone'),
  (13, 'Physical space'),
  (14, 'Apologize right away'),
  (14, 'Explain my perspective'),
  (14, 'Take time to process'),
  (14, 'Ask how to make it right'),
  (15, 'A sincere apology'),
  (15, 'A calm conversation'),
  (15, 'Time alone'),
  (15, 'A reassuring gesture'),
  (16, 'Focus on the issue'),
  (16, 'Share feelings openly'),
  (16, 'Look for a compromise'),
  (16, 'Agree to revisit it later'),
  (17, 'Discuss it directly'),
  (17, 'Write down my thoughts'),
  (17, 'Ask for support'),
  (17, 'Wait until I feel calmer'),
  (18, 'Taking responsibility'),
  (18, 'Showing understanding'),
  (18, 'Changing the behavior'),
  (18, 'Making amends'),
  (19, 'Very comfortable'),
  (19, 'Usually comfortable'),
  (19, 'I am still learning'),
  (19, 'Only when necessary'),
  (20, 'Insults'),
  (20, 'Shouting'),
  (20, 'Ignoring the issue'),
  (20, 'Threatening to leave'),
  (21, 'Talk to someone'),
  (21, 'Spend time alone'),
  (21, 'Write or create'),
  (21, 'Stay active'),
  (22, 'Being listened to'),
  (22, 'Physical affection'),
  (22, 'Practical help'),
  (22, 'Words of encouragement'),
  (23, 'Very openly'),
  (23, 'With trusted people'),
  (23, 'Mostly through actions'),
  (23, 'Only when necessary'),
  (24, 'Time with friends'),
  (24, 'Music or entertainment'),
  (24, 'Exercise or movement'),
  (24, 'Quiet time'),
  (25, 'Listen quietly'),
  (25, 'Offer comfort'),
  (25, 'Ask what they need'),
  (25, 'Help solve the problem'),
  (26, 'A thoughtful message'),
  (26, 'Quality time'),
  (26, 'A small surprise'),
  (26, 'Recognition of my effort'),
  (27, 'Essential'),
  (27, 'Very important'),
  (27, 'Important with balance'),
  (27, 'It develops over time'),
  (28, 'Company'),
  (28, 'Space'),
  (28, 'A clear plan'),
  (28, 'Gentle encouragement'),
  (29, 'Share it with others'),
  (29, 'Plan something fun'),
  (29, 'Enjoy a quiet moment'),
  (29, 'Express gratitude'),
  (30, 'Consistency'),
  (30, 'Vulnerability'),
  (30, 'Keeping promises'),
  (30, 'Respecting boundaries'),
  (31, 'Mutual support'),
  (31, 'Shared growth'),
  (31, 'Fun and companionship'),
  (31, 'Trust and stability'),
  (32, 'Most days'),
  (32, 'Several times'),
  (32, 'Once or twice'),
  (32, 'A flexible amount'),
  (33, 'A daily priority'),
  (33, 'Regularly available'),
  (33, 'Only when needed'),
  (33, 'Shared routines matter more'),
  (34, 'Plan well ahead'),
  (34, 'Plan a few days ahead'),
  (34, 'Decide spontaneously'),
  (34, 'Use a mix of both'),
  (35, 'Keeping every promise'),
  (35, 'Being present when needed'),
  (35, 'Communicating changes'),
  (35, 'Following through on priorities'),
  (36, 'Equally'),
  (36, 'Based on strengths'),
  (36, 'Based on availability'),
  (36, 'Discussed as needs change'),
  (37, 'Fast and exciting'),
  (37, 'Steady and intentional'),
  (37, 'Slow and careful'),
  (37, 'Let it develop naturally'),
  (38, 'Very important'),
  (38, 'Helpful but not essential'),
  (38, 'A few are enough'),
  (38, 'Different interests are exciting'),
  (39, 'Practical assistance'),
  (39, 'Emotional reassurance'),
  (39, 'Respect for my space'),
  (39, 'A combination of these'),
  (40, 'Together'),
  (40, 'By whoever is most affected'),
  (40, 'After independent reflection'),
  (40, 'Through open discussion'),
  (41, 'Kindness'),
  (41, 'Loyalty'),
  (41, 'Honesty'),
  (41, 'Respect'),
  (42, 'Achieving goals'),
  (42, 'Having meaningful relationships'),
  (42, 'Making a positive impact'),
  (42, 'Living with balance'),
  (43, 'A lifelong priority'),
  (43, 'Very important'),
  (43, 'Important when needed'),
  (43, 'I value contentment more'),
  (44, 'Do what is right'),
  (44, 'Protect the people I love'),
  (44, 'Pursue what matters'),
  (44, 'Keep commitments'),
  (45, 'Volunteer time'),
  (45, 'Support people directly'),
  (45, 'Share skills'),
  (45, 'Donate resources'),
  (46, 'At the center'),
  (46, 'Very important'),
  (46, 'Important with boundaries'),
  (46, 'It depends on the family'),
  (47, 'Listening carefully'),
  (47, 'Honoring boundaries'),
  (47, 'Treating people fairly'),
  (47, 'Valuing differences'),
  (48, 'Adventurous'),
  (48, 'Peaceful'),
  (48, 'Purposeful'),
  (48, 'Connected'),
  (49, 'A top priority'),
  (49, 'Very important'),
  (49, 'Important but flexible'),
  (49, 'Less important than experiences'),
  (50, 'My kindness'),
  (50, 'My courage'),
  (50, 'My achievements'),
  (50, 'The joy I shared')
on conflict (question_number, option_text) do nothing;
-- END GENERATED SECTION1 OPTION BANK

-- ------------------------------------------------------------
-- 5. What counts as a current, complete answer set
--    (internal helper: not executable by clients)
-- ------------------------------------------------------------
create or replace function public.section1_answers_are_complete(answers text[])
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
    cardinality(answers) = 50
    and not exists (
      select 1
        from generate_subscripts(answers, 1) as slot
       where answers[slot] is null
          or not exists (
            select 1
              from public.section1_question_options o
             where o.question_number = slot
               and o.option_text = answers[slot]
          )
    ),
    false
  );
$$;

-- ------------------------------------------------------------
-- 6. Completion guards
-- ------------------------------------------------------------
create or replace function public.enforce_section1_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  stored_answers text[];
begin
  -- The pointer is an index into 50 questions; a client cannot write outside it.
  new.section1_progress := least(greatest(coalesce(new.section1_progress, 0), 0), 50);

  if new.section1_complete is not true then
    return new;
  end if;

  select ur.responses_array
    into stored_answers
    from public.user_responses ur
   where ur.user_id = new.id;

  if public.section1_answers_are_complete(stored_answers) then
    new.section1_progress := 50;
  else
    -- Fail closed: a claim of completion without the current 50 answers is
    -- discarded, and the user is returned to question 1.
    new.section1_complete := false;
    new.section1_progress := 0;
  end if;

  return new;
end;
$$;

create or replace function public.downgrade_section1_on_invalid_answers()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.section1_answers_are_complete(new.responses_array) then
    return null;
  end if;

  -- Replacing a completed answer set with an incomplete/invalid one removes
  -- the completion it was based on.
  update public.users
     set section1_complete = false,
         section1_progress = 0
   where id = new.user_id
     and section1_complete is true;

  return null;
end;
$$;

revoke all on function public.section1_answers_are_complete(text[]) from public;
revoke all on function public.enforce_section1_completion() from public;
revoke all on function public.downgrade_section1_on_invalid_answers() from public;

-- ------------------------------------------------------------
-- 7. Exclude profiles whose stored answers are not current
--    (runs before the guards so the reset is a plain data correction)
-- ------------------------------------------------------------
do $$
declare
  reset_count int;
begin
  update public.users u
     set section1_complete = false,
         section1_progress = 0
   where u.section1_complete is true
     and not public.section1_answers_are_complete(
       (select ur.responses_array from public.user_responses ur where ur.user_id = u.id)
     );

  get diagnostics reset_count = row_count;
  raise notice
    'marked % profile(s) incomplete: stored answers are not the current 50-answer set (answers preserved)',
    reset_count;
end $$;

-- ------------------------------------------------------------
-- 8. Install the guards
-- ------------------------------------------------------------
drop trigger if exists trg_section1_completion_guard on public.users;
create trigger trg_section1_completion_guard
  before insert or update on public.users
  for each row
  execute function public.enforce_section1_completion();

drop trigger if exists trg_section1_responses_guard on public.user_responses;
create trigger trg_section1_responses_guard
  after insert or update on public.user_responses
  for each row
  execute function public.downgrade_section1_on_invalid_answers();

-- ------------------------------------------------------------
-- 9. Owner-only access
-- ------------------------------------------------------------
alter table public.user_responses enable row level security;

create policy responses_select_own
  on public.user_responses for select
  to authenticated
  using (user_id = auth.uid());

create policy responses_insert_own
  on public.user_responses for insert
  to authenticated
  with check (user_id = auth.uid());

create policy responses_update_own
  on public.user_responses for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- No anonymous path needs this table; the app only reaches it as the owner.
revoke all on table public.user_responses from anon;

-- ------------------------------------------------------------
-- 10. Post-check
-- ------------------------------------------------------------
do $$
declare
  column_type text;
  policy_count int;
  permissive_count int;
  guard_count int;
  anon_grants int;
  invalid_complete int;
  preserved_legacy int;
  option_rows int;
  option_questions int;
  malformed_questions int;
  client_option_grants int;
begin
  select format_type(a.atttypid, a.atttypmod)
    into column_type
    from pg_attribute a
   where a.attrelid = 'public.user_responses'::regclass
     and a.attname = 'responses_array'
     and not a.attisdropped;

  if column_type <> 'text[]' then
    raise exception 'post-check: responses_array is %, expected text[]', column_type;
  end if;

  select count(*) into policy_count
    from pg_policy p
   where p.polrelid = 'public.user_responses'::regclass;

  if policy_count <> 3 then
    raise exception 'post-check: expected 3 owner policies on user_responses, found %', policy_count;
  end if;

  select count(*) into permissive_count
    from pg_policy p
   where p.polrelid = 'public.user_responses'::regclass
     and pg_get_expr(p.polqual, p.polrelid) ilike '%auth.role()%';

  if permissive_count > 0 then
    raise exception 'post-check: a role-wide read policy is still present on user_responses';
  end if;

  select count(*) into guard_count
    from pg_trigger t
   where t.tgrelid in ('public.users'::regclass, 'public.user_responses'::regclass)
     and t.tgname in ('trg_section1_completion_guard', 'trg_section1_responses_guard')
     and not t.tgisinternal;

  if guard_count <> 2 then
    raise exception 'post-check: expected both Section 1 guards, found %', guard_count;
  end if;

  select count(*) into anon_grants
    from information_schema.role_table_grants g
   where g.table_schema = 'public'
     and g.table_name = 'user_responses'
     and g.grantee = 'anon';

  if anon_grants <> 0 then
    raise exception 'post-check: anon still holds % privilege(s) on user_responses', anon_grants;
  end if;

  select count(*) into invalid_complete
    from public.users u
   where u.section1_complete is true
     and not public.section1_answers_are_complete(
       (select ur.responses_array from public.user_responses ur where ur.user_id = u.id)
     );

  if invalid_complete > 0 then
    raise exception 'post-check: % complete profile(s) have invalid answers', invalid_complete;
  end if;

  select count(*) into option_rows
    from public.section1_question_options;

  if option_rows <> 200 then
    raise exception
      'post-check: the option bank holds % rows, expected 200 (the question bank changed without a cleanup migration)',
      option_rows;
  end if;

  select count(distinct question_number) into option_questions
    from public.section1_question_options;

  if option_questions <> 50 then
    raise exception 'post-check: the option bank covers % questions, expected 50', option_questions;
  end if;

  select count(*) into malformed_questions
    from (
      select question_number
        from public.section1_question_options
       group by question_number
      having count(*) <> 4
    ) malformed;

  if malformed_questions > 0 then
    raise exception 'post-check: % question(s) do not have exactly 4 options', malformed_questions;
  end if;

  select count(*) into client_option_grants
    from information_schema.role_table_grants g
   where g.table_schema = 'public'
     and g.table_name = 'section1_question_options'
     and g.grantee in ('anon', 'authenticated');

  if client_option_grants > 0 then
    raise exception 'post-check: a client role holds a privilege on the option bank';
  end if;

  -- Values preserved as text: legacy indices are now strings such as '0'.
  select count(*) into preserved_legacy
    from public.user_responses ur
   where not public.section1_answers_are_complete(ur.responses_array);

  raise notice
    'user_responses is text[]; 3 owner policies; 0 anon grants; both guards installed; % preserved non-current answer row(s)',
    preserved_legacy;
end $$;
