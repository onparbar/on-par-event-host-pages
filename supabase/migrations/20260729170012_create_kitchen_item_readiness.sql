begin;

create table public.kitchen_item_readiness (
  event_id text not null
    references public.kitchen_event_snapshots (event_id) on delete cascade,
  item_key text not null
    check (item_key ~ '^[A-Za-z0-9:_-]{1,160}$'),
  ready boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (event_id, item_key)
);

alter table public.kitchen_item_readiness enable row level security;

revoke all on table public.kitchen_item_readiness
  from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete
  on table public.kitchen_item_readiness
  to service_role;

comment on table public.kitchen_item_readiness is
  'Persistent per-item completion state for the protected OPE kitchen dashboard.';

commit;
