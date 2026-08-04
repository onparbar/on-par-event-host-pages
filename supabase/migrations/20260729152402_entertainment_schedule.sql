begin;

create table if not exists public.entertainment_resources (
  id text primary key,
  canonical_name text not null unique,
  category text not null
    check (category in ('bowling', 'darts', 'pool', 'shuffleboard', 'private-rooms')),
  display_order integer not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.entertainment_resources
  (id, canonical_name, category, display_order)
values
  ('bowling-1', 'Bowling Lane 1', 'bowling', 1),
  ('bowling-2', 'Bowling Lane 2', 'bowling', 2),
  ('bowling-3', 'Bowling Lane 3', 'bowling', 3),
  ('bowling-4', 'Bowling Lane 4', 'bowling', 4),
  ('bowling-5', 'Bowling Lane 5', 'bowling', 5),
  ('bowling-6', 'Bowling Lane 6', 'bowling', 6),
  ('bowling-7', 'Bowling Lane 7', 'bowling', 7),
  ('bowling-8', 'Bowling Lane 8', 'bowling', 8),
  ('bowling-9', 'Bowling Lane 9', 'bowling', 9),
  ('bowling-10', 'Bowling Lane 10', 'bowling', 10),
  ('bowling-11', 'Bowling Lane 11', 'bowling', 11),
  ('bowling-12', 'Bowling Lane 12', 'bowling', 12),
  ('darts-1', 'Dart Lane 1', 'darts', 101),
  ('darts-2', 'Dart Lane 2', 'darts', 102),
  ('darts-3', 'Dart Lane 3', 'darts', 103),
  ('darts-4', 'Dart Lane 4', 'darts', 104),
  ('darts-5', 'Dart Lane 5', 'darts', 105),
  ('pool-1', 'Pool Table 1', 'pool', 201),
  ('pool-2', 'Pool Table 2', 'pool', 202),
  ('pool-3', 'Pool Table 3', 'pool', 203),
  ('shuffleboard-1', 'Shuffleboard Table 1', 'shuffleboard', 301),
  ('shuffleboard-2', 'Shuffleboard Table 2', 'shuffleboard', 302),
  ('private-room-gem', 'The Gem Room', 'private-rooms', 401),
  ('private-room-disco-inferno', 'The Disco Inferno', 'private-rooms', 402),
  ('private-room-ocean', 'The Ocean Room', 'private-rooms', 403),
  ('private-room-prime', 'The Prime Room', 'private-rooms', 404),
  ('private-room-royal', 'The Royal Room', 'private-rooms', 405),
  ('private-room-vip-1', 'VIP 1', 'private-rooms', 406),
  ('private-room-vip-2', 'VIP 2', 'private-rooms', 407)
on conflict (id) do update set
  canonical_name = excluded.canonical_name,
  category = excluded.category,
  display_order = excluded.display_order,
  active = true,
  updated_at = now();

create table if not exists public.entertainment_event_snapshots (
  event_id text primary key,
  local_event_id text,
  tripleseat_event_id text not null unique,
  tripleseat_booking_id text,
  event_name text not null,
  operating_date date not null,
  event_start_at timestamptz,
  event_end_at timestamptz,
  event_color text not null
    check (event_color ~ '^#[0-9A-Fa-f]{6}$'),
  color_source text not null
    check (color_source in ('floor-plan-assignment', 'event-plan', 'deterministic-fallback', 'manual')),
  floor_plan_asset_key text,
  source_updated_at timestamptz,
  needs_review boolean not null default false,
  review_issues jsonb not null default '[]'::jsonb
    check (jsonb_typeof(review_issues) = 'array'),
  source_snapshot jsonb not null,
  active boolean not null default true,
  synced_at timestamptz not null
);

create index if not exists entertainment_event_snapshots_date_idx
  on public.entertainment_event_snapshots (operating_date, active, event_start_at);

create table if not exists public.entertainment_reservations (
  id text primary key,
  sync_key text unique,
  local_event_id text,
  tripleseat_event_id text,
  tripleseat_booking_id text,
  event_name text not null,
  operating_date date not null,
  resource_id text not null
    references public.entertainment_resources (id),
  resource_category text not null
    check (resource_category in ('bowling', 'darts', 'pool', 'shuffleboard', 'private-rooms')),
  resource_name text not null,
  start_at timestamptz not null,
  end_at timestamptz not null
    check (end_at > start_at),
  source_start_at timestamptz,
  source_end_at timestamptz,
  source_resource_id text
    references public.entertainment_resources (id),
  event_color text not null
    check (event_color ~ '^#[0-9A-Fa-f]{6}$'),
  color_source text not null
    check (color_source in ('floor-plan-assignment', 'event-plan', 'deterministic-fallback', 'manual')),
  source text not null
    check (source in ('tripleseat', 'event-host-fallback', 'manual')),
  source_reference text,
  manual_override boolean not null default false,
  has_source_update boolean not null default false,
  needs_review boolean not null default false,
  review_issues jsonb not null default '[]'::jsonb
    check (jsonb_typeof(review_issues) = 'array'),
  auto_assigned boolean not null default false,
  notes text not null default ''
    check (char_length(notes) <= 1000),
  source_updated_at timestamptz,
  last_tripleseat_sync_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  updated_by text not null
);

create index if not exists entertainment_reservations_date_resource_idx
  on public.entertainment_reservations
  (operating_date, resource_id, active, start_at, end_at);

create index if not exists entertainment_reservations_event_idx
  on public.entertainment_reservations
  (tripleseat_event_id, operating_date);

create index if not exists entertainment_reservations_resource_fk_idx
  on public.entertainment_reservations (resource_id);

create index if not exists entertainment_reservations_source_resource_fk_idx
  on public.entertainment_reservations (source_resource_id)
  where source_resource_id is not null;

create table if not exists public.entertainment_reservation_audits (
  id text primary key,
  reservation_id text not null
    references public.entertainment_reservations (id) on delete cascade,
  action text not null
    check (
      action in (
        'sync-create',
        'sync-update',
        'sync-deactivate',
        'manual-create',
        'manual-update',
        'manual-remove',
        'revert-to-tripleseat'
      )
    ),
  previous_value jsonb,
  new_value jsonb,
  changed_by text not null,
  change_source text not null
    check (change_source in ('tripleseat-sync', 'manual')),
  reason text
    check (reason is null or char_length(reason) <= 500),
  intentional_conflict boolean not null default false,
  created_at timestamptz not null
);

create index if not exists entertainment_reservation_audits_reservation_idx
  on public.entertainment_reservation_audits (reservation_id, created_at desc);

create table if not exists public.entertainment_sync_runs (
  operating_date date primary key,
  status text not null
    check (status in ('running', 'success', 'partial', 'error')),
  events_processed integer not null default 0
    check (events_processed >= 0),
  reservations_created integer not null default 0
    check (reservations_created >= 0),
  reservations_updated integer not null default 0
    check (reservations_updated >= 0),
  warnings_created integer not null default 0
    check (warnings_created >= 0),
  conflicts_found integer not null default 0
    check (conflicts_found >= 0),
  error_summary text,
  started_at timestamptz not null,
  completed_at timestamptz,
  last_successful_sync_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.entertainment_resources enable row level security;
alter table public.entertainment_event_snapshots enable row level security;
alter table public.entertainment_reservations enable row level security;
alter table public.entertainment_reservation_audits enable row level security;
alter table public.entertainment_sync_runs enable row level security;

revoke all on table public.entertainment_resources
  from public, anon, authenticated;
revoke all on table public.entertainment_event_snapshots
  from public, anon, authenticated;
revoke all on table public.entertainment_reservations
  from public, anon, authenticated;
revoke all on table public.entertainment_reservation_audits
  from public, anon, authenticated;
revoke all on table public.entertainment_sync_runs
  from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete
  on table public.entertainment_resources
  to service_role;
grant select, insert, update, delete
  on table public.entertainment_event_snapshots
  to service_role;
grant select, insert, update, delete
  on table public.entertainment_reservations
  to service_role;
grant select, insert, update, delete
  on table public.entertainment_reservation_audits
  to service_role;
grant select, insert, update, delete
  on table public.entertainment_sync_runs
  to service_role;

comment on table public.entertainment_resources is
  'Canonical physical entertainment resources in fixed Event Host display order.';
comment on table public.entertainment_event_snapshots is
  'Safe normalized Tripleseat event projections used by the Entertainment Schedule.';
comment on table public.entertainment_reservations is
  'Local entertainment schedule values plus protected Tripleseat source candidates.';
comment on table public.entertainment_reservation_audits is
  'Tripleseat synchronization and authenticated Event Host staff edit history.';

commit;
