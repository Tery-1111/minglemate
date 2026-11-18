-- MM-D2: intentional publication conflicts must be answerable immediately.
--
-- `publish_week_allocation` raised its two intentional verdicts with SQLSTATE
-- 40001. That class means "serialization failure / transaction rollback", and
-- PostgREST answers it by closing the connection instead of returning a JSON
-- error, so the caller only learned the verdict when the gateway's upstream read
-- timeout expired (~61s on the local stack).
--
-- Both conditions are business outcomes, not unexpected database failures:
--   * the run's generation is older than the newest authorized run,
--   * the same generation was already published with a different payload.
-- They now raise PT409, which PostgREST passes through as HTTP 409 with the
-- message intact. Every other exception code is untouched.
--
-- Forward-only: the function body is recreated verbatim from
-- 20261118120000_match_generation_fencing.sql with only the two errcodes and the
-- two message fields changed, so the fence, the payload binding, the week lock,
-- the atomic replacement, the rollback and the grants are all preserved.

create or replace function public.publish_week_allocation(
  p_week_id    text,
  p_generation bigint,
  p_rows       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_generation   bigint;
  published_generation bigint;
  stored_rows          jsonb;
  incoming_rows        jsonb := coalesce(p_rows, '[]'::jsonb);
  inserted             integer;
  existing_count       integer;
begin
  if p_week_id is null or p_week_id = '' then
    raise exception 'publish_week_allocation: week id is required' using errcode = '22023';
  end if;
  if p_generation is null then
    raise exception 'publish_week_allocation: generation is required' using errcode = '22023';
  end if;

  -- Row lock: serialises publishers of THIS week for the rest of the
  -- transaction, and is released on commit and on rollback alike.
  -- Distinct weeks use distinct rows, so they never block each other.
  select latest_generation, latest_published_generation, published_rows
    into current_generation, published_generation, stored_rows
  from public.match_week_generations
  where week_id = p_week_id
  for update;

  if not found then
    raise exception 'unknown_generation' using errcode = 'P0002';
  end if;

  -- FENCING: only the newest authorized run may publish. Checked before any
  -- write, so a rejected run leaves match_history and the counters untouched.
  -- PT409: an expected conflict, answered by PostgREST as HTTP 409.
  if p_generation < current_generation then
    raise exception using errcode = 'PT409', message = 'stale_generation';
  end if;

  -- REPLAY BINDING: one generation publishes exactly one allocation.
  -- Repeating an already published generation is accepted only when the
  -- payload is identical, and then it writes nothing at all. A different
  -- payload under the same generation is rejected, so a repeat can never
  -- silently replace an allocation that is already live. Publishers are
  -- serialised by the row lock above, so concurrent conflicting replicas
  -- cannot both succeed.
  -- PT409: an expected conflict, answered by PostgREST as HTTP 409.
  if p_generation = published_generation then
    if stored_rows is distinct from incoming_rows then
      raise exception using errcode = 'PT409', message = 'generation_conflict';
    end if;
    select count(*) into existing_count from public.match_history where week_id = p_week_id;
    return jsonb_build_object('published', existing_count, 'generation', p_generation, 'replayed', true);
  end if;

  -- Week-scoped replace. Historical weeks are unreachable by this predicate.
  delete from public.match_history where week_id = p_week_id;

  insert into public.match_history (user_id, week_id, tier1_match_id, tier2_match_id, delivered_at)
  select (r->>'user_id')::uuid,
         p_week_id,
         nullif(r->>'tier1_match_id', '')::uuid,
         nullif(r->>'tier2_match_id', '')::uuid,
         (r->>'delivered_at')::timestamptz
  from jsonb_array_elements(incoming_rows) as r;

  get diagnostics inserted = row_count;

  update public.match_week_generations
     set latest_published_generation = p_generation,
         -- Invariant: the newest authorization is never older than the newest
         -- publication (only reachable when publish is called out of order).
         latest_generation = greatest(latest_generation, p_generation),
         published_rows = incoming_rows,
         published_at = now(),
         updated_at = now()
   where week_id = p_week_id;

  return jsonb_build_object('published', inserted, 'generation', p_generation, 'replayed', false);
end $$;

-- The ACLs are restated so the replacement keeps exactly the privileges the
-- fencing migration established: service_role executes, nobody else does.
revoke all on function public.publish_week_allocation(text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.publish_week_allocation(text, bigint, jsonb) to service_role;
grant select on public.match_week_generations to service_role;

comment on function public.publish_week_allocation(text, bigint, jsonb) is
  'Fenced, atomic replacement of one week of match_history. Raises PT409 stale_generation without writing when a newer run has been authorized, and PT409 generation_conflict when the same generation is repeated with a different payload.';
