begin;

create table public.kitchen_event_add_ons (
  event_id text primary key
    references public.kitchen_event_snapshots (event_id) on delete cascade,
  food jsonb not null default '{}'::jsonb
    check (jsonb_typeof(food) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.kitchen_event_add_ons enable row level security;

revoke all on table public.kitchen_event_add_ons
  from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete
  on table public.kitchen_event_add_ons
  to service_role;

comment on table public.kitchen_event_add_ons is
  'Exact-event food add-ons entered by Event Host for the protected kitchen dashboard.';

commit;
