begin;

create table if not exists public.event_host_event_plans (
  event_id text primary key
    check (char_length(event_id) between 1 and 128),
  event_date date not null,
  plan jsonb not null
    check (jsonb_typeof(plan) = 'object'),
  source_snapshot jsonb not null
    check (jsonb_typeof(source_snapshot) = 'object'),
  source_updated_at timestamptz,
  synced_at timestamptz not null default now(),
  active boolean not null default true
);

create index if not exists event_host_event_plans_active_date_idx
  on public.event_host_event_plans (active, event_date, event_id);

create index if not exists event_host_event_plans_source_updated_idx
  on public.event_host_event_plans (source_updated_at)
  where active;

create table if not exists public.event_host_event_plan_sync (
  sync_key text primary key default 'rolling'
    check (sync_key = 'rolling'),
  window_start date not null,
  window_end date not null
    check (window_end >= window_start),
  status text not null
    check (status in ('running', 'success', 'error')),
  event_count integer not null default 0
    check (event_count >= 0),
  started_at timestamptz not null,
  completed_at timestamptz,
  last_successful_sync_at timestamptz,
  error_message text,
  updated_at timestamptz not null default now()
);

alter table public.event_host_event_plans enable row level security;
alter table public.event_host_event_plan_sync enable row level security;

drop policy if exists "event_host_event_plans_no_browser_access"
  on public.event_host_event_plans;
create policy "event_host_event_plans_no_browser_access"
on public.event_host_event_plans
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "event_host_event_plan_sync_no_browser_access"
  on public.event_host_event_plan_sync;
create policy "event_host_event_plan_sync_no_browser_access"
on public.event_host_event_plan_sync
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

revoke all on table public.event_host_event_plans
  from public, anon, authenticated, service_role;
revoke all on table public.event_host_event_plan_sync
  from public, anon, authenticated, service_role;

grant usage on schema public to service_role;
grant select, insert, update
  on table public.event_host_event_plans
  to service_role;
grant select, insert, update
  on table public.event_host_event_plan_sync
  to service_role;

comment on table public.event_host_event_plans is
  'Server-only normalized Tripleseat event plans for the rolling Event Host planning window.';
comment on table public.event_host_event_plan_sync is
  'Singleton status row for the rolling Event Host event-plan synchronization.';

commit;
