begin;

alter table public.entertainment_resources
  drop constraint if exists entertainment_resources_category_check;
alter table public.entertainment_resources
  add constraint entertainment_resources_category_check
  check (category in ('bowling', 'darts', 'pool', 'shuffleboard', 'mini-golf', 'private-rooms'));

alter table public.entertainment_reservations
  drop constraint if exists entertainment_reservations_resource_category_check;
alter table public.entertainment_reservations
  add constraint entertainment_reservations_resource_category_check
  check (resource_category in ('bowling', 'darts', 'pool', 'shuffleboard', 'mini-golf', 'private-rooms'));

insert into public.entertainment_resources
  (id, canonical_name, category, display_order)
values
  ('mini-golf-level-up', 'Level Up Mini Golf', 'mini-golf', 351),
  ('mini-golf-wild-axe', 'Wild Axe Mini Golf', 'mini-golf', 352),
  ('mini-golf-great-escape', 'Great Escape Mini Golf', 'mini-golf', 353),
  ('private-room-big-show', 'The Big Show', 'private-rooms', 408)
on conflict (id) do update set
  canonical_name = excluded.canonical_name,
  category = excluded.category,
  display_order = excluded.display_order,
  active = true;

create table if not exists public.event_host_floor_plans (
  id text primary key check (char_length(id) between 1 and 128),
  event_date date not null unique,
  status text not null check (status in (
    'Draft', 'Needs Review', 'Conflict', 'Approved',
    'Updated After Approval', 'Completed', 'Archived'
  )),
  version integer not null default 1 check (version > 0),
  rule_version text not null,
  last_tripleseat_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text
);

create table if not exists public.event_host_floor_plan_events (
  id text primary key check (char_length(id) between 1 and 160),
  floor_plan_id text not null references public.event_host_floor_plans(id) on delete cascade,
  tripleseat_event_id text not null,
  name text not null,
  status text not null,
  guest_count integer not null check (guest_count >= 0),
  start_at timestamptz,
  end_at timestamptz,
  contracted_area_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(contracted_area_ids) = 'array'),
  unresolved_area_names jsonb not null default '[]'::jsonb check (jsonb_typeof(unresolved_area_names) = 'array'),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  beo_last_modified_at timestamptz,
  full_buyout boolean not null default false,
  source jsonb not null check (jsonb_typeof(source) = 'object'),
  unique (floor_plan_id, tripleseat_event_id)
);

create table if not exists public.event_host_floor_plan_reservations (
  id text primary key check (char_length(id) between 1 and 240),
  floor_plan_id text not null references public.event_host_floor_plans(id) on delete cascade,
  floor_plan_event_id text not null references public.event_host_floor_plan_events(id) on delete cascade,
  area_id text not null,
  reservation_type text not null check (reservation_type in ('seating', 'food-table', 'room', 'custom')),
  start_at timestamptz,
  end_at timestamptz,
  label text not null default '',
  source text not null check (source in ('generated', 'manual')),
  locked_by_user boolean not null default false,
  custom_geometry jsonb check (custom_geometry is null or jsonb_typeof(custom_geometry) = 'object')
);

create index if not exists event_host_floor_plan_events_plan_idx
  on public.event_host_floor_plan_events (floor_plan_id, start_at, end_at);
create index if not exists event_host_floor_plan_reservations_plan_area_idx
  on public.event_host_floor_plan_reservations (floor_plan_id, area_id, start_at, end_at);

create table if not exists public.event_host_floor_plan_revisions (
  id uuid primary key default gen_random_uuid(),
  floor_plan_id text not null references public.event_host_floor_plans(id) on delete cascade,
  version integer not null,
  changed_at timestamptz not null default now(),
  changed_by text not null,
  description text not null,
  previous_value jsonb,
  new_value jsonb not null,
  unique (floor_plan_id, version)
);

create table if not exists public.event_host_floor_plan_conflict_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  floor_plan_id text not null references public.event_host_floor_plans(id) on delete cascade,
  conflict_code text not null,
  acknowledged_by text not null,
  reason text not null,
  acknowledged_at timestamptz not null default now()
);

create or replace function public.event_host_floor_plan_document(p_event_date date)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', fp.id,
    'eventDate', fp.event_date::text,
    'status', fp.status,
    'version', fp.version,
    'ruleVersion', fp.rule_version,
    'lastTripleseatSyncAt', fp.last_tripleseat_sync_at,
    'createdAt', fp.created_at,
    'updatedAt', fp.updated_at,
    'approvedAt', fp.approved_at,
    'approvedBy', fp.approved_by,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'floorPlanId', e.floor_plan_id,
        'tripleseatEventId', e.tripleseat_event_id,
        'name', e.name,
        'status', e.status,
        'guestCount', e.guest_count,
        'startAt', e.start_at,
        'endAt', e.end_at,
        'contractedAreaIds', e.contracted_area_ids,
        'unresolvedAreaNames', e.unresolved_area_names,
        'color', e.color,
        'beoLastModifiedAt', e.beo_last_modified_at,
        'fullBuyout', e.full_buyout,
        'source', e.source
      ) order by e.start_at nulls last, e.name)
      from public.event_host_floor_plan_events e
      where e.floor_plan_id = fp.id
    ), '[]'::jsonb),
    'reservations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'floorPlanEventId', r.floor_plan_event_id,
        'areaId', r.area_id,
        'reservationType', r.reservation_type,
        'startAt', r.start_at,
        'endAt', r.end_at,
        'label', r.label,
        'source', r.source,
        'lockedByUser', r.locked_by_user,
        'customGeometry', r.custom_geometry
      ) order by r.area_id, r.id)
      from public.event_host_floor_plan_reservations r
      where r.floor_plan_id = fp.id
    ), '[]'::jsonb)
  )
  from public.event_host_floor_plans fp
  where fp.event_date = p_event_date;
$$;

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

create or replace function public.event_host_floor_plan_revisions(p_floor_plan_id text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'floorPlanId', r.floor_plan_id,
    'version', r.version,
    'changedAt', r.changed_at,
    'changedBy', r.changed_by,
    'description', r.description,
    'previousValue', r.previous_value,
    'newValue', r.new_value
  ) order by r.version desc), '[]'::jsonb)
  from public.event_host_floor_plan_revisions r
  where r.floor_plan_id = p_floor_plan_id;
$$;

alter table public.event_host_floor_plans enable row level security;
alter table public.event_host_floor_plan_events enable row level security;
alter table public.event_host_floor_plan_reservations enable row level security;
alter table public.event_host_floor_plan_revisions enable row level security;
alter table public.event_host_floor_plan_conflict_acknowledgements enable row level security;

revoke all on table public.event_host_floor_plans, public.event_host_floor_plan_events,
  public.event_host_floor_plan_reservations, public.event_host_floor_plan_revisions,
  public.event_host_floor_plan_conflict_acknowledgements
from public, anon, authenticated;

grant select, insert, update, delete on table public.event_host_floor_plans,
  public.event_host_floor_plan_events, public.event_host_floor_plan_reservations,
  public.event_host_floor_plan_revisions,
  public.event_host_floor_plan_conflict_acknowledgements to service_role;
revoke all on function public.event_host_floor_plan_document(date)
  from public, anon, authenticated;
revoke all on function public.save_event_host_floor_plan(jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.event_host_floor_plan_revisions(text)
  from public, anon, authenticated;
grant execute on function public.event_host_floor_plan_document(date) to service_role;
grant execute on function public.save_event_host_floor_plan(jsonb, text, text) to service_role;
grant execute on function public.event_host_floor_plan_revisions(text) to service_role;

comment on table public.event_host_floor_plans is
  'Server-only Event Host floor plans; editable normalized assignments are the source of truth.';
comment on table public.event_host_floor_plan_reservations is
  'Seating, food-table, room, and custom assignments. Entertainment remains in shared entertainment_reservations.';

commit;
