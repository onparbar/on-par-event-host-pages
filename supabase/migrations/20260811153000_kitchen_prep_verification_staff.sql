alter table public.kitchen_manual_assignments
  add column if not exists prepped_by text not null default '',
  add column if not exists verified_by text not null default '';

comment on column public.kitchen_manual_assignments.prepped_by is
  'Employee selected for the kitchen checklist Prepped column.';

comment on column public.kitchen_manual_assignments.verified_by is
  'Different employee selected for the kitchen checklist Verified column.';
