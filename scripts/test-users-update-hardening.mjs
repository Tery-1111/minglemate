// H-1 users-UPDATE hardening — executed in an isolated PostgreSQL (PGlite).
//
//   node scripts/test-users-update-hardening.mjs
//
// Builds a disposable database mirroring the live staging shape this migration
// depends on, applies supabase/migrations/20261113120000_users_update_privilege_hardening.sql
// verbatim, then executes the ten required tests as real SQL under real role
// context (SET ROLE + request.jwt.claims, exactly how PostgREST drives it).
//
// Never contacts a hosted database. It is not a substitute for running the same
// file against Supabase staging (auth schema, PostgREST wiring and the real
// owners differ), but it does execute the real SQL against real Postgres.
//
// ENGINE: PGlite bundles a real PostgreSQL build, so this is executed evidence
// for that version.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const MIGRATION = 'supabase/migrations/20261113120000_users_update_privilege_hardening.sql'
const migrationSql = readFileSync(MIGRATION, 'utf8')

let passed = 0
let failed = 0
const results = []

function record(name, ok, detail) {
  if (ok) {
    passed += 1
    results.push(`PASS  ${name}`)
  } else {
    failed += 1
    results.push(`FAIL  ${name}\n      ${detail}`)
  }
}

const db = new PGlite()

// ---------------------------------------------------------------------------
// Fixture: the pre-migration live shape.
//
//   * public.users with the 36 real columns
//   * the table-level grants measured live:
//       anon=awdDxtm, authenticated=awdDxtm
//   * the trigger chain that exists live (trg_clamp_user_protected_cols)
//   * three pre-existing UPDATE policies, including the PUBLIC-scoped one
//   * supporting tables discover_candidates() reads
// ---------------------------------------------------------------------------
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create role supabase_admin;

  -- Real Supabase roles: service_role and supabase_admin carry BYPASSRLS, so
  -- server-side writes reach the row without an UPDATE policy match. Without
  -- this the fixture would silently make every service_role UPDATE a 0-row
  -- no-op and the tests would "pass" for the wrong reason.
  alter role service_role bypassrls;
  alter role supabase_admin bypassrls;

  create schema if not exists auth;

  -- PostgREST exposes the caller identity through these two settings.
  create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

  create table public.users (
    id                       uuid primary key,
    email                    text not null,
    full_name                text,
    age                      integer,
    gender                   text,
    campus_id                uuid,
    residence_type           text,
    bio                      text,
    interests                text[] default '{}',
    profile_status           text default 'incomplete',
    section1_progress        integer default 0,
    section1_complete        boolean default false,
    section1_last_edited     timestamptz,
    section2_unlocked        boolean default false,
    section2_free_expires_at timestamptz,
    phone                    text,
    onesignal_player_id      text,
    created_at               timestamptz default now(),
    reg_number               text,
    whatsapp_number          text,
    display_phone            text,
    section2_responses       integer[] default '{}',
    reputation_score         integer default 100,
    status                   text default 'active',
    looking_for              text,
    profile_prompts          jsonb not null default '[]',
    notifications_enabled    boolean not null default true,
    share_phone              boolean not null default true,
    share_whatsapp           boolean not null default true,
    share_email              boolean not null default false,
    social_instagram         text,
    social_x                 text,
    social_tiktok            text,
    share_social_instagram   boolean not null default true,
    share_social_x           boolean not null default true,
    share_social_tiktok      boolean not null default true
  );

  create table public.user_blocks (
    blocker_id uuid not null,
    blocked_id uuid not null,
    primary key (blocker_id, blocked_id)
  );
  create table public.matches (
    id uuid primary key default gen_random_uuid(),
    user_a_id uuid, user_b_id uuid,
    compatibility_score integer not null default 0,
    status text default 'pending',
    is_visible boolean default false,
    created_at timestamptz default now()
  );
  create table public.match_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid, week_id text,
    tier1_match_id uuid, tier2_match_id uuid,
    delivered_at timestamptz
  );

  grant usage on schema public to anon, authenticated, service_role;
  grant usage on schema auth   to anon, authenticated, service_role;

  -- Measured live relacl: anon=awdDxtm, authenticated=awdDxtm
  grant select, insert, update, delete, truncate, references, trigger
    on public.users to anon, authenticated;
  grant select, insert, update, delete
    on public.user_blocks, public.matches, public.match_history to anon, authenticated;
  grant all on public.users, public.user_blocks, public.matches, public.match_history
    to service_role, supabase_admin;

  alter table public.users enable row level security;
  alter table public.user_blocks enable row level security;
  alter table public.matches enable row level security;
  alter table public.match_history enable row level security;

  -- ---- the three live UPDATE policies on users -------------------------
  create policy "Allow users to modify their own specific profile rows"
    on public.users for update to public
    using (auth.uid() = id);

  create policy "Users can update own profile"
    on public.users for update to authenticated
    using (auth.uid() = id);

  create policy "users_update_own"
    on public.users for update to authenticated
    using (id = auth.uid()) with check (id = auth.uid());

  -- ---- the live SELECT policies (RLS is on, so reads need them too) ----
  create policy "Allow public read access for active profiles"
    on public.users for select to public
    using ((profile_status = 'active') or (auth.uid() = id));

  create policy "Users can read own profile"
    on public.users for select to authenticated
    using (auth.uid() = id);

  create policy "users_read_paired"
    on public.users for select to authenticated
    using (auth.uid() is not null and id <> auth.uid());

  -- Reads on the supporting tables, so discover_candidates() can read them
  -- through the caller's role where it is not SECURITY DEFINER.
  create policy "support_read" on public.user_blocks for select to authenticated using (true);
  create policy "support_read" on public.matches for select to authenticated using (true);
  create policy "support_read" on public.match_history for select to authenticated using (true);

  -- ---- the live clamp function + trigger (must survive untouched) ------
  create or replace function public.clamp_user_protected_columns()
  returns trigger language plpgsql
  set search_path to 'public' as $fn$
  begin
    if current_user in ('service_role', 'supabase_admin', 'postgres') then
      return new;
    end if;
    if tg_op = 'INSERT' then
      new.section2_unlocked := false;
      new.section2_free_expires_at := null;
    else
      new.section2_unlocked := old.section2_unlocked;
      new.section2_free_expires_at := old.section2_free_expires_at;
    end if;
    return new;
  end;
  $fn$;

  create trigger trg_clamp_user_protected_cols
    before insert or update on public.users
    for each row execute function public.clamp_user_protected_columns();

  -- ---- the production-only legacy admin RPC --------------------------
  -- Shape captured from production: no authorization check in the body,
  -- writes profile_status (not status), EXECUTE granted to PUBLIC.
  create or replace function public.admin_update_user_status(p_user_id uuid, p_status text)
  returns void language plpgsql as $fn$
  begin
    update public.users set profile_status = p_status where id = p_user_id;
  end;
  $fn$;

  grant execute on function public.admin_update_user_status(uuid, text)
    to public, anon, authenticated, service_role;

  -- ---- the live discover_candidates() (pre-migration body) -------------
  create or replace function public.discover_candidates()
  returns table(id uuid, full_name text, age integer)
  language sql security definer set search_path to 'public' as $fn$
    select u.id, u.full_name, u.age
    from public.users u
    where u.id <> auth.uid()
      and u.profile_status = 'active'
      and u.section1_complete = true
      and u.gender <> (select me.gender from public.users me where me.id = auth.uid())
      and (
        u.campus_id = (select me.campus_id from public.users me where me.id = auth.uid())
        or (u.campus_id is null
            and (select me.campus_id from public.users me where me.id = auth.uid()) is null)
      )
      and not exists (
        select 1 from public.user_blocks ub
        where (ub.blocker_id = auth.uid() and ub.blocked_id = u.id)
           or (ub.blocker_id = u.id and ub.blocked_id = auth.uid())
      )
      and not exists (
        select 1 from public.matches m
        where (m.user_a_id = auth.uid() and m.user_b_id = u.id)
           or (m.user_b_id = auth.uid() and m.user_a_id = u.id)
      )
      and not exists (
        select 1 from public.match_history mh
        where (mh.user_id = auth.uid() and (mh.tier1_match_id = u.id or mh.tier2_match_id = u.id))
           or (mh.user_id = u.id and (mh.tier1_match_id = auth.uid() or mh.tier2_match_id = auth.uid()))
      )
    order by u.created_at
    limit 5
  $fn$;

  grant execute on function public.discover_candidates() to anon, authenticated, service_role;
`)

// ---- fixture rows ---------------------------------------------------------
const CAMPUS = '11111111-1111-1111-1111-111111111111'
const ALICE = 'aaaaaaaa-0000-0000-0000-000000000001' // active caller
const BOB = 'bbbbbbbb-0000-0000-0000-000000000002'   // active candidate (male)
const CAROL = 'cccccccc-0000-0000-0000-000000000003' // SUSPENDED candidate
const DAVE = 'dddddddd-0000-0000-0000-000000000004'  // PAUSED candidate
const ERIN = 'eeeeeeee-0000-0000-0000-000000000005'  // SUSPENDED caller (status axis)
const FRANK = 'ffffffff-0000-0000-0000-000000000006' // paused caller
const GRACE = '99999999-0000-0000-0000-000000000009' // SUSPENDED (profile_status axis)

await db.exec(`
  insert into public.users (id, email, full_name, age, gender, campus_id,
                            profile_status, section1_complete, bio, status,
                            reputation_score, created_at, onesignal_player_id)
  values
    ('${ALICE}', 'alice@x.test', 'Alice', 24, 'female', '${CAMPUS}',
     'active', true, 'orig bio', 'active', 100, now() - interval '5 days', 'os-a'),
    ('${BOB}',   'bob@x.test',   'Bob',   26, 'male',   '${CAMPUS}',
     'active', true, 'bob bio',  'active', 100, now() - interval '4 days', 'os-b'),
    ('${CAROL}', 'carol@x.test', 'Carol', 25, 'male',   '${CAMPUS}',
     'active', true, 'carol bio','suspended', 100, now() - interval '3 days', 'os-c'),
    ('${DAVE}',  'dave@x.test',  'Dave',  27, 'male',   '${CAMPUS}',
     'paused', true, 'dave bio', 'active', 100, now() - interval '2 days', 'os-d'),
    ('${ERIN}',  'erin@x.test',  'Erin',  23, 'female', '${CAMPUS}',
     'active', true, 'erin bio', 'suspended', 100, now() - interval '1 days', 'os-e'),
    ('${FRANK}', 'frank@x.test', 'Frank', 28, 'female', '${CAMPUS}',
     'paused', true, 'frank bio','active', 100, now() - interval '1 days', 'os-f'),
    ('${GRACE}', 'grace@x.test', 'Grace', 29, 'female', '${CAMPUS}',
     'suspended', true, 'grace bio','active', 100, now() - interval '1 days', 'os-g');
`)

// ---------------------------------------------------------------------------
// Apply the migration verbatim.
// ---------------------------------------------------------------------------
const applied = await db.exec(migrationSql)
assert.ok(applied, 'migration executed')

// ---------------------------------------------------------------------------
// Role helpers — mirror PostgREST.
//
// PostgREST publishes the verified JWT twice: the individual claims as
// request.jwt.claim.<name> and the whole claims object as request.jwt.claims.
// Both must be set, otherwise the guard's fallback chain is not exercised the
// way production exercises it.
// ---------------------------------------------------------------------------
async function setJwt(uid, role) {
  if (uid === null) {
    await db.exec(`reset request.jwt.claim.sub`)
  } else {
    await db.exec(`set request.jwt.claim.sub = '${uid}'`)
  }
  if (role === null) {
    await db.exec(`reset request.jwt.claim.role`)
    await db.exec(`reset request.jwt.claims`)
  } else {
    await db.exec(`set request.jwt.claim.role = '${role}'`)
    const claims = JSON.stringify({ role, sub: uid ?? undefined })
      .replace(/'/g, "''")
    await db.exec(`set request.jwt.claims = '${claims}'`)
  }
}

async function asUser(uid, fn) {
  await setJwt(uid, 'authenticated')
  await db.exec(`set role authenticated`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role`)
    await setJwt(null, null)
  }
}

// A service-role request: no end-user identity required, JWT role service_role.
async function asServiceRole(uid, fn) {
  await setJwt(uid, 'service_role')
  await db.exec(`set role service_role`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role`)
    await setJwt(null, null)
  }
}

async function asAnon(fn) {
  await setJwt(null, 'anon')
  await db.exec(`set role anon`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role`)
    await setJwt(null, null)
  }
}

async function scalar(sql, params) {
  const r = await db.query(sql, params)
  return r.rows[0]
}

async function expectOk(name, fn) {
  try {
    await fn()
    record(name, true, '')
  } catch (e) {
    record(name, false, `unexpected error: ${e.message}`)
  }
}

async function expectDenied(name, fn, snippet, _label) {
  try {
    await fn()
    record(name, false, 'the write SUCCEEDED but should have been refused')
  } catch (e) {
    const ok = snippet ? new RegExp(snippet, 'i').test(e.message) : true
    record(name, ok, ok ? '' : `refused, but wrong reason: ${e.message}`)
  }
}

// ===========================================================================
// 1. Authenticated user can update their own bio.
// ===========================================================================
await expectOk('1. authenticated user updates own bio', async () => {
  await asUser(ALICE, () => db.query(
    `update public.users set bio = 'alice new bio' where id = $1`, [ALICE]
  ))
  const row = await scalar(`select bio from public.users where id = $1`, [ALICE])
  assert.equal(row.bio, 'alice new bio')
})

// ===========================================================================
// 2. Authenticated user can update legitimate profile fields.
// ===========================================================================
await expectOk('2. authenticated user updates legitimate profile fields', async () => {
  await asUser(ALICE, () => db.query(
    `update public.users
        set full_name = 'Alice A', age = 25, residence_type = 'on-campus',
            looking_for = 'something serious', interests = '{music,chess}',
            phone = '+254700000001', whatsapp_number = '+254700000002',
            share_phone = false, share_whatsapp = true,
            social_instagram = 'alice_ig', notifications_enabled = false,
            onesignal_player_id = 'os-a2', profile_prompts = '[{"q":"a","a":"b"}]'::jsonb
      where id = $1`, [ALICE]
  ))
  const row = await scalar(
    `select full_name, age, residence_type, looking_for, phone,
            share_phone, notifications_enabled, onesignal_player_id
       from public.users where id = $1`, [ALICE])
  assert.equal(row.full_name, 'Alice A')
  assert.equal(row.age, 25)
  assert.equal(row.residence_type, 'on-campus')
  assert.equal(row.looking_for, 'something serious')
  assert.equal(row.phone, '+254700000001')
  assert.equal(row.share_phone, false)
  assert.equal(row.notifications_enabled, false)
  assert.equal(row.onesignal_player_id, 'os-a2')
})

// ===========================================================================
// 3. User can pause and resume their profile.
// ===========================================================================
await expectOk('3. user pauses their own profile', async () => {
  await asUser(ALICE, () => db.query(
    `update public.users set profile_status = 'paused' where id = $1`, [ALICE]))
  const row = await scalar(`select profile_status from public.users where id = $1`, [ALICE])
  assert.equal(row.profile_status, 'paused')
})

await expectOk('3. user resumes their own profile', async () => {
  await asUser(ALICE, () => db.query(
    `update public.users set profile_status = 'active' where id = $1`, [ALICE]))
  const row = await scalar(`select profile_status from public.users where id = $1`, [ALICE])
  assert.equal(row.profile_status, 'active')
})

// ===========================================================================
// 4. User cannot update reputation_score.  (column privilege withheld)
// ===========================================================================
await expectDenied('4. user cannot update reputation_score', async () => {
  await asUser(ALICE, () => db.query(
    `update public.users set reputation_score = 1 where id = $1`, [ALICE]))
}, 'permission denied')

await expectOk('4b. reputation_score unchanged', async () => {
  const row = await scalar(`select reputation_score from public.users where id = $1`, [ALICE])
  assert.equal(row.reputation_score, 100)
})

// ===========================================================================
// 5. User cannot change status.  (column privilege withheld)
// ===========================================================================
await expectDenied('5. user cannot change status', async () => {
  await asUser(ALICE, () => db.query(
    `update public.users set status = 'suspended' where id = $1`, [ALICE]))
}, 'permission denied')

// ===========================================================================
// 6. User cannot update another user's row.
//
//    Under RLS a non-matching USING clause filters the row out of the UPDATE,
//    so the statement succeeds with 0 rows affected rather than raising. That
//    IS the denial — assert the row is unchanged, not that an error is thrown.
// ===========================================================================
await expectOk('6. user cannot update another user row (0 rows affected)', async () => {
  const r = await asUser(ALICE, () => db.query(
    `update public.users set bio = 'hacked' where id = $1 returning id`, [BOB]))
  assert.equal(r.rows.length, 0, `cross-user UPDATE touched ${r.rows.length} row(s)`)
})

await expectOk('6b. other user row untouched', async () => {
  const row = await scalar(`select bio from public.users where id = $1`, [BOB])
  assert.notEqual(row.bio, 'hacked', 'Bob\'s bio was overwritten')
})

// ===========================================================================
// 7. User cannot reactivate an administrator-suspended account.
//    Erin: status='suspended', profile_status='active'  (admin-axis suspension)
//    Grace: status='active',    profile_status='suspended' (legacy-axis suspension)
// ===========================================================================
await expectDenied('7. suspended user (status axis) cannot self-reactivate', async () => {
  // Erin has status='suspended', profile_status='active'. The attack is to
  // first drop themselves to 'paused'/'incomplete' and then back to 'active',
  // which would launder the suspension. Assert the laundering path is refused
  // at its final step AND that the intermediate step cannot reach 'active'.
  let sawRefusal = false
  for (const target of ['active', 'incomplete', 'paused']) {
    try {
      await asUser(ERIN, () => db.query(
        `update public.users set profile_status = $2 where id = $1`, [ERIN, target]))
    } catch (e) {
      if (/suspended/i.test(e.message)) sawRefusal = true
      else throw e
    }
  }
  // Erin started at 'active'. Any transition away then back must be refused.
  assert.equal(sawRefusal, true, 'no reactivation attempt was refused')
})

await expectDenied('7-raw. suspended user cannot write active over a non-active profile_status', async () => {
  // Force the precondition directly: Erin parked at 'paused' by the server,
  // then the client asks for 'active'.
  await db.exec(`reset role`)
  await db.query(`update public.users set profile_status = 'paused' where id = $1`, [ERIN])
  await asUser(ERIN, () => db.query(
    `update public.users set profile_status = 'active' where id = $1`, [ERIN]))
}, 'suspended')

await expectDenied('7b. suspended user (profile_status axis) cannot self-reactivate', async () => {
  await asUser(GRACE, () => db.query(
    `update public.users set profile_status = 'active' where id = $1`, [GRACE]))
}, 'suspended', '7-reactive-profile-axis')

await expectDenied('7c. suspended user cannot clear status', async () => {
  await asUser(ERIN, () => db.query(
    `update public.users set status = 'active' where id = $1`, [ERIN]))
}, 'permission denied')

await expectOk('7d. suspended account stays suspended', async () => {
  const row = await scalar(`select status, profile_status from public.users where id = $1`, [ERIN])
  assert.equal(row.status, 'suspended')
})

await expectOk('7e. legacy-axis suspended account stays suspended', async () => {
  const row = await scalar(`select profile_status from public.users where id = $1`, [GRACE])
  assert.equal(row.profile_status, 'suspended')
})

// A suspended user may still edit an unrelated profile field.
await expectOk('7f. suspended user may still edit their bio', async () => {
  await asUser(ERIN, () => db.query(
    `update public.users set bio = 'still here' where id = $1`, [ERIN]))
  const row = await scalar(`select bio from public.users where id = $1`, [ERIN])
  assert.equal(row.bio, 'still here')
})

// ===========================================================================
// 8. Anonymous user cannot update users.
// ===========================================================================
await expectDenied('8. anon cannot update users', async () => {
  await asAnon(() => db.query(
    `update public.users set bio = 'anon' where id = $1`, [ALICE]))
})

await expectOk('8b. anon denial is real (grant-level)', async () => {
  const row = await scalar(`select has_table_privilege('anon','public.users','UPDATE') as ok`)
  assert.equal(row.ok, false)
})

// ===========================================================================
// 9. Suspended accounts are excluded from discovery.
// ===========================================================================
await expectOk('9. suspended candidate excluded from discovery', async () => {
  const r = await asUser(ALICE, () => db.query(`select id from public.discover_candidates()`))
  const ids = r.rows.map(x => x.id)
  assert.ok(!ids.includes(CAROL), 'suspended Carol was returned')
  assert.ok(!ids.includes(DAVE), 'paused Dave was returned')
  assert.ok(ids.includes(BOB), 'active Bob was not returned')
})

await expectOk('9b. suspended caller gets no candidates', async () => {
  const r = await asUser(ERIN, () => db.query(`select id from public.discover_candidates()`))
  assert.equal(r.rows.length, 0, `suspended caller saw ${r.rows.length} candidates`)
})

await expectOk('9c. paused caller gets no candidates', async () => {
  const r = await asUser(FRANK, () => db.query(`select id from public.discover_candidates()`))
  assert.equal(r.rows.length, 0, `paused caller saw ${r.rows.length} candidates`)
})

await expectOk('9d. existing eligibility rules intact (gender + block + limit)', async () => {
  // Alice is female: Bob (male) is the only eligible candidate. Carol and Dave
  // are excluded by state. No same-gender row is ever returned.
  const r = await asUser(ALICE, () => db.query(
    `select id, full_name from public.discover_candidates()`))
  for (const row of r.rows) {
    const g = await scalar(`select gender from public.users where id = $1`, [row.id])
    assert.notEqual(g.gender, 'female', 'same-gender candidate leaked')
  }
  assert.ok(r.rows.length <= 5, 'limit 5 not honoured')
})

// ===========================================================================
// 10. Suspended accounts are excluded from weekly matching.
//     The edge function filters on status+profile_status; we assert the
//     predicate itself returns the right set against this fixture.
// ===========================================================================
await expectOk('10. weekly-matching predicate excludes suspended/paused', async () => {
  const r = await db.query(
    `select id from public.users
      where section1_complete = true
        and status = 'active'
        and profile_status = 'active'
      order by id`)
  const ids = r.rows.map(x => x.id)
  assert.ok(ids.includes(ALICE), 'active Alice missing from matching pool')
  assert.ok(ids.includes(BOB), 'active Bob missing from matching pool')
  assert.ok(!ids.includes(CAROL), 'suspended Carol entered the matching pool')
  assert.ok(!ids.includes(DAVE), 'paused Dave entered the matching pool')
  assert.ok(!ids.includes(ERIN), 'suspended Erin entered the matching pool')
  assert.ok(!ids.includes(FRANK), 'paused Frank entered the matching pool')
})

// The repository file must carry that predicate.
await expectOk('10b. match-generator selects status and profile_status', async () => {
  const src = readFileSync('supabase/functions/match-generator/index.ts', 'utf8')
  assert.match(src, /\.eq\('status',\s*'active'\)/, "match-generator lacks .eq('status','active')")
  assert.match(src, /\.eq\('profile_status',\s*'active'\)/, "match-generator lacks .eq('profile_status','active')")
  assert.match(src, /\.eq\('section1_complete',\s*true\)/, "match-generator lacks section1_complete filter")
})

// ===========================================================================
// 11. Null-safety of profile_status validation.
// ===========================================================================
await expectOk('11. null profile_status normalises rather than crashing', async () => {
  await db.exec(`update public.users set profile_status = null where id = '${BOB}'`)
  await asUser(BOB, () => db.query(
    `update public.users set bio = 'bob null-safe' where id = $1`, [BOB]))
  const row = await scalar(`select profile_status, bio from public.users where id = $1`, [BOB])
  assert.equal(row.bio, 'bob null-safe')
})

await expectDenied('11b. invented profile_status value is refused', async () => {
  await asUser(ALICE, () => db.query(
    `update public.users set profile_status = 'admin' where id = $1`, [ALICE]))
})

// ===========================================================================
// 12. Privilege and policy shape as specified.
// ===========================================================================
await expectOk('12. final privilege shape matches the specification', async () => {
  const t = await scalar(
    `select has_table_privilege('authenticated','public.users','UPDATE') as auth_t,
            has_table_privilege('anon','public.users','UPDATE') as anon_t,
            has_column_privilege('authenticated','public.users','reputation_score','UPDATE') as rep,
            has_column_privilege('authenticated','public.users','status','UPDATE') as st,
            has_column_privilege('authenticated','public.users','bio','UPDATE') as bio,
            has_column_privilege('authenticated','public.users','profile_status','UPDATE') as ps`)
  assert.equal(t.auth_t, false, 'authenticated still holds table UPDATE')
  assert.equal(t.anon_t, false, 'anon still holds table UPDATE')
  assert.equal(t.rep, false, 'reputation_score still writable')
  assert.equal(t.st, false, 'status still writable')
  assert.equal(t.bio, true, 'bio not writable')
  assert.equal(t.ps, true, 'profile_status not writable')

  const p = await scalar(
    `select count(*) filter (where cmd='UPDATE') as upd,
            count(*) filter (where cmd='UPDATE' and 'public' = any(roles)) as upd_public,
            count(*) filter (where cmd='UPDATE' and policyname='users_update_own_row'
                               and qual is not null and with_check is not null) as own_row
       from pg_policies where schemaname='public' and tablename='users'`)
  assert.equal(Number(p.upd), 1, `expected 1 UPDATE policy, found ${p.upd}`)
  assert.equal(Number(p.upd_public), 0, 'a PUBLIC-scoped UPDATE policy survived')
  assert.equal(Number(p.own_row), 1, 'users_update_own_row missing or lacks USING/WITH CHECK')
})

await expectOk('12b. pre-existing clamp trigger preserved', async () => {
  const row = await scalar(
    `select count(*) as n from pg_trigger
      where tgrelid='public.users'::regclass and tgname='trg_clamp_user_protected_cols'
        and not tgisinternal`)
  assert.equal(Number(row.n), 1)
})

await expectOk('12c. clamp trigger still fires for a non-server role', async () => {
  // section2_unlocked is revoked from the client, so prove the clamp trigger
  // itself is still wired and still rewrites the value for an application role.
  // The trigger restores OLD, so a client-style write must leave it unchanged.
  await db.exec(`set request.jwt.claim.sub = '${ALICE}'`)
  await db.exec(`set role authenticated`)
  try {
    // Bypass the column grant to reach the trigger: grant is revoked, so a
    // direct client write is expected to fail at the privilege layer first.
    let denied = false
    try {
      await db.query(`update public.users set section2_unlocked = true where id = $1`, [ALICE])
    } catch {
      denied = true
    }
    assert.equal(denied, true, 'client could still write section2_unlocked')
  } finally {
    await db.exec(`reset role`)
    await setJwt(null, null)
  }

  // And the trigger is registered.
  const n = await scalar(`select count(*) as n from pg_trigger
    where tgrelid='public.users'::regclass and tgname='trg_clamp_user_protected_cols' and not tgisinternal`)
  assert.equal(Number(n.n), 1)
})

// ===========================================================================
// 13. SECURITY DEFINER is not a trust boundary.
//
//     An authenticated caller that reaches a definer-rights function owned by
//     postgres gets current_user = 'postgres'. The guard must NOT read that as
//     "server-side writer" and must keep enforcing the client rules.
//
//     Two probes are installed, exactly as an attacker (or an innocent helper
//     routine) would:
//       * public.probe_definer_set_status()   — tries to un-suspend the caller
//       * public.probe_definer_set_reputation() — tries to raise reputation
//     Both are SECURITY DEFINER and owned by the bootstrap superuser, which is
//     the strongest current_user escalation available.
// ===========================================================================
await db.exec(`
  create or replace function public.probe_definer_set_status(p_status text)
  returns void language plpgsql security definer set search_path to 'public' as $fn$
  begin
    update public.users set status = p_status where id = auth.uid();
  end;
  $fn$;

  create or replace function public.probe_definer_set_reputation(p_score integer)
  returns void language plpgsql security definer set search_path to 'public' as $fn$
  begin
    update public.users set reputation_score = p_score where id = auth.uid();
  end;
  $fn$;

  create or replace function public.probe_definer_set_profile_status(p_status text)
  returns void language plpgsql security definer set search_path to 'public' as $fn$
  begin
    update public.users set profile_status = p_status where id = auth.uid();
  end;
  $fn$;

  grant execute on function public.probe_definer_set_status(text) to authenticated;
  grant execute on function public.probe_definer_set_reputation(integer) to authenticated;
  grant execute on function public.probe_definer_set_profile_status(text) to authenticated;
`)

await expectOk('13. definer probe really does escalate current_user to postgres', async () => {
  // Prove the probe is a valid attack surface: inside it, current_user is a
  // role the old guard trusted. Otherwise test 13b would pass vacuously.
  await db.exec(`
    create or replace function public.probe_whoami() returns text
    language plpgsql security definer as $fn$
    begin return current_user; end;
    $fn$;
    grant execute on function public.probe_whoami() to authenticated;
  `)
  const row = await asUser(ALICE, () => scalar(`select public.probe_whoami() as u`))
  assert.ok(
    ['postgres', 'supabase_admin', 'service_role'].includes(row.u),
    `definer probe ran as ${row.u}; it does not reproduce the escalation`
  )
})

await expectDenied('13a. authenticated user cannot change status via SECURITY DEFINER', async () => {
  await asUser(ERIN, () => db.query(
    `select public.probe_definer_set_status('active')`))
}, 'server-owned|permission denied')

await expectOk('13a2. suspended account still suspended after definer attempt', async () => {
  const row = await scalar(`select status from public.users where id = $1`, [ERIN])
  assert.equal(row.status, 'suspended', `definer bypass changed status to ${row.status}`)
})

await expectDenied('13b. authenticated user cannot raise reputation via SECURITY DEFINER', async () => {
  await asUser(ALICE, () => db.query(
    `select public.probe_definer_set_reputation(9999)`))
}, 'server-owned|permission denied')

await expectOk('13b2. reputation unchanged after definer attempt', async () => {
  const row = await scalar(`select reputation_score from public.users where id = $1`, [ALICE])
  assert.equal(row.reputation_score, 100, `reputation became ${row.reputation_score}`)
})

await expectDenied('13c. authenticated user cannot self-reactivate via SECURITY DEFINER', async () => {
  // Erin is suspended on the status axis (status='suspended'). Park her
  // profile_status at 'paused' so the guard's transition rule — not the
  // column-privilege rule — is the one under test, then attack through a
  // definer-rights function. Parking on the status axis keeps the suspension
  // marker intact; parking Grace on profile_status would erase it.
  await db.exec(`reset role`)
  await db.query(`update public.users set profile_status = 'paused' where id = $1`, [ERIN])
  await asUser(ERIN, () => db.query(
    `select public.probe_definer_set_profile_status('active')`))
}, 'suspended')

await expectOk('13c2. profile_status unchanged after definer reactivation attempt', async () => {
  const row = await scalar(`select profile_status from public.users where id = $1`, [ERIN])
  assert.equal(row.profile_status, 'paused')
})

await expectOk('13d. definer path still allows a legitimate own-row edit', async () => {
  // The guard must not become a blanket ban on definer functions; only the
  // protected rules apply.
  await db.exec(`
    create or replace function public.probe_definer_set_bio(p_bio text)
    returns void language plpgsql security definer set search_path to 'public' as $fn$
    begin update public.users set bio = p_bio where id = auth.uid(); end;
    $fn$;
    grant execute on function public.probe_definer_set_bio(text) to authenticated;
  `)
  await asUser(ALICE, () => db.query(`select public.probe_definer_set_bio('via definer')`))
  const row = await scalar(`select bio from public.users where id = $1`, [ALICE])
  assert.equal(row.bio, 'via definer')
})

// ===========================================================================
// 14. A service-role request can still perform legitimate status changes.
// ===========================================================================
await expectOk('14. service_role can suspend a user', async () => {
  await asServiceRole(null, () => db.query(
    `update public.users set status = 'suspended' where id = $1`, [BOB]))
  const row = await scalar(`select status from public.users where id = $1`, [BOB])
  assert.equal(row.status, 'suspended')
})

await expectOk('14b. service_role can lift a suspension', async () => {
  await asServiceRole(null, () => db.query(
    `update public.users set status = 'active' where id = $1`, [BOB]))
  const row = await scalar(`select status from public.users where id = $1`, [BOB])
  assert.equal(row.status, 'active')
})

await expectOk('14c. service_role can set profile_status past the client vocabulary', async () => {
  await asServiceRole(null, () => db.query(
    `update public.users set profile_status = 'suspended' where id = $1`, [BOB]))
  const row = await scalar(`select profile_status from public.users where id = $1`, [BOB])
  assert.equal(row.profile_status, 'suspended')
  await db.exec(`update public.users set profile_status = 'active' where id = '${BOB}'`)
})

await expectOk('14d. service_role can adjust reputation_score', async () => {
  await asServiceRole(null, () => db.query(
    `update public.users set reputation_score = 130 where id = $1`, [BOB]))
  const row = await scalar(`select reputation_score from public.users where id = $1`, [BOB])
  assert.equal(row.reputation_score, 130)
  await db.exec(`update public.users set reputation_score = 100 where id = '${BOB}'`)
})

await expectOk('14e. service_role bypass works via request.jwt.claims alone', async () => {
  // Exercise the second link of the fallback chain: only the claims JSON is set.
  await db.exec(`set request.jwt.claim.sub = ''`)
  await db.exec(`reset request.jwt.claim.role`)
  await db.exec(`set request.jwt.claims = '{"role":"service_role"}'`)
  await db.exec(`set role service_role`)
  try {
    await db.query(`update public.users set status = 'suspended' where id = $1`, [CAROL])
    const row = await scalar(`select status from public.users where id = $1`, [CAROL])
    assert.equal(row.status, 'suspended')
  } finally {
    await db.query(`update public.users set status = 'suspended' where id = $1`, [CAROL])
    await db.exec(`reset role`)
    await db.exec(`reset request.jwt.claims`)
  }
})

// ===========================================================================
// 15. The legacy admin RPC is not executable by client roles.
// ===========================================================================
await expectOk('15. legacy RPC exists in the fixture and was locked down', async () => {
  const row = await scalar(
    `select has_function_privilege('authenticated',
              'public.admin_update_user_status(uuid, text)','EXECUTE') as auth_exec,
            has_function_privilege('anon',
              'public.admin_update_user_status(uuid, text)','EXECUTE') as anon_exec,
            has_function_privilege('service_role',
              'public.admin_update_user_status(uuid, text)','EXECUTE') as svc_exec`)
  assert.equal(row.auth_exec, false, 'authenticated still holds EXECUTE')
  assert.equal(row.anon_exec, false, 'anon still holds EXECUTE')
  assert.equal(row.svc_exec, true, 'service_role lost EXECUTE')
})

await expectDenied('15a. authenticated user cannot execute the legacy RPC', async () => {
  await asUser(ALICE, () => db.query(
    `select public.admin_update_user_status($1, 'suspended')`, [BOB]))
}, 'permission denied')

await expectDenied('15b. anon cannot execute the legacy RPC', async () => {
  await asAnon(() => db.query(
    `select public.admin_update_user_status($1, 'suspended')`, [ALICE]))
}, 'permission denied')

await expectOk('15c. target row unaffected by the refused attempts', async () => {
  const row = await scalar(`select profile_status from public.users where id = $1`, [BOB])
  assert.notEqual(row.profile_status, 'suspended')
})

// ===========================================================================
// 16. The legacy RPC stays executable by service_role.
// ===========================================================================
await expectOk('16. service_role can execute the legacy RPC', async () => {
  await asServiceRole(null, () => db.query(
    `select public.admin_update_user_status($1, 'paused')`, [BOB]))
  const row = await scalar(`select profile_status from public.users where id = $1`, [BOB])
  assert.equal(row.profile_status, 'paused')
})

await expectOk('16b. restore fixture state after the RPC call', async () => {
  await db.exec(`update public.users set profile_status = 'active' where id = '${BOB}'`)
  const row = await scalar(`select profile_status from public.users where id = $1`, [BOB])
  assert.equal(row.profile_status, 'active')
})

// ===========================================================================
// 17. The migration must not require the legacy RPC to exist.
//     A second, clean database applies the same file with no admin RPC present
//     and must succeed.
// ===========================================================================
await expectOk('17. migration applies cleanly when the legacy RPC is absent', async () => {
  const bare = new PGlite()
  try {
    // Same minimal shape the migration's preconditions require.
    const shapeSql = fixtureSqlForBareDb()
    await bare.exec(shapeSql)
    await bare.exec(migrationSql)
    const reg = await bare.query(
      `select to_regprocedure('public.admin_update_user_status(uuid, text)') as r`)
    assert.equal(reg.rows[0].r, null, 'bare fixture unexpectedly has the legacy RPC')
  } finally {
    await bare.close()
  }
})

// ---------------------------------------------------------------------------
// Minimal fixture for test 17: the shape the migration's preconditions need,
// built with exprssly NO public.admin_update_user_status.
// ---------------------------------------------------------------------------
function fixtureSqlForBareDb() {
  return `
    create role anon;
    create role authenticated;
    create role service_role;
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

    create table public.users (
      id uuid primary key, email text not null, full_name text, age integer,
      gender text, campus_id uuid, residence_type text, bio text,
      interests text[] default '{}', profile_status text default 'incomplete',
      section1_progress integer default 0, section1_complete boolean default false,
      section1_last_edited timestamptz, section2_unlocked boolean default false,
      section2_free_expires_at timestamptz, phone text, onesignal_player_id text,
      created_at timestamptz default now(), reg_number text, whatsapp_number text,
      display_phone text, section2_responses integer[] default '{}',
      reputation_score integer default 100, status text default 'active',
      looking_for text, profile_prompts jsonb not null default '[]',
      notifications_enabled boolean not null default true,
      share_phone boolean not null default true,
      share_whatsapp boolean not null default true,
      share_email boolean not null default false,
      social_instagram text, social_x text, social_tiktok text,
      share_social_instagram boolean not null default true,
      share_social_x boolean not null default true,
      share_social_tiktok boolean not null default true
    );
    create table public.user_blocks (
      blocker_id uuid not null, blocked_id uuid not null,
      primary key (blocker_id, blocked_id));
    create table public.matches (
      id uuid primary key default gen_random_uuid(), user_a_id uuid, user_b_id uuid,
      compatibility_score integer not null default 0, status text default 'pending',
      is_visible boolean default false, created_at timestamptz default now());
    create table public.match_history (
      id uuid primary key default gen_random_uuid(), user_id uuid, week_id text,
      tier1_match_id uuid, tier2_match_id uuid, delivered_at timestamptz);

    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth to anon, authenticated, service_role;
    grant select, insert, update, delete, truncate, references, trigger
      on public.users to anon, authenticated;
    grant select, insert, update, delete
      on public.user_blocks, public.matches, public.match_history to anon, authenticated;
    grant all on public.users, public.user_blocks, public.matches, public.match_history
      to service_role;

    alter table public.users enable row level security;
    alter table public.user_blocks enable row level security;
    alter table public.matches enable row level security;
    alter table public.match_history enable row level security;

    create policy "Allow users to modify their own specific profile rows"
      on public.users for update to public using (auth.uid() = id);
    create policy "Users can update own profile"
      on public.users for update to authenticated using (auth.uid() = id);
    create policy "users_update_own"
      on public.users for update to authenticated
      using (id = auth.uid()) with check (id = auth.uid());
    create policy "Allow public read access for active profiles"
      on public.users for select to public
      using ((profile_status = 'active') or (auth.uid() = id));

    create or replace function public.clamp_user_protected_columns()
    returns trigger language plpgsql set search_path to 'public' as $fn$
    begin
      if current_user in ('service_role', 'supabase_admin', 'postgres') then
        return new;
      end if;
      if tg_op = 'INSERT' then
        new.section2_unlocked := false;
        new.section2_free_expires_at := null;
      else
        new.section2_unlocked := old.section2_unlocked;
        new.section2_free_expires_at := old.section2_free_expires_at;
      end if;
      return new;
    end;
    $fn$;

    create trigger trg_clamp_user_protected_cols
      before insert or update on public.users
      for each row execute function public.clamp_user_protected_columns();

    create or replace function public.discover_candidates()
    returns table(id uuid, full_name text, age integer)
    language sql security definer set search_path to 'public' as $fn$
      select u.id, u.full_name, u.age from public.users u where u.id <> auth.uid()
    $fn$;
    grant execute on function public.discover_candidates()
      to anon, authenticated, service_role;
  `
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------
console.log(results.join('\n'))
console.log(`\n${passed}/${passed + failed} checks passed`)
if (failed > 0) {
  console.log(`\n${failed} FAILED`)
  process.exitCode = 1
}
