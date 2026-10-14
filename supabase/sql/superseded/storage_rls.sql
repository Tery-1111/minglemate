-- ============================================================
-- STORAGE RLS: profile_photos bucket (A01 — the one access-control
-- gap not closed by the earlier remediation commits)
--
-- Confirmed risk: Photos.jsx uploads to `${userId}/${slot}_....ext`
-- and deletes old objects at paths parsed from existing URLs —
-- the client TRUSTS the path. Without storage policies, any
-- authenticated user could overwrite or delete another user's
-- photos (BOLA on storage objects), and upload into another
-- user's folder.
--
-- Minimal fix: bucket stays PUBLIC READ (profile photos are the
-- product), but writes/deletes are path-scoped to the owner.
-- Idempotent; run in Supabase SQL Editor.
-- ============================================================

-- 1. Ensure the bucket exists with public read (no change if present)
insert into storage.buckets (id, name, public)
values ('profile_photos', 'profile_photos', true)
on conflict (id) do nothing;

-- 2. Read: public (profile photos are meant to be viewable)
drop policy if exists "profile_photos_public_read" on storage.objects;
create policy "profile_photos_public_read"
  on storage.objects for select
  using (bucket_id = 'profile_photos');

-- 3. Insert: authenticated users may only write into THEIR OWN folder
drop policy if exists "profile_photos_owner_insert" on storage.objects;
create policy "profile_photos_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4. Update: owner only
drop policy if exists "profile_photos_owner_update" on storage.objects;
create policy "profile_photos_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'profile_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5. Delete: owner only (blocks the Photos.jsx "cleanup" path from
--    being pointed at other users' objects)
drop policy if exists "profile_photos_owner_delete" on storage.objects;
create policy "profile_photos_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile_photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- VERIFY after running:
--   select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--   and policyname like 'profile_photos%';
--   → expect 4 rows (select/insert/update/delete)
-- ============================================================
