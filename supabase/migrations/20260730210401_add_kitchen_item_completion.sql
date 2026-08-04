begin;

alter table public.kitchen_item_readiness
  add column if not exists completed boolean not null default false,
  add column if not exists completed_updated_at timestamptz;

comment on column public.kitchen_item_readiness.ready is
  'Kitchen prep-ready state. Its updated_at timestamp drives existing add-on ready alerts.';
comment on column public.kitchen_item_readiness.completed is
  'Final state set after the prepared food item has been sent out.';
comment on column public.kitchen_item_readiness.completed_updated_at is
  'Timestamp of the most recent final-completion state change.';
comment on table public.kitchen_item_readiness is
  'Persistent per-item prep-ready and final-completion state for the protected OPE kitchen dashboard.';

commit;
