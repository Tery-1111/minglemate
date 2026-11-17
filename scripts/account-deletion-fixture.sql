-- ============================================================
-- Scratch-fixture harness for 20261116000000_production_account_deletion.sql
--
-- Creates a THROWAWAY database (acct_del_scratch), builds the production
-- table/column/FK shape the artifact expects, runs the artifact, then asserts
-- deletion + retention behaviour. Local only. Never touches production or the
-- app's own database.
--
--   docker exec -i supabase_db_minglemate psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/account-deletion-fixture.sql
--   docker exec -i supabase_db_minglemate psql -U postgres -d acct_del_scratch -v ON_ERROR_STOP=1 < supabase/sql/production/20261116000000_production_account_deletion.sql
--   docker exec -i supabase_db_minglemate psql -U postgres -d acct_del_scratch -v ON_ERROR_STOP=1 < scripts/account-deletion-assert.sql
-- ============================================================

drop database if exists acct_del_scratch;
create database acct_del_scratch;
