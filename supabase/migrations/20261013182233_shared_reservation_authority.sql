begin;

-- Disabled until every writer is migrated and all existing allocations are reconciled.
create schema shared_inventory;
revoke all on schema shared_inventory from public, anon, authenticated;
grant usage on schema shared_inventory to service_role;
create table shared_inventory.control (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  baseline_ready boolean not null default false,
  revision bigint not null default 0 check (revision >= 0)
);
insert into shared_inventory.control(id) values (true);
create table shared_inventory.writers (
  id text primary key check (id in ('event-host','rexreplace','waitlist','final-call')),
  enabled boolean not null default false
);
insert into shared_inventory.writers(id) values ('event-host'),('rexreplace'),('waitlist'),('final-call');
create table shared_inventory.checkpoints (
  source text primary key check (source in ('event-host','rexreplace','waitlist')),
  revision text not null,
  complete boolean not null default false,
  checked_at timestamptz not null,
  covers_from timestamptz not null,
  covers_to timestamptz not null check (covers_to > covers_from)
);
create table shared_inventory.claims (
  id uuid primary key default gen_random_uuid(),
  writer text not null references shared_inventory.writers(id),
  owner_reference text not null,
  event_id text,
  kind text not null check (kind in ('event','room-booking','walk-in','checkout-hold')),
  resource_ids text[] not null check (cardinality(resource_ids) > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  expires_at timestamptz,
  active boolean not null default true,
  replaced_by uuid references shared_inventory.claims(id),
  created_at timestamptz not null default clock_timestamp(),
  check ((kind = 'checkout-hold') = (expires_at is not null)),
  check (kind <> 'event' or event_id is not null)
);
create index shared_claims_resources_idx on shared_inventory.claims using gin(resource_ids) where active;
create index shared_claims_owner_idx on shared_inventory.claims(writer, owner_reference);
create index shared_claims_replacement_idx on shared_inventory.claims(replaced_by) where replaced_by is not null;
create table shared_inventory.operations (
  writer text not null references shared_inventory.writers(id),
  operation_key text not null,
  request jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(writer, operation_key)
);
alter table shared_inventory.control enable row level security;
alter table shared_inventory.writers enable row level security;
alter table shared_inventory.checkpoints enable row level security;
alter table shared_inventory.claims enable row level security;
alter table shared_inventory.operations enable row level security;
revoke all on all tables in schema shared_inventory from public, anon, authenticated, service_role;
-- Service credentials are trusted server-only. No guest/staff browser can invoke this API.
grant select, insert, update on all tables in schema shared_inventory to service_role;
revoke update on shared_inventory.operations from service_role;

create function public.shared_inventory_claim(p_writer text, p_key text, p_request jsonb)
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
    checked_at >= stamp-interval '2 minutes' and covers_from <= start_at-interval '1 hour' and covers_to >= end_at+interval '1 hour' and
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
      ((start_at-case when v_kind='event' then interval '1 hour' else interval '0' end < c.ends_at and
        end_at > c.starts_at-case when c.kind='event' then interval '1 hour' else interval '0' end) or
       (exists(select 1 from unnest(ids) id where id=any(c.resource_ids) and id like 'private-room-%') and
        start_at < c.ends_at+interval '20 minutes' and end_at > c.starts_at-interval '20 minutes'));
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

-- Read-back after uncertain acceptance uses the ORIGINAL key and request, never a new send.
create function public.shared_inventory_operation(p_writer text,p_key text,p_request jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare op shared_inventory.operations; live boolean;
begin
  select * into op from shared_inventory.operations where writer=p_writer and operation_key=p_key;
  if not found then return jsonb_build_object('status','unknown','reason','operation_not_found'); end if;
  if op.request is distinct from p_request then raise exception 'idempotency_key_reused'; end if;
  if op.result->>'status'='secured' then
    select active and (expires_at is null or expires_at>clock_timestamp()) into live
      from shared_inventory.claims where id=(op.result->>'claimId')::uuid;
    if live is distinct from true then return jsonb_build_object('status','unknown','reason','claim_no_longer_active'); end if;
  end if;
  return op.result;
end;
$$;
revoke all on function public.shared_inventory_claim(text,text,jsonb),public.shared_inventory_operation(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.shared_inventory_claim(text,text,jsonb),public.shared_inventory_operation(text,text,jsonb) to service_role;
commit;
