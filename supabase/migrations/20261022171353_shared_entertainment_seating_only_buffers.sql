begin;

-- Carlos approved seating-only setup/cleanup buffers on October 22, 2026.
-- Entertainment (including karaoke/VIP) uses actual half-open intervals.
-- Seating remains in Event Host floor plans; Mini Golf remains uncapped open play.
-- Historical migrations stay immutable. Install only before authority cutover.
lock table shared_inventory.control, shared_inventory.writers in share row exclusive mode;
do $$
begin
  if exists(select 1 from shared_inventory.control where enabled or baseline_ready)
    or exists(select 1 from shared_inventory.writers where enabled) then
    raise exception 'buffer_policy_requires_disabled_authority';
  end if;
end;
$$;

create or replace function shared_inventory.shared_inventory_claim(p_writer text, p_key text, p_request jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  ctl shared_inventory.control;
  previous shared_inventory.operations;
  answer jsonb;
  -- Physical capacity only: synthetic Big Show and open-play mini golf are not extra units.
  canonical_ids constant text[] := array[
    'bowling-1','bowling-2','bowling-3','bowling-4','bowling-5','bowling-6',
    'bowling-7','bowling-8','bowling-9','bowling-10','bowling-11','bowling-12',
    'darts-1','darts-2','darts-3','darts-4','darts-5','pool-1','pool-2','pool-3',
    'shuffleboard-1','shuffleboard-2','private-room-disco-inferno','private-room-gem',
    'private-room-ocean','private-room-prime','private-room-royal','private-room-vip-1','private-room-vip-2'];
  ids text[];
  replacements uuid[];
  claim_id uuid := gen_random_uuid();
  start_at timestamptz;
  end_at timestamptz;
  expiry timestamptz;
  v_kind text := p_request->>'kind';
  owner_ref text := p_request->>'ownerReference';
  event_ref text := nullif(p_request->>'eventId','');
  group_name text := p_request->>'group';
  conflict_ids uuid[];
  stamp timestamptz;
begin
  if p_writer is null or not exists(select 1 from shared_inventory.writers where id=p_writer) or
    p_key is null or length(p_key) not between 8 and 200 or
    p_request is null or jsonb_typeof(p_request) <> 'object' or
    owner_ref is null or length(owner_ref) not between 1 and 200 or
    v_kind is null or v_kind not in ('event','room-booking','walk-in','checkout-hold') or
    (v_kind='event' and (event_ref is null or coalesce(p_request->>'approvalReference','') = '')) then
    raise exception 'invalid_claim_request';
  end if;
  start_at := (p_request->>'startsAt')::timestamptz;
  end_at := (p_request->>'endsAt')::timestamptz;
  expiry := nullif(p_request->>'expiresAt','')::timestamptz;
  if start_at is null or end_at is null or not isfinite(start_at) or not isfinite(end_at) or
    end_at <= start_at or end_at-start_at > interval '31 days' or
    (v_kind='checkout-hold') <> (expiry is not null) then raise exception 'invalid_claim_interval'; end if;
  if jsonb_typeof(p_request->'resourceIds') is distinct from 'array' or
    jsonb_typeof(p_request->'replaceClaimIds') is distinct from 'array' then raise exception 'invalid_claim_resources'; end if;
  select array_agg(value order by value) into ids from jsonb_array_elements_text(p_request->'resourceIds');
  select coalesce(array_agg(value::uuid order by value),'{}'::uuid[]) into replacements
    from jsonb_array_elements_text(p_request->'replaceClaimIds');
  if cardinality(replacements) > 100 or cardinality(replacements) <> (select count(distinct id) from unnest(replacements) id) then
    raise exception 'invalid_claim_replacements';
  end if;
  if group_name in ('buyout','big-show') then
    if group_name='buyout' and v_kind <> 'event' then raise exception 'invalid_buyout'; end if;
    if cardinality(ids) > 0 then raise exception 'expanded_group_requires_empty_resources'; end if;
    select array_agg(id order by id) into ids from public.entertainment_resources
    where active and id=any(canonical_ids) and (group_name='buyout' or id in ('private-room-disco-inferno','private-room-gem','private-room-ocean','private-room-prime','private-room-royal'));
    if cardinality(ids) is distinct from (case when group_name='buyout' then 29 else 5 end) then
      raise exception 'incomplete_resource_catalog';
    end if;
  elsif group_name is null or group_name not in ('bowling','darts','pool','shuffleboard','karaoke','vip') then
    raise exception 'invalid_claim_group';
  end if;
  if coalesce(cardinality(ids),0)=0 or cardinality(ids)>50 or
    cardinality(ids) <> (select count(distinct id) from unnest(ids) id) or
    exists(select 1 from unnest(ids) requested(resource_id) where not exists(
      select 1 from public.entertainment_resources r where r.id=requested.resource_id and r.id=any(canonical_ids) and r.active and
      (group_name='buyout' or (group_name in ('karaoke','big-show') and r.id in
        ('private-room-disco-inferno','private-room-gem','private-room-ocean','private-room-prime','private-room-royal')) or
        (group_name='vip' and r.id in ('private-room-vip-1','private-room-vip-2')) or r.category=group_name))) then
    raise exception 'invalid_claim_resources';
  end if;
  if group_name in ('bowling','darts') and
    (select max(split_part(id,'-',2)::int)-min(split_part(id,'-',2)::int)+1 from unnest(ids) id) <> cardinality(ids) then
    raise exception 'adjacent_resources_required';
  end if;

  -- One venue-level row lock serializes all resources, buyouts, replacements and idempotency.
  -- Read committed is required; stale snapshots under other isolation levels are rejected.
  if current_setting('transaction_isolation') <> 'read committed' then raise exception 'read_committed_required'; end if;
  select * into strict ctl from shared_inventory.control where id for update;
  stamp := clock_timestamp();
  select * into previous from shared_inventory.operations where writer=p_writer and operation_key=p_key;
  if found then
    if previous.request <> p_request then raise exception 'idempotency_key_reused'; end if;
    if previous.result->>'status'='secured' and not exists (
      select 1 from shared_inventory.claims where id=(previous.result->>'claimId')::uuid
        and active and (expires_at is null or expires_at>stamp)
    ) then return jsonb_build_object('status','unknown','reason','claim_no_longer_active'); end if;
    return previous.result;
  end if;
  if not ctl.enabled or not ctl.baseline_ready or exists(select 1 from shared_inventory.writers where not enabled) then
    answer := jsonb_build_object('status','unknown','reason','writer_cutover_incomplete');
  elsif (p_request->>'expectedRevision')::bigint is distinct from ctl.revision then
    answer := jsonb_build_object('status','unknown','reason','revision_changed');
  elsif (select count(*) from shared_inventory.checkpoints where complete and checked_at <= stamp and
    checked_at >= stamp-interval '2 minutes' and covers_from <= start_at and covers_to >= end_at and
    revision = p_request->'sourceRevisions'->>source) <> 3 then
    answer := jsonb_build_object('status','unknown','reason','source_evidence_incomplete');
  elsif (v_kind='checkout-hold' and (not isfinite(expiry) or expiry<=stamp or expiry>stamp+interval '30 minutes')) then
    raise exception 'invalid_hold_expiry';
  elsif exists(select 1 from unnest(replacements) original(claim_id) where not exists(
    select 1 from shared_inventory.claims c where c.id=original.claim_id and c.active and c.writer=p_writer and
      c.owner_reference=owner_ref and c.event_id is not distinct from event_ref and c.kind=v_kind and
      (c.expires_at is null or c.expires_at>stamp))) then
    raise exception 'replacement_ownership_unverified';
  else
    select array_agg(c.id order by c.id) into conflict_ids from shared_inventory.claims c
    where c.active and (c.expires_at is null or c.expires_at>stamp) and not (c.id=any(replacements)) and c.resource_ids && ids and
      (start_at < c.ends_at and end_at > c.starts_at);
    if cardinality(conflict_ids)>0 then
      answer := jsonb_build_object('status','conflict','claimIds',to_jsonb(conflict_ids));
    else
      insert into shared_inventory.claims(id,writer,owner_reference,event_id,kind,resource_ids,starts_at,ends_at,expires_at)
      values(claim_id,p_writer,owner_ref,event_ref,v_kind,ids,start_at,end_at,expiry);
      update shared_inventory.claims set active=false,replaced_by=claim_id where id=any(replacements);
      update shared_inventory.control set revision=revision+1 where id returning revision into ctl.revision;
      answer := jsonb_build_object('status','secured','claimId',claim_id,'revision',ctl.revision,
        'resourceIds',to_jsonb(ids),'startsAt',start_at,'endsAt',end_at,'expiresAt',expiry);
    end if;
  end if;
  insert into shared_inventory.operations(writer,operation_key,request,result) values(p_writer,p_key,p_request,answer);
  return answer;
end;
$$;

revoke all on function shared_inventory.shared_inventory_claim(text,text,jsonb) from public,anon,authenticated;
grant execute on function shared_inventory.shared_inventory_claim(text,text,jsonb) to service_role;
commit;
