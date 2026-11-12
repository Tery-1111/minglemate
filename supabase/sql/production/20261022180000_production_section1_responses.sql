-- ============================================================
-- PRODUCTION REMEDIATION — SECTION 1 ANSWERS AND COMPLETION
--
-- Target: project `minglemate`, ref mhdjnhiqahsllbczbzpk.
--
-- STATUS: NOT APPLIED. Applying this file deletes every pre-existing Section 1
--         answer row and resets Section 1 state for every profile, so it needs
--         the owner's explicit authorisation. Execution steps are in
--         docs/SECTION1_PRODUCTION_REMEDIATION.md.
--
-- OWNER DECISION THIS FILE IMPLEMENTS
--   Stored Section 1 answers are DISCARDED, not converted. The legacy rows were
--   written against a retired 40-question integer set and cannot be read as
--   answers to the current 50-question questionnaire, so every one of them is
--   deleted and every user retakes the questionnaire. Nothing is reinterpreted
--   as an answer.
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
--        integer answer set. Its 40 numeric values are not answers to the
--        current questionnaire, so the profile must not stay eligible.
--
-- HOW TO RUN IT (the only supported way)
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 \
--     -f supabase/sql/production/20261022180000_production_section1_responses.sql
--   `-1` makes the whole file one transaction; `ON_ERROR_STOP=1` makes psql
--   stop instead of continuing to the next statement after a failure. Both are
--   required. The file checks that it is really inside a transaction block
--   (section 0) and refuses to run otherwise, because the locks below are
--   released at the end of each statement outside a transaction.
--
--   Do NOT paste this into the Supabase SQL editor. The editor's transaction
--   semantics are not documented, so it cannot be shown to provide the
--   all-or-nothing guarantee this file's cutover relies on.
--
-- WHAT THIS FILE DOES
--   0. Transaction check, then locks: ACCESS EXCLUSIVE on public.user_responses
--      (the column type change needs it anyway, and holding it from the start
--      stops a client write from slipping between the legacy delete and the
--      ALTER COLUMN TYPE) and SHARE ROW EXCLUSIVE on public.users (blocks
--      client INSERT/UPDATE/DELETE, still allows SELECT, so no client write can
--      escape the global reset). lock_timeout is 5 s: a busy table aborts the
--      run instead of queueing behind it or blocking clients indefinitely.
--   1. Preflight: refuses unless the table and column exist and the column is
--      an integer[]/bigint[]/text[] (anything else is unknown and stops).
--   2. Drops every existing policy on public.user_responses by catalog (the
--      production names are pre-rewrite), then installs owner-only
--      select/insert/update scoped to auth.uid().
--   3. One-time cutover: deletes EVERY pre-existing row in
--      public.user_responses, resets section1_complete / section1_progress /
--      section1_last_edited on EVERY profile, and records the event in
--      public.section1_legacy_cutover. It asserts that no answer row survives
--      the deletion before recording the marker. A later execution sees the
--      marker and refuses to repeat the deletion or the reset, so answers
--      submitted after the cutover are preserved. Before recording the marker
--      it asserts that every profile now reads incomplete / progress 0 /
--      last-edited null, and aborts the transaction if any profile escaped the
--      reset. If the column is already text[] with no marker, the file stops
--      instead of guessing whether the rows are legacy. A marker that disagrees
--      with the schema or with the stored rows (marker + integer[], marker +
--      numeric-only rows, malformed marker, marker table with the wrong shape)
--      is an inconsistent state: the file stops rather than guessing, see
--      section 3.
--   4. Converts responses_array to text[] (skipped when it already is) and
--      keeps it NOT NULL.
--   5. Creates public.section1_question_options, the generated reference copy
--      of every option per question (200 rows; src/data/section1Questions.js
--      is the source, and `npm run verify` fails if they drift).
--   6. Installs public.section1_answers_are_complete(text[]): exactly 50
--      entries, none null, and each one the option text belonging to that
--      question. Numeric leftovers, blanks and out-of-bank strings all fail.
--   7. Installs two guards:
--        * trg_section1_completion_guard (BEFORE INSERT/UPDATE on users)
--          validates the stored answers whenever section1_complete is set
--          true. Invalid -> complete false, progress 0. Valid -> progress 50.
--          A client can no longer self-assert completion.
--        * trg_section1_responses_guard (AFTER INSERT/UPDATE/DELETE on
--          user_responses) downgrades a completed profile when its answers are
--          replaced, invalidated or removed.
--   8. Locks the table down: RLS with three owner policies, no anonymous
--      privilege, and no client DELETE/TRUNCATE. Privileges are made explicit
--      rather than assumed from the deployed default grants: PUBLIC is revoked
--      (every role inherits it), anon is revoked, and authenticated is granted
--      exactly select/insert/update. Function EXECUTE is revoked from PUBLIC,
--      anon and authenticated explicitly, because revoking PUBLIC alone does
--      not remove a grant made to a named role.
--   9. Post-checks the column type and NOT NULL, the three owner policies, the
--      absence of a role-wide policy, both guards, zero anon grants, the
--      effective client privileges (including inherited PUBLIC access), zero
--      complete-but-invalid profiles, the 200-row/50-question option bank, the
--      one-time marker and its contents. Rows are never classified as legacy
--      by created_at, which a client can supply.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It does not modify any other table. Users keep every column except the
--     three Section 1 state columns. Matches, match history, messages,
--     conversations, Section 2 rows, payment records and contact unlocks are
--     never referenced.
--   * It does not change scoring weights, dimension mapping, or the engine.
--     The PRD's "emotional + space x2" versus the named "relationship
--     expectations" dimension is still an open product decision.
--   * It does not drop the unused SQL helpers public.calculate_compatibility /
--     public.get_bulk_compatibility_scores (also integer[]-based and not called
--     by src/). They are dead code; removing database objects is a separate
--     decision. After this change they would fail if anything called them.
--   * It does not force RLS: the service role (match-generator) must keep
--     reading answers across users.
--
-- DATA IMPACT
--   Rows deleted on the first run: every row present in public.user_responses
--   (on production: the single 40-slot legacy row). Users: only
--   section1_complete, section1_progress and section1_last_edited change.
--   section1_last_edited is reset because Section1.jsx writes it only when it
--   saves answers and nothing in src/ reads it, so keeping the old value would
--   describe answers that no longer exist. Everything else is untouched.
--   The cutover is recorded once and is not repeatable by re-running the file.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Transaction check and lock strategy
--    A statement outside a transaction block releases its locks when the
--    statement ends, so "lock, delete, check, alter" is only safe inside one
--    transaction. This probe fails closed when the file is run without `-1`
--    (psql -f) or any other non-transactional client: the temp table is dropped
--    the moment its own statement commits, so the check below cannot see it.
-- ------------------------------------------------------------
create temp table if not exists section1_atomicity_probe (ok boolean) on commit drop;

do $$
begin
  if to_regclass('pg_temp.section1_atomicity_probe') is null then
    raise exception
      'refusing: this file is not running inside a single transaction. Run it with `psql -1 -v ON_ERROR_STOP=1 -f <this file>` so the cutover, the type change and the post-checks commit or roll back together. Nothing was changed.';
  end if;
end $$;

-- A short, explicit ceiling: if either table is busy (a long client transaction
-- holds a conflicting lock) the run aborts instead of waiting indefinitely and
-- instead of queueing every client write behind it.
set local lock_timeout = '5s';

-- Fail closed on row level security. `row_security = off` does NOT bypass RLS:
-- for a role that is subject to it (the table owner included, when FORCE ROW
-- LEVEL SECURITY is set), any statement that RLS would filter raises an error
-- instead of silently affecting a subset of rows. Without this, a FORCE RLS
-- table could delete only a policy-visible subset while the emptiness assertion
-- and the reset postcondition read that same filtered view, and the run would
-- record a cutover that never happened. A superuser or BYPASSRLS role — the
-- supported way to run this file — is exempt from RLS, so this changes nothing
-- for it; it only turns a would-be silent partial run into a rolled-back error.
set local row_security = off;

-- ACCESS EXCLUSIVE on user_responses. `alter column ... type text[]` takes this
-- lock anyway later in the file; taking it first means no client INSERT/UPDATE
-- can commit between the legacy DELETE and the type change, so no row can be
-- written against the old shape and then silently converted. It also blocks
-- client reads for the duration, which is milliseconds on this table.
lock table public.user_responses in access exclusive mode;

-- SHARE ROW EXCLUSIVE on users. It conflicts with ROW EXCLUSIVE, which every
-- INSERT/UPDATE/DELETE takes, so no client write can land between the reset and
-- the first-run postcondition; it does not conflict with ACCESS SHARE, so the
-- application can keep reading profiles while the file runs. It is also the
-- lock `create trigger` needs, so no later statement has to upgrade it.
lock table public.users in share row exclusive mode;

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
-- 3. One-time cutover: discard the legacy answers, reset Section 1
--    The marker row is inserted in the same transaction as the delete and the
--    reset, so a failed post-check rolls all three back together. A later run
--    sees the marker and refuses to delete or reset again.
-- ------------------------------------------------------------
create table if not exists public.section1_legacy_cutover (
  singleton boolean primary key default true,
  executed_at timestamptz not null default now(),
  deleted_response_rows integer not null,
  reset_user_profiles integer not null,
  constraint section1_legacy_cutover_singleton check (singleton)
);

alter table public.section1_legacy_cutover enable row level security;
revoke all on table public.section1_legacy_cutover from public, anon, authenticated;

-- `create table if not exists` above silently accepts a table that already
-- exists with a different shape. Reading it would then fail halfway through the
-- file, so the shape is checked before anything depends on it.
do $$
declare
  missing_columns text;
begin
  select string_agg(expected.name, ', ' order by expected.name)
    into missing_columns
    from (values ('singleton'), ('executed_at'), ('deleted_response_rows'), ('reset_user_profiles'))
           as expected(name)
   where not exists (
     select 1
       from pg_attribute a
      where a.attrelid = 'public.section1_legacy_cutover'::regclass
        and a.attname = expected.name
        and not a.attisdropped
   );

  if missing_columns is not null then
    raise exception
      'refusing: public.section1_legacy_cutover already exists without the column(s) %. That object cannot be read as this file''s cutover marker, and this file will not guess whether a cutover happened. Inspect and resolve it by hand. Nothing was changed.',
      missing_columns;
  end if;
end $$;

-- Matching names are not enough: a column that is the wrong type or nullable
-- can hold values this file must never treat as its own marker. In particular
-- a nullable count accepts NULL, and `NULL < 0` evaluates to NULL (not true),
-- so the malformed-marker predicates below would let a NULL count pass. The
-- structure this file writes is the structure it requires.
do $$
declare
  bad_columns text;
begin
  select string_agg(
           format('%s %s%s',
                  a.attname,
                  format_type(a.atttypid, a.atttypmod),
                  case when a.attnotnull then ' NOT NULL' else ' (nullable)' end),
           '; '
           order by a.attname)
    into bad_columns
    from pg_attribute a
   where a.attrelid = 'public.section1_legacy_cutover'::regclass
     and not a.attisdropped
     and a.attnum > 0
     and (
          (a.attname = 'singleton'
            and (format_type(a.atttypid, a.atttypmod) <> 'boolean'
                 or not a.attnotnull))
       or (a.attname = 'executed_at'
            and (format_type(a.atttypid, a.atttypmod) <> 'timestamp with time zone'
                 or not a.attnotnull))
       or (a.attname = 'deleted_response_rows'
            and (format_type(a.atttypid, a.atttypmod) <> 'integer'
                 or not a.attnotnull))
       or (a.attname = 'reset_user_profiles'
            and (format_type(a.atttypid, a.atttypmod) <> 'integer'
                 or not a.attnotnull))
     );

  if bad_columns is not null then
    raise exception
      'refusing: public.section1_legacy_cutover exists but % does not match the marker structure this file writes (singleton boolean NOT NULL, executed_at timestamptz NOT NULL, deleted_response_rows integer NOT NULL, reset_user_profiles integer NOT NULL). That object cannot be read as this file''s cutover marker, and this file will not guess whether a cutover happened. Inspect and resolve it by hand. Nothing was changed.',
      bad_columns;
  end if;
end $$;

-- Matching names and types are still not the structure this file writes: a
-- table without the singleton check can hold false, a table without the
-- primary key can hold two rows, and a table without the defaults silently
-- changes what an insert means. The exact structure this file creates is four
-- columns and no others, both defaults, a primary key on singleton alone and
-- `check (singleton)`; anything else is an object this file will not read as
-- its cutover marker.
do $$
declare
  marker_structure_problems text;
begin
  select string_agg(failure, '; ' order by failure)
    into marker_structure_problems
    from (
      select format('unexpected column %s', a.attname) as failure
        from pg_attribute a
       where a.attrelid = 'public.section1_legacy_cutover'::regclass
         and a.attnum > 0
         and not a.attisdropped
         and a.attname not in ('singleton', 'executed_at', 'deleted_response_rows', 'reset_user_profiles')

      union all

      select e.name || ' default must be ' || e.expected || ', found '
             || coalesce(pg_get_expr(d.adbin, d.adrelid), 'no default')
        from (values ('singleton', 'true'), ('executed_at', 'now()')) as e(name, expected)
        left join pg_attribute a
          on a.attrelid = 'public.section1_legacy_cutover'::regclass
         and a.attname = e.name
         and not a.attisdropped
        left join pg_attrdef d
          on d.adrelid = a.attrelid
         and d.adnum = a.attnum
       where coalesce(pg_get_expr(d.adbin, d.adrelid), 'no default') <> e.expected

      union all

      select 'no primary key on singleton alone'
       where not exists (
             select 1
               from pg_constraint c
              where c.conrelid = 'public.section1_legacy_cutover'::regclass
                and c.contype = 'p'
                and c.conkey = array[(select a.attnum
                                        from pg_attribute a
                                       where a.attrelid = 'public.section1_legacy_cutover'::regclass
                                         and a.attname = 'singleton'
                                         and not a.attisdropped)]::int2[]
           )

      union all

      select 'no check constraint CHECK (singleton)'
       where not exists (
             select 1
               from pg_constraint c
              where c.conrelid = 'public.section1_legacy_cutover'::regclass
                and c.contype = 'c'
                and pg_get_constraintdef(c.oid) = 'CHECK (singleton)'
           )
    ) as failures;

if marker_structure_problems is not null then
  raise exception
    'refusing: public.section1_legacy_cutover does not match the marker structure this file writes: %. That object cannot be read as this file''s cutover marker, and this file will not guess whether a cutover happened. Inspect and resolve it by hand. Nothing was changed.',
    marker_structure_problems;
end if;
end $$;

do $$
declare
  column_type text;
  column_not_null boolean;
  marker_rows int;
  marker public.section1_legacy_cutover%rowtype;
  deleted_rows int;
  reset_profiles int;
  reset_violations int;
  legacy_looking int;
begin
  select format_type(a.atttypid, a.atttypmod), a.attnotnull
    into column_type, column_not_null
    from pg_attribute a
   where a.attrelid = 'public.user_responses'::regclass
     and a.attname = 'responses_array'
     and not a.attisdropped;

  select count(*) into marker_rows from public.section1_legacy_cutover;

  -- -----------------------------------------------------------------
  -- A. The marker exists: the cutover is supposed to be complete.
  --    That claim is only meaningful together with the state the cutover
  --    leaves behind: one well-formed marker, text[] NOT NULL, and no values
  --    that could only be converted legacy answers. Any disagreement is an
  --    inconsistent state left by a partial or manual execution, so the file
  --    stops instead of deleting, converting or "repairing" anything.
  -- -----------------------------------------------------------------
  if marker_rows > 1 then
    raise exception
      'refusing: public.section1_legacy_cutover holds % rows, but the marker is a singleton. Inspect it by hand. Nothing was changed.',
      marker_rows;
  end if;

  if marker_rows = 1 then
    select * into marker from public.section1_legacy_cutover;

    if marker.singleton is not true
       or marker.executed_at is null
       or marker.deleted_response_rows is null
       or marker.deleted_response_rows < 0
       or marker.reset_user_profiles is null
       or marker.reset_user_profiles < 0 then
      raise exception
        'refusing: the cutover marker is malformed (singleton=%, executed_at=%, deleted_response_rows=%, reset_user_profiles=%). This file will not guess whether the cutover happened. Inspect and resolve it by hand. Nothing was changed.',
        marker.singleton, marker.executed_at, marker.deleted_response_rows, marker.reset_user_profiles;
    end if;

    if column_type <> 'text[]' or column_not_null is not true then
      raise exception
        'refusing: a cutover marker exists but responses_array is % (NOT NULL = %), while a completed cutover leaves text[] NOT NULL. The marker and the schema disagree, so this file will not delete answers or reset profiles. Inspect public.user_responses and public.section1_legacy_cutover, then decide by hand. Nothing was changed.',
        column_type, column_not_null;
    end if;

    -- The defect this closes: an earlier revision returned on "marker exists"
    -- before looking at the column, so a marker left by a partial run could
    -- convert surviving legacy rows instead of deleting them. A row that holds
    -- at least one numeric string and NO nonnumeric non-null value is exactly
    -- that shape: current answers are option text, never bare integers. NULL
    -- elements do not clear the suspicion, because a converted legacy row may
    -- be sparse; only real option text does. An all-NULL row cannot be
    -- distinguished from legitimate partial data and is deliberately NOT
    -- flagged here.
    select count(*) into legacy_looking
      from public.user_responses ur
     where coalesce(cardinality(ur.responses_array), 0) > 0
       and exists (
         select 1
           from unnest(ur.responses_array) as value
          where value is not null and value ~ '^-?[0-9]+$'
       )
       and not exists (
         select 1
           from unnest(ur.responses_array) as value
          where value is not null and value !~ '^-?[0-9]+$'
       );

    if legacy_looking > 0 then
      raise exception
        'refusing: a cutover marker exists but % answer row(s) hold only numeric values (NULL elements allowed). That is the shape of converted legacy answers, not of current option text, so the marker does not describe these rows. Inspect public.user_responses and public.section1_legacy_cutover by hand. Nothing was changed.',
        legacy_looking;
    end if;

    raise warning
      'Section 1 legacy cutover already executed at % (% answer row(s) deleted, % profile(s) reset): refusing to delete answer rows or reset profiles again',
      marker.executed_at, marker.deleted_response_rows, marker.reset_user_profiles;
    return;
  end if;

  -- -----------------------------------------------------------------
  -- B. No marker: the only supported starting point is the legacy column.
  --    An empty marker table does NOT mean "a cutover happened": it means no
  --    cutover was recorded, and with integer[] the schema proves it. text[]
  --    with no marker stays unknowable and is refused.
  -- -----------------------------------------------------------------
  if column_type = 'text[]' then
    raise exception
      'refusing: responses_array is already text[] and no cutover marker exists. This file cannot tell legacy answers from live ones; inspect public.user_responses before deciding. Nothing was changed.';
  end if;

  if column_type not in ('integer[]', 'int4[]', 'bigint[]') then
    raise exception
      'refusing: responses_array is % and there is no cutover marker; this file only performs the cutover from an integer[] legacy column. Nothing was changed.',
      column_type;
  end if;

  delete from public.user_responses;
  get diagnostics deleted_rows = row_count;

  -- Legacy rows are identifiable exactly once: as the rows that exist before
  -- the deletion above. Asserting emptiness immediately afterwards is
  -- therefore reliable, and it runs in the same transaction as the marker, so
  -- a survivor aborts the delete, the reset and the marker together. Rows are
  -- deliberately NOT classified by created_at later in this file: created_at
  -- can be client-supplied or simply old, so a legitimate answer submitted
  -- after the cutover may carry a timestamp earlier than the marker.
  if exists (select 1 from public.user_responses) then
    raise exception
      'cutover post-check: answer rows remain after the legacy deletion; refusing to record the cutover';
  end if;

  update public.users
     set section1_complete = false,
         section1_progress = 0,
         section1_last_edited = null;
  get diagnostics reset_profiles = row_count;

  -- First-run postcondition: the reset above must have left EVERY profile
  -- exactly at "must retake Section 1". This runs only on the cutover path
  -- (the marker check returned above on any later execution), so a user who
  -- legitimately completes Section 1 after the cutover is never rejected.
  -- Raising here aborts the whole file, so the delete, the reset and the
  -- marker all roll back together.
  select count(*) into reset_violations
    from public.users u
   where u.section1_complete is distinct from false
      or u.section1_progress is distinct from 0
      or u.section1_last_edited is not null;

  if reset_violations > 0 then
    raise exception
      'cutover post-check: % profile(s) are not reset to incomplete, progress 0, last-edited null',
      reset_violations;
  end if;

  insert into public.section1_legacy_cutover (deleted_response_rows, reset_user_profiles)
       values (deleted_rows, reset_profiles);

  raise notice
    'Section 1 cutover: % legacy answer row(s) deleted, % profile(s) reset',
    deleted_rows, reset_profiles;
end $$;

-- ------------------------------------------------------------
-- 4. responses_array becomes text[] (skipped when it already is)
-- ------------------------------------------------------------
do $$
declare
  column_type text;
begin
  select format_type(a.atttypid, a.atttypmod)
    into column_type
    from pg_attribute a
   where a.attrelid = 'public.user_responses'::regclass
     and a.attname = 'responses_array'
     and not a.attisdropped;

  if column_type <> 'text[]' then
    execute 'alter table public.user_responses alter column responses_array type text[] using responses_array::text[]';
  end if;
end $$;

alter table public.user_responses
  alter column responses_array set not null;

comment on column public.user_responses.responses_array is
  'Section 1 answers: chosen option text, position i = question i+1 (Q1 at index 1). Unanswered is null.';

-- ------------------------------------------------------------
-- 5. The current question bank
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
revoke all on table public.section1_question_options from public, anon, authenticated;

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
-- 6. What counts as a current, complete answer set
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
-- 7. Completion guards
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
declare
  affected_user uuid;
  answers text[];
begin
  if tg_op = 'DELETE' then
    affected_user := old.user_id;
    answers := null;
  else
    affected_user := new.user_id;
    answers := new.responses_array;
  end if;

  -- Missing answers cannot support a completion claim either.
  if answers is not null and public.section1_answers_are_complete(answers) then
    return null;
  end if;

  update public.users
     set section1_complete = false,
         section1_progress = 0
   where id = affected_user
     and section1_complete is true;

  return null;
end;
$$;

-- Revoke from PUBLIC and from the named client roles: Supabase grants EXECUTE
-- on new functions to anon/authenticated directly, and `from public` alone
-- would leave those grants in place.
revoke all on function public.section1_answers_are_complete(text[]) from public, anon, authenticated;
revoke all on function public.enforce_section1_completion() from public, anon, authenticated;
revoke all on function public.downgrade_section1_on_invalid_answers() from public, anon, authenticated;

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
  after insert or update or delete on public.user_responses
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
--
-- Privileges are made explicit here instead of inheriting whatever the
-- deployed default grants happen to be. PUBLIC is revoked first: every role is
-- a member of PUBLIC, so a PUBLIC grant would survive the named-role revokes
-- below and would also make information_schema.role_table_grants look clean
-- while has_table_privilege() still reports access.
revoke all on table public.user_responses from public, anon;
grant select, insert, update on table public.user_responses to authenticated;

-- Clients need read/insert/update only. Removing DELETE and TRUNCATE keeps a
-- row from disappearing behind the downgrade guard; TRUNCATE bypasses RLS.
revoke delete, truncate, references, trigger on table public.user_responses from authenticated;

-- The weekly generator reads every profile's answers as service_role. It
-- bypasses RLS, but revoking PUBLIC could have removed a privilege it held only
-- through PUBLIC, so its SELECT is granted explicitly when the role exists.
do $$
begin
  if to_regrole('service_role') is not null then
    execute 'grant select on table public.user_responses to service_role';
  end if;
end $$;

-- ------------------------------------------------------------
-- 10. Post-check
-- ------------------------------------------------------------
do $$
declare
  column_type text;
  column_not_null boolean;
  policy_count int;
  permissive_count int;
  guard_count int;
  anon_grants int;
  invalid_complete int;
  option_rows int;
  option_questions int;
  malformed_questions int;
  client_option_grants int;
  cutover_rows int;
  marker public.section1_legacy_cutover%rowtype;
begin
  select format_type(a.atttypid, a.atttypmod), a.attnotnull
    into column_type, column_not_null
    from pg_attribute a
   where a.attrelid = 'public.user_responses'::regclass
     and a.attname = 'responses_array'
     and not a.attisdropped;

  if column_type <> 'text[]' then
    raise exception 'post-check: responses_array is %, expected text[]', column_type;
  end if;

  if column_not_null is not true then
    raise exception 'post-check: responses_array is nullable, expected NOT NULL';
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

  if has_table_privilege('anon', 'public.user_responses', 'SELECT')
     or has_table_privilege('anon', 'public.user_responses', 'INSERT')
     or has_table_privilege('anon', 'public.user_responses', 'UPDATE')
     or has_table_privilege('anon', 'public.user_responses', 'DELETE')
     or has_table_privilege('anon', 'public.user_responses', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.user_responses', 'DELETE')
     or has_table_privilege('authenticated', 'public.user_responses', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.user_responses', 'REFERENCES')
     or has_table_privilege('authenticated', 'public.user_responses', 'TRIGGER') then
    raise exception 'post-check: a client role holds a privilege this file revokes';
  end if;

  -- has_table_privilege() is the effective check: it includes inherited PUBLIC
  -- grants as well as direct ones, which role_table_grants alone would miss.
  if not has_table_privilege('authenticated', 'public.user_responses', 'SELECT')
     or not has_table_privilege('authenticated', 'public.user_responses', 'INSERT')
     or not has_table_privilege('authenticated', 'public.user_responses', 'UPDATE') then
    raise exception 'post-check: authenticated is missing select/insert/update on user_responses';
  end if;

  if has_table_privilege('anon', 'public.section1_question_options', 'SELECT')
     or has_table_privilege('anon', 'public.section1_question_options', 'INSERT')
     or has_table_privilege('anon', 'public.section1_question_options', 'UPDATE')
     or has_table_privilege('anon', 'public.section1_question_options', 'DELETE')
     or has_table_privilege('anon', 'public.section1_question_options', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.section1_question_options', 'SELECT')
     or has_table_privilege('authenticated', 'public.section1_question_options', 'INSERT')
     or has_table_privilege('authenticated', 'public.section1_question_options', 'UPDATE')
     or has_table_privilege('authenticated', 'public.section1_question_options', 'DELETE')
     or has_table_privilege('authenticated', 'public.section1_question_options', 'TRUNCATE') then
    raise exception 'post-check: a client role has effective access to the option bank';
  end if;

  if has_table_privilege('anon', 'public.section1_legacy_cutover', 'SELECT')
     or has_table_privilege('anon', 'public.section1_legacy_cutover', 'INSERT')
     or has_table_privilege('anon', 'public.section1_legacy_cutover', 'UPDATE')
     or has_table_privilege('anon', 'public.section1_legacy_cutover', 'DELETE')
     or has_table_privilege('anon', 'public.section1_legacy_cutover', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.section1_legacy_cutover', 'SELECT')
     or has_table_privilege('authenticated', 'public.section1_legacy_cutover', 'INSERT')
     or has_table_privilege('authenticated', 'public.section1_legacy_cutover', 'UPDATE')
     or has_table_privilege('authenticated', 'public.section1_legacy_cutover', 'DELETE')
     or has_table_privilege('authenticated', 'public.section1_legacy_cutover', 'TRUNCATE') then
    raise exception 'post-check: a client role has effective access to the cutover marker';
  end if;

  if to_regrole('service_role') is not null
     and not has_table_privilege('service_role', 'public.user_responses', 'SELECT') then
    raise exception 'post-check: service_role cannot read user_responses; the weekly generator would fail';
  end if;

  if has_function_privilege('anon', 'public.section1_answers_are_complete(text[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.section1_answers_are_complete(text[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.enforce_section1_completion()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.enforce_section1_completion()', 'EXECUTE')
     or has_function_privilege('anon', 'public.downgrade_section1_on_invalid_answers()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.downgrade_section1_on_invalid_answers()', 'EXECUTE') then
    raise exception 'post-check: a client role can execute a Section 1 function';
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
     and g.table_name in ('section1_question_options', 'section1_legacy_cutover')
     and g.grantee in ('anon', 'authenticated');

  if client_option_grants > 0 then
    raise exception 'post-check: a client role holds a privilege on the option bank or the cutover marker';
  end if;

  select count(*) into cutover_rows from public.section1_legacy_cutover;

  if cutover_rows <> 1 then
    raise exception 'post-check: expected exactly one cutover marker row, found %', cutover_rows;
  end if;

  select * into marker from public.section1_legacy_cutover;

  if marker.singleton is not true
     or marker.executed_at is null
     or marker.deleted_response_rows is null
     or marker.deleted_response_rows < 0
     or marker.reset_user_profiles is null
     or marker.reset_user_profiles < 0 then
    raise exception
      'post-check: the cutover marker is malformed (singleton=%, executed_at=%, deleted_response_rows=%, reset_user_profiles=%)',
      marker.singleton, marker.executed_at, marker.deleted_response_rows, marker.reset_user_profiles;
  end if;

  -- Deliberately no "answers older than the marker" check. Answer rows cannot
  -- be classified as legacy by timestamp without rejecting legitimate
  -- post-cutover data, so the "nothing survived" guarantee lives in the
  -- cutover block, where it is checked against the rows that actually existed
  -- and is committed atomically with the marker.

  raise notice
    'user_responses is text[]; 3 owner policies; 0 anon grants; both guards installed; cutover recorded once';
end $$;
