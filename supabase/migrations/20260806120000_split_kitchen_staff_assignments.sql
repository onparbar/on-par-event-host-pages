begin;

alter table public.kitchen_manual_assignments
  add column if not exists food_runners text[] not null default '{}',
  add column if not exists pocs text[] not null default '{}';

update public.kitchen_manual_assignments
set food_runners = array[bwa]
where bwa <> '' and cardinality(food_runners) = 0;

comment on column public.kitchen_manual_assignments.food_runners is
  'Manually selected Food Runners; never synchronized back to Tripleseat.';
comment on column public.kitchen_manual_assignments.pocs is
  'Manually selected event POCs; never synchronized back to Tripleseat.';

commit;
