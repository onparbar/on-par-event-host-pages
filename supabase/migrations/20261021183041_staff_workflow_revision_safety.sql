-- Pending review: staff save safety only; separate from final-call/shared-booking work.
-- Apply only after the recorded migration/schema comparison is reviewed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Staff roles are stored as bounded tagged JSON in the legacy BWA field.
-- Preserve the original limit for plain legacy employee names.
alter table public.kitchen_manual_assignments
  drop constraint if exists kitchen_manual_assignments_bwa_check;
alter table public.kitchen_manual_assignments
  add constraint kitchen_manual_assignments_bwa_check check (
    char_length(bwa) <= 120 or (
      left(bwa, length('__kitchen_roles__:')) = '__kitchen_roles__:'
      and char_length(bwa) <= 4096
    )
  );

alter table public.event_host_checklists
  add column if not exists task_evidence jsonb not null default '{}'::jsonb
  check (jsonb_typeof(task_evidence) = 'object');

create or replace function public.save_event_host_checklist_checked(
  p_record jsonb,
  p_expected_updated_at timestamptz,
  p_allow_reopen boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id bigint := (p_record->>'event_id')::bigint;
  v_previous public.event_host_checklists%rowtype;
  v_saved public.event_host_checklists%rowtype;
  v_now timestamptz;
  v_previous_writer text := current_setting('event_host.checklist_checked_save', true);
begin
  if v_id is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'Invalid checklist save payload.';
  end if;
  -- The lock also protects simultaneous creation when no row exists yet.
  perform pg_advisory_xact_lock(hashtextextended('event-host-checklist:' || v_id::text, 0));
  select * into v_previous from public.event_host_checklists where event_id = v_id for update;
  if v_previous.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'PT409', message = 'A newer checklist version exists. Reload and review before saving.';
  end if;
  if v_previous.status = 'submitted' and not p_allow_reopen then
    raise exception using errcode = 'PT409', message = 'Submitted checklists can only be reopened by Admin.';
  end if;
  v_now := greatest(clock_timestamp(), coalesce(v_previous.updated_at + interval '1 microsecond', '-infinity'::timestamptz));
  -- The later cutover trigger accepts writes only inside this checked save.
  perform set_config('event_host.checklist_checked_save', v_id::text, true);
  insert into public.event_host_checklists (
    event_id, event_name, event_date, poc, bwa, extras_added,
    remaining_drink_card_balance, tasks, task_evidence, entertainment, food,
    status, submitted_at, updated_at
  ) values (
    v_id, p_record->>'event_name', (p_record->>'event_date')::date,
    coalesce(p_record->>'poc', ''), coalesce(p_record->>'bwa', ''),
    coalesce(p_record->>'extras_added', ''), coalesce(p_record->>'remaining_drink_card_balance', ''),
    coalesce(p_record->'tasks', '{}'::jsonb), coalesce(p_record->'task_evidence', '{}'::jsonb),
    coalesce(p_record->'entertainment', '{}'::jsonb), coalesce(p_record->'food', '{}'::jsonb),
    p_record->>'status', case when p_record->>'status' = 'submitted' then v_now else null end, v_now
  )
  on conflict (event_id) do update set
    event_name = excluded.event_name, event_date = excluded.event_date, poc = excluded.poc,
    bwa = excluded.bwa, extras_added = excluded.extras_added,
    remaining_drink_card_balance = excluded.remaining_drink_card_balance,
    tasks = excluded.tasks, task_evidence = excluded.task_evidence,
    entertainment = excluded.entertainment, food = excluded.food,
    status = excluded.status, submitted_at = excluded.submitted_at, updated_at = excluded.updated_at
  returning * into v_saved;
  perform set_config('event_host.checklist_checked_save', coalesce(v_previous_writer, ''), true);
  return to_jsonb(v_saved);
end;
$$;

revoke all on function public.save_event_host_checklist_checked(jsonb, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.save_event_host_checklist_checked(jsonb, timestamptz, boolean) to service_role;

create or replace function public.save_event_host_floor_plan_checked(
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
  v_now timestamptz;
begin
  if v_id is null or p_changed_by is null or p_description is null then
    raise exception 'Invalid floor-plan save payload.';
  end if;
  -- Serialize the comparison and all child/revision writes, including first save.
  perform pg_advisory_xact_lock(hashtextextended('event-host-floor-plan:' || v_date::text, 0));
  v_previous := public.event_host_floor_plan_document(v_date);
  if (p_document->>'version')::integer is distinct from coalesce((v_previous->>'version')::integer, 0) then
    raise exception using errcode = 'PT409', message = 'A newer floor-plan version exists. Reload and review before saving.';
  end if;
  v_version := coalesce((v_previous->>'version')::integer, 0) + 1;
  v_now := greatest(
    clock_timestamp(),
    coalesce((v_previous->>'updatedAt')::timestamptz + interval '1 microsecond', '-infinity'::timestamptz),
    coalesce(nullif(p_document->>'updatedAt', '')::timestamptz + interval '1 microsecond', '-infinity'::timestamptz)
  );

  insert into public.event_host_floor_plans (
    id, event_date, status, version, rule_version, last_tripleseat_sync_at,
    created_at, updated_at, approved_at, approved_by
  ) values (
    v_id, v_date, p_document->>'status', v_version, p_document->>'ruleVersion',
    nullif(p_document->>'lastTripleseatSyncAt', '')::timestamptz,
    coalesce(nullif(p_document->>'createdAt', '')::timestamptz, v_now), v_now,
    nullif(p_document->>'approvedAt', '')::timestamptz,
    nullif(p_document->>'approvedBy', '')
  )
  on conflict (id) do update set
    status = excluded.status,
    version = v_version,
    rule_version = excluded.rule_version,
    last_tripleseat_sync_at = excluded.last_tripleseat_sync_at,
    updated_at = v_now,
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

revoke all on function public.save_event_host_floor_plan_checked(jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.save_event_host_floor_plan_checked(jsonb, text, text) to service_role;

-- Keep the previous server's RPC name available during the coordinated rollout.
-- It must still compare its saved revision, not fall back to an unchecked write.
-- Older servers label an unsaved plan version 1, so normalize only first creation
-- under the same date lock. The timestamp check distinguishes that unsaved
-- version 1 from a real saved version 1 when first-save requests race.
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
  v_date date := (p_document->>'eventDate')::date;
  v_previous jsonb;
  v_document jsonb := p_document;
begin
  perform pg_advisory_xact_lock(hashtextextended('event-host-floor-plan:' || v_date::text, 0));
  v_previous := public.event_host_floor_plan_document(v_date);
  if v_previous is null then
    if (p_document->>'version')::integer = 1 then
      v_document := jsonb_set(p_document, '{version}', '0'::jsonb);
    end if;
  elsif nullif(p_document->>'updatedAt', '')::timestamptz is distinct from (v_previous->>'updatedAt')::timestamptz then
    raise exception using errcode = 'PT409', message = 'A newer floor-plan version exists. Reload and review before saving.';
  end if;
  return public.save_event_host_floor_plan_checked(v_document, p_changed_by, p_description);
end;
$$;

revoke all on function public.save_event_host_floor_plan(jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.save_event_host_floor_plan(jsonb, text, text) to service_role;

commit;
