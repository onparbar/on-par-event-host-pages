begin;

create or replace function public.save_event_host_floor_plan(
  p_document jsonb,
  p_changed_by text,
  p_description text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id text := p_document->>'id';
  v_date date := (p_document->>'eventDate')::date;
  v_previous jsonb;
  v_version integer;
  v_result jsonb;
begin
  if v_id is null or p_changed_by is null or p_description is null then
    raise exception 'Invalid floor-plan save payload.';
  end if;
  v_previous := public.event_host_floor_plan_document(v_date);
  v_version := coalesce((v_previous->>'version')::integer, 0) + 1;

  insert into public.event_host_floor_plans (
    id, event_date, status, version, rule_version, last_tripleseat_sync_at,
    created_at, updated_at, approved_at, approved_by
  ) values (
    v_id, v_date, p_document->>'status', v_version, p_document->>'ruleVersion',
    nullif(p_document->>'lastTripleseatSyncAt', '')::timestamptz,
    coalesce(nullif(p_document->>'createdAt', '')::timestamptz, now()), now(),
    nullif(p_document->>'approvedAt', '')::timestamptz,
    nullif(p_document->>'approvedBy', '')
  )
  on conflict (id) do update set
    status = excluded.status,
    version = v_version,
    rule_version = excluded.rule_version,
    last_tripleseat_sync_at = excluded.last_tripleseat_sync_at,
    updated_at = now(),
    approved_at = excluded.approved_at,
    approved_by = excluded.approved_by;

  delete from public.event_host_floor_plan_reservations where floor_plan_id = v_id;
  delete from public.event_host_floor_plan_events where floor_plan_id = v_id;

  insert into public.event_host_floor_plan_events (
    id, floor_plan_id, tripleseat_event_id, name, status, guest_count,
    start_at, end_at, contracted_area_ids, unresolved_area_names, color,
    beo_last_modified_at, full_buyout, source
  )
  select
    value->>'id', v_id, value->>'tripleseatEventId', value->>'name',
    value->>'status', (value->>'guestCount')::integer,
    nullif(value->>'startAt', '')::timestamptz,
    nullif(value->>'endAt', '')::timestamptz,
    coalesce(value->'contractedAreaIds', '[]'::jsonb),
    coalesce(value->'unresolvedAreaNames', '[]'::jsonb),
    value->>'color', nullif(value->>'beoLastModifiedAt', '')::timestamptz,
    coalesce((value->>'fullBuyout')::boolean, false),
    coalesce(value->'source', '{}'::jsonb)
  from jsonb_array_elements(coalesce(p_document->'events', '[]'::jsonb));

  insert into public.event_host_floor_plan_reservations (
    id, floor_plan_id, floor_plan_event_id, area_id, reservation_type,
    start_at, end_at, label, source, locked_by_user, custom_geometry
  )
  select
    value->>'id', v_id, value->>'floorPlanEventId', value->>'areaId',
    value->>'reservationType', nullif(value->>'startAt', '')::timestamptz,
    nullif(value->>'endAt', '')::timestamptz, coalesce(value->>'label', ''),
    value->>'source', coalesce((value->>'lockedByUser')::boolean, false),
    nullif(value->'customGeometry', 'null'::jsonb)
  from jsonb_array_elements(coalesce(p_document->'reservations', '[]'::jsonb));

  v_result := public.event_host_floor_plan_document(v_date);
  insert into public.event_host_floor_plan_revisions (
    floor_plan_id, version, changed_by, description, previous_value, new_value
  ) values (
    v_id, v_version, left(p_changed_by, 200), left(p_description, 500),
    v_previous, v_result
  );
  return v_result;
end;
$$;

commit;
