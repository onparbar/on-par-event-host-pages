begin;

alter table public.kitchen_item_readiness
  add column if not exists prepped_by text;

comment on column public.kitchen_item_readiness.prepped_by is
  'Approved kitchen employee recorded when this item was marked Prepped; null for legacy or unchecked rows.';

commit;
