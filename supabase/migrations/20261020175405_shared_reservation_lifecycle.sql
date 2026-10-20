begin;

-- This migration installs server-only operations. It never enables any writer.
-- Exact receipts become invalid after replacement, release, expiry or alteration.
create function shared_inventory.receipt_active(receipt jsonb,p_writer text,p_request jsonb)
returns boolean language sql volatile security invoker set search_path = '' as $$
  select exists (
    select 1 from shared_inventory.claims c
    where c.id = (receipt->>'claimId')::uuid and c.active
      and c.writer=p_writer and c.owner_reference=p_request->>'ownerReference'
      and c.event_id is not distinct from nullif(p_request->>'eventId','')
      and c.kind=p_request->>'kind'
      and (c.expires_at is null or c.expires_at > clock_timestamp())
      and c.starts_at = (receipt->>'startsAt')::timestamptz
      and c.ends_at = (receipt->>'endsAt')::timestamptz
      and c.expires_at is not distinct from (receipt->>'expiresAt')::timestamptz
      and to_jsonb(c.resource_ids) = receipt->'resourceIds'
  );
$$;

create or replace function public.shared_inventory_operation(p_writer text,p_key text,p_request jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare op shared_inventory.operations; receipt jsonb;
begin
  select * into op from shared_inventory.operations where writer=p_writer and operation_key=p_key;
  if not found then return jsonb_build_object('status','unknown','reason','operation_not_found'); end if;
  if op.request is distinct from p_request then raise exception 'idempotency_key_reused'; end if;
  if op.result->>'status'='secured' and not shared_inventory.receipt_active(op.result,p_writer,op.request) then
    return jsonb_build_object('status','unknown','reason','claim_no_longer_active');
  end if;
  if op.result->>'status'='applied' then
    for receipt in select value from jsonb_array_elements(op.result->'claims') loop
      if not shared_inventory.receipt_active(receipt,p_writer,op.request) then
        return jsonb_build_object('status','unknown','reason','claim_no_longer_active');
      end if;
    end loop;
    if exists (
      select 1 from shared_inventory.claims c
      where c.id in (select value::uuid from jsonb_array_elements_text(op.result->'releasedClaimIds'))
        and c.active
    ) then return jsonb_build_object('status','unknown','reason','release_no_longer_verified'); end if;
  end if;
  return op.result;
end;
$$;

-- Keep v1 retries subject to the same exact read-back checks. The original
-- locking/validation engine stays private, with its existing service-only ACL.
alter function public.shared_inventory_claim(text,text,jsonb) set schema shared_inventory;
create function public.shared_inventory_claim(p_writer text,p_key text,p_request jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare answer jsonb;
begin
  answer := shared_inventory.shared_inventory_claim(p_writer,p_key,p_request);
  if answer->>'status'='secured' then
    return public.shared_inventory_operation(p_writer,p_key,p_request);
  end if;
  return answer;
end;
$$;
revoke all on function public.shared_inventory_claim(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.shared_inventory_claim(text,text,jsonb) to service_role;

-- Multi-group replacement, owned release and exact checkout conversion share
-- the original claim lock and idempotency namespace. Child writes are enclosed
-- in a subtransaction: any conflict rolls back ALL releases, claims and receipts.
create function public.shared_inventory_mutate(p_writer text,p_key text,p_request jsonb)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  ctl shared_inventory.control;
  action text := p_request->>'action';
  owner_ref text := p_request->>'ownerReference';
  event_ref text := nullif(p_request->>'eventId','');
  v_kind text := p_request->>'kind';
  originals uuid[];
  original shared_inventory.claims;
  item jsonb;
  child_request jsonb;
  child_result jsonb;
  receipts jsonb := '[]';
  answer jsonb;
  stamp timestamptz;
  revision bigint;
  previous shared_inventory.operations;
begin
  if p_writer is null or not exists(select 1 from shared_inventory.writers where id=p_writer)
    or p_key is null or length(p_key) not between 8 and 200
    or jsonb_typeof(p_request) is distinct from 'object'
    or action is null or action not in ('replace','release','convert')
    or owner_ref is null or length(owner_ref) not between 1 and 200
    or v_kind is null or v_kind not in ('event','room-booking','walk-in','checkout-hold')
    or (v_kind='event' and (event_ref is null or coalesce(p_request->>'approvalReference','')=''))
    or jsonb_typeof(p_request->'replaceClaimIds') is distinct from 'array'
    or jsonb_typeof(p_request->'claims') is distinct from 'array'
    then raise exception 'invalid_mutation_request'; end if;
  select coalesce(array_agg(value::uuid order by value),'{}'::uuid[]) into originals
    from jsonb_array_elements_text(p_request->'replaceClaimIds');
  if cardinality(originals)>100
    or cardinality(originals) <> (select count(distinct id) from unnest(originals) id)
    or jsonb_array_length(p_request->'claims')>50
    or (action='release' and (cardinality(originals)=0 or jsonb_array_length(p_request->'claims')<>0
      or coalesce(p_request->>'confirmationReference','')=''))
    or (action<>'release' and jsonb_array_length(p_request->'claims')=0)
    or (action='convert' and (cardinality(originals)<>1 or jsonb_array_length(p_request->'claims')<>1
      or v_kind<>'room-booking' or coalesce(p_request->>'confirmationReference','')=''))
    then raise exception 'invalid_mutation_shape'; end if;
  if current_setting('transaction_isolation') <> 'read committed' then raise exception 'read_committed_required'; end if;
  select * into strict ctl from shared_inventory.control where id for update;
  stamp := clock_timestamp();
  select * into previous from shared_inventory.operations where writer=p_writer and operation_key=p_key;
  if found then return public.shared_inventory_operation(p_writer,p_key,p_request); end if;
  if not ctl.enabled or not ctl.baseline_ready or exists(select 1 from shared_inventory.writers where not enabled) then
    answer := jsonb_build_object('status','unknown','reason','writer_cutover_incomplete');
  elsif (p_request->>'expectedRevision')::bigint is distinct from ctl.revision then
    answer := jsonb_build_object('status','unknown','reason','revision_changed');
  elsif exists(select 1 from unnest(originals) o(id) where not exists(
    select 1 from shared_inventory.claims c where c.id=o.id and c.active and c.writer=p_writer
      and c.owner_reference=owner_ref and c.event_id is not distinct from event_ref
      and c.kind=(case when action='convert' then 'checkout-hold' else v_kind end)
      and (action='release' or c.expires_at is null or c.expires_at>stamp))) then
    raise exception 'replacement_ownership_unverified';
  else
    -- Releasing requires proof the source cancellation/end was verified first.
    -- Its trusted server caller must verify that reference; stale sources do not
    -- prevent releasing an exact owned claim. Conversion requires fresh sources.
    begin
      if action='convert' then
        select * into strict original from shared_inventory.claims where id=originals[1];
      end if;
      update shared_inventory.claims set active=false where id=any(originals);
      revision := ctl.revision;
      for item in select value from jsonb_array_elements(p_request->'claims') loop
        if jsonb_typeof(item) is distinct from 'object'
          or exists(select 1 from jsonb_object_keys(item) k
            where k not in ('group','resourceIds','startsAt','endsAt','expiresAt'))
          then raise exception 'invalid_mutation_claim'; end if;
        child_request := item || jsonb_build_object(
          'ownerReference',owner_ref,'eventId',event_ref,'kind',v_kind,
          'approvalReference',p_request->>'approvalReference','replaceClaimIds','[]'::jsonb,
          'expectedRevision',revision,'sourceRevisions',p_request->'sourceRevisions');
        child_result := public.shared_inventory_claim(p_writer,gen_random_uuid()::text,child_request);
        if child_result->>'status'<>'secured' then
          -- Do not return IDs belonging to rolled-back intermediate claims.
          if child_result->>'status'='conflict' and exists(
            select 1 from jsonb_array_elements(receipts) r,
              jsonb_array_elements_text(child_result->'claimIds') id
              where r->>'claimId'=id) then raise exception 'overlapping_mutation_claims'; end if;
          answer := child_result;
          raise exception using errcode='SI001',message='mutation_not_applied';
        end if;
        if action='convert' and (
          to_jsonb(original.resource_ids) <> child_result->'resourceIds'
          or original.starts_at <> (child_result->>'startsAt')::timestamptz
          or original.ends_at <> (child_result->>'endsAt')::timestamptz
        ) then raise exception 'conversion_must_preserve_exact_hold'; end if;
        if action='convert' and original.expires_at<=clock_timestamp() then
          answer := jsonb_build_object('status','unknown','reason','hold_expired');
          raise exception using errcode='SI001',message='mutation_not_applied';
        end if;
        receipts := receipts || jsonb_build_array(child_result);
        revision := (child_result->>'revision')::bigint;
      end loop;
      if action='release' then
        update shared_inventory.control c set revision=c.revision+1 where id returning c.revision into revision;
      end if;
      answer := jsonb_build_object('status','applied','action',action,'revision',revision,
        'claims',receipts,'releasedClaimIds',to_jsonb(originals));
    exception when sqlstate 'SI001' then
      -- PL/pgSQL rolls back the enclosed database writes while retaining answer.
      null;
    end;
  end if;
  insert into shared_inventory.operations(writer,operation_key,request,result) values(p_writer,p_key,p_request,answer);
  return answer;
end;
$$;

revoke all on function shared_inventory.receipt_active(jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function shared_inventory.receipt_active(jsonb,text,jsonb) to service_role;
revoke all on function public.shared_inventory_mutate(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.shared_inventory_mutate(text,text,jsonb) to service_role;
commit;
