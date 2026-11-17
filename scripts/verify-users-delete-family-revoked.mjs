// Regression test for D-1: DELETE, TRUNCATE, REFERENCES and TRIGGER are
// revoked on public.users from anon and authenticated, while signup, profile
// editing and account deletion still work.
//
//   node scripts/verify-users-delete-family-revoked.mjs
//
// Why this exists
//   The D-1 hardening was executed directly against production. The repo's
//   consolidated chain already converges to the same ACL, but nothing pinned
//   the two facts that make the revocation safe:
//
//     1. no client path deletes or truncates public.users; and
//     2. the two server-owned paths that do write/delete rows — the signup
//        trigger handle_new_user() and the request_account_deletion() RPC —
//        run as SECURITY DEFINER, so they do not need the client grants.
//
// What it checks
//   Part A reads src/ and supabase/functions/ as text: no `.from('users')`
//   chain calls `.delete()`, no raw `delete from users` / `truncate users`
//   exists, and the expected signup / profile-update / account-deletion call
//   sites are still present (a deletion of the call site cannot make the
//   absence check pass by accident).
//
//   Part B runs in an isolated PGlite database (no hosted project, no local
//   stack, no real user data). It builds the production-shaped post-D-1 ACL
//   with INSERT/SELECT/UPDATE granted and the four privileges present, then
//   applies supabase/migrations/20261115120000_revoke_users_delete_family_privileges.sql
//   itself and proves:
//     * the four privileges end up revoked for anon and authenticated;
//     * an auth.users insert still creates the public.users row via the
//       SECURITY DEFINER trigger (signup);
//     * an authenticated UPDATE of a profile row still lands;
//     * a direct DELETE/TRUNCATE by either client role is refused and the row
//       survives;
//     * request_account_deletion() still deletes the caller's row as definer,
//       and anon cannot call it.
//
// The migration file is the artifact under test, so its own postconditions run
// here too. Exit code 0 means every assertion passed.

import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const MIGRATION = 'supabase/migrations/20261115120000_revoke_users_delete_family_privileges.sql'

let checks = 0
function ok(condition, message) {
  assert.ok(condition, message)
  checks += 1
}
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message)
  checks += 1
}
function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

// ---------------------------------------------------------------------------
// Part A — the client source has no dependency on the revoked privileges.
// ---------------------------------------------------------------------------
function sourceFiles() {
  const files = []
  const walk = (relativeDir) => {
    for (const entry of readdirSync(join(root, relativeDir))) {
      const relative = join(relativeDir, entry).replace(/\\/g, '/')
      const absolute = join(root, relative)
      if (statSync(absolute).isDirectory()) walk(relative)
      else if (['.js', '.jsx', '.ts', '.tsx'].includes(extname(entry))) files.push(relative)
    }
  }
  walk('src')
  walk('supabase/functions')
  return files
}

// Strip line and block comments so prose cannot satisfy or trip a scan.
function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const files = sourceFiles()
ok(files.length > 20, `expected to scan the client and edge-function sources, found ${files.length} files`)

const chainDeletes = []
const rawDeletes = []
const rawTruncates = []

for (const file of files) {
  const source = withoutComments(read(file))

  // Every `.from('users')` chain, bounded before the next query/statement so a
  // `.delete()` on a different table (user_blocks, messages) is not blamed on
  // public.users.
  const fromUsers = /\.from\(\s*['"]users['"]\s*\)/g
  let match
  while ((match = fromUsers.exec(source))) {
    const rest = source.slice(match.index + match[0].length, match.index + match[0].length + 800)
    const stop = rest.search(
      /\.from\s*\(|\.rpc\s*\(|;|\n\s*(?:const|let|var|async\s+function|function|return|\}|if\s*\(|for\s*\(|while\s*\()/
    )
    const chain = stop >= 0 ? rest.slice(0, stop) : rest
    if (/\.delete\s*\(/.test(chain)) chainDeletes.push(file)
  }

  if (/\bdelete\s+from\s+(?:public\.)?users\b/i.test(source)) rawDeletes.push(file)
  if (/\btruncate\s+(?:table\s+)?(?:public\.)?users\b/i.test(source)) rawTruncates.push(file)
}

equal(chainDeletes, [], 'a client path still calls .from("users").delete()')
equal(rawDeletes, [], 'a client or edge function still runs DELETE FROM users')
equal(rawTruncates, [], 'a client or edge function still runs TRUNCATE users')

// Positive controls: the paths that must keep working are still where the
// report says they are.
ok(/\.auth\.signUp\s*\(/.test(read('src/pages/Signup.jsx')), 'Signup.jsx no longer calls auth.signUp — signup audit is stale')
// Account deletion moved from a direct client RPC to the request-account-deletion
// Edge Function (B1). The client must reach it through functions.invoke(), and
// must NOT go back to calling the superseded RPC directly. The RPC itself stays
// SECURITY DEFINER on the server and is still asserted below.
const settingsJsx = read('src/pages/Settings.jsx')
ok(/functions\.invoke\(\s*['"]request-account-deletion['"]/.test(settingsJsx),
  'Settings.jsx no longer invokes the request-account-deletion function — account-deletion audit is stale')
ok(!/rpc\(\s*['"]request_account_deletion['"]/.test(settingsJsx),
  'Settings.jsx still calls request_account_deletion directly through rpc() — the obsolete client path is back')
ok(/\.from\(\s*['"]users['"]\s*\)\s*\.update\s*\(/.test(read('src/pages/Profile.jsx')),
  'Profile.jsx no longer updates public.users — profile-edit audit is stale')

// The two server-owned paths must remain SECURITY DEFINER in the schema chain.
const chainSql = read('supabase/migrations/20261014150000_consolidated_schema_chain.sql')
ok(/create or replace function public\.handle_new_user\(\)[\s\S]{0,200}?security definer/i.test(chainSql),
  'handle_new_user() is not SECURITY DEFINER in the schema chain')
ok(/create or replace function public\.request_account_deletion\(\)[\s\S]{0,200}?security definer/i.test(chainSql),
  'request_account_deletion() is not SECURITY DEFINER in the schema chain')

// ---------------------------------------------------------------------------
// Part B — the ACL and the app paths, in an isolated PostgreSQL (PGlite).
// ---------------------------------------------------------------------------
const SIGNUP_ID = '11111111-1111-4111-8111-111111111111'
const db = new PGlite()

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;

  create schema auth;

  create table auth.users (
    id uuid primary key,
    email text
  );

  create function auth.uid()
  returns uuid
  language sql
  stable
  as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  create table public.users (
    id uuid primary key references auth.users(id) on delete cascade,
    email text,
    full_name text,
    bio text,
    residence_type text,
    looking_for text,
    interests jsonb,
    profile_prompts jsonb,
    profile_status text not null default 'active',
    notifications_enabled boolean not null default true
  );

  -- The signup path: the trigger writes the profile row as its owner.
  create function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
  as $$
  begin
    insert into public.users (id, email)
    values (new.id, new.email)
    on conflict (id) do nothing;
    return new;
  end;
  $$;

  create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute function public.handle_new_user();

  -- The account-deletion path: direct DELETE happens as the function owner.
  create function public.request_account_deletion()
  returns void
  language plpgsql
  security definer
  set search_path = public
  as $$
  declare
    uid uuid := auth.uid();
  begin
    if uid is null then
      raise exception 'Not authenticated';
    end if;
    delete from public.users where id = uid;
    delete from auth.users where id = uid;
  end;
  $$;

  revoke all on function public.request_account_deletion() from public, anon;
  grant execute on function public.request_account_deletion() to authenticated;

  grant usage on schema public to anon, authenticated;

  -- Production-shaped post-change grants: the app-required privileges are
  -- present; INSERT is table-wide, matching the reported production state.
  grant select, insert, update on table public.users to anon, authenticated;

  -- Seed the pre-change ACL so the migration's revocation is the only thing
  -- that removes these four.
  grant delete, truncate, references, trigger on table public.users to anon, authenticated;

  -- GoTrue writes auth.users; the authenticated role only stands in for it here.
  grant insert on table auth.users to authenticated;
  grant usage on schema auth to authenticated;
`)

const hasPrivilege = async (role, privilege) => {
  const { rows } = await db.query(
    'select has_table_privilege($1, $2, $3) as held',
    [role, 'public.users', privilege]
  )
  return rows[0].held
}

// Pre-change: the four are held, so a green result below is caused by the
// migration and not by an ACL that was already empty.
for (const privilege of ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
  ok(await hasPrivilege('anon', privilege), `anon should start with ${privilege} for the test to be meaningful`)
  ok(await hasPrivilege('authenticated', privilege), `authenticated should start with ${privilege} for the test to be meaningful`)
}

// Apply the audit migration exactly as committed. Its own postconditions run.
await db.exec(read(MIGRATION))

for (const privilege of ['DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
  ok(!(await hasPrivilege('anon', privilege)), `anon still holds ${privilege} after D-1`)
  ok(!(await hasPrivilege('authenticated', privilege)), `authenticated still holds ${privilege} after D-1`)
}

// Re-runnable: a second apply must succeed and must not regrant anything.
await db.exec(read(MIGRATION))
ok(!(await hasPrivilege('anon', 'DELETE')), 'a second apply regranted DELETE to anon')
ok(!(await hasPrivilege('authenticated', 'TRUNCATE')), 'a second apply regranted TRUNCATE to authenticated')
ok(await hasPrivilege('authenticated', 'UPDATE'), 'a second apply removed UPDATE from authenticated')

// The privileges the product needs survive.
for (const privilege of ['SELECT', 'INSERT', 'UPDATE']) {
  ok(await hasPrivilege('anon', privilege), `anon lost ${privilege}`)
  ok(await hasPrivilege('authenticated', privilege), `authenticated lost ${privilege}`)
}

async function asRole(role, query, params) {
  await db.exec(`set role ${role}`)
  try {
    return await db.query(query, params)
  } finally {
    await db.exec('reset role')
  }
}

async function expectRefused(role, query, pattern, label) {
  let error = null
  try {
    await asRole(role, query)
  } catch (caught) {
    error = caught
  }
  ok(error !== null, `${label}: expected a refusal, the statement succeeded`)
  ok(pattern.test(String(error?.message)), `${label}: unexpected error "${error?.message}"`)
}

const count = async (sql, params) => {
  const { rows } = await db.query(sql, params)
  return Number(rows[0].count)
}

// ---- Signup: an auth.users insert creates the profile row via the trigger. --
await asRole(
  'authenticated',
  "insert into auth.users (id, email) values ($1, 'd1-signup@example.test')",
  [SIGNUP_ID]
)
equal(
  await count('select count(*)::int as count from public.users where id = $1', [SIGNUP_ID]),
  1,
  'signup trigger did not create the public.users row'
)

// ---- Profile editing: the UPDATE the profile pages issue still lands. ------
await asRole(
  'authenticated',
  `update public.users set
     bio = 'D-1 regression bio',
     residence_type = 'on_campus',
     looking_for = 'something_serious',
     interests = '["music"]'::jsonb,
     profile_prompts = '[]'::jsonb,
     profile_status = 'paused',
     notifications_enabled = false
   where id = $1`,
  [SIGNUP_ID]
)
const updated = await db.query(
  'select bio, residence_type, looking_for, profile_status, notifications_enabled from public.users where id = $1',
  [SIGNUP_ID]
)
equal(updated.rows[0], {
  bio: 'D-1 regression bio',
  residence_type: 'on_campus',
  looking_for: 'something_serious',
  profile_status: 'paused',
  notifications_enabled: false
}, 'profile UPDATE was not applied')

// ---- Direct DELETE is refused for both client roles. -----------------------
await expectRefused(
  'authenticated',
  `delete from public.users where id = '${SIGNUP_ID}'`,
  /permission denied/i,
  'authenticated DELETE public.users'
)
await expectRefused(
  'anon',
  `delete from public.users where id = '${SIGNUP_ID}'`,
  /permission denied/i,
  'anon DELETE public.users'
)
equal(
  await count('select count(*)::int as count from public.users where id = $1', [SIGNUP_ID]),
  1,
  'a refused client DELETE still removed the profile row'
)

// ---- TRUNCATE is refused. ---------------------------------------------------
await expectRefused(
  'authenticated',
  'truncate table public.users',
  /permission denied|must be owner/i,
  'authenticated TRUNCATE public.users'
)
equal(
  await count('select count(*)::int as count from public.users where id = $1', [SIGNUP_ID]),
  1,
  'a refused client TRUNCATE still removed the profile row'
)

// ---- Account deletion still works through the definer RPC. -----------------
await db.query("select set_config('request.jwt.claim.sub', $1, false)", [SIGNUP_ID])
await asRole('authenticated', 'select public.request_account_deletion()')
equal(
  await count('select count(*)::int as count from public.users where id = $1', [SIGNUP_ID]),
  0,
  'request_account_deletion() did not delete the profile row'
)
equal(
  await count('select count(*)::int as count from auth.users where id = $1', [SIGNUP_ID]),
  0,
  'request_account_deletion() did not delete the auth row'
)

// ---- Anon cannot call the deletion RPC. ------------------------------------
await expectRefused(
  'anon',
  'select public.request_account_deletion()',
  /permission denied/i,
  'anon request_account_deletion()'
)

await db.close()

console.log(`D-1 users privilege checks passed: ${checks} assertions`)
console.log('Proved: no client DELETE/TRUNCATE path, signup trigger and account-deletion RPC still work as definer, profile UPDATE survives')
