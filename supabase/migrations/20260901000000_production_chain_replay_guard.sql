-- ============================================================
-- PRODUCTION CHAIN REPLAY GUARD — fail closed, change nothing
--
-- Production (minglemate, mhdjnhiqahsllbczbzpk) was not built from this
-- repository's migration chain. On 2026-10-22 it adopted the
-- production-compatible baseline in supabase/sql/production/
-- (20261022150000 + 20261022160000) and recorded it in
-- supabase_migrations.schema_migrations together with the three Section 2
-- versions whose complete intended effect is present there.
--
-- The chain files that predate the baseline are NOT applied to production
-- and must never be: their matches-shape reconciliation targets the chain's
-- canonical `matches` table, not production's legacy one. A `supabase db
-- push` against production would therefore try to replay them.
--
-- This file sorts BEFORE every chain migration, so it runs first on any
-- pending list. On the adopted production database it raises and aborts the
-- push before a single chain statement executes. On any other database
-- (staging, a fresh local stack, a new project) the marker is absent and
-- this file is a no-op.
--
-- It deliberately does not create the marker: the baseline migration owns
-- that. Creating it here would make this guard disable itself on the first
-- run.
-- ============================================================
do $$
begin
  if to_regclass('public.production_schema_baseline') is not null then
    raise exception
      'This database adopted the production schema baseline on 2026-10-22 (public.production_schema_baseline). The repository migration chain must not be replayed against it. Apply production changes from supabase/sql/production/ as numbered files; see docs/PRODUCTION_SECTION2_MIGRATION.md.';
  end if;
end $$;
