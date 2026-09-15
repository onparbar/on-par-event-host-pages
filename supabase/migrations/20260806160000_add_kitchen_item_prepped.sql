begin;

alter table public.kitchen_item_readiness
  add column if not exists prepped boolean not null default false,
  add column if not exists prepped_updated_at timestamptz;

comment on column public.kitchen_item_readiness.prepped is
  'Kitchen item preparation state, separate from Ready and final verification.';
comment on column public.kitchen_item_readiness.prepped_updated_at is
  'Timestamp of the most recent Prepped state change.';

commit;
