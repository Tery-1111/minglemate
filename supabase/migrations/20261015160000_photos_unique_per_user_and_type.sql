-- public.photos must hold at most one row per (user_id, photo_type).
--
-- Both write paths in the app upsert against that pair:
--   src/pages/Photos.jsx:112 and src/pages/PhotoUpload.jsx:87 both call
--   .upsert({ user_id, photo_type, ... }, { onConflict: 'user_id,photo_type' })
-- and PostgREST turns that into `on conflict (user_id, photo_type) do update`,
-- which PostgreSQL can only infer from a unique constraint or unique index on
-- exactly those columns. public.photos has neither — only photos_pkey on id —
-- so every one of those upserts fails with 42P10 "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification". That failure
-- happens while the statement is planned, before RLS is consulted, which is why
-- it reproduces for the service role as well as for a signed-in owner, and why
-- it is a schema defect rather than a policy one.
--
-- The rule itself is what the product already assumes, not a new one:
--   * src/pages/Photos.jsx:6 — "PHOTO SLOTS: exactly two — 1) Facial photo
--     (cards/discover), 2) Full-body photo (opened match screen). No extra
--     slots.", with state shaped { facial: url, full_body: url } (line 21);
--   * src/pages/PhotoUpload.jsx:20 — "Exactly two photo slots per the product
--     spec: Photo 1 = facial photo, Photo 2 = full-body photo.";
--   * every reader takes one row per type — Discover.jsx:85, Messages.jsx:98,
--     Payment.jsx:71 and ForceConnect.jsx:37 filter photo_type = 'facial', and
--     MatchDetail.jsx:51 finds 'full_body' and 'facial';
--   * Admin.jsx:444 keys its photo list by p.photo_type and labels the entries
--     "Facial photo"/"Full-body photo", which only holds if the type is unique;
--   * the live schema's photos_photo_type_check confines photo_type to those
--     same two values.
-- So one photo per user per photo type is existing behaviour that the database
-- was failing to state, not a behaviour this migration introduces.
--
-- It is its own timestamped migration for the same reason the RLS closure is:
-- the schema chain (20261014150000) is already recorded in
-- supabase_migrations.schema_migrations on every project that has run it, so a
-- stage appended to that file would never execute there.
--
-- It is written not to touch data. If the target already holds duplicate pairs
-- the block stops with the offending pairs named and nothing deleted, merged or
-- repointed: deciding which of two photos of the same person is the real one is
-- a product decision, not something a migration may guess. On a table with no
-- duplicates this is a pure schema change.
do $photos_unique$
declare
  existing boolean;
  dupes    text;
begin
  -- photos is a precondition of the chain, like campuses: it may legitimately
  -- not exist yet, in which case there is nothing to constrain.
  if to_regclass('public.photos') is null then
    raise notice 'public.photos is not present: nothing to do (it is a precondition of the schema chain, not created by it)';
    return;
  end if;

  -- Idempotent: skip when the pair is already constrained, whether that was
  -- done by this migration on an earlier run or by hand.
  select exists (
           select 1
             from pg_constraint
            where conrelid = 'public.photos'::regclass
              and contype = 'u'
              and pg_get_constraintdef(oid) = 'UNIQUE (user_id, photo_type)'
         )
      or exists (
           select 1
             from pg_indexes
            where schemaname = 'public'
              and tablename = 'photos'
              and indexdef ilike '%unique%'
              and indexdef ilike '%(user_id, photo_type)%'
         )
    into existing;
  if existing then
    raise notice 'a unique constraint on public.photos (user_id, photo_type) already exists: nothing to do';
    return;
  end if;

  -- Name the offenders rather than letting a bare 23505 through, and never
  -- resolve them here.
  select string_agg(format('%s / %L (%s rows)', user_id, photo_type, n), '; '
                    order by user_id, photo_type)
    into dupes
    from (
      select user_id, photo_type, count(*) as n
        from public.photos
       group by user_id, photo_type
      having count(*) > 1
       order by user_id, photo_type
       limit 20
    ) d;

  if dupes is not null then
    raise exception 'public.photos holds duplicate (user_id, photo_type) rows: %', dupes
      using hint = 'Decide which row is authoritative for each pair and delete or repoint the others, then re-apply. This migration will not choose for you.';
  end if;

  begin
    alter table public.photos
      add constraint photos_user_id_photo_type_key unique (user_id, photo_type);
    raise notice 'photos_user_id_photo_type_key added: one photo per user per photo type';
  exception
    when duplicate_table or duplicate_object then
      raise notice 'photos_user_id_photo_type_key already exists: nothing to do';
    when undefined_table then
      raise notice 'public.photos disappeared between the check and the constraint: nothing to do';
  end;
end
$photos_unique$;
